// While a plan waits for its yes, the task's own worktree cannot be written to: its files, its folders and its git index are read-only.
// A rule asks an agent to change nothing, and the look at the turn's end undoes what changed (untouched.js); this is
// what keeps a change from being made in between, by any program, with or without a plan mode of its own, and by
// the reviewer that checks the plan. Everything in the worktree loses its write permission, files git ignores
// too, and so does the worktree's own git folder (its index, its HEAD): nothing can be added, edited, deleted,
// staged or committed there. Reading and running still work. The lock is taken off when the build starts, when the
// board itself puts something back, and before the worktree is removed.
// Only the task's own worktree is ever locked. Your own checkout (a task with no worktree) is never made
// read-only: there a program's own plan mode and the board's look are what there is.
import fs from "node:fs";
import path from "node:path";

const treeOf = (t) => (t?.worktree && fs.existsSync(t.worktree) ? t.worktree : "");
// The worktree's own git folder: what its `.git` file points at.
export function gitDirOf(tree) {
  try { const s = fs.readFileSync(path.join(tree, ".git"), "utf8"); const m = /^gitdir:\s*(.+)$/m.exec(s); return m ? path.resolve(tree, m[1].trim()) : ""; } catch { return ""; }
}
// Every file and folder under `dir`, and `dir` itself: the write bits taken off (`on` false) or the owner's put back.
// Links are left alone: what they point at is not the worktree's. A folder is opened before it loses its write bit
// and after it has it back, so the walk never stands before a folder it cannot change.
function chmod(on, dir) {
  let ok = true;
  const set = (p, mode) => { try { fs.chmodSync(p, on ? mode | 0o200 : mode & ~0o222); } catch { ok = false; } };
  const walk = (p) => {
    let s; try { s = fs.lstatSync(p); } catch { return; }
    if (s.isSymbolicLink()) return;
    if (!s.isDirectory()) return void set(p, s.mode);
    if (on) set(p, s.mode);
    let names = []; try { names = fs.readdirSync(p); } catch { ok = false; }
    for (const n of names) walk(path.join(p, n));
    if (!on) set(p, s.mode);
  };
  walk(dir);
  return ok;
}
// Returns true when the worktree is now read-only.
export function lock(t) {
  const tree = treeOf(t), git = tree && gitDirOf(tree);
  if (!tree || !git) return false; // no worktree of its own, or a folder that is no worktree: never locked
  return chmod(false, git) && chmod(false, tree);
}
export function unlock(t) {
  const tree = treeOf(t), git = tree && gitDirOf(tree);
  if (!tree) return false;
  const a = chmod(true, tree);
  return (git ? chmod(true, git) : true) && a;
}
export const isLocked = (t) => { const tree = treeOf(t); if (!tree) return false; try { fs.accessSync(tree, fs.constants.W_OK); return false; } catch { return true; } };
