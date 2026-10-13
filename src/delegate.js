// Delegating: a herdr worktree workspace, the repo's setup, then the agent in its root pane with the first prompt.
// A delegated task is one herdr worktree workspace with its agent pane in it; herdr does the running.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import * as S from "./store.js";
import * as F from "./flow.js";
import { claim, release, guardFor, sh, outputOf } from "./runner.js";
import { startArgs, preTrust, adapter, hookUsable, versionOf, roleOf, ownWords, effortFor } from "./agents.js";
import { settle } from "./submit.js";
import * as R from "./research.js";
import { AGENT_BOARD_RULE } from "./board-rule.js";
import { automationRule } from "./automations/told.js";

// ---- names -----------------------------------------------------------------------------------------------------------
// `sw-` + the repo name (lower-case, anything outside [a-z0-9] as `-`, 16 characters) + `-<n>`. Always matches herdr's
// [a-z][a-z0-9_-]{0,31}. The name is a convenience: every later command targets the stored pane id.
export function agentName(t, taken = []) {
  const repo = t.repo.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 16);
  const base = `sw-${repo}-${t.n}`;
  if (!taken.includes(base)) return base;
  return `${base}-${createHash("sha1").update(`${t.id}:${t.root}:${Date.now()}`).digest("hex").slice(0, 4)}`;
}

// ---- where a worktree starts: delegate/worktree.js -------------------------------------------------------------------
export { baseRef, freeBranch, excludeRuleDir, copyIncludes, slugOf } from "./delegate/worktree.js";
import { baseRef, freeBranch, excludeRuleDir, copyIncludes } from "./delegate/worktree.js";

// ---- the first prompt ------------------------------------------------------------------------------------------------
// How "I am waiting" and "I am finished" are told apart: by that command alone. The board cannot read a question out
// of a last message, a report or a closing note, and an agent that asked in plain words was reviewed as finished.
export const WAIT_RULE = "That command is the only way to say that you are waiting, and it holds for one stop: run it every time you stop for the human's answer, also for each question of an interview or a consultation and also when you ran it before. Their answer arrives as your next message, and then you carry on. A stop without it means you are finished, whatever your last message, your report or your closing note says: the work is then checked and reviewed as it stands. Never run it to put off the review of finished work.";
// The board's own rules are fixed. Your own words for the worker (`worker.instructions`) come after them.
export function rules(t) {
  const cmd = F.shim(), research = R.isResearch(t);
  const w = S.work(t), check = S.commandOf(w["check.command"]), words = roleOf("worker", (n) => w[n]).instructions;
  const lines = [
    "Do all of this task's own work yourself, in this folder. Never hand it to anyone else.",
    research ? R.researchRule(t) : "",
    t.worktree && research ? R.researchTree(t) : t.worktree ? `You are in your own git worktree on branch ${t.branch}; the human's checkout is elsewhere and untouched. Commit your work on this branch with clear messages. Do not push, merge into the human's branch or switch branches yourself (you may bring the base branch into your own branch to resolve a conflict). When you finish, the board runs the repo's check and opens the pull request.` : "",
    check && !research ? `Your work only counts as done when this passes: ${check}` : "",
    "Do not stop until the work is finished and you have checked that it works. Stopping means it is finished and goes to review. End with a short summary of what you did.",
    `If you cannot continue without the human, run this and then stop: ${cmd} report ${t.id} --state blocked --kind <question|permission|auth> --msg "<why, in one line>"  (question: the human must type an answer; permission: you need approval to do something; auth: a login, token or credential is missing). Write the reason like these: "Need a GitHub login to open the PR", "Should the old settings file be removed", "Need your OK to delete the test data". Do not end with a question otherwise.`,
    WAIT_RULE,
    `If you come across unrelated work that should be done (a bug elsewhere, a follow-up), do not do it and do not add it as a task: mention it in a short "Also noticed" list at the end of your closing note${research ? " and of your report" : " (and of your report, if you write one)"}, one line each with the file it is in, and carry on. Nothing else is done with it. There is no command for suggesting a task any more: where this task's description asks for "suggestions on this task", that list is what it gets.`,
    AGENT_BOARD_RULE,
    automationRule(t),
    R.reportRule(t),
    `Before you stop, also write your closing summary (or your question to the human) to ${F.noteFile(t)} (the board's own folder for this task, not the folder you work in). It is the board's fallback when it cannot read your last message.`,
  ].filter(Boolean);
  const short = S.sayId(t.id); // the repo's short key, where it has one: the human may call the task by it
  return `Rules for this task (its id on the work board is ${t.id}${short !== t.id ? `; the human also calls it ${short}, and every command takes that name too` : ""}):\n${lines.map((l) => `- ${l}`).join("\n")}${words ? `\n\n${ownWords(words)}` : ""}`;
}
// Every worker's first prompt starts with one line naming the task and the role: it is how a conversation file is
// matched to its task for an agent kind that names its own sessions.
export const taskLine = (t, role = "agent", round = 0) => `Work board task ${t.id}, role: ${role}${round ? `, round ${round}` : ""}.`;
// With a launch flag for standing rules the rules stay in force for the whole session and are not repeated here.
export const firstPrompt = (t, standing = !!adapter(t.agent).standing) => [taskLine(t), t.title, t.description, standing ? "" : rules(t)].filter(Boolean).join("\n\n");

