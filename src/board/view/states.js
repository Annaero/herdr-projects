// Where a task stands, as the board sorts it: its group, its colour, whether an agent is on it, whether it waits for you.
import * as A from "../../actions.js";
import { herdr } from "../../herdr.js";
import { bar } from "./words.js";
import { waitingOf } from "../../store.js";

// The groups, in the order they need you. A task's state stays herdr's; the group is how the board sorts it.
export const GROUPS = ["needs you", "ready to approve", "working", "done", "to do"];
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
// The mark, the bar and the percent take the colour of the task's group; a task's own words (its title and what it
// says) stay in herdr's text colours whatever its state. While the reviewer works they are "review": the theme's
// green, the very colour of "ready to approve" (theme.js), since the work is past its agent and on its way to you.
export const statusColor = (r) => (r.archivedAt ? "overlay0" : reviewing(r) && r.state === "working" ? "review" : GROUP_COLOR[groupOf(r)]);
// A task as the screen reads it: `msg` is the line to show, `app` who is on it, `at` since when.
export const asRow = (t) => ({ ...t, msg: t.note || "", raw: t.msg, app: t.shownApp || "", at: t.state === "working" ? t.since || t.at : t.at });
