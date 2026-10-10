// The hidden helper, as a hidden model call: the watcher (a status line and a progress guess for whatever is running).
// It goes through one small table of one-shot commands per agent kind (agents.js); a helper kind without an entry
// turns it off. The Coordinator is not a helper: it is an ordinary agent of its own (coordinator.js).
import path from "node:path";
import { spawn } from "node:child_process";
import * as S from "./store.js";
import * as F from "./flow.js";
import { herdr } from "./herdr.js";
import { adapter } from "./agents.js";
import { userEnv } from "./runner.js";

// Tests replace the model call with a stand-in: a JSON argv; the prompt arrives on stdin.
const override = () => { try { const a = JSON.parse(process.env.HERDR_SUPERWORK_HELPER_CMD || "null"); return Array.isArray(a) && a.length ? a : null; } catch { return null; } };
function helperCommand({ prompt, system }) {
  const o = override();
  if (o) return { command: o[0], args: o.slice(1), stdin: `${system ? `${system}\n\n` : ""}${prompt}` };
  const c = S.config();
  const a = adapter(c.watcherAgent);
  return a.oneShot ? a.oneShot({ model: c.watcherModel, prompt, system }) : null;
}
export const helpersReady = () => !!override() || !!adapter(S.config().watcherAgent).oneShot;
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
  env.PATH = `${path.dirname(F.shim())}:${env.PATH || ""}`;
  for (const k of ["HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID", "HERDR_PLUGIN_ID", "HERDR_PLUGIN_CONTEXT_JSON", "HERDR_PLUGIN_EVENT", "HERDR_PLUGIN_EVENT_JSON", "HERDR_PLUGIN_ENTRYPOINT_ID"]) delete env[k];
  env.HERDR_SUPERWORK_NO_KEEPER = "1"; // a helper's commands never start the keeper
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
    if (!lines || lines === w.lines) { w.at = now; watching.set(t.id, w); continue; } // an unchanged screen costs no call
    w.lines = lines;
    const prompt = [
      role === "reviewer" ? "You are watching an adversarial reviewer check finished work. Write its status for a dashboard. Estimate progress through this review only, not through the agent's task." : "You are watching a coding agent work on a task. Write its status for a dashboard.",
      `Task: ${t.title}`,
      `The last lines on the ${role}'s terminal right now:`, lines,
      `Your previous guess of progress was ${t.watch?.progress ?? 0} percent. Only go lower if it clearly started over.`,
      'Reply with only this JSON and nothing else: {"msg": "<what it is doing right now: at most 8 plain words, present tense, no tool or command names>", "progress": <whole number 0 to 99: your best guess of how far through its current assignment it is>}',
    ].join("\n");
    const cmd = helperCommand({ prompt });
    if (!cmd) return;
    // The turn this look belongs to. Not armedAt: herdr's status flaps between tools move that every few seconds.
    const turnOf = (c) => `${c.since || 0}:${c.handled?.at || 0}:${c.reviewRound || 0}`;
    const mine = turnOf(t), stage = t.stage;
    w.at = now;
    // "Only the watcher should have autocompact 100k."
    w.child = runHelper(cmd, { cwd: S.dataDir(), env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "100000" } }, (_code, out) => {
      w.child = null;
      try {
        const j = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
        if (!j.msg) return;
        const watch = { msg: S.oneLine(j.msg, 120), progress: Math.max(0, Math.min(99, Math.round(Number(j.progress)) || 0)), at: Date.now(), role };
        // A late answer cannot overwrite a newer turn or its result.
        const cur = S.update(t.id, (c) => { if (c.stage !== stage || turnOf(c) !== mine || S.choices(c).watcher === "off") return false; c.watch = watch; });
        // Also to herdr as pane metadata tokens, so herdr's own sidebar can show it.
        if (cur.watch === watch || cur.watch?.at === watch.at) {
          herdr(t.link.socket).metadata(pane, ["--token", `summary=${watch.msg}`, "--token", `progress=${watch.progress}%`, "--ttl-ms", "120000"]);
          if (t.link.workspace && t.link.ownsWorkspace) { try { herdr(t.link.socket).call(["workspace", "report-metadata", t.link.workspace, "--source", "plugin:herdr-superwork", "--token", `summary=${watch.msg}`, "--ttl-ms", "120000"]); } catch {} }
        }
      } catch {}
    });
    watching.set(t.id, w);
  }
}

// ---- instructions sent to another machine's Coordinator: a row on this board until that machine answers -----------------
export function stopDispatch(j) {
  const d = S.getDispatch(j.id);
  if (S.markerAlive({ pid: d?.pid, start: d?.pidStart })) { try { process.kill(-d.pid, "SIGTERM"); } catch { try { process.kill(d.pid, "SIGTERM"); } catch {} } }
  S.clearDispatch(j.id);
}
