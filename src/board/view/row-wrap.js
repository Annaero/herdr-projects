// A row on a narrow screen, wrapped instead of cut: a live task's name and what it says take up to two lines each, and the selected task's name as many as it needs. An automation's row has its trigger under its name there.
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { isLive } from "./states.js";

// The most lines a live task's name takes, and the most what it says takes: only what is past them is cut with "…".
const WRAP_LINES = 2;
// The fewest cells a line of what a task says is worth wrapping in.
const SAY_MIN = 20;
// A tag wider than this (with the cell after it) is another machine's long one: what its task says starts right of the mark.
const LONG_TAG = 13;
// A wrapped line carries its colour to its end and does not close it: closed here, nothing runs into the next line.
const closed = (s) => (s.includes("\x1b[") ? s + "\x1b[39m\x1b[22m" : s);
// At most `max` lines of a wrapped text: the last one takes what is left and is cut at its end.
const upTo = (lines, max, w) => (lines.length <= max ? lines : [...lines.slice(0, max - 1), truncateToWidth(lines.slice(max - 1).join(" "), w, "…")]);

// A row with lines under its name on a narrow screen: a live task's, and an automation's, whose trigger and firing
// have no room beside its name there.
const hasUnder = (r) => isLive(r) || !!r.auto;

export class RowWrap {
  // Does this row wrap? Live rows, automations and the selected one, on a narrow screen (row-tall.js: tallAt). Every
  // other row is one line, and on a wider screen nothing wraps.
  wraps(r, tall) { return !!tall && (hasUnder(r) || r.id === this.sel); }
  // A wrapping row's name and what it says, in lines without their indent. They are measured from the width alone:
  // such a row has no columns beside its name (they are on its last line, or not shown), so the list knows a row's
  // height before it lays its columns out.
  wrapParts(r, width, cells = this.numberCells(width, this.numbering([r]))) {
    // The name starts right of the mark and of the task's number (row-number.js), and wraps under itself.
    const lead = Math.min(width, visibleWidth(this.mark(r)) + 2), indent = Math.min(width, lead + this.numberWide(r, cells)), room = Math.max(1, width - indent);
    const name = upTo(wrapTextWithAnsi(this.rowTitle(r), room), r.id === this.sel ? Infinity : WRAP_LINES, room);
    if (!hasUnder(r)) return { indent, cells, name, says: [] };
    // What it says starts under the task's name: right of the machine's name too, when that shows before it.
    // A long machine name would leave it a few cells a line: it then starts under the machine's name instead.
    // Behind a long tag (another machine's, `otherbox#1`) that would leave it a few cells a line: it then starts right
    // of the mark instead, with the row's width.
    const sayLead = room < SAY_MIN || indent - lead > LONG_TAG ? lead : indent, sayRoom = Math.max(1, width - sayLead);
    this.tagsGone = !cells;
    const f = this.rowFields(r, Date.now()), said = r.auto ? this.autoSaid(r.auto, "all") : this.saysUnder(r);
    // A row with nothing for its last line but a time (no bar, no percent, no review, no pull request) has the time
    // at the end of what it says instead, and no line for it alone. An automation's firing ("next in 4m") stands there too.
    const lone = r.auto ? f.when : !f.bar && !f.percent && !f.eta && !f.review && !f.pr ? f.elapsed + (f.ago ? " ago" : "") : "";
    const says = upTo(wrapTextWithAnsi(said, sayRoom), WRAP_LINES, sayRoom).map(closed);
    // (Why an automation was turned off is never cut for it: the firing then has a line of its own.)
    if (lone && r.auto && visibleWidth(says.at(-1) || "") > sayRoom - lone.length - 2) says.push("");
    if (lone) { const last = says.length - 1, room = Math.max(1, sayRoom - lone.length - 2), line = visibleWidth(says[last] || "") > room ? closed(truncateToWidth(says[last], room, "…")) : says[last] || ""; says[Math.max(0, last)] = line + " ".repeat(Math.max(1, sayRoom - visibleWidth(line) - lone.length)) + this.theme.muted(lone); }
    return { indent, cells, lead: sayLead, name, says, lone: !!lone };
  }
  // The lines a row takes in the list.
  rowHeight(r, width, tall) {
    if (!this.wraps(r, tall)) return isLive(r) ? 2 : 1;
    const { name, says, lone } = this.wrapParts(r, width);
    return hasUnder(r) ? name.length + says.length + (lone ? 0 : 1) : name.length;
  }
  // The row as drawn: its name, what it says under it, and for a live task the line of its columns (row-tall.js).
  // Every line after the first starts under the name, not under the mark. A name that fits one line is the row it
  // always was, with the machine's name before it and a to-do's note after it.
  wrappedLines(r, width, layout) {
    const { indent, cells, lead, name, says, lone } = this.wrapParts(r, width, layout.num), under = " ".repeat(indent);
    const first = name.length > 1 ? name.map((l, n) => (n ? under : ` ${this.mark(r)} ` + this.numberLead(r, cells)) + this.nameInk(r, l)) : [this.row(r, width, layout)];
    return hasUnder(r) ? [...first, ...says.map((l) => " ".repeat(lead) + l), ...(lone ? [] : [this.tallLine(r, width, layout)])] : first;
  }
}
export const part = RowWrap; // what this file adds to the board: view.js loads every file here that names its part