// The launch arguments that are the plugin's own: the turn-end hook (with a new secret token) and the standing rules.
// Returns { extra, hooked, session }. Nothing is written to the user's own agent settings.
export function launchExtras(t, role, { kind, round = 0, standing = "", resume = null } = {}) {
  const a = adapter(kind);
  const token = randomBytes(18).toString("hex");
  S.setToken(t.id, role, token, round);
  let hook = null;
  if (hookUsable(kind)) { try { hook = a.hookArgs({ shim: F.shim(), id: t.id, role, round, token, dir: S.dirOf(t.id) }); } catch { hook = null; } }
  const session = !resume && a.newSession ? a.newSession() : null;
  return { hook: hook || [], rules: standing && a.standing ? a.standing(standing, S.dirOf(t.id)) : [], hooked: !!hook, session, version: versionOf(kind) };
}

// ---- starting the agent ----------------------------------------------------------------------------------------------
// Used by a first delegation and by "restarting an exited agent". The pane must be at its shell prompt.
export function startAgent(id, g, { prompt, resume = null }) {
  let t = S.get(id);
  const api = F.h(t);
  const kind = t.agent;
  // The worker's settings, read now, as it starts. Its program is the one the task was delegated with: a model set
  // for another program is not handed to it.
  const now = S.work(t), who = roleOf("worker", (n) => now[n]);
  const model = who.kind === kind ? who.model : "", level = effortFor(kind, who.effort);
  preTrust(kind, t.root || S.folderOf(t.id), who.access);
  const taken = api.agents().filter((a) => a.pane_id !== t.link.pane).map((a) => a.name).filter(Boolean);
  const name = agentName(t, taken);
  F.nameAgentTab(api, t.link.tab);
  const x = launchExtras(t, "agent", { kind, standing: rules(t), resume });
  const args = (hooked) => startArgs(kind, { model, effort: level, fast: who.fast, access: who.access, resume, session: x.session, extra: [...(hooked ? x.hook : []), ...x.rules] });
  let blocked = false, hooked = x.hooked;
  const start = (withHook) => {
    try { api.agentStart(name, kind, t.link.pane, args(withHook)); }
    catch (e) {
      if (e.code === "agent_not_ready") { blocked = true; return; } // a dialog is in the way (folder trust, first run): the text waits in the inbox
      if (!withHook) throw e;
      hooked = false; start(false); // once more without the hook arguments
    }
  };
  start(hooked);
  // herdr calls the program ready before it has drawn anything; text typed that early loses its enter (submit.js).
  if (prompt && !blocked) settle(api, t.link.pane, [kind, ...args(hooked)].join(" "));
  // The send time arms the pipeline: nothing older than this counts as the turn's end.
  t = g.set((t) => {
    t.stage = "working"; t.armedAt = Date.now(); t.expectedWake = null; t.turnOpen = true; t.turnBy = "start"; t.msg = ""; t.link = { ...t.link, agent: name }; if (!(t.workAt >= (t.since || 0))) t.workAt = Date.now(); t.startedAgentAt = Date.now(); t.exitedAt = null;
    t.hooked = hooked; t.agentVersion = x.version || ""; t.sent = null; t.unsent = null;
    if (t.failure?.stage === "send") t.failure = null;
    const session = resume || x.session || null;
    if (session !== (t.session || null)) { t.session = session; t.transcript = null; t.handled = { ...(t.handled || {}), msg: null, pos: 0 }; }
  });
  if (!prompt) return "started";
  if (blocked) { S.queueText(id, prompt, { first: !resume }); return "queued"; }
  return F.deliver(t, prompt, null, { first: !resume });
}

