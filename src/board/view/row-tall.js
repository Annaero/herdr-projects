// A live task's third line on a narrow screen: the bar, the percent, the minutes left, the review tag, the pull request and the time, which have no room beside the name there.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { bar } from "./words.js";
import { statusColor } from "./states.js";
import { PERCENT_MIN } from "./row-fit.js";

// Below this many columns every live row has the third line; from it on, none has. It is the width at which a name
// of 40 cells (NAME_OWED: what a name keeps before a column goes) sits beside every column: the mark (3), the name
// (40), the bar (8), the percent (4), the minutes left (4), `R#12` (4), `PR#123` (6), the time (3) and the gaps
// between them (8) are 80 (the task's number, left of the name, is not counted: with it the bar is what goes first
// at 80). Narrower than that, line 1 always goes without something. It is the screen that is
// counted, not the names on it: the rows do not change height when a task is renamed or gets its pull request, and
// they all switch together.
export const TALL_BELOW = 80;
// A bar shorter than this says nothing: the percent beside it does.
const BAR_MIN = 4;
// The minutes left are this wide at least ("10m"), so that the bar keeps its length when "9m" turns "10m".
const ETA_MIN = 3;
// The gap left of a group: one cell, and two right of the progress (the bar, the percent, the minutes left), which is
// the one wider gap of a row.
const progress = (g) => ["percent", "eta"].includes(g[0][0]);
const before = (g, n, all) => (n === all.findIndex((x) => !progress(x)) ? 2 : 1);

export const tallAt = (screen) => screen < TALL_BELOW;

export class RowTall {
  // The third line's columns, once for the whole list: each is as wide as the widest of its kind, so they start at
  // the same place on every live row and every bar has the same length. In a width too small for all of them the
  // word "ago" goes first, then the tags, then the percent and the minutes; the time always stays.
  tallLayout(fields, width) {
    const max = (key) => Math.max(0, ...fields.map((f) => visibleWidth(f[key])));
    const elapsed = Math.max(3, max("elapsed"));
    const w = { percent: max("percent") && Math.max(max("percent"), PERCENT_MIN), eta: max("eta") && Math.max(max("eta"), ETA_MIN), review: max("review"), pr: Math.min(max("pr"), Math.max(0, width - 3 - elapsed - 3)), elapsed, ago: fields.some((f) => f.ago) };
    const right = () => this.tallGroups(w).reduce((n, g, at, all) => n + before(g, at, all) + g.reduce((m, [, cells]) => m + cells + 1, -1), 0);
    for (const drop of [["ago"], ["review", "pr"], ["percent", "eta"]]) if (3 + right() > width) for (const key of drop) w[key] = 0;
    // The bar takes what the columns leave: it is why the line fills the width. Too short to read, it gives its
    // room to the word "ago" before it goes.
    if (w.ago && fields.some((f) => f.bar) && width - 3 - right() < BAR_MIN) w.ago = false;
    return { ...w, right: right() };
  }
  // Left to right: the progress, the review with its pull request, the time. One cell between them and two right of
  // the progress, as on a wide screen's first line (row.js): the bar is part of the progress, so one cell is right of it.
  tallGroups(w) {
    return [[["percent", w.percent], ["eta", w.eta]], [["review", w.review], ["pr", w.pr]], [["time", w.elapsed + (w.ago ? 4 : 0)]]].map((g) => g.filter(([, cells]) => cells)).filter((g) => g.length);
  }
  // The line itself: it starts right of the mark and ends at the right edge. In the all-machines view it does not
  // start under the task's name as the second line does: a long machine name would leave it no room, and every bar
  // is to be the same length. A row with no progress, no review and no pull request yet still has its time there, so
  // every live row is the same height.
  tallLine(r, width, layout) {
    const t = this.theme, w = layout.third, f = this.rowFields(r, layout.now);
    const fill = (s, n, left) => { const gap = " ".repeat(Math.max(0, n - visibleWidth(s))); return left ? s + gap : gap + s; };
    const text = {
      percent: f.percent, eta: f.eta, review: f.review,
      pr: f.pr ? truncateToWidth(f.pr, w.pr, "…") : "",
      // The time ends at the right edge on every row, with the word "ago" or without: the line fills the width.
      time: t.fg("overlay0", f.elapsed + (w.ago && f.ago ? " ago" : "")),
    };
    const right = this.tallGroups(w).map((g, n, all) => " ".repeat(before(g, n, all)) + g.map(([key, cells]) => fill(text[key], cells, key === "pr")).join(" ")).join("");
    const lead = " ".repeat(Math.min(width, visibleWidth(this.mark(r)) + 2)), room = width - visibleWidth(lead) - w.right;
    const drawn = f.bar && room >= BAR_MIN ? t.fg(statusColor(r), bar(r.progress, room)) : "";
    return truncateToWidth(lead + fill(drawn, Math.max(0, room), true) + right, width, "");
  }
}
