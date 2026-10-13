// A run: one stretch of an agent's work on a task, from the moment it was set going (by you, or by the board with a
// check's output or a review's findings) to the end of that turn; for a reviewer, one review. Whose run it is in
// the task's stage, when it began, and the time limit that holds for it.
//
// `limit.time` is read when a run starts and holds for that run: set or changed while one is under way, it counts
// from the next. The value is kept on the task as `runLimit: { from, time }` by whichever comes first: the first
// look at the run (limits/tick.js), or a change of the setting, which keeps the value as it was for every run that
// is under way before it saves the new one (settings/change.js). So a run with nothing kept has seen no change
// since it began, and the setting as it stands is the one it started with.
import { update, list } from "./tasks.js";
import { allAttempts } from "./attempts.js";
import { lookup } from "./settings/lookup.js";

export const runRole = (t) => (["reviewing", "reviewneeds"].includes(t?.stage) ? "reviewer" : t?.stage === "working" ? "agent" : "");
export const runBegan = (t) => (runRole(t) === "reviewer" ? t.reviewAt || 0 : runRole(t) === "agent" ? Math.max(t.since || 0, t.workAt || 0, t.expectedWake?.at || 0) : 0);
export function runTime(t) {
  const from = runBegan(t);
  if (!from) return "none";
  if (t.runLimit && t.runLimit.from === from) return t.runLimit.time;
  try { return lookup("limit.time", { task: t }).value; } catch { return "none"; }
}
// Keep a run's limit on its task. Returns the limit that holds for the run.
export function keepRunTime(t) {
  const from = runBegan(t), time = runTime(t);
  if (from && !(t.runLimit && t.runLimit.from === from)) { try { update(t.id, (c) => { if (runBegan(c) !== from || c.runLimit?.from === from) return false; c.runLimit = { from, time }; }, { waitMs: 2000 }); } catch {} }
  return time;
}
// Before `limit.time` changes anywhere: every run under way keeps the limit it started with.
export function keepRunTimes() {
  let all = [];
  try { all = [...list(), ...allAttempts()]; } catch {}
  for (const t of all) if (!t.archivedAt && runBegan(t)) keepRunTime(t);
}
