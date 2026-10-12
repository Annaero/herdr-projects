// The board that is running in herdr: where it is, written down while it runs, so that opening the board from
// anywhere in herdr goes back to that one instead of starting a second one. The board key opens it in a tab of its
// own, an ordinary pane like one you start it in yourself: it stays when you go into an agent.
import path from "node:path";
import fs from "node:fs";
import * as S from "../store.js";
import { herdr, currentSocket, sessionName } from "../herdr.js";

const file = (socket) => path.join(S.dataDir(), `board-pane-${sessionName(socket)}.json`);
// The herdr pane this board runs in. None outside herdr, and none in herdr's popup, which is no pane.
export const ownPane = (env = process.env) => (env.HERDR_ENV === "1" ? env.HERDR_PANE_ID || "" : "");
// Is this board in herdr's popup? (Only when someone opens the plugin's pane that way by hand: herdr gives a popup
// its plugin's id and no pane.) A popup lies over every pane, so it is the one board that closes for an agent.
export const inPopup = (env = process.env) => !!env.HERDR_PLUGIN_ID && !env.HERDR_PANE_ID;
export function arrive(pane = ownPane(), socket = currentSocket()) {
  if (pane) { try { S.writeJson(file(socket), { pane, pid: process.pid }); } catch {} }
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
// Go to the running board. False when no board runs in a pane of this herdr, or its pane is gone: the caller opens
// one then.
export function goBack(socket = currentSocket()) {
  const note = S.readJson(file(socket));
  if (!note?.pane || !alive(note.pid)) return false;
  try {
    const api = herdr(socket);
    const pane = api.paneGet(note.pane);
    if (!pane) return false;
    goTo(api, pane);
    return true;
  } catch { return false; }
}
// Opening the board from anywhere in herdr (your key, an action): the one that is running, else a new one in a tab
// of its own, named so you can tell it from the others.
export function show(socket = currentSocket()) {
  if (goBack(socket)) return;
  const api = herdr(socket);
  const pane = api.openBoard();
  if (!pane?.tab_id) return;
  api.tabRename(pane.tab_id, "board");
  try { goTo(api, pane); } catch {}
}
