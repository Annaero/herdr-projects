// What the keys do on an automation's row in the main list (automation-rows.js), and the hints and the ? menu's
// lines there: enter opens it (and, on a firing in an open one, goes to the task it made), space turns it on or off,
// tab fires it now, ctrl+x removes it (it asks first), ctrl+e opens its settings. No task is selected on such a row,
// so what you type goes where it goes with no task selected: to the Coordinator, which makes and rewords automations.
// An automation of another machine is changed on that machine, as its tasks are (remote/automations.js).
import { truncateToWidth } from "@earendil-works/pi-tui";
import * as K from "../keys.js";
import * as L from "../../automations/list.js";
import * as R from "../../remote.js";
import { fire } from "../../automations/fire.js";
import { turnedWords, firedWords } from "../../automations/show.js";
import { clean } from "./words.js";

// Keys that act on a task and on nothing else: on an automation's row they do nothing, and have no line in the menu.
const TASK_ONLY = ["yes", "sendBack", "archive", "pin"];
// The board's keys that still do what they always do while one automation is open, whole.
const OPEN_SAME = ["menu", "close", "undo", "chatMessage", "chatScrollUp", "chatScrollDown"];
// A plain key's line in the ? menu, where it does something else on an automation's row than on a task's.
export const AUTO_HELP = { enter: "send what is typed; with nothing typed, open this automation (on a firing in it: go to the task it made)", talk: "turn this automation on or off", delegate: "fire this automation now" };

