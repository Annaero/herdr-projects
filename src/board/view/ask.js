// The one question box: asking, what a merge question is about, and how it is drawn.
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { name as keyName } from "../keys.js";

export class Ask {
  // One pattern for every question the board asks: a small box, y = yes, n or esc = no.
  // `valid`: is what the question names still what "yes" would act on? Checked on every look at the tasks and again
  // on y, so a yes is never given to something other than what was asked.
  confirm(q, yes, valid = null) { this.ask = { q, yes, valid }; }
  // What a merge question is about: this pull request, at this reviewed commit, in this state.
  mergeMark(id) { const x = this.items.find((i) => i.id === id); return x ? JSON.stringify([x.stage, x.pr ?? null, x.reviewedHead ?? null, x.review?.score ?? null, x.review?.recommend ?? null, x.review?.pass ?? null, x.review?.findings?.length ?? null, !!x.review?.stale, !!x.mergeFailed, !!x.syncBlocked, !!x.prFailure, x.prState === "failing", !!x.archivedAt]) : ""; }
  // The one question box: it takes the text box's place until it is answered.
  askLines(width) {
    const t = this.theme, rule = t.fg("surface_dim", "─".repeat(width));
    const keys = `${t.fg("text", keyName("sayYes"))}${t.fg("overlay0", " = yes · ")}${t.fg("text", keyName("sayNo"))}${t.fg("overlay0", " = no")}`;
    // The two keys are always in view: a question too long for one line wraps, and the keys take a line of their own.
    const q = wrapTextWithAnsi(t.bold(this.ask.q), Math.max(10, width - 4));
    const oneLine = q.length === 1 && 3 + visibleWidth(q[0]) + 2 + visibleWidth(keys) <= width;
    return [rule, ...q.map((l, n) => (n ? "   " : ` ${t.fg("yellow", "?")} `) + l + (oneLine ? "  " + keys : "")), ...(oneLine ? [] : ["   " + keys]), rule];
  }
}
