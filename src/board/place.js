// The board that is running in herdr: where it is, written down while it runs, so that opening the board from
// anywhere in herdr goes back to that one instead of starting a second one. The board key opens it in a tab of its
// own, an ordinary pane like one you start it in yourself: it stays when you go into an agent. Pressed on that board
// itself, the key goes back to where you came from. (Whoever chose the popup gets that instead: popup.js.)
import path from "node:path";
import fs from "node:fs";
import * as S from "../store.js";
import { herdr, currentSocket, sessionName } from "../herdr.js";
import * as Popup from "./popup.js";
import { say } from "./say.js";

const file = (socket) => path.join(S.dataDir(), `board-pane-${sessionName(socket)}.json`);
// The herdr pane this board runs in, to come back to. None outside herdr, none in herdr's floating popup, which is
// no pane, and none for the popup the board key opens: that one is closed and opened, never gone back to.
export const ownPane = (env = process.env) => (env.HERDR_ENV === "1" && !Popup.overPane(env) ? env.HERDR_PANE_ID || "" : "");
// Is this board a popup? The one the board key opens in herdr's overlay (popup.js), or herdr's floating popup, when
// someone opens the plugin's pane that way by hand (herdr gives that one its plugin's id and no pane). Either lies
// over the panes of its tab, so it is the board that closes for an agent.
export const inPopup = (env = process.env) => !!Popup.overPane(env) || (!!env.HERDR_PLUGIN_ID && !env.HERDR_PANE_ID);
// Where you are, as herdr tells a plugin's command and a plugin's pane: the pane that has the keyboard and its tab.
export function context(env = process.env) {
  try { const c = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON || "{}"); return { pane: String(c.focused_pane_id || ""), tab: String(c.tab_id || "") }; }
  catch { return { pane: "", tab: "" }; }
}
// `from`: the pane you came to the board from. A board the key opened knows it from herdr; a board that loads its
// new version in the same pane keeps what was written down since.
export function arrive(pane = ownPane(), socket = currentSocket(), env = process.env) {
  if (!pane) return;
  try {
    const old = S.readJson(file(socket)), came = env.HERDR_PLUGIN_ID ? context(env).pane : "";
    const from = old?.pane === pane && old.from ? old.from : came !== pane ? came : "";
    S.writeJson(file(socket), { pane, pid: process.pid, ...(from ? { from } : {}) });
  } catch {}
}
// Only the board that wrote the note takes it away: another one may have started in the meantime.
export function depart(socket = currentSocket()) {
  try { if (S.readJson(file(socket))?.pid === process.pid) fs.rmSync(file(socket), { force: true }); } catch {}
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// herdr shows this pane: its space, its tab, and the keyboard on it (another pane of that tab may have had it: the
// agent's own, when the two share a tab).
function goTo(api, pane) {
  api.workspaceFocus(pane.workspace_id);
  try { api.tabFocus(pane.tab_id); } catch {}
  try { api.paneFocus(pane.pane_id); } catch {}
}
// The board that runs in a pane of this herdr: its note and its pane as herdr has it. Null when none does, or its
// pane is gone: the caller opens one then.
function running(socket) {
  const note = S.readJson(file(socket));
  if (!note?.pane || !alive(note.pid)) return null;
  try { const api = herdr(socket), pane = api.paneGet(note.pane); return pane ? { api, note, pane } : null; } catch { return null; }
}
// Go to the running board. False when there is none.
export function goBack(socket = currentSocket()) {
  const at = running(socket);
  if (!at) return false;
  try { goTo(at.api, at.pane); return true; } catch { return false; }
}
// The key pressed on the board itself: back to the pane you came from. With none to go back to (the board was
// started by hand, or that pane is closed) the board says that it is the board, so the key never looks dead.
function leave(at, socket) {
  let back = null;
  try { back = at.note.from ? at.api.paneGet(at.note.from) : null; } catch {}
  if (back) { try { goTo(at.api, back); return; } catch {} }
  say(at.note.pane, "This is the board already. There is no pane to go back to.", "overlay0", socket);
}
// What herdr answered when it would not open the popup, in plain words.
const why = (e) => (e?.code === "ui_busy"
  ? "herdr has another popup open, maybe hidden behind another tab, and shows one at a time. Close that one for the board's popup"
  : `herdr did not open the popup (${String(e?.message || e?.code || "no reason given").replace(/\s+/g, " ").slice(0, 120)})`);
// Opening the board from anywhere in herdr (your key, an action). In a tab (`board.open`, the built-in choice): the
// one that is running, else a new one in a tab of its own, named so you can tell it from the others; pressed on the
// board itself, back to where you came from. As a popup: popup.js, and when herdr will not open one, the tab, which
// says why. `keep`: the board is needed, so the key's way back and the popup's toggle are off. Answers the pane of
// the board that shows now, "" when there is none.
export function show(socket = currentSocket(), { keep = false, here = context() } = {}) {
  let told = "";
  if (Popup.wanted()) {
    try { return Popup.toggle(here, { socket, keep }); } catch (e) { told = `${why(e)}. Until then the board is here, in a tab.`; keep = true; }
  }
  const at = running(socket);
  if (at) {
    if (!keep && here.pane === at.note.pane) { leave(at, socket); return at.note.pane; }
    if (here.pane && here.pane !== at.note.pane && here.pane !== at.note.from) { try { S.writeJson(file(socket), { ...at.note, from: here.pane }); } catch {} }
    try { goTo(at.api, at.pane); } catch {}
    say(at.note.pane, told, "yellow", socket);
    return at.note.pane;
  }
  const api = herdr(socket);
  const pane = api.openBoard();
  if (!pane?.tab_id) return "";
  api.tabRename(pane.tab_id, "board");
  try { goTo(api, pane); } catch {}
  say(pane.pane_id, told, "yellow", socket);
  return pane.pane_id;
}
