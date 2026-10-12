// A task's reviews: the current one, which round, and every one it had.
import { isTagged } from "../gate.js";
import { oneLine } from "./tasks.js";

// Keep findings and evidence for reference, but a verdict stops describing the work once it resumes.
export const currentReview = (t) => (t?.review?.stale ? null : t?.review);
// Which review a task is on: 1 for its first, counted up each time a reviewer starts on it. "" before any review.
export const reviewRound = (t) => Math.max(0, Math.floor(Number(t?.reviewRound) || 0));
// Every review a task has had, oldest first: which one it was, how it came out, what it found, its short summary.
// A review that failed is kept too, with why. Nothing is ever dropped from the list. A review from before the gate
// keeps its score and its advice as they were.
const reviewEntry = (rv, round, at) => ({ round, at, ...(rv.error ? { error: oneLine(rv.error, 400) }
  : { ...(isTagged(rv) ? { meets: rv.meets, findings: rv.findings, gate: rv.gate, pass: rv.pass, left: rv.left || 0 } : { score: rv.score, recommend: rv.recommend, problems: rv.problems || [] }), text: rv.text, checks: rv.checks || [], limitations: rv.limitations || [], head: rv.head || null }) });
// The one review saved on a task from before the list existed. `round`: which review it was.
const savedReview = (t, round) => (t?.review && (Number.isInteger(t.review.score) || isTagged(t.review)) ? [reviewEntry(t.review, Math.max(1, round), t.review.at)] : []);
// A review saved before the list existed has no number of its own: it is the one the counter stands at. So it is
// put on the list, under that number, before the counter moves for the next review: a later review that is stopped
// half way can then never shift it to a wrong number.
export function keepSavedReview(t) {
  if (Array.isArray(t.reviews) && t.reviews.length) return;
  const had = savedReview(t, reviewRound(t));
  if (had.length) t.reviews = had;
}
// Called once the new review's number is on the task (after `keepSavedReview`, when that review started).
export function logReview(t, rv) {
  const round = reviewRound(t) || 1;
  const had = Array.isArray(t.reviews) && t.reviews.length ? t.reviews : savedReview(t, round - 1);
  t.reviews = [...had, reviewEntry(rv, round, Date.now())];
}
export function reviewHistory(t) {
  return Array.isArray(t?.reviews) && t.reviews.length ? t.reviews : savedReview(t, reviewRound(t));
}
export const reviewLabel = (t) => (reviewRound(t) ? `review ${reviewRound(t)}` : "");
