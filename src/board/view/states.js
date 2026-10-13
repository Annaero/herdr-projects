// Where a task stands, as the board sorts it: its group, its colour, whether an agent is on it, whether it waits for you.
import * as A from "../../actions.js";
import { herdr } from "../../herdr.js";
import { bar } from "./words.js";
import { waitingOf } from "../../store.js";
import { NEEDS, WORDS, reviewFailed } from "../../status-words.js";

export { NEEDS, reviewFailed };

// The groups, in the order they need you. A task's state stays herdr's; the group is how the board sorts it.
export const GROUPS = ["needs you", "ready to approve", "working", "to do", "done"];
// herdr's own colour for each state (its status_color), with two of the board's own: finished work that waits for a
// yes is green, and a task nobody has started is "todo", a dim grey that is never taken for plain text (theme.js).
export const GROUP_COLOR = { "needs you": "red", "ready to approve": "green", working: "yellow", done: "teal", "to do": "todo" };
export const MARK_STATES = ["working", "error", "done"];
export const isAgent = (r) => !!r.agent && !["todo", "progress"].includes(r.stage);
export const failureFor = (r) => (r.stage === "nosummary" ? null : A.failureOf(r));
export const canSendError = (r) => !!r && !r.host ? A.canSendError(r) : !!r && (r.stage === "nosummary" || (r.stage === "failed" && !r.failure?.auth));
// Finished work that waits for the one yes that merges it. A merge that failed, a branch behind main, a pull
// request whose checks fail, or work whose last review failed is not ready: it needs you instead.
const awaitsYes = (r) => r.state === "blocked" && r.kind === "permission" && r.stage === "approval" && !r.mergeFailed && !r.syncBlocked && !r.prFailure && r.prState !== "failing";
export const inReview = (r) => awaitsYes(r) && !reviewFailed(r);
// Work whose last review failed, and nothing else in its way: your call (merge anyway, or send the review back).
export const failedReview = (r) => awaitsYes(r) && reviewFailed(r);
export const reviewing = (r) => r.state !== "done" && (r.stage === "reviewing" || r.stage === "reviewneeds");
// The reviewer is at work on it right now: not when its dialog waits for you, and not once the task is back with its agent.
export const underReview = (r) => reviewing(r) && r.state === "working";
// The board itself is on it, neither the agent nor the reviewer: it starts the agent, sets up, runs the check, pushes
// or merges. One mark for all of these steps (◒, row.js). A task that only waits keeps the plain working mark, as
// nobody is on it: for a free slot, to try again after a turn was cut off, for its check's turn (check-progress.js),
// or for its turn to merge (finish/line.js).
const BOARD_STEPS = ["starting", "setup", "checking", "pushing", "merging"];
const stepWaits = (r) => (r.stage === "checking" && r.check?.state === "waiting") || (r.stage === "merging" && !!r.lineAt) || !!waitOf(r);
export const boardStep = (r) => !r.archivedAt && r.state === "working" && BOARD_STEPS.includes(r.stage) && !stepWaits(r);
export const reviewerMark = (r) => underReview(r) && !waitOf(r);
export const needsYou = (r) => r.state === "blocked" || r.state === "error";
// A turn the provider cut off, which the board tries again by itself (store/retries.js): the wait, or null.
export const waitOf = (r) => waitingOf(r);
export const reviewerWord = (r) => (waitOf(r) ? "reviewer was cut off" : "reviewer is working");
export const groupOf = (r) => (inReview(r) ? "ready to approve" : needsYou(r) ? "needs you" : r.state === "working" ? "working" : r.state === "done" ? "done" : "to do");
// Where a task stands, in the words of the one list (status-words.js): what a task that waits for you needs, by its
// kind (OSC 7501), as the State line and the chat say it beside the mark (? ! @, theme.js); "review failed" for
// finished work whose review failed. A task that went wrong, a merge that did not go through, or one whose kind is
// not known, "needs you".
export const standing = (r) => (!r.archivedAt && failedReview(r) ? WORDS.reviewFailed : (r.state === "blocked" && r.stage !== "approval" && !r.archivedAt && (!failureFor(r) || r.kind === "auth") && NEEDS[r.kind]) || groupOf(r));
// A live task: an agent, the reviewer or the board's check is on it, or it waits for you. Its row has two lines, the
// second for what it says (row.js); a done, to-do or archived task has nothing to say and keeps one.
export const isLive = (r) => !r.archivedAt && ["needs you", "ready to approve", "working"].includes(groupOf(r));
// The mark, the bar and the percent take the colour of the task's group; a task's own words (its title and what it
// says) stay in herdr's text colours whatever its state. While the reviewer works they are "review": a blue of its
// own (theme.js) and the mark faces the other way (◑, row.js), so amber says only that the agent works and green only that the work passed and is ready.
// While the board checks the result itself they are "check": a plain light grey, neither the agent's nor the reviewer's.
export const checking = (r) => r.stage === "checking" && r.state === "working" && !r.archivedAt;
export const statusColor = (r) => (r.archivedAt ? "overlay0" : underReview(r) ? "review" : checking(r) ? "check" : GROUP_COLOR[groupOf(r)]);
// A task as the screen reads it: `msg` is the line to show, `app` who is on it, `at` since when.
export const asRow = (t) => ({ ...t, msg: t.note || "", raw: t.msg, app: t.shownApp || "", at: t.state === "working" ? t.since || t.at : t.at });
