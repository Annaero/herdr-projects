// One row of the list: its mark, its name, its columns on the right and, for a live task, a second line that says what it does (a third on a narrow screen: row-tall.js, where long ones wrap: row-wrap.js).
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as G from "../../gate.js";
import { herdr } from "../../herdr.js";
import { short, clean, age, prTag, bar, left } from "./words.js";
import { MARK_STATES, failureFor, inReview, isLive, needsYou, statusColor, reviewerMark, boardStep, waitOf } from "./states.js";
import { ETA_STEADY, labelRoom, shownFrom } from "./row-fit.js";
import { tallAt } from "./row-tall.js";
import { isResearch } from "../../research.js";
import { resultColor, reviewTagInk, currentReview, reviewNote, verdict } from "./review-words.js";

// The fewest cells a cut "doing now" sentence is still worth showing in.
const SENTENCE_MIN = 20;
// The progress columns, the left group of a row's columns. Right of them: the review tag, the pull request, the time.
const PROGRESS = ["bar", "percent", "eta"];

export class Row {
  mark(r) {
    const t = this.theme;
    // herdr's own marks, a different one for each state, in the colour of the task's group.
    const c = statusColor(r);
    if (r.archivedAt) return t.fg(c, t.mark("unknown"));
    if (inReview(r)) return t.fg(c, t.bold(t.mark("done")));
    if (reviewerMark(r)) return t.fg(c, t.mark("review")); // the reviewer at work: the working mark, facing the other way
    if (boardStep(r)) return t.fg(c, t.mark("board")); // a step of the board's own: one mark for all of them
    if (r.state === "blocked") return t.fg(c, t.bold(t.mark("blocked")));
    if (r.state === "done") return t.dim(t.fg(c, t.mark("done"))); // finished: the same mark, only quieter
    return t.fg(c, t.mark(MARK_STATES.includes(r.state) ? r.state : "idle"));
  }
  // What a row has for each column on the right: the bar, the percent, the minutes left, the review tag in the
  // colour of how the review went, the pull request in the colour of its checks, the time. A cell the row does not have is the empty string, with no colour codes around nothing:
  // an empty cell must not count as a column. The bar, the percent and the minutes left share one colour.
  rowFields(r, now) {
    const t = this.theme, color = statusColor(r);
    const paint = (c, s) => (s ? t.fg(c, s) : "");
    const live = r.state !== "done", has = live && r.progress !== undefined;
    // The time is "working for" on a working row and "ago" on every other: the word says which.
    return { bar: has ? paint(color, bar(r.progress)) : "", percent: has ? paint(color, `${String(r.progress).padStart(3)}%`) : "", eta: live && r.eta !== undefined ? paint(color, left(r.eta)) : "", // minutes left show with no percent too
      review: reviewTagInk(t, r), pr: prTag(t, r), elapsed: age(now - (r.at || now)), ago: r.state !== "working" };
  }
  // What a row says: under its name on a live task's row, after its name on any other. Never what its heading
  // already says ("to do", "approve?").
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
    if (needsYou(r)) return { text: quiet(msg || { question: "Has a question", permission: "Asks for your OK", auth: "Needs a login" }[r.kind] || (r.state === "error" ? "Failed" : "")) };
    return { text: quiet(msg) };
  }
  // What a row says on its first line, after its name: nothing on a live task's row, which says it on its second.
  saysBeside(r) { return isLive(r) ? { text: "" } : this.sentence(r); }
  rowTitle(r) { return clean(r.title || r.id) + (isResearch(r) ? " [research]" : "") + (r.archivedAt ? " [archived]" : ""); }
  // The fewest cells a row needs to say something: a sentence cut to a few letters says nothing.
  sayNeed(said) { return Math.min(visibleWidth(said.text || ""), SENTENCE_MIN); }
  // The columns on the right are laid out first, once for the whole list: which there are and how wide each is. Every
  // row draws them at those widths, so each column starts at the same place on every row. What is shown of them is
  // decided one section at a time (row-fit.js): a section's rows give the same things up together, from the left.
  // They are two groups, the progress and then the review, the pull request and the time, with a wider gap between
  // the two than inside either.
  // On a narrow screen (`screen`: the whole board's width, which is the list's unless the task panel is beside it) a
  // live task's columns are on its third line: its first line has none, and they take no part in what is decided here.
  // Neither do the selected row's there, which gives them up for its whole name (row-wrap.js), and no row has its
  // time: a one-line row's name gets that room.
  rowLayout(records, width, sections = [records], screen = width) {
    const now = Date.now(), tall = tallAt(screen), below = (r) => tall && isLive(r), bare = (r) => this.wraps(r, tall);
    const fields = new Map(records.filter((r) => !bare(r)).map((r) => [r, this.rowFields(r, now)]));
    const max = (key) => Math.max(0, ...[...fields.values()].map((f) => visibleWidth(f[key])));
    const elapsed = Math.max(3, max("elapsed"));
    // Extremely long PR identifiers may shorten, but must never push time off-screen.
    const pr = Math.min(max("pr"), Math.max(0, width - 3 - elapsed - 3)), review = max("review");
    const cols = [["bar", max("bar")], ["percent", max("percent")], ["eta", max("eta")], ["review", review], ["pr", pr], ["time", tall ? 0 : elapsed]].filter(([, w]) => w);
    // The wider gap is a column with nothing in it, left of the review tag: the cell on each side of it makes two.
    const group = cols.findIndex(([key]) => !PROGRESS.includes(key));
    if (group > 0) cols.splice(group, 0, ["gap", 0]);
    const layout = { now, review, pr, elapsed, cols, ago: !tall && [...fields.values()].some((f) => f.ago), show: new Map(), tall };
    if (tall) layout.third = this.tallLayout(records.filter(below).map((r) => this.rowFields(r, now)), width);
    // Decided at widths that do not move as the numbers tick: the minutes left count as their widest (words.js: left).
    const cells = (ago) => cols.map(([key, w]) => ({ key, w: key === "eta" ? Math.max(w, ETA_STEADY) : w + (key === "time" && ago ? 4 : 0) }));
    const fit = (r) => { const f = fields.get(r) || {}; return { room: Math.max(0, width - visibleWidth(this.mark(r)) - 2), name: visibleWidth(this.rowTitle(r)), has: { bar: f.bar, percent: f.percent, eta: f.eta, review: f.review, pr: f.pr, time: !tall } }; };
    const parts = sections.map((recs) => recs.map(fit));
    // The word "ago" sits right of everything, so one section cannot give it up without moving its columns: the
    // whole list gives it up, as soon as that lets some section show a column other than its bar, or cut a name less.
    const cheaper = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    if (layout.ago) layout.ago = !parts.some((rows) => cheaper(shownFrom(rows, cells(false)).cost, shownFrom(rows, cells(true)).cost));
    sections.forEach((recs, n) => {
      const steady = cells(layout.ago), { from } = shownFrom(parts[n], steady);
      // What the rows say goes the same way: every row of the section that says something has room for it, or none says it.
      // A row's name and what it says are drawn in the room decided here, so neither moves as the numbers tick.
      const rooms = recs.map((r, m) => Math.max(0, labelRoom(parts[n][m], steady, from)));
      const says = recs.every((r, m) => { const said = this.saysBeside(r); return !visibleWidth(said.text || "") || rooms[m] - visibleWidth(this.rowName(r, rooms[m])) - 2 >= this.sayNeed(said); });
      recs.forEach((r, m) => layout.show.set(r, { from, says, room: rooms[m] }));
    });
    return layout;
  }
  // The columns one row shows, drawn: its own from where its section's start (layout.show).
  rowKeeps(r, width, layout, f = this.rowFields(r, layout.now)) {
    const t = this.theme;
    if (this.wraps(r, layout.tall)) return { metadata: "" };
    const fill = (s, n, left) => { const gap = " ".repeat(Math.max(0, n - visibleWidth(s))); return left ? s + gap : gap + s; }; // by terminal cells, not string length
    const text = {
      bar: f.bar, percent: f.percent, eta: f.eta,
      // R#2 ends where the pull request starts: the review belongs to the pull request, not to the progress. Its
      // colour says how the review went: it has no mark.
      review: f.review,
      // PR#16 the same way, so the "PR#" parts line up. Its colour says how its checks went: it has no mark.
      pr: f.pr ? fill(truncateToWidth(f.pr, layout.pr, "…"), layout.pr, true) : "",
      gap: "",
      // A finished row's time is quiet like its merged tags (the theme's muted): nothing on its right is live.
      time: (r.state === "done" ? (s) => t.muted(s) : (s) => t.fg("overlay0", s))(f.elapsed.padStart(layout.elapsed) + (layout.ago ? (f.ago ? " ago" : "    ") : "")),
    };
    const cells = layout.cols.map(([key, w]) => ({ key, text: text[key], w: w + (key === "time" && layout.ago ? 4 : 0) }));
    // Blank cells left of a row's first own column are not columns to that row: its words run into them.
    let from = layout.show.get(r)?.from ?? 0;
    while (from < cells.length && !cells[from].text) from++;
    return { metadata: cells.slice(from).map((c) => fill(c.text, c.w, c.key === "pr")).join(" ") };
  }
  // A row's name in `w` cells. In the all-machines view the machine's name sits before the task's, in what the
  // task's name leaves: it is cut first.
  rowNameParts(r, w) {
    const t = this.theme;
    const shown = truncateToWidth(this.nameInk(r, this.rowTitle(r)), w, "…");
    const host = r.host && this.scope === "*" ? clean(r.host) : "", hostRoom = w - visibleWidth(shown) - 1;
    return { host: host && hostRoom >= Math.min(3, visibleWidth(host)) ? t.fg("overlay0", truncateToWidth(host, hostRoom, "…")) + " " : "", shown };
  }
  // The title is plain text whatever the task's state: the mark and the group's heading carry the state's colour.
  nameInk(r, s) { return r.state === "working" || r.state === "blocked" ? this.theme.bold(s) : s; }
  rowName(r, w) { const { host, shown } = this.rowNameParts(r, w); return host + shown; }
  // A row's first line, measured: its mark, the columns it keeps, and the room they leave its name.
  rowRoom(r, width, layout) {
    const prefix = ` ${this.mark(r)} `, room = Math.max(0, width - visibleWidth(prefix));
    const { metadata } = this.rowKeeps(r, width, layout), show = layout.show.get(r);
    return { prefix, room, metadata, show, labelRoom: Math.min(show?.room ?? room, Math.max(0, room - visibleWidth(metadata) - (metadata ? 2 : 0))) };
  }
  row(r, width, layout = this.rowLayout([r], width)) {
    // One rule for every row. The columns first, at the list's widths, as many as the row's section shows; the name
    // in what they leave; what the row says in what is then left, when its section's rows say anything.
    const { prefix, room, metadata, show, labelRoom } = this.rowRoom(r, width, layout);
    const said = (show?.says ?? true) ? this.saysBeside(r) : { text: "" }, sayW = visibleWidth(said.text || "");
    const renderedTitle = this.rowName(r, labelRoom);
    const sayRoom = labelRoom - visibleWidth(renderedTitle) - 2;
    // A sentence cut to a few letters says nothing: it shows whole, or with at least SENTENCE_MIN cells.
    const tail = !sayW || sayRoom < this.sayNeed(said) ? "" : truncateToWidth(said.text, sayRoom, "…");
    const label = renderedTitle + (tail ? "  " + tail : "");
    return prefix + label + " ".repeat(Math.max(0, room - visibleWidth(label) - visibleWidth(metadata))) + metadata;
  }
  // A live task's second line: what it says, under its name, with the row's whole width. It starts where the task's
  // name starts: right of the mark and, in the all-machines view, right of the machine's name. Too long, it is cut at
  // its end, never wrapped (on a narrow screen it is: row-wrap.js). The line is there from the start, so a row does not grow when its words arrive: a working
  // task always has words (status-kept.js), and a task that waits with nothing to say an empty line. Never a bare "…".
  statusLine(r, width, layout = this.rowLayout([r], width)) {
    const lead = this.rowLead(r, width, layout);
    return truncateToWidth(lead + this.sentence(r).text, width, "…");
  }
  // Where a live task's lines under its first start: under its name.
  rowLead(r, width, layout) { const { prefix, labelRoom } = this.rowRoom(r, width, layout); return " ".repeat(visibleWidth(prefix) + visibleWidth(this.rowNameParts(r, labelRoom).host)); }
  // A row as the list draws it: one line, two for a live task. On a narrow screen a live task has a third, and long
  // names and words wrap (row-wrap.js).
  rowLines(r, width, layout = this.rowLayout([r], width)) {
    if (this.wraps(r, layout.tall)) return this.wrappedLines(r, width, layout);
    return isLive(r) ? [this.row(r, width, layout), this.statusLine(r, width, layout)] : [this.row(r, width, layout)];
  }
}
