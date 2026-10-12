// The exact actions of the board, also the subcommands any agent can run from its shell. Each one only records a
// request under the task lock and, when a long job follows, starts the detached runner; none of them waits for it.
import fs from "node:fs";
import * as S from "./store.js";
import { herdr, currentSocket } from "./herdr.js";
import * as F from "./flow.js";
import { spawnRunner, runnerAlive } from "./runner.js";
import { interruptKey } from "./agents.js";
import * as G from "./gate.js";

const AGENT_STAGES = ["queued", ...S.SLOT_STAGES];
const say = (t, msg) => ({ task: t, msg });

// ---- filing and editing ----------------------------------------------------------------------------------------------
export function add(folder, title, { description = "", repo } = {}) {
  return S.create(S.folderFor(repo, folder), title, { description });
}
export function rename(id, title) { return S.update(S.find(id).id, (t) => { S.assertUnarchived(t); t.title = S.oneLine(title, 192) || t.title; }); }
export function describe(id, text) { return S.update(S.find(id).id, (t) => { S.assertUnarchived(t); t.description = String(text || "").replace(/\r/g, "").trim(); }); }
export function pin(id) { return S.update(S.find(id).id, (t) => { S.assertUnarchived(t); t.pinned = !t.pinned; }); }

// A report, as in pi-work: the human (or any agent) says where a task stands. A delegated task's own agent may only
// say it is blocked; it cannot mark itself done: the finish line does that.
export function report(id, { state, kind, msg, title, progress, eta, asAgent = false } = {}) {
  const cur = S.find(id);
  if (title && !state) return rename(cur.id, title);
  if (!["idle", "working", "blocked", "done", "error"].includes(state)) throw new Error("state must be one of: idle, working, blocked, done, error");
  if (asAgent && state !== "blocked") throw new Error("Do not report done yourself. Finish your work and stop; the board runs the check and marks it done. (Use --state blocked if you need the human.)");
  // "Mark it idle" on a task whose agent is working means "stop it": the same stop as the stop command.
  if (state === "idle" && !asAgent && F.isAgentTask(cur) && AGENT_STAGES.includes(cur.stage)) return stop(cur.id);
  const delegated = F.isAgentTask(cur) && AGENT_STAGES.concat(["asks", "nosummary", "approval", "reviewneeds", "failed"]).includes(cur.stage);
  const mark = state === "done" ? F.tidyMark(cur, "merged") : null;
  const t = S.update(cur.id, (t) => {
    S.assertUnarchived(t);
    if (title) t.title = S.oneLine(title, 192) || t.title;
    if (state === "blocked") {
      t.stage = "asks"; t.kind = S.KINDS.includes(kind) ? kind : "question"; t.msg = S.oneLine(msg) || "needs you"; t.turnOpen = false;
      if (asAgent) t.selfBlocked = Date.now(); // the turn that follows this report is not a finish
      return;
    }
    if (delegated && runnerAlive(t)) throw new Error(`${t.id} is in the middle of a workflow step. Stop it first.`);
    t.kind = undefined; t.msg = S.oneLine(msg); t.failure = state === "error" ? t.failure : null;
    if (state === "idle") { t.stage = F.isAgentTask(t) ? "stopped" : "todo"; if (!F.isAgentTask(t)) t.app = null; }
    else if (state === "working") { if (F.isAgentTask(t)) throw new Error(`${t.id} has an agent. Reply to it, or delegate it again, to make it work.`); t.stage = "progress"; t.app = t.owner; t.since = Date.now(); if (progress !== undefined || eta !== undefined) t.watch = { progress: progress === undefined ? t.watch?.progress : clampPct(progress), eta: eta === undefined ? t.watch?.eta : S.minutes(eta) }; } // one given alone keeps the other
    else if (state === "done") { t.stage = "done"; t.mergeIntent = null; t.tidy = F.isAgentTask(t) ? mark : null; }
    else if (state === "error") { t.stage = "failed"; Object.assign(t, S.failurePatch({ stage: "agent", title: "Marked as failed", detail: S.oneLine(msg) || "No details given.", auth: false })); }
  });
  // Called done by you: its space leaves herdr's sidebar as after a merge. Unmerged work stays on its branch.
  if (state === "done" && F.isAgentTask(t)) { try { F.labelPane(t, null); } catch {} spawnRunner("cleanup", t.id, ["--merged"]); }
  return t;
}
const clampPct = (p) => Math.max(0, Math.min(100, Math.round(Number(p)) || 0));

