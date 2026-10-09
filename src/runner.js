// Long jobs (delegate, finish line, land, restart) run in a detached runner so the board stays responsive and
// hook commands never hold herdr up. A runner marks itself in task.json as `runner: {pid, started, job}`; a marker
// whose pid is gone is ignored and cleared. Each turn is a separate runner, so counters live in task.json.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import * as S from "./store.js";

// herdr starts plugin commands (hooks, the popup) with its server's environment, which may lack the user's PATH
// (verified: the agent programs and gh can be missing). Ask a login shell once and remember the answer for a while.
export function userEnv() {
  if (process.env.HERDR_SUPERWORK_ENV_OK || !process.env.HERDR_PLUGIN_ID) return process.env;
  const file = path.join(S.dataDir(), "env.json");
  let cached = S.readJson(file);
  if (!cached || Date.now() - cached.at > 600000 || !cached.PATH) {
    const r = spawnSync(process.env.SHELL || "/bin/sh", ["-lc", 'printf "%s" "$PATH"'], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] });
    cached = { at: Date.now(), PATH: r.status === 0 && r.stdout.trim() ? r.stdout.trim() : process.env.PATH };
    try { S.writeJson(file, cached); } catch {}
  }
  process.env.PATH = [...new Set([...String(cached.PATH).split(":"), ...String(process.env.PATH || "").split(":")])].filter(Boolean).join(":");
  process.env.HERDR_SUPERWORK_ENV_OK = "1";
  return process.env;
}
const node = () => (/^node/.test(path.basename(process.execPath)) ? process.execPath : "node");
export const inline = () => process.env.HERDR_SUPERWORK_INLINE === "1"; // tests: run jobs in this process