// Which program works on the task is `worker.agent` as it reads when the agent starts, not when the task was queued:
// a task that waited for a slot starts on what the setting says now. Only a conversation that is reopened keeps
// its program, which is the one that holds it.
function agentNow(g, t) {
  if (t.startedAgentAt && resumable(t)) return t;
  const kind = S.agentOf(S.setting("worker.agent", t)).kind;
  return kind && kind !== t.agent ? g.set((t) => { t.agent = kind; t.app = kind; t.session = null; t.transcript = null; }) : t;
}

// The prompt for an agent that is started again on a task it worked on before.
// It resumes the conversation whose id the plugin chose (or learned) at launch, when the agent program still has
// it; otherwise it starts fresh with the task and the last message.
export function resumable(t) {
  const a = adapter(t.agent);
  if (!t.session || !a.resume) return false;
  try { return !a.transcript || !!a.transcript(t.session, S.cwdOf(t)); } catch { return false; }
}
function againPrompt(t, waiting) {
  const said = t.said ? `Your last message was:\n${t.said}` : "";
  return resumable(t)
    ? { resume: t.session, prompt: F.withTail(t, waiting.join("\n\n") || "Continue where you left off.") }
    : { prompt: [firstPrompt(t), said, "You were working on this before and your session ended. Continue from the state of this branch.", waiting.join("\n\n")].filter(Boolean).join("\n\n") };
}

// Text the agent never started on (submit.js) goes in again, word for word, once its program has been started anew:
// alone when it was all a fresh program was given, into the same conversation when there is one to reopen.
function unsentPrompt(t, waiting) {
  const u = t.unsent, text = [u.text, ...waiting].join("\n\n");
  if (u.first) return { prompt: text };
  return resumable(t) ? { resume: t.session, prompt: text } : againPrompt(t, [u.text, ...waiting]);
}