// ---- delegate --------------------------------------------------------------------------------------------------------
// Records the request (stage "queued") and lets the housekeeping pass start it when a slot is free.
export function delegate(id, opts = {}) {
  const cur = S.find(id);
  for (const k of [...S.PER_TASK, "reviewAuto"]) if (opts[k] !== undefined && opts[k] !== null && opts[k] !== "") S.setTaskConfig(cur.id, k, opts[k]);
  const socket = currentSocket();
  let old = null; // the last round's space, when its clean-up had not managed to close it yet
  const t = S.update(cur.id, (t) => {
    S.assertUnarchived(t);
    if (AGENT_STAGES.includes(t.stage) || runnerAlive(t)) throw new Error(`${t.id} already has an agent working on it.`);
    if (t.autoMerge) throw new Error(`${t.id} is waiting for an automatic merge. Reply to its agent to cancel that first.`);
    if (t.link?.socket && t.link.socket !== socket) throw new Error(`${t.id} lives in another herdr session. Open the board there.`);
    if (opts.worktree === true || opts.worktree === false) t.worktreeMode = opts.worktree ? "own" : "none";
    if (opts.base === "fresh" || opts.base === "head") t.base = opts.base;
    // Work that already landed and was cleaned up starts a new round in a fresh worktree, never in your checkout.
    if (F.cleanedUp(t)) {
      if (t.link?.workspace && t.link.ownsWorkspace) old = { socket: t.link.socket, workspace: t.link.workspace };
      for (const k of ["startedOnce", "startedAgentAt", "cleaned", "worktree", "branch", "from", "baseSha", "pr", "prMerged", "prState", "prHead", "prSeen", "prFeedbackSeen", "prFailure", "review", "reviewedHead", "syncedTo", "syncSeen", "syncBranch", "syncRepairs", "syncRetryAt", "syncBlocked", "handled", "session", "said", "summary", "stat", "kept", "tidy", "exitedAt", "repoCfg"]) delete t[k];
      t.link = {};
    }
    t.agent = S.choices(t).agent || "claude";
    t.app = t.agent;
    t.stage = "queued"; t.queuedAt = Date.now(); t.msg = ""; t.kind = undefined; t.since = Date.now(); t.watch = null;
    t.link = { ...(t.link || {}), socket };
    t.mergeIntent = null; t.requireApproval = t.requireApproval || !!t.review; t.failure = null; t.expectedWake = null; t.turnOpen = false;
    if (t.review) t.review = { ...t.review, stale: true };
    t.checkFails = 0; t.reviewRounds = 0; t.prRounds = 0; t.syncRepairs = 0;
  });
  if (old) F.closeLater(old.socket, old.workspace);
  F.labelPane(t, null);
  startQueued(socket);
  return S.get(t.id);
}
// Start queued tasks while slots are free. Counting and claiming happen under one global lock, so two passes cannot
// both take the last slot. A turn the human started in an agent's terminal counts toward the total.
export function startQueued(socket = currentSocket()) {
  const started = [];
  S.withLock("slots", () => {
    const all = S.list();
    let busy = all.filter((t) => S.SLOT_STAGES.includes(t.stage) && !t.autoMerge).length; // a remembered auto-merge runs nothing
    const waiting = all.filter((t) => t.stage === "queued" && t.link?.socket === socket).sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0));
    for (const w of waiting) {
      if (busy >= S.config().max) break;
      const t = S.update(w.id, (t) => { if (t.stage !== "queued") return false; t.stage = "starting"; t.msg = ""; });
      if (t.stage !== "starting") continue;
      busy++;
      started.push(t.id);
    }
  }, { waitMs: 5000 });
  for (const id of started) spawnRunner("delegate", id);
  return started;
}

