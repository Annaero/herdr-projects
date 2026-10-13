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
  // `danger`: a yes cannot be undone (a merge, a remove), so on the web board neither answer is the filled button.
  confirm(q, yes, valid = null, { no = null, keys = null, detail = "", danger = false } = {}) { this.ask = { q, yes, valid, no, keys, detail, danger }; }
  // What a merge question is about: this pull request, at this reviewed commit, in this state.
  mergeMark(id) { const x = this.items.find((i) => i.id === id); return x ? JSON.stringify([x.stage, x.pr ?? null, x.reviewedHead ?? null, x.review?.score ?? null, x.review?.recommend ?? null, x.review?.pass ?? null, x.review?.findings?.length ?? null, !!x.review?.stale, !!x.mergeFailed, !!x.syncBlocked, !!x.prFailure, x.prState === "failing", !!x.archivedAt]) : ""; }
  // The one question box: it takes the text box's place until it is answered.
  askLines(width) {
    const t = this.theme, rule = t.fg("surface_dim", "─".repeat(width)), room = Math.max(10, width - 4);
    const answers = this.ask.keys || [["sayYes", "yes"], ["sayNo", "no"]];
    // A key that is not one of the answers was pressed: the box says which keys it takes (view/keys.js).
    const nudge = this.ask.nudge ? [t.fg("yellow", `press ${answers.map(([k]) => keyName(k)).join(" or ")}:`)] : [];
    const pairs = [...nudge, ...answers.map(([k, d]) => t.fg("text", keyName(k)) + t.fg("overlay0", ` = ${d}`))], dot = t.fg("overlay0", " · ");
    // The keys are always in view and never cut: where they do not fit one line they go on to the next, whole.
    const keyLines = [[]];
    for (const p of pairs) { const l = keyLines.at(-1), sep = l.length && !(nudge.length && l.length === 1 && keyLines.length === 1) ? 3 : l.length ? 1 : 0; if (l.length && visibleWidth(l.join("")) + sep + visibleWidth(p) > room) keyLines.push([p]); else l.push((sep === 3 ? dot : sep ? " " : "") + p); }
    const keys = keyLines.map((l) => l.join(""));
    // A question too long for one line wraps, and the keys take a line of their own.
    const q = wrapTextWithAnsi(t.bold(this.ask.q), room);
    const all = this.ask.detail ? String(this.ask.detail).split("\n").flatMap((l) => { const x = wrapTextWithAnsi(clean(l), room); return x.length ? x : [""]; }) : [];
    const detail = (all.length > DETAIL ? [...all.slice(0, DETAIL - 1), "…"] : all).map((l) => "   " + t.fg("subtext0", l));
    const oneLine = !detail.length && q.length === 1 && keys.length === 1 && 3 + visibleWidth(q[0]) + 2 + visibleWidth(keys[0]) <= width;
    return [rule, ...q.map((l, n) => (n ? "   " : ` ${t.fg("yellow", "?")} `) + l + (oneLine ? "  " + keys[0] : "")), ...detail, ...(oneLine ? [] : keys.map((l) => "   " + l)), rule];
  }
}
