// The board as a popup, for whoever chose it (`board.open`: popup): herdr's own popup, a framed window in the middle
// of herdr's screen that takes the keyboard and the mouse while it shows, as herdr's menu does. herdr has one popup
// and keeps it with the tab it opened over, so the board never leaves it behind: it closes the moment another tab
// shows. The board key opens it; pressed again, or `esc`, closes it. Where it is, is written down while it runs.
import path from "node:path";
import fs from "node:fs";
import * as S from "../store.js";
import { herdr, currentSocket, sessionName } from "../herdr.js";
import * as Sock from "../herdr-socket.js";

export const wanted = () => { try { return S.setting("board.open") === "popup"; } catch { return false; } };
// The popup is no pane and has no id: this stands for it where a board is named (a line left for it, a question).
export const NAME = "popup";
// How much of herdr's screen it takes. herdr centres it, frames it and never makes it smaller than its own least.
export const SIZE = { width: "90%", height: "90%" };
// In a small window a margin costs half the board: under this many columns or rows of room the popup takes it all.
export const SMALL = { cols: 110, rows: 30 };
// The popup's size for the room the panes have (`area`: herdr's own, from `pane layout`; unknown: the usual size).
export const sizeFor = (area) => (area && (area.width < SMALL.cols || area.height < SMALL.rows) ? { width: "100%", height: "100%" } : SIZE);
const file = (socket) => path.join(S.dataDir(), `board-popup-${sessionName(socket)}.json`);
// Is this board in herdr's popup? herdr gives a popup's program its plugin's id and no pane.
export const inPopup = (env = process.env) => env.HERDR_ENV === "1" && !!env.HERDR_PLUGIN_ID && !env.HERDR_PANE_ID;
// `tab`: the tab it opened over, which is the only one herdr shows it with.
export function arrive(tab, socket = currentSocket(), env = process.env) {
  if (inPopup(env)) { try { S.writeJson(file(socket), { tab: String(tab || ""), pid: process.pid }); } catch {} }
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
// The board's popup that exists: its note, while its board runs (herdr ends the popup with its program) or is still
// starting. A note nobody stands behind is taken away.
function standing(socket) {
  const note = S.readJson(file(socket));
  if (!note) return null;
  if (alive(note.pid) || (!note.pid && Date.now() - note.at < STARTING_MS)) return note;
  try { fs.rmSync(file(socket), { force: true }); } catch {}
  return null;
}
function close(at, socket) {
  try { Sock.popupClose(socket); } catch {}
  if (!at.pid) { try { fs.rmSync(file(socket), { force: true }); } catch {} } // its board never started: nobody else takes the note away
  for (const until = Date.now() + pace.goneMs; Date.now() < until && alive(at.pid); ) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}
// The board key with the popup chosen. `here`: where you are (place.js: context). None is open: opened. It shows
// (herdr gives its keys to the popup, so this is the action run some other way): closed, the toggle (`keep`: left
// open, for a command that needs the board). One is still there with a tab that no longer shows, which its board
// closes by itself within a moment: closed, and opened here. Answers the name of the board that shows now, "" when
// the key closed it. Throws what herdr answered when it would not open one.
export function toggle(here, { socket = currentSocket(), keep = false } = {}) {
  const at = standing(socket);
  if (at) {
    const shows = !here.tab || !at.tab || at.tab === here.tab;
    if (shows && keep) return NAME;
    close(at, socket);
    if (shows) return "";
  }
  let area = null;
  try { area = here.pane ? herdr(socket).paneLayout(here.pane)?.area || null : null; } catch {}
  herdr(socket).openBoardPopup(sizeFor(area));
  try { S.writeJson(file(socket), { tab: here.tab || "", pid: 0, at: Date.now() }); } catch {}
  return NAME;
}
// The popup never stays behind on a tab that does not show: the moment herdr shows another one (a notification
// taken, an agent focused from a command, another window of this session: the popup itself takes every key and click
// of its own window), `gone` is called, which closes the board. herdr tells of a tab from the moment it is asked to,
// and a board takes a moment to start: once it is being told, the board asks whether its tab still shows, so a move
// made while it started closes it as well. Answers what stops the watching.
export function watch(tab, gone, socket = currentSocket(), told = Sock.onTabShown, asked = Sock.askSoon) {
  if (!tab) return () => {};
  let stopped = false;
  const stop = told((shown) => { if (shown !== tab) gone(); }, socket,
    () => asked("tab.get", { tab_id: tab }, (r) => { if (!stopped && r?.tab && r.tab.focused === false) gone(); }, socket));
  return () => { stopped = true; stop(); };
}
// The task whose agent (or reviewer) runs in a pane: the popup opens on the task you were looking at.
export function taskAt(pane, socket = currentSocket()) {
  if (!pane) return null;
  try { return S.list().find((t) => t.link?.socket === socket && (t.link.pane === pane || t.link.reviewer?.pane === pane)) || null; } catch { return null; }
}
