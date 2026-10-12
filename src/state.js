// (herdr status, stage) -> what the board shows. The one mapping function.
//
// The board draws pi-work's five states: idle, working, blocked, done, error; blocked carries a kind. herdr has
// no `error` state and no blocked `kind` today. When it exposes them (OSC 7501), this is the only place to change.
import { RUNNER_STAGES, waitingOf, waitLine } from "./store.js";

export const STATES = ["idle", "working", "blocked", "done", "error"];
const STAGE_LINE = { starting: "starting", queued: "waiting for a free slot", setup: "setting up", checking: "running the check", pushing: "pushing the branch", reviewing: "under review", merging: "merging" };

// `live` describes the task's worker pane right now:
//   { status }                 herdr's agent status: idle | working | blocked | done | unknown
//   { status: null }           the pane is alive but no agent is in it
//   { gone: true }             the pane no longer exists
//   { away: "session name" }   the task's agents live in another herdr session
//   { down: true }             no herdr server runs
//   undefined                  not looked up (a task with no agent)
export function show(t, live, now = Date.now()) {
  // A guess left over from the other role (the reviewer's, once the agent works again) is not shown as this one's.
  const role = roleOf(t), watch = role && t.watch?.role && t.watch.role !== role ? null : t.watch;
  const eta = role && watch?.role === role ? etaOf(watch.progress, began(t), now) : undefined;
  const out = (state, extra = {}) => ({ state, app: t.app || undefined, msg: t.msg || "", ...extra });
  const agent = !!t.app && t.app !== t.owner;
  // A turn cut off by a passing provider error, and the board waiting to try again by itself: that is work going on,
  // not something that needs you, and the row says why and when.
  const wait = waitingOf(t);
  if (wait) return out("working", { msg: waitLine(wait), reviewing: wait.who === "reviewer" }); // no bar: nothing is running
  switch (t.stage) {
    case "todo": return out("idle");
    case "progress": return out("working", { app: t.owner, progress: t.watch?.progress, eta: t.watch?.eta }); // your own task: the progress and the minutes left you reported
    case "done": return out("done");
    case "failed": return t.failure?.auth ? out("blocked", { kind: "auth" }) : out("error");
    case "approval": return out("blocked", { kind: "permission", review: !t.mergeFailed && !t.syncBlocked });
    case "asks": return out("blocked", { kind: t.kind || "question" });
    case "nosummary": return out("error", { msg: t.msg || "stopped without a summary" });
    case "reviewneeds": return out("blocked", { msg: t.msg || "the reviewer needs you" });
    case "stopped": return out("idle", { msg: "stopped" });
    case "queued": case "starting": return out("working", { msg: t.msg || STAGE_LINE[t.stage] });
  }
  // Under review the Watcher follows the reviewer: its line, its own progress and the minutes left worked out from it, started afresh for every round.
  if (t.stage === "reviewing") return out("working", { msg: watch?.msg || t.msg || STAGE_LINE.reviewing, progress: watch?.progress ?? 0, eta, reviewing: true });
  if (RUNNER_STAGES.includes(t.stage)) return out("working", { msg: t.msg || STAGE_LINE[t.stage], progress: t.watch?.progress, eta, reviewing: false });
  // stage "working": the agent's own turn. herdr decides.
  if (!agent || !live) return out("working", { progress: watch?.progress, eta });
  if (live.down) return out(lastKnown(t), { msg: "herdr is not running", stale: true });
  if (live.away) return out(lastKnown(t), { msg: `in session ${live.away}`, stale: true });
  if (live.gone) return out("error", { msg: "the agent's terminal is gone" });
  if (live.status == null) return out("error", { msg: "the agent has exited", exited: true });
  if (live.status === "blocked") return out("blocked", { kind: t.pendingText ? "permission" : undefined, msg: t.pendingText ? "queued: open the agent and answer its dialog first" : "needs you" });
  if (live.status === "working") return out("working", { msg: watch?.msg || t.msg || "working", progress: watch?.progress ?? 0, eta });
  if (live.status === "unknown") return out("working", { msg: "herdr can't tell if it stopped" });
  // idle or done. Only an agent that has worked is wrapping up; one that has not begun yet is idle too.
  if (worked(t, live)) return out("working", { msg: "finishing" }); // the runner has not finished the turn yet
  return out("working", { msg: (t.workedAt || 0) >= (t.startedAgentAt || 1) ? "about to continue" : "starting" });
}
// Has the agent worked on what it was last asked? herdr saw it work since the turn was armed (hook.js keeps when), or
// a turn herdr counts as finished, and the finish line has not handled, ended after the turn was armed. An agent that
// is still loading, or that has not picked up its prompt, has done neither: it only looks the same to herdr (idle).
// herdr's count alone proves nothing: answering a start-up dialog raises it too, before the first prompt is even sent.
// So text that still waits to be sent means no work, and a count first seen before the turn was armed (hook.js keeps
// when, however often it is read again) is not this turn's.
function worked(t, live) {
  if (t.pendingText) return false;
  const armed = t.armedAt || 0, comp = live.agent?.completion_seq ?? null;
  if ((t.workedAt || 0) >= (armed || 1)) return true;
  return comp != null && comp !== (t.handled?.comp ?? null) && t.last?.comp === comp && (t.last.compAt ?? t.last.at ?? 0) > armed;
}
// Whom the Watcher follows in a stage, and when that assignment began: this review round for the reviewer, otherwise
// the agent's work since you last set it going (not the time it waited for a free slot). The stage decides, never an
// older guess: one kept from a review says nothing about the work that follows it.
export const roleOf = (t) => (t.stage === "reviewing" ? "reviewer" : t.stage === "working" ? "agent" : undefined);
export const began = (t, role = roleOf(t)) => (role === "reviewer" ? t.reviewAt : role === "agent" ? Math.max(t.since || 0, t.workAt || 0) : 0) || undefined;
// Minutes left, from the percent and the time spent so far: elapsed × (100 − percent) ÷ percent. 40 minutes in at 80%
// is 10 left. Under 5% the answer would be a huge number that means nothing, so there is none; while work is left it
// is never under a minute.
export const MIN_PERCENT = 5;
export function etaOf(percent, from, now = Date.now()) {
  const p = Number(percent);
  if (!Number.isFinite(p) || p < MIN_PERCENT || !from || !Number.isFinite(now - from)) return undefined;
  if (p >= 100) return 0;
  return Math.min(99999, Math.max(1, Math.round((Math.max(0, now - from) / 60000) * (100 - p) / p)));
}
// With no live reading, show what was last seen rather than guessing.
const lastKnown = (t) => (t.last?.status === "blocked" ? "blocked" : "working");

