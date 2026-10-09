// Landing: bring the branch up to date with main in the task's own worktree, merge (through the pull request when
// there is one, else locally), then clean up. Conflicts are rolled back and saved; a checkout with unsaved files
// is never forced.
import fs from "node:fs";
import path from "node:path";
import * as S from "./store.js";
import * as F from "./flow.js";
import { herdr, currentSocket, socketExists } from "./herdr.js";
import { claim, release, guardFor, sh, outputOf } from "./runner.js";

const git = S.gitOut;

// Remove a task's herdr workspace, worktree and branch. Returns what was kept (and why), so no work is ever lost:
// a checkout with unsaved files is never forced. Only things the plugin created are closed.
export async function cleanup(t, { deleteBranch = "merged" } = {}) {
  const kept = [];
  const root = S.folderOf(t.id);
  const api = t.link?.socket && t.link.socket === currentSocket() && socketExists(t.link.socket) ? herdr(t.link.socket) : null;
  const ws = api && t.link?.workspace ? api.workspaceGet(t.link.workspace) : null;
  if (t.worktree && fs.existsSync(t.worktree)) {
    if (F.dirty(t.worktree)) return [`${S.tilde(t.worktree)} (uncommitted changes)`];
    if (t.repoCfg?.teardown) await sh(t.repoCfg.teardown, t.worktree, { HERDR_SUPERWORK_ID: t.id, HERDR_SUPERWORK_WORKTREE: t.worktree, HERDR_SUPERWORK_REPO: root }, { timeoutMin: 5 });
    try {
      if (api && t.link?.ownsWorkspace) {
        // `herdr worktree remove` also closes its workspace. If the human closed the workspace, reopen it first.
        const target = ws && ws.worktree?.checkout_path === t.worktree ? ws.workspace_id : api.worktreeOpen({ cwd: root, path: t.worktree }).workspace.workspace_id;
        api.worktreeRemove(target);
      } else git(root, ["worktree", "remove", t.worktree]);
    } catch (e) {
      try { git(root, ["worktree", "remove", t.worktree]); } catch { return [`${S.tilde(t.worktree)} (${String(e.message || "could not be removed").split("\n")[0]})`]; }
    }
    try { git(root, ["worktree", "prune"]); } catch {}
  } else if (ws && t.link?.ownsWorkspace) { try { api.workspaceClose(ws.workspace_id); } catch {} }
  if (t.branch) {
    try { git(root, ["rev-parse", "--verify", `refs/heads/${t.branch}`]); try { git(root, ["branch", deleteBranch === "always" ? "-D" : "-d", t.branch]); } catch { kept.push(`branch ${t.branch} (not merged yet)`); } } catch {}
  }
  return kept;
}
// After landing: remove the leftovers when that is safe, and say where they are when it is not.
async function tidy(id) {
  const t = S.get(id);
  if (!t || !S.config().cleanup || t.archivedAt) return;
  const kept = await cleanup(t, { deleteBranch: "always" });
  try { S.update(id, (t) => { if (kept.length) t.kept = kept; else { t.worktree = null; t.cleaned = Date.now(); t.link = { socket: t.link?.socket }; } if (kept.length) t.msg = `${t.msg} Kept: ${kept.join(", ")}`; }, { waitMs: 10000 }); } catch {}
}
export async function cleanupJob(id) { await tidy(id); }

