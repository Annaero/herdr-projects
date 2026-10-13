// The board with no terminal: the same View the terminal board is (its list, its selection, its questions, its
// actions, its words), opened for a web page. Nothing is drawn here and nothing is decided here: a button on the page
// presses the key it stands for (`press`), and what is typed is sent as enter or tab would send it (`send`). What is
// left out is only what belongs to a terminal: the first-run screen, the pane's size, the OSC lines, the timer (the
// page asks), and going into an agent, which on the web is a link to the web UI's own view of that pane (`go`), on
// this machine or on another of the web UI's.
// One per browser that has the board open, so each has its own selection, question and message.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as S from "../store.js";
import * as F from "../flow.js";
import * as D from "../delegate.js";
import * as K from "../board/keys.js";
import { herdr } from "../herdr.js";
import { View } from "../board/view.js";
import { webTheme } from "./ink.js";
import { followWeb, webChat } from "./web-pcs.js";

// From here on the board's words name a key as its button on the page.
K.nameAsButtons();
const tui = { terminal: { rows: 200, columns: 400 }, requestRender() {}, stop() {}, start() {} };
// Where the web board is "in": the repo the terminal board was last opened in, else the home folder.
const lastFolder = () => { const cwd = (S.readJson(path.join(S.dataDir(), "view.json")) || {}).cwd; try { if (cwd && fs.existsSync(cwd)) return cwd; } catch {} return os.homedir(); };

// What a terminal sends for a key of the board (src/board/keys.js), so a button presses exactly that key.
const NAMED = { enter: "\r", return: "\r", tab: "\t", escape: "\x1b", up: "\x1b[A", down: "\x1b[B", pageUp: "\x1b[5~", pageDown: "\x1b[6~" };
export function bytesOf(id) {
  const k = K.KEY[id];
  if (!k) throw new Error(`No key is called "${id}"`);
  if (k.raw?.length) return k.raw[0];
  const chord = String(k.keys[0] || ""), at = chord.lastIndexOf("+");
  if (NAMED[chord]) return NAMED[chord];
  const mod = chord.slice(0, at), key = chord.slice(at + 1);
  if (mod === "ctrl" && key.length === 1) return String.fromCharCode(key.charCodeAt(0) & 31);
  if (mod === "alt" && key.length === 1) return `\x1b${key}`;
  throw new Error(`The key "${id}" cannot be pressed from the web board`);
}
// Keys that are the terminal's own: closing the board's terminal, its menu overlay, its text box's editing, and the
// parts of the screen the page lays out itself (the page scrolls, and shows the chat and the task as it has room).
export const TERMINAL_ONLY = ["close", "menu", "newline", "find", "chatMessage", "chatScrollUp", "chatScrollDown", "side", "panel", "up", "down", "pageUp", "pageDown", "free"];

