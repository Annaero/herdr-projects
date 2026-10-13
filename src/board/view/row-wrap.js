// A row on a narrow screen, wrapped instead of cut: a live task's name and what it says take up to two lines each, and the selected task's name as many as it needs.
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { isLive } from "./states.js";

// The most lines a live task's name takes, and the most what it says takes: only what is past them is cut with "…".
const WRAP_LINES = 2;
// The fewest cells a line of what a task says is worth wrapping in.
const SAY_MIN = 20;
// A wrapped line carries its colour to its end and does not close it: closed here, nothing runs into the next line.
const closed = (s) => (s.includes("\x1b[") ? s + "\x1b[39m\x1b[22m" : s);
// At most `max` lines of a wrapped text: the last one takes what is left and is cut at its end.
const upTo = (lines, max, w) => (lines.length <= max ? lines : [...lines.slice(0, max - 1), truncateToWidth(lines.slice(max - 1).join(" "), w, "…")]);

export class RowWrap {
  // Does this row wrap? Live rows and the selected one, on a narrow screen (row-tall.js: tallAt). Every other row is
  // one line, and on a wider screen nothing wraps.
  wraps(r, tall) { return !!tall && (isLive(r) || r.id === this.sel); }
  // A wrapping row's name and what it says, in lines without their indent. They are measured from the width alone:
  // such a row has no columns beside its name (they are on its last line, or not shown), so the list knows a row's
  // height before it lays its columns out.
  wrapParts(r, width, cells = this.numberCells(width, this.numbering([r]))) {
    // The name starts right of the mark and of the task's number (row-number.js), and wraps under itself.
    const lead = Math.min(width, visibleWidth(this.mark(r)) + 2), indent = Math.min(width, lead + this.numberWide(r, cells)), room = Math.max(1, width - indent);
    const name = upTo(wrapTextWithAnsi(this.rowTitle(r), room), r.id === this.sel ? Infinity : WRAP_LINES, room);
    if (!isLive(r)) return { indent, cells, name, says: [] };
    // What it says starts under the task's name: right of the machine's name too, when that shows before it.
    // A long machine name would leave it a few cells a line: it then starts under the machine's name instead.
    const host = name.length > 1 ? 0 : visibleWidth(this.rowNameParts(r, room).host), sayLead = indent + (room - host < SAY_MIN ? 0 : host), sayRoom = Math.max(1, width - sayLead);
    const said = this.sentence(r).text;
    return { indent, cells, lead: sayLead, name, says: upTo(wrapTextWithAnsi(said, sayRoom), WRAP_LINES, sayRoom).map(closed) };
  }
  // The lines a row takes in the list.
  rowHeight(r, width, tall) {
    if (!this.wraps(r, tall)) return isLive(r) ? 2 : 1;
    const { name, says } = this.wrapParts(r, width);
    return isLive(r) ? name.length + says.length + 1 : name.length;
  }
  // The row as drawn: its name, what it says under it, and for a live task the line of its columns (row-tall.js).
  // Every line after the first starts under the name, not under the mark. A name that fits one line is the row it
  // always was, with the machine's name before it and a to-do's note after it.
  wrappedLines(r, width, layout) {
    const { indent, cells, lead, name, says } = this.wrapParts(r, width, layout.num), under = " ".repeat(indent);
    const first = name.length > 1 ? name.map((l, n) => (n ? under : ` ${this.mark(r)} ` + this.numberLead(r, cells)) + this.nameInk(r, l)) : [this.row(r, width, layout)];
    return isLive(r) ? [...first, ...says.map((l) => " ".repeat(lead) + l), this.tallLine(r, width, layout)] : first;
  }
}
