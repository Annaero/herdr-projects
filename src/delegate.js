// Delegating: a herdr worktree workspace, the repo's setup, then the agent in its root pane with the first prompt.
// A delegated task is one herdr worktree workspace with its agent pane in it; herdr does the running.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as S from "./store.js";
import * as F from "./flow.js";
import { claim, release, guardFor, sh, outputOf } from "./runner.js";
import { randomBytes } from "node:crypto";
import { startArgs, preTrust, adapter, hookUsable, versionOf } from "./agents.js";

// ---- names -----------------------------------------------------------------------------------------------------------
// `sw-` + the repo name (lower-case, anything outside [a-z0-9] as `-`, 16 characters) + `-<n>`. Always matches herdr's
// [a-z][a-z0-9_-]{0,31}. The name is a convenience: every later command targets the stored pane id.
export function agentName(t, taken = []) {
  const repo = t.repo.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 16);
  const base = `sw-${repo}-${t.n}`;
  if (!taken.includes(base)) return base;
  return `${base}-${createHash("sha1").update(`${t.id}:${t.root}:${Date.now()}`).digest("hex").slice(0, 4)}`;
}
export const slugOf = (title) => String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

// ---- where a worktree starts -----------------------------------------------------------------------------------------
// "fresh" (default): the remote's default branch, fetched first if the repo has not been fetched in a day (5 seconds
// at most, never asking for a password). With no remote, or with "head": your checkout's current commit.
export function baseRef(root, base) {
  if (base !== "head") {
    try {
      if (F.hasOrigin(root)) {
        let age = Infinity;
        try { age = Date.now() - fs.statSync(path.join(root, ".git", "FETCH_HEAD")).mtimeMs; } catch {}
        if (age > 24 * 3600 * 1000) { try { execFileSync("git", ["fetch", "origin"], { cwd: root, stdio: "ignore", timeout: 5000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -oBatchMode=yes" } }); } catch {} }
        for (const ref of ["origin/HEAD", "origin/main", "origin/master"]) { try { S.gitOut(root, ["rev-parse", "--verify", `refs/remotes/${ref}`]); return ref; } catch {} }
      }
    } catch {}
  }
  return "HEAD";
}
// herdr checks out an existing branch of that name and ignores --base, so the name must be free first.
export function freeBranch(root, t) {
  const slug = slugOf(t.title);
  const stem = `work/${t.n}${slug ? `-${slug}` : ""}`;
  let branch = stem;
  for (let i = 2; ; i++) { try { S.gitOut(root, ["rev-parse", "--verify", `refs/heads/${branch}`]); branch = `${stem}-${i}`; } catch { break; } }
  return branch;
}
// Keep the plugin's own folder out of the repo's status without touching a committed file. The exclude file is shared
// by all of the repo's worktrees.
export function excludeRuleDir(root) {
  try {
    const file = path.resolve(root, S.gitOut(root, ["rev-parse", "--git-path", "info/exclude"]));
    const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (cur.split("\n").some((l) => l.trim() === `${F.RULE_DIR}/`)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${cur.endsWith("\n") || !cur ? "" : "\n"}${F.RULE_DIR}/\n`);
  } catch {}
}
// Ignored files a fresh worktree lacks (.env and the like): copy those named by `include` and by .worktreeinclude.
export function copyIncludes(root, dir, include) {
  const patterns = [...(include || [])];
  try { patterns.push(...fs.readFileSync(path.join(root, ".worktreeinclude"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))); } catch {}
  if (!patterns.length) return;
  const res = patterns.map((g) => new RegExp("^" + g.replace(/^\//, "").replace(/\/$/, "").split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"));
  let ignored = [];
  try { ignored = S.gitOut(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"]).split("\n").filter(Boolean); } catch {}
  for (const entry of ignored) {
    const rel = entry.replace(/\/$/, "");
    if (rel.startsWith(F.RULE_DIR) || !res.some((re) => re.test(rel) || re.test(path.basename(rel)))) continue;
    try { fs.cpSync(path.join(root, rel), path.join(dir, rel), { recursive: true }); } catch {}
  }
}

// ---- the first prompt ------------------------------------------------------------------------------------------------
export function rules(t) {
  const cmd = F.shim();
  const lines = [
    "Do all of the work yourself, in this folder. Never delegate it or hand it to anyone else.",
    t.worktree ? `You are in your own git worktree on branch ${t.branch}; the human's checkout is elsewhere and untouched. Commit your work on this branch with clear messages. Do not push, merge into the human's branch or switch branches yourself (you may bring the base branch into your own branch to resolve a conflict). When you finish, the board runs the repo's check and opens the pull request.` : "",
    t.repoCfg?.check ? `Your work only counts as done when this passes: ${t.repoCfg.check}` : "",
    "Do not stop until the work is finished and you have checked that it works. Stopping means it is finished and goes to review. End with a short summary of what you did.",
    `If you cannot continue without the human, run this and then stop: ${cmd} report ${t.id} --state blocked --kind <question|permission|auth> --msg "<why, in one line>"  (question: the human must type an answer; permission: you need approval to do something; auth: a login, token or credential is missing). Do not end with a question otherwise.`,
    `If you come across unrelated work that should be done (a bug elsewhere, a follow-up), do not do it: file it on the board with ${cmd} add "<short title>" --desc "<what and why>" and carry on. Those two commands are the only board commands you may run.`,
    `Before you stop, also write your closing summary (or your question to the human) to ${F.RULE_DIR}/closing-${t.n}.md in this folder (git ignores that folder). It is the board's fallback when it cannot read your last message.`,
  ].filter(Boolean);
  return `Rules for this task (its id on the work board is ${t.id}):\n${lines.map((l) => `- ${l}`).join("\n")}`;
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
  const ch = S.choices(t);
  preTrust(kind, t.root || S.folderOf(t.id));
  const taken = api.agents().filter((a) => a.pane_id !== t.link.pane).map((a) => a.name).filter(Boolean);
  const name = agentName(t, taken);
  const x = launchExtras(t, "agent", { kind, standing: rules(t), resume });
  const args = (hooked) => startArgs(kind, { model: ch.model, effort: ch.effort, resume, session: x.session, extra: [...(hooked ? x.hook : []), ...x.rules] });
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
  // The send time arms the pipeline: nothing older than this counts as the turn's end.
  t = g.set((t) => {
    t.stage = "working"; t.armedAt = Date.now(); t.expectedWake = null; t.turnOpen = true; t.turnBy = "start"; t.msg = ""; t.link = { ...t.link, agent: name }; t.startedAgentAt = Date.now(); t.exitedAt = null;
    t.hooked = hooked; t.agentVersion = x.version || "";
    const session = resume || x.session || null;
    if (session !== (t.session || null)) { t.session = session; t.transcript = null; t.handled = { ...(t.handled || {}), msg: null, pos: 0 }; }
  });
  if (!prompt) return "started";
  if (blocked) { S.queueText(id, prompt); return "queued"; }
  return F.deliver(t, prompt);
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
      const mode = t.worktreeMode || S.config().worktree;
      let res, patch = {};
      if (t.worktree && fs.existsSync(t.worktree)) res = F.openingWorktree(api, root, () => api.worktreeOpen({ cwd: root, path: t.worktree, label }));
      else if (mode !== "none" && S.canWorktree(root) && !t.startedOnce) {
        // A repo with no commits yet has nothing to branch from: give it an empty first commit (files and index stay).
        try { S.gitOut(root, ["rev-parse", "--verify", "HEAD"]); } catch {
          const tree = S.gitOut(root, ["hash-object", "-w", "-t", "tree", "/dev/null"]);
          S.gitOut(root, ["update-ref", "HEAD", S.gitOut(root, ["commit-tree", tree, "-m", "Initial commit"])]);
        }
        const branch = freeBranch(root, t);
        const from = baseRef(root, t.base || S.config().base);
        res = F.openingWorktree(api, root, () => api.worktreeCreate({ cwd: root, branch, base: from, label }));
        const dir = res.worktree?.path || res.workspace?.worktree?.checkout_path;
        const repoCfg = S.repoConfig(root, from);
        excludeRuleDir(root);
        copyIncludes(root, dir, repoCfg.include || []);
        patch = { worktree: dir, branch, from, baseSha: S.gitOut(root, ["rev-parse", from]), repoCfg, fresh: true };
      } else {
        res = api.workspaceCreate({ cwd: root, label, env: S.boardEnv() });
        if (S.isRepo(root)) excludeRuleDir(root);
        patch = { repoCfg: t.repoCfg || S.repoConfig(root), fresh: !t.startedOnce };
      }
      const pane = res.root_pane || api.panes(res.workspace.workspace_id)[0];
      t = g.set((t) => { Object.assign(t, patch); t.root = root; t.startedOnce = true; t.link = { ...t.link, workspace: res.workspace.workspace_id, tab: res.tab?.tab_id || pane.tab_id, pane: pane.pane_id, terminal: pane.terminal_id, ownsWorkspace: true, reviewer: null }; });
    }
    // 2. The repo prepares itself. setup runs as a plain subprocess, before the agent starts, so the pane is still at
    //    its shell prompt when `agent start` needs it.
    if (t.fresh) {
      t = g.set({ fresh: false });
      if (t.repoCfg?.setup) {
        t = g.set({ stage: "setup", msg: `setting up: ${t.repoCfg.setup}` });
        const r = await sh(t.repoCfg.setup, S.cwdOf(t), env(), { alive: () => !!g.check() });
        if (r.aborted) return;
        if (!r.ok) { g.set((t) => { t.stage = "failed"; t.setupPending = true; t.msg = "setup failed"; Object.assign(t, S.failurePatch({ stage: "setup", title: "Setup failed", detail: `Command: ${t.repoCfg.setup}\nFolder: ${S.cwdOf(t)}\n\n${r.out || "No output"}`, next: "Fix the setup problem in the working folder, then finish again. The setup is retried before the check." })); }); return; }
      }
    }
    // 3. The agent, in the workspace's root pane, then the task.
    //    A task whose agent ran before (delegated again after it exited) continues instead of starting over.
    const waiting = S.takeText(id).map((m) => m.text);
    try { startAgent(id, g, t.startedAgentAt ? againPrompt(t, waiting) : { prompt: [firstPrompt(t), ...waiting].join("\n\n") }); }
    catch (e) { if (waiting.length) S.untakeText(id, waiting.length); throw e; }
  } catch (e) {
    if (e.aborted) return;
    try { S.update(id, (t) => { if (t.runner?.pid !== process.pid) return false; t.stage = "failed"; t.msg = "could not start"; Object.assign(t, S.failurePatch({ stage: "start", title: "Could not start the agent", detail: `${e.message}${e.args ? `\n\nherdr ${e.args.join(" ")}` : ""}`.trim() || outputOf(e), agentCanFix: false, next: "Fix what herdr reports, then delegate again." })); }, { waitMs: 10000 }); } catch {}
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
    const waiting = S.takeText(id).map((m) => m.text);
    try { startAgent(id, g, againPrompt(t, waiting)); }
    catch (e) { if (waiting.length) S.untakeText(id, waiting.length); throw e; }
  } catch (e) {
    if (e.aborted) return;
    try { S.update(id, (t) => { if (t.runner?.pid !== process.pid) return false; t.stage = "failed"; t.msg = "could not restart the agent"; Object.assign(t, S.failurePatch({ stage: "start", title: "Could not restart the agent", detail: e.message, agentCanFix: false, next: "Fix what herdr reports, then reply or delegate again." })); }, { waitMs: 10000 }); } catch {}
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