export class WebView extends View {
  constructor({ cwd = lastFolder() } = {}) {
    super(tui, webTheme, () => {}, { cwd, canReload: false, web: true });
    clearInterval(this.timer);
    // The terminal board's draft, filter and put-away words are its own: the web board starts with none.
    this.setValue(""); this.draftAway = null; this.filter = ""; this.mode = "new"; this.side = false; this.full = false; this.chatOpen = true;
    this.webPrefs = path.join(S.dataDir(), "web-view.json");
    const p = S.readJson(this.webPrefs) || {};
    this.byRepo = !!p.byRepo; this.allDone = !!p.allDone; this.scope = String(p.scope || "");
    this.ready = true; this.go = null;
    if (this.all) this.pollRemotes();
    this.load();
  }
  // The terminal's own: not here.
  startSetup() {}
  lookHeld() {}
  askShown() {}
  announce() {}
  takeApprove() {}
  closeHint() {}
  askWebUi() {}
  // The web board keeps its own few choices, in a file of its own: it never writes the terminal board's.
  // While it shows the machine the web UI is on (web-pcs.js), what is kept is what it showed before it went there.
  savePrefs() { if (!this.ready) return; try { S.writeJson(this.webPrefs, { byRepo: this.byRepo, allDone: this.allDone, scope: this.followed !== undefined ? this.followed : this.scope }); } catch {} }
  // Each message is numbered, so a page shows one once however often it asks.
  flash(text, kind) { super.flash(text, kind); this.msgN = (this.msgN || 0) + 1; }
  // What the terminal board does once a second, without the ticking a keeper does anyway.
  look() {
    this.tick++;
    if (this.all && this.tick % 3 === 0) this.pollRemotes();
    try { this.load(); } catch {}
    try { this.syncCoord(); } catch {}
  }
  // A button: the key it stands for, pressed with the text box empty.
  // Words the key puts into the text box (a draft brought back, words taken back to change) are the page's draft.
  press(id) {
    if (TERMINAL_ONLY.includes(id)) return { draft: "" };
    this.setValue(""); this.loneAt = 0; // a button is no input line: no enter of its own follows it (view/keys.js)
    this.handleInput(bytesOf(id));
    const draft = this.value();
    this.setValue("");
    return { draft };
  }
  // What was typed on the page, sent as enter sends it (`delegate`: as tab does). Words the board did not take (an
  // agent that is busy, a task that is gone) stay the page's draft: `kept`.
  // `to`: who the words were typed for ({ id, reply, scope }: a task's agent, or the Coordinator with `reply` false;
  // `scope`: whose board showed then, which decides which machine's Coordinator gets them). The
  // page locks that when the first letter is typed, so a tap on another task while a draft stands moves what you
  // look at and never who gets the words: they are sent to `to`, and the view is put back as it was.
  send(text, delegate = false, to = null) {
    const words = String(text ?? "");
    if (!words.trim()) return { kept: false };
    const back = to ? { sel: this.sel, reply: this.reply, replyId: this.replyId, full: this.full, scope: this.scope } : null;
    if (to) {
      const id = String(to.id || ""), reply = !!to.reply && !!id;
      // The machine the words were typed for: the view goes there for the send, and back. One that is no longer
      // reachable gets nothing, and neither does anyone in its place.
      if (typeof to.scope === "string" && to.scope !== this.scope) {
        if (to.scope && to.scope !== "*" && !this.remotes[to.scope]) { this.flash(`${to.scope} is not among the machines you can reach now. Nothing was sent.`, "yellow"); return { kept: true }; }
        this.scope = to.scope; try { this.load(); } catch {}
      }
      const restore = () => { if (this.scope !== back.scope) { this.scope = back.scope; try { this.load(); } catch {} } };
      if (reply && !this.items.some((r) => r.id === id)) { restore(); this.flash("The task those words were for is gone. Nothing was sent.", "yellow"); return { kept: true }; }
      if (reply) this.sel = id;
      this.reply = reply; this.replyId = reply ? id : "";
    }
    this.setValue(words); this.loneAt = 0;
    this.handleInput(bytesOf(delegate ? "delegate" : "enter"));
    const kept = this.value().trim() === words.trim();
    this.setValue("");
    if (back) { if (this.scope !== back.scope) { this.scope = back.scope; try { this.load(); } catch {} } if (this.onBoard(back.sel)) this.sel = back.sel; this.reply = back.reply; this.replyId = back.reply ? this.sel : ""; this.full = back.full && !!(this.current() || this.job()); try { this.load(); } catch {} }
    return { kept };
  }
  // Tapping a row selects it; `open`: the page shows the whole task, so the selection stays on it while you read.
  pick(id, open = false) {
    // From a firing of the automation that is open: to the task it made, which may be in the archive (autoGo).
    const fromFiring = this.autoOpen && !!this.auto() && !this.autos.some((a) => a.row === id);
    if (fromFiring) { this.autoGo(String(id)); if (this.autoOpen) return; } // still open: that task is gone, and the board said so
    this.stick = ""; this.full = false; this.autoOpen = false; this.autoAt = -1; this.editing = null;
    this.load(); // the task may be newer than the last look
    if (this.onBoard(id)) this.sel = String(id);
    // An automation's row opens the automation, whole; a task's row the task.
    if (this.auto()) this.autoOpen = !!open; else this.full = !!open && !!(this.current() || this.job());
    this.panelTop = 0;
    this.load();
  }
  // The settings page is a part of the open task or automation on the web (settings-model.js): no page of its own.
  // Its key (More: this task's settings) opens the task with that part shown: the page goes to it (`showSettings`).
  editSettings(r) { if (!r || r.title === undefined) return this.flash("Select a task first."); this.full = true; this.panelTop = 0; this.showSettings = (this.showSettings || 0) + 1; }
  autoSettings() { this.autoOpen = true; this.showSettings = (this.showSettings || 0) + 1; }
  // One setting of the open task or automation, changed from the page: a value, or none to put it back to what it
  // would be without its own answer. The board's own save (view/panel-edit.js), so a task or an automation on
  // another machine is changed there, and a refused value is refused in the same words.
  setSetting(id, name, value) {
    const a = this.autoOpen ? this.auto() : null, r = a || this.current();
    if (!r || String(a ? a.row : r.id) !== String(id) || (!a && r.title === undefined)) return this.flash("That task is no longer the one that is open. Nothing was changed.", "yellow");
    if (!S.entryOf(String(name))) throw new Error(`Unknown setting "${name}".`);
    if (a && !this.autoCanSet(a)) return this.flash(`Its settings are changed on ${a.host}: herdr-superwork set <name> <value> --automation "${a.name}"`, "yellow");
    const was = this.editing;
    this.editing = a ? { id: a.id, auto: true, at: 0, typing: "" } : null; // whose settings the save is for
    try { this.editSave(r, String(name), value === undefined || value === null ? undefined : String(value)); } finally { this.editing = was; }
  }
  // The web UI's own machines, and the one it is on: the board follows it there (web-pcs.js).
  seeWeb(web) { try { followWeb(this, web); } catch {} }
  find(text) { this.filter = String(text ?? "").trim().slice(0, 200); this.mode = "new"; this.load(); }
  // Into the agent: on the web that is the web UI's own view of its pane. The task's space is reopened first, as the
  // terminal board does; the page then goes to the link.
  chat(r) {
    if (r.archivedAt) return this.flash(`Archived tasks are read-only. ${K.name("archive")} restores.`, "yellow");
    if (r.host) return webChat(this, r); // on another machine: the web UI's view of that machine's pane (web-pcs.js)
    if (!F.isAgentTask(r)) return this.flash("No agent has been on this yet.", "yellow");
    F.assertLive(r);
    let pane;
    try { pane = D.reopen(r.id).pane; } catch (e) { return this.flash(e.message, "yellow"); }
    let hasAgent = false;
    try { hasAgent = !!herdr(r.link.socket).agentGet(pane.pane_id); } catch {}
    this.stick = r.id;
    this.go = { n: (this.go?.n || 0) + 1, pane: pane.pane_id, workspace: pane.workspace_id, view: hasAgent ? "chat" : "terminal" };
  }
}