// Start a detached runner for one job on one task. Returns at once.
export function spawnRunner(job, id, extra = []) {
  if (inline()) { (globalThis.__swJobs ||= []).push([job, id, extra]); return 0; }
  const env = { ...userEnv() };
  // The runner is not a plugin command: it must not look like one to anything it starts.
  // Nor a worker: a runner started by an agent's own turn-end hook must not inherit that agent's pane.
  for (const k of ["HERDR_PLUGIN_EVENT", "HERDR_PLUGIN_EVENT_JSON", "HERDR_PLUGIN_CONTEXT_JSON", "HERDR_PLUGIN_ENTRYPOINT_ID", "HERDR_PLUGIN_ACTION_ID", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"]) delete env[k];
  fs.mkdirSync(S.dirOf(id), { recursive: true });
  const out = fs.openSync(path.join(S.dirOf(id), "runner.log"), "a");
  const child = spawn(node(), [S.BIN, "run", job, id, ...extra], { detached: true, stdio: ["ignore", out, out], env, cwd: S.dataDir() });
  child.on("error", () => {});
  child.unref();
  fs.closeSync(out);
  return child.pid;
}
// Tests drain the jobs that would have been detached.
export async function drainJobs(run) {
  while (globalThis.__swJobs?.length) { const [job, id, extra] = globalThis.__swJobs.shift(); await run(job, id, extra); }
}

export const runnerAlive = (t) => S.markerAlive(t?.runner);
const others = (t) => !!t.runner && t.runner.pid !== process.pid && S.markerAlive(t.runner);
// Claim a task for this runner. Returns the task, or null when another live runner has it.
export function claim(id, job, patch = {}) {
  let ok = false;
  const t = S.update(id, (t) => {
    if (others(t)) return false;
    ok = true;
    t.runner = S.marker({ job });
    Object.assign(t, typeof patch === "function" ? patch(t) : patch);
  }, { waitMs: 10000 });
  return ok ? t : null;
}
// The one way a marker is given up: one update under the task lock that also looks at the turn-ended events. The
// hook appends under the same lock, so an event is either seen here or finds no marker and starts a runner itself.
// `keep` (the finish runner): with an unhandled event, keep the marker and return true, so the caller processes it.
export function release(id, { keep = false } = {}) {
  let more = false;
  try {
    S.update(id, (t) => {
      if (t.runner?.pid !== process.pid) return false;
      more = S.pendingEvents(t).length > 0;
      if (more && keep) return false;
      t.runner = null;
    }, { waitMs: 10000 });
  } catch {}
  if (more && !keep) spawnRunner("finish", id);
  return more && keep;
}
// "Before every later step it re-reads the task under the lock and aborts if the stage is no longer the one it set
// or armedAt moved." A guard remembers what this runner last set and throws Aborted when the world moved on.
export class Aborted extends Error { constructor(why) { super(why || "aborted"); this.aborted = true; } }
export function guardFor(id) {
  let stages = [], armedAt = null, seen = Infinity;
  // A worker's turn-ended event newer than the ones this runner started with: the human typed in its terminal and
  // that turn ended, so whatever is running (check, review, merge) is about a superseded turn.
  const newTurn = (t) => (t.events || []).some((e) => e.role === "agent" && e.n > seen);
  const g = {
    // Record the stage(s) this runner now stands in.
    expect(t, ...also) { stages = [t.stage, ...also]; armedAt = t.armedAt ?? null; seen = Math.max(t.eventSeq || 0, t.eventsHandled || 0); return t; },
    check() {
      const t = S.get(id);
      if (!t) throw new Aborted("the task is gone");
      if (t.archivedAt) throw new Aborted("archived");
      if (t.runner?.pid !== process.pid) throw new Aborted("another runner took over");
      if (!stages.includes(t.stage)) throw new Aborted(`stage changed to ${t.stage}`);
      if ((t.armedAt ?? null) !== armedAt) throw new Aborted("a new turn started");
      if (newTurn(t)) throw new Aborted("the agent finished a new turn");
      return t;
    },
    // Change the task as this runner, only if it is still ours; remembers the new stage.
    set(fn) {
      const t = S.update(id, (t) => {
        if (t.runner?.pid !== process.pid) throw new Aborted("another runner took over");
        if (!stages.includes(t.stage)) throw new Aborted(`stage changed to ${t.stage}`);
        if ((t.armedAt ?? null) !== armedAt) throw new Aborted("a new turn started");
        return typeof fn === "function" ? fn(t) : fn;
      }, { waitMs: 10000 });
      stages = [t.stage]; armedAt = t.armedAt ?? null;
      return t;
    },
    allow(...more) { stages.push(...more); },
  };
  return g;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A shell command of the repo's own (setup, check, teardown), run through a login shell. Polls `alive` so a runner
// that was superseded kills its check instead of finishing it.
export function sh(cmd, cwd, env = {}, { timeoutMin = 15, alive } = {}) {
  return new Promise((resolve) => {
    let out = "", done = false;
    const child = spawn("sh", ["-lc", cmd], { cwd, env: { ...userEnv(), ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const add = (d) => { out += d; if (out.length > 8 * 1024 * 1024) out = out.slice(-4 * 1024 * 1024); };
    child.stdout.on("data", add); child.stderr.on("data", add);
    const kill = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} } };
    const finish = (ok, why) => { if (done) return; done = true; clearInterval(poll); clearTimeout(limit); resolve({ ok, out: (out + (why ? `\n${why}` : "")).trim(), aborted: why === "aborted" }); };
    const poll = setInterval(() => { try { if (alive && !alive()) { kill(); finish(false, "aborted"); } } catch { kill(); finish(false, "aborted"); } }, 1000);
    const limit = setTimeout(() => { kill(); finish(false, `stopped after ${timeoutMin} minutes`); }, timeoutMin * 60000);
    child.on("error", (e) => finish(false, e.message));
    child.on("close", (code) => finish(code === 0));
  });
}
export const outputOf = (e) => [e.stdout, e.stderr, e.error?.message || (!e.stdout && !e.stderr ? e.message : "")].filter(Boolean).map(String).join("\n").trim();
