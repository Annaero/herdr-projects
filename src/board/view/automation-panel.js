// One automation, whole: beside the list and full screen. Its prompt, its trigger, where its tasks go, its settings
// (the rows that are its own marked, as on a task), and its firings, newest first, each with the task it made. The
// arrows pick a firing there, and enter on one goes to its task. Drawn with the task panel's own kit (panel-kit.js).
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import * as L from "../../automations/list.js";
import { rowOf, firings, firingWords } from "../../automations/show.js";
import { clean, short } from "./words.js";
import { panelKit } from "./panel-kit.js";
import { name as keyName } from "../keys.js";

// The most firings the panel lists: the command has them all.
const SHOWN = 20;
const READ = 100;

export class AutomationPanel {
  // The panel's lines, and the line each listed firing is on. `full`: the whole automation, with every firing shown
  // and one of them picked (`autoAt`).
  autoPanel(a, width, full = false) {
    const p = panelKit(this.theme, width), { t, dim, wrap, out, head, fact, parts, part, text } = p;
    const r = rowOf(a), all = firings(a), own = L.settingRows(a).filter((x) => x.own);
    part(wrap(clean(a.name)).map((l) => t.bold(l)));
    part([head("Status"),
      ...fact("State", a.on ? t.fg("green", `${t.mark("done")} ${t.bold("on")}`) : t.fg("yellow", `${t.mark("idle")} ${t.bold("off")}`) + (a.offWhy ? dim(` · ${a.offWhy}`) : dim(" · it never fires, and keeps everything"))),
      ...fact("Trigger", r.trigger), ...(r.next ? fact("Next", `${r.next} · ${new Date(a.nextAt).toLocaleString()}`) : []),
      ...fact("Repo", `${a.repo} · ${short(a.root)}`), ...fact("Last firing", r.last), ...(a.research ? fact("Research", "only · its tasks change nothing in the repo") : [])]);
    text("Prompt", wrap(a.prompt), 1);
    part([head("Settings"), ...(own.length ? own.flatMap((x) => wrap(`${x.name.padEnd(Math.max(...own.map((o) => o.name.length)))}  ${S.say(x.value).replace(/\s*\n\s*/g, " / ")} *`).map((l) => l.replace(/\*$/, t.fg("accent", "*")))) : wrap("None of its own: its tasks run on what any task would.").map(dim)),
      ...(full ? wrap(`${own.length ? "* this automation's own, put on each task it makes. " : ""}${keyName("settings")} changes them: every setting, and the place each one comes from`).map((l) => dim(l).replace("*", t.fg("accent", "*"))) : [])]);
    const shown = all.slice(0, full ? SHOWN : 5), lines = [head("Firings")], at = [];
    if (full) this.autoAt = Math.max(-1, Math.min(shown.length - 1, this.autoAt ?? -1));
    shown.forEach((f, n) => {
      const w = firingWords(f), here = full && n === this.autoAt;
      // A long one wraps under itself, never cut: why a firing was skipped is the thing to read.
      const rows = wrap(`${w.when.padEnd(8)} ${w.what}  ${f.task ? "→ " + w.result : w.result}`, p.w - 2).map((l, k) => (k ? "    " : here ? "› " : "  ") + l);
      at.push(lines.length);
      lines.push(...rows.map((l) => (here ? t.bold(l) : f.task ? l : dim(l))));
    });
    if (!all.length) lines.push(dim("None yet."));
    if (all.length > shown.length) lines.push(...wrap(`… ${all.length - shown.length} more: herdr-superwork automations firings "${a.name}"`).map(dim));
    const firingsPart = part(lines);
    const body = ["", ...parts.filter((s) => s.lines.length).flatMap((s, n) => (n ? ["", ...s.lines] : s.lines))];
    const from = body.length - firingsPart.lines.length;
    return { lines: out(body), at: at.map((n) => from + n) };
  }
  // The whole automation, full screen, or its settings page (panel-edit.js) in its place.
  autoFull(a, width, h) {
    const t = this.theme, editing = this.editing?.auto && this.editing.id === a.id;
    const drawn = editing ? null : this.autoPanel(a, Math.min(width, READ), true), lines = editing ? this.settingsPage(a, Math.min(width, READ)) : drawn.lines;
    this.panelHeight = Math.max(1, h - 2); this.panelLength = lines.length;
    const keep = editing ? this.editLine : this.autoAt >= 0 ? drawn.at[this.autoAt] : -1; // the picked row stays on screen
    if (keep >= 0) this.panelTop = Math.min(keep, Math.max(this.panelTop, keep - this.panelHeight + 1));
    this.panelTop = Math.max(0, Math.min(this.panelTop, Math.max(0, lines.length - this.panelHeight)));
    const end = Math.min(lines.length, this.panelTop + this.panelHeight);
    const left = " " + t.bold(editing ? "Settings" : "Automation") + t.muted(`  ${truncateToWidth(clean(a.name), Math.max(8, width - 40), "…")}`), right = lines.length > this.panelHeight ? t.muted(`lines ${this.panelTop + 1}–${end} of ${lines.length} `) : "";
    return [left + " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(right))) + right, t.fg("surface1", "─".repeat(width)), ...lines.slice(this.panelTop, end)];
  }
  // The arrows in an open automation: on to the next firing while its line shows, else the page scrolls a line, so
  // nothing between is passed over unread.
  autoStep(a, d) {
    const { at, lines } = this.autoPanel(a, Math.min(this.width || 120, READ), true), last = Math.max(0, lines.length - this.panelHeight);
    const next = this.autoAt + d, line = at[next], shows = line !== undefined && line >= this.panelTop && line < this.panelTop + this.panelHeight;
    if (d > 0 && line !== undefined && shows) this.autoAt = next;
    else if (d > 0) this.panelTop = Math.min(last, this.panelTop + 1);
    else if (this.autoAt >= 0 && (next < 0 || shows)) this.autoAt = next;
    else this.panelTop = Math.max(0, this.panelTop - 1);
  }
}
