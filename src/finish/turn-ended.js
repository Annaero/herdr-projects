// The finish runner: an agent's turn ended. Was it really the end, and what did it say? Then the pipeline.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import * as F from "../flow.js";
import { readScreen } from "../herdr.js";
import { release, guardFor, sleep } from "../runner.js";
import { adapter, readTurnOf, versionOf } from "../agents.js";
import { taskLine } from "../delegate.js";
import { ms, lastLines, fail } from "./shared.js";
import { pipeline } from "./pipeline.js";
import { closeReviewer } from "./review.js";
import { name as keyName } from "../board/keys.js";
import { pendingSent } from "../submit.js";

// ---- job: the agent's turn ended ----------------------------------------------------------------------------------------
// Started two ways. By the agent's own turn-end hook (`turn-ended`): a definite stop, judged here from the saved
// conversation. Or by herdr's status hook, the hook-less route: herdr's "idle" is a guess from the screen, so it alone
// never finishes a task. `force`: the status hook already decided a turn ended (missed-turn recovery).
// A finish runner that finds another unhandled event when it is done keeps its marker and processes that one too.
export async function finishJob(id, opts = {}) {
  for (let first = true; ; first = false) {
    if (!(await finishOnce(id, first ? opts : {}))) { if (!first) release(id); return; } // a marker kept for an event that turned out not to be a worker's
    if (!release(id, { keep: true })) return;
  }
}
const IGNORES = ["todo", "progress", "done", "queued", "starting", "setup"];
const newer = (turn, t) => !!turn && turn.pos > (t.handled?.pos || 0);
// What the status hook does when the human's turn ended without it seeing the start: the old approval, review and
// counters no longer describe the work.
function humanTurn(t) {
  if (t.mergeIntent || t.stage === "approval") t.requireApproval = true;
  t.mergeIntent = null;
  if (t.review && !t.review.stale) t.review = { ...t.review, stale: true };
  t.checkFails = 0; t.reviewRounds = 0; t.prRounds = 0; t.syncRepairs = 0;
  t.armedAt = t.handled?.at || t.armedAt || 0; t.expectedWake = null; t.turnOpen = false;
  t.stage = "working"; t.msg = ""; t.kind = undefined; t.mergeFailed = false;
  if (t.failure?.auth) t.failure = null;
}
// Has this task's agent begun on anything since its program was started? The finish line handled a turn of it, or
// herdr saw it work (hook.js keeps when). An agent that has done neither has nothing to finish.
const begun = (t) => !!t.handled?.at || t.turnBy === "typed" || (t.workedAt || 0) >= (t.startedAgentAt || 1);
async function finishOnce(id, { force = false } = {}) {
  let t = S.get(id);
  if (!t || !F.isAgentTask(t)) return false;
  // Text typed into a running turn, and not taken yet: the turn that ended is not its answer. Nothing is judged (the
  // event stays) until the agent has started on the text, or the board has given up on it (submit.js).
  if (t.sent || t.unsent) { let a = null; try { a = F.h(t).agentGet(t.link.pane); } catch {} if (pendingSent(t, a)) return false; }
  const kind = t.agent, ver = versionOf(kind);
  const mine0 = (e) => e.role === "agent" && !(e.side && e.session !== t.session);
  // 1. Without an event, give herdr's screen guess time to correct itself.
  if (!S.pendingEvents(t).some(mine0)) await sleep(ms("HERDR_SUPERWORK_SETTLE_MS", 5000));
  let ev = null, mine = false;
  t = S.update(id, (t) => {
    if (t.runner && t.runner.pid !== process.pid && S.markerAlive(t.runner)) return false;
    const pending = S.pendingEvents(t);
    ev = pending.filter((e) => e.role === "agent" && !(e.side && e.session !== t.session)).pop() || null;
    if (!pending.length && (t.stage !== "working" || t.archivedAt)) return false;
    // Every event up to here is now judged: accepted below, or dropped as a repeat, a side chat or a stale round.
    if (pending.length) { t.eventsHandled = Math.max(...pending.map((e) => e.n)); t.events = []; }
    if (t.archivedAt || (ev ? IGNORES.includes(t.stage) || (t.stage === "stopped" && ev.at < (t.stoppedAt || 0) + 3000) : t.stage !== "working")) return;
    mine = true;
    t.runner = S.marker({ job: "finish" });
  }, { waitMs: 10000 });
  if (!mine) return false;
  const api = F.h(t);
  const g = guardFor(id);
  try {
    const a = api.agentGet(t.link.pane);
    const comp = a?.completion_seq ?? null, seq = a?.state_change_seq ?? null, term = a?.terminal_id ?? null;
    const note = F.noteStat(t);
    const freshNote = note && note.mtime > (t.armedAt || 0) && note.mtime !== t.handled?.note ? note : null;
    let turn = null;
    if (ev) {
      // 2a. The agent said its turn ended. The hook can fire before the last message is on disk: re-read for up to
      //     ten seconds until the file shows something newer than the last handled turn.
      const src = { file: ev.file || null, session: ev.session || t.session, cwd: S.cwdOf(t) };
      for (const until = Date.now() + ms("HERDR_SUPERWORK_READ_MS", 10000); ; ) {
        turn = readTurnOf(kind, src);
        if (newer(turn, t) && (turn.finished || turn.error)) break;
        if (Date.now() >= until) break;
        await sleep(400);
      }
      if (adapter(kind).readTurn) S.countMark(`reader:${kind}`, ver, !!turn);
      S.countMark(`hook:${kind}`, ver, true);
      if (turn && !(newer(turn, t) && ((turn.finished && turn.id !== t.handled?.msg) || turn.error))) return true; // a repeat, or an earlier turn
      if (t.selfBlocked && t.stage === "asks") { // it reported itself blocked, then stopped: that is not a finish
        S.update(id, (t) => { t.handled = { ...(t.handled || {}), comp, seq, term, at: Date.now(), msg: turn?.id ?? t.handled?.msg ?? null, pos: turn?.pos ?? t.handled?.pos ?? 0 }; t.selfBlocked = null; t.turnOpen = false; if (turn?.said) t.said = turn.said; if (ev.session) t.session = ev.session; }, { waitMs: 10000 });
        return true;
      }
      // A turn that ended in a stage other than "working" was the human's, typed in the agent's own terminal.
      if (t.stage !== "working") { t = S.update(id, (t) => { humanTurn(t); }, { waitMs: 10000 }); F.labelPane(t, null); await closeReviewer(id); }
    } else {
      // 2b. The hook-less route: no event (a crash, a kind without a hook, a hook marked not working).
      if (a && (a.agent_status === "working" || a.agent_status === "blocked")) return true;
      let session = t.session;
      if (!session && adapter(kind).findSession) { session = adapter(kind).findSession(S.cwdOf(t), t.startedAgentAt || t.armedAt || 0, taskLine(t)); if (session) S.update(id, { session }, { waitMs: 10000 }); }
      turn = readTurnOf(kind, { file: t.transcript || null, session, cwd: S.cwdOf(t) });
      const says = newer(turn, t) && turn.pos > (t.armedAt || 0) && ((turn.finished && turn.id !== t.handled?.msg) || turn.error);
      if (!a) { if (!(says && turn.error)) return true; } // the agent exited: reconcile shows that; a crash still shows its real last error
      else if (!says) {
        if (turn && turn.finished && turn.id === t.handled?.msg && !freshNote) { S.update(id, (t) => { t.handled = { ...(t.handled || {}), comp }; }, { waitMs: 10000 }); return true; } // a late "idle" for a turn already handled
        if (a.agent_status === "unknown" && !freshNote) return true; // herdr cannot tell, and nothing says it stopped
        if (!force && (a.agent_status === "unknown" || comp == null ? !freshNote : comp === t.handled?.comp && !freshNote)) return true;
        turn = turn && newer(turn, t) && turn.interrupted ? turn : null;
        // Only herdr's count says a turn ended, the agent has not begun, and its first text went out behind a dialog
        // whose answer herdr had not counted yet (hook.js `owedTurn`): this is that answer, not the end of any work.
        if (!force && !turn && !freshNote && t.owedTurn === (t.startedAgentAt || 1) && !begun(t)) { S.update(id, (t) => { t.handled = { ...(t.handled || {}), comp }; t.owedTurn = undefined; }, { waitMs: 10000 }); return true; }
      } else if (turn.finished) {
        // The file must have stood still through the settle wait: a message followed by more work is not the end.
        const again = readTurnOf(kind, { file: turn.file });
        if (!again || again.id !== turn.id || again.pos !== turn.pos) return true;
        if (t.hooked) S.countMark(`hook:${kind}`, ver, false);
      }
    }
    g.expect(t);
    // 3. What the agent said, and why it stopped.
    const wake = t.expectedWake;
    const handled = { comp, seq, term, note: freshNote ? freshNote.mtime : t.handled?.note ?? null, at: Date.now(), msg: turn?.id ?? t.handled?.msg ?? null, pos: turn?.pos ?? t.handled?.pos ?? 0 };
    const keep = (t) => { t.handled = handled; t.turnOpen = false; t.turnBy = null; F.seeTerminal(t, term); if (turn) { if (turn.said) t.said = turn.said; if (turn.usage) t.usage = turn.usage; if (turn.model) t.model = turn.model; t.transcript = turn.file; } if (ev?.session) t.session = ev.session; };
    if (turn && (turn.error || turn.stop === "length" || turn.stop === "refusal")) {
      const why = turn.error || (turn.stop === "length" ? "The agent's reply was cut off: it ran out of room (context or output limit)." : "The model refused to continue.");
      g.set(keep);
      // A passing provider error (the model at capacity, an overloaded server, a rate limit, a dropped connection) is
      // nobody's to fix: the board waits and tells the agent to carry on, a few times with growing waits, before it
      // gives up. The failure is saved all the same, under the wait: a reply or ctrl+r still works meanwhile, and if
      // the board gives up this is what it says. A turn that was itself such a retry counts on from the one before.
      const tries = (wake?.reason === "retry" && wake.tries) || t.cutRetry?.tries || 0, waits = S.retryWaits();
      if (turn.passing && tries < waits.length) {
        const keepIntent = (!!wake?.keepIntent || !!t.cutRetry?.keepIntent) && !!t.mergeIntent;
        const failure = { stage: "agent", auth: false, agentCanFix: true, title: "Agent cut off", detail: `${why}\n\nThe ${S.gaveUp("agent", turn.reason, 1)}. That passes by itself: the board tells the agent to carry on, up to ${waits.length} times with growing waits.`, next: `Nothing: the board tells the agent to continue by itself. Reply or press ${keyName("sendBack")} to do it now.` };
        const w = g.set((t) => { t.stage = "failed"; t.msg = `Agent stopped: ${S.oneLine(why, 200)}`; if (!keepIntent) t.mergeIntent = null; Object.assign(t, S.failurePatch(failure)); t.waiting = { who: "agent", reason: turn.reason, error: S.oneLine(why, 400), until: Date.now() + waits[tries], tries: tries + 1, keepIntent, for: t.failure.at }; });
        F.labelPane(w, null);
        return true;
      }
      const gaveUp = turn.passing ? `${S.gaveUp("agent", turn.reason, tries + 1)}. ` : "";
      if (gaveUp) { fail(g, { stage: "agent", auth: false, agentCanFix: true, title: "Agent stopped", msg: `Agent stopped: ${gaveUp}Its error: ${S.oneLine(why, 200)}`, detail: `${gaveUp[0].toUpperCase()}${gaveUp.slice(1)}The board told it to carry on each time and has stopped trying.\n\nIts error:\n${why}`, next: `Wait for the provider to recover (or choose another model), then reply or press ${keyName("sendBack")} to tell the agent to continue.` }); return true; }
      fail(g, { stage: "agent", auth: turn.error ? turn.auth : false, agentCanFix: true, title: turn.auth ? "Needs a login" : "Agent stopped", msg: turn.auth ? "Needs a login" : `Agent stopped: ${S.oneLine(why, 200)}`, detail: `${why}${turn.said && turn.said !== why ? `\n\nIts last message:\n${turn.said}` : ""}`, next: `Fix what it reports, then reply or press ${keyName("sendBack")} to tell the agent to continue.` });
      return true;
    }
    const finished = !!turn?.finished;
    if (!finished && !freshNote && !wake) {
      // Nothing says the turn finished normally (interrupted, a crash, an unreadable conversation): commit nothing and
      // hold, with what is on the screen as the message. A login screen is recognised from its text.
      const screen = lastLines(readScreen(api, t.link.pane, a?.agent_status ?? null, 60));
      if (S.isAuthFailure(screen)) { g.set(keep); fail(g, { stage: "agent", auth: true, title: "Needs a login", msg: "Needs a login", detail: screen }); return true; }
      t = g.set((t) => { keep(t); t.stage = "nosummary"; t.msg = S.oneLine(lastLines(screen, 2)) || "stopped without a summary"; t.screen = screen; });
      return true;
    }
    if (t.cutRetry) g.set({ cutRetry: null }); // the turn ended by itself: a later cut-off starts counting again
    const text = finished ? turn.said : freshNote ? freshNote.text : t.said || "";
    if (freshNote) { try { fs.writeFileSync(path.join(S.dirOf(id), "closing.md"), freshNote.text + "\n"); } catch {} }
    t = g.set((t) => { keep(t); t.expectedWake = null; t.said = text; if (a?.agent_session?.value && !t.session) t.session = a.agent_session.value; });
    // Only a kind on the closing-note fallback asks by ending its note with a question: that is where its rules put
    // one. With a readable last message a closing question goes on to check and review; a truly blocked agent says so.
    if (!finished && freshNote && /\?\s*$/.test(text)) {
      t = g.set((t) => { t.stage = "asks"; t.kind = "question"; t.msg = S.oneLine(text.split("\n").filter((l) => l.trim()).pop()); });
      return true;
    }
    await pipeline(id, g, text, wake);
  } catch (e) {
    if (!e.aborted) try { fail(g, { stage: "workflow", title: "The finish line failed", detail: e.stack || e.message, next: "Investigate the error, then finish again." }); } catch {}
    else await closeReviewer(id);
  }
  return true;
}
