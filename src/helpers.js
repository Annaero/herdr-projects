// The two hidden helpers, as hidden model calls: the watcher (a status line and a progress guess for whatever is
// running) and the dispatcher (the natural-language box). Both go through one small table of one-shot commands per
// agent kind (agents.js); a helper kind without an entry turns the helpers off with a visible note.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import * as S from "./store.js";
import * as F from "./flow.js";
import { herdr } from "./herdr.js";
import { adapter } from "./agents.js";
import { userEnv } from "./runner.js";
import { spawnLoose } from "./housekeeping.js";

// Tests replace the model call with a stand-in: a JSON argv; the prompt arrives on stdin.
const override = () => { try { const a = JSON.parse(process.env.HERDR_SUPERWORK_HELPER_CMD || "null"); return Array.isArray(a) && a.length ? a : null; } catch { return null; } };
function helperCommand({ prompt, system, allow = false }) {
  const o = override();
  if (o) return { command: o[0], args: o.slice(1), stdin: `${system ? `${system}\n\n` : ""}${prompt}` };
  const c = S.config();
  const a = adapter(c.helper);
  if (!a.oneShot || (allow && !a.allow)) return null;
  return a.oneShot({ model: c.helperModel, prompt, system, allow });
}
export const helpersReady = () => !!override() || !!adapter(S.config().helper).oneShot;
// The dispatcher must be restricted to herdr-superwork commands by the agent's own allow-list flag.
export const dispatcherReady = () => !!override() || (!!adapter(S.config().helper).oneShot && !!adapter(S.config().helper).allow);
// Helper calls are detached from the board's terminal (own session, no tty), so herdr does not mistake them for an
// agent in the board's pane.
function runHelper(cmd, { cwd, env = {}, timeoutMs = 45000 }, done) {
  let out = "", err = "", ended = false;
  const child = spawn(cmd.command, cmd.args, { cwd, detached: true, stdio: ["pipe", "pipe", "pipe"], env: { ...helperEnv(), ...env } });
  const end = (code) => { if (ended) return; ended = true; clearTimeout(kill); done(code, out, err); };
  const kill = setTimeout(() => { err += "\nit took too long and was stopped"; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, timeoutMs);
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
  child.on("error", () => end(1)); child.on("close", end);
  child.stdin.on("error", () => {});
  child.stdin.end(cmd.stdin || "");
  return child;
}
// The helper must find `herdr-superwork` on its PATH even when npm link was skipped, and must not look like a
// plugin command or a task's agent.
function helperEnv() {
  const env = { ...userEnv() };
  const shim = path.join(S.dataDir(), "bin");
  try { if (!fs.existsSync(path.join(shim, "herdr-superwork"))) { fs.mkdirSync(shim, { recursive: true }); fs.symlinkSync(S.BIN, path.join(shim, "herdr-superwork")); } } catch {}
  env.PATH = `${shim}:${env.PATH || ""}`;
  for (const k of ["HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID", "HERDR_PLUGIN_ID", "HERDR_PLUGIN_CONTEXT_JSON", "HERDR_PLUGIN_EVENT", "HERDR_PLUGIN_EVENT_JSON", "HERDR_PLUGIN_ENTRYPOINT_ID"]) delete env[k];
  return env;
}

// ---- the watcher --------------------------------------------------------------------------------------------------------
// Every 15 seconds per working task, the last screen lines (the reviewer's pane while reviewing, otherwise the
// worker's) go to the helper, which answers {"msg", "progress"}. It starts fresh on every look.
const watching = new Map(); // id -> { at, child }
const MAX_WATCHERS = 4;
export function watchTick(tasks, now = Date.now()) {
  if (!helpersReady()) return;
  for (const [id, w] of watching) if (!tasks.some((t) => t.id === id)) { try { w.child && process.kill(-w.child.pid, "SIGKILL"); } catch {} watching.delete(id); }
  for (const t of tasks) {
    const role = t.stage === "reviewing" ? "reviewer" : "agent";
    const busy = !t.archivedAt && F.isAgentTask(t) && t.state === "working" && (t.stage === "reviewing" || (t.stage === "working" && t.live?.status === "working"));
    if (!busy || S.choices(t).watcher === "off") continue;
    const w = watching.get(t.id) || { at: 0, child: null };
    if (w.child || now - w.at < 15000 || [...watching.values()].filter((x) => x.child).length >= MAX_WATCHERS) continue;
    const pane = role === "reviewer" ? t.link.reviewer?.pane : t.link.pane;
    if (!pane) continue;
    let screen = "";
    try { screen = herdr(t.link.socket).agentRead(pane, { source: "visible" }); } catch { continue; } // never a deep read: it would scroll a working agent's view
    const lines = screen.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-40).join("\n").slice(-5000);
    if (!lines) continue;
    const prompt = [
      role === "reviewer" ? "You are watching an adversarial reviewer check finished work. Write its status for a dashboard. Estimate progress through this review only, not through the agent's task." : "You are watching a coding agent work on a task. Write its status for a dashboard.",
      `Task: ${t.title}`,
      `The last lines on the ${role}'s terminal right now:`, lines,
      `Your previous guess of progress was ${t.watch?.progress ?? 0} percent. Only go lower if it clearly started over.`,
      'Reply with only this JSON and nothing else: {"msg": "<what it is doing right now: at most 8 plain words, present tense, no tool or command names>", "progress": <whole number 0 to 99: your best guess of how far through its current assignment it is>}',
    ].join("\n");
    const cmd = helperCommand({ prompt });
    if (!cmd) return;
    const armedAt = t.armedAt ?? null, stage = t.stage;
    w.at = now;
    // "Only the watcher should have autocompact 100k."
    w.child = runHelper(cmd, { cwd: S.dataDir(), env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "100000" } }, (_code, out) => {
      w.child = null;
      try {
        const j = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
        if (!j.msg) return;
        const watch = { msg: S.oneLine(j.msg, 120), progress: Math.max(0, Math.min(99, Math.round(Number(j.progress)) || 0)), at: Date.now(), role };
        // A late answer cannot overwrite a newer turn or its result.
        const cur = S.update(t.id, (c) => { if (c.stage !== stage || (c.armedAt ?? null) !== armedAt || S.choices(c).watcher === "off") return false; c.watch = watch; });
        // Also to herdr as pane metadata tokens, so herdr's own sidebar can show it.
        if (cur.watch === watch || cur.watch?.at === watch.at) herdr(t.link.socket).metadata(pane, ["--token", `summary=${watch.msg}`, "--token", `progress=${watch.progress}%`, "--ttl-ms", "120000"]);
      } catch {}
    });
    watching.set(t.id, w);
  }
}

