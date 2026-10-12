// The one question box: asking, what a merge question is about, and how it is drawn.
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { name as keyName } from "../keys.js";
import { clean } from "./words.js";

// The most lines of a question's detail the box shows: the text box's place is small, the task panel has it whole.
const DETAIL = 8;

export class Ask {
  // One pattern for every question the board asks: a small box, y = yes, n or esc = no.
  // `valid`: is what the question names still what "yes" would act on? Checked on every look at the tasks and again
  // on y, so a yes is never given to something other than what was asked.
  // A question with three answers gives `no` (what n does; esc then only puts the question away) and its own `keys`.
  // `detail`: what the question is about, in full, shown quietly under it (its first lines when it is long).
  confirm(q, yes, valid = null, { no = null, keys = null, detail = "" } = {}) { this.ask = { q, yes, valid, no, keys, detail }; }
  // What a merge question is about: this pull request, at this reviewed commit, in this state.
  mergeMark(id) { const x = this.items.find((i) => i.id === id); return x ? JSON.stringify([x.stage, x.pr ?? null, x.reviewedHead ?? null, x.review?.score ?? null, x.review?.recommend ?? null, x.review?.pass ?? null, x.review?.findings?.length ?? null, !!x.review?.stale, !!x.mergeFailed, !!x.syncBlocked, !!x.prFailure, x.prState === "failing", !!x.archivedAt]) : ""; }
  // The one question box: it takes the text box's place until it is answered.
  askLines(width) {
    const t = this.theme, rule = t.fg("surface_dim", "─".repeat(width));
    const keys = (this.ask.keys || [["sayYes", "yes"], ["sayNo", "no"]]).map(([k, d]) => t.fg("text", keyName(k)) + t.fg("overlay0", ` = ${d}`)).join(t.fg("overlay0", " · "));
    // The two keys are always in view: a question too long for one line wraps, and the keys take a line of their own.
    const q = wrapTextWithAnsi(t.bold(this.ask.q), Math.max(10, width - 4));
    const all = this.ask.detail ? String(this.ask.detail).split("\n").flatMap((l) => { const x = wrapTextWithAnsi(clean(l), Math.max(10, width - 4)); return x.length ? x : [""]; }) : [];
    const detail = (all.length > DETAIL ? [...all.slice(0, DETAIL - 1), "…"] : all).map((l) => "   " + t.fg("subtext0", l));
    const oneLine = !detail.length && q.length === 1 && 3 + visibleWidth(q[0]) + 2 + visibleWidth(keys) <= width;
    return [rule, ...q.map((l, n) => (n ? "   " : ` ${t.fg("yellow", "?")} `) + l + (oneLine ? "  " + keys : "")), ...detail, ...(oneLine ? [] : ["   " + keys]), rule];
  }
}
