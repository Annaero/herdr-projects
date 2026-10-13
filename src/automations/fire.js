// A firing: the board adds an ordinary task and puts an agent on it at once. The task's title is the automation's
// name, its description the automation's prompt; the automation's own settings are put on it as that task's own, and
// from then on it is a task like any other. Every firing is written down: when, what fired it, the task it made or
// why it was skipped. The guards are here, and every firing passes them, one at a time on the machine:
//   one at a time   while the task of the firing before still has an agent, the check or a reviewer on it: skipped
//   no loops        an event of a task this automation made (or that such a task added) never fires it (tick.js)
//   a runaway       more than RUNAWAY firings in an hour turns the automation off, and its row says so
import fs from "node:fs";
import * as S from "../store.js";
import * as A from "../actions.js";
import { AGENT_STAGES } from "../actions/shared.js";
import { find, checkedSettings } from "./list.js";
import { sayTrigger } from "./triggers.js";
import { eventNamed } from "./events.js";
import { descriptionOf, madeBy } from "./told.js";

// The most tasks one automation may make in an hour. The next firing turns it off instead.
export const RUNAWAY = 10;
const HOUR = 3600000;
// One firing at a time on the machine, whoever asks: the keeper, an open board, a command.
export const oneAtATime = (fn, waitMs = 5000) => S.withLock("automations-fire", fn, { waitMs });

// What fired it, in a few words: "every 2h", "proj/3 was merged", "run now".
const sayCause = (a, c) => (c.kind === "event" ? `${c.task.id} ${eventNamed(c.event)?.what || c.event}` : c.kind === "run" ? "run now" : sayTrigger(a.trigger));
// The task of its last firing that made one is still being worked on: an agent, the check or a reviewer is on it, or
// it waits for a free slot. One that only waits for you holds nothing back.
// Which task that was is kept on the automation itself (`lastTask`), not read from its firings: those are trimmed.
export function busyTask(a) {
  const t = a.lastTask && S.get(a.lastTask);
  return t && !t.archivedAt && AGENT_STAGES.includes(t.stage) ? t : null;
}
// `cause`: { kind: "schedule" } · { kind: "event", event, task } · { kind: "run" } (asked for by hand).
// Returns the firing as written down: { at, cause, what, task } or { at, cause, what, skipped }.
export function fire(ref, cause, now = Date.now()) {
  return oneAtATime(() => {
    const a = find(typeof ref === "string" ? ref : ref.id);
    const base = { at: now, cause: cause.kind, what: sayCause(a, cause) };
    const skip = (why) => S.noteFiring(a.id, { ...base, skipped: why });
    if (!a.on) return { ...base, skipped: "it is off", unwritten: true }; // off, it never fires: nothing is written
    const busy = busyTask(a);
    if (busy) return skip(`its last task, ${busy.id}, is still being worked on`);
    const made = (a.made || []).filter((at) => at > Math.max(now - HOUR, a.countFrom || 0)).length; // kept on the automation, as `lastTask` is
    if (made >= RUNAWAY) {
      const why = `Turned itself off: more than ${RUNAWAY} firings in an hour`;
      S.changeAutomation(a.id, (x) => { x.on = false; x.nextAt = 0; x.offWhy = why; });
      return skip(`${why[0].toLowerCase()}${why.slice(1)}`);
    }
    if (!fs.existsSync(a.root)) return skip(`its folder is gone: ${S.tilde(a.root)}`);
    let settings;
    try { settings = checkedSettings(a, a.settings || {}); } catch (e) { return skip(`one of its settings is refused: ${e.message}`); }
    // An event's task hands on the automations it came from, so two automations can never fire each other for ever.
    const chain = [...new Set([...(cause.kind === "event" ? madeBy(cause.task)?.chain || [] : []), a.id])];
    const t = S.create(a.root, a.name, { description: descriptionOf(a, cause) });
    S.update(t.id, { settings, automation: { id: a.id, name: a.name, chain, cause: cause.kind, at: now } });
    S.changeAutomation(a.id, (x) => { x.lastTask = t.id; x.made = [...(x.made || []), now].slice(-RUNAWAY - 1); });
    let note = "";
    try { A.delegate(t.id); } catch (e) { note = `added, but no agent could be put on it: ${e.message}`; }
    return S.noteFiring(a.id, { ...base, task: t.id, ...(note ? { note } : {}) });
  });
}
