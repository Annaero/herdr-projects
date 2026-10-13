// The board as herdr's popup, for whoever chose it (`board.open`: popup): a plugin pane in herdr's overlay, which
// lies over the tab you are in. The board key opens it, closes it when pressed again, and takes away one left
// behind over another tab; where it is, is written down while it runs, apart from the note of a board in a tab.
import path from "node:path";
import fs from "node:fs";
import * as S from "../store.js";
import { herdr, currentSocket, sessionName } from "../herdr.js";

// Set on the board the key opens in the overlay: herdr tells a program nothing about how its pane was placed.
export const POPUP_ENV = "HERDR_SUPERWORK_POPUP";
export const wanted = () => { try { return S.setting("board.open") === "popup"; } catch { return false; } };
const file = (socket) => path.join(S.dataDir(), `board-popup-${sessionName(socket)}.json`);
// The overlay pane this board runs in, "" for every other board.
export const overPane = (env = process.env) => (env.HERDR_ENV === "1" && env[POPUP_ENV] === "1" ? env.HERDR_PANE_ID || "" : "");
export function arrive(pane = overPane(), socket = currentSocket()) {
  if (pane) { try { S.writeJson(file(socket), { pane, pid: process.pid }); } catch {} }
}
export function depart(socket = currentSocket()) {
  try { if (S.readJson(file(socket))?.pid === process.pid) fs.rmSync(file(socket), { force: true }); } catch {}
}
const alive = (pid) => { if (!(pid > 0)) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// A popup herdr has just opened is written down at once, before its board has started: the key pressed twice in a
// row closes that one, and never opens a second over it.
const STARTING_MS = 10000;
// How long a closed popup's board is waited for: it saves what you typed as it ends, and the next one reads that.
export const pace = { goneMs: 2000 };
// The popup that exists, shown or hidden: its pane as herdr has it. A note nobody stands behind is taken away.
function standing(api, socket) {
  const note = S.readJson(file(socket));
  if (!note?.pane) return null;
  let pane = null;
  try { if (alive(note.pid) || (!note.pid && Date.now() - note.at < STARTING_MS)) pane = api.paneGet(note.pane); } catch {}
  if (!pane) { try { fs.rmSync(file(socket), { force: true }); } catch {} return null; }
  return { pane, pid: note.pid };
}
function close(api, at, socket) {
  try { api.pluginPaneClose(at.pane.pane_id); } catch {}
  if (!at.pid) { try { fs.rmSync(file(socket), { force: true }); } catch {} } // its board never started: nobody else takes the note away
  for (const until = Date.now() + pace.goneMs; Date.now() < until && alive(at.pid); ) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}
// The board key with the popup chosen. `here`: where you are (place.js: context). It shows over this tab: closed,
// the toggle (`keep`: left open, for a command that needs the board). It was left over another tab, where herdr
// hides it: closed there and opened here. None: opened. Answers the pane of the board that shows now, "" when the
// key closed it. Throws what herdr answered when it would not open one.
export function toggle(here, { socket = currentSocket(), keep = false } = {}) {
  const api = herdr(socket);
  const at = standing(api, socket);
  if (at) {
    const shows = here.tab ? at.pane.tab_id === here.tab : !!at.pane.focused;
    if (shows && keep) return at.pane.pane_id;
    close(api, at, socket);
    if (shows) return "";
  }
  const pane = api.openBoardOver({ [POPUP_ENV]: "1" })?.pane_id || "";
  if (pane) { try { S.writeJson(file(socket), { pane, pid: 0, at: Date.now() }); } catch {} }
  return pane;
}
// The task whose agent (or reviewer) runs in a pane: the popup opens on the task you were looking at.
export function taskAt(pane, socket = currentSocket()) {
  if (!pane) return null;
  try { return S.list().find((t) => t.link?.socket === socket && (t.link.pane === pane || t.link.reviewer?.pane === pane)) || null; } catch { return null; }
}
