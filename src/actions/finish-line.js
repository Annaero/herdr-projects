// The finish line's keys: approve, send the review or the failure back, finish anyway, retry.
import fs from "node:fs";
import * as S from "../store.js";
import { currentSocket } from "../herdr.js";
import * as F from "../flow.js";
import { spawnRunner, runnerAlive } from "../runner.js";
import * as G from "../gate.js";
import { say } from "./shared.js";
import { report } from "./filing.js";
import { delegate } from "./start.js";
import { tell, stop } from "./talk.js";
import { name as keyName } from "../board/keys.js";
import { isResearch } from "../research.js";

// ---- the finish line's keys -------------------------------------------------------------------------------------------
// Approve: the one decision that ships finished work. An agent's own request for permission gets a yes instead.
// `seen`: what the human was shown when they said yes ({ pr, head }). A merge is only ever what was asked about: if
// the pull request or the reviewed commit is another one by now, nothing is merged and they are asked again.
export function approve(id, seen = null) {
  const cur = S.find(id);
  S.assertUnarchived(cur);
  const moved = (t) => { if (seen && t.stage === "approval" && ((seen.pr ?? null) !== (t.pr ?? null) || (seen.head ?? null) !== (t.reviewedHead ?? null))) throw new Error(`${t.id} changed while you were asked. Nothing was merged: look at it again, then approve.`); };
  moved(cur);
  if (cur.stage === "asks" && cur.kind === "permission") return tell(cur.id, "Yes, go ahead.");
  if (isResearch(cur)) throw new Error(`${cur.id} is research only: nothing of it is merged. To merge its change after all, turn that off first: config research false --id ${cur.id}`);
  const t = S.update(cur.id, (t) => {
    if (t.stage !== "approval") throw new Error(`${t.id} is not waiting for an approval to merge.`);
    moved(t);
    // Main moved and the board could not bring this branch up to date yet: what was reviewed is not what would land.
    if (t.syncBlocked) throw new Error(`${t.id} is behind main and cannot be approved yet: ${t.syncBlocked.why}. The board keeps trying to bring it up to date.`);
    if (runnerAlive(t)) throw new Error(`${t.id} is busy. Try again in a moment.`);
    t.stage = "merging"; t.msg = "merging"; t.requireApproval = false; t.since = Date.now(); t.mergeFailed = false;
    t.mergeIntent = { approvedAt: Date.now(), repairs: t.mergeIntent?.repairs || 0, verifiedHead: t.reviewedHead || null };
  });
  F.labelPane(t, null);
  spawnRunner("land", t.id);
  return say(t, `${t.id}: approved, merging`);
}
// Sending the board's own words back (a review, a failure's details) is not stepping into the task: you added
// nothing of your own, and what the agent then does is checked and reviewed like any other turn. So it leaves the
// approval you are owed as it was: with `autoMerge` on, the repair merges by itself once it passes.
const owedOf = (t) => !!t.requireApproval;
// Hand the reviewer's findings to the working agent. By hand any time; by itself when the review fails the gate.
export function sendReview(id) {
  const cur = S.find(id);
  const owed = owedOf(cur);
  S.assertUnarchived(cur);
  const rv = cur.review;
  if (!rv || !rv.text) throw new Error(`${cur.id} has no review to send.`);
  if (!G.sendable(rv)) throw new Error(G.isTagged(rv) ? `${cur.id}: the review found nothing for the agent to fix, so there is nothing to send back.` : `${cur.id} was rated 5 out of 5: there is nothing to send back.`);
  const out = tell(cur.id, G.reviewMessage(rv, { all: true }));
  S.update(cur.id, (t) => { t.reviewRounds = (cur.reviewRounds || 0) + 1; t.requireApproval = owed; });
  return say(out.task, `${cur.id}: review sent to the agent`);
}
// Send the saved error, not stale review feedback, to the task's agent.
const loginOf = (t) => (t?.stage === "failed" && t.failure?.auth) || (t?.stage === "asks" && t.kind === "auth");
// An agent's own login problem can be retried once the human has logged in; a login problem of the workflow (a
// failed push, a check) is retried by finishing again.
export const canSendError = (t) => (t?.stage === "nosummary" || (t?.stage === "failed" && (!t.failure?.auth || t.failure.stage === "agent"))) && F.isAgentTask(t) && !t.archivedAt;
export function sendError(id) {
  const cur = S.find(id);
  S.assertUnarchived(cur);
  if (cur.stage === "failed" && cur.failure?.stage === "send") return retry(cur.id); // nothing reached the agent: there is no error of its own to send
  if (cur.stage === "nosummary" || (cur.stage === "failed" && cur.failure?.auth && cur.failure.stage === "agent")) { const out = tell(cur.id, F.withTail(cur, "You stopped before the work was finished. Continue the task where you left off.")); return say(out.task, `${cur.id}: told the agent to continue`); }
  if (!canSendError(cur)) throw new Error(`${cur.id} has no agent error to send. Login blockers need the human first.`);
  const why = cur.failure?.detail || cur.msg || "No details were saved.";
  const out = tell(cur.id, `This task ran into an error:\n\n${cur.failure?.title ? `${cur.failure.title}\n\n` : ""}${why}\n\nInvestigate and fix the cause, then finish again. Run the checks before finishing. If a login, permission or human decision is needed, report blocked instead of retrying it yourself.`);
  S.update(cur.id, (t) => { if (t.failure) t.failure = { ...t.failure, sentAt: Date.now() }; });
  return say(out.task, `${cur.id}: sent to the agent to fix`);
}
// The failure a task shows, with what to do next. An ordinary request for merge approval is not a failure.
export function failureOf(t) {
  // A login problem comes first: older failure details are not shown or sent while the agent cannot work.
  if (loginOf(t)) return { stage: "agent", title: "Needs a login", detail: t.failure?.auth ? t.failure.detail : t.msg || "The agent needs a login, token or credential.", auth: true, agentCanFix: false, at: t.failure?.at, next: `Fix the login or credential, then reply, or press ${keyName("yes")} to tell the agent to try again.` };
  const f = t.failure || t.prFailure;
  if (f) return !f.remote && t.prFailure && t.failure && !String(f.detail || "").includes(t.prFailure.detail) ? { ...f, detail: `${f.detail}\n\nPull request blocker:\n${t.prFailure.detail}` } : f;
  if (t.stage === "nosummary") return { stage: "agent", title: "Stopped without a summary", detail: t.msg || "The agent stopped without writing its closing note.", agentCanFix: true, plain: true, next: `${keyName("sendBack")} tells the agent to continue; ${keyName("yes")} takes the work as it is, with what is on its screen as the summary.` };
  return null;
}
// ctrl+r: send the failure details to the task's own agent. Never approves a merge.
export function sendFailure(id) {
  const cur = S.find(id);
  S.assertUnarchived(cur);
  const f = failureOf(cur), owed = owedOf(cur);
  if (!f) throw new Error(`${cur.id} has nothing that went wrong to send.`);
  if (!f.agentCanFix) throw new Error(f.next || "This needs the human first.");
  if (cur.stage === "merging" && runnerAlive(cur)) throw new Error("Wait for the merge to finish before sending repair details.");
  if (f.sentAt && cur.stage === "working") throw new Error("These details are already with the agent.");
  const mergeRetry = f.phase === "sync" && !!cur.mergeIntent;
  const text = `The workflow is blocked: ${f.title}\n\n${f.detail}\n\nNext step: ${f.next || "Investigate and fix it."}\n\nResolve what you safely can in your own working folder, run the checks, then finish again so the board continues its review and approval workflow. This is not permission to ship, delete work, alter the human's checkout, or bypass a login or required approval. If you need the human, report blocked and explain what is needed.${mergeRetry ? " The human already approved this merge. After this main-branch conflict repair, the board rechecks, reviews and retries that approved merge; do not push or merge into the human's branch yourself." : ""}`;
  F.assertLive(cur);
  F.cancelAutoMerge(cur);
  if (mergeRetry) {
    // The plugin's own turn: the approved merge survives the repair.
    const how = F.sendOwn(cur.id, text, { reason: "conflict", keepIntent: true, patch: { mergeIntent: { ...cur.mergeIntent, repairs: (cur.mergeIntent.repairs || 0) + 1 }, failure: { ...f, sentAt: Date.now() } } });
    return say(S.get(cur.id), how === "queued" ? "queued: open the agent and answer its dialog first" : `${cur.id}: sent to the agent to fix`);
  }
  const out = tell(cur.id, text);
  S.update(cur.id, (t) => { t.requireApproval = owed; const cf = t.failure || t.prFailure; if (cf) { const sent = { ...cf, sentAt: Date.now() }; if (t.failure) t.failure = sent; else t.prFailure = sent; } });
  return say(out.task, out.msg.startsWith("queued") ? out.msg : `${cur.id}: sent to the agent to fix`);
}
// "Finish anyway": run the pipeline on a turn that left no closing note, with the screen text as the summary.
export function finishAnyway(id) {
  const cur = S.find(id);
  S.assertUnarchived(cur);
  if (cur.stage !== "nosummary") throw new Error(`${cur.id} did not stop without a summary.`);
  const t = S.update(cur.id, (t) => { if (t.stage !== "nosummary" || runnerAlive(t)) throw new Error(`${t.id} is busy.`); t.stage = "checking"; t.msg = ""; t.since = Date.now(); });
  spawnRunner("pipeline", t.id);
  return say(t, `${t.id}: taking the work as it is`);
}
// "Retry": do again the step that went wrong, as it stands, with nothing sent to the agent to fix.
export function retry(id) {
  const cur = S.find(id);
  S.assertUnarchived(cur);
  if (cur.stage === "approval") return approve(cur.id); // a merge that failed
  const carryOn = () => { const out = tell(cur.id, F.withTail(cur, "You stopped before the work was finished. Continue the task where you left off.")); return say(out.task, `${cur.id}: told the agent to continue`); };
  // The agent said it needs a login: you have signed in, and it is told to carry on.
  if (cur.stage === "asks" && cur.kind === "auth") return carryOn();
  if (cur.stage !== "failed") throw new Error(`${cur.id} has nothing to retry.`);
  const f = cur.failure || {};
  // The agent never started on what was typed into its box: its program is started again and handed the same text.
  if (f.stage === "send" && cur.unsent) {
    F.assertLive(cur);
    const t = S.update(cur.id, (t) => { if (t.stage !== "failed" || runnerAlive(t)) throw new Error(`${t.id} is busy. Try again in a moment.`); t.stage = "working"; t.msg = "starting the agent again"; t.since = Date.now(); t.armedAt = Date.now(); });
    spawnRunner("restart", t.id);
    return say(t, `${t.id}: starting the agent again with the same text`);
  }
  // It never got going: put an agent on it again.
  if (!F.isAgentTask(cur) || ["start", "setup"].includes(f.stage)) return say(delegate(cur.id), `${cur.id}: starting again`);
  // The agent itself stopped (an error, a login you have fixed since): it is told to carry on.
  if (f.stage === "agent") return carryOn();
  // A step of the finish line (the check, the push, the pull request, the review, the merge): run it again.
  F.assertLive(cur);
  const t = S.update(cur.id, (t) => { if (t.stage !== "failed" || runnerAlive(t)) throw new Error(`${t.id} is busy. Try again in a moment.`); t.stage = "checking"; t.msg = ""; t.since = Date.now(); });
  spawnRunner("pipeline", t.id);
  return say(t, `${t.id}: trying again`);
}
// The herdr action "approve the task in the focused pane" has no screen to ask on: it leaves the request here and
// opens the board, which asks "Merge?" before anything is merged.
const approveFile = () => `${S.dataDir()}/approve-request.json`;
export function askApprove(id, socket = currentSocket()) { S.writeJson(approveFile(), { id, socket, at: Date.now() }); }
export function takeApprove(socket = currentSocket()) {
  const q = S.readJson(approveFile());
  if (!q || q.socket !== socket) return "";
  try { fs.rmSync(approveFile(), { force: true }); } catch {}
  return Date.now() - q.at < 15000 ? String(q.id || "") : "";
}
export function details(id) {
  const t = S.find(id);
  return { task: { id: t.id, title: t.title, stage: t.stage, msg: t.msg, description: t.description }, failure: failureOf(t), review: S.currentReview(t) || null, reviews: S.reviewHistory(t), suggestions: S.suggestionsOf(t), research: isResearch(t), report: t.report || null, pr: t.pr || null, worktree: t.worktree || null, branch: t.branch || null };
}
