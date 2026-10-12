// A review in a few words: its result, its colour, which round it was.
import * as S from "../../store.js";
import * as G from "../../gate.js";
import { ordinal, landed, ink } from "./words.js";
import { isAgent, reviewing } from "./states.js";

// A review's result is said in words; its colour only repeats it. One from before the gate: its advice, as it was.
export const resultColor = (rv) => (G.isTagged(rv) ? (rv.pass ? "green" : "red") : rv.recommend === true ? "green" : rv.recommend === false ? "red" : "subtext0");
// In the task panel's heading: nothing on the first review; from the second on, in words: "2nd review".
export const roundWords = (r) => (S.reviewRound(r) >= 2 ? `${ordinal(S.reviewRound(r))} review` : "");
// On a row: which review a task is on or last had, written like the pull request's number: "R#2". Nothing before the
// first. Its colour alone says how that review went, with no mark beside it: green, it passed; red, it failed, and it
// stays so while the agent fixes what the review found; blue (the theme's "review"), the reviewer is on it right now.
export const reviewTag = (r) => (S.reviewNumber(r) ? `R#${S.reviewNumber(r)}` : "");
// Once the task is merged (by its pull request or here, with none) the tag goes quiet like its pull request's, so a list of done tasks is not a column of
// green. One stays red: merged although its last review failed, the only one worth noticing later.
export const reviewTagColor = (r) => (reviewing(r) ? "review" : S.reviewResult(r) === "fail" ? "red" : landed(r) ? "overlay0" : S.reviewResult(r) === "pass" ? "green" : "subtext0");
export const reviewTagInk = (t, r) => ink(t, reviewTagColor(r), reviewTag(r));
// In the task panel a merged task's reviews are quiet the same way: all but its last one, when that one failed.
export const quietReview = (r, e, last) => landed(r) && !(e === last && (e.error || resultColor(e) === "red"));
export const currentReview = (r) => S.currentReview(r);
// Strip only board-generated review metadata; task descriptions and agent wording stay intact.
export const reviewNote = (r) => (isAgent(r) ? String(r.msg || "").replace(G.SENTENCE, "$1") : r.msg);
// One review in a few words: "pass" in a list of them, "Pass · 2 minor" on its own. The colour repeats the result.
// One from before the gate keeps its score and advice: "4/5 yes", "4/5, says merge".
// `quiet` (quietReview) takes the colour away.
export const verdict = (t, e, long = false, quiet = false, c = quiet ? "overlay0" : e.error ? "red" : resultColor(e)) => (e.error ? ink(t, c, long ? "No verdict" : "no verdict")
  : G.isTagged(e) ? ink(t, c, long ? G.word(e) : G.word(e).toLowerCase()) + (long && G.tally(e) ? ` · ${G.tally(e)}` : "")
  : ink(t, c, `${e.score}/5`) + (e.recommend === true ? (long ? ", says merge" : " yes") : e.recommend === false ? (long ? ", says don't merge" : " no") : ""));
// The mark before a review's result: how it went, said without its colour. A dash: it gave no verdict or no advice.
export const verdictMark = (t, e, quiet = false) => { const how = e.error ? "none" : G.isTagged(e) ? (e.pass ? "pass" : "fail") : e.recommend === true ? "pass" : e.recommend === false ? "fail" : "none"; return ink(t, quiet ? "overlay0" : e.error ? "red" : resultColor(e), { pass: "✓", fail: "✗", none: "–" }[how]); };
