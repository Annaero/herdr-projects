// The hidden helper, as a hidden model call: the watcher (a status line and a progress guess for whatever is running; the board works out the minutes left).
// It goes through one small table of one-shot commands per agent kind (agents.js); a helper kind without an entry
// turns it off. The Coordinator is not a helper: it is an ordinary agent of its own (coordinator.js).
import path from "node:path";
import { spawn } from "node:child_process";
import * as S from "./store.js";
import * as F from "./flow.js";
import { herdr } from "./herdr.js";
import { adapter } from "./agents.js";
import { began, etaOf } from "./state.js";
import { userEnv } from "./runner.js";
import * as P from "./watcher/pace.js";
import { CALL_MS, takeTurn, giveTurn } from "./watcher/one.js";
import { SYSTEM, watcherPrompt, readAnswer } from "./watcher/prompt.js";

// Tests replace the model call with a stand-in: a JSON argv; the prompt arrives on stdin.
const override = () => { try { const a = JSON.parse(process.env.HERDR_SUPERWORK_HELPER_CMD || "null"); return Array.isArray(a) && a.length ? a : null; } catch { return null; } };
function helperCommand({ prompt, system, lean }) {
  const o = override();
  if (o) return { command: o[0], args: o.slice(1), stdin: `${system ? `${system}\n\n` : ""}${prompt}` };
  const c = S.config();
  const a = adapter(c.watcherAgent);
  return a.oneShot ? a.oneShot({ model: c.watcherModel, prompt, system, lean }) : null;
}
export const helpersReady = () => !!override() || !!adapter(S.config().watcherAgent).oneShot;
// Helper calls are detached from the board's terminal (own session, no tty), so herdr does not mistake them for an
// agent in the board's pane.
function runHelper(cmd, { cwd, env = {}, timeoutMs = CALL_MS }, done) {
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
// About once a minute per working task (the `watcherEvery` setting; less often on a busy machine: watcher/pace.js),
// the last screen lines (the reviewer's pane while reviewing, otherwise the worker's) go to the helper with the task,
// the time spent so far and its previous guess, and it answers a line and a percent. One call covers every agent
// whose look is due, and only one call runs at a time on the machine (watcher/one.js). A screen that says what it said at the last look costs no
// call. It starts fresh on every look. It guesses no minutes: those follow from the percent (state.js), so they keep
// counting between looks.
const looks = new Map(); // id -> { at, role, words, toldAt }
const pace = { seen: new Map(), callAt: 0, running: false, fails: 0 };
let lean = true; // start the helper's program with as little loaded as it allows (agents/kinds.js)
export function watcherReset() { looks.clear(); Object.assign(pace, { seen: new Map(), callAt: 0, running: false, fails: 0 }); lean = true; }
// The turn a look belongs to. Not armedAt: herdr's status flaps between tools move that every few seconds.
const turnOf = (c) => `${c.since || 0}:${c.handled?.at || 0}:${c.reviewRound || 0}`;
const roleIn = (t) => (t.stage === "reviewing" ? "reviewer" : "agent");
const paneOf = (t, role) => (role === "reviewer" ? t.link.reviewer?.pane : t.link.pane);
// To herdr as pane metadata tokens, so herdr's own sidebar can show the line, the percent and the minutes left.
function tell(t, watch, role, now) {
  const pane = paneOf(t, role);
  if (!pane) return;
  const eta = etaOf(watch.progress, began(t, role), now);
  herdr(t.link.socket).metadata(pane, ["--token", `summary=${watch.msg}`, "--token", `progress=${watch.progress}%`, ...(eta === undefined ? [] : ["--token", `eta=${eta}m`]), "--ttl-ms", String(P.TOLD_TTL_MS)]);
  if (t.link.workspace && t.link.ownsWorkspace) { try { herdr(t.link.socket).call(["workspace", "report-metadata", t.link.workspace, "--source", "plugin:herdr-superwork", "--token", `summary=${watch.msg}`, "--ttl-ms", String(P.TOLD_TTL_MS)]); } catch {} }
}
export function watchTick(tasks, now = Date.now(), { load = P.loadNow(), run = runHelper } = {}) {
  // The keeper hands over the same tasks once per herdr session, each time as that session sees them.
  const view = tasks.find((t) => t.live && !t.live.away)?.link?.socket || "";
  const seen = pace.seen.get(view);
  if (seen !== undefined && now >= seen && now - seen < P.TICK_MS) return;
  pace.seen.set(view, now);
  if (!helpersReady()) return;
  for (const id of looks.keys()) if (!tasks.some((t) => t.id === id)) looks.delete(id);
  // Only an agent that is working is looked at: not one that is idle, waiting for you or finished.
  const busy = [];
  for (const t of tasks) {
    const role = roleIn(t);
    const working = !t.archivedAt && F.isAgentTask(t) && t.state === "working" && (t.stage === "reviewing" || (t.stage === "working" && t.live?.status === "working"));
    if (!working || !paneOf(t, role) || S.choices(t).watcher === "off") continue;
    let w = looks.get(t.id);
    if (!w || w.role !== role) looks.set(t.id, w = { at: 0, role, words: null, toldAt: 0 }); // a review is a new assignment: its first look is due at once
    busy.push({ id: t.id, at: w.at, t, role, w });
    // Between looks herdr's sidebar still gets the minutes left, worked out again from the last guess.
    if (t.watch?.role === role && t.watch.msg && now - w.toldAt >= P.TOLD_MS) { w.toldAt = now; try { tell(t, t.watch, role, now); } catch {} }
  }
  if (pace.running || !busy.length) return;
  const slow = P.slowdown(load) * P.afterFailures(pace.fails);
  if (now - pace.callAt < P.GAP_MS * slow) return;
  const every = Math.max(5, Number(S.config().watcherEvery) || 60) * 1000 * slow;
  const batch = [], sessions = new Map();
  // A reviewer counts as working while herdr says so of its own pane, as the agent does of its: asked once per herdr
  // session, and only when a look is due.
  const reviewing = (b) => {
    const socket = b.t.link.socket;
    if (!sessions.has(socket)) { try { sessions.set(socket, herdr(socket).agents()); } catch { sessions.set(socket, []); } }
    return sessions.get(socket).find((a) => a.pane_id === paneOf(b.t, b.role))?.agent_status === "working";
  };
  for (const b of P.riders(busy, now, every)) {
    if (batch.length >= P.BATCH) break;
    if (b.role === "reviewer" && !reviewing(b)) continue; // idle, waiting for you or finished: no look
    let screen = "";
    try { screen = herdr(b.t.link.socket).agentRead(paneOf(b.t, b.role), { source: "visible" }); } catch { continue; } // never a deep read: it would scroll a working agent's view
    const lines = P.lastLines(screen), words = P.wordsOf(lines);
    if (!lines) { b.w.at = now; continue; }
    if (words === b.w.words && b.t.watch?.role === b.role) { b.w.at = now; continue; } // an unchanged screen costs no call
    batch.push({ ...b, lines, words, turn: turnOf(b.t), stage: b.t.stage });
  }
  if (!batch.length) return;
  const cmd = helperCommand({ prompt: watcherPrompt(batch, now), system: SYSTEM, lean });
  if (!cmd || !takeTurn()) return; // another process's call is under way: this one waits its turn
  for (const b of batch) { b.w.at = now; b.w.words = b.words; }
  pace.callAt = now; pace.running = true;
  // "Only the watcher should have autocompact 100k."
  run(cmd, { cwd: S.dataDir(), env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "100000" } }, (code, out, err) => {
    pace.running = false; giveTurn();
    const found = readAnswer(out, batch.length);
    // A program too old for the lean start says so: from then on it is started the plain way, and these looks are due again.
    if (!found.size && lean && code && /unknown (option|argument)|unrecognized|unexpected argument/i.test(err || "")) { lean = false; for (const b of batch) { b.w.at = 0; b.w.words = null; } return; }
    pace.fails = found.size ? 0 : pace.fails + 1;
    const at = Date.now();
    batch.forEach((b, i) => {
      const got = found.get(i + 1);
      if (!got) { b.w.words = null; return; } // no answer for this one: its next look is not skipped as unchanged
      try {
        const watch = { ...got, at, role: b.role };
        // A late answer cannot overwrite a newer turn or its result.
        const cur = S.update(b.id, (c) => { if (c.stage !== b.stage || turnOf(c) !== b.turn || S.choices(c).watcher === "off") return false; c.watch = watch; });
        if (cur.watch === watch || cur.watch?.at === watch.at) { b.w.toldAt = at; tell(cur, watch, b.role, at); }
      } catch {}
    });
  });
}

// ---- instructions sent to another machine's Coordinator: a row on this board until that machine answers -----------------
export function stopDispatch(j) {
  const d = S.getDispatch(j.id);
  if (S.markerAlive({ pid: d?.pid, start: d?.pidStart })) { try { process.kill(-d.pid, "SIGTERM"); } catch { try { process.kill(d.pid, "SIGTERM"); } catch {} } }
  S.clearDispatch(j.id);
}
