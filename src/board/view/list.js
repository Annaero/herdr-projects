// The task list: which rows there are, which one is selected, the header line, and the list as drawn.
import { truncateToWidth } from "@earendil-works/pi-tui";
import os from "node:os";
import * as S from "../../store.js";
import * as F from "../../flow.js";
import * as C from "../../coordinator.js";
import { herdr, currentSocket, sessionName } from "../../herdr.js";
import { short, repoLabel } from "./words.js";
import { GROUPS, GROUP_COLOR, groupOf, asRow, isLive } from "./states.js";
import { name as keyName } from "../keys.js";
import { rowHeight, tallAt } from "./row-tall.js";

// A long done list folds to its latest few. A list taller than its room shows fewer still, down to one.
const DONE_SHOWN = 5;
const isDone = (r) => r.state === "done" && !r.pinned && !r.archivedAt;
const rank = (r) => (r.archivedAt ? -2 : r.pinned ? -1 : GROUPS.indexOf(groupOf(r)));
const isTodo = (r) => groupOf(r) === "to do" && !r.pinned && !r.archivedAt;
// The lines a list of rows takes: an empty line and a heading for each group, two lines for a live task's row (three
// on a narrow screen).
const linesOf = (rows, tall) => rows.reduce((n, row) => n + (row.header ? 2 : row.rec ? rowHeight(row.rec, tall) : 1), 0);

