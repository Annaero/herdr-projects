// Where the board keeps things, reading and writing files, and locks.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BIN = path.join(ROOT, "bin", "herdr-superwork.js");
export const PLUGIN_ID = "herdr-superwork";

// Every stage a task can be in. The board's five states are derived from these in state.js.
export const STAGES = ["todo", "progress", "queued", "starting", "setup", "working", "stopped", "nosummary", "asks", "checking",
  "pushing", "reviewing", "reviewneeds", "approval", "merging", "failed", "done"];
// A slot is held only while something is actually running; tasks waiting for the human never block the queue.
export const SLOT_STAGES = ["starting", "setup", "working", "checking", "pushing", "reviewing", "merging"];
// Stages owned by a runner (a long job of ours), as opposed to the agent's own turn.
export const RUNNER_STAGES = ["starting", "setup", "checking", "pushing", "reviewing", "merging"];
export const KINDS = ["permission", "question", "auth"];

export function dataDir() {
  if (process.env.HERDR_SUPERWORK_DATA_DIR) return process.env.HERDR_SUPERWORK_DATA_DIR;
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "herdr-superwork");
}
export function configDir() {
  if (process.env.HERDR_SUPERWORK_CONFIG_DIR) return process.env.HERDR_SUPERWORK_CONFIG_DIR;
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "herdr-superwork");
}
// The board's own folders as resolved here, for a process started somewhere that does not inherit this environment
// (an agent's herdr space): both always, since either may come from XDG_* or the home folder rather than its variable.
export const boardEnv = () => ({ HERDR_SUPERWORK_DATA_DIR: path.resolve(dataDir()), HERDR_SUPERWORK_CONFIG_DIR: path.resolve(configDir()) });
export const tasksDir = () => path.join(dataDir(), "tasks");
export const hasTasks = () => fs.existsSync(tasksDir());
export const dirOf = (id) => path.join(tasksDir(), ...String(id).split("/"));
export const artifactsDir = (id) => path.join(dirOf(id), "artifacts");
export const me = () => os.userInfo().username.replace(/[^A-Za-z0-9_.+-]/g, "").slice(0, 32) || "you";

export function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
export function appendLine(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(value) + "\n"); }
export function readLines(file) { try { return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } }
export const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export const pidAlive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// A process marker is a pid plus that process's start time, so a pid reused after a reboot is not mistaken for it.
export const procStart = (pid) => { try { const s = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); return s.slice(s.lastIndexOf(")") + 2).split(" ")[19]; } catch { return null; } };
export const marker = (extra = {}) => ({ pid: process.pid, start: procStart(process.pid), started: Date.now(), ...extra });
export const markerAlive = (m) => !!m?.pid && pidAlive(m.pid) && (!m.start || procStart(m.pid) === m.start);
export const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version; } catch { return "0"; } })();

// ---- locks -------------------------------------------------------------------------------------------------------
// One kernel lock per name (flock). This process keeps the descriptor, so it owns the lock after the helper exits;
// the kernel releases it when the process ends or crashes, so there are no stale owners to repair.
const held = new Set();
const lockFile = (name) => path.join(dataDir(), "locks", `${Buffer.from(String(name)).toString("base64url")}.lock`);
function takeLock(name, file, waitMs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "a");
  try {
    const until = Date.now() + Math.max(0, waitMs);
    let lock;
    for (;;) {
      lock = spawnSync("flock", ["--exclusive", "--nonblock", "3"], { stdio: ["ignore", "pipe", "pipe", fd], timeout: 5000 });
      if (lock.status !== 1 || Date.now() >= until) break;
      sleepSync(15);
    }
    if (lock.error?.code === "ENOENT") throw new Error("herdr-superwork needs flock (util-linux) to change tasks safely.");
    if (lock.status === 1) throw Object.assign(new Error(`${name} is busy with another action. Try again in a moment.`), { code: "BUSY" });
    if (lock.status !== 0) throw new Error(`Could not lock ${name}: ${lock.error?.message || String(lock.stderr || "").trim()}`);
    return fd;
  } catch (e) { fs.closeSync(fd); throw e; }
}
export function withLock(name, fn, { waitMs = 2000 } = {}) {
  const file = lockFile(name);
  if (held.has(file)) return fn(); // nested in this process
  const fd = takeLock(name, file, waitMs);
  held.add(file);
  try { return fn(); } finally { held.delete(file); fs.closeSync(fd); }
}
// A lock held until the returned function is called, or the process ends (the keeper holds one for its whole life).
export function holdLock(name, { waitMs = 2000 } = {}) {
  const fd = takeLock(name, lockFile(name), waitMs);
  return () => { try { fs.closeSync(fd); } catch {} };
}
const taskKey = (id) => String(id).split("/").slice(0, 2).join("/");
export const withTaskLock = (id, fn, opts) => withLock(`task:${taskKey(id)}`, fn, opts);
