// Opens the board: full screen in the current terminal, which in herdr is a pane, the plugin's own tab included.
import { TuiAltScreen, ProcessTerminal } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { stopKeepingScreen, keptEnv, startOnKeptScreen, giveScreenBack } from "./reload-screen.js";
import { View } from "./view.js";
import { theme, loadTheme, askTerminal, setTerminal } from "./theme.js";
import { ensureKeeper } from "../keeper.js";
import * as F from "../flow.js";
import * as S from "../store.js";
import { userEnv } from "../runner.js";
import { boardPane, nameBoardTab, restoreBoardTab } from "./tab.js";
import * as P from "./place.js";
import * as Popup from "./popup.js";

export async function openBoard({ folder }) {
  userEnv(); // the popup starts with herdr's server environment: helpers and git need the user's PATH
  // herdr's theme. The terminal is asked for its own text and background colours: the greys are made readable on
  // them (greys.js), and a theme that follows the terminal's appearance takes its light or dark one.
  try { loadTheme(); const t = await askTerminal(); setTerminal(t.light, t); } catch {}
  // The board opening is one of the keeper's starters; the how-to files are refreshed here too.
  try { ensureKeeper(); } catch {}
  let boardKey = "", ownKey = null;
  try { const X = await import("../extras.js"); X.syncSkill(F.shim()); X.removePopups(); X.refreshSidebar(); boardKey = X.boardKey(); ownKey = X.boardPresses(); } catch {}
  // A board that has reloaded itself a few times in a row stops doing so: something keeps changing its files.
  const reloads = Number(process.env.HERDR_SUPERWORK_RELOADS) || 0;
  const named = nameBoardTab(boardPane());
  return new Promise((resolve) => {
    // The mouse is asked for, for its wheel (view/mouse.js). With it on, herdr and the terminal no longer select text
    // in the board themselves, so pi-tui does: drag selects, and letting go copies it (docs/mouse.md).
    const tui = new TuiAltScreen(new ProcessTerminal(), { mouse: true, wheelScrollLines: "auto" });
    let view, unwatch = () => {};
    const done = (result) => {
      try { view.dispose(); } catch {}
      // Closing leaves nothing behind: the screen's own stop would print the board's last frame once more on the plain
      // screen, above your prompt. The same way out a reload takes, and then the full-screen view is left for good.
      try { stopKeepingScreen(() => tui.stop()); if (!result?.reload) giveScreenBack(); } catch {}
      if (!result?.reload) restoreBoardTab(named); // the board that starts in its place closes in this tab too
      try { unwatch(); P.depart(); Popup.depart(); } catch {}
      // The plugin was updated under an open board: the same command starts again on the new code, in this terminal,
      // and this process only waits for it. Selection, filter and draft were saved a line above.
      if (result && result.reload) {
        try { process.stdin.pause(); } catch {}
        const child = spawn(process.execPath, process.argv.slice(1), { stdio: "inherit", env: { ...process.env, ...keptEnv(), HERDR_SUPERWORK_RELOADS: String(reloads + 1) } });
        for (const sig of ["SIGTERM", "SIGHUP"]) { process.removeAllListeners(sig); process.on(sig, () => { try { child.kill(sig); } catch {} }); }
        child.on("error", () => { giveScreenBack(); process.exit(1); });
        child.on("exit", (code) => { if (code) giveScreenBack(); process.exit(code ?? 0); });
        return;
      }
      resolve();
      // The watcher's helper calls are detached and must not keep the popup open.
      setTimeout(() => process.exit(0), 20);
    };
    view = new View(tui, theme, done, { cwd: folder, leaveMs: 700, settleMs: 1000, boardKey, canReload: reloads < 5, popup: P.inPopup(), from: P.context().pane, ownKey, ownPane: P.ownName(), pane: process.env.HERDR_ENV === "1" && !process.env.TMUX ? process.env.HERDR_PANE_ID || "" : "" });
    { const moved = S.moveNote(); if (moved) { view.flash(moved, "green"); S.moveTold(); } } // the one-time move, said once
    tui.addChild(view);
    tui.setFocus(view);
    for (const sig of ["SIGTERM", "SIGHUP"]) process.on(sig, done);
    startOnKeptScreen(); // after a reload the old board's frame is still up: drawn over, not cleared first
    tui.start();
    P.arrive(); Popup.arrive(P.context().tab);
    // herdr keeps its popup with the tab it opened over: this board closes when another one shows (popup.js).
    if (P.inPopup()) unwatch = Popup.watch(P.context().tab, () => { unwatch(); done(); });
  });
}
