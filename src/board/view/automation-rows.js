// The automations in the main list: a group of their own below the task groups, under the heading `automations`, one
// row per automation: its name, its trigger in plain words, the word on or off, and when it fires next or fired
// last. Which automations show (this machine's, and other machines' with the machine named, as whose board you see
// decides), what each one's row is called in the selection, and the rows as drawn. No heading when there is none.
// What the keys do on such a row: automations.js. One automation, whole: automation-panel.js.
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import * as L from "../../automations/list.js";
import { rowOf, firings } from "../../automations/show.js";
import { clean, repoLabel } from "./words.js";

// The group's heading, and the mark every one of its rows starts with: no task's mark, so the two are told apart.
export const AUTOMATIONS = "automations";
export const AUTO_MARK = "↻";
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

  // What a row shows right of its name, left to right. The repo only where it is not plainly the board's own; the
  // machine only on the board of every machine (one machine's own board names it in its header).
  autoCells(a, now, repos) {
    const r = this.autoRow(a, now), t = this.theme;
    return { a, r, mark: a.on ? t.fg("green", AUTO_MARK) : t.muted(AUTO_MARK), name: clean(a.name), why: r.why,
      rest: [r.trigger, repos ? repoLabel(r.repo) : "", a.host && this.scope === "*" ? `on ${clean(a.host)}` : "", r.state, r.when] };
  }
  // One layout for the whole group, as the task rows have one: every row on one line with its columns under each
  // other where each has the room, else every row with its name on a line and under it the rest (wrapped, not cut,
  // as a narrow task row is: row-wrap.js). One that is off is drawn as quietly as a done task, and says "off" in a
  // word: never by colour alone.
  autoLayout(width) {
    const list = this.autos || [], now = Date.now();
    const repos = new Set(list.map((a) => a.repo)).size > 1 || list.some((a) => a.repo !== this.repo.name);
    const cells = new Map(list.map((a) => [a.row, this.autoCells(a, now, repos)])), all = [...cells.values()];
    const nameW = Math.max(0, ...all.map((c) => visibleWidth(c.name))), colW = [0, 1, 2, 3, 4].map((n) => Math.max(0, ...all.map((c) => visibleWidth(c.rest[n]))));
    return { cells, nameW, colW, repos, one: 3 + nameW + colW.filter(Boolean).reduce((n, w) => n + w + 3, 0) <= width };
  }
  autoRowLines(a, width, lay) {
    const t = this.theme, c = lay.cells.get(a.row), name = (s) => (a.on ? s : t.muted(s)), room = Math.max(8, width - 4);
    const under = (s) => wrapTextWithAnsi(s, room).map((l) => "   " + t.muted(l));
    const paint = (n, s) => (!a.on ? t.muted(s) : t.fg(n === 3 ? "green" : n ? "overlay0" : "subtext0", s));
    if (lay.one) return [` ${c.mark} ${name(c.name)}${" ".repeat(lay.nameW - visibleWidth(c.name))}` + lay.colW.map((w, n) => (w ? "   " + paint(n, c.rest[n].padEnd(w)) : "")).join(""), ...(c.why ? under(c.why) : [])];
    // Narrow: nothing is cut. The name wraps under itself, and what the row says goes on to a next line between two
    // of its things, never inside one ("next in 4m" stays whole).
    const said = [];
    for (const x of c.rest.filter(Boolean)) { const on = said.length ? `${said.at(-1)} · ${x}` : x; if (said.length && visibleWidth(on) <= room) said[said.length - 1] = on; else said.push(x); }
    return [...wrapTextWithAnsi(c.name, Math.max(8, width - 3)).map((l, n) => ` ${n ? " " : c.mark} ${name(l)}`), ...said.flatMap(under), ...(c.why ? under(c.why) : [])];
  }
}
