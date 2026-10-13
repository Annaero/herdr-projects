// The limits' own pass, run by whoever ticks (the keeper, or an open board: keeper.js): a run that has taken its
// `limit.time` is stopped, a task a limit stopped carries on by itself once its limit was raised, and the tokens of
// a running agent are counted for the panel. `limit.tokens` itself is only acted on at the end of a turn
// (finish/turn-ended.js, finish/pipeline.js). A run's time limit is read when the run starts (limits/spent.js:
// runTime): one set on a task that is under way counts from its next run.
import * as S from "../store.js";
import * as F from "../flow.js";
import { ms, NONE } from "../store/settings/values.js";
import { count } from "./spent.js";
import { ranFor, runRole, limitSaid, stoppedAtLimit } from "./run.js";
import { stopAt, lifted } from "./reached.js";

const LOOK = 2000, COUNT = 15000;
const looked = new Map(), countedAt = new Map();
const within = (last, now, span) => last !== undefined && now >= last && now - last < span; // a clock that went back is a new start
// `rows`: the board's list as this herdr session shows it (flow/live.js). `carryOn`: what continues a task
// (actions/limits.js), passed in so that this file starts no action by itself in a test that gives none.
export function limitsTick(rows, { now = Date.now(), carryOn = null } = {}) {
  for (const r of rows) {
    // Only a task whose agent this herdr session can see and stop: one in another session is that session's to look at.
    if (r.archivedAt || !F.isAgentTask(r) || !r.live || r.live.away || r.live.down) continue;
    const stopped = stoppedAtLimit(r), role = runRole(r);
    if (!stopped && !role) continue;
    if (within(looked.get(r.id), now, LOOK)) continue;
    looked.set(r.id, now);
    try {
      if (!stopped && !limitSaid(r)) continue;
      if (stopped) { if (carryOn && lifted(r)) carryOn(r.id, { raised: true }); continue; }
      // The run's own time limit: the one it started with, kept so that a later change is the next run's.
      const time = S.keepRunTime(r), tokens = S.setting("limit.tokens", r);
      // An agent that shows a dialog waits for you: that wait is not stopped. So does a reviewer that does.
      const atWork = r.stage === "reviewing" || (r.stage === "working" && r.state === "working" && r.live?.status !== "blocked");
      if (time !== NONE && atWork) { const used = ranFor(r, now); if (used >= ms(time)) { stopAt(r.id, "time", { limit: time, used }, { role }); continue; } }
      if (tokens !== NONE && !within(countedAt.get(r.id), now, COUNT)) { countedAt.set(r.id, now); count(r.id, role, 300); }
    } catch {}
  }
}
