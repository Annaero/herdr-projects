// A turn cut off by a passing provider error: the board waits, then tries again by itself (docs/how-work-gets-done.md).
// What "passing" means is decided where the agent's conversation is read (agents.js, providerError).

// How long it waits before each new try, growing: four more tries over fifteen minutes, then it gives up.
export const retryWaits = () => (process.env.HERDR_SUPERWORK_RETRY_MS !== undefined ? String(process.env.HERDR_SUPERWORK_RETRY_MS).split(",").filter((x) => x.trim()).map(Number) : [60000, 120000, 240000, 480000]);
// The wait a task is in, or null. It is saved as `waiting` on the task: { who: "reviewer" | "agent", reason, error,
// until, tries }. The reviewer's holds while the task is under review. The agent's sits on the saved failure of the
// cut-off turn (`for` is that failure's time), so anything that moves the task on (a reply, a stop, typing in the
// agent's terminal) ends it without having to know about it.
export function waitingOf(t) {
  const w = t?.waiting;
  if (!w || t.archivedAt) return null;
  if (w.who === "reviewer") return t.stage === "reviewing" ? w : null;
  return w.who === "agent" && t.stage === "failed" && !!t.failure && t.failure.at === w.for ? w : null;
}
const span = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)}m` : `${Math.max(1, Math.round(ms / 1000))}s`);
// What the row says meanwhile: "reviewer's model is at capacity, trying again in 2m".
export const waitLine = (w, now = Date.now()) => `${w.who}'s ${w.reason}, trying again ${w.until - now > 0 ? `in ${span(w.until - now)}` : "now"}`;
// What the failure says when the tries are used up, before the provider's own words.
export const gaveUp = (who, reason, tries) => `the ${who}'s ${reason}${tries > 1 ? `, still after ${tries} tries over ${span(retryWaits().slice(0, tries - 1).reduce((a, b) => a + b, 0))}` : ""}`;