// ---- talking to the agent --------------------------------------------------------------------------------------------
// A reply from the board is a human turn: it re-arms the pipeline, revokes an approval, cancels a pending
// auto-merge and marks the old review stale, exactly as typing in the agent's own terminal does.
export function tell(id, text, { keepIntent = false } = {}) {
  const cur = S.find(id);
  S.assertUnarchived(cur);
  const words = String(text || "").trim();
  if (!words) throw new Error("Nothing to send.");
  // A reply to a task that never had an agent starts one with that message, through the normal delegation path, so
  // the slot limit and the queue apply.
  if (!F.isAgentTask(cur) && ["todo", "progress"].includes(cur.stage)) {
    S.queueText(cur.id, words);
    return say(delegate(cur.id), `${cur.id}: an agent is starting on it with your message`);
  }
  // A reply to work that ended and was cleaned up starts a new round with that message, in a fresh worktree.
  cleaningUp(cur);
  if (cur.stage === "done" && F.cleanedUp(cur)) {
    S.queueText(cur.id, words);
    return say(delegate(cur.id), `${cur.id}: an agent is starting a new round with your message`);
  }
  F.assertLive(cur);
  if (cur.stage === "merging" && runnerAlive(cur) && !cur.autoMerge) throw new Error("Wait for the merge to finish before replying.");
  F.cancelAutoMerge(cur); // a failure sends nothing and keeps the draft
  const live = F.liveOf(cur, F.readSession(cur.link.socket));
  if (live.gone || live.status == null) { // the agent has exited: start it again, with the words waiting for it
    S.queueText(cur.id, words);
    S.update(cur.id, (t) => rearm(t, keepIntent));
    spawnRunner("restart", cur.id);
    return say(S.get(cur.id), "The agent had exited: starting it again with your message.");
  }
  const t = S.update(cur.id, (t) => rearm(t, keepIntent));
  F.labelPane(t, null);
  const how = F.deliver(t, words);
  return say(S.get(t.id), how === "queued" ? "queued: open the agent and answer its dialog first" : "Sent to the agent");
}
// A task that just ended is being cleaned up: a reply waits for that, or its work would go with the worktree.
function cleaningUp(t) { if (t.stage === "done" && runnerAlive(t)) throw Object.assign(new Error(`${t.id} is cleaning up after it finished. Try again in a moment.`), { code: "BUSY" }); }
// What every human-started turn does to a task.
export function rearm(t, keepIntent = false) {
  cleaningUp(t);
  t.tidy = null;
  t.armedAt = Date.now(); t.expectedWake = null; t.turnOpen = true; t.turnBy = "reply"; t.selfBlocked = null;
  if (t.failure?.auth) t.failure = null; // a reply or a retry after a login problem is how "fixed" is said
  if (!keepIntent) { if (t.mergeIntent || t.stage === "approval") t.requireApproval = true; t.mergeIntent = null; }
  if (t.review && !t.review.stale) t.review = { ...t.review, stale: true };
  t.checkFails = 0; t.reviewRounds = 0; t.prRounds = 0; t.syncRepairs = 0;
  t.stage = "working"; t.msg = ""; t.kind = undefined; t.watch = null; t.app = t.agent || t.app; t.since = Date.now(); t.mergeFailed = false;
}
// Stop: the stage is set first and the pane's state_change_seq recorded, then the interrupt key is sent, so a late
// hook cannot undo the stop.
export function stop(id) {
  const cur = S.find(id);
  S.assertUnarchived(cur);
  if (cur.stage === "progress") return S.update(cur.id, { stage: "todo", app: null, msg: "" });
  if (!F.isAgentTask(cur) || cur.stage === "queued") return S.update(cur.id, (t) => { if (!AGENT_STAGES.includes(t.stage)) throw new Error(`${t.id} is not working.`); t.stage = F.isAgentTask(t) ? "stopped" : "todo"; if (!F.isAgentTask(t)) t.app = null; t.msg = ""; });
  let a = null;
  try { F.assertLive(cur); a = F.h(cur).agentGet(cur.link.pane); } catch {}
  const t = S.update(cur.id, (t) => {
    t.stage = "stopped"; t.stoppedAt = Date.now(); t.stopSeq = a?.state_change_seq ?? t.last?.seq ?? 0; t.sawIdleAfterStop = false;
    t.expectedWake = null; t.turnOpen = false; t.msg = ""; t.watch = null; t.mergeIntent = null;
  });
  if (t.runner && t.runner.pid !== process.pid && S.markerAlive(t.runner)) { try { process.kill(-t.runner.pid, "SIGTERM"); } catch { try { process.kill(t.runner.pid, "SIGTERM"); } catch {} } }
  if (a && ["working", "blocked", "unknown"].includes(a.agent_status)) { try { F.h(t).agentKeys(t.link.pane, interruptKey(t.agent)); } catch {} }
  if (t.link.reviewer?.pane) F.h(t).paneClose(t.link.reviewer.pane);
  F.labelPane(t, null);
  return S.get(t.id);
}

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
  if (cur.stage !== "approval") throw new Error(`${cur.id} is not waiting for an approval to merge.`);
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
// Hand the reviewer's findings to the working agent. By hand any time; by itself when the review fails the gate.
export function sendReview(id) {
  const cur = S.find(id);
  S.assertUnarchived(cur);
  const rv = cur.review;
  if (!rv || !rv.text) throw new Error(`${cur.id} has no review to send.`);
  if (!G.sendable(rv)) throw new Error(G.isTagged(rv) ? `${cur.id}: the review found nothing for the agent to fix, so there is nothing to send back.` : `${cur.id} was rated 5 out of 5: there is nothing to send back.`);
  const out = tell(cur.id, G.reviewMessage(rv, { all: true }));
  S.update(cur.id, (t) => { t.reviewRounds = (cur.reviewRounds || 0) + 1; });
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
  if (loginOf(t)) return { stage: "agent", title: "Needs a login", detail: t.failure?.auth ? t.failure.detail : t.msg || "The agent needs a login, token or credential.", auth: true, agentCanFix: false, at: t.failure?.at, next: "Fix the login or credential, then reply, or press ctrl+a to tell the agent to try again." };
  const f = t.failure || t.prFailure;
  if (f) return !f.remote && t.prFailure && t.failure && !String(f.detail || "").includes(t.prFailure.detail) ? { ...f, detail: `${f.detail}\n\nPull request blocker:\n${t.prFailure.detail}` } : f;
  if (t.stage === "nosummary") return { stage: "agent", title: "Stopped without a summary", detail: t.msg || "The agent stopped without writing its closing note.", agentCanFix: true, plain: true, next: "ctrl+r tells the agent to continue; ctrl+a takes the work as it is, with what is on its screen as the summary." };
  return null;
}
// ctrl+r: send the failure details to the task's own agent. Never approves a merge.
export function sendFailure(id) {
  const cur = S.find(id);
  S.assertUnarchived(cur);
  const f = failureOf(cur);
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
  S.update(cur.id, (t) => { const cf = t.failure || t.prFailure; if (cf) { const sent = { ...cf, sentAt: Date.now() }; if (t.failure) t.failure = sent; else t.prFailure = sent; } });
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
  return { task: { id: t.id, title: t.title, stage: t.stage, msg: t.msg, description: t.description }, failure: failureOf(t), review: S.currentReview(t) || null, reviews: S.reviewHistory(t), pr: t.pr || null, worktree: t.worktree || null, branch: t.branch || null };
}