// The branch main lives on at the remote: what the worktree started from, else origin's default, else main.
function mainBranch(root, t) {
  const from = String(t.from || "");
  if (/^origin\/(?!HEAD$)/.test(from)) return from.slice(7);
  try { return git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).replace(/^origin\//, ""); } catch {}
  for (const b of ["main", "master"]) { try { git(root, ["rev-parse", "--verify", `refs/remotes/origin/${b}`]); return b; } catch {} }
  return "main";
}

export async function landJob(id) {
  const t = claim(id, "land");
  if (!t || t.stage !== "merging") { if (t) release(id); return; }
  const g = guardFor(id);
  g.expect(t);
  try { await landCore(id, g); }
  catch (e) { if (!e.aborted) try { g.set((t) => { t.stage = "approval"; t.mergeFailed = true; t.msg = "Merge failed"; Object.assign(t, S.failurePatch({ stage: "merge", title: "Merge failed", detail: e.stack || e.message, next: "Investigate the error, then approve again." })); }); } catch {} }
  finally { release(id); }
}

// Runs with the task in stage "merging" and this runner's guard standing on it.
export async function landCore(id, g) {
  let t = g.check();
  const root = S.folderOf(t.id);
  const tree = t.worktree && fs.existsSync(t.worktree) && path.resolve(t.worktree) !== path.resolve(root) ? t.worktree : "";
  const how = S.config().merge; // squash by default: one commit per task
  // A failed merge waits for you again, as plain "permission": the row, panel and details show the blocker.
  const fail = (title, detail, next, { agentCanFix = true, auth = S.isAuthFailure(detail), extra = {}, keepIntent = false } = {}) => {
    const f = g.set((t) => { t.stage = auth ? "failed" : "approval"; t.mergeFailed = true; t.msg = title; if (!keepIntent) t.mergeIntent = null; Object.assign(t, S.failurePatch({ stage: "merge", title, detail, next, agentCanFix, auth, ...extra })); });
    F.labelPane(f, "merge blocked");
    F.notify(f, `${f.title}: ${title}`, String(next || "").split("\n")[0]);
    return f;
  };
  const landed = async (msg) => {
    const d = g.set((t) => { t.stage = "done"; t.msg = msg; t.failure = null; t.prFailure = null; t.mergeIntent = null; t.autoMerge = false; t.mergeFailed = false; t.seen = false; t.requireApproval = false; if (t.pr) { t.prMerged = true; t.prState = "merged"; } });
    F.labelPane(d, null);
    F.notify(d, `${d.title}: merged`, msg, "done");
    await tidy(id);
  };
  const reverify = async (why) => {
    const { pipeline } = await import("./finish.js");
    g.set({ msg: why });
    await pipeline(id, g, t.summary || "Branch updated with main.", { keepIntent: true, reason: "sync" });
  };
  if (tree) {
    let target, base;
    try {
      if (!t.pr && F.dirty(root)) return void fail("Merge needs a clean checkout", `Checkout: ${root}\n${F.dirty(root)}`, "Commit, stash or move your own unsaved files, then approve again. The agent must not alter your checkout.", { agentCanFix: false, auth: false });
      if (git(tree, ["symbolic-ref", "--short", "HEAD"]) !== t.branch) return void fail("Task is on the wrong branch", tree, "Restore the task's own branch before retrying.", { agentCanFix: false, auth: false });
      // Approve refuses unless the worktree is clean and its HEAD is exactly the commit that was checked and reviewed;
      // otherwise the finish line runs again first, under the approval already given.
      if (F.dirty(tree) || (t.mergeIntent?.verifiedHead && F.headOf(tree) !== t.mergeIntent.verifiedHead)) return void (await reverify("checking work that changed after its review"));
      if (!t.mergeIntent) t = g.set({ mergeIntent: { approvedAt: Date.now(), repairs: 0, verifiedHead: F.headOf(tree) } });
      if (F.hasOrigin(root)) { const b = mainBranch(root, t); git(tree, ["fetch", "origin", b], { timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }); target = git(tree, ["rev-parse", "FETCH_HEAD"]); base = `origin/${b}`; }
      else { target = git(root, ["rev-parse", "HEAD"]); base = S.branchOf(root) || "HEAD"; }
    } catch (e) { return void fail("Could not synchronize main", outputOf(e), "Investigate the fetch/Git error, then retry after fixing it."); }
    let current = false;
    try { git(tree, ["merge-base", "--is-ancestor", target, "HEAD"]); current = true; } catch {}
    if (!current) {
      try { git(tree, ["merge", "--no-edit", target]); }
      catch (e) {
        let files = ""; try { files = git(tree, ["diff", "--name-only", "--diff-filter=U"]); } catch {}
        let restored = true; try { git(tree, ["merge", "--abort"]); } catch { restored = false; }
        const ch = S.choices(t), repairs = t.mergeIntent?.repairs || 0;
        const auto = !!files && restored && ch.conflictAuto && repairs < ch.rounds;
        fail(files ? "Merge conflict with main" : "Could not update task from main",
          `Conflicting files:\n${files || "none reported"}\n\nTask branch: ${t.branch}\nTarget branch: ${base}\nTarget commit: ${target}\nWorktree: ${tree}\n\nGit output:\n${outputOf(e)}\n\n${restored ? "The private merge attempt was rolled back. The human's checkout is unchanged." : "The private merge could not be rolled back; inspect it before continuing."}`,
          `In ${tree} on ${t.branch}, merge target commit ${target} (${base}), resolve and commit the conflicts, then finish. The board re-runs checks/review and retries the approved merge. Never alter the human's checkout.`,
          { agentCanFix: restored, auth: false, extra: { phase: "sync", target, base }, keepIntent: true });
        if (auto) { const { sendFailure } = await import("./actions.js"); try { sendFailure(id); } catch {} }
        else if (files && ch.conflictAuto && repairs >= ch.rounds) { try { S.update(id, (t) => { t.stage = "asks"; t.kind = "question"; t.msg = `The agent could not resolve the main conflict after ${repairs} repairs. Full details are kept; you are needed.`; }, { waitMs: 10000 }); } catch {} }
        return;
      }
      // A clean update changed the commit: it is checked and reviewed again, then merged under the approval given.
      return void (await reverify("checking branch updated with main"));
    }
  }
  t = g.check();
  if (t.pr) {
    // By number, not link: gh then uses the repo's own remote for the host.
    const pr = F.prNumber(t.pr);
    F.gh(["pr", "ready", pr], root, 60000);
    const m = F.gh(["pr", "merge", pr, `--${how}`, "--delete-branch"], root);
    if (m.status !== 0) {
      const auto = F.gh(["pr", "merge", pr, `--${how}`, "--delete-branch", "--auto"], root);
      // GitHub's checks are still running: the approval is remembered and it merges when they pass.
      if (auto.status === 0) { g.set((t) => { t.failure = null; t.autoMerge = true; t.msg = `approved: merges when GitHub's checks pass (${t.pr})`; }); return; }
      return void fail("Pull request could not merge", `Pull request: ${t.pr}\nBranch: ${t.branch || "unknown"}\n\ngh pr merge:\n${outputOf(m)}\n\ngh pr merge --auto:\n${outputOf(auto)}`, "Inspect the pull request's base branch, conflicts and checks. Resolve branch conflicts in your own worktree, or fix failed checks, then finish again. Approval is required before retrying the merge.");
    }
    try { git(root, ["fetch", "origin"], { timeout: 60000 }); if (!git(root, ["status", "--porcelain", "--untracked-files=no"])) git(root, ["merge", "--ff-only", "@{upstream}"]); } catch {} // bring your checkout along when that is safe
    return void (await landed(`Merged: ${t.pr}`));
  }
  // No pull request: merge into the branch your checkout is on.
  try {
    if (!tree) return void (await landed(t.msg && !/^merging/.test(t.msg) ? t.msg : "Done."));
    const mess = F.dirty(root);
    if (mess) return void fail("Merge needs a clean checkout", `Checkout: ${root}\n\nUncommitted or untracked files:\n${mess}`, "Commit, stash or move your own unsaved files, then approve again. The agent must not alter your checkout.", { agentCanFix: false, auth: false });
    const onto = git(root, ["symbolic-ref", "--short", "HEAD"]);
    const target = git(root, ["rev-parse", "HEAD"]);
    const conflict = (e) => {
      let files = ""; try { files = git(root, ["diff", "--name-only", "--diff-filter=U"]); } catch {}
      const detail = `${files ? `Conflicting files:\n${files}\n\n` : ""}Task branch: ${t.branch}\nTarget branch: ${onto}\nTarget commit: ${target}\nCheckout: ${root}\n\nGit output:\n${outputOf(e)}`;
      // Save the evidence before restoring the initially clean checkout. Never delete untracked files.
      let restored = true;
      try { git(root, ["merge", "--abort"]); } catch { try { git(root, ["reset", "--merge", "HEAD"]); } catch { restored = false; } }
      fail(files ? "Merge conflict" : "Merge failed", detail + (restored ? "\n\nThe merge attempt was rolled back; the human's checkout is unchanged." : "\n\nRollback failed. The human must inspect the checkout before retrying."),
        restored ? `In your own worktree on ${t.branch}, bring in target commit ${target} (${onto}), resolve the conflicts, run the checks and commit. Do not change the human's checkout. Finish again for review, then ask for merge approval.` : "Inspect and restore the human's checkout before retrying. Do not let the agent reset or discard it.", { agentCanFix: restored, auth: false });
    };
    const message = `${t.title || id}\n\nTask: ${id}`;
    if (how === "squash") {
      try { git(root, ["merge", "--squash", t.branch]); } catch (e) { return void conflict(e); }
      if (git(root, ["diff", "--cached", "--name-only"])) try { git(root, ["commit", "-m", message]); } catch (e) { return void conflict(e); }
    } else {
      // Keep every commit: fast-forward when possible (what a rebase gives here), otherwise a merge commit.
      try { git(root, ["merge", how === "rebase" ? "--ff" : "--no-ff", "-m", message, t.branch]); } catch (e) { return void conflict(e); }
    }
    return void (await landed(`Merged into ${onto}.`));
  } catch (e) { return void fail("Merge failed", outputOf(e), "Investigate the Git error in your own worktree, then finish again. Approve again only after the problem is fixed."); }
}
