// Who fires the automations: the keeper and an open board, by this one pass, once a second (keeper.js: tickOnce), so
// it works with the board closed. One pass at a time on the machine (fire.js: oneAtATime, a lock in the data folder):
// whoever finds it taken skips, and what is due is decided and written down under it, so nothing fires twice.
//   a schedule     fires when it is due. A tick that is found more than LATE late (the machine or the keeper was off)
//                  is skipped and never caught up: one line says so, and the schedule goes on from now.
//   a board event  every task is looked at, and what happened since the last look fires the automations that wait
//                  for it: in the automation's own repo, or in every repo.
import * as S from "../store.js";
import { nextAfter } from "./triggers.js";
import { newEvents } from "./events.js";
import { madeBy } from "./told.js";
import { fire, oneAtATime } from "./fire.js";

// A tick found later than this was missed, not late.
export const LATE = 5 * 60000;
// The tasks are looked at for events this often at most.
const EVENTS_EVERY = 2000;
let lookedAt = 0;

export function automationsTick(now = Date.now()) {
  if (!S.hasAutomations()) return [];
  const list = S.automations().filter((a) => a.on);
  const events = list.some((a) => a.trigger?.kind === "event");
  if (!events && S.eventsSeen()) S.dropEventsSeen(); // nobody waits for one: the next automation that does starts from then
  const look = events && Math.abs(now - lookedAt) >= EVENTS_EVERY;
  if (!look && !list.some((a) => a.trigger?.kind === "schedule" && (!a.nextAt || now >= a.nextAt))) return [];
  const fired = [];
  try {
    oneAtATime(() => {
      for (const a of S.automations().filter((x) => x.on && x.trigger?.kind === "schedule")) {
        if (a.nextAt && now < a.nextAt) continue;
        const late = a.nextAt ? now - a.nextAt : 0;
        S.changeAutomation(a.id, (x) => { x.nextAt = nextAfter(x.trigger, now, x.since || now); });
        if (!a.nextAt) continue; // never armed (a file edited by hand): it counts from now
        if (late > LATE) fired.push(S.noteFiring(a.id, { at: now, cause: "schedule", what: a.trigger.text, skipped: "missed while the machine or the keeper was off: not caught up" }));
        else fired.push(fire(a, { kind: "schedule" }, now));
      }
      if (look) { lookedAt = now; fired.push(...eventsPass(now)); }
    }, 0);
  } catch (e) { if (e.code !== "BUSY") throw e; }
  return fired;
}
// What happened on the board since the last look, and the automations it fires.
function eventsPass(now) {
  const { events, seen, changed } = newEvents(S.list({ includeArchived: true }).sort((x, y) => (x.created || 0) - (y.created || 0) || x.id.localeCompare(y.id, undefined, { numeric: true })), S.eventsSeen()); // the oldest task first
  if (changed) S.saveEventsSeen(seen);
  const fired = [];
  for (const e of events) {
    for (const a of S.automations().filter((x) => x.on && x.trigger?.kind === "event" && x.trigger.event === e.event)) {
      if (!a.trigger.everyRepo && e.task.repo !== a.repo) continue;
      if (e.at < (a.since || 0)) continue; // it happened before this automation began to wait for it
      if (madeBy(e.task)?.chain?.includes(a.id) || madeBy(e.task)?.id === a.id) continue; // no loops
      fired.push(fire(a, { kind: "event", event: e.event, task: e.task }, now));
    }
  }
  return fired;
}
