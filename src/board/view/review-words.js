// A review in a few words: its result, its colour, which round it was.
import * as S from "../../store.js";
import * as G from "../../gate.js";
import { ordinal } from "./words.js";
import { isAgent, reviewing } from "./states.js";

// A review's result is said in words; its colour only repeats it. One from before the gate: its advice, as it was.
export const resultColor = (rv) => (G.isTagged(rv) ? (rv.pass ? "green" : "red") : rv.recommend === true ? "green" : rv.recommend === false ? "red" : "subtext0");
// In the task panel's heading: nothing on the first review; from the second on, in words: "2nd review".
export const roundWords = (r) => (S.reviewRound(r) >= 2 ? `${ordinal(S.reviewRound(r))} review` : "");
// On a row: which review a task is on or last had, written like the pull request's number: "R#2". Nothing before the
// first. Its colour alone says how that review went, with no mark beside it: green, it passed; red, it failed, and it
// stays so while the agent fixes what the review found; blue (the theme's "review"), the reviewer is on it right now.
export const reviewTag = (r) => (S.reviewNumber(r) ? `R#${S.reviewNumber(r)}` : "");
export const reviewTagColor = (r) => (reviewing(r) ? "review" : { pass: "green", fail: "red" }[S.reviewResult(r)] || "subtext0");
export const currentReview = (r) => S.currentReview(r);
// Strip only board-generated review metadata; task descriptions and agent wording stay intact.
export const reviewNote = (r) => (isAgent(r) ? String(r.msg || "").replace(G.SENTENCE, "$1") : r.msg);
// One review in a few words: "pass" in a list of them, "Pass · 2 minor" on its own. The colour repeats the result.
// One from before the gate keeps its score and advice: "4/5 yes", "4/5, says merge".
export const verdict = (t, e, long = false) => (e.error ? t.fg("red", long ? "No verdict" : "no verdict")
  : G.isTagged(e) ? t.fg(resultColor(e), long ? G.word(e) : G.word(e).toLowerCase()) + (long && G.tally(e) ? ` · ${G.tally(e)}` : "")
  : t.fg(resultColor(e), `${e.score}/5`) + (e.recommend === true ? (long ? ", says merge" : " yes") : e.recommend === false ? (long ? ", says don't merge" : " no") : ""));
// The mark before a review's result: how it went, said without its colour. A dash: it gave no verdict or no advice.
export const verdictMark = (t, e) => { const how = e.error ? "none" : G.isTagged(e) ? (e.pass ? "pass" : "fail") : e.recommend === true ? "pass" : e.recommend === false ? "fail" : "none"; return t.fg(e.error ? "red" : resultColor(e), { pass: "✓", fail: "✗", none: "–" }[how]); };
