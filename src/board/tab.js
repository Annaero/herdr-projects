// The board's own tab: named `herdr-superwork` while the board is open full screen in a pane of herdr, and given the
// name it had before when the board closes.
//
// Checked on herdr 0.9.3 (docs/checked-on-herdr.md): a tab's label is plain text, so putting back the old one (`1`
// for a tab never named) leaves the tab as it was.
import path from "node:path";
import * as S from "../store.js";
import { herdr, currentSocket } from "../herdr.js";
import { nameTab } from "../flow/tabs.js";

export const BOARD_TAB = "herdr-superwork";
// The names to put back, by tab: kept on disk, so a board that was killed leaves its tab's old name for the next
// board that opens there. The last few only: a tab's id is never given out again.
const file = () => path.join(S.dataDir(), "board-tabs.json");
const KEPT = 50;
// The herdr pane of a board you started yourself in a terminal, "" when there is none to name: the popup (no pane of
// its own), the plugin's own tab that your board key opens (place.js names that one `board`), a terminal outside
// herdr, and tmux inside herdr (the pane it was started in may be another's by now).
export const boardPane = (env = process.env) => (env.HERDR_ENV === "1" && !env.HERDR_PLUGIN_ID && !env.TMUX ? env.HERDR_PANE_ID || "" : "");
// `pane`: the herdr pane the board runs in, "" when it has none (the popup, a terminal outside herdr): nothing is
// renamed then. Only that pane's own tab is. Returns what `restoreBoardTab` needs, or null.
export function nameBoardTab(pane, socket = currentSocket()) {
  if (!pane) return null;
  try {
    const api = herdr(socket), tab = api.paneGet(pane)?.tab_id, now = tab && api.tabGet(tab);
    if (!now) return null;
    if (now.label !== BOARD_TAB) {
      const all = Object.entries(S.readJson(file(), {}) || {}).filter(([k]) => k !== `${socket}|${tab}`).slice(-(KEPT - 1));
      S.writeJson(file(), Object.fromEntries([...all, [`${socket}|${tab}`, String(now.label ?? "")]]));
      nameTab(api, tab, BOARD_TAB);
    }
    return { socket, tab };
  } catch { return null; }
}
// The board closed: the tab has its old name again, unless you gave it another one meanwhile.
export function restoreBoardTab(named) {
  if (!named) return;
  try {
    const key = `${named.socket}|${named.tab}`, all = S.readJson(file(), {}) || {};
    if (!(key in all)) return;
    const api = herdr(named.socket);
    if (api.tabGet(named.tab)?.label === BOARD_TAB) nameTab(api, named.tab, all[key]);
    delete all[key]; S.writeJson(file(), all);
  } catch {}
}
