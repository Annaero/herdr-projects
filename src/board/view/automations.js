// The automations, a list of their own behind its key, as the archive is: one row per automation (on or off, its
// name, its trigger in plain words, its repo, the last firing, the next one for a schedule), and what the keys do
// there: turn it on or off, fire it now, remove it (it asks first), open it. Making and rewording one is done through
// the Coordinator's text box, which stays where it is. One automation, whole: automation-panel.js.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import * as K from "../keys.js";
import * as L from "../../automations/list.js";
import { fire } from "../../automations/fire.js";
import { rowOf, firings } from "../../automations/show.js";
import { clean } from "./words.js";
import { WIDE } from "./size.js";

// The board's keys that still do what they always do in this list. Every other key that acts on a task does nothing here.
const SAME = ["automations", "menu", "close", "undo", "chatMessage", "chatScrollUp", "chatScrollDown", "side"];
const NO_COORDINATOR = "No Coordinator is on to make one. By hand: herdr-superwork automations add \"<name>\" --prompt \"<…>\" --schedule \"every 2h\"";

export class Automations {
  toggleAutomations() {
    this.automationsView = !this.automationsView;
    this.autoOpen = false; this.autoAt = -1; this.editing = null; this.full = false; this.menu = null; this.panelTop = 0;
    if (this.mode !== "new") { this.mode = "new"; this.setValue(""); }
    this.load();
  }
  // The selected automation: the one last picked while it is there, else the first.
  autoCurrent(list = S.automations()) { const a = list.find((x) => x.id === this.autoSel) || list[0] || null; this.autoSel = a ? a.id : ""; return a; }
  autoPlace() { return this.talksToCoord ? "Tell the Coordinator what to automate, and when" : "no Coordinator: nothing to type here"; }
  autoTry(fn) { try { fn(); } catch (e) { this.flash(e.message, "red"); } }
  autoToggle(a) { this.autoTry(() => { const now = L.turn(a.id, !a.on); this.flash(`"${now.name}" is ${now.on ? "on" : "off: it never fires, and keeps everything"}.`, now.on ? "green" : "yellow"); }); }
  autoFire(a) {
    this.autoTry(() => {
      if (!a.on) return this.flash(`"${a.name}" is off, and off it never fires. ${K.name("talk")} turns it on.`, "yellow");
      const f = fire(a, { kind: "run" });
      this.flash(f.task ? `"${a.name}" fired: ${f.task} was added${f.note ? `, ${f.note}` : " and an agent is on it"}.` : `"${a.name}" did not fire: ${f.skipped}.`, f.task && !f.note ? "green" : "yellow");
    });
  }
  autoRemove(a) { this.confirm(`Remove the automation "${truncateToWidth(clean(a.name), 32, "…")}"? The tasks it made stay.`, () => this.autoTry(() => { L.remove(a.id); this.autoOpen = false; this.editing = null; this.flash(`Removed the automation "${a.name}".`); })); }
  // The whole automation, and back to the list; its settings page, and back to the whole automation.
  autoFold() { this.autoOpen = !this.autoOpen; this.editing = null; this.autoAt = -1; this.panelTop = 0; }
  autoSettings(a) { if (this.editing?.auto) return this.leaveSettings(); this.editing = { id: a.id, at: 0, typing: "", auto: true }; this.autoOpen = true; this.panelTop = 0; }
  // Enter on a firing: to the task it made, on the board.
  autoGo(id) {
    this.load(); // the task may be newer than the last look
    const t = this.items.find((r) => r.id === id);
    if (!t) return this.flash(`${id} is gone: it was removed.`, "yellow");
    this.toggleAutomations();
    if (!!t.archivedAt !== this.archiveView) this.toggleArchive();
    this.sel = id; this.stick = id; this.load();
  }
  // A key while the automations show. Returns true when the list took it.
  autoKey(data) {
    if (this.input.isPasting || data.includes("\x1b[200~")) return false;
    const enter = data !== "\n" && K.is(data, "enter"), tab = K.is(data, "delegate");
    // What is typed goes to the Coordinator, as always. With none on, nothing here could take the words.
    if (this.value()) { if ((enter || tab) && !this.talksToCoord) { this.flash(NO_COORDINATOR, "yellow"); return true; } return false; }
    const list = S.automations(), a = this.autoCurrent(list);
    if (K.is(data, "back")) { if (this.autoOpen) { this.autoOpen = false; this.autoAt = -1; this.panelTop = 0; } else this.toggleAutomations(); return true; }
    if (K.is(data, "up") || K.is(data, "down")) { const d = K.is(data, "up") ? -1 : 1; if (this.autoOpen && a) this.autoStep(a, d); else if (a) this.autoSel = list[Math.max(0, Math.min(list.length - 1, list.indexOf(a) + d))].id; return true; }
    if (K.is(data, "panel")) { if (a) this.autoFold(a); return true; }
    const own = { enter, talk: K.is(data, "talk"), delegate: tab, stop: K.is(data, "stop"), settings: K.is(data, "settings") };
    if (Object.values(own).some(Boolean)) {
      if (!a) this.flash("No automation yet. Tell the Coordinator what to automate, and when.");
      else if (own.enter) { const f = this.autoOpen ? firings(a)[this.autoAt] : null; if (!this.autoOpen) { this.autoOpen = true; this.autoAt = -1; this.panelTop = 0; } else if (f?.task) this.autoGo(f.task); else this.flash(f ? "That firing was skipped: it made no task." : `${K.name("up", true)} pick a firing; ${K.name("enter")} then goes to the task it made.`); }
      else if (own.talk) this.autoToggle(a);
      else if (own.delegate) this.autoFire(a);
      else if (own.stop) this.autoRemove(a);
      else this.autoSettings(a);
      return true;
    }
    const k = K.typed(data, (x) => x.run);
    return !!k && !SAME.includes(k.id); // a key that acts on a task: there is none here
  }
  autoHints() {
    const a = this.autoCurrent(), esc = K.name("back"), enter = K.name("enter"), arrows = [K.name("up"), K.name("down")].join("");
    if (this.editing?.auto) return null;
    if (this.value()) return this.talksToCoord ? null : [[esc, "put away"]];
    const back = [esc, this.autoOpen ? "back to the list" : "back to the board"];
    if (!a) return [back, K.hint("menu")];
    const act = [K.hint("talk", `turn this automation ${a.on ? "off" : "on"}`), K.hint("delegate", "run it now"), K.hint("stop", "remove it")];
    if (this.ctx.web) return this.autoOpen ? act : [...act, back]; // a page: a row is tapped open, a firing is a link
    return this.autoOpen ? [[arrows, "pick a firing"], [enter, "go to its task"], ...act.slice(0, 2), back] : [...act, [enter, "open it"], back];
  }
  // The ? menu in this list: the keys that do something here, in the words of what they do here.
  autoMenuItems() {
    const a = this.autoCurrent(), words = { stop: "remove this automation (it asks first)", settings: "this automation's settings: see and change each one", panel: this.autoOpen ? "back to the list" : "show the whole automation, full screen", side: `${this.side ? "hide" : "show"} the side panel: this automation, beside the list` };
    const does = { stop: () => this.autoRemove(a), settings: () => this.autoSettings(a), panel: () => this.autoFold(a), side: () => this.toggleSide() };
    return K.KEYS.filter((k) => k.menu && (words[k.id] || SAME.includes(k.id))).map((k) => ({ id: k.id, group: k.group, key: K.name(k.id), label: words[k.id] || k.menu(this, undefined), run: () => (!does[k.id] ? k.run(this, undefined) : a ? does[k.id]() : undefined) }));
  }
  autoPlainHelp() {
    return [[K.name("up", true), "move between automations; in an open one, between its firings"], [K.name("enter"), "open this automation; on a firing, go to the task it made"], [K.name("talk"), "turn this automation on or off"],
      [K.name("delegate"), "fire this automation now"], [K.name("back"), "back, one step at a time"], [K.name("menu"), "this menu"], [K.name("sayYes", true), K.say("answer a question: {sayYes} yes, {sayNo} or {back} no")]];
  }
  // One row: its mark and name, then its trigger, its repo, the last firing and the next one.
  autoCells(a, now) {
    const r = rowOf(a, now), t = this.theme;
    return { r, mark: a.on ? t.fg("green", t.mark("done")) : t.muted(t.mark("idle")), name: clean(a.name) + (a.on ? "" : "  [off]"), rest: [r.trigger, r.repo, r.last, r.next ? `next ${r.next}` : ""].filter(Boolean), why: r.why };
  }
  autoList(list, width, h) {
    const t = this.theme, now = Date.now();
    if (!list.length) return this.pad(["", " " + t.fg("overlay0", truncateToWidth(this.talksToCoord ? "No automations yet. Tell the Coordinator what to automate, and when: \"every Monday at nine, look for dependencies that are out of date\"." : "No automations yet. Make one: herdr-superwork automations add \"<name>\" --prompt \"<…>\" --schedule \"mon 09:00\"", Math.max(1, width - 2), "…"))], h);
    const cells = list.map((a) => ({ a, ...this.autoCells(a, now) }));
    // One line each where every row has room for it, its columns under each other; else two lines each.
    const nameW = Math.max(...cells.map((c) => visibleWidth(c.name))), colW = [0, 1, 2, 3].map((n) => Math.max(0, ...cells.map((c) => visibleWidth(c.rest[n] || ""))));
    const one = 3 + nameW + colW.filter(Boolean).reduce((n, w) => n + w + 3, 0) <= width;
    const lines = [{ text: "", sel: false }];
    for (const c of cells) {
      const sel = c.a.id === this.autoSel, name = c.a.on ? t.bold(c.name) : t.muted(c.name);
      const under = (s) => ({ text: "   " + t.muted(truncateToWidth(s, Math.max(1, width - 4), "…")), sel });
      if (one) lines.push({ text: ` ${c.mark} ${name}${" ".repeat(nameW - visibleWidth(c.name))}` + colW.map((w, n) => (w ? "   " + t.fg(n ? "overlay0" : "subtext0", (c.rest[n] || "").padEnd(w)) : "")).join(""), sel });
      else lines.push({ text: ` ${c.mark} ${truncateToWidth(name, Math.max(1, width - 3), "…")}`, sel }, under(c.rest.join(" · ")));
      if (c.why) lines.push(under(c.why));
    }
    const at = lines.findIndex((l) => l.sel), end = lines.findLastIndex((l) => l.sel);
    this.autoTop = Math.max(0, Math.min(at < (this.autoTop || 0) + 1 ? at - 1 : end >= (this.autoTop || 0) + h ? end - h + 1 : this.autoTop || 0, Math.max(0, lines.length - h)));
    return this.pad(lines.slice(this.autoTop, this.autoTop + h).map((l) => (l.sel ? this.hl(l.text, width) : l.text)), h);
  }
  // The automations in the place of the task list: the list, one automation beside it or whole, or its settings page.
  autoScreen(width, h) {
    const t = this.theme, list = S.automations(), a = this.autoCurrent(list), off = list.filter((x) => !x.on).length;
    if (this.editing?.auto && (!a || a.id !== this.editing.id)) this.editing = null;
    if (!a) this.autoOpen = false;
    if (this.autoOpen) return this.autoFull(a, width, h);
    const head = (w) => truncateToWidth(" " + t.bold("herdr-superwork") + t.fg("overlay0", `  automations${list.length ? ` · ${list.length}${off ? ` · ${off} off` : ""}` : ""}`), w, "…");
    if (!(width >= WIDE && this.side && a)) return [head(width), ...this.autoList(list, width, Math.max(1, h - 1))];
    const paneW = Math.max(38, Math.min(70, Math.floor(width * 0.38))), listW = width - paneW - 3;
    const left = [head(listW), ...this.autoList(list, listW, Math.max(1, h - 1))], right = this.autoPanel(a, paneW, false).lines;
    return Array.from({ length: h }, (_, i) => truncateToWidth(left[i] ?? "", listW, "…", true) + " " + t.fg("surface_dim", "│") + t.under("sidebar_bg", truncateToWidth(" " + (right[i] ?? ""), paneW + 1, "…", true)));
  }
}