// ---- the dispatcher -----------------------------------------------------------------------------------------------------
export const DISPATCH = `You are the dispatcher of a work board. The human typed one instruction. Carry it out by running the herdr-superwork command with your shell tool, then stop. There is no conversation: never ask a question, make sensible choices instead.
- Most instructions describe new work. File it as a task: herdr-superwork add "<short title: a few words, no trailing period>" --desc "<the full description in your own clear words; Markdown is fine; keep every requirement the human gave>". One task per distinct piece of work. The description says only what to build or do: never put handling instructions in it (delegating, reviewers, models, settings); act on those with the command instead.
- If they ask to start it, delegate it, or hand it to an agent, also run: herdr-superwork delegate <id>. Agents get their own git worktree by default; add --no-worktree only if the human says to work in place, in their checkout, or without a worktree. Worktrees start from the remote's default branch; add --base head if the human says to build on their current branch or their unpushed work.
- Instructions can also be about existing tasks: delegate them, "herdr-superwork tell <id> <text>" to say something to their agents, or "herdr-superwork report <id> --state <idle|working|done> [--msg <one line>]" to say where a task stands (the human's own tasks: working means in progress). Use "herdr-superwork clear <id>" only when the human plainly asks to delete or remove something. Use "archive <id>" when asked to archive or hide a task (kept, not deleted) and "restore <id>" to bring it back. Archived tasks are read-only: restore them before changing or starting them. "herdr-superwork list --archived" shows the archive; "list --query <text>" searches everything.
- Who does the work can be chosen per task: the working agent (--agent <kind such as claude or codex>, --model, --effort), the reviewer that attacks finished work and rates it 1 to 5 (--reviewer <kind>, or --reviewer off for none; reviewerModel, reviewerEffort, artifacts, serve), the watcher (watcher on or off), and the review loop: reviewAuto (true: a rating below 5/5 goes back to the agent by itself), review (repos, all or none), rounds, conflictAuto. If the human chooses any of these for a particular task ("with codex", "on high effort", "no reviewer for this one"), pass it to delegate as --<name> <value>, or run "herdr-superwork config <name> <value> --id <id>" if it is not being delegated now. If they choose one in general, run "herdr-superwork config <name> <value>".
- If they ask to send the review back, or to have the agent fix what the reviewer found: herdr-superwork review <id>. To send a saved error back: herdr-superwork retry <id>. To send failure details: herdr-superwork fix <id>.
- If they ask to change a setting (default agent, model, effort, the watcher, worktrees, the review loop, pull requests, how work is merged (squash, merge or rebase), cleanup, how many agents at once), run "herdr-superwork config <key> <value>". "herdr-superwork config" shows the settings.
- If they approve finished work ("approve it", "merge the poem one", "ship it"): herdr-superwork approve <id>. Only when they plainly say so.
- To change a task's title: herdr-superwork report <id> --title "<new title>". To write or change its description: herdr-superwork describe <id> "<the full new text>".
- Do nothing beyond what was asked. Do not do the work yourself.
End with one short line saying what you did, naming the ids.`;

