// The board: pi-work's screen, powered by herdr. Every row is one task. Type to file one, Tab to put an agent on it.
// Layout and selection rules follow pi-work's view; what differs is forced by "powered by herdr": going into a
// task focuses its agent's real pane (the board exits), and the preview reads that pane through herdr.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as S from "../store.js";
import * as H from "../helpers.js";
import * as C from "../coordinator.js";
import { currentSocket } from "../herdr.js";
import { keeperAlive, tickOnce, codeStamp } from "../keeper.js";
import { DraftEditor } from "./editor.js";
import { clean } from "./view/words.js";
import { asRow } from "./view/states.js";
import { oscClear, Announce } from "./view/osc.js";
import { Size } from "./view/size.js";
import { Setup } from "./view/setup.js";
import { List } from "./view/list.js";
import { Row } from "./view/row.js";
import { Coordinator } from "./view/coordinator.js";
import { Chat } from "./view/chat.js";
import { AgentPane } from "./view/agent-pane.js";
import { Remotes } from "./view/remotes.js";
import { Actions } from "./view/actions.js";
import { Ask } from "./view/ask.js";
import { Keys } from "./view/keys.js";
import { Menu } from "./view/menu.js";
import { Hints } from "./view/hints.js";
import { TextBox } from "./view/textbox.js";
import { Layout } from "./view/layout.js";
import { Panel } from "./view/panel.js";
import { PanelStatus } from "./view/panel-status.js";
import { PanelReviews } from "./view/panel-reviews.js";
import { PanelSettings } from "./view/panel-settings.js";
import { Suggestions } from "./view/suggestions.js";

export { asRow } from "./view/states.js";
export { fitShown } from "./view/size.js";
export { osc, oscClear } from "./view/osc.js";

export class View {
  items = []; rows = []; selectionRows = []; selectionLayout = "";
  sel = ""; top = 0;
  allDone = false; archiveView = false; archiveBack = null; archiveUndo = null;
  // The task panel: beside the list when you have it open (`side`, alt+p) and the window is wide, full screen
  // (`full`) when asked for. Most of the time it is closed, so each row has the width for what it says.
  // `reply` says who the chat at the bottom talks to: the selected task's agent after space (whichever task that is,
  // as you move), the Coordinator otherwise.
  reply = false; replyId = ""; side = false; full = false; panelTop = 0; panelHeight = 1; panelLength = 0; width = 120;
  mode = "new"; menu = null; ask = null; byRepo = false; draftAway = null;
  scope = ""; // whose board you see: "" this machine, "*" every machine, or one other machine by name
  remotes = {}; machinesAt = 0;
  filter = ""; msg = ""; msgKind = "overlay0";
  stick = ""; back = ""; jobs = []; jobTop = 0; tick = 0; disposed = false;
  screens = new Map(); // what an agent's pane shows, read through herdr, cached
  // The chat at the bottom: one place for the Coordinator and for every task's agent. `chatOpen`: whether its latest
  // message shows above the text box.
  chatOpen = true; coord = { state: "none", queue: 0, said: "" };
  sent = new Map(); setup = null;
  justSent = new Map(); // what you just sent to a task's agent, until that agent says something new

