// The status words, each said once: where a task stands, in the words the board's rows and State line, herdr's sidebar and the web page all use.
//
// One list, so that a task is never "needs you" in one place and "asks you" in another. The board reads a task as it
// shows it (board/view/states.js: `standing`); herdr's sidebar reads the task as saved, by its stage (`sidebarWords`,
// flow/sidebar.js writes them); the web page draws what the board's own code says (webui/list-model.js).
import * as G from "./gate.js";
import { currentReview, waitingOf } from "./store.js";

// What a task that waits for you needs, by its kind (OSC 7501): beside its mark (? ! @, board/theme.js).
export const NEEDS = { question: "asks you", permission: "asks for your OK", auth: "needs a login" };
export const WORDS = { needs: "needs you", ready: "ready to approve", reviewFailed: "review failed", working: "working", underReview: "under review", todo: "to do", done: "done", wrong: "went wrong", behind: "behind main" };

// Finished work whose last review failed. It still waits for your yes or no, but it is not "ready": it stands under
// "needs you", and a merge of it has to be asked for in so many words (actions/finish-line.js: approve).
export const reviewFailed = (t) => { if (t?.stage !== "approval") return false; const rv = currentReview(t); return !!rv && (G.isTagged(rv) ? !rv.pass : rv.recommend === false); }; // one from before the gate: by the reviewer's own advice
// "1 critical, 1 major"; a review from before the gate: "2/5, reviewer says no".
export const reviewTally = (t) => { const rv = currentReview(t); return !rv ? "" : G.isTagged(rv) ? G.tally(rv) : Number.isInteger(rv.score) ? `${rv.score}/5${rv.recommend === false ? ", reviewer says no" : ""}` : ""; };
// The line such a task says: "Review failed · 1 critical, 1 major".
export const reviewFailedLine = (t) => `Review failed${reviewTally(t) ? ` · ${reviewTally(t)}` : ""}`;

// A saved task for herdr's sidebar: { label, line }. `label`: where it stands, the State line's words. `line`: what it
// says, as its row's second line does. Both empty while its agent, its reviewer or the board simply works: herdr's
// own status and the Watcher's line say that.
export function sidebarWords(t) {
  const none = { label: "", line: "" }, one = (s) => String(s || "").replace(/\s+/g, " ").trim();
  if (!t || waitingOf(t)?.who === "agent") return none; // the board tries again by itself: nothing for you to do
  const rv = currentReview(t);
  switch (t.stage) {
    case "approval":
      if (t.mergeFailed || t.prFailure || t.prState === "failing") return { label: WORDS.wrong, line: one(t.failure?.title || t.prFailure?.title || "The pull request's checks fail") };
      if (t.syncBlocked) return { label: WORDS.behind, line: one(t.syncBlocked.why) };
      if (reviewFailed(t)) return { label: WORDS.reviewFailed, line: reviewTally(t) };
      return { label: WORDS.ready, line: rv && G.isTagged(rv) ? [G.word(rv), G.tally(rv)].filter(Boolean).join(" · ") : rv && Number.isInteger(rv.score) ? `${rv.score}/5` : "" };
    case "asks": return { label: NEEDS[t.kind] || NEEDS.question, line: one(t.msg) };
    case "nosummary": return { label: WORDS.needs, line: "Stopped without a summary" };
    case "reviewneeds": return { label: WORDS.needs, line: one(t.msg) || "The reviewer needs you" };
    case "failed": return t.failure?.auth ? { label: NEEDS.auth, line: one(t.failure.title) } : { label: WORDS.wrong, line: one(t.failure?.title || t.msg) };
    case "reviewing": return { label: WORDS.underReview, line: "" };
  }
  return none;
}
