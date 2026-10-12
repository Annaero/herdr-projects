// (herdr status, stage) -> what the board shows. The one mapping function.
//
// The board draws pi-work's five states: idle, working, blocked, done, error; blocked carries a kind. herdr has
// no `error` state and no blocked `kind` today. When it exposes them (OSC 7501), this is the only place to change.
import { RUNNER_STAGES } from "./store.js";

export const STATES = ["idle", "working", "blocked", "done", "error"];
const STAGE_LINE = { starting: "starting", queued: "waiting for a free slot", setup: "setting up", checking: "running the check", pushing: "pushing the branch", reviewing: "under review", merging: "merging" };

// `live` describes the task's worker pane right now:
//   { status }                 herdr's agent status: idle | working | blocked | done | unknown
//   { status: null }           the pane is alive but no agent is in it
//   { gone: true }             the pane no longer exists
//   { away: "session name" }   the task's agents live in another herdr session
//   { down: true }             no herdr server runs
//   undefined                  not looked up (a task with no agent)
export function show(t, live) {
  const out = (state, extra = {}) => ({ state, app: t.app || undefined, msg: t.msg || "", ...extra });
  const agent = !!t.app && t.app !== t.owner;
  switch (t.stage) {
    case "todo": return out("idle");
    case "progress": return out("working", { app: t.owner, progress: t.watch?.progress }); // your own task: the progress you reported
    case "done": return out("done");
    case "failed": return t.failure?.auth ? out("blocked", { kind: "auth" }) : out("error");
    case "approval": return out("blocked", { kind: "permission", review: !t.mergeFailed && !t.syncBlocked });
    case "asks": return out("blocked", { kind: t.kind || "question" });
    case "nosummary": return out("error", { msg: t.msg || "stopped without a summary" });
    case "reviewneeds": return out("blocked", { msg: t.msg || "the reviewer needs you" });
    case "stopped": return out("idle", { msg: "stopped" });
    case "queued": case "starting": return out("working", { msg: t.msg || STAGE_LINE[t.stage] });
  }
  // Under review the Watcher follows the reviewer: its line and its own progress, started afresh for every round.
  if (t.stage === "reviewing") return out("working", { msg: t.watch?.msg || t.msg || STAGE_LINE.reviewing, progress: t.watch?.progress ?? 0, reviewing: true });
  if (RUNNER_STAGES.includes(t.stage)) return out("working", { msg: t.msg || STAGE_LINE[t.stage], progress: t.watch?.progress, reviewing: false });
  // stage "working": the agent's own turn. herdr decides.
  if (!agent || !live) return out("working", { progress: t.watch?.progress });
  if (live.down) return out(lastKnown(t), { msg: "herdr is not running", stale: true });
  if (live.away) return out(lastKnown(t), { msg: `in session ${live.away}`, stale: true });
  if (live.gone) return out("error", { msg: "the agent's terminal is gone" });
  if (live.status == null) return out("error", { msg: "the agent has exited", exited: true });
  if (live.status === "blocked") return out("blocked", { kind: t.pendingText ? "permission" : undefined, msg: t.pendingText ? "queued: open the agent and answer its dialog first" : "needs you" });
  if (live.status === "working") return out("working", { msg: t.watch?.msg || t.msg || "working", progress: t.watch?.progress ?? 0 });
  if (live.status === "unknown") return out("working", { msg: "herdr can't tell if it stopped" });
  return out("working", { msg: "finishing" }); // idle or done, and the runner has not finished the turn yet
}
// With no live reading, show what was last seen rather than guessing.
const lastKnown = (t) => (t.last?.status === "blocked" ? "blocked" : "working");