// ---- archive, restore, clear -----------------------------------------------------------------------------------------
// Archive closes the task's herdr workspace (the agent ends with it) and keeps everything else.
export function archive(id) {
  const cur = S.find(id);
  if (cur.archivedAt) return cur;
  let workspace = null, socket = null;
  const t = S.update(cur.id, (t) => {
    if (t.archivedAt) return false;
    if (runnerAlive(t) && t.runner.job === "cleanup") throw Object.assign(new Error(`${t.id} is busy cleaning up after its merge. Try again in a moment.`), { code: "BUSY" });
    if (S.SLOT_STAGES.includes(t.stage) || t.stage === "queued" || runnerAlive(t) || t.autoMerge || t.mergeIntent) throw new Error(`${t.id} is still active. Stop its agent first; an automatic merge must finish first.`);
    t.archivedAt = Date.now();
    if (t.link?.workspace && t.link.ownsWorkspace) { workspace = t.link.workspace; socket = t.link.socket; }
  });
  if (workspace && socket === currentSocket()) { try { herdr(socket).workspaceClose(workspace); } catch {} F.closeRepoSpace(herdr(socket), S.folderOf(t.id)); }
  return t;
}
// Restore changes nothing in herdr and starts nothing.
export function restore(id) { return S.update(S.find(id).id, (t) => { t.archivedAt = null; }); }
// Clear: stop the agent, run teardown, remove the worktree without force, delete the branch only if merged.
// A checkout with unsaved or unmerged work is kept and the caller is told where.
export async function clear(id) {
  const cur = S.find(id);
  if (S.SLOT_STAGES.includes(cur.stage) && F.isAgentTask(cur) && !cur.archivedAt) { try { stop(cur.id); } catch {} }
  const { cleanup } = await import("./land.js");
  const t = S.get(cur.id);
  if (!t) return { id: cur.id, kept: [] };
  if (runnerAlive(t)) { try { process.kill(t.runner.pid, "SIGTERM"); } catch {} }
  // Removing the worktree is a clean-up like the one after a merge: it holds a runner marker while it runs.
  try { S.update(cur.id, (t) => { t.runner = S.marker({ job: "cleanup" }); }, { waitMs: 5000 }); } catch {}
  const kept = await cleanup(t, { deleteBranch: "merged" }); // herdr and git calls: never under the task lock
  S.withTaskLock(cur.id, () => S.remove(cur.id), { waitMs: 5000 });
  return { id: cur.id, kept };
}

// ---- the human's own tasks -------------------------------------------------------------------------------------------
export function startHuman(id) { return report(id, { state: "working" }); }
export function existsWorktree(t) { return !!t.worktree && fs.existsSync(t.worktree); }
