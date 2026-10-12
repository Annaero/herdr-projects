// Where a task stands, as the board sorts it: its group, its colour, whether an agent is on it, whether it waits for you.
import * as A from "../../actions.js";
import { herdr } from "../../herdr.js";
import { bar } from "./words.js";
import { waitingOf } from "../../store.js";

// The groups, in the order they need you. A task's state stays herdr's; the group is how the board sorts it.
export const GROUPS = ["needs you", "ready to approve", "working", "to do", "done"];
// herdr's own colour for each state (its status_color), with two of the board's own: finished work that waits for a
// yes is green, and a task nobody has started is grey.
export const GROUP_COLOR = { "needs you": "red", "ready to approve": "green", working: "yellow", done: "teal", "to do": "overlay0" };
export const MARK_STATES = ["working", "error", "done"];
export const isAgent = (r) => !!r.agent && !["todo", "progress"].includes(r.stage);
export const failureFor = (r) => (r.stage === "nosummary" ? null : A.failureOf(r));
export const canSendError = (r) => !!r && !r.host ? A.canSendError(r) : !!r && (r.stage === "nosummary" || (r.stage === "failed" && !r.failure?.auth));
// Finished work that waits for the one yes that merges it. A merge that failed, a branch behind main, or a pull
// request whose checks fail is not ready: it needs you instead.
export const inReview = (r) => r.state === "blocked" && r.kind === "permission" && r.stage === "approval" && !r.mergeFailed && !r.syncBlocked && !r.prFailure && r.prState !== "failing";
export const reviewing = (r) => r.state !== "done" && (r.stage === "reviewing" || r.stage === "reviewneeds");
export const needsYou = (r) => r.state === "blocked" || r.state === "error";
// A turn the provider cut off, which the board tries again by itself (store/retries.js): the wait, or null.
export const waitOf = (r) => waitingOf(r);
export const reviewerWord = (r) => (waitOf(r) ? "reviewer was cut off" : "reviewer is working");
export const groupOf = (r) => (inReview(r) ? "ready to approve" : needsYou(r) ? "needs you" : r.state === "working" ? "working" : r.state === "done" ? "done" : "to do");
// A live task: an agent, the reviewer or the board's check is on it, or it waits for you. Its row has two lines, the
// second for what it says (row.js); a done, to-do or archived task has nothing to say and keeps one.
export const isLive = (r) => !r.archivedAt && ["needs you", "ready to approve", "working"].includes(groupOf(r));
// The mark, the bar and the percent take the colour of the task's group; a task's own words (its title and what it
// says) stay in herdr's text colours whatever its state. While the reviewer works they are "review": a blue of its
// own (theme.js), so amber says only that the agent works and green only that the work passed and is ready.
// While the board checks the result itself they are "check": a plain light grey, neither the agent's nor the reviewer's.
export const checking = (r) => r.stage === "checking" && r.state === "working" && !r.archivedAt;
export const statusColor = (r) => (r.archivedAt ? "overlay0" : reviewing(r) && r.state === "working" ? "review" : checking(r) ? "check" : GROUP_COLOR[groupOf(r)]);
// A task as the screen reads it: `msg` is the line to show, `app` who is on it, `at` since when.
export const asRow = (t) => ({ ...t, msg: t.note || "", raw: t.msg, app: t.shownApp || "", at: t.state === "working" ? t.since || t.at : t.at });
