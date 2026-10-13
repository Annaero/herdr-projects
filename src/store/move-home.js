// The one-time move into the one home folder: what an older version kept in ~/.local/state, ~/.config and
// ~/.local/share is moved into ~/.herdr-superwork by the first run of this code, by itself, and each old place
// becomes a link to the new one, so whatever still runs from the old paths (a board, the keeper, agents and their
// command, the Coordinator in its folder) carries on with the same files. docs/home-folder.md has the whole story.
//
// Every step is whole or not done, so a run that is cut off is finished by the next one and a second run finds
// nothing to do; and no step leaves an old path missing, not for a moment. No data is deleted or written over:
// where both places hold a file, the newer one stays in use and the other is set aside.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { BIN, HOME_NAME, readJson, writeJson, marker, markerAlive, sleepSync } from "./files.js";

const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const link = (target, at) => fs.symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");
const short = (p, home) => (p === home ? "~" : p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p);

// What is moved, from where to where. The old places followed the XDG_* variables, which is all those still do.
// `key`: the variable that names this folder outright; a folder chosen that way is the user's and stays where it is.
export function movePlan({ home = os.homedir(), env = process.env } = {}) {
  const to = env.HERDR_SUPERWORK_HOME || path.join(home, HOME_NAME);
  const old = (xdg, ...rest) => path.join(env[xdg] || path.join(home, ...rest), "herdr-superwork");
  return {
    home: to, file: path.join(to, "moved.json"), aside: path.join(to, "set-aside"),
    parts: [
      { what: "data", from: old("XDG_STATE_HOME", ".local", "state"), to: path.join(to, "data"), key: "HERDR_SUPERWORK_DATA_DIR" },
      { what: "settings", from: old("XDG_CONFIG_HOME", ".config"), to: path.join(to, "settings"), key: "HERDR_SUPERWORK_CONFIG_DIR" },
      { what: "reports", from: `${old("XDG_DATA_HOME", ".local", "share")}-reports`, to: path.join(to, "reports"), key: "HERDR_SUPERWORK_REPORTS_DIR" },
    ],
  };
}
// Not this copy's board to move. The old data folder's command names another copy of this code that is still there
// (the installed one), or this copy is a linked git worktree (where a task's agent works on this very code, and its
// reviewer tries it): only the copy the board runs from moves the board's files.
const linkedWorktree = (bin) => { try { return fs.statSync(path.join(path.dirname(path.dirname(bin)), ".git")).isFile(); } catch { return false; } };
function othersBoard(p, bin, linked = linkedWorktree(bin)) {
  if (linked) return true;
  let text = "";
  try { text = fs.readFileSync(path.join(p.parts[0].from, "bin", "herdr-superwork"), "utf8"); } catch { return false; }
  const m = /^exec node '(.*)' "\$@"$/m.exec(text);
  const named = m ? m[1].replace(/'\\''/g, "'") : "";
  return !!named && fs.existsSync(named) && real(named) !== real(bin);
}
// A free name in the set-aside folder: nothing put there is ever written over either.
function free(file) {
  if (!lstat(file)) return file;
  for (let n = 2; ; n++) if (!lstat(`${file}.${n}`)) return `${file}.${n}`;
}
// Takes a lock file for a moment (flock, as files.js takes them). Returns what lets it go, or null when a running
// process holds it.
function grabNow(file) {
  let fd;
  try { fd = fs.openSync(file, "r"); } catch { return () => {}; }
  let ok = false;
  try { ok = spawnSync("flock", ["--exclusive", "--nonblock", "3"], { stdio: ["ignore", "ignore", "ignore", fd], timeout: 5000 }).status === 0; } catch {}
  if (!ok) { fs.closeSync(fd); return null; }
  return () => fs.closeSync(fd);
}
const isLock = (file) => file.endsWith(".lock") && path.basename(path.dirname(file)) === "locks";
// Kept, never deleted: a second name for the same file where that can be had (so the file in use is not touched),
// else a copy.
const keep = (file, spot) => { try { fs.linkSync(file, spot); } catch { fs.cpSync(file, spot, { recursive: true }); } };
// Both places hold things. What the new place holds goes into the old one, which is the one in use and stays
// reachable by its path the whole time; then the folder moves as one (moveOne). Whatever only one side has is kept.
// Of a file both have, the newer one stays in use and the other goes to the set-aside folder (the new place's wins a
// tie). Each change to a file in use is one rename. A lock is not data, and the lock file in the place in use is
// never replaced or removed: whoever holds it, or has it open and is about to take it (the old code opens first and
// locks second), keeps the one real lock. The new place's copy of it goes, and only while nobody holds it: it is
// taken here for as long as that takes, and a process that had it open and takes it afterwards finds that it is no
// longer the file at its path and takes the real one (takeLock in files.js). Held: nothing of this folder is merged
// now, and a later run tries again.
// Returns how many files were set aside.
export function mergeInto(from, to, aside, grab = grabNow) {
  let kept = 0;
  for (const name of fs.readdirSync(from)) {
    const a = path.join(from, name), b = path.join(to, name);
    const sa = lstat(a), sb = lstat(b);
    if (!sa) continue;
    if (!sb) { fs.renameSync(a, b); continue; }
    if (sa.isDirectory() && sb.isDirectory()) { kept += mergeInto(a, b, path.join(aside, name), grab); fs.rmdirSync(a); continue; }
    if (isLock(a)) {
      const free = grab(a);
      if (!free) throw Object.assign(new Error(`${name} is held in the new place`), { code: "BUSY" });
      try { fs.rmSync(a); } finally { free(); }
      continue;
    }
    fs.mkdirSync(aside, { recursive: true });
    const spot = free(path.join(aside, name));
    if (sa.mtimeMs >= sb.mtimeMs) {
      keep(b, spot);
      try { fs.renameSync(a, b); } catch { fs.rmSync(b, { recursive: true, force: true }); fs.renameSync(a, b); } // a file where a folder was
    } else { try { fs.renameSync(a, spot); } catch { fs.cpSync(a, spot, { recursive: true }); fs.rmSync(a, { recursive: true, force: true }); } }
    kept++;
  }
  return kept;
}
// Two paths change places in one step (renameat2 with RENAME_EXCHANGE on Linux, renamex_np on a Mac): there is no
// moment at which either is missing. Node cannot ask for it, so python3 does. False: it could not be done here.
const SWAP = `import ctypes,os,sys
libc=ctypes.CDLL(None,use_errno=True)
a,b=os.fsencode(sys.argv[1]),os.fsencode(sys.argv[2])
sys.exit(0 if (libc.renamex_np(a,b,2) if sys.platform=="darwin" else libc.renameat2(-100,a,-100,b,2))==0 else 1)`;
export function swapNow(a, b) { try { return spawnSync("python3", ["-c", SWAP, a, b], { stdio: "ignore", timeout: 10000 }).status === 0; } catch { return false; } }
const sameDisk = (a, b) => { try { return fs.statSync(a).dev === fs.statSync(b).dev; } catch { return false; } };
// One folder. The old path works at every moment: it is the folder itself, and then, in one step, a link to where
// the folder now is. Three steps, each of them whole or not done, so a run that is cut off is carried on from the
// shape it left (`<old>.moving` is the spare name the steps use):
//   1. two links are made: <old>.moving -> new, and new -> <old>.moving (nobody uses either yet)
//   2. <old> and <old>.moving change places: old -> new -> <old>.moving, which is now the folder
//   3. new and <old>.moving change places: new is the folder, old -> new; the spare link is removed
// Returns what was done: "moved", "merged" (the new place held things too), "linked" (the folder stays where it is
// and the new place is a link to it: another disk, or no way here to change two paths in one step), or null.
function moveOne(p, rec, save, aside, { swap = swapNow, grab = grabNow } = {}) {
  const tmp = `${p.from}.moving`;
  const points = (at, to) => { try { return fs.readlinkSync(at) === to; } catch { return false; } };
  let how = null;
  for (let round = 0; round < 6; round++) {
    const f = lstat(p.from), t = lstat(p.to), m = lstat(tmp);
    if (f?.isSymbolicLink()) {
      if (t?.isSymbolicLink() && m?.isDirectory() && points(p.to, tmp)) { if (!swap(p.to, tmp)) return how; continue; } // step 3
      if (!t?.isDirectory() || rec[p.what]?.state !== "moving") return null;
      if (m?.isSymbolicLink()) fs.unlinkSync(tmp);
      how = how || rec[p.what].how || "moved";
      save({ ...rec[p.what], state: "done", how, at: Date.now() });
      return how;
    }
    if (!f?.isDirectory()) return null;
    const begun = t?.isSymbolicLink() && points(p.to, tmp);
    if (!begun && real(p.from) === real(p.to)) return null; // the new place is a link to this one already
    if (t && !t.isDirectory() && !begun) return null; // something that is not ours sits in the new place
    save({ ...rec[p.what], from: p.from, to: p.to, state: "moving", ...(how ? { how } : {}) }); // written first: a cut-off run is known for what it is
    fs.mkdirSync(path.dirname(p.to), { recursive: true });
    if (t?.isDirectory()) {
      const kept = mergeInto(p.to, p.from, path.join(aside, p.what), grab);
      fs.rmdirSync(p.to);
      how = "merged"; rec[p.what] = { ...rec[p.what], how, kept: (rec[p.what]?.kept || 0) + kept };
      continue;
    }
    const stay = () => { for (const l of [p.to, tmp]) { try { if (lstat(l)?.isSymbolicLink()) fs.unlinkSync(l); } catch {} } link(p.from, p.to); save({ ...rec[p.what], state: "done", how: "linked", at: Date.now() }); return "linked"; };
    if (!sameDisk(p.from, path.dirname(p.to))) return stay();
    if (m && !m.isSymbolicLink()) return null; // the spare name is taken by something else
    if (!m) link(p.to, tmp);
    if (!t) link(tmp, p.to);
    if (!swap(tmp, p.from)) return stay(); // step 2
    how = how || "moved"; rec[p.what] = { ...rec[p.what], how };
  }
  return null;
}
const none = { moved: [], line: "", stay: [] };
// The move. Called at the start of every run of the program; almost always it finds nothing to do, after three
// looks. `home` and `env` are for tests, which never move the real folders. `stay`: the folders that are still in
// the old place when this returns, whatever the reason (another copy's board, another mover still at work, a step
// that failed): the run must work on those where they are, never on an empty new place.
export function moveHome({ home = null, env = process.env, bin = BIN, linked, waitMs = 3000, swap, grab } = {}) {
  if (!home && env.HERDR_SUPERWORK_INLINE === "1") return none;
  home = home || os.homedir();
  const p = movePlan({ home, env });
  let rec = readJson(p.file, {}) || {};
  // A folder named outright by its own variable is left where it is, unless that names the old place itself (the
  // command an agent was handed before the move does: it goes on working, through the link).
  const mine = (x) => !env[x.key] || [x.from, x.to].some((d) => path.resolve(env[x.key]) === d);
  const there = (x) => lstat(x.from)?.isDirectory() && real(x.from) !== real(x.to);
  const due = (x) => mine(x) && (there(x) || rec[x.what]?.state === "moving");
  const out = (o = {}) => ({ ...none, ...o, stay: p.parts.filter((x) => mine(x) && there(x)) });
  if (!p.parts.some(due)) return none;
  if (othersBoard(p, bin, linked)) return out({ other: true });
  // One mover at a time. Another one at work: wait for it, then carry on with what it left.
  const lock = path.join(p.home, "moving.lock");
  try { fs.mkdirSync(p.home, { recursive: true }); } catch { return out(); }
  for (const until = Date.now() + waitMs; ;) {
    try { fs.writeFileSync(lock, JSON.stringify(marker()), { flag: "wx" }); break; }
    catch (e) {
      if (e.code !== "EEXIST") return out();
      if (!markerAlive(readJson(lock))) { try { fs.rmSync(lock); } catch {} continue; }
      if (Date.now() >= until) return out({ busy: true });
      sleepSync(20);
    }
  }
  const moved = [];
  try {
    rec = readJson(p.file, {}) || {};
    for (const x of p.parts.filter(due)) {
      const save = (v) => { rec[x.what] = v; writeJson(p.file, rec); };
      try { const how = moveOne(x, rec, save, p.aside, { swap, grab }); if (how) moved.push({ ...x, how }); } catch {} // left as it is: the next run goes on
    }
    if (!moved.length) return out();
    const said = moved.map((x) => (x.how === "linked" ? `${x.what} stays in ${short(x.from, home)} and is linked from there` : `${x.what} (from ${short(x.from, home)})`));
    const kept = Object.values(rec).reduce((n, v) => n + (v?.kept || 0), 0);
    const line = `Moved the board's files into ${short(p.home, home)}: ${said.join(", ")}.${moved.some((x) => x.how !== "linked") ? " The old places are links to the new ones, so whatever is running carries on." : ""}${kept ? ` ${kept} file${kept === 1 ? " that was" : "s that were"} in both places ${kept === 1 ? "is" : "are"} kept in ${short(p.aside, home)}.` : ""}`;
    rec.line = [rec.told === false ? rec.line : "", line].filter(Boolean).join(" "); rec.told = false;
    writeJson(p.file, rec);
    return out({ moved, line });
  } catch { return out({ moved }); } finally { try { fs.rmSync(lock); } catch {} }
}
// The one line for the human, until it was shown once (the first run may be a hook, with nobody looking).
const noteFile = (o) => movePlan({ home: o.home || os.homedir(), env: o.env || process.env }).file;
export function moveNote(o = {}) { if (!o.home && process.env.HERDR_SUPERWORK_INLINE === "1") return ""; const r = readJson(noteFile(o)); return r && r.told === false ? String(r.line || "") : ""; }
export function moveTold(o = {}) { const r = readJson(noteFile(o)); if (r && r.told === false) { r.told = true; try { writeJson(noteFile(o), r); } catch {} } }
// The path a folder inside a moved one had before the move, or null. A program started back then still knows its
// folder by that path (the Coordinator's conversations are saved under it until its next restart).
export function movedFrom(dir, o = {}) {
  const rec = readJson(noteFile(o)) || {};
  for (const v of Object.values(rec)) {
    if (v?.state !== "done" || v.how === "linked" || !v.to || !v.from) continue;
    if (dir === v.to || String(dir).startsWith(v.to + path.sep)) return v.from + String(dir).slice(v.to.length);
  }
  return null;
}
// At the start of every run of the program: the move, and its one line said where a human reads it. The board says it
// on its own screen (board/main.js); a hook, a job or an agent's command has no reader, so the line waits.
const QUIET = ["board", "hook", "turn-ended", "keeper", "keeper-work", "run", "serve", "remote"];
export function homeAtStart(cmd, err = process.stderr, o = {}) {
  const r = moveHome(o), env = o.env || process.env;
  // Not moved (see `stay`): this run works on those folders where they are, as it did before.
  for (const x of r.stay) env[x.key] = x.from;
  if (QUIET.includes(cmd) || !err.isTTY) return;
  const line = moveNote(o);
  if (line) { err.write(`${line}\n`); moveTold(o); }
}
