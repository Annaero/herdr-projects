// Tasks on disk, locks and settings. No herdr calls here: this file only knows files.
//
// One folder per task: <data>/tasks/<repo>/<n>/ holding task.json, inbox.jsonl and artifacts/.
// task.json is the whole truth the plugin owns about a task; what herdr knows (agent status) is read live.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { GATES, DEFAULT_GATE, gateOfAuto, isTagged } from "./gate.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const tasksDir = () => path.join(dataDir(), "tasks");
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

// ---- settings: two places, no more ---------------------------------------------------------------------------------
// 1. Your own preferences: <config dir>/config.json.
export const DEFAULTS = {
  agent: "claude",        // the working agent: any `herdr agent start --kind` value
  model: "", effort: "",
  reviewer: "codex",      // the reviewer's agent kind; "off" for no review
  reviewerModel: "", reviewerEffort: "",
  coordinator: "claude",  // who runs the natural-language box: its own choice, as the agent's is; "off" for none
  coordinatorModel: "", coordinatorEffort: "",
  watcherAgent: "claude", // the Watcher: a small model behind the "doing now" line; any kind with a one-shot entry in agents.js
  watcherModel: "claude-haiku-5-5",
  watcher: "on",          // "off": no status line, no progress guess and no minutes left
  review: "repos",        // what gets reviewed when finished: "repos", "all" or "none"
  artifacts: true,        // the reviewer brings evidence: screenshots, a recording, a link, test output
  serve: "tailscale",     // how review pages are linked: "tailscale" (private tailnet link) or "local"
  gate: DEFAULT_GATE,     // what a review must clear: "critical", "major", "minor" or "trivial" (a finding that bad or worse goes straight back to the agent and holds a merge), or "off" (nothing goes back by itself)
  rounds: 3,              // how many times they may go back and forth by themselves
  worktree: "auto",       // "none": agents work in your checkout
  base: "fresh",          // "head": worktrees start from your current commit
  pr: true,               // push the branch and open a draft pull request after the check passes
  merge: "squash",        // how approved work lands: squash, merge or rebase
  cleanup: true,          // remove a done task's space, worktree and branch
  machines: "auto",       // other machines: "auto" (herdr's saved machines), names ("exedev@vm-a, vm-b") or "off"
  remoteUser: "",
  max: 4,                 // agents working at once
  skill: true,            // write a small how-to into each installed agent program's own skills folder, so any chat knows the board
  theme: "auto",          // the board's colours are herdr's: "auto" (the theme set in herdr's config here, else the terminal's colours), "herdr" (herdr's config exactly, its default included), "terminal", or herdr's "dark" or "light" theme
  ownTerminal: true,      // the board's terminal has the size of its herdr pane: another viewer attached straight to it is disconnected
  trust: true,            // mark a new task's repo as trusted in the agent's own settings, so no dialog blocks the start
  agentArgs: {},          // per agent kind: extra arguments after `--` for `herdr agent start`; replaces the built-in default
};
export const TASK_DEFAULTS = { conflictAuto: true }; // per task only. A conflict with main goes back to the task's agent by itself.
const REVIEW_WORDS = { repos: "repos", repo: "repos", true: "repos", on: "repos", yes: "repos", all: "all", always: "all", everything: "all", none: "none", off: "none", false: "none", no: "none", never: "none" };
function coerce(key, value) {
  const shape = key in TASK_DEFAULTS ? TASK_DEFAULTS[key] : DEFAULTS[key];
  let v = value;
  if (key === "agentArgs") {
    if (typeof value === "string") { try { v = JSON.parse(value); } catch { throw new Error('agentArgs must be JSON, for example {"claude":["--dangerously-skip-permissions"]}'); } }
    if (!v || typeof v !== "object" || Array.isArray(v) || !Object.values(v).every((a) => Array.isArray(a) && a.every((x) => typeof x === "string"))) throw new Error("agentArgs must map an agent kind to a list of arguments");
    return v;
  }
  if (typeof shape === "boolean") v = value === true || ["true", "on", "yes", "auto"].includes(String(value).toLowerCase());
  else if (typeof shape === "number") { v = Math.round(Number(value)); if (!(v >= 1)) throw new Error(`${key} must be a whole number, 1 or more`); }
  else {
    v = String(value ?? "").trim();
    if (v.toLowerCase() === "default") v = "";
    if (key === "reviewer") v = ["false", "off", "no", "none"].includes(v.toLowerCase()) ? "off" : v.toLowerCase();
    if (key === "watcher") v = ["false", "off", "no", "none"].includes(v.toLowerCase()) ? "off" : "on";
    if (key === "gate" && v) { v = v.toLowerCase(); if (["false", "no", "none", "manual"].includes(v)) v = "off"; if (!GATES.includes(v)) throw new Error(`gate must be ${GATES.slice(0, -1).join(", ")} or off`); }
    if (key === "theme") { v = v.toLowerCase() || "auto"; if (!["auto", "herdr", "terminal", "dark", "light"].includes(v)) throw new Error("theme must be auto, herdr, terminal, dark or light"); }
    if (["agent", "coordinator", "watcherAgent"].includes(key)) { v = v.toLowerCase(); if (v && !/^[a-z][a-z0-9_-]*$/.test(v)) throw new Error(`${key} must be an agent kind such as claude or codex`); }
  }
  if (key === "review") { v = REVIEW_WORDS[String(value).trim().toLowerCase()]; if (!v) throw new Error("review must be repos, all or none"); }
  if (key === "worktree" && !["auto", "none"].includes(v)) throw new Error("worktree must be auto or none");
  if (key === "base" && !["fresh", "head"].includes(v)) throw new Error("base must be fresh or head");
  if (key === "merge" && !["squash", "merge", "rebase"].includes(v)) throw new Error("merge must be squash, merge or rebase");
  if (key === "serve") { v = String(v).toLowerCase(); if (!["local", "tailscale"].includes(v)) throw new Error("serve must be local or tailscale"); }
  return v;
}
const configFile = () => path.join(configDir(), "config.json");
// `helper` and `helperModel` were the Watcher's settings before the Coordinator existed: an existing file keeps working.
const ALIAS = { helper: "watcherAgent", helperModel: "watcherModel" };
export const config = () => {
  const file = readJson(configFile()) || {};
  const c = { ...DEFAULTS, ...file };
  delete c.bell; // a setting of older versions: nothing rings any more
  for (const [old, now] of Object.entries(ALIAS)) { if (file[old] !== undefined && file[now] === undefined) c[now] = file[old]; delete c[old]; }
  c.review = REVIEW_WORDS[String(c.review)] || "repos";
  // `reviewAuto` (true or false) was the setting before the gate: a file that still has it behaves as it did.
  if (file.gate === undefined && file.reviewAuto !== undefined) c.gate = gateOfAuto(file.reviewAuto);
  delete c.reviewAuto;
  if (!GATES.includes(c.gate)) c.gate = DEFAULT_GATE;
  return c;
};
const isReset = (value) => ["", "default"].includes(String(value ?? "").trim().toLowerCase());
// The old name still sets the gate: true is the default gate, false is "off".
const gateKey = (key, value) => (key === "reviewAuto" ? ["gate", isReset(value) ? "" : gateOfAuto(value)] : [key, value]);
export function setConfig(key, value) {
  [key, value] = gateKey(ALIAS[key] || key, value);
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting "${key}". Settings: ${Object.keys(DEFAULTS).join(", ")}`);
  const now = { ...(readJson(configFile()) || {}) };
  const v = coerce(key, value);
  if (isReset(value)) delete now[key]; else now[key] = v;
  if (key === "gate") delete now.reviewAuto;
  writeJson(configFile(), now);
  return config();
}
// Who does the work and how the review loop runs can also be chosen for one task. That wins over your default.
export const PER_TASK = ["agent", "model", "effort", "reviewer", "reviewerModel", "reviewerEffort", "watcher", "review", "gate", "rounds", "artifacts", "serve", "conflictAuto"];
export function setTaskConfig(id, key, value) {
  [key, value] = gateKey(key, value);
  if (!PER_TASK.includes(key)) throw new Error(`Per task you can set: ${PER_TASK.join(", ")}. Other settings are yours as a whole.`);
  const reset = isReset(value);
  const t = update(id, (t) => { assertUnarchived(t); t.own = { ...(t.own || {}) }; if (reset) delete t.own[key]; else t.own[key] = coerce(key, value); if (key === "gate") delete t.own.reviewAuto; });
  return choices(t);
}
export function choices(t) {
  const c = config(), own = t?.own || {};
  const out = {};
  for (const k of PER_TASK) out[k] = own[k] !== undefined && own[k] !== null ? own[k] : k in TASK_DEFAULTS ? TASK_DEFAULTS[k] : c[k];
  if ((own.gate === undefined || own.gate === null) && own.reviewAuto !== undefined && own.reviewAuto !== null) out.gate = gateOfAuto(own.reviewAuto); // a task's own choice from before the gate
  if (out.reviewer === "off") out.review = "none"; // no reviewer is no review
  return out;
}
// 2. Facts about a repo: .herdr-superwork.json, committed in that repo. Read from the commit a worktree starts
//    from, so an agent's own branch cannot change the rules it is checked by.
export const REPO_FILE = ".herdr-superwork.json";
export function repoConfig(root, ref) {
  let text = "";
  try { text = ref ? gitOut(root, ["show", `${ref}:${REPO_FILE}`]) : fs.readFileSync(path.join(root, REPO_FILE), "utf8"); } catch {}
  if (!text) return {};
  try {
    const j = JSON.parse(text);
    return { setup: String(j.setup || ""), check: String(j.check || ""), land: j.land === "auto" ? "auto" : "ask", teardown: String(j.teardown || ""), include: Array.isArray(j.include) ? j.include.map(String) : [] };
  } catch { return {}; }
}

// ---- git plumbing ---------------------------------------------------------------------------------------------------
export const gitOut = (cwd, args, opts = {}) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
export function gitRoot(folder) { for (let d = path.resolve(folder); ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, ".git"))) return d; if (d === path.dirname(d)) return path.resolve(folder); } }
// The primary checkout of a folder: for a linked worktree, the repo it belongs to.
export function primaryRoot(folder) {
  const root = gitRoot(folder);
  try {
    if (fs.statSync(path.join(root, ".git")).isFile()) {
      const common = gitOut(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      if (path.basename(common) === ".git") return path.dirname(common);
    }
  } catch {}
  return root;
}
export const isRepo = (folder) => fs.existsSync(path.join(gitRoot(folder), ".git"));
export function canWorktree(folder) { try { return fs.statSync(path.join(gitRoot(folder), ".git")).isDirectory(); } catch { return false; } }
export function branchOf(folder) {
  try {
    let git = path.join(folder, ".git");
    if (fs.statSync(git).isFile()) git = path.resolve(folder, fs.readFileSync(git, "utf8").replace(/^gitdir:\s*/, "").trim());
    const head = fs.readFileSync(path.join(git, "HEAD"), "utf8").trim();
    return head.startsWith("ref: refs/heads/") ? head.slice(16) : head.slice(0, 8);
  } catch { return ""; }
}

// ---- repos: the first part of a task's id ---------------------------------------------------------------------------
const reposFile = () => path.join(dataDir(), "repos.json");
export const knownRepos = () => readJson(reposFile(), {});
export function repoOf(folder) {
  const root = primaryRoot(folder);
  return withLock("repos", () => {
    const map = knownRepos();
    const real = (d) => { try { return fs.realpathSync(d); } catch { return d; } };
    let name = Object.keys(map).find((k) => map[k] === root || real(map[k]) === real(root));
    if (!name) {
      const base = path.basename(root).replace(/[^A-Za-z0-9_.+-]/g, "-").slice(0, 28) || "home";
      name = base;
      for (let n = 2; map[name] || name === "dispatch"; n++) name = `${base}-${n}`;
      map[name] = root; writeJson(reposFile(), map);
    }
    return { name, root };
  });
}
export const folderOf = (id) => knownRepos()[String(id).split("/")[0]] || os.homedir();
// Where a task's agent runs: its worktree when it has one, else the repo folder.
export const cwdOf = (t) => (t.worktree && fs.existsSync(t.worktree) ? t.worktree : folderOf(t.id));
// A repo given by its name on the board, or by a folder path ("~" is your home folder).
export function folderFor(ref, fallback) {
  const want = String(ref || "").trim();
  if (!want) return fallback;
  const map = knownRepos();
  const byName = Object.keys(map).find((k) => k.toLowerCase() === want.toLowerCase());
  if (byName) return map[byName];
  const dir = path.resolve(want.replace(/^~(?=\/|$)/, os.homedir()));
  if ((want.startsWith("/") || want.startsWith("~") || want.startsWith(".")) && fs.existsSync(dir)) return dir;
  for (const base of [...new Set([...Object.values(map).map((p) => path.dirname(p)), path.dirname(fallback || os.homedir()), path.join(os.homedir(), "dev"), os.homedir()])]) {
    const guess = path.join(base, want);
    if (fs.existsSync(guess) && fs.statSync(guess).isDirectory()) return guess;
  }
  throw new Error(`No repo or folder "${want}". Known repos: ${Object.keys(map).join(", ") || "none yet"}. A full path works too.`);
}

// ---- tasks ----------------------------------------------------------------------------------------------------------
const SEGMENT = /^[A-Za-z0-9_.+-]{1,32}$/;
// Minutes left, as the Watcher or a report gave them: a whole number from 0 up, or undefined when none was given.
export const minutes = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? undefined : Math.max(0, Math.min(99999, Math.round(Number(v)))));
export const oneLine = (text, max = 2048) => { let t = String(text ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim(); while (Buffer.byteLength(t, "utf8") > max) t = t.slice(0, -1); return t; };
const taskFile = (id) => path.join(dirOf(id), "task.json");
export function get(id) {
  const t = readJson(taskFile(id));
  return t && t.id ? t : null;
}
export function list({ includeArchived = false, archived = false } = {}) {
  const out = [];
  let repos = [];
  try { repos = fs.readdirSync(tasksDir()); } catch {}
  for (const repo of repos) {
    let ns = [];
    try { ns = fs.readdirSync(path.join(tasksDir(), repo)); } catch { continue; }
    for (const n of ns) {
      if (!/^\d+$/.test(n)) continue;
      const t = get(`${repo}/${n}`);
      if (!t) continue;
      if (archived ? !t.archivedAt : t.archivedAt && !includeArchived) continue;
      out.push(t);
    }
  }
  return out.sort((a, b) => (b.created || 0) - (a.created || 0));
}
export function find(ref) {
  const s = String(ref || "").trim();
  const hit = (/^[^/]+\/\d+$/.test(s) && get(s)) || list({ includeArchived: true }).find((t) => t.id.toLowerCase() === s.toLowerCase() || String(t.n) === s);
  if (!hit) throw new Error(`No task ${ref}`);
  return hit;
}
export function assertUnarchived(t) { if (t.archivedAt) throw new Error(`${t.id} is archived. Restore it before making changes.`); }
// The one way a task changes: a short read-modify-write under its lock. `fn` may mutate the task or return a patch.
// Never held across a check, a review or a herdr call.
export function update(id, fn, opts) {
  return withTaskLock(id, () => {
    const t = get(id);
    if (!t) throw new Error(`No task ${id}`);
    const before = t.stage;
    const patch = typeof fn === "function" ? fn(t) : fn;
    if (patch === false) return t; // nothing to write
    if (patch && typeof patch === "object") Object.assign(t, patch);
    if (t.stage !== before) { t.at = Date.now(); if (!STAGES.includes(t.stage)) throw new Error(`Unknown stage ${t.stage}`); }
    writeJson(taskFile(id), t);
    return t;
  }, opts);
}
export function create(folder, title, extra = {}) {
  const { name, root } = repoOf(folder);
  const text = oneLine(title, 192);
  if (!text) throw new Error("A task needs a title.");
  return withLock(`seq:${name}`, () => {
    const seq = path.join(tasksDir(), name, "seq");
    const n = (Number(readJson(seq, 0)) || 0) + 1;
    writeJson(seq, n);
    const now = Date.now();
    const t = { id: `${name}/${n}`, repo: name, n, root, title: text, description: String(extra.description || "").trim(), owner: extra.owner || me(), app: null,
      stage: "todo", msg: "", created: now, at: now, pinned: false, archivedAt: null, own: {} };
    writeJson(taskFile(t.id), t);
    return t;
  });
}
export function remove(id) { fs.rmSync(dirOf(id), { recursive: true, force: true }); }

// ---- the inbox: text for an agent that could not be delivered yet. Never dropped. ----------------------------------
const inboxFile = (id) => path.join(dirOf(id), "inbox.jsonl");
export function queueText(id, text, extra = {}) { appendLine(inboxFile(id), { text: String(text), at: Date.now(), ...extra }); }
export function pendingText(id) {
  const all = readLines(inboxFile(id));
  const off = Number(readJson(path.join(dirOf(id), "inbox.offset"), 0)) || 0;
  return all.slice(off);
}
export function takeText(id) {
  const all = readLines(inboxFile(id));
  const off = Number(readJson(path.join(dirOf(id), "inbox.offset"), 0)) || 0;
  writeJson(path.join(dirOf(id), "inbox.offset"), all.length);
  return all.slice(off);
}
// Put taken text back (the delivery failed after all).
export function untakeText(id, count) {
  const file = path.join(dirOf(id), "inbox.offset");
  writeJson(file, Math.max(0, (Number(readJson(file, 0)) || 0) - count));
}

// ---- dispatcher instructions: siblings of the tasks on disk, so a running or failed one survives the board ---------
const dispatchDir = () => path.join(dataDir(), "dispatch");
export function newDispatch(text, extra = {}) {
  return withLock("seq:dispatch", () => {
    const seq = path.join(dispatchDir(), "seq");
    const n = (Number(readJson(seq, 0)) || 0) + 1;
    writeJson(seq, n);
    const d = { id: `dispatch/${n}`, n, text: String(text), state: "working", msg: "", created: Date.now(), ...extra };
    writeJson(path.join(dispatchDir(), `${n}.json`), d);
    return d;
  });
}
export const getDispatch = (id) => readJson(path.join(dispatchDir(), `${String(id).split("/").pop()}.json`));
export function setDispatch(id, patch) { const d = getDispatch(id); if (!d) return null; const next = { ...d, ...patch }; writeJson(path.join(dispatchDir(), `${d.n}.json`), next); return next; }
export function clearDispatch(id) { fs.rmSync(path.join(dispatchDir(), `${String(id).split("/").pop()}.json`), { force: true }); }
export function dispatches() {
  let names = [];
  try { names = fs.readdirSync(dispatchDir()).filter((f) => /^\d+\.json$/.test(f)); } catch {}
  const out = names.map((f) => readJson(path.join(dispatchDir(), f))).filter(Boolean).sort((a, b) => a.n - b.n);
  // A working one whose helper process is gone did not finish: say so instead of spinning forever.
  for (const d of out) if (d.state === "working" && d.pid && !markerAlive({ pid: d.pid, start: d.pidStart }) && Date.now() - d.created > 3000) Object.assign(d, setDispatch(d.id, { state: "error", msg: d.msg || "stopped before it finished" }));
  return out;
}

// ---- failures: workflow diagnostics live beside the task, not in its one-line message ------------------------------
// Require a login/credential diagnostic, not filenames, variable names or status numbers alone.
const AUTH = /^\s*(?:(?:fatal|error|api error|graphql):\s*)?(?:HTTP(?:\/\d(?:\.\d)?)?\s+(?:401|403)\s*:?\s*)?(?:unauthori[sz]ed|forbidden)[.!]?\s*$|\b(?:not (?:logged|signed) in|log ?in required|authentication (?:failed|required|error)|failed to authenticate|could not read Username|terminal prompts disabled)\b|\b(?:missing|invalid|expired|bad)\s+(?:credentials?|token|api[ _-]?key)\b|\b(?:credentials?|token|api[ _-]?key)\s+(?:(?:is|has|was)\s+)?(?:missing|invalid|expired|required)\b/i;
export function isAuthFailure(text) {
  return stripVTControlCharacters(String(text || "")).split(/\r?\n/).some((line) => {
    if (/^\s*(?:#\s*(?:Subtest|Suite):|(?:ok|not ok)\s+\d+\b|[✔✖✓✗▶ℹ])/.test(line)) return false; // reporter titles are data
    if (/\bAssertionError\b|\bexpected\b.*\b(?:received|got|actual)\b|^\s*(?:expected|actual|received|FAIL|not ok)\b/i.test(line)) return false;
    if (/^\s*(?:[+-](?:\s|$)|at\s|['"`]|\/\/|\/\*|(?:const|let|var|function|class|return|throw|assert|expect)\b)/.test(line)) return false;
    if (/^\s*(?:\[[^\]]+\]|.*\.[cm]?[jt]sx?):\d+(?::\d+)?\s*$/.test(line)) return false;
    const match = AUTH.exec(line);
    return !!match && !/['"`]/.test(line.slice(0, match.index));
  });
}
export function boundDetail(detail) {
  const d = String(detail || "");
  return d.length > 65536 ? d.slice(0, 32768) + "\n… output truncated …\n" + d.slice(-32768) : d;
}
// A patch that records a failure on a task. `auth` failures are the human's to fix.
export function failurePatch(failure) {
  const auth = failure.auth === true || (failure.auth !== false && isAuthFailure(failure.detail));
  return { failure: { ...failure, auth, detail: boundDetail(failure.detail), agentCanFix: auth ? false : failure.agentCanFix !== false,
    next: auth ? "Fix the login or credential, then tell the agent to continue." : failure.next, at: Date.now(), sentAt: null } };
}
// Keep findings and evidence for reference, but a verdict stops describing the work once it resumes.
export const currentReview = (t) => (t?.review?.stale ? null : t?.review);
// Which review a task is on: 1 for its first, counted up each time a reviewer starts on it. "" before any review.
export const reviewRound = (t) => Math.max(0, Math.floor(Number(t?.reviewRound) || 0));
// Every review a task has had, oldest first: which one it was, how it came out, what it found, its short summary.
// A review that failed is kept too, with why. Nothing is ever dropped from the list. A review from before the gate
// keeps its score and its advice as they were.
const reviewEntry = (rv, round, at) => ({ round, at, ...(rv.error ? { error: oneLine(rv.error, 400) }
  : { ...(isTagged(rv) ? { meets: rv.meets, findings: rv.findings, gate: rv.gate, pass: rv.pass, left: rv.left || 0 } : { score: rv.score, recommend: rv.recommend, problems: rv.problems || [] }), text: rv.text, checks: rv.checks || [], limitations: rv.limitations || [], head: rv.head || null }) });
