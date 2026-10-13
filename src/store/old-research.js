// "Research only" was a switch of its own on a task and on an automation (`research: true`). It is the setting
// `research.only` now, and what was saved with the old switch is read in the new shape: a task or an automation that
// had it on says the setting as its own, and a task that was started keeps what it was started as (`researchRun`).
// Done when it is read, and written with the next change to it; converting twice changes nothing.
export const RESEARCH = "research.only";

// A task as it is now. The same object when there is nothing to convert.
export function researchMoved(t) {
  const old = Object.hasOwn(t, "research"), started = !!t.startedOnce && typeof t.researchRun !== "boolean" && !t.researchOpen; // `researchOpen`: its start decides (research.js)
  if (!old && !started) return t;
  const next = { ...t }, was = t.research === true;
  // Its own answer since then wins over the old switch.
  if (was && t.settings?.[RESEARCH] === undefined) next.settings = { ...(t.settings || {}), [RESEARCH]: true };
  // Under way before this version: it goes on as what it was, whatever a default says from now on.
  if (started) next.researchRun = was;
  delete next.research;
  return next;
}
// An automation as it is now: the old switch is one of its own settings.
export function researchMovedAutomation(a) {
  if (!a || !Object.hasOwn(a, "research")) return a;
  const { research, ...next } = a;
  if (research === true && a.settings?.[RESEARCH] === undefined) next.settings = { ...(a.settings || {}), [RESEARCH]: true };
  return next;
}
