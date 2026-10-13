// Talking to a task's agent: a reply, what every human-started turn does to a task, stop.
import * as S from "../store.js";
import * as F from "../flow.js";
import { spawnRunner, runnerAlive } from "../runner.js";
import { interruptKey } from "../agents.js";
import { AGENT_STAGES, say } from "./shared.js";
import { delegate } from "./start.js";
import { retry } from "./finish-line.js";
import { granted } from "../limits/run.js";
import { standingOf } from "../attempts/words.js";

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
  // Its attempts are under way: your words go to every one that is still in it. While it waits for your pick, nobody
  // is the task's agent yet.
  if (cur.stage === "attempts") {
    const live = S.attemptsOf(cur).filter((c) => ["works", "needs"].includes(standingOf(c)) && F.isAgentTask(c));
    if (!live.length) throw new Error(`${cur.id}: none of its attempts can take a message right now.`);
    const asking = live.filter((c) => standingOf(c) === "needs"); // an answer is for the ones that asked
    if (asking.length) live.splice(0, live.length, ...asking);
    for (const c of live) tell(c.id, words, { keepIntent });
    return say(S.get(cur.id), `Sent to ${live.length === 1 ? `attempt ${live[0].letter}` : `${live.length} attempts (${live.map((c) => c.letter).join(", ")})`}`);
  }
  if (cur.stage === "pick") throw new Error(`${cur.id} waits for you to pick one of its attempts. Pick first: your words then go to that one's agent.`);
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
  F.tellSidebar(t);
  const how = F.deliver(t, words);
  return say(S.get(t.id), how === "queued" ? "queued: open the agent and answer its dialog first" : "Sent to the agent");
}
// A task that just ended is being cleaned up: a reply waits for that, or its work would go with the worktree.
function cleaningUp(t) { if (t.stage === "done" && runnerAlive(t)) throw Object.assign(new Error(`${t.id} is cleaning up after it finished. Try again in a moment.`), { code: "BUSY" }); }
// What every human-started turn does to a task.
export function rearm(t, keepIntent = false) {
  cleaningUp(t);
  granted(t); // stopped at a limit: your word gives it the limit once more (limits/spent.js)
  t.tidy = null; t.waiting = null; t.cutRetry = null;
  if (t.failure?.stage === "send") t.failure = null; // what you say now goes into the same box, and out with what sat there (submit.js keeps both)
  t.armedAt = Date.now(); t.expectedWake = null; t.turnOpen = true; t.turnBy = "reply"; t.selfBlocked = null; t.blocked = null;
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
  // Every attempt stops with its task; one that waits for a pick, or is being compared, simply stops there.
  if (cur.attempts?.length && !cur.picked && ["attempts", "pick", "reviewing"].includes(cur.stage)) {
    for (const c of S.attemptsOf(cur)) if (["works", "needs", "waits"].includes(standingOf(c))) { try { stop(c.id); } catch {} }
    const t = S.update(cur.id, (t) => { t.stage = "stopped"; t.stoppedAt = Date.now(); t.msg = ""; t.comparing = null; t.watch = null; });
    if (t.runner && t.runner.pid !== process.pid && S.markerAlive(t.runner)) { try { process.kill(-t.runner.pid, "SIGTERM"); } catch { try { process.kill(t.runner.pid, "SIGTERM"); } catch {} } }
    if (t.link?.reviewer?.pane) { try { F.closeReviewerTab(F.h(t), t.link.reviewer); } catch {} }
    return S.get(t.id);
  }
  if (!F.isAgentTask(cur) || cur.stage === "queued") return S.update(cur.id, (t) => { if (!AGENT_STAGES.includes(t.stage)) throw new Error(`${t.id} is not working.`); t.stage = F.isAgentTask(t) ? "stopped" : "todo"; if (!F.isAgentTask(t)) t.app = null; t.msg = ""; });
  let a = null;
  try { F.assertLive(cur); a = F.h(cur).agentGet(cur.link.pane); } catch {}
  const t = S.update(cur.id, (t) => {
    t.stage = "stopped"; t.stoppedAt = Date.now(); t.stopSeq = a?.state_change_seq ?? t.last?.seq ?? 0; t.sawIdleAfterStop = false;
    t.expectedWake = null; t.turnOpen = false; t.msg = ""; t.watch = null; t.mergeIntent = null; t.waiting = null; t.limitStop = null;
  });
  if (t.runner && t.runner.pid !== process.pid && S.markerAlive(t.runner)) { try { process.kill(-t.runner.pid, "SIGTERM"); } catch { try { process.kill(t.runner.pid, "SIGTERM"); } catch {} } }
  if (a && ["working", "blocked", "unknown"].includes(a.agent_status)) { try { F.h(t).agentKeys(t.link.pane, interruptKey(t.agent)); } catch {} }
  if (t.link.reviewer?.pane) F.closeReviewerTab(F.h(t), t.link.reviewer);
  F.tellSidebar(t);
  return S.get(t.id);
}