// The one review saved on a task from before the list existed. `round`: which review it was.
const savedReview = (t, round) => (t?.review && (Number.isInteger(t.review.score) || isTagged(t.review)) ? [reviewEntry(t.review, Math.max(1, round), t.review.at)] : []);
// A review saved before the list existed has no number of its own: it is the one the counter stands at. So it is
// put on the list, under that number, before the counter moves for the next review: a later review that is stopped
// half way can then never shift it to a wrong number.
export function keepSavedReview(t) {
  if (Array.isArray(t.reviews) && t.reviews.length) return;
  const had = savedReview(t, reviewRound(t));
  if (had.length) t.reviews = had;
}
// Called once the new review's number is on the task (after `keepSavedReview`, when that review started).
export function logReview(t, rv) {
  const round = reviewRound(t) || 1;
  const had = Array.isArray(t.reviews) && t.reviews.length ? t.reviews : savedReview(t, round - 1);
  t.reviews = [...had, reviewEntry(rv, round, Date.now())];
}
export function reviewHistory(t) {
  return Array.isArray(t?.reviews) && t.reviews.length ? t.reviews : savedReview(t, reviewRound(t));
}
export const reviewLabel = (t) => (reviewRound(t) ? `review ${reviewRound(t)}` : "");

// ---- view preferences and small shared files -------------------------------------------------------------------------
export const stampFile = (name) => path.join(dataDir(), "stamps", name);
// True at most once per `ms` across all processes: the housekeeping pass rides on every hook run and board tick.
export function due(name, ms) {
  const file = stampFile(name);
  let last = 0;
  try { last = fs.statSync(file).mtimeMs; } catch {}
  if (Date.now() - last < ms) return false;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, String(process.pid)); } catch {}
  return true;
}
export const tilde = (p) => (p === os.homedir() ? "~" : String(p).startsWith(os.homedir() + "/") ? "~" + String(p).slice(os.homedir().length) : String(p));

