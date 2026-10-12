// A task's reviews: the current one, which round, and every one it had.
import { isTagged, passes } from "../gate.js";
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
// A review cut off by its provider waits and starts again as the same review: the counter is put back for the wait
// (finish.js), so during it the review the task is on is the next one.
const retrying = (t) => t?.waiting?.who === "reviewer" && (t.stage === "reviewing" || t.stage === "reviewneeds");
// The number of the review a task is on or last had. A review saved before reviews were counted was its first.
export const reviewNumber = (t) => (retrying(t) ? reviewRound(t) + 1 : reviewRound(t) || reviewHistory(t).at(-1)?.round || 0);
// How the review a task is on (or last had) came out: "pass", "fail", or "" with no verdict to go by. A review that
// ended with no verdict failed. One from before the gate goes by its advice. It holds while the agent fixes what the
// review found: the saved verdict is stale then, but it is still how that review went.
export function reviewResult(t) {
  const round = reviewNumber(t), e = reviewHistory(t).findLast((e) => e.round === round);
  if (!round || !e) return "";
  if (e.error) return "fail";
  return isTagged(e) ? (e.pass ? "pass" : "fail") : e.recommend === true ? "pass" : e.recommend === false ? "fail" : "";
}
// The last review of the work, when it passed: the review itself (as the task holds it, also when the work moved on
// since) and `head`, the commit the reviewer looked at. Null when there was none, it failed, or it gave no verdict.
export function passedReview(t) {
  const last = reviewHistory(t).at(-1);
  if (!last || last.error || !last.head || !passes(last) || !t?.review || !passes(t.review)) return null;
  const { stale, ...review } = t.review;
  return { review, head: last.head, round: last.round };
}
// A review that still stands after main was merged in is not a new review: it is written on the review it belongs
// to, each time, with what was checked instead. `k`: { head, from, merges, resolved, check }.
export function logKept(t, k) {
  keepSavedReview(t);
  if (!Array.isArray(t.reviews) || !t.reviews.length) return;
  const last = t.reviews.at(-1);
  t.reviews = [...t.reviews.slice(0, -1), { ...last, kept: [...(last.kept || []), { at: Date.now(), ...k }] }];
}
// "re-merged with main, tests pass, review 2 still stands"
export const keptWords = (k, round) => `re-merged with main${k?.resolved?.length ? ` (conflicts resolved in ${k.resolved.length} file${k.resolved.length === 1 ? "" : "s"})` : ""}, ${k?.check ? "tests pass" : "no check is set"}, review${round ? ` ${round}` : ""} still stands`;
export const reviewLabel = (t) => (reviewRound(t) ? `review ${reviewRound(t)}` : "");
