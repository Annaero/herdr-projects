// Nothing in the repo is changed before the plan's yes: the board looks for itself, and puts back what changed.
// Asking the agent is not enough. While the plan step is open the task's own worktree is read-only (lock.js), so
// a change cannot be made there at all. And when the plan's turn ends, and again right before the build starts, the
// board reads the task's folder: should something have changed all the same (somebody took the lock off), it undoes
// every change in the task's own worktree itself. The branch goes back to the commit it stood on, added files go,
// files git ignores that were not there when the step began go too, and what was undone is kept as a patch beside
// the plan. In your own checkout (a task with no worktree) the board undoes nothing, since what is there may be
// yours: the change goes back to the agent that made it, the plan is not shown until it is gone, and no build
// starts while it is there.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import * as R from "../research.js";
import { planFolder, open } from "../plan.js";
import { lock, unlock } from "./lock.js";

export const PATCH = "changed-too-early.patch";
// The commit the task's branch stands on while nothing of the task's own is on it.
const baseOf = (t) => t.syncedTo || t.baseSha || t.from || "";
const dirOf = (t) => { const dir = S.cwdOf(t); return dir && fs.existsSync(dir) && S.isRepo(dir) ? dir : ""; };

// ---- one look at the folder ----------------------------------------------------------------------------------------------
// One git program says it all for a folder: the commit and the branch it is on, whether anything git tracks or
// could track is changed, and what it ignores (a folder as one entry: `node_modules/`).
function look(dir) {
  const seen = { oid: "", head: "", dirty: false, ignored: [] };
  for (const e of S.gitOut(dir, ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "--ignored=traditional", "-z"]).split("\0")) {
    if (e.startsWith("# branch.oid ")) seen.oid = e.slice(13);
    else if (e.startsWith("# branch.head ")) seen.head = e.slice(14);
    else if (e.startsWith("! ")) seen.ignored.push(e.slice(2));
    else if (/^[12u?] /.test(e)) seen.dirty = true;
  }
  return seen;
}
// ---- files git ignores -----------------------------------------------------------------------------------------------
// git reports no change in them, so they are written down when the step begins: each ignored file, and each
// ignored folder as one entry, with its size and when it was written.
const MOST = 5000;
export function ignoredMark(dir, rels = null) {
  try {
    const out = {};
    for (const rel of rels || look(dir).ignored) {
      try { const s = fs.lstatSync(path.join(dir, rel)); out[rel] = s.isDirectory() ? `d:${s.mtimeMs}` : `${s.size}:${s.mtimeMs}`; } catch {}
      if (Object.keys(out).length > MOST) return null; // too many to keep on a task: not compared
    }
    return out;
  } catch { return null; }
}
// What differs from the mark: { fresh: [paths that were not there], other: [paths changed or gone] }.
function ignoredDiff(t, dir, rels = null) {
  const was = t.plan?.ignored, now = was ? ignoredMark(dir, rels) : null;
  if (!was || !now) return { fresh: [], other: [] };
  return { fresh: Object.keys(now).filter((rel) => !(rel in was)), other: [...Object.keys(now).filter((rel) => rel in was && now[rel] !== was[rel]), ...Object.keys(was).filter((rel) => !(rel in now))] };
}
// What changed: [] when nothing did, null when it cannot be told. The task's own worktree that stands on the commit
// and the branch it started on, with nothing changed that git tracks or could track, is unchanged: that takes the
// one look. Anything else is read in full, as research.js reads it for a task that may change nothing (your own
// checkout always is: it is compared with how it stood when the agent started). The ignored files beside it.
export function changed(t) {
  const dir = dirOf(t);
  if (!dir) return [];
  let seen = null;
  try { seen = look(dir); } catch { return null; }
  const base = baseOf(t), same = !!t.worktree && /^[0-9a-f]{40}$/.test(base) && seen.oid === base && !seen.dirty && (!t.branch || seen.head === t.branch);
  const list = same ? [] : R.changesOf(t, dir), ig = ignoredDiff(t, dir, seen.ignored);
  if (list === null) return null;
  return [...list, ...ig.fresh.map((rel) => `${rel} (ignored by git, added)`), ...ig.other.map((rel) => `${rel} (ignored by git, changed)`)];
}
// Put the task's own worktree back. Returns what was undone ([] when nothing was), or null when it is not the
// board's to undo (your checkout) or could not be undone: then no plan is shown and no build starts.
export function putBack(t) {
  const list = changed(t);
  if (list === null) return []; // nothing to compare with (a repo with no commit when the agent started): nothing is held on a guess
  if (!list.length) return [];
  const tree = t.worktree && fs.existsSync(t.worktree) ? t.worktree : "", base = baseOf(t);
  if (!tree || !base) return null;
  try {
    unlock(t);
    // What is thrown away, kept: everything against the commit the branch started from, new files too.
    S.gitOut(tree, ["add", "-A"]);
    const patch = S.gitOut(tree, ["diff", "--binary", "--cached", base]);
    if (patch.trim()) { fs.mkdirSync(planFolder(t), { recursive: true }); fs.writeFileSync(path.join(planFolder(t), PATCH), `${patch}\n`); }
    if (t.branch && S.branchOf(tree) !== t.branch) S.gitOut(tree, ["checkout", "-f", t.branch]);
    S.gitOut(tree, ["reset", "--hard", base]);
    S.gitOut(tree, ["clean", "-fd"]);
    for (const rel of ignoredDiff(t, tree).fresh) fs.rmSync(path.join(tree, rel), { recursive: true, force: true });
  } catch { return null; }
  finally { if (open(t) && t.plan.locked) lock(t); }
  return (changed(t) || []).length ? null : list;
}
// The line a task shows for it.
export const undoneWords = (list) => `${R.changedWords(list)} made before the plan was approved ${list.length === 1 ? "was" : "were"} put back`;
// What a task says when a change is there that the board may not, or could not, undo.
export function heldFailure(t) {
  const list = changed(t) || [], shown = list.slice(0, 30).map((f) => `- ${f}`).join("\n");
  return { stage: "plan", auth: false, agentCanFix: true, title: "The repo was changed before the plan was approved", msg: `Changed the repo before its plan was approved (${list.length}): nothing is built until that is undone`,
    detail: `This task starts with a plan, and nothing may change before the plan is approved and the build has started.\n\nFolder: ${S.cwdOf(t)}\n\nChanged:\n${shown}`,
    next: `Undo every one of these changes yourself, file by file, and take back any commit of yours${t.worktree ? "" : "; this is the human's own checkout and may hold changes of theirs, so never reset or clean it"}. Then stop again: the board looks once more, and goes on when nothing is changed.` };
}
