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
  "pushing", "reviewing", "reviewneeds", "approval", "merging", "failed", "done",
  // Several attempts (src/attempts.js). `attempts`: the task's attempts are under way, each a small task of its own.
  // `pick`: more than one passed the check, and the task waits for you to choose. `tried`: an attempt that passed.
  "attempts", "pick", "tried"];
// A slot is held only while something is actually running; tasks waiting for the human never block the queue.
export const SLOT_STAGES = ["starting", "setup", "working", "checking", "pushing", "reviewing", "merging"];
// Stages owned by a runner (a long job of ours), as opposed to the agent's own turn.
export const RUNNER_STAGES = ["starting", "setup", "checking", "pushing", "reviewing", "merging"];
export const KINDS = ["permission", "question", "auth"];

// Everything the board keeps for a user is in one folder, the same on every machine: ~/.herdr-superwork, with a
// sub-folder for each kind of thing (docs/home-folder.md). HERDR_SUPERWORK_HOME names another one; each sub-folder has
// a variable of its own too. The XDG_* variables no longer choose a place: they only say where an older version kept
// things, for the one-time move (store/move-home.js).
export const HOME_NAME = ".herdr-superwork";
export const homeDir = () => process.env.HERDR_SUPERWORK_HOME || path.join(os.homedir(), HOME_NAME);
export const dataDir = () => process.env.HERDR_SUPERWORK_DATA_DIR || path.join(homeDir(), "data");
export const configDir = () => process.env.HERDR_SUPERWORK_CONFIG_DIR || path.join(homeDir(), "settings");
// Pages and reports an agent makes for the human that belong in no repo.
export const reportsDir = () => process.env.HERDR_SUPERWORK_REPORTS_DIR || path.join(homeDir(), "reports");
// The board's own folders as resolved here, for a process started somewhere that does not inherit this environment
// (an agent's herdr space): both always, since either may come from the home folder rather than its own variable.
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
const busy = (name) => Object.assign(new Error(`${name} is busy with another action. Try again in a moment.`), { code: "BUSY" });
// Takes the lock and returns what lets it go. Tests may keep the locks in their own process (`globalThis.__swLocks`, a
// Set of the files held): starting flock for every change to a task was half of the programs the suite started.
function takeLock(name, file, waitMs) {
  const own = globalThis.__swLocks;
  if (own) { if (own.has(file)) throw busy(name); own.add(file); return () => own.delete(file); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const until = Date.now() + Math.max(0, waitMs);
  for (;;) {
    const fd = fs.openSync(file, "a");
    try {
      let lock;
      for (;;) {
        lock = spawnSync("flock", ["--exclusive", "--nonblock", "3"], { stdio: ["ignore", "pipe", "pipe", fd], timeout: 5000 });
        if (lock.status !== 1 || Date.now() >= until || !sameFile(fd, file)) break;
        sleepSync(15);
      }
      if (lock.error?.code === "ENOENT") throw new Error("herdr-superwork needs flock (util-linux) to change tasks safely.");
      if (lock.status === 1 && !sameFile(fd, file) && Date.now() < until) { fs.closeSync(fd); continue; } // busy, and no longer the file at this path: the real one is asked for
      if (lock.status === 1) throw busy(name);
      if (lock.status !== 0) throw new Error(`Could not lock ${name}: ${lock.error?.message || String(lock.stderr || "").trim()}`);
      // The file was opened before it was locked. If another file took its place at this path in between (the
      // one-time move puts two folders of locks together), what is held is a lock nobody else will ever ask for:
      // let go of it and take the one that is there now.
      if (!sameFile(fd, file)) { fs.closeSync(fd); continue; }
      return () => fs.closeSync(fd);
    } catch (e) { try { fs.closeSync(fd); } catch {} throw e; }
  }
}
const sameFile = (fd, file) => { try { const a = fs.fstatSync(fd), b = fs.statSync(file); return a.ino === b.ino && a.dev === b.dev; } catch { return false; } };
export function withLock(name, fn, { waitMs = 2000 } = {}) {
  const file = lockFile(name);
  if (held.has(file)) return fn(); // nested in this process
  const free = takeLock(name, file, waitMs);
  held.add(file);
  try { return fn(); } finally { held.delete(file); free(); }
}
// A lock held until the returned function is called, or the process ends (the keeper holds one for its whole life).
export function holdLock(name, { waitMs = 2000 } = {}) {
  const free = takeLock(name, lockFile(name), waitMs);
  return () => { try { free(); } catch {} };
}
const taskKey = (id) => String(id).split("/").slice(0, 2).join("/");
export const withTaskLock = (id, fn, opts) => withLock(`task:${taskKey(id)}`, fn, opts);