export async function delegateJob(id) {
  let t = claim(id, "delegate");
  if (!t || t.stage !== "starting") { if (t) release(id); return; }
  const g = guardFor(id);
  g.expect(t);
  try {
    const api = F.h(t);
    const root = S.folderOf(t.id);
    const label = t.title.slice(0, 60);
    const env = () => ({ HERDR_SUPERWORK_ID: t.id, HERDR_SUPERWORK_WORKTREE: S.cwdOf(t), HERDR_SUPERWORK_REPO: root });
    // 1. A place to work, unless the task still has a live pane from an earlier run.
    const livePane = t.link.pane ? api.paneGet(t.link.pane) : null;
    if (livePane && api.agentGet(t.link.pane)) { // delegate again on a task whose agent is still there: just continue it
      t = g.set((t) => { t.stage = "working"; t.armedAt = Date.now(); t.turnOpen = true; t.turnBy = "start"; });
      return void F.deliver(t, F.withTail(t, "Continue this task."));
    }
    if (!livePane) {
      let res, patch = {};
      if (t.worktree && fs.existsSync(t.worktree)) res = F.openingWorktree(api, root, () => api.worktreeOpen({ cwd: root, path: t.worktree, label }));
      else if (S.canWorktree(root) && !t.startedOnce) { // a task in a repo always works in a worktree of its own
        // A repo with no commits yet has nothing to branch from: give it an empty first commit (files and index stay).
        try { if (!F.headOf(root)) S.gitOut(root, ["rev-parse", "--verify", "HEAD"]); } catch {
          const tree = S.gitOut(root, ["hash-object", "-w", "-t", "tree", "/dev/null"]);
          S.gitOut(root, ["update-ref", "HEAD", S.gitOut(root, ["commit-tree", tree, "-m", "Initial commit"])]);
        }
        const branch = freeBranch(root, t);
        const from = baseRef(root, S.setting("workspace.from", t));
        res = F.openingWorktree(api, root, () => api.worktreeCreate({ cwd: root, branch, base: from, label }));
        const dir = res.worktree?.path || res.workspace?.worktree?.checkout_path;
        // The repo's own file, read from the commit the worktree starts from: its six facts, and what it was refused.
        const file = S.repoFile(root, from);
        excludeRuleDir(root);
        patch = { worktree: dir, branch, from, baseSha: (from === "HEAD" && F.headOf(root)) || S.gitOut(root, ["rev-parse", from]), repoFile: file.facts, repoRefused: file.refused, fresh: true, ownNote: true, copy: true };
      } else {
        res = api.workspaceCreate({ cwd: root, label, env: S.boardEnv() });
        if (S.isRepo(root)) excludeRuleDir(root);
        const file = t.repoFile ? { facts: t.repoFile, refused: t.repoRefused || [] } : S.repoFile(root);
        patch = { repoFile: file.facts, repoRefused: file.refused, fresh: !t.startedOnce, startMark: S.isRepo(root) ? R.startMark(root) : null, ...(t.startedOnce ? {} : { ownNote: true }) }; // your checkout as the agent finds it
      }
      const pane = res.root_pane || api.panes(res.workspace.workspace_id)[0];
      const { copy, ...kept } = patch;
      t = g.set((t) => { Object.assign(t, kept); t.fallbacks = { ...(t.fallbacks || {}), repoFile: kept.repoRefused?.length ? kept.repoRefused.join("\n") : undefined }; t.root = root; t.startedOnce = true; t.link = { ...t.link, workspace: res.workspace.workspace_id, tab: res.tab?.tab_id || pane.tab_id, pane: pane.pane_id, terminal: pane.terminal_id, ownsWorkspace: true, reviewer: null }; });
      if (copy) copyIncludes(root, t.worktree, S.listOf(S.setting("workspace.include", t)));
    }
    // 2. The repo prepares itself. setup runs as a plain subprocess, before the agent starts, so the pane is still at
    //    its shell prompt when `agent start` needs it.
    if (t.fresh) {
      t = g.set({ fresh: false });
      const setup = S.commandOf(S.setting("workspace.setup", t));
      if (setup) {
        t = g.set({ stage: "setup", msg: `Setting up: ${setup}` });
        const r = await sh(setup, S.cwdOf(t), env(), { alive: () => !!g.check() });
        if (r.aborted) return;
        if (!r.ok) { g.set((t) => { t.stage = "failed"; t.setupPending = true; t.msg = "Setup failed"; Object.assign(t, S.failurePatch({ stage: "setup", title: "Setup failed", detail: `Command: ${setup}\nFolder: ${S.cwdOf(t)}\n\n${r.out || "No output"}`, next: "Fix the setup problem in the working folder, then finish again. The setup is retried before the check." })); }); return; }
      }
    }
    // 3. The agent, in the workspace's root pane, then the task.
    //    A task whose agent ran before (delegated again after it exited) continues instead of starting over.
    t = agentNow(g, t);
    const waiting = S.takeText(id).map((m) => m.text);
    try { startAgent(id, g, t.startedAgentAt ? againPrompt(t, waiting) : { prompt: [firstPrompt(t), ...waiting].join("\n\n") }); }
    catch (e) { if (waiting.length) S.untakeText(id, waiting.length); throw e; }
  } catch (e) {
    if (e.aborted) return;
    try { S.update(id, (t) => { if (t.runner?.pid !== process.pid) return false; t.stage = "failed"; t.msg = "Could not start"; Object.assign(t, S.failurePatch({ stage: "start", title: "Could not start the agent", detail: `${e.message}${e.args ? `\n\nherdr ${e.args.join(" ")}` : ""}`.trim() || outputOf(e), agentCanFix: false, next: "Fix what herdr reports, then delegate again." })); }, { waitMs: 10000 }); } catch {}
  } finally { release(id); }
}

