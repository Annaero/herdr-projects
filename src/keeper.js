// The keeper: a small always-on background process that does what the open board's tick does, with no screen, so
// the board's information stays fresh and you are alerted with the board closed. One per data folder.
//
// Started detached from herdr's [[startup]] hook, from any herdr hook event and from the board opening, never from an
// agent's own command (so it is never born inside an agent's process group). It looks after this machine's tasks only.
//
// Two processes: the keeper itself only holds the lock, rewrites its heartbeat once a second and watches for an
// update of the plugin; a child does the ticking, so a slow herdr or gh call never stops the heartbeat.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import * as S from "./store.js";
import * as F from "./flow.js";
import { herdr, currentSocket, socketExists } from "./herdr.js";
import { housekeeping, spawnLoose } from "./housekeeping.js";
import { inline, userEnv } from "./runner.js";
import { readTurnOf } from "./agents.js";
import { tick as coordinatorTick, tellSidebar as coordinatorSidebar } from "./coordinator.js";
import { automationsTick } from "./automations/tick.js";
import { limitsTick } from "./limits/tick.js";
import { carryOn } from "./actions/limits.js";

const beatFile = () => path.join(S.dataDir(), "keeper.json");
const log = (msg) => { try { fs.appendFileSync(path.join(S.dataDir(), "keeper.log"), `${new Date().toISOString()} ${process.pid} ${msg}\n`); } catch {} };
// Alive means the heartbeat file is less than five seconds old. Readers never touch the keeper's lock.
export function keeperAlive() { try { return Date.now() - fs.statSync(beatFile()).mtimeMs < 5000; } catch { return false; } }
export function ensureKeeper() {
  if (process.env.HERDR_SUPERWORK_NO_KEEPER === "1" || inline() || keeperAlive()) return false;
  if (!S.due("keeper-start", 4000)) return false; // several hook events at once start one, not five
  spawnLoose(["keeper"]);
  return true;
}
// The newest change under src/: a keeper started from older code hands over to a successor.
export function codeStamp() {
  let newest = 0;
  const walk = (dir) => { for (const n of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, n.name); if (n.isDirectory()) walk(p); else newest = Math.max(newest, fs.statSync(p).mtimeMs); } };
  try { walk(path.join(S.ROOT, "src")); } catch {}
  let version = S.VERSION;
  try { version = JSON.parse(fs.readFileSync(path.join(S.ROOT, "package.json"), "utf8")).version; } catch {}
  return `${version}:${newest}`;
}

export async function keeperMain() {
  if (process.env.HERDR_SUPERWORK_NO_KEEPER === "1") return;
  let unlock;
  try { unlock = S.holdLock("keeper", { waitMs: 10000 }); } catch { return; } // another keeper has it
  userEnv();
  const stamp = codeStamp();
  const info = { pid: process.pid, start: S.procStart(process.pid), version: S.VERSION, started: Date.now() };
  const beat = () => { try { S.writeJson(beatFile(), { ...info, at: Date.now() }); } catch {} };
  beat();
  log(`started (plugin ${S.VERSION})`);
  let child = null, ending = false;
  const work = () => {
    if (ending) return;
    child = spawn(process.execPath, [S.BIN, "keeper-work"], { stdio: ["ignore", "ignore", "ignore"], env: process.env, cwd: S.dataDir() });
    child.on("error", () => {});
    child.on("exit", (code) => { child = null; if (code === 3) return end("herdr is gone"); if (!ending) setTimeout(work, 2000); });
  };
  const end = (why, successor = false) => {
    if (ending) return; ending = true;
    log(`ending: ${why}`);
    try { child?.kill("SIGTERM"); } catch {}
    try { fs.rmSync(beatFile(), { force: true }); } catch {}
    unlock();
    if (successor) spawnLoose(["keeper"]); // it waits up to ten seconds for the lock
    setTimeout(() => process.exit(0), 50);
  };
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => end(sig));
  setInterval(beat, 1000);
  setInterval(() => { try { if (codeStamp() !== stamp) end("the plugin was updated", true); } catch {} }, 5000);
  work();
  await new Promise(() => {});
}

// ---- the tick: what the board's own tick does, once a second ----------------------------------------------------------
// One ticker at a time: whoever ticks takes the short `tick` lock without waiting and skips when it is taken, so
// housekeeping never runs twice at once during a handover between a board and a keeper.
export function tickOnce(socket, { watch } = {}) {
  let rows = null;
  try {
    S.withLock("tick", () => {
      try { if (socket === currentSocket()) automationsTick(); } catch {} // tasks made on a schedule or by a board event (automations/tick.js)
      try { housekeeping(socket); } catch {}
      rows = F.boardFor(socket);
      try { F.syncSidebar(rows, { socket }); } catch {}
      try { refreshSaid(rows.flatMap((t) => [t, ...(t.tries || [])])); } catch {}
      try { limitsTick(rows.flatMap((t) => [t, ...(t.tries || [])]), { carryOn }); } catch {} // a run at its time limit is stopped; a raised limit carries on (limits/tick.js)
      try { coordinatorTick(socket); } catch {}
      try { coordinatorSidebar(socket); } catch {}
    }, { waitMs: 0 });
  } catch (e) { if (e.code !== "BUSY") throw e; }
  if (rows && watch) { try { watch(rows.flatMap((t) => [t, ...(t.tries || [])])); } catch {} } // each attempt of a task has an agent of its own to follow (attempts.js)
  return rows;
}
// While an agent works, its last message is refreshed from the saved conversation, at most once every five seconds.
const saidAt = new Map();
export function refreshSaid(rows, now = Date.now()) {
  for (const t of rows) {
    if (t.stage !== "working" || !F.isAgentTask(t) || t.archivedAt || t.live?.status == null || now - (saidAt.get(t.id) || 0) < 5000) continue;
    saidAt.set(t.id, now);
    const turn = readTurnOf(t.agent, { file: t.transcript || null, session: t.session, cwd: S.cwdOf(t) });
    if (!turn || ((!turn.said || turn.said === t.said) && turn.usage?.context === t.usage?.context)) continue;
    try { S.update(t.id, (c) => { if (c.stage !== "working") return false; if (turn.said) c.said = turn.said; if (turn.usage) c.usage = turn.usage; if (turn.model) c.model = turn.model; }, { waitMs: 300 }); } catch {}
  }
}
export async function keeperWork() {
  const { watchTick } = await import("./helpers.js");
  const fails = new Map(); // socket -> failed calls in a row
  const first = currentSocket();
  for (;;) {
    const sockets = new Set([first, ...S.list().map((t) => t.link?.socket).filter(Boolean)]);
    let live = 0;
    for (const socket of sockets) {
      const ok = socketExists(socket) && herdr(socket).alive();
      fails.set(socket, ok ? 0 : (fails.get(socket) || 0) + 1);
      if ((fails.get(socket) || 0) < 3) live++;
      if (!ok) continue;
      try { tickOnce(socket, { watch: watchTick }); } catch {}
    }
    // The board inside the herdr web UI: its front door is seen to here, every half minute (webui/keep.js).
    if (S.due("front-door", 30000)) { try { (await import("./webui/keep.js")).ensureDoor(); } catch {} }
    if (!live) process.exit(3); // every herdr it knows is gone
    await new Promise((r) => setTimeout(r, 1000));
  }
}
