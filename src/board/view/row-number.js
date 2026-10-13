// A task's number on its row: the quiet tag between the mark and the title, `#134`, or `HSW-134` where its repo has a short key (store/keys.js).
// One column for the whole list, as wide as its widest tag, so every title starts in the same place. Also the tag as
// the task panel, the chat and the board's messages say it.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import { clean, idLabel, repoLabel } from "./words.js";

// The tag gives way, on every row at once, where it would leave a row's name fewer cells than this with nothing else
// beside it: after every column on the right, before the rest of the name (row-fit.js has the whole order).
export const NAME_LEFT = 16;
// A repo's name in a tag is cut to this many cells.
const REPO_MAX = 12;
const idOf = (r) => String(r.rid || r.id || "");
const repoOf = (r) => idOf(r).split("/")[0];

export class RowNumber {
  // What the tags of this list are made from, worked out once for a list as loaded: the repos' keys, whether tasks
  // of several repos are listed together, and the widest tag. `records`: the rows asked about, where there is no list.
  numbering(records = []) {
    const src = this.grouped || this.rows;
    if (src && this.numberedFor === src && this.numbered) return this.numbered;
    let recs = this.grouped ? this.grouped.groups.flatMap(([, list]) => list) : (this.rows || []).filter((row) => row.rec).map((row) => row.rec);
    const whole = recs.length > 0;
    if (!whole) recs = records;
    let keys = {};
    try { keys = S.repoKeys(); } catch {}
    const n = { keys, mixed: !this.byRepo && new Set(recs.filter((r) => r.title !== undefined).map(repoOf)).size > 1, cells: 0, names: {} };
    n.cells = Math.max(0, ...recs.map((r) => visibleWidth(this.numberTag(r, n))));
    if (whole) { this.numbered = n; this.numberedFor = src; }
    return n;
  }
  // The tag in words. With a key: `HSW-134`. Without: `#134`, and where tasks of several repos are listed together
  // (a list not grouped by repo), a task of another repo than the board's own carries its repo's name: `pi-work#12`.
  // Another machine's task has the key its own machine gave it.
  numberTag(r, n = this.numbering([r])) {
    const num = idOf(r).split("/").pop(), repo = repoOf(r);
    if (r.title === undefined || !/^\d+$/.test(num)) return "";
    const key = r.host ? r.key : n.keys[repo];
    if (key) return `${clean(key)}-${num}`;
    if (!n.mixed || repo === this.repo?.name) return `#${num}`;
    return (n.names[repo] ??= truncateToWidth(clean(repoLabel(repo)), REPO_MAX, "…")) + `#${num}`;
  }
  // The cells the tags' column has in a list this wide: none where it gave way.
  numberCells(width, n = this.numbering()) { return n.cells && width - 3 - n.cells - 1 >= NAME_LEFT ? n.cells : 0; }
  // The tag as a row starts with it: greyed, filled out to the column, one cell before the name.
  numberLead(r, cells, n = this.numbering([r])) {
    if (!cells) return "";
    const tag = truncateToWidth(this.numberTag(r, n), cells, "…");
    return this.theme.muted(tag) + " ".repeat(cells - visibleWidth(tag) + 1);
  }
  // A task named in the board's own messages: `HSW-134` with a key, else its id.
  idSay(r) { const tag = r.host ? (r.key ? this.numberTag(r) : "") : this.numbering([r]).keys[repoOf(r)] ? this.numberTag(r) : ""; return tag || r.id; }
  // A task's id as the panel says it: with a key, the short name and the id it stands for.
  idWords(r) { const said = this.idSay(r); return said === r.id ? idLabel(r.id) : `${said} · ${idLabel(r.id)}`; }
}