// Restarting an exited agent: the same pane (or a new one in the task's workspace, reopened from the worktree if
// the workspace was closed). It resumes the same conversation when herdr reported a session id for the pane and
// the agent's adapter knows how; otherwise it starts fresh with the task, the last closing note and
// "continue from the state of this branch". Text waiting in the inbox goes along.
export async function restartJob(id) {
  let t = claim(id, "restart");
  if (!t) return;
  const g = guardFor(id);
  g.expect(t);
  try {
    const api = F.h(t);
    const root = S.folderOf(t.id);
    let pane = t.link?.pane ? api.paneGet(t.link.pane) : null;
    // Its box may still hold the text it never started on, and typing it again would send it twice: the program is
    // ended, and started again below in the same pane.
    if (t.unsent && pane && api.agentGet(t.link.pane) && !api.paneQuit(t.link.pane)) throw new Error("The agent's program could not be ended to start it again. Go into the agent and press enter, or close its terminal and retry.");
    if (pane && api.agentGet(t.link.pane)) { // it is back by itself (herdr restored it): just deliver
      const waiting = S.takeText(id).map((m) => m.text);
      if (waiting.length) F.deliver(t, waiting.join("\n\n"));
      return;
    }
    if (!pane) {
      const ws = t.link?.workspace ? api.workspaceGet(t.link.workspace) : null;
      let res;
      if (ws) { const first = api.panes(ws.workspace_id)[0]; pane = first ? api.paneSplit(first.pane_id, { cwd: S.cwdOf(t), env: S.boardEnv() }) : null; }
      if (!pane) {
        res = t.worktree && fs.existsSync(t.worktree) ? F.openingWorktree(api, root, () => api.worktreeOpen({ cwd: root, path: t.worktree, label: t.title.slice(0, 60) })) : api.workspaceCreate({ cwd: S.cwdOf(t), label: t.title.slice(0, 60), env: S.boardEnv() });
        pane = res.root_pane || api.panes(res.workspace.workspace_id)[0];
      }
      t = g.set((t) => { t.link = { ...t.link, workspace: pane.workspace_id, tab: pane.tab_id, pane: pane.pane_id, terminal: pane.terminal_id, ownsWorkspace: true, reviewer: null }; });
    }
    t = agentNow(g, t);
    const waiting = S.takeText(id).map((m) => m.text);
    try { startAgent(id, g, t.unsent ? unsentPrompt(t, waiting) : againPrompt(t, waiting)); }
    catch (e) { if (waiting.length) S.untakeText(id, waiting.length); throw e; }
  } catch (e) {
    if (e.aborted) return;
    try { S.update(id, (t) => { if (t.runner?.pid !== process.pid) return false; t.stage = "failed"; t.msg = "Could not restart the agent"; Object.assign(t, S.failurePatch({ stage: "start", title: "Could not restart the agent", detail: e.message, agentCanFix: false, next: "Fix what herdr reports, then reply or delegate again." })); }, { waitMs: 10000 }); } catch {}
  } finally { release(id); }
}

// Reopen a task's space when it was closed (archive closes it) and, with `restart`, start its exited agent again in
// the same conversation without sending it anything. Used by "go into the task" here and from another machine.
export function reopen(id, { restart = false } = {}) {
  let t = S.find(id);
  F.assertLive(t);
  const api = F.h(t);
  let pane = api.paneGet(t.link.pane);
  if (!pane) {
    if (!(t.worktree && fs.existsSync(t.worktree))) throw new Error("Its terminal is gone. Reply or delegate again to start its agent.");
    const res = F.openingWorktree(api, S.folderOf(t.id), () => api.worktreeOpen({ cwd: S.folderOf(t.id), path: t.worktree, label: String(t.title).slice(0, 60) }));
    pane = res.root_pane || api.panes(res.workspace.workspace_id)[0];
    t = S.update(t.id, (t) => { t.link = { ...t.link, workspace: pane.workspace_id, tab: pane.tab_id, pane: pane.pane_id, terminal: pane.terminal_id, ownsWorkspace: true }; });
    F.nameAgentTab(api, pane.tab_id);
  }
  let hasAgent = !!api.agentGet(pane.pane_id);
  if (!hasAgent && restart && resumable(t) && !S.markerAlive(t.runner)) {
    const stage = t.stage, armedAt = t.armedAt;
    const g = { set: (fn) => S.update(t.id, fn, { waitMs: 10000 }) };
    try { startAgent(t.id, g, { prompt: "", resume: t.session }); hasAgent = true; } catch {}
    S.update(t.id, (c) => { c.stage = stage; c.armedAt = armedAt; c.turnOpen = false; }, { waitMs: 10000 }); // nothing was asked of it: the task stands where it stood
  }
  return { pane, hasAgent, task: S.get(t.id) };
}
