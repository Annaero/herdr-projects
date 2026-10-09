// Delegating: a herdr worktree workspace, the repo's setup, then the agent in its root pane with the first prompt.
// A delegated task is one herdr worktree workspace with its agent pane in it; herdr does the running.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as S from "./store.js";
import * as F from "./flow.js";
import { claim, release, guardFor, sh, outputOf } from "./runner.js";
import { startArgs, preTrust, adapter } from "./agents.js";

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
  const lines = [
    "Do all of the work yourself, in this folder. Never delegate it, file it as a new task or hand it to anyone else.",
    t.worktree ? `You are in your own git worktree on branch ${t.branch}; the human's checkout is elsewhere and untouched. Commit your work on this branch with clear messages. Do not push, merge into the human's branch or switch branches yourself (you may bring the base branch into your own branch to resolve a conflict). When you finish, the board runs the repo's check and opens the pull request.` : "",
    t.repoCfg?.check ? `Your work only counts as done when this passes: ${t.repoCfg.check}` : "",
    "Do not stop until the work is finished and you have checked that it works. Stopping means it is finished and goes to review.",
    `Before you stop, write your closing summary, or your question to the human if you cannot continue, to ${F.RULE_DIR}/closing-${t.n}.md in this folder (git ignores that folder). The board reads that file, not your screen.`,
    `If you cannot continue until the human does something, also run this and then stop: herdr-superwork report ${t.id} --state blocked --kind <question|permission|auth> --msg "<why, in one line>"  (question: the human must type an answer; permission: you need approval to do something; auth: a login, token or credential is missing).`,
  ].filter(Boolean);
  return `Rules for this task (its id on the work board is ${t.id}):\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
export const firstPrompt = (t) => [t.title, t.description, rules(t)].filter(Boolean).join("\n\n");

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
  let blocked = false;
  try { api.agentStart(name, kind, t.link.pane, startArgs(kind, { model: ch.model, effort: ch.effort, resume })); }
  catch (e) {
    if (e.code !== "agent_not_ready") throw e;
    blocked = true; // a dialog is in the way (folder trust, first run): the text waits in the inbox
  }
  // The send time arms the pipeline: a closing note counts only when it is newer than this.
  t = g.set((t) => { t.stage = "working"; t.armedAt = Date.now(); t.expectedWake = null; t.turnOpen = true; t.msg = ""; t.link = { ...t.link, agent: name }; t.startedAgentAt = Date.now(); t.exitedAt = null; });
  if (blocked) { S.queueText(id, prompt); F.notify(t, `${t.title}: needs you`, "Its agent shows a dialog. Go in and answer it; your task is queued behind it."); return "queued"; }
  const how = F.deliver(t, prompt);
  if (how === "queued") F.notify(t, `${t.title}: needs you`, "Its agent shows a dialog. Go in and answer it; your task is queued behind it.");
  return how;
}

// The prompt for an agent that is started again on a task it worked on before.
function againPrompt(t, waiting) {
  const resumable = !!t.session && !!adapter(t.agent).resume;
  const said = t.said ? `Your last closing note was:\n${t.said}` : "";
  return resumable
    ? { resume: t.session, prompt: [waiting.join("\n\n") || "Continue where you left off.", F.noteRule(t)].join("\n\n") }
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
      t = g.set((t) => { t.stage = "working"; t.armedAt = Date.now(); t.turnOpen = true; });
      const how = F.deliver(t, `Continue this task.\n\n${F.noteRule(t)}`);
      return void (how === "queued" && F.notify(t, `${t.title}: needs you`, "Its agent shows a dialog."));
    }
    if (!livePane) {
      const mode = t.worktreeMode || S.config().worktree;
      let res, patch = {};
      if (t.worktree && fs.existsSync(t.worktree)) res = api.worktreeOpen({ cwd: root, path: t.worktree, label });
      else if (mode !== "none" && S.canWorktree(root) && !t.startedOnce) {
        // A repo with no commits yet has nothing to branch from: give it an empty first commit (files and index stay).
        try { S.gitOut(root, ["rev-parse", "--verify", "HEAD"]); } catch {
          const tree = S.gitOut(root, ["hash-object", "-w", "-t", "tree", "/dev/null"]);
          S.gitOut(root, ["update-ref", "HEAD", S.gitOut(root, ["commit-tree", tree, "-m", "Initial commit"])]);
        }
        const branch = freeBranch(root, t);
        const from = baseRef(root, t.base || S.config().base);
        res = api.worktreeCreate({ cwd: root, branch, base: from, label });
        const dir = res.worktree?.path || res.workspace?.worktree?.checkout_path;
        const repoCfg = S.repoConfig(root, from);
        excludeRuleDir(root);
        copyIncludes(root, dir, repoCfg.include || []);
        patch = { worktree: dir, branch, from, baseSha: S.gitOut(root, ["rev-parse", from]), repoCfg, fresh: true };
      } else {
        res = api.workspaceCreate({ cwd: root, label });
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
        if (!r.ok) { g.set((t) => { t.stage = "failed"; t.setupPending = true; t.msg = "setup failed"; Object.assign(t, S.failurePatch({ stage: "setup", title: "Setup failed", detail: `Command: ${t.repoCfg.setup}\nFolder: ${S.cwdOf(t)}\n\n${r.out || "No output"}`, next: "Fix the setup problem in the working folder, then finish again. The setup is retried before the check." })); }); F.notify(t, `${t.title}: setup failed`, ""); return; }
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
      if (ws) { const first = api.panes(ws.workspace_id)[0]; pane = first ? api.paneSplit(first.pane_id, { cwd: S.cwdOf(t) }) : null; }
      if (!pane) {
        res = t.worktree && fs.existsSync(t.worktree) ? api.worktreeOpen({ cwd: root, path: t.worktree, label: t.title.slice(0, 60) }) : api.workspaceCreate({ cwd: S.cwdOf(t), label: t.title.slice(0, 60) });
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
