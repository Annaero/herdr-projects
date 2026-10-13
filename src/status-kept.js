// A working task's line while the Watcher has written none for this run: the last sentence it wrote, kept and said with its age, or "Just started".
//
// Every new run (a new turn, sent back after a review, a conflict, a retry) drops the Watcher's guess, and its first
// look takes about a minute. Until then the row says what the agent was last seen doing, with how long ago that was
// before it ("12m ago: Running the check"), so an old sentence is never read as a new one. A task that never had a
// sentence says "Just started", and "No status yet" once that is no longer true. Never a bare "…".
import { age } from "./board/view/words.js";
import { setting } from "./store.js";

// How long a run with no sentence yet counts as just started: three looks of the Watcher at its usual pace.
export const JUST_MS = 3 * 60000;
// The sentence is kept on the task as `lastLine` by the store, on every change of a task (store/tasks.js): only the
// agent's. A reviewer is a new agent every round: nothing of its last round is kept.
// The line for `role` ("agent" or "reviewer") whose run began at `from`. With the Watcher off no sentence will come:
// the plain word then, which a row leaves out because its heading says it already.
// Whether that line is the board's own plain word: the row is told so (`plain`) and leaves it out. It is never
// worked out from the words, so a sentence the Watcher or an agent wrote is shown whatever it says.
export const quietPlain = (t, role) => !(role === "agent" && t.lastLine?.msg) && setting("watcher.agent") === "none";
export function quietLine(t, role, from, now = Date.now()) {
  const kept = role === "agent" ? t.lastLine : null;
  if (kept?.msg) return `${kept.at ? `${age(now - kept.at)} ago` : "Earlier"}: ${kept.msg}`;
  if (quietPlain(t, role)) return role === "reviewer" ? "Under review" : "Working";
  if (from && now - from >= JUST_MS) return "No status yet";
  return role === "reviewer" ? "Review just started" : "Just started";
}
