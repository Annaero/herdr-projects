// The settings page: every work setting of the selected task by its name, its value and the place it comes from.
// Move to a row and change it; one key puts a row back to what it would be without this task's own answer.
// An automation's settings are the same page (`editing.auto`): what its next task will have, and which rows are its own.
// One on another machine is read from what that machine sent and changed there (remote/automations.js).
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import * as K from "../keys.js";
import { settingsOf } from "./panel-settings.js";
import * as L from "../../automations/list.js";
import { hasFast } from "../../agents/start.js";

// A switch reads as on or off on the page, as the panel says it; every other value as `show` says it.
export const valueSay = (v) => (v === true ? "on" : v === false ? "off" : S.say(v));

const READ_ONLY = () => `Archived tasks are read-only. ${K.name("archive")} restores.`;
// Values that are one of a few words are changed by going to the next one; every other value is typed.
export const wordsOf = (e) => (e.type === "switch" ? [true, false] : e.type === "choice" ? e.values : e.type === "access" ? ["full", "ask"] : null);

export class PanelEdit {
  // The rows of the page: a task's work settings. Board settings are yours only and are not here. A setting that
  // cannot apply to this task is not offered (fast mode for a program that has none, a repo's setting for a task
  // in no repo); one that is this task's own all the same still shows, so it can be put back.
  editRows(r) {
    const all = this.editing?.auto ? this.autoSettingRows(r) : settingsOf(r).filter((x) => x.kind === "work");
    const program = (role) => S.agentOf(all.find((x) => x.name === `${role}.agent`)?.value).kind;
    const noFast = (x) => x.name.endsWith(".fast") && !hasFast(program(x.name.split(".")[0]));
    return all.filter((x) => x.own || !(noFast(x) || /^does (nothing|not apply)/.test(x.note || "")));
  }
  // What the selected row may be, for the line under the page's headline: a choice's words with the one it is now
  // marked, or what to type.
  valueWords(row) {
    const e = S.entryOf(row.name), words = wordsOf(e);
    if (words) return words.map((w) => (w === row.value ? `[${valueSay(w)}]` : valueSay(w))).join(" · ") + (e.means ? `. On: ${e.means}` : "");
    return { time: "a time, such as 90s or 15m", count: `a whole number${e.min !== undefined ? `, ${e.min} or more` : ""}`, agent: `a program (claude, codex or pi), with a model after a slash if you like${e.none ? "; none for none" : ""}`, effort: "an effort level its program accepts, or default", text: "text; none for none", list: "names, with commas between them; none for none", attempts: "a count from 1 to 5, or programs with commas between them (claude, codex, pi), each with a model after a slash if you like" }[e.type] || "typed";
  }
  // The page's own hints: only its keys act while it is open, so only they are named.
  editHints() {
    const e = this.editing;
    if (e.typing) return [[K.name("enter"), "save this value"], [K.name("back"), "leave it as it is"]];
    return [[K.name("up", true), "move"], [K.name("enter"), "change"], [K.name("putBack"), "put back"], [K.name("back"), "back to the task"]];
  }
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
    if (r.host && this.editing?.auto) return this.autoFar(r, "auto-set", { name, value }); // another machine's automation: changed there too
    if (r.host) return this.act(r, "set", { name, value });
    const out = this.editing?.auto ? (value === undefined ? L.unsetSetting(r.id, name) : L.setSetting(r.id, name, value)) : value === undefined ? S.unsetValue(name, { task: S.get(r.id) }) : S.setValue(name, value, { task: S.get(r.id) });
    const later = this.editing?.auto || r.host ? "" : S.settingRows({ task: S.get(r.id) }).find((x) => x.name === name)?.later; // research only, on a task under way
    this.flash(`${S.entryOf(name)?.label || name}: ${valueSay(out.value).split("\n")[0]}  (${out.from})${later ? ` · ${later}` : ""}`, "green");
    this.load();
  }
  // A key while the settings page is open. Returns true when the page took it.
  editKey(data) {
    const e = this.editing, r = e.auto ? this.auto() : this.current();
    if (!r || (e.auto ? r.row : r.id) !== e.id || !(e.auto ? this.autoOpen : this.full)) { this.editing = null; return false; }
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
    if (esc || K.is(data, "settings")) { this.leaveSettings(); return true; }
    if (K.is(data, "close")) return false; // closing the board is the one key that is never the page's
    if (K.is(data, "up") || K.is(data, "down")) { e.at = Math.max(0, Math.min(rows.length - 1, e.at + (K.is(data, "up") ? -1 : 1))); return true; }
    if (!row) return true;
    if (K.is(data, "putBack")) { if (!row.own) this.flash(`${row.name} is not this ${e.auto ? "automation" : "task"}'s own: it comes from ${row.from}.`); else this.editSave(r, row.name, undefined); return true; }
    if (enter) {
      if (r.archivedAt) { this.flash(READ_ONLY(), "yellow"); return true; }
      if (row.note.startsWith("does not apply")) { this.flash(`${row.name} ${row.note}.`, "yellow"); return true; }
      const words = wordsOf(S.entryOf(row.name));
      if (words) this.editSave(r, row.name, words[(words.indexOf(row.value) + 1) % words.length]);
      else { e.typing = row.name; this.setValue(""); } // an empty box: what is typed is the whole new value
      return true;
    }
    // Only the page's own keys act here: no key of the list archives, merges or removes the task from its settings
    // page, and a letter typed by mistake changes nothing and goes nowhere.
    return true;
  }
  // The page as lines. `this.editLine` is the selected row's line, which the panel keeps on screen. Each row: the
  // setting's plain label, its value, the place it comes from, and its name as a command takes it, greyed. The line
  // on top is the selected row's: what it may be. Which keys act is on the hint line (editHints).
  settingsPage(r, width) {
    const t = this.theme, e = this.editing, rows = this.editRows(r), whose = e.auto ? "this automation" : "this task";
    e.at = Math.max(0, Math.min(rows.length - 1, e.at));
    const dim = (s) => t.muted(s), fit = (s) => truncateToWidth(s, width, "…");
    const label = (x) => S.entryOf(x.name)?.label || x.name;
    const place = (x) => (x.note || (x.own ? whose : x.from)) + (x.later ? ` · ${x.later}` : "");
    const wide = Math.max(...rows.map((x) => label(x).length)), val = Math.min(24, Math.max(...rows.map((x) => valueSay(x.value).length))), from = Math.max(...rows.map((x) => place(x).length));
    const now = rows[e.at], lines = [""];
    // Whole, on as many lines as it needs: what a value may be is never the part that is cut.
    const typed = rows.find((x) => x.name === e.typing) || now;
    const top = e.typing ? `Type the new value for ${label(typed)} below (now: ${valueSay(typed?.value ?? "").split("\n")[0]}): ${this.valueWords(typed)}.` : now ? `${label(now)}: ${this.valueWords(now)}` : "";
    lines.push(...wrapTextWithAnsi(top, Math.max(10, width - 2)).map((l) => " " + t.soft(l)), "");
    let group = "";
    rows.forEach((x, n) => {
      const g = x.name.split(".")[0];
      if (group && g !== group) lines.push("");
      group = g;
      const here = n === e.at, value = valueSay(x.value).replace(/\s*\n\s*/g, " / ");
      const line = ` ${here ? "›" : " "} ${x.own ? "*" : " "} ${label(x).padEnd(wide)}  ${value.padEnd(val)}  ${place(x).padEnd(from)}  ${x.name}`;
      if (here) this.editLine = lines.length;
      lines.push(here ? this.hl(t.bold(fit(line)).replace("*", t.fg("accent", "*")), width) : x.own ? fit(line).replace("*", t.fg("accent", "*")) : dim(fit(line)));
    });
    lines.push("", fit(dim(` ${t.fg("accent", "*")} ${whose}'s own. Every other row says the place its value comes from.`)), fit(dim(" Board settings are yours only: herdr-superwork show")));
    for (const bad of e.auto ? [] : r.host ? r.snap?.problems || [] : S.settingProblems(r)) lines.push(fit(t.fg("yellow", ` Not counted: ${bad}`)));
    return lines;
  }
}
