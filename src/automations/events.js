// What happens on the board that an automation can be fired by, and telling that it happened: a task was added,
// finished and waits for approval, failed its review, went wrong, needs you, was merged. Each is read off the task as
// it stands (nothing in the rest of the board calls in here), and counted once: what was seen already is kept in the
// automations' folder, so a board and a keeper that both look never fire the same event twice.
import { reviewHistory } from "../store/reviews.js";
import { eventOf } from "../notify.js";

// id: its name on the command line. words: after "when a task …". what: what the new task is told happened.
export const EVENTS = [
  { id: "added", words: "is added", what: "was added" },
  { id: "approval", words: "waits for approval", what: "finished and waits for approval" },
  { id: "review-failed", words: "failed its review", what: "failed its review" },
  { id: "failed", words: "went wrong", what: "went wrong" },
  { id: "needs-you", words: "needs you", what: "needs you" },
  { id: "merged", words: "is merged", what: "was merged" },
];
const flat = (s) => String(s ?? "").trim().toLowerCase().replace(/^(when )?(a )?(task )?/, "").replace(/[\s_]+/g, "-");
export const eventNamed = (typed) => EVENTS.find((e) => e.id === flat(typed) || flat(e.words) === flat(typed) || flat(e.what) === flat(typed)) || null;

// What is so of a task right now, one mark per thing that happened: "added", "merged:<when>", "approval:<since>".
// The same mark is the same happening; a task that fails, is fixed and fails again has a new one.
export function marksOf(t) {
  const out = ["added"], now = eventOf(t);
  if (now === "ready to approve") out.push(`approval:${t.at}`);
  if (now === "needs you") out.push(`needs-you:${t.stage}:${t.at}`);
  if (now === "failed") out.push(`failed:${t.at}`);
  const rv = reviewHistory(t).at(-1);
  if (rv && (rv.error || rv.pass === false || (rv.pass === undefined && rv.recommend === false))) out.push(`review-failed:${rv.round}:${rv.at}`);
  if (t.mergedAt) out.push(`merged:${t.mergedAt}`);
  return out;
}
// When the thing a mark stands for happened: a task's making for "added", else the time the mark carries.
export const markAt = (t, mark) => (mark === "added" ? t.created || 0 : Number(mark.split(":").at(-1)) || 0);
// What happened since the last look: [{ event, task, at }], and what is seen now. `at` is when it happened: an
// automation counts only what happened since it began to wait (tick.js), so the first look ever (`seen` is null)
// misses nothing that came after that moment and fires nothing that was already so before it. A task that is gone is
// forgotten; an archived one is noted and fires nothing.
export function newEvents(tasks, seen) {
  const next = {}, events = [];
  for (const t of tasks) {
    const marks = marksOf(t), had = seen?.[t.id];
    next[t.id] = marks;
    if (t.archivedAt) continue;
    for (const m of marks) if (!had?.includes(m)) events.push({ event: m.split(":")[0], task: t, at: markAt(t, m) });
  }
  return { events, seen: next, changed: JSON.stringify(next) !== JSON.stringify(seen || null) };
}