export class List {
  load() {
    try { this.coord = C.look(); } catch {}
    const mine = F.board({ includeArchived: true }).map(asRow);
    this.items = this.scope === "" ? mine : this.scope === "*" ? [...mine, ...Object.values(this.remotes).flatMap((m) => m.items)] : (this.remotes[this.scope] ? this.remotes[this.scope].items : []);
    const jobs = this.archiveView ? [] : S.dispatches();
    // A finished instruction is forgotten without a word: its row goes and what it did is on the board.
    for (const j of jobs) if (j.state === "done") S.clearDispatch(j.id);
    this.jobs = jobs.filter((j) => j.state !== "done").reverse();
    const f = (this.mode === "find" ? this.value() : this.filter).trim().toLowerCase();
    // The task the selection is held on (you went into its agent, or just stopped it) keeps its row whatever it has
    // become meanwhile: a filter it no longer matches, or the archive, never hands the selection to its neighbour.
    const held = (r) => r.id === this.stick && r.id === this.sel;
    const eligible = this.items.filter((r) => held(r) || (this.archiveView ? !!r.archivedAt : !!f || !r.archivedAt));
    const shown = f ? eligible.filter((r) => held(r) || `${r.id} ${r.title} ${r.msg} ${r.state} ${r.app} ${r.archivedAt ? "archived" : ""} ${r.description || ""} ${r.failure?.title || ""} ${r.failure?.detail || ""}`.toLowerCase().includes(f)) : eligible;
    const layout = JSON.stringify([this.scope, this.byRepo, this.allDone, this.archiveView, f]);
    const repoOf = (r) => r.id.split("/")[0];
    const groups = this.byRepo
      ? [...new Set(shown.map(repoOf))].sort((a, b) => (a === this.repo.name ? -1 : b === this.repo.name ? 1 : a.localeCompare(b))).map((g) => [g, shown.filter((r) => repoOf(r) === g)])
      : [["archived", shown.filter((r) => r.archivedAt)], ["pinned", shown.filter((r) => r.pinned && !r.archivedAt)], ...GROUPS.map((g) => [g, shown.filter((r) => groupOf(r) === g && !r.pinned && !r.archivedAt)])];
    this.grouped = { groups, whole: this.allDone || !!f };
    const rows = this.rows = this.foldRows();
    const selectable = [...rows.filter((r) => r.rec).map((r) => r.rec), ...this.jobs];
    // Only the selected task's ordering data matters. New rows, progress updates and other tasks moving must not
    // steal selection.
    const base = new Map(this.items.map((r, n) => [r.id, n]));
    const nextRows = selectable.map((r) => ({ id: r.id, order: JSON.stringify([r.title !== undefined ? groupOf(r) : r.state, !!r.pinned, r.created, !!r.archivedAt]), at: r.title !== undefined && isDone(r) ? r.at : 0, done: r.title !== undefined && isDone(r), base: base.get(r.id) ?? -1 }));
    const ids = nextRows.map((r) => r.id);
    const before = this.selectionRows.findIndex((r) => r.id === this.sel);
    const afterIndex = ids.indexOf(this.sel);
    const after = nextRows[afterIndex];
    const selected = this.sel;
    const old = this.selectionRows[before];
    const crossed = !!old && !!after && old.done && after.done && old.at !== after.at &&this.selectionRows.some((r, n) => {
      const to = ids.indexOf(r.id);
      if (to < 0 || r.id === selected || !r.done || (this.byRepo && r.id.split("/")[0] !== selected.split("/")[0])) return false;
      const wouldPrecede = r.at > after.at || (r.at === after.at && r.base < old.base);
      return (n < before) !== wouldPrecede && (n < before) !== (to < afterIndex);
    });
    // The selection stays where it is while you read or answer a task, and on the row whose agent you just stopped.
    const reading = this.full || this.reply || (this.stick === selected && !!after);
    if (layout === this.selectionLayout && old && !reading && (!after || after.order !== old.order || crossed)) {
      // Prefer the old successor, then the next surviving row below it, then the nearest survivor above. Never
      // chase the moved task if a neighbour remains.
      const neighbors = [...this.selectionRows.slice(before + 1), ...this.selectionRows.slice(0, before).reverse()];
      this.sel = neighbors.find((r) => ids.includes(r.id))?.id || (after ? selected : ids[0] || "");
    }
    if (!ids.includes(this.sel)) this.sel = ids[0] || "";
    this.selectionRows = nextRows;
    this.selectionLayout = layout;
    // A question is about what it names. When that changed underneath it (another pull request, a new commit, a new
    // review), the question goes: the next yes has to be to what is there now.
    if (this.ask?.valid && !this.ask.valid()) { this.ask = null; this.flash(`It changed while you were asked, so nothing was merged. Look at it again, then ${keyName("yes")}.`, "yellow"); }
    // A reply belongs to the task it was started for. When that task is gone the words are never left pointing at
    // whichever task is selected next: they are put away, and nothing is sent.
    // The same for words typed for the Coordinator on a row with no task (`replyId` is empty there): when that row
    // goes and a task is selected, they do not become a reply to it.
    if (this.reply && this.mode === "new" && this.value() && this.sel !== this.replyId && (this.replyId || this.current())) {
      if (this.value().trim()) this.draftAway = { text: this.value(), to: this.replyId };
      this.setValue(""); this.full = false;
      if (this.replyId) { this.reply = false; this.flash("The task you were replying to is gone. Nothing was sent; your words are put away.", "yellow"); }
      else this.flash("The row you were on is gone. Nothing was sent; your words for the Coordinator are put away.", "yellow");
    }
    this.syncReply();
    if (this.sel !== selected) this.load(); // rebuild the done fold for the new selection
  }
  // While you talk to a task's agent the chat follows the selection: moving to another task makes that task's agent
  // the one you talk to. Only space changes whether it is a task's agent or the Coordinator, with one exception: the
  // task you talk to going away (removed) is back to the Coordinator, never on to a neighbour's agent.
  // A row with no agent to talk to is still named, with where your message goes instead (it starts an agent, goes to
  // the Coordinator about that task, or the task is archived and read-only). With no task selected at all (words on
  // their way to another machine, an empty list) the chat names the Coordinator until a task is selected again.
  // `replyId` is always the task the chat names: empty on a row with no task, so words typed or brought back there
  // are the Coordinator's, never a reply to the task you were on before.
  syncReply() {
    if (!this.reply || this.sel === this.replyId) return;
    if (this.replyId && !this.items.some((r) => r.id === this.replyId)) { this.reply = false; this.full = false; this.panelTop = 0; }
    else { this.replyId = this.current() ? this.sel : ""; this.panelTop = 0; }
  }
  // The rows under their headings. A long done list folds to its latest few, newest first. When the list is still
  // taller than its room (`listRoom`: what the last draw had for it), the done rows are what gives way first: fewer of
  // them show, down to the newest one. Then the to-dos of a list that has live tasks, from the last one up, down to
  // the first. So the live tasks stay on the screen; only then does the list scroll. The selected task is never folded away, and neither is
  // anything while you search or ask for all done. A folded to-do is still one press of the arrow keys away (`steps`).
  foldRows() {
    const { groups, whole } = this.grouped;
    this.foldSel = this.sel;
    const lay = (keep, todos = Infinity) => {
      const rows = [];
      for (const [name, recs] of groups) {
        if (!recs.length) continue;
        rows.push({ header: name });
        // Inside a project: pinned first, then the order of the status groups, so what needs you is on top.
        const list = [...recs].sort((a, b) => (this.byRepo ? rank(a) - rank(b) : 0) || (a.archivedAt && b.archivedAt ? b.archivedAt - a.archivedAt : 0) || (isDone(a) && isDone(b) ? b.at - a.at : 0));
        const done = list.filter(isDone);
        const folded = whole ? [] : done.slice(keep).filter((r) => r.id !== this.sel);
        // The to-dos that stay are the first ones, or the ones that end at the selected task.
        const todo = list.filter(isTodo), from = Math.max(0, todo.findIndex((r) => r.id === this.sel) - todos + 1);
        const later = whole ? [] : todo.filter((r, n) => n < from || n >= from + todos);
        for (const r of list) {
          if (!folded.includes(r) && !later.includes(r)) rows.push({ rec: r });
          if (folded.length && r === done[done.length - 1]) rows.push({ note: `… ${folded.length} more (? shows all done)` });
          if (later.length && r === todo[todo.length - 1]) rows.push({ note: `… ${later.length} more to do` });
        }
      }
      return rows;
    };
    const over = (rows) => !whole && this.listRoom && linesOf(rows, this.listTall) > this.listRoom;
    let keep = DONE_SHOWN, rows = lay(keep);
    while (keep > 1 && over(rows)) rows = lay(--keep);
    // The arrow keys go through every to-do, folded or not: the one they land on is selected, so it shows.
    this.steps = rows.filter((row) => row.rec).map((row) => row.rec.id);
    let todos = Math.max(0, ...groups.map(([, recs]) => recs.filter(isTodo).length));
    // Only for live rows: a list with none has nothing to keep in view, and scrolls as it always did.
    const live = rows.some((row) => row.rec && isLive(row.rec));
    while (live && todos > 1 && over(rows)) rows = lay(keep, --todos);
    return rows;
  }
  move(d) {
    const ids = [...(this.steps || this.rows.filter((r) => r.rec).map((r) => r.rec.id)), ...this.jobs.map((j) => j.id)]; // the dispatcher's rows sit below the list
    if (ids.length) this.sel = ids[Math.max(0, Math.min(ids.length - 1, ids.indexOf(this.sel) + d))];
    if (this.grouped) this.rows = this.foldRows(); // the to-do it landed on is never folded away
  }
  // The header: one line. Which project, and anything unusual about what the list shows.
  headLines(w) {
    const t = this.theme;
    const session = sessionName(currentSocket());
    const parts = [this.archiveView ? "archive" : this.repo.root === os.homedir() ? "~" : `${this.repo.name} · ${short(this.repo.root)}`];
    if (session !== "default") parts.push(`session ${session}`);
    if (this.scope === "*") parts.push(`all machines: ${Object.keys(this.remotes).length ? Object.values(this.remotes).map((m) => (m.ok ? m.label : `${m.label} (no answer)`)).join(", ") : "no others found"}`);
    else if (this.all) parts.push(`only ${this.scope}${this.remotes[this.scope] && this.remotes[this.scope].ok ? "" : " (no answer)"}`);
    if (this.filter && this.mode !== "find") parts.push(`find: ${this.filter}`);
    const asked = this.archiveView ? 0 : this.suggestionCount();
    if (asked) parts.push(`${asked} suggested task${asked === 1 ? "" : "s"} (${keyName("suggested")})`);
    return [truncateToWidth(" " + t.bold("herdr-superwork") + t.fg("overlay0", "  " + parts.join(" · ")), w, "…")];
  }
  // `screen` is the whole board's width: the list's own, unless the task panel is beside it. It decides whether live
  // rows have their third line (row-tall.js), for all of them at once.
  listLines(width, h, screen = width) {
    const t = this.theme, tall = tallAt(screen);
    // The room the list has decides how many done rows show (foldRows): when it changes, they are folded again.
    if (h !== this.listRoom || tall !== this.listTall || this.sel !== this.foldSel) { this.listRoom = h; this.listTall = tall; if (this.grouped) this.rows = this.foldRows(); }
    if (!this.rows.length) {
      const out = ["", " " + t.fg("overlay0", this.filter || this.mode === "find" ? "nothing matches." : this.archiveView ? "No archived tasks." : "Nothing here yet. Type what needs doing.")];
      while (out.length < h) out.push("");
      return out;
    }
    const lines = [];
    // One layout for the displayed list, across groups and outside the scroll viewport: the columns line up down the
    // whole list. What is shown of them is decided one group at a time, under each heading.
    const sections = [];
    for (const row of this.rows) { if (row.header || !sections.length) sections.push([]); if (row.rec) sections.at(-1).push(row.rec); }
    const layout = this.rowLayout(sections.flat(), width, sections, screen);
    this.rows.forEach((row) => {
      if (row.header) lines.push({ text: "", sel: false }, { text: " " + (this.byRepo ? t.bold(t.fg("subtext0", repoLabel(row.header))) : t.fg(GROUP_COLOR[row.header] || "subtext0", row.header)), sel: false });
      else if (row.note) lines.push({ text: "   " + t.fg("overlay0", row.note), sel: false });
      // A live task's row is two lines or three, and all are the selected row's: the highlight covers them.
      else this.rowLines(row.rec, width, layout).forEach((text, n, all) => lines.push({ text, sel: row.rec.id === this.sel, n, rest: all.length - n }));
    });
    const at = lines.findIndex((l) => l.sel), end = lines.findLastIndex((l) => l.sel);
    if (at < this.top + 2) this.top = Math.max(0, at - 2);
    if (end >= this.top + h) this.top = Math.min(at, end - h + 1); // with room for one line only, the one with its name
    this.top = Math.max(0, Math.min(this.top, Math.max(0, lines.length - h)));
    // The list scrolls by whole rows, so a row of two or three lines is never shown in part: at the top it comes into
    // view whole (or goes, when the selected row needs the lines), and at the bottom what fits of it is left empty.
    const first = lines[this.top];
    if (first?.n && !first.sel) this.top += end < this.top - first.n + h ? -first.n : first.rest;
    const shown = lines.slice(this.top, this.top + h), cut = lines[this.top + h];
    if (shown.length === h && cut?.n) for (let n = 1; n <= cut.n && n <= h; n++) if (!shown[h - n].sel) shown[h - n] = { text: "", sel: false };
    const out = shown.map((l) => (l.sel ? this.hl(l.text, width) : l.text));
    while (out.length < h) out.push("");
    return out;
  }
  // Highlight a whole line: resets inside it (from truncation) would end the background early.
  hl(line, width) {
    const t = this.theme;
    return t.selected(truncateToWidth(line, width, "…", true));
  }
}
