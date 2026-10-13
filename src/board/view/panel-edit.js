// The settings page: every work setting of the selected task by its name, its value and the place it comes from.
// Move to a row and change it; one key puts a row back to what it would be without this task's own answer.
// An automation's settings are the same page (`editing.auto`): what its next task will have, and which rows are its own.
import { truncateToWidth } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import * as K from "../keys.js";
import { settingsOf } from "./panel-settings.js";
import * as L from "../../automations/list.js";

const READ_ONLY = () => `Archived tasks are read-only. ${K.name("archive")} restores.`;
// Values that are one of a few words are changed by going to the next one; every other value is typed.
const wordsOf = (e) => (e.type === "switch" ? [true, false] : e.type === "choice" ? e.values : e.type === "access" ? ["full", "ask"] : null);

export class PanelEdit {
  // The rows of the page: a task's work settings. Board settings are yours only and are not here.
  editRows(r) { return this.editing?.auto ? L.settingRows(r) : settingsOf(r).filter((x) => x.kind === "work"); }
  editSettings(r) {
    if (!r || r.title === undefined) return this.flash("Select a task first.");
    if (this.editing?.id === r.id) return this.leaveSettings();
    this.editing = { id: r.id, at: Math.max(0, this.editing?.at || 0), typing: "" };
    this.full = true; this.panelTop = 0;
  }
  leaveSettings() { if (this.editing?.typing) this.setValue(""); this.editing = null; this.panelTop = 0; }
  // Save one row: a value, or undefined to put it back. A task on another machine is changed there.
  editSave(r, name, value) {
    if (r.archivedAt) return this.flash(READ_ONLY(), "yellow");
    if (r.host) return this.act(r, "set", { name, value });
    const out = this.editing?.auto ? (value === undefined ? L.unsetSetting(r.id, name) : L.setSetting(r.id, name, value)) : value === undefined ? S.unsetValue(name, { task: S.get(r.id) }) : S.setValue(name, value, { task: S.get(r.id) });
    this.flash(`${name}: ${S.say(out.value).split("\n")[0]}  (${out.from})`, "green");
    this.load();
  }
  // A key while the settings page is open. Returns true when the page took it.
  editKey(data) {
    const e = this.editing, r = e.auto ? this.autoCurrent() : this.current();
    if (!r || r.id !== e.id || !(e.auto ? this.autoOpen : this.full)) { this.editing = null; return false; }
    const rows = this.editRows(r), row = rows[Math.min(e.at, rows.length - 1)];
    const esc = K.is(data, "back"), enter = data !== "\n" && K.is(data, "enter");
    if (e.typing) {
      if (esc) { e.typing = ""; this.setValue(""); return true; }
      if (K.is(data, "close")) return false;
      if (!enter) { this.input.handleInput(data); return true; }
      const name = e.typing, text = this.value().trim();
      if (!text) { this.flash(`${name} needs a value. ${K.name("putBack")} puts it back instead.`, "yellow"); return true; }
      this.editSave(r, name, text); // a refused value throws: what was typed stays, to be put right
      e.typing = ""; this.setValue("");
      return true;
    }
    if (esc) { this.leaveSettings(); return true; }
    if (K.is(data, "up") || K.is(data, "down")) { e.at = Math.max(0, Math.min(rows.length - 1, e.at + (K.is(data, "up") ? -1 : 1))); return true; }
    if (!row) return false;
    if (K.is(data, "putBack")) { if (!row.own) this.flash(`${row.name} is not this ${e.auto ? "automation" : "task"}'s own: it comes from ${row.from}.`); else this.editSave(r, row.name, undefined); return true; }
    if (enter) {
      if (r.archivedAt) { this.flash(READ_ONLY(), "yellow"); return true; }
      if (row.note.startsWith("does not apply")) { this.flash(`${row.name} ${row.note}.`, "yellow"); return true; }
      const words = wordsOf(S.entryOf(row.name));
      if (words) this.editSave(r, row.name, words[(words.indexOf(row.value) + 1) % words.length]);
      else { e.typing = row.name; this.setValue(""); } // an empty box: what is typed is the whole new value
      return true;
    }
    return K.is(data, "delegate") || data.length === 1 && data >= " "; // a letter typed by mistake changes nothing and goes nowhere
  }
  // The page as lines. `this.editLine` is the selected row's line, which the panel keeps on screen.
  settingsPage(r, width) {
    const t = this.theme, e = this.editing, rows = this.editRows(r), whose = e.auto ? "this automation" : "this task";
    e.at = Math.max(0, Math.min(rows.length - 1, e.at));
    const dim = (s) => t.muted(s), fit = (s) => truncateToWidth(s, width, "…");
    const wide = Math.max(...rows.map((x) => x.name.length)), val = Math.min(28, Math.max(...rows.map((x) => S.say(x.value).length)));
    const lines = [""];
    lines.push(fit(dim(e.typing ? ` Type the new value for ${e.typing} below (now: ${S.say(rows.find((x) => x.name === e.typing)?.value ?? "").split("\n")[0]}). ${K.name("enter")} saves it, ${K.name("back")} leaves it as it is.`
      : ` ${K.name("up", true)} move · ${K.name("enter")} change · ${K.name("putBack")} put back · ${K.name("back")} back`)), "");
    let group = "";
    rows.forEach((x, n) => {
      const g = x.name.split(".")[0];
      if (group && g !== group) lines.push("");
      group = g;
      const here = n === e.at, value = S.say(x.value).replace(/\s*\n\s*/g, " / ");
      const line = ` ${here ? "›" : " "} ${x.own ? "*" : " "} ${x.name.padEnd(wide)}  ${value.padEnd(val)}  ${x.note || (x.own ? whose : x.from)}`;
      if (here) this.editLine = lines.length;
      lines.push(here ? t.bold(fit(line)).replace("*", t.fg("accent", "*")) : x.own ? fit(line).replace("*", t.fg("accent", "*")) : dim(fit(line)));
    });
    lines.push("", fit(dim(` ${t.fg("accent", "*")} ${whose}'s own. Every other row says the place its value comes from.`)), fit(dim(" Board settings are yours only: herdr-superwork show")));
    for (const bad of e.auto ? [] : r.host ? r.snap?.problems || [] : S.settingProblems(r)) lines.push(fit(t.fg("yellow", ` Not counted: ${bad}`)));
    return lines;
  }
}