export function dispatchPrompt(cwd, text, delegate, aboutId) {
  const here = S.repoOf(cwd);
  const tasks = F.board({ includeArchived: true }).map((t) => `${t.id} [${t.archivedAt ? "archived, " : ""}${t.state}${t.shownApp ? `, ${t.shownApp}` : ""}] ${t.title || ""}`).join("\n") || "(none)";
  const repos = Object.entries(S.knownRepos()).map(([name, dir]) => `${name} (${dir})`).join(", ");
  const about = aboutId ? S.get(aboutId) : null;
  const system = `${DISPATCH}\n\nThe human is in the repo "${here.name}"; new tasks go there unless they name another place. If they do ("in the other repo", "for project X", "in my home folder"), add --repo <a known repo's name, a folder name, or a path; "~" is the home folder> to add. Known repos: ${repos || "none yet"}. Tasks right now:\n${tasks}${about ? `\n\nThe human has task ${about.id} ("${about.title || ""}") open. "it" and "this" mean that task. Its description now:\n${about.description || "(none)"}` : ""}`;
  return { system, prompt: `Instruction: ${text}${delegate ? "\n\nDelegate what you file to an agent." : ""}` };
}
// A running instruction is a row of its own, on disk, so it is still there when the board is reopened; the helper
// process is detached and finishes without the board.
export function startDispatch(cwd, text, delegate, aboutId) {
  const d = S.newDispatch(text, { cwd, delegate: !!delegate, about: aboutId || null });
  if (process.env.HERDR_SUPERWORK_INLINE === "1") { (globalThis.__swJobs ||= []).push(["dispatch", d.id, []]); return d; }
  const pid = spawnLoose(["run", "dispatch", d.id]);
  S.setDispatch(d.id, { pid });
  return d;
}
export function stopDispatch(j) {
  const d = S.getDispatch(j.id);
  for (const pid of [d?.helperPid, d?.pid]) if (pid && S.pidAlive(pid)) { try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} } }
  S.clearDispatch(j.id);
}
export function dispatchJob(id) {
  return new Promise((resolve) => {
    const d = S.getDispatch(id);
    if (!d) return resolve();
    const cwd = d.cwd && fs.existsSync(d.cwd) ? d.cwd : process.env.HOME || process.cwd();
    const { system, prompt } = dispatchPrompt(cwd, d.text, d.delegate, d.about);
    const cmd = helperCommand({ prompt, system, allow: true });
    const last = (t) => String(t || "").trim().split("\n").filter((l) => l.trim()).pop() || "";
    if (!cmd) { S.setDispatch(id, { state: "error", msg: `the helper "${S.config().helper}" cannot be the dispatcher` }); return resolve(); }
    // An instruction that has not finished in two minutes is stuck: stop it and say so.
    const child = runHelper(cmd, { cwd, timeoutMs: 120000 }, (code, out, err) => {
      if (S.getDispatch(id)) { // not stopped meanwhile
        if (code === 0 && last(out)) S.setDispatch(id, { state: "done", msg: S.oneLine(last(out), 300) });
        else S.setDispatch(id, { state: "error", msg: S.oneLine(last(err) || last(out) || `it ended with ${code}`, 300) });
      }
      resolve();
    });
    S.setDispatch(id, { helperPid: child.pid, pid: d.pid || process.pid });
  });
}
// For another machine's board: run one instruction here and answer when it is done.
export async function dispatchNow(cwd, text, delegate, aboutId) {
  const d = S.newDispatch(text, { cwd, delegate: !!delegate, about: aboutId || null, pid: process.pid });
  await dispatchJob(d.id);
  const done = S.getDispatch(d.id);
  S.clearDispatch(d.id);
  return done?.state === "done" ? { ok: true, msg: done.msg } : { ok: false, msg: done?.msg || "it did not finish" };
}