  constructor(tui, theme, done, ctx) {
    this.tui = tui; this.theme = theme; this.done = done; this.ctx = ctx;
    this.input = new DraftEditor(tui, theme);
    this.prefs = path.join(S.dataDir(), "view.json");
    const prefs = S.readJson(this.prefs) || {};
    // Opened from the Coordinator's own pane (you went into it and came back): its folder is nobody's repo. The board
    // is where it was when you left it, so the draft that comes back is still sent from the repo it was typed in.
    try { if (C.inHome(ctx.cwd)) ctx.cwd = prefs.cwd && fs.existsSync(prefs.cwd) ? prefs.cwd : os.homedir(); } catch {}
    this.byRepo = !!prefs.byRepo; this.side = !!prefs.side; this.scope = String(prefs.scope || ""); this.told = Number(prefs.told) || 0;
    // The board closes each time you open an agent: selection, filter and draft come back when it reopens.
    this.sel = String(prefs.sel || ""); this.filter = String(prefs.filter || ""); if (prefs.draft) this.input.setText(String(prefs.draft));
    // So do words that were put away: ctrl+z still brings them back after the board closed or reloaded itself.
    if (prefs.away && prefs.away.text) this.draftAway = { text: String(prefs.away.text), to: String(prefs.away.to || "") };
    this.chatOpen = prefs.chat !== "closed";
    if (this.all) this.pollRemotes();
    this.repo = S.repoOf(ctx.cwd);
    try { this.canDispatch = C.ready(); } catch { this.canDispatch = false; }
    this.load();
    try { this.syncCoord(); } catch {}
    try { this.takeApprove(); } catch {}
    try { this.stamp = codeStamp(); } catch {}
    try { this.startSetup(); } catch {}
    this.lookHeld();
    this.timer = setInterval(() => this.beat(), 1000);
    this.askShown();
  }
  get all() { return this.scope !== ""; }
  // Nothing of yours is open or half typed: the board can be swapped for its new version without losing anything.
  get atRest() { return !this.value() && !this.ask && !this.menu && !this.setup && !this.pasteText && this.mode === "new"; }
  beat() {
    this.tick++;
    if (this.tick % 2 === 0) this.askShown();
    if (this.all && this.tick % 5 === 0) this.pollRemotes();
    // With a keeper alive the board only looks: the keeper polls, watches and alerts. Without one the board does all
    // of it itself, as it always did, so a missing keeper never makes the board worse.
    if (!keeperAlive()) { try { tickOnce(currentSocket(), { watch: (rows) => H.watchTick(rows.map(asRow)) }); } catch {} }
    // An open board keeps running the code it started with. When the plugin changed underneath it, it loads the new
    // version by itself: once the files have stopped changing, and only while nothing of yours is half typed.
    if (this.tick % 5 === 0 && this.stamp) {
      try {
        const now = codeStamp();
        if (now !== this.stamp) { const settled = this.stale === now; this.stale = now; if (settled && this.atRest && this.ctx.canReload !== false) return this.done({ reload: true }); }
        else this.stale = "";
      } catch {}
    }
    // The Coordinator can be turned on or off (a setting, herdr starting) while the board is open.
    if (this.tick % 5 === 0) { try { this.canDispatch = C.ready(); } catch {} }
    if (this.tick % 5 === 0) this.lookHeld();
    try { this.load(); } catch {}
    try { this.takeApprove(); } catch {}
    try { this.syncCoord(); } catch {}
    try { this.announce(); } catch {}
    this.tui.requestRender();
  }
  dispose() { this.disposed = true; clearInterval(this.timer); this.closeSoon(); this.savePrefs(); if (this.sent.size) { try { process.stdout.write([...this.sent.keys()].map(oscClear).join("")); } catch {} } }
  invalidate() { this.input.invalidate(); }
  get focused() { return this.input.focused; }
  set focused(value) { this.input.focused = value; }
  savePrefs() { try { S.writeJson(this.prefs, { byRepo: this.byRepo, side: this.side, scope: this.scope, sel: this.sel, filter: this.filter, told: this.told, draft: this.mode === "new" && !this.reply ? this.value() : "", chat: this.chatOpen ? "open" : "closed", cwd: this.ctx.cwd, away: this.mode === "new" && this.reply && this.value().trim() ? { text: this.value(), to: this.replyId } : this.draftAway }); } catch {} }
  // A message stays until the next key press; an error stays until esc dismisses it.
  flash(text, kind = "overlay0") { this.msg = clean(text); this.msgKind = kind; }
  value() { return this.input.getText(); }
  setValue(v) { this.input.setText(v); }
  current() { return this.items.find((r) => r.id === this.sel); }
  job() { return this.jobs.find((j) => j.id === this.sel); }
  try(fn) { let ok = true; try { fn(); } catch (e) { ok = false; this.flash(e.message, "red"); } this.load(); return ok; }
}

// The rest of the board is in view/, one file per area (docs/where-things-live.md says which). Each is a class only so
// that its methods read as View's own; they are copied onto View here, so `this` is the one View everywhere.
// One part per line: a new part is one new line beside the parts it belongs with, never at the end.
const PARTS = [
  Announce,
  Size,
  Setup,
  List,
  Row,
  Coordinator,
  Chat,
  AgentPane,
  Remotes,
  Actions,
  Ask,
  Keys,
  Menu,
  Hints,
  TextBox,
  Layout,
  Panel,
  PanelStatus,
  PanelReviews,
  PanelSettings,
  Suggestions,
];
for (const part of PARTS) {
  for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(part.prototype))) if (name !== "constructor") Object.defineProperty(View.prototype, name, d);
}
