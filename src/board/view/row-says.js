// What a row says and counts, in words: its second line, and its percent, minutes left, review round, pull request and time. No drawing: herdr's sidebar says the same with these (flow/sidebar-entry.js).
//
// Kept apart from row.js so that whoever only needs the words (the keeper, a hook, a runner) does not load what the
// board is drawn with.
import * as G from "../../gate.js";
import { clean, age, prTag, bar, left } from "./words.js";
import { failureFor, inReview, failedReview, needsYou, statusColor, waitOf } from "./states.js";
import { reviewTally } from "../../status-words.js";
import { resultColor, reviewTagInk, currentReview, reviewNote } from "./review-words.js";

// What a row that waits for you says when its task has no words of its own: only what it waits for, again.
export const BARE = { question: "Has a question", permission: "Asks for your OK", auth: "Needs a login", error: "Failed" };

export class RowSays {
  // What a row has for each column on the right: the bar, the percent, the minutes left, the review tag in the
  // colour of how the review went, the pull request in the colour of its checks, the time. A cell the row does not have is the empty string, with no colour codes around nothing:
  // an empty cell must not count as a column. The bar, the percent and the minutes left share one colour.
  rowFields(r, now) {
    const t = this.theme, color = statusColor(r);
    const paint = (c, s) => (s ? t.fg(c, s) : "");
    const live = r.state !== "done", has = live && r.progress !== undefined;
    // The time is "working for" on a working row and "ago" on every other: the word says which.
    return { bar: has ? paint(color, bar(r.progress)) : "", percent: has ? paint(color, `${r.progress}%`) : "", eta: live && r.eta !== undefined ? paint(color, `${left(r.eta)} left`) : "", // minutes left, said as that ("25h left"), show with no percent too
      review: reviewTagInk(t, r), pr: prTag(t, r), elapsed: age(now - (r.at || now)), ago: r.state !== "working" };
  }
  // What a row says: under its name on a live task's row, after its name on any other. Never what its heading
  // already says ("to do", "approve?").
  sentence(r) {
    const t = this.theme;
    const words = (s) => clean(s || "").replace(/\*\*|`/g, "");
    // What a row says is greyed out, never the title's colour: the two are told apart at a glance. It has to be read,
    // so it is the brighter of the two greys (theme.js: soft). What a task asks of you is in the plain text colour.
    const quiet = (s) => (s ? t.soft(s) : ""), plainly = (s) => (s ? t.fg("text", s) : "");
    const failure = failureFor(r);
    // Cut off by its provider, and the board tries again by itself: the row says why and when, not that it failed.
    if (waitOf(r)) return { text: quiet(words(r.msg)) };
    if (failure && !failure.sentAt && (r.failure || r.prFailure)) return { text: quiet(words(failure.msg || failure.title)) };
    // Finished work whose review failed: it says so, in the colour of what failed, with the tally.
    if (failedReview(r)) return { text: t.fg("red", "Review failed") + quiet(reviewTally(r) ? ` · ${reviewTally(r)}` : "") };
    if (inReview(r)) {
      // The result and a short tally: "Pass · 2 minor". Which review it was is the row's R# tag.
      const rv = currentReview(r);
      if (G.isTagged(rv)) {
        const res = t.fg(resultColor(rv), G.word(rv)), tally = res + quiet(G.tally(rv) ? ` · ${G.tally(rv)}` : "");
        return { text: tally };
      }
      // A review from before the gate: its score, and the reviewer's advice in words.
      if (!rv || !Number.isInteger(rv.score)) return { text: r.review?.stale ? quiet("The work changed since its review") : "" };
      const score = t.fg(resultColor(rv), `${rv.score}/5`);
      const advice = score + quiet(rv.recommend === true ? " reviewer says yes" : rv.recommend === false ? " reviewer says no" : "");
      return { text: advice };
    }
    // Checks that fail with nothing saved about them yet: the row still says why it is not ready.
    if (r.stage === "approval" && r.prState === "failing" && !r.mergeFailed && !r.syncBlocked) return { text: quiet("The pull request's checks fail") };
    const raw = words((r.review?.stale ? reviewNote(r) : r.msg) || "");
    const msg = r.plain || ["working", "needs you", "under review", "idle"].includes(raw) ? "" : raw; // `plain`: the board's own plain word (state.js)
    // While the reviewer works the row says only what the reviewer is doing: the colour of its mark, its bar, its
    // percent and its minutes left says a review is running, and its R# tag which one.
    if (r.state === "done") return { text: "" };
    if (needsYou(r)) return { text: (r.state === "blocked" && msg ? plainly : quiet)(msg || BARE[r.kind] || (r.state === "error" ? BARE.error : "")) };
    return { text: quiet(msg) };
  }
}
