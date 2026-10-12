// Opens the board: full screen in the current terminal, which in herdr is a pane, the plugin's own tab included.
import { TuiAltScreen, ProcessTerminal } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { View } from "./view.js";
import { theme, loadTheme, askTerminal, setTerminal } from "./theme.js";
import { ensureKeeper } from "../keeper.js";
import * as F from "../flow.js";
import { userEnv } from "../runner.js";
import { boardPane, nameBoardTab, restoreBoardTab } from "./tab.js";
import * as P from "./place.js";

export async function openBoard({ folder }) {
  userEnv(); // the popup starts with herdr's server environment: helpers and git need the user's PATH
  try { if (loadTheme()) { const t = await askTerminal(); setTerminal(t.light); } } catch {} // herdr's theme; the terminal is asked only when the theme follows its appearance
  // The board opening is one of the keeper's starters; the how-to files are refreshed here too.
  try { ensureKeeper(); } catch {}
  let boardKey = "";
  try { const X = await import("../extras.js"); X.syncSkill(F.shim()); X.removePopups(); boardKey = X.boardKey(); } catch {}
  // A board that has reloaded itself a few times in a row stops doing so: something keeps changing its files.
  const reloads = Number(process.env.HERDR_SUPERWORK_RELOADS) || 0;
  const named = nameBoardTab(boardPane());
  return new Promise((resolve) => {
    const tui = new TuiAltScreen(new ProcessTerminal(), { mouse: false });
    let view;
    const done = (result) => {
      try { view.dispose(); } catch {}
      try { tui.stop(); } catch {}
      if (!result?.reload) restoreBoardTab(named); // the board that starts in its place closes in this tab too
      try { P.depart(); } catch {}
      // The plugin was updated under an open board: the same command starts again on the new code, in this terminal,
      // and this process only waits for it. Selection, filter and draft were saved a line above.
      if (result && result.reload) {
        try { process.stdin.pause(); } catch {}
        const child = spawn(process.execPath, process.argv.slice(1), { stdio: "inherit", env: { ...process.env, HERDR_SUPERWORK_RELOADS: String(reloads + 1) } });
        for (const sig of ["SIGTERM", "SIGHUP"]) { process.removeAllListeners(sig); process.on(sig, () => { try { child.kill(sig); } catch {} }); }
        child.on("error", () => process.exit(1));
        child.on("exit", (code) => process.exit(code ?? 0));
        return;
      }
      resolve();
      // The watcher's helper calls are detached and must not keep the popup open.
      setTimeout(() => process.exit(0), 20);
    };
    view = new View(tui, theme, done, { cwd: folder, leaveMs: 700, boardKey, canReload: reloads < 5, popup: P.inPopup(), pane: process.env.HERDR_ENV === "1" && !process.env.TMUX ? process.env.HERDR_PANE_ID || "" : "" });
    tui.addChild(view);
    tui.setFocus(view);
    for (const sig of ["SIGTERM", "SIGHUP"]) process.on(sig, done);
    tui.start();
    P.arrive();
  });
}
