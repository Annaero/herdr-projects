// The automations in the main list: a group of their own below the task groups, under the heading `automations` in a
// colour of its own (theme.js: auto). One row per automation, drawn by the tasks' own row code (row.js, row-fit.js,
// row-wrap.js) in the list's own columns: its mark in the mark column, the word on or off where a task has its
// number, its name where the titles start, its trigger in plain words where a row says something, the task of its
// last firing where the review tag stands, and when it fires next or fired last in the time column. This file says
// what an automation has for each of those, which automations show (this machine's, and other machines' as whose
// board you see decides) and what each one's row is called in the selection. No heading when there is none.
// What the keys do on such a row: automations.js. One automation, whole: automation-panel.js.
import * as S from "../../store.js";
import * as L from "../../automations/list.js";
import { rowOf, firings } from "../../automations/show.js";
import { clean, repoLabel } from "./words.js";

// The group's heading, and the mark its rows start with: an arrow going round (U+27F3), where every task's mark is
// round, a diamond or a sign, so the two are told apart by shape. The same one on and off: off, it is drawn quietly.
// One cell wide, as the board measures it and as terminals draw it, and never drawn as an emoji. A font without it
// shows the terminal's own fallback: nothing here looks for that.
export const AUTOMATIONS = "automations";
export const AUTO_MARK = "⟳";
// An automation's row in the selection: never a task's id (`repo/12`, or `machine:repo/12`).
const rowId = (a, host = "") => `${host ? `${host}:` : ""}auto:${a.id}`;

export class AutomationRows {
  // The automations of whoever's board shows, this machine's first. None in the archive. `f`: the filter, which an
  // automation matches by its name, its trigger, its repo, the word on or off, or the word "automation".
  autosShown(f = "") {
    if (this.archiveView) return [];
    const mine = this.scope === "" || this.scope === "*" ? S.automations().map((a) => ({ ...a, row: rowId(a), host: "" })) : [];
    const far = (this.scope === "*" ? Object.values(this.remotes) : this.remotes[this.scope] ? [this.remotes[this.scope]] : []).flatMap((m) => m.autos || []);
    const all = [...mine, ...far];
    return f ? all.filter((a) => { const r = this.autoRow(a); return `automation ${r.name} ${r.trigger} ${r.repo} ${r.state} ${a.host}`.toLowerCase().includes(f); }) : all;
  }
  // Another machine's, as its list sent them (remotes.js, remote/automations.js): each knows its machine.
  farAutos(m, list) { return (Array.isArray(list) ? list : []).filter((x) => x && x.id && x.name).map((x) => ({ ...x, row: rowId(x, m.label), host: m.label, machine: m })); }
  // The selected automation, when the selected row is one. With none selected nothing of one is open.
  auto() {
    const a = (this.autos || []).find((x) => x.row === this.sel) || null;
    if (!a) { this.autoOpen = false; this.autoAt = -1; if (this.editing?.auto) this.editing = null; }
    return a;
  }
  // Is this something the list can select: a task, an automation, or words on their way?
  onBoard(id) { return [...this.items, ...this.jobs].some((r) => r.id === id) || (this.autos || []).some((a) => a.row === id); }
  // What is read from this machine's files for one of its own was sent along with another machine's.
  autoFirings(a) { return a.host ? a.shown?.firings || [] : firings(a); }
  // Are its tasks research only? As its next task would be here; another machine's, as that machine said.
  autoResearch(a) { return a.host ? a.research === true : L.researchOnly(a); }
  autoOwn(a) { return a.host ? a.shown?.own || [] : L.settingRows(a).filter((x) => x.own); }
  // Every work setting as its next task will have it, for its settings page; and whether that page can be opened:
  // always for this machine's, and for another machine's when that machine sent the rows (an older version sends none).
  autoSettingRows(a) { return a.host ? a.shown?.settings || [] : L.settingRows(a); }
  autoCanSet(a) { return !a.host || !!a.shown?.settings?.length; }
  autoRow(a, now = Date.now()) { return a.host ? rowOf(a, now, [...this.autoFirings(a)].reverse()) : rowOf(a, now); }
  // A task one of its firings made, as the list calls it: on another machine, with that machine's name.
  autoTask(a, id) { return a.host ? `${a.host}:${id}` : id; }

  // An automation as the row code takes it: a record of its own kind (`auto`), one for each automation.
  autoRec(a) { let r = this.autoRecs.get(a); if (!r) this.autoRecs.set(a, (r = { id: a.row, auto: a })); return r; }
  // Its mark: in the automations' colour, and quiet while it is off, as a done task's is.
  autoMark(a) { const t = this.theme; return a.on ? t.fg("auto", AUTO_MARK) : t.quiet("auto", AUTO_MARK); }
  // What its row says: its trigger, then its repo where that is not the one the board shows, and its machine on the
  // board of every machine (one machine's own board names it in its header); and why the board turned it off. `part`:
  // "beside" its name (the first three), "why" (the last, under its name), or "all" of it under its name, where the
  // row has no room beside it. In the ink of what a task says; greyed while it is off.
  // `tagsGone`: the list is too narrow for the numbers' column, where the word on or off stands: it is then the
  // first thing said here.
  autoSaid(a, part = "beside") {
    const t = this.theme, r = this.autoRow(a);
    const first = [this.tagsGone ? r.state : "", r.trigger, r.repo !== this.repo.name ? repoLabel(r.repo) : "", a.host && this.scope === "*" ? `on ${clean(a.host)}` : ""], said = [...(part === "why" ? [] : first), ...(part === "beside" ? [] : [r.why])].filter(Boolean).map(clean).join(" · ");
    return !said ? "" : a.on ? t.soft(said) : t.muted(said);
  }
  // What it has for the columns on the right (row.js: rowFields). Where a task has its review tag and its pull
  // request: the task its last firing made, by that task's own mark and number (`tag`), and the word that goes with
  // the time (`lead`: "fired", "skipped", "next in"; "never fired" takes both places). The time, in the list's own time column: how long ago,
  // or how long until. `when`: the last two in one, as a narrow row says them.
  autoFields(a, now) {
    const t = this.theme, r = this.autoRow(a, now), ink = (s) => (a.on ? t.fg("overlay0", s) : t.muted(s));
    const made = r.made && this.items.find((x) => x.id === this.autoTask(a, r.made));
    return { bar: "", percent: "", eta: "", review: "", pr: "", tag: made ? `${this.mark(made)} ${t.muted(this.numberTag(made, this.numbering(), false))}` : "", lead: ink(r.lead), elapsed: r.age, ago: r.ago, never: !r.age, when: r.when };
  }
}
export const part = AutomationRows; // what this file adds to the board: view.js loads every file here that names its part
