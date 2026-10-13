// One row of the list: its mark, its number (row-number.js), its name, its columns on the right and, for a live task, a second line that says what it does (a third on a narrow screen: row-tall.js, where long ones wrap: row-wrap.js).
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as G from "../../gate.js";
import { herdr } from "../../herdr.js";
import { short, clean } from "./words.js";
import { MARK_STATES, failureFor, inReview, failedReview, isLive, needsYou, statusColor, reviewerMark, boardStep, waitOf } from "./states.js";
import { reviewTally } from "../../status-words.js";
import { ETA_STEADY, PERCENT_MIN, PERCENT_STEADY, labelRoom, shownFrom } from "./row-fit.js";
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
    if (inReview(r)) return t.fg(c, t.bold(t.mark("ready"))); // passed and waits for your yes: a mark of its own, in the green of work that is ready
    if (reviewerMark(r)) return t.fg(c, t.mark("review")); // the reviewer at work: the working mark, facing the other way
    if (boardStep(r)) return t.fg(c, t.mark("board")); // a step of the board's own: one mark for all of them
    if (r.state === "blocked") return t.fg(c, t.bold(t.mark("blocked", r.kind))); // what it needs from you: ? an answer, ! a yes or no, @ a sign-in
    if (r.state === "done") return t.quiet(c, t.mark("done")); // finished: the same mark, only quieter
    return t.fg(c, t.mark(MARK_STATES.includes(r.state) ? r.state : "idle"));
  }
  // What a row says on its first line, after its name: nothing on a live task's row, which says it on its second.
  saysBeside(r) { return isLive(r) ? { text: "" } : this.sentence(r); }
  rowTitle(r) { return clean(r.title || r.id) + (r.attempts?.length > 1 ? ` ×${r.attempts.length}` : "") + (isResearch(r) ? " [research]" : "") + (r.automation?.id ? " [auto]" : "") + (r.archivedAt && !this.archiveView ? " [archived]" : ""); }
  // The fewest cells a row needs to say something: a sentence cut to a few letters says nothing.
  sayNeed(said) { return Math.min(visibleWidth(said.text || ""), SENTENCE_MIN); }
  // The columns on the right are laid out first, once for the whole list: which there are and how wide each is. Every
  // row draws them at those widths, so each column starts at the same place on every row. What is shown of them is
  // decided one section at a time (row-fit.js): a section's rows give the same things up together, from the left.
  // The spacing is one rule: one cell between two columns, and one wider gap, of two cells, on a row: right of the
  // progress (bar, percent, minutes left), before the review, the pull request and the time. A column is as wide as
  // its widest value on the list and no wider, so the only other blank cells are those that line a shorter value up.
  // On a narrow screen (`screen`: the whole board's width, which is the list's unless the task panel is beside it) a
  // live task's columns are on its third line: its first line has none, and they take no part in what is decided here.
  // Neither do the selected row's there, which gives them up for its whole name (row-wrap.js), and no row has its
  // time: a one-line row's name gets that room.
  // Left of the names, the tasks' numbers have one column of their own (row-number.js), which every row's room is
  // counted without: it is the last thing to go before the rest of a name, for the whole list at once.
  rowLayout(records, width, sections = [records], screen = width) {
    const now = Date.now(), tall = tallAt(screen), below = (r) => tall && isLive(r), bare = (r) => this.wraps(r, tall);
    const fields = new Map(records.filter((r) => !bare(r)).map((r) => [r, this.rowFields(r, now)]));
    const max = (key) => Math.max(0, ...[...fields.values()].map((f) => visibleWidth(f[key])));
    const elapsed = Math.max(3, max("elapsed"));
    const numbering = this.numbering(records), num = this.numberCells(width, numbering);
    // Extremely long PR identifiers may shorten, but must never push time off-screen.
    const pr = Math.min(max("pr"), Math.max(0, width - 3 - elapsed - 3)), review = max("review");
    const cols = [["bar", max("bar")], ["percent", max("percent") && Math.max(PERCENT_MIN, max("percent"))], ["eta", max("eta")], ["review", review], ["pr", pr], ["time", tall ? 0 : elapsed]].filter(([, w]) => w);
    // The wider gap is a column with nothing in it, right of the progress: the cell on each side of it makes two.
    const group = cols.findIndex(([key]) => !PROGRESS.includes(key));
    if (group > 0) cols.splice(group, 0, ["gap", 0]);
    const layout = { now, review, pr, elapsed, cols, num, numbering, ago: !tall && [...fields.values()].some((f) => f.ago), show: new Map(), tall };
    if (tall) layout.third = this.tallLayout(records.filter(below).map((r) => this.rowFields(r, now)), width, 3 + (num ? num + 1 : 0));
    // Decided at widths that do not move as the numbers tick: the percent and the minutes left count as their widest
    // ("100%", and words.js: left).
    const steady = { percent: PERCENT_STEADY, eta: ETA_STEADY };
    const cells = (ago) => cols.map(([key, w]) => ({ key, w: steady[key] ? Math.max(w, steady[key]) : w + (key === "time" && ago ? 4 : 0) }));
    const fit = (r) => { const f = fields.get(r) || {}; return { room: Math.max(0, width - visibleWidth(this.mark(r)) - 2 - this.numberWide(r, num, numbering)), name: visibleWidth(this.rowTitle(r)), has: { bar: f.bar, percent: f.percent, eta: f.eta, review: f.review, pr: f.pr, time: !tall } }; };
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
  // A row's name in `w` cells. With every machine shown, whose task it is stands in its number's tag (`otherbox#1`,
  // row-number.js), never in its title.
  rowNameParts(r, w) { return { host: "", shown: truncateToWidth(this.nameInk(r, this.rowTitle(r)), w, "…") }; }
  // The title is plain text whatever the task's state: the mark and the group's heading carry the state's colour.
  // A live task's is bold: one weight for every title under "needs you", one that went wrong included.
  nameInk(r, s) { return ["working", "blocked", "error"].includes(r.state) ? this.theme.bold(s) : s; }
  rowName(r, w) { const { host, shown } = this.rowNameParts(r, w); return host + shown; }
  // A row's first line, measured: its mark and its number, the columns it keeps, and the room they leave its name.
  rowRoom(r, width, layout) {
    const prefix = ` ${this.mark(r)} ` + this.numberLead(r, layout.num, layout.numbering), room = Math.max(0, width - visibleWidth(prefix));
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
    return truncateToWidth(lead + this.saysUnder(r), width, "…");
  }
  // What stands on a live task's second line: what it says, or, where it has no words, something true and quiet
  // instead of a gap: that it is your own task, that nobody reviewed it, or the plain word for where it stands.
  saysUnder(r) {
    const said = this.sentence(r).text;
    if (said) return said;
    const t = this.theme;
    return t.soft(r.stage === "progress" ? "Yours: no agent on it" : inReview(r) ? "Not reviewed" : reviewerMark(r) ? "Under review" : r.state === "working" ? "Working" : "Needs you");
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
