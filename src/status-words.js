// The status words, each said once: where a task stands, in the words the board's rows and State line, herdr's sidebar and the web page all use.
//
// One list, so that a task is never "needs you" in one place and "asks you" in another. The board reads a task as it
// shows it (board/view/states.js: `standing`); herdr's sidebar is told the same task, read the same way, with who is
// on it before the words (board/view/states.js: `whoStands`, flow/sidebar-entry.js makes its rows); the web page
// draws what the board's own code says (webui/list-model.js).
import * as G from "./gate.js";
import { currentReview } from "./store.js";

// What a task that waits for you needs, by its kind (OSC 7501): beside its mark (? ! @, board/theme.js).
export const NEEDS = { question: "asks you", permission: "asks for your OK", auth: "needs a login" };
export const WORDS = { needs: "needs you", ready: "ready to approve", reviewFailed: "review failed", working: "working", underReview: "under review", plan: "plan ready", todo: "to do", done: "done", wrong: "went wrong", behind: "behind main", pick: "pick one", passed: "passed its check" };

// Finished work whose last review failed. It still waits for your yes or no, but it is not "ready": it stands under
// "needs you", and a merge of it has to be asked for in so many words (actions/finish-line.js: approve).
export const reviewFailed = (t) => { if (t?.stage !== "approval") return false; const rv = currentReview(t); return !!rv && (G.isTagged(rv) ? !rv.pass : rv.recommend === false); }; // one from before the gate: by the reviewer's own advice
// "1 critical, 1 major"; a review from before the gate: "2/5, reviewer says no".
export const reviewTally = (t) => { const rv = currentReview(t); return !rv ? "" : G.isTagged(rv) ? G.tally(rv) : Number.isInteger(rv.score) ? `${rv.score}/5${rv.recommend === false ? ", reviewer says no" : ""}` : ""; };
// The line such a task says: "Review failed · 1 critical, 1 major".
export const reviewFailedLine = (t) => `Review failed${reviewTally(t) ? ` · ${reviewTally(t)}` : ""}`;

// Who is on a task, as herdr's sidebar names them before where it stands: `agent · working`, `board · checking`.
export const WHO = { agent: "agent", reviewer: "reviewer", board: "board", you: "you" };
// The board's own steps, each in a word, said after `board`.
export const STEPS = { starting: "starting", setup: "setting up", checking: "checking", pushing: "pushing", merging: "merging" };
export const QUEUED = "queued", STOPPED = "Stopped";

// Where the Coordinator stands (coordinator/look.js: its `state`), for the line above the board's box and for herdr's
// sidebar. Blocked, it has something on its screen for you to answer: it asks you.
export const COORDINATOR = "Coordinator";
const COORDINATOR_STANDS = { none: "not started: your first message starts it", starting: "starting", working: WORDS.working, blocked: NEEDS.question, idle: "idle", exited: "stopped: your next message starts it again" };
export const coordinatorStands = (v) => (v.error ? "could not be started" : COORDINATOR_STANDS[v.state] || v.state);
// The same with what waits to go in: "idle · 1 message waits to be sent". `word`: the board's own word for it
// where it has one (a reply you have not seen yet).
export function coordinatorStatus(v, word = coordinatorStands(v)) {
  const waiting = (v.waiting || []).length;
  return [word, waiting && `${waiting} ${waiting > 1 ? "messages wait" : "message waits"} to be sent`].filter(Boolean).join(" · ");
}
