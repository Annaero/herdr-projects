// A task's number on its row: the quiet tag between the mark and the title, `#134`, or `HSW-134` where its repo has a short key (store/keys.js).
// Never a repo's name: which repo a task is in is what the list grouped by repo, the task panel and the details page say.
// The tags share one column, so titles start in the same place, but never at the price of more than GAP empty cells
// between a tag and its title. Also the tag as the task panel, the chat and the board's messages say it.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import { clean, idLabel } from "./words.js";

// The tag gives way, on every row at once, where it would leave a row's name fewer cells than this with nothing else
// beside it: after every column on the right, before the rest of the name (row-fit.js has the whole order).
export const NAME_LEFT = 16;
// The most empty cells between a tag and its title: the one that parts them, and two to line a shorter tag up.
export const GAP = 3;
// A tag is cut to this many cells (a key has 5 at most, so only another machine's could be longer); one that names
// its machine too (`otherbox#1`) to FAR_MAX.
const TAG_MAX = 12, FAR_MAX = 14;
const idOf = (r) => String(r.rid || r.id || "");
const repoOf = (r) => idOf(r).split("/")[0];
// The column for tags of these widths: the one that lines up the most titles within the limit, the narrower of two
// that line up as many. A tag wider than it runs on, and a tag too short for it stands right before its own title.
export function tagColumn(widths) {
  const lined = (col) => widths.filter((w) => w <= col && col - w < GAP).length;
  return [...new Set(widths)].filter(Boolean).sort((a, b) => lined(b) - lined(a) || a - b)[0] || 0;
}
// The cells a tag this wide fills in that column, without the cell that parts it from its title.
export const tagCells = (w, col) => (!col || !w ? 0 : w <= col && col - w < GAP ? col : w);

export class RowNumber {
  // What the tags of this list are made from, worked out once for a list as loaded: the repos' keys, the tags'
  // column and the widest tag. `records`: the rows asked about, where there is no list.
  numbering(records = []) {
    const src = this.grouped || this.rows;
    if (src && this.numberedFor === src && this.numbered) return this.numbered;
    let recs = this.grouped ? this.grouped.groups.flatMap(([, list]) => list) : (this.rows || []).filter((row) => row.rec).map((row) => row.rec);
    const whole = recs.length > 0;
    if (!whole) recs = records;
    let keys = {};
    try { keys = S.repoKeys(); } catch {}
    const n = { keys, cells: 0, widest: 0 }, widths = recs.map((r) => visibleWidth(this.numberTag(r, n))).filter(Boolean);
    n.cells = tagColumn(widths); n.widest = Math.max(0, ...widths);
    if (whole) { this.numbered = n; this.numberedFor = src; }
    return n;
  }
  // The tag in words. With a key: `HSW-134`. Without: `#134`, also where tasks of several repos are listed together
  // (two of them may then both read `#1`). Another machine's task has the key its own machine gave it. Each machine
  // counts its own tasks, so with more than one machine shown the tag names the machine too: `otherbox#1`
  // (`otherbox:HSW-1` with a key). Only then, and never in find (`machine` false), which takes the number alone.
  numberTag(r, n = this.numbering([r]), machine = true) {
    const num = idOf(r).split("/").pop(), repo = repoOf(r);
    if (r.title === undefined || !/^\d+$/.test(num)) return "";
    const key = r.host ? r.key : n.keys[repo], far = machine && r.host && this.scope === "*" ? clean(r.host) : "";
    // A long machine name is what is cut: the number is the part that tells two tasks apart.
    const own = truncateToWidth(key ? `${clean(key)}-${num}` : `#${num}`, TAG_MAX, "…"), sep = far && key ? ":" : "";
    return far ? truncateToWidth(far, Math.max(3, FAR_MAX - visibleWidth(own) - sep.length), "…") + sep + own : own;
  }
  // The tags' column in a list this wide: none where the tags gave way. They give way together, where the widest
  // would leave its row's name too few cells.
  numberCells(width, n = this.numbering()) { return n.cells && width - 3 - n.widest - 1 >= NAME_LEFT ? n.cells : 0; }
  // The cells a row's tag takes left of its name, with the one that parts them: none where the tags gave way.
  numberWide(r, cells, n = this.numbering([r])) { const w = cells ? tagCells(visibleWidth(this.numberTag(r, n)), cells) : 0; return w ? w + 1 : cells ? cells + 1 : 0; }
  // The tag as a row starts with it: greyed, filled out to the column where that is within the limit, one cell before the name.
  numberLead(r, cells, n = this.numbering([r])) {
    if (!cells) return "";
    const tag = this.numberTag(r, n);
    return this.theme.muted(tag) + " ".repeat(this.numberWide(r, cells, n) - visibleWidth(tag));
  }
  // A task named in the board's own messages, by the name its row has: `#134`, or `HSW-134` with a key.
  idSay(r) { return this.numberTag(r) || r.id; }
  // The same with its title, as a message says what was acted on: `#134 "Fix the footer"`. `max`: the most cells of
  // the title; a question that names what it is about shows it whole.
  nameSay(r, max = 40) { const tag = this.numberTag(r), title = clean(r.title || ""); return [tag || (title ? "" : r.id), title && `"${max === Infinity ? title : truncateToWidth(title, max, "…")}"`, r.host && this.scope !== "*" && `on ${clean(r.host)}`].filter(Boolean).join(" "); }
  // A task's id as the panel says it: with a key, the short name and the id it stands for.
  idWords(r) { const said = this.idSay(r); return said === r.id ? idLabel(r.id) : `${said} · ${idLabel(r.id)}`; }
}
