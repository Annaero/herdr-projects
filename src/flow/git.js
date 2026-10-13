// Git and GitHub helpers used by more than one step: the pull request, its checks, a task's change.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as S from "../store.js";

// ---- git/gh helpers used by more than one step -----------------------------------------------------------------------
// Asked on every pass, for every task: where the repo's own config file can answer (a primary checkout, with nothing
// included from elsewhere and no remote kept the old way, as a file), it does, and no program is started.
export function hasOrigin(root) {
  try {
    const dir = path.join(root, ".git"), cfg = fs.readFileSync(path.join(dir, "config"), "utf8");
    if (/^\s*\[remote\s+"origin"\]/m.test(cfg)) return true;
    if (!/^\s*\[include/im.test(cfg) && !fs.existsSync(path.join(dir, "remotes")) && !fs.existsSync(path.join(dir, "branches", "origin"))) return false;
  } catch {}
  try { return S.gitOut(root, ["remote"]).split("\n").includes("origin"); } catch { return false; } }
// (Tests may answer for gh themselves, `globalThis.__swGh`, as they do for herdr: no program is started then.)
export const gh = (args, cwd, timeout = 120000) => globalThis.__swGh ? globalThis.__swGh(args) : spawnSync("gh", args, { cwd, encoding: "utf8", timeout, env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" } });
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
// Where a branch stands at the remote, asked of the remote itself. Empty when it cannot be asked or is not there.
export function remoteHead(root, branch) {
  if (!branch) return "";
  try { return S.gitOut(root, ["ls-remote", "origin", `refs/heads/${branch}`], { timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).split(/\s+/)[0] || ""; } catch { return ""; }
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
      // One git program, not three: the last line of `--stat` is what `--shortstat` prints, and the commit is read from git's own files.
      const diff = S.gitOut(t.worktree, ["diff", "--stat", range]);
      return { stat: diff.split("\n").pop().trim(), diff, head: headOf(t.worktree) || S.gitOut(t.worktree, ["rev-parse", "HEAD"]), range };
    } catch {}
  }
  return null;
}
// Work that ended and was cleaned up: the next round starts fresh, never in your checkout.
export const cleanedUp = (t) => !!t.cleaned || (t.stage === "done" && !!t.worktree && !fs.existsSync(t.worktree));
// The commit a folder is on. Asked on every pass, for every task, so git's own files answer where they can (the
// folder is a checkout or a worktree, on a branch whose ref is a file of its own, or on a commit) and no program is
// started; anything else (a ref only in packed-refs, another ref format, a folder inside a checkout) is asked of git.
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
function headFile(dir) {
  try {
    let gitDir = path.join(dir, ".git");
    if (fs.statSync(gitDir).isFile()) gitDir = path.resolve(dir, fs.readFileSync(gitDir, "utf8").replace(/^gitdir:\s*/, "").trim());
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (SHA.test(head)) return head;
    const ref = /^ref: (refs\/[\w./-]+)$/.exec(head)?.[1];
    if (!ref || ref.includes("..")) return "";
    // A worktree keeps its own HEAD; its branches are in the repo it belongs to.
    let common = gitDir;
    try { common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim()); } catch {}
    const sha = fs.readFileSync(path.join(common, ref), "utf8").trim();
    return SHA.test(sha) ? sha : "";
  } catch { return ""; }
}
export const headOf = (dir) => { const known = headFile(dir); if (known) return known; try { return S.gitOut(dir, ["rev-parse", "HEAD"]); } catch { return ""; } };
export const dirty = (dir) => { try { return S.gitOut(dir, ["status", "--porcelain"]); } catch { return ""; } };
// The board's own comments on a pull request are posted as the logged-in user, the same one whose comments wake the
// agent: each ends with this mark (unseen on the page), and one from before the mark starts with its headline.
export const BOARD_COMMENT = "\n\n<!-- herdr-superwork -->";
export const boardComment = (body) => /<!-- herdr-superwork -->|^\s*\*\*Review( \d+)? · /.test(String(body || ""));
// Who is logged in to GitHub here: the human. Asked once a day; "" when gh cannot say.
export function ghUser(cwd) {
  const file = path.join(S.dataDir(), "gh-user.json"), kept = S.readJson(file);
  if (kept && Date.now() - kept.at < 24 * 3600 * 1000) return kept.login;
  let login = "";
  try { const r = gh(["api", "user", "--jq", ".login"], cwd, 20000); if (r.status === 0) login = String(r.stdout || "").trim().split("\n")[0]; } catch {}
  if (!/^[A-Za-z0-9-]+(\[bot\])?$/.test(login)) login = "";
  try { S.writeJson(file, { login, at: login ? Date.now() : Date.now() - 23 * 3600 * 1000 }); } catch {}
  return login;
}
