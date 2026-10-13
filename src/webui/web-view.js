// The board with no terminal: the same View the terminal board is (its list, its selection, its questions, its
// actions, its words), opened for a web page. Nothing is drawn here and nothing is decided here: a button on the page
// presses the key it stands for (`press`), and what is typed is sent as enter or tab would send it (`send`). What is
// left out is only what belongs to a terminal: the first-run screen, the pane's size, the OSC lines, the timer (the
// page asks), and going into an agent, which on the web is a link to the web UI's own view of that pane (`go`).
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

// From here on the board's words name a key as its button on the page.
K.nameAsButtons();
const tui = { terminal: { rows: 200, columns: 400 }, requestRender() {}, stop() {}, start() {} };
// Where the web board is "in": the repo the terminal board was last opened in, else the home folder.
const lastFolder = () => { const cwd = (S.readJson(path.join(S.dataDir(), "view.json")) || {}).cwd; try { if (cwd && fs.existsSync(cwd)) return cwd; } catch {} return os.homedir(); };

// What a terminal sends for a key of the board (src/board/keys.js), so a button presses exactly that key.
const NAMED = { enter: "\r", return: "\r", tab: "\t", escape: "\x1b", up: "\x1b[A", down: "\x1b[B" };
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
export const TERMINAL_ONLY = ["close", "menu", "newline", "find", "chatMessage", "chatScrollUp", "chatScrollDown", "side", "panel", "up", "down"];

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
  savePrefs() { if (!this.ready) return; try { S.writeJson(this.webPrefs, { byRepo: this.byRepo, allDone: this.allDone, scope: this.scope }); } catch {} }
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
    this.setValue("");
    this.handleInput(bytesOf(id));
    const draft = this.value();
    this.setValue("");
    return { draft };
  }
  // What was typed on the page, sent as enter sends it (`delegate`: as tab does). Words the board did not take (an
  // agent that is busy, a task that is gone) stay the page's draft: `kept`.
  send(text, delegate = false) {
    const words = String(text ?? "");
    if (!words.trim()) return { kept: false };
    this.setValue(words);
    this.handleInput(bytesOf(delegate ? "delegate" : "enter"));
    const kept = this.value().trim() === words.trim();
    this.setValue("");
    return { kept };
  }
  // Tapping a row selects it; `open`: the page shows the whole task, so the selection stays on it while you read.
  pick(id, open = false) {
    this.stick = ""; this.full = false;
    this.load(); // the task may be newer than the last look
    if ([...this.items, ...this.jobs].some((r) => r.id === id)) this.sel = String(id);
    this.full = !!open && !!(this.current() || this.job()); this.panelTop = 0;
    this.load();
  }
  find(text) { this.filter = String(text ?? "").trim().slice(0, 200); this.mode = "new"; this.load(); }
  // Into the agent: on the web that is the web UI's own view of its pane. The task's space is reopened first, as the
  // terminal board does; the page then goes to the link.
  chat(r) {
    if (r.archivedAt) return this.flash(`Archived tasks are read-only. ${K.name("archive")} restores.`, "yellow");
    if (r.host) return this.flash(`Its agent runs on ${r.host}. Open that machine in the web UI to see it.`, "yellow");
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
