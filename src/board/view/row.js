// One row of the list: its mark, its name, what it says, and its columns on the right.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as G from "../../gate.js";
import { herdr } from "../../herdr.js";
import { short, clean, age, prNumber, prCheck, prColor, bar } from "./words.js";
import { MARK_STATES, failureFor, inReview, needsYou, statusColor, waitOf } from "./states.js";
import { resultColor, reviewTag, reviewCheck, reviewTagColor, currentReview, reviewNote, verdict } from "./review-words.js";

// The fewest cells a cut "doing now" sentence is still worth showing in.
const SENTENCE_MIN = 20;

export class Row {
  mark(r) {
    const t = this.theme;
    // herdr's own marks, a different one for each state, in the colour of the task's group.
    const c = statusColor(r);
    if (r.archivedAt) return t.fg(c, t.mark("unknown"));
    if (inReview(r)) return t.fg(c, t.bold(t.mark("done")));
    if (r.state === "blocked") return t.fg(c, t.bold(t.mark("blocked")));
    if (r.state === "done") return t.dim(t.fg(c, t.mark("done"))); // finished: the same mark, only quieter
    return t.fg(c, t.mark(MARK_STATES.includes(r.state) ? r.state : "idle"));
  }
  // What a row has for each column on the right: the bar, the percent, the minutes left, the review tag and the mark
  // for how the review went, the pull request and the mark for its checks, the time. A cell the row does not have is the empty string, with no colour codes around nothing:
  // an empty cell must not count as a column. The bar, the percent and the minutes left share one colour.
  rowFields(r, now) {
    const t = this.theme, color = statusColor(r);
    const paint = (c, s) => (s ? t.fg(c, s) : "");
    const live = r.state !== "done", has = live && r.progress !== undefined;
    // The time is "working for" on a working row and "ago" on every other: the word says which.
    return { bar: has ? paint(color, bar(r.progress)) : "", percent: has ? paint(color, `${String(r.progress).padStart(3)}%`) : "", eta: live && r.eta !== undefined ? paint(color, `${r.eta}m`) : "", // minutes left show with no percent too
      review: paint(reviewTagColor(r), reviewTag(r)), reviewCheck: paint(reviewTagColor(r), reviewCheck(r)), pr: paint(prColor(r), prNumber(r)), check: paint(prColor(r), prCheck(r)), elapsed: age(now - (r.at || now)), ago: r.state !== "working" };
  }
  // What a row says after its name. Never what its heading already says ("to do", "approve?").
  sentence(r) {
    const t = this.theme;
    const words = (s) => clean(s || "").replace(/\*\*|`/g, "");
    // What a row says is greyed out, never the title's colour: the two are told apart at a glance.
    const quiet = (s) => (s ? t.muted(s) : "");
    const failure = failureFor(r);
    // Cut off by its provider, and the board tries again by itself: the row says why and when, not that it failed.
    if (waitOf(r)) return { text: quiet(words(r.msg)) };
    if (failure && !failure.sentAt && (r.failure || r.prFailure)) return { text: quiet(words(failure.msg || failure.title)) };
    if (inReview(r)) {
      // The result and a short tally: "Pass · 2 minor". Which review it was is the row's R# tag.
      const rv = currentReview(r);
      if (G.isTagged(rv)) {
        const res = t.fg(resultColor(rv), G.word(rv)), tally = res + quiet(G.tally(rv) ? ` · ${G.tally(rv)}` : "");
        return { text: tally, forms: [tally, res] }; // never cut: it shows whole, or as the one word
      }
      // A review from before the gate: its score, and the reviewer's advice in words.
      if (!rv || !Number.isInteger(rv.score)) return { text: r.review?.stale ? quiet("the work changed since its review") : "" };
      const score = t.fg(resultColor(rv), `${rv.score}/5`);
      const advice = score + quiet(rv.recommend === true ? " reviewer says yes" : rv.recommend === false ? " reviewer says no" : "");
      return { text: advice, forms: [advice, score] }; // never cut: it shows whole, or as the score alone
    }
    // Checks that fail with nothing saved about them yet: the row still says why it is not ready.
    if (r.stage === "approval" && r.prState === "failing" && !r.mergeFailed && !r.syncBlocked) return { text: quiet("the pull request's checks fail") };
    const raw = words((r.review?.stale ? reviewNote(r) : r.msg) || "");
    const msg = ["working", "needs you", "under review", "idle"].includes(raw) ? "" : raw;
    // While the reviewer works the row says only what the reviewer is doing: the colour of its mark, its bar, its
    // percent and its minutes left says a review is running, and its R# tag which one.
    if (r.state === "done") return { text: "" };
    if (needsYou(r)) return { text: quiet(msg || { question: "has a question", permission: "asks for your OK", auth: "needs a login" }[r.kind] || (r.state === "error" ? "failed" : "")) };
    return { text: quiet(msg) };
  }
  rowTitle(r) { return clean(r.title || r.id) + (r.archivedAt ? " [archived]" : ""); }
  // The columns on the right are laid out first, once for the whole list: which there are and how wide each is. Every
  // row draws them at those widths, so each column starts at the same place on every row. Left to right they are
  // also the order a row gives them up in (rowKeeps): the bar, the percent and the minutes left, the review
  // tag, the pull request, the time.
  rowLayout(records, width) {
    const now = Date.now(), fields = records.map((r) => this.rowFields(r, now));
    const max = (key) => Math.max(0, ...fields.map((f) => visibleWidth(f[key])));
    const elapsed = Math.max(3, max("elapsed"));
    // Extremely long PR identifiers may shorten, but must never push time off-screen.
    const pr = Math.min(max("pr"), Math.max(0, width - 3 - elapsed - 3)), check = pr ? max("check") : 0, review = max("review"), reviewCheck = max("reviewCheck");
    const cols = [["bar", max("bar")], ["percent", max("percent")], ["eta", max("eta")], ["review", review + (reviewCheck ? 2 : 0)], ["pr", pr + (check ? 2 : 0)], ["time", elapsed]].filter(([, w]) => w);
    const layout = { now, review, reviewCheck, pr, check, elapsed, cols, ago: fields.some((f) => f.ago) };
    // The word "ago" sits right of everything, so one row cannot give it up without moving its columns: the whole
    // list gives it up, as soon as that lets some row keep a column other than its bar.
    const kept = (lay) => records.map((r, n) => this.rowKeeps(r, width, lay, fields[n]).kept);
    if (layout.ago) { const lean = kept({ ...layout, ago: false }); layout.ago = !kept(layout).some((k, n) => lean[n] > k); }
    return layout;
  }
  // The columns one row keeps, drawn. A row whose name does not fit beside them gives up its own columns one at a
  // time from the left, so the ones it keeps stay where they are on every other row. What a row says never counts here.
  rowKeeps(r, width, layout, f = this.rowFields(r, layout.now)) {
    const t = this.theme;
    const fill = (s, n, left) => { const gap = " ".repeat(Math.max(0, n - visibleWidth(s))); return left ? s + gap : gap + s; }; // by terminal cells, not string length
    const text = {
      bar: f.bar, percent: f.percent, eta: f.eta,
      // R#2 is left-aligned, so the tags line up; the mark for how the review went sits in a column of its own.
      review: f.review ? fill(f.review, layout.review, true) + (layout.reviewCheck ? " " + (f.reviewCheck || " ") : "") : "",
      // PR#16 the same way, so the "PR#" parts line up; the mark for its checks sits in a column of its own.
      pr: f.pr ? fill(truncateToWidth(f.pr, layout.pr, "…"), layout.pr, true) + (layout.check ? " " + (f.check || " ") : "") : "",
      time: t.fg("overlay0", f.elapsed.padStart(layout.elapsed) + (layout.ago ? (f.ago ? " ago" : "    ") : "")),
    };
    const cells = layout.cols.map(([key, w]) => ({ key, text: text[key], w: w + (key === "time" && layout.ago ? 4 : 0) }));
    const room = Math.max(0, width - visibleWidth(this.mark(r)) - 2), need = Math.min(room, visibleWidth(this.rowTitle(r)));
    const wide = (from) => cells.slice(from).reduce((n, c) => n + c.w + 1, 1); // the columns, a cell between each, two before them
    // Blank cells left of a row's first own column are not columns to that row: its words run into them.
    const next = (from) => { while (from < cells.length && !cells[from].text) from++; return from; };
    let from = next(0);
    // The minutes left go with their percent: alone beside the time they would read as a second time.
    while (from < cells.length && room - wide(from) < need) from = next(from + (cells[from].key === "percent" && cells[from + 1]?.key === "eta" ? 2 : 1));
    const own = cells.slice(from);
    return { kept: own.filter((c) => c.text && c.key !== "bar").length, metadata: own.map((c) => fill(c.text, c.w, c.key === "pr" || c.key === "review")).join(" ") };
  }
  row(r, width, layout = this.rowLayout([r], width)) {
    const t = this.theme;
    const bright = r.state === "working" || r.state === "blocked";
    // The title is plain text whatever the task's state: the mark and the group's heading carry the state's colour.
    const name = bright ? t.bold(this.rowTitle(r)) : this.rowTitle(r);
    const prefix = ` ${this.mark(r)} `;
    const room = Math.max(0, width - visibleWidth(prefix));
    // In the all-machines view the machine's name sits before the task's, in what the task's name leaves: it is cut first.
    const host = r.host && this.scope === "*" ? clean(r.host) : "";
    const labelName = (w) => {
      const shown = truncateToWidth(name, w, "…");
      const hostRoom = w - visibleWidth(shown) - 1;
      return (host && hostRoom >= Math.min(3, visibleWidth(host)) ? t.fg("overlay0", truncateToWidth(host, hostRoom, "…")) + " " : "") + shown;
    };
    // One rule for every row. The columns first, at the list's widths; the name in what they leave, and the columns
    // give way to it; what the row says in what is then left, and it never moves or costs a column.
    const { metadata } = this.rowKeeps(r, width, layout);
    const labelRoom = Math.max(0, room - visibleWidth(metadata) - (metadata ? 2 : 0));
    const said = this.sentence(r), sayW = visibleWidth(said.text || "");
    const renderedTitle = labelName(labelRoom);
    const sayRoom = labelRoom - visibleWidth(renderedTitle) - 2;
    // A sentence cut to a few letters says nothing: it shows whole, or with at least SENTENCE_MIN cells, or not at all.
    const tail = !sayW ? "" : said.forms ? said.forms.find((f) => visibleWidth(f) <= sayRoom) || "" : sayRoom >= Math.min(sayW, SENTENCE_MIN) ? truncateToWidth(said.text, sayRoom, "…") : "";
    const label = renderedTitle + (tail ? "  " + tail : "");
    return prefix + label + " ".repeat(Math.max(0, room - visibleWidth(label) - visibleWidth(metadata))) + metadata;
  }
}