// ---- per-launch hook tokens: beside the task, never in its record, so no listing, snapshot or log prints them --------
const tokensFile = (id) => path.join(dirOf(id), "tokens.json");
export function setToken(id, role, token, round = 0) {
  const j = readJson(tokensFile(id), {}) || {};
  if (role === "reviewer") j.reviewer = { ...(j.reviewer || {}), [round]: token }; else j.agent = token;
  fs.mkdirSync(dirOf(id), { recursive: true });
  fs.writeFileSync(tokensFile(id), JSON.stringify(j), { mode: 0o600 });
}
export function tokenOk(id, role, token, round = 0) {
  const j = readJson(tokensFile(id), {}) || {};
  const want = role === "reviewer" ? j.reviewer?.[round] : j.agent;
  return !!want && !!token && want === token;
}
// ---- turn-ended events: appended by the agent's own hook, judged only by the finish runner ---------------------------
export const pendingEvents = (t) => (t?.events || []).filter((e) => e.n > (t.eventsHandled || 0));
// ---- marks: "this kind's hook (or reader) does not work on this machine", valid for one program and plugin version ---
const marksFile = () => path.join(dataDir(), "marks.json");
export function mark(name, version) { const m = readJson(marksFile(), {}) || {}; const k = m[name]; return k && k.set && k.program === version && k.plugin === VERSION ? k : null; }
// Count one more turn in a row (or reset with ok = true). Returns true when the mark was set just now.
export function countMark(name, version, ok) {
  return withLock("marks", () => {
    const m = readJson(marksFile(), {}) || {};
    const k = m[name] && m[name].program === version && m[name].plugin === VERSION ? m[name] : { program: version, plugin: VERSION, n: 0, set: false };
    if (ok) { if (!k.n && !k.set) return false; k.n = 0; k.set = false; m[name] = k; writeJson(marksFile(), m); return false; }
    k.n += 1;
    const now = !k.set && k.n >= 3;
    if (now) k.set = true;
    m[name] = k; writeJson(marksFile(), m);
    return now;
  });
}