export class Automations {
  autoTry(fn) { try { fn(); } catch (e) { this.flash(e.message, "red"); } try { this.load(); } catch {} }
  // The same thing on the machine that has it: sent there, and its answer said here.
  autoFar(a, action, extra = {}, after) {
    this.flash(`${{ "auto-turn": extra.on ? "Turning on" : "Turning off", "auto-run": "Firing", "auto-remove": "Removing", "auto-set": "Changing a setting of" }[action]} "${a.name}" on ${a.host}…`);
    this.ssh(a.machine, "do", { action, id: a.id, ...extra }, (j, why) => {
      this.flash(j ? j.msg : R.unanswered(a.host, why), j && j.ok ? "green" : j ? "yellow" : "red");
      if (j && j.ok) after?.();
      this.pollRemotes(true); this.tui.requestRender();
    });
  }
  autoToggle(a) { if (a.host) return this.autoFar(a, "auto-turn", { on: !a.on }); this.autoTry(() => this.flash(...turnedWords(L.turn(a.id, !a.on)))); }
  autoFire(a) {
    if (!a.on) return this.flash(`"${a.name}" is off, and off it never fires. ${K.name("talk")} turns it on.`, "yellow");
    if (a.host) return this.autoFar(a, "auto-run");
    this.autoTry(() => this.flash(...firedWords(a, fire(a, { kind: "run" }))));
  }
  autoRemove(a) {
    const gone = () => { this.autoOpen = false; this.editing = null; };
    this.confirm(`Remove the automation "${truncateToWidth(clean(a.name), 32, "…")}"${a.host ? ` on ${a.host}` : ""}? The tasks it made stay.`, () => (a.host ? this.autoFar(a, "auto-remove", {}, gone) : this.autoTry(() => { L.remove(a.id); gone(); this.flash(`Removed the automation "${a.name}".`); })));
  }
  // The whole automation, and back to the list; its settings page, and back to the whole automation.
  autoFold() { this.autoOpen = !this.autoOpen; this.full = false; this.editing = null; this.autoAt = -1; this.panelTop = 0; }
  autoSettings(a) {
    if (this.editing?.auto) return this.leaveSettings();
    // (A machine on an older version sends no rows for the page: there the command changes them.)
    if (!this.autoCanSet(a)) return this.flash(`Its settings are changed on ${a.host}: herdr-superwork set <name> <value> --automation "${a.name}"`, "yellow");
    this.editing = { id: a.row, at: 0, typing: "", auto: true }; this.autoOpen = true; this.full = false; this.panelTop = 0;
  }
  // Enter on a firing: to the task it made, on the board.
  autoGo(id) {
    this.load(); // the task may be newer than the last look
    const t = this.items.find((r) => r.id === id);
    if (!t) return this.flash(`${id} is gone: it was removed.`, "yellow");
    this.autoOpen = false; this.autoAt = -1; this.editing = null; this.panelTop = 0;
    if (!!t.archivedAt !== this.archiveView) this.toggleArchive();
    this.sel = id; this.stick = id; this.load();
  }
  // A key while an automation's row is selected and nothing is typed. Returns true when the row took it; every other
  // key does what it does on the list (the arrows move on, find finds, what is typed goes into the text box).
  autoKey(data) {
    if (this.input.isPasting || data.includes("\x1b[200~") || this.value() || this.mode !== "new") return false;
    const a = this.auto(), open = this.autoOpen;
    if (!a) return false;
    if (K.is(data, "back")) { if (open) this.autoFold(); return open; }
    if (open && (K.is(data, "up") || K.is(data, "down"))) { this.autoStep(a, K.is(data, "up") ? -1 : 1); return true; }
    if (open && (K.is(data, "pageUp") || K.is(data, "pageDown"))) { this.scrollPanelBy((K.is(data, "pageUp") ? -1 : 1) * Math.max(1, this.panelHeight - 1)); return true; }
    if (K.is(data, "panel")) { this.autoFold(); return true; }
    if (data !== "\n" && K.is(data, "enter")) {
      const f = open ? this.autoFirings(a)[this.autoAt] : null;
      if (!open) this.autoFold();
      else if (f?.task) this.autoGo(this.autoTask(a, f.task));
      else this.flash(f ? "That firing was skipped: it made no task." : `${K.name("up", true)} pick a firing; ${K.name("enter")} then goes to the task it made.`);
      return true;
    }
    if (K.is(data, "talk")) { this.autoToggle(a); return true; }
    if (K.is(data, "delegate")) { this.autoFire(a); return true; }
    if (K.is(data, "stop")) { this.autoRemove(a); return true; }
    if (K.is(data, "settings")) { this.autoSettings(a); return true; }
    const k = K.typed(data, (x) => x.run);
    return !!k && (TASK_ONLY.includes(k.id) || (open && !OPEN_SAME.includes(k.id)));
  }
  // The hint line on an automation's row: only keys that act there, the main thing first. `back`: what esc steps
  // back from on the list right now, if anything; `more`: the menu's own hint (hints.js).
  autoHints(a, back, more) {
    const esc = K.name("back"), enter = K.name("enter"), arrows = [K.name("up"), K.name("down")].join("");
    // (Off, it never fires: tab would only say so.)
    const act = [K.hint("talk", `turn this automation ${a.on ? "off" : "on"}`), a.on && K.hint("delegate", "fire it now"), K.hint("stop", "remove it")].filter(Boolean);
    if (this.ctx.web) return this.autoOpen ? act : [...act, ...back]; // a page: a row is tapped open, a firing is a link
    if (!this.autoOpen) return [[enter, "open this automation"], ...act, this.autoCanSet(a) && K.hint("settings", "its settings"), ...(back.length ? back : [more])].filter(Boolean);
    const all = this.autoFirings(a), f = all[this.autoAt];
    return [all.length && [arrows, "pick a firing"], f?.task && [enter, "go to its task"], ...act.slice(0, 2), [esc, "back to the list", true]].filter(Boolean);
  }
  // The ? menu on an automation's row: the keys that do something there, in the words of what they do there.
  autoMenuItems(a) {
    const words = { stop: "remove this automation (it asks first)", settings: this.autoCanSet(a) ? "this automation's settings: see and change each one" : "", panel: this.autoOpen ? "back to the list" : "show the whole automation, full screen", side: `${this.side ? "hide" : "show"} the side panel: this automation, beside the list` };
    const does = { stop: () => this.autoRemove(a), settings: () => this.autoSettings(a), panel: () => this.autoFold(), side: () => this.toggleSide() };
    return K.KEYS.filter((k) => k.menu && !TASK_ONLY.includes(k.id) && (!this.autoOpen || k.id in words || OPEN_SAME.includes(k.id)))
      .map((k) => ({ id: k.id, group: k.group, key: K.name(k.id), label: k.id in words ? words[k.id] : k.menu(this, undefined), run: () => (does[k.id] ? does[k.id]() : k.run(this, undefined)) })).filter((i) => i.label);
  }
}
export const part = Automations; // what this file adds to the board: view.js loads every file here that names its part
