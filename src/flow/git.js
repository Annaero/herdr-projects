// Git and GitHub helpers used by more than one step: the pull request, its checks, a task's change.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import * as S from "../store.js";
import { noteFile } from "./task.js";

// ---- git/gh helpers used by more than one step -----------------------------------------------------------------------
export function hasOrigin(root) { try { return S.gitOut(root, ["remote"]).split("\n").includes("origin"); } catch { return false; } }
export const gh = (args, cwd, timeout = 120000) => spawnSync("gh", args, { cwd, encoding: "utf8", timeout, env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" } });
export const prNumber = (pr) => (String(pr).match(/\/pull\/(\d+)/) || [])[1] || String(pr);
// All messages that resume work must first revoke a queued GitHub auto-merge. Throws when that fails: nothing is sent.
// How GitHub words a check's result.
export const CHECK_BAD = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"];
export const CHECK_GOOD = ["SUCCESS", "NEUTRAL", "SKIPPED"];
// Delete a merged pull request's branch at the remote, only while it still is the commit that was merged. (gh's own
// --delete-branch also removes the local branch and its worktree, past every look clean-up takes first.)
export function dropRemoteBranch(root, branch, head) {
  if (!branch || !head || !hasOrigin(root)) return;
  try { S.gitOut(root, ["push", "origin", "--delete", branch, `--force-with-lease=${branch}:${head}`], { timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }); } catch {}
}
// A merge waiting for GitHub's checks is remembered here, on the task: the board merges it itself when they have
// passed, at the reviewed commit only. (GitHub's own auto-merge would also merge commits pushed later.) Only a task
// from an older version still has GitHub's auto-merge to switch off.
export function cancelAutoMerge(t) {
  if (!t.autoMerge) return;
  if (t.autoMergeLocal) return void S.update(t.id, { autoMerge: false, autoMergeLocal: false, requireApproval: true }, { waitMs: 10000 });
  const r = gh(["pr", "merge", prNumber(t.pr), "--disable-auto"], S.folderOf(t.id), 60000);
  if (r.status !== 0) throw new Error(`Could not cancel the pending auto-merge; nothing was sent. ${String(r.stderr || r.stdout || r.error?.message || "").trim().split("\n").pop() || ""}`.trim());
  S.update(t.id, { autoMerge: false, requireApproval: true }, { waitMs: 10000 });
}
// The change a task would land, against where its worktree started.
export function changeOf(t) {
  if (!t.worktree || !fs.existsSync(t.worktree)) return null;
  // Once the branch holds a newer main (sync.js), the change is what it adds to that main, not to where it started.
  for (const from of [t.syncedTo, t.baseSha || t.from || "HEAD"].filter(Boolean)) {
    try {
      const range = `${from}...HEAD`;
      return { stat: S.gitOut(t.worktree, ["diff", "--shortstat", range]), diff: S.gitOut(t.worktree, ["diff", "--stat", range]), head: S.gitOut(t.worktree, ["rev-parse", "HEAD"]), range };
    } catch {}
  }
  return null;
}
// Work that ended and was cleaned up: the next round starts fresh, never in your checkout.
export const cleanedUp = (t) => !!t.cleaned || (t.stage === "done" && !!t.worktree && !fs.existsSync(t.worktree));
export const headOf = (dir) => { try { return S.gitOut(dir, ["rev-parse", "HEAD"]); } catch { return ""; } };
export const dirty = (dir) => { try { return S.gitOut(dir, ["status", "--porcelain"]); } catch { return ""; } };
export const noteStat = (t) => { try { const s = fs.statSync(noteFile(t)); return { mtime: s.mtimeMs, text: fs.readFileSync(noteFile(t), "utf8").trim() }; } catch { return null; } };
