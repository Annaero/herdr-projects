// What you do to a task a limit stopped: carry on, or take its work as it is. (A reply to its agent carries on too,
// with your own words: actions/talk.js.)
import * as S from "../store.js";
import * as F from "../flow.js";
import * as G from "../gate.js";
import { spawnRunner, runnerAlive } from "../runner.js";
import { say } from "./shared.js";
import { tell } from "./talk.js";
import { sendReview } from "./finish-line.js";
import { stoppedAtLimit, usedSay, granted } from "../limits.js";
import { approvalMessage } from "../finish/shared.js";
import { behindMsg } from "../sync.js";

const what = (ls) => (ls.what === "time" ? `${ls.limit} for one run` : `${ls.limit} tokens`);
// Carry on from where it stopped. `raised`: the board does it, because the limit was raised or taken away: the run
// then goes on from the time it had taken, and the tokens count as before. Said by you, the task has its limit once
// more. A stopped agent is told to continue; a stopped review is done again; a review that was kept goes to the
// agent; work that was ready is put up for approval.
export function carryOn(id, { raised = false } = {}) {
  const cur = S.find(id);
  S.assertUnarchived(cur);
  if (!stoppedAtLimit(cur)) throw new Error(`${cur.id} was not stopped at a limit.`);
  const ls = cur.limitStop;
  const done = (out, msg) => say(S.get(cur.id), out?.msg?.startsWith("queued") ? out.msg : msg);
  // A turn you start gives the task its limit once more (limits/spent.js: granted). One the board starts because
  // the limit moved does not: the mark is taken off first, and put back if nothing could be sent.
  const own = (send) => {
    if (!raised) return send();
    S.update(cur.id, (t) => { t.limitStop = null; }, { waitMs: 10000 });
    try { return send(); } catch (e) { try { S.update(cur.id, (t) => { if (t.stage !== "stopped") return false; t.limitStop = ls; }, { waitMs: 10000 }); } catch {} throw e; }
  };
  // Work that was finished and reviewed when the tokens ran out: it is put up for your approval as it stood. Where
  // `merge.by` says itself, the next pass merges it (finish/auto-merge.js), now that it is under its limit again.
  if (ls.ready && ls.done) { // nothing to land: it was reviewed, and is done
    const mark = F.tidyMark(cur, "merged");
    const t = S.update(cur.id, (t) => { if (!stoppedAtLimit(t) || runnerAlive(t)) throw new Error(`${t.id} is busy. Try again in a moment.`); if (raised) { t.limitStop = null; t.runCarry = null; } else granted(t); t.stage = "done"; t.tidy = mark; t.msg = ls.done; t.failure = null; t.mergeIntent = null; t.since = Date.now(); });
    try { F.tellSidebar(t); } catch {}
    spawnRunner("cleanup", t.id, ["--merged"]);
    return say(t, `${t.id}: carrying on, it is done`);
  }
  if (ls.ready) {
    const t = S.update(cur.id, (t) => { if (!stoppedAtLimit(t) || runnerAlive(t)) throw new Error(`${t.id} is busy. Try again in a moment.`); if (raised) { t.limitStop = null; t.runCarry = null; } else granted(t); t.stage = "approval"; t.since = Date.now(); t.msg = t.syncBlocked ? behindMsg(t.syncBlocked.why) : approvalMessage(t); });
    try { F.tellSidebar(t); } catch {}
    return say(t, `${t.id}: carrying on, its work waits for approval`);
  }
  if (ls.role === "reviewer") {
    if (ls.review && cur.review?.text && G.sendable(cur.review)) return done(own(() => sendReview(cur.id)), `${cur.id}: carrying on, the review went to the agent`);
    F.assertLive(cur);
    const t = S.update(cur.id, (t) => { if (!stoppedAtLimit(t) || runnerAlive(t)) throw new Error(`${t.id} is busy. Try again in a moment.`); if (raised) { t.limitStop = null; t.runCarry = null; } else granted(t); t.stage = "checking"; t.msg = ""; t.since = Date.now(); });
    spawnRunner("pipeline", t.id);
    return say(t, `${t.id}: carrying on, it is reviewed again`);
  }
  const out = own(() => tell(cur.id, F.withTail(cur, `You were stopped because this task reached its limit (${what(ls)}), not because of anything you did. ${raised ? "The limit was raised" : "The human said to carry on"}: continue the task where you left off.`)));
  // The time the run had taken rides on (limits/spent.js: ranFor) when it is the limit that moved, not you.
  if (raised && ls.what === "time") { try { S.update(cur.id, (t) => { if (t.stage !== "working") return false; t.runCarry = { ms: ls.used, from: Math.max(t.since || 0, t.workAt || 0, t.expectedWake?.at || 0) }; }, { waitMs: 10000 }); } catch {} }
  return done(out, `${cur.id}: told the agent to continue`);
}
// Take the work as it is: through the check and the review, like any finished turn. Only a stopped agent's work; a
// review that was stopped is done again (carryOn). Returns the task, already in the pipeline's first stage.
export function takeAsIs(id) {
  const cur = S.find(id);
  if (cur.limitStop.role === "reviewer") return carryOn(cur.id);
  F.assertLive(cur);
  // The turn the stop cut short is the one taken here: what herdr counts of it later is not a new turn of yours.
  let a = null;
  try { a = F.h(cur).agentGet(cur.link.pane); } catch {}
  const note = F.noteStat(cur)?.mtime;
  const t = S.update(cur.id, (t) => {
    if (!stoppedAtLimit(t) || runnerAlive(t)) throw new Error(`${t.id} is busy.`);
    granted(t); t.stage = "checking"; t.msg = ""; t.since = Date.now(); t.armedAt = Date.now();
    t.handled = { ...(t.handled || {}), ...(a ? { comp: a.completion_seq ?? null, seq: a.state_change_seq ?? null } : {}), ...(note ? { note } : {}), at: Date.now() };
  });
  spawnRunner("pipeline", t.id);
  return say(t, `${t.id}: taking the work as it is (${usedSay(cur.limitStop)})`);
}
