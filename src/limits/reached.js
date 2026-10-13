// A limit is reached: the agent is stopped, its work is kept as it is, nothing is merged, and the task waits for you
// under "needs you" with one plain line (`stopped at its 2h limit`, `stopped at 2m tokens`).
//
// The stop is the board's own stop (actions/talk.js: the stage is "stopped", so a late report of that turn's end
// cannot start the finish line), marked with what stopped it: `limitStop: { what, limit, role, used, at }`. From
// there the task only moves when somebody says so: a reply or "continue" (your word gives it the limit once more),
// "take it as it is", or a higher limit, which the tick sees and carries on with by itself (limits/tick.js). A
// stopped task is in no stage a limit is looked at in, so the same limit cannot stop it twice.
import * as S from "../store.js";
import * as F from "../flow.js";
import { stop } from "../actions/talk.js";
import { tokensOf, ms, NONE } from "../store/settings/values.js";
import { count } from "./spent.js";
import { usedOf, limitSaid, stoppedAtLimit, stopLine } from "./run.js";

// Stop a task at a limit. `review`: the reviewer's findings were kept on the task and are what "continue" sends back.
// `ready`: the work is finished and what was reviewed is kept on the task: carrying on puts it up for approval.
// `done`: there is nothing to land, and carrying on ends the task as done with these words.
export function stopAt(id, what, { limit, used }, { role = "agent", review = false, ready = false, done = "" } = {}) {
  try { count(id, role, 2000); } catch {} // what it used up to here, read while the task still names its conversation
  stop(id);
  const t = S.update(id, (t) => {
    if (t.stage !== "stopped") return false;
    t.limitStop = { what, limit, role, used, at: Date.now(), ...(review ? { review: true } : {}), ...(ready ? { ready: true } : {}), ...(done ? { done } : {}) };
    t.msg = stopLine(what, limit); t.runCarry = null;
  }, { waitMs: 10000 });
  try { F.tellSidebar(t); } catch {}
  return t;
}
// Has this task used its tokens? Counted now, at the end of a turn (`role`: whose conversation to read on first).
// Returns { limit, used } when it has, else null. A program whose tokens cannot be counted adds nothing to the count.
export function tokensOver(id, role = "") { return overNow(role ? count(id, role) : S.get(id)); }
// The same of a task as it stands, with nothing read: asked before anything merges by itself (finish/auto-merge.js).
export function overNow(t) {
  const limit = t && limitSaid(t) ? S.setting("limit.tokens", t) : NONE;
  if (limit === NONE) return null;
  const used = usedOf(t);
  return used >= tokensOf(limit) ? { limit, used } : null;
}
// Is a task that a limit stopped under that limit again, as the settings stand now? (It was raised, or taken away.)
export function lifted(t) {
  const ls = t.limitStop;
  if (!stoppedAtLimit(t)) return false;
  const limit = S.setting(`limit.${ls.what}`, t);
  if (limit === NONE) return true;
  return ls.what === "time" ? ms(limit) > ls.used : tokensOf(limit) > usedOf(t);
}
