// The pipeline: commit, bring main in, set up, check, push, pull request, review, then wait for approval.
import fs from "node:fs";
import * as S from "../store.js";
import * as F from "../flow.js";
import { claim, release, guardFor, sh, outputOf } from "../runner.js";
import * as G from "../gate.js";
import * as Y from "../sync.js";
import { firstLine, approvalMessage, fail } from "./shared.js";
import { closeReviewer, runReview } from "./review.js";
import { runCheck } from "./check-run.js";
import { mergesItself, byItself } from "./auto-merge.js";
import { researchOnly, keptReport } from "./research.js";

// "Finish anyway" on a turn that left no closing note: the screen text is the summary.
export async function pipelineJob(id) {
  let t = claim(id, "pipeline");
  if (!t || t.stage !== "checking") { if (t) release(id); return; }
  const g = guardFor(id);
  g.expect(t);
  try { await pipeline(id, g, t.said || t.screen || t.msg || "", null); }
  catch (e) { if (!e.aborted) try { fail(g, { stage: "workflow", title: "The finish line failed", detail: e.stack || e.message, next: "Investigate the error, then finish again." }); } catch {} else await closeReviewer(id); }
  finally { release(id); }
}
// ---- the pipeline -------------------------------------------------------------------------------------------------------
// `synced`: the caller already brought the branch up to date with main (a re-sync, or the sync after an approval)
// and this is its result.
export async function pipeline(id, g, text, wake, synced = null) {
  let t = g.set((t) => { t.stage = "checking"; t.syncBlocked = null; t.msg = synced ? "Checking the branch updated with main" : "Checking the result"; t.watch = null; t.check = null; t.summary = String(text || "").trim(); });
  const folder = S.cwdOf(t), root = S.folderOf(t.id), tree = F.isAgentTask(t) && t.worktree && fs.existsSync(t.worktree) ? t.worktree : "";
  const env = { HERDR_SUPERWORK_ID: t.id, HERDR_SUPERWORK_WORKTREE: folder, HERDR_SUPERWORK_REPO: root };
  // The settings of this step, read now: where it is checked. The review reads its own when it starts, the merge its own.
  let ch = S.work(t);
  const repo = { check: S.commandOf(ch["check.command"]), setup: S.commandOf(ch["workspace.setup"]) };
  const alive = () => !!g.check();
  // A research-only task changes nothing in the repo: with a change it goes back, and nothing below is committed,
  // brought up to date, checked as a change, pushed or merged for it (research.js). Its report is what is reviewed.
  const research = researchOnly(id, g, tree);
  if (research === "back") return;
  t = keptReport(g);
  // 3. Commit leftovers. A plain folder has nothing to commit.
  if (tree && !research) {
    try { if (F.dirty(tree)) { S.gitOut(tree, ["add", "-A"]); S.gitOut(tree, ["commit", "-m", `${t.title || id}\n\nTask: ${S.taskRef(id)}`]); } }
    catch (e) { return void fail(g, { stage: "commit", title: "Could not commit the work", detail: outputOf(e), next: "Fix the Git error in your own worktree, commit the work and finish again." }); }
  }
  t = g.check();
  // Bring the branch up to date with main before anything is checked or reviewed, so the reviewer sees the work as
  // it will really land. The board does it; the agent hears nothing unless there is a real conflict.
  let sync = synced;
  if (!sync && Y.treeOf(t) && !research) {
    // Work on another branch than the task's own cannot be brought up to date, pushed or landed as this task: it is
    // not checked or reviewed as if it could.
    const on = S.branchOf(tree);
    if (on !== t.branch) return void fail(g, { stage: "merge", phase: "branch", title: "Task is on the wrong branch", detail: `Worktree: ${tree}\nIt is on: ${on || "no branch"}\nThe task's own branch: ${t.branch}\n\nNothing was checked, reviewed or merged.`, next: `In ${tree}, bring the work onto ${t.branch} and switch back to it (git switch ${t.branch}), then finish again. Do not alter the human's checkout.`, agentCanFix: true, auth: false }, { keepIntent: true });
    sync = Y.syncMain(t, tree);
    if (sync.status === "conflict") return void Y.conflictBack(id, g, tree, sync, (failure, seen) => { fail(g, failure, { keepIntent: true, patch: seen }); });
    // Main could not be read: work that was not brought up to date is never reviewed or put up for approval as if it were.
    if (sync.status === "error") return void fail(g, { stage: "merge", phase: "fetch", title: "Could not synchronize main", detail: `Branch: ${t.branch}\nFolder: ${tree}\n\n${sync.detail}`, next: "Investigate the fetch/Git error and fix what you safely can without altering the human's checkout. Finish again so the board retries the sync." }, { keepIntent: true });
  }
  if (sync) t = g.set((t) => Y.seenPatch(t, sync));
  // A clean update that touched none of the files the task changed leaves its review standing: the check runs again
  // on the merged result, the reviewer is not asked twice about the same change.
  // So does work that passed its review and has only taken main in since, also into its own files and with conflicts
  // resolved (Y.mergeOnly is the rule): the check is what proves the merged result, so there must be one. Anything
  // the agent did beyond the merge, a review that did not pass: reviewed again, as ever.
  let kept = sync?.status === "merged" && sync.overlap && !sync.overlap.length && t.reviewedHead === sync.before ? S.currentReview(t) : null;
  let keptHow = kept ? { from: sync.before, merges: 1, resolved: [] } : null;
  const passedAt = !kept && repo.check && tree && sync?.target && ch["review.when"] !== "never" ? S.passedReview(t) : null;
  if (passedAt) {
    const m = Y.mergeOnly(tree, passedAt.head, sync.target);
    // Where the task merges with nobody's yes, only the board's own clean merge of main stands in for a review: a
    // merge whose conflicts the agent resolved is new work there, and is reviewed.
    if (m.ok && !(m.resolved.length && mergesItself(t))) { kept = passedAt.review; keptHow = { from: m.from, merges: m.merges, resolved: m.resolved }; }
  }
  if (t.setupPending && repo.setup) {
    const setup = await sh(repo.setup, folder, env, { alive });
    if (setup.aborted) return;
    if (!setup.ok) return void fail(g, { stage: "setup", title: "Setup still fails", detail: `Command: ${repo.setup}\nFolder: ${folder}\n\n${setup.out}`, next: "Fix the setup problem and finish again. Setup must pass before the check." });
    g.set({ setupPending: false });
  }
  if (repo.check && !research) {
    const r = await runCheck(g, t, { cmd: repo.check, folder, env, alive, root, timeoutMin: S.ms(ch["check.timeout"]) / 60000 });
    if (r.aborted) return;
    if (!r.ok) {
      const merged = kept ? " The branch was only re-merged with main since its review passed, so the tests ran instead of a new review." : "";
      const fails = (S.get(id).checkFails || 0) + 1, last = fails > ch["review.rounds"]; // it goes back by itself `review.rounds` times
      const auth = S.isAuthFailure(r.out);
      const failure = { stage: "check", auth, agentCanFix: true, title: `Check failed${last && fails > 1 ? ` after ${fails} tries` : ""}`, ...(last && fails > 1 ? { msg: `The check still fails after ${fails} tries (${repo.check}): ${r.out.split("\n").filter(Boolean).slice(-1)[0] || ""}` } : {}), detail: `Command: ${repo.check}\nFolder: ${folder}\n\n${r.out}`, next: "Fix the failed check, run it again and finish for a fresh review." };
      if (last || auth) return void fail(g, failure, { patch: { checkFails: fails } });
      g.check();
      // Straight back to the agent. The turn it causes is the plugin's own: an approved merge survives it.
      F.sendOwn(id, `The check failed, so this is not done yet.${merged}\n\n${S.boundDetail(failure.detail)}\n\nFix it and finish again.`, { reason: "check", keepIntent: !!wake?.keepIntent || !!S.get(id).mergeIntent, patch: { checkFails: fails, ...S.failurePatch(failure), failure: { ...S.failurePatch(failure).failure, sentAt: Date.now() } } });
      return;
    }
  }
  g.check();
  // Push and open a draft pull request, when an origin remote exists.
  let note = research && !t.report ? " No report was found." : "";
  if (tree && ch["merge.pr"] && !research) {
    try {
      const hasCommits = Number(S.gitOut(tree, ["rev-list", "--count", `${t.baseSha || t.from || "HEAD"}..HEAD`])) > 0;
      if (hasCommits && F.hasOrigin(root)) {
        t = g.set({ stage: "pushing", msg: "Pushing the branch" });
        // The branch is the board's own and an agent may have rebuilt it on a newer base: overwrite what was pushed
        // before, but only while the remote still holds what was last seen here.
        S.gitOut(tree, ["push", "-u", "--force-with-lease", "origin", t.branch], { timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
        g.set({ prHead: S.gitOut(tree, ["rev-parse", `refs/remotes/origin/${t.branch}`]) });
        let url = t.pr || "";
        if (!url) {
          const r = F.gh(["pr", "create", "--draft", "--head", t.branch, "--title", t.title || id, "--body", `${text || t.title || ""}\n\nTask: ${S.taskRef(id)}`], tree);
          url = ((r.stdout || "").match(/https?:\/\/\S+/) || [""])[0];
          if (!url) return void fail(g, { stage: "pr", title: "Could not open the pull request", detail: `Branch: ${t.branch}\nFolder: ${tree}\n\ngh pr create:\n${outputOf(r)}`, next: "Inspect the GitHub error, fix what you safely can, then finish again. The board retries opening the pull request; do not push or ship manually." });
          g.set({ pr: url, prSeen: "", prState: "waiting" });
        }
        note = ` Pull request: ${url}`;
      }
    } catch (e) { return void fail(g, { stage: "push", title: "Could not push the branch", detail: `Branch: ${t.branch}\nFolder: ${tree}\n\n${outputOf(e)}`, next: "Inspect the Git error and fix what you safely can without altering the human's checkout. Finish again so the board retries the push." }); }
  }
  t = g.check();
  const change = tree && !research ? F.changeOf(t) : null;
  const toLand = !!(change && change.stat);
  // Done with nothing to merge leaves herdr's sidebar like merged work does; its branch goes only if git calls it merged.
  const tidyDone = async (id) => { const { tidy } = await import("../land.js"); await tidy(id, { deleteBranch: "merged" }); };
  const done = (msg, patch = {}) => { const mark = F.tidyMark(t, "merged"); const d = g.set((t) => { t.stage = "done"; t.tidy = mark; t.msg = S.oneLine(msg); t.failure = null; t.mergeIntent = null; Object.assign(t, patch); }); F.labelPane(d, null); return d; };
  // Nothing to land: it is simply done, unless work outside a repo is reviewed too (review "all").
  if (!toLand && ch["review.when"] !== "always" && !(research && ch["review.when"] !== "never")) {
    if (holdPrFailure(g, t)) return;
    done(`${firstLine(text) || "Finished"}${note}`);
    return void (await tidyDone(id));
  }
  // 4. An adversarial review before it reaches you. Its settings are read now, as the review starts.
  ch = S.work(S.get(id));
  let review = null;
  const reviewNeeded = ch["review.when"] !== "never";
  if (reviewNeeded && kept && toLand) {
    review = { ...kept, head: change.head, keptAt: Date.now(), kept: { ...keptHow, head: change.head, check: repo.check || "" } };
    g.set((t) => { S.logKept(t, review.kept); }); // the task's history says what happened instead of a review
  }
  else if (reviewNeeded) {
    const r = await runReview(id, g, { text, change, toLand, ch, check: repo.check });
    if (r.aborted) return;
    // The task keeps every review it had. A review the provider cut off is not one: it is not on the list.
    if (!r.cut) g.set((t) => { S.logReview(t, r.review || { error: r.error }); });
    if (!r.review) return void fail(g, { stage: "review", auth: r.auth ? true : undefined, title: r.auth ? "Needs a login" : "Review failed", msg: r.auth ? "The reviewer needs a login" : `Review failed: ${S.oneLine(r.error, 200)}. Retry the task to review again`, detail: `Review failed: ${r.error}`, next: "Investigate the reviewer failure, then finish again for a fresh review. Do not bypass review or merge approval." }, { patch: { review: null } });
    review = r.review;
    // The pull request says what the review found, the findings below the gate marked as not required.
    if (t.pr && toLand) { try { F.gh(["pr", "comment", F.prNumber(t.pr), "--body", G.prComment(review, S.reviewRound(S.get(id))) + F.BOARD_COMMENT], root, 60000); } catch {} }
  }
  // A merge the board itself was on its way to (`merge.by: itself`) is only kept while that setting still says so.
  t = g.set((t) => { t.failure = null; if (t.mergeIntent?.auto && !byItself(t)) t.mergeIntent = null; });
  // The loop: a review that fails the gate goes straight back, at most `review.rounds` times (0: never).
  // Then, still failing, it stops and waits for you.
  const rounds = t.reviewRounds || 0;
  const passed = !review || G.passes(review);
  if (review && !review.keptAt && !passed && rounds < ch["review.rounds"]) {
    F.sendOwn(id, G.reviewMessage(review), { reason: "review", keepIntent: !!t.mergeIntent, patch: { review: { ...review, stale: true }, reviewRounds: rounds + 1 } });
    return;
  }
  const head = change?.head || F.headOf(folder) || null;
  const { landCore } = await import("../land.js");
  if (t.mergeIntent) { // an approved merge being re-verified after a sync with main or a conflict repair
    if (review && !review.keptAt && !passed) return void fail(g, { stage: "review", title: "Approved merge repair is not ready", detail: `A reviewer went through the repair and found it not ready: ${G.result(review)}.\n\n${G.findingsText(review)}`, next: "The agent could not make this repair pass review. Address the findings before retrying.", agentCanFix: true });
    t = g.set((t) => { t.review = review; t.stat = change?.stat; t.reviewedHead = head; t.mergeIntent = { ...t.mergeIntent, verifiedHead: head }; });
    if (holdPrFailure(g, t)) return;
    t = g.set({ stage: "merging", msg: "Merging" });
    return void (await landCore(id, g));
  }
  if (!toLand) { done(`${review ? `${G.sentence(review, "accept")} ` : ""}${firstLine(text) || "Finished"}${note}`, { review }); return void (await tidyDone(id)); }
  t = g.set((t) => { t.review = review; t.stat = change.stat; t.reviewedHead = head; t.mergeFailed = false; });
  if (holdPrFailure(g, t)) return;
  // 5. A task that merges by itself (`merge.by`, read now: it may have changed while this ran) still
  // wants a review that passed the gate: one that failed it, you are asked.
  if (byItself(t) && !t.requireApproval && sync?.status !== "skip" && (!reviewNeeded || (review && passed))) {
    t = g.set((t) => { t.stage = "merging"; t.msg = "Merging"; t.mergeIntent = { approvedAt: Date.now(), repairs: 0, verifiedHead: head, auto: true }; });
    return void (await landCore(id, g));
  }
  // Finished work that waits for your yes is not done: it is blocked on you.
  // Checked and reviewed, but not against where it would land (your checkout is on another branch): not approvable yet.
  const behind = sync?.status === "skip" ? Y.skipWhy(sync) : "";
  t = g.set((t) => { t.stage = "approval"; t.msg = behind ? Y.behindMsg(behind) : approvalMessage(t, note); if (behind) t.syncBlocked = { why: behind, at: Date.now() }; });
  F.labelPane(t, F.labelOf(t));
}
// A pull-request blocker found by polling survives a passing local check: remote CI must confirm.
function holdPrFailure(g, t) {
  if (!t.prFailure) return false;
  const h = g.set((t) => { t.stage = "approval"; t.failure = null; t.msg = `Local checks passed; pull request still blocked: ${t.prFailure.title}. Wait for remote confirmation or send the details to the agent`; });
  F.labelPane(h, "failed");
  return true;
}
