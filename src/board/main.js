// Opens the board: full screen in the current terminal, or inside herdr's popup when run as the plugin's pane.
import { TuiAltScreen, ProcessTerminal } from "@earendil-works/pi-tui";
import { View } from "./view.js";
import { theme, detectLight, setLight } from "./theme.js";
import { ensureKeeper } from "../keeper.js";
import * as F from "../flow.js";
import { userEnv } from "../runner.js";

export async function openBoard({ folder }) {
  userEnv(); // the popup starts with herdr's server environment: helpers and git need the user's PATH
  try { setLight(!!(await detectLight())); } catch {}
  // The board opening is one of the keeper's starters; the how-to files are refreshed here too.
  try { ensureKeeper(); } catch {}
  try { const X = await import("../extras.js"); X.syncSkill(F.shim()); } catch {}
  return new Promise((resolve) => {
    const tui = new TuiAltScreen(new ProcessTerminal(), { mouse: false });
    let view;
    const done = () => {
      try { view.dispose(); } catch {}
      try { tui.stop(); } catch {}
      resolve();
      // The watcher's helper calls are detached and must not keep the popup open.
      setTimeout(() => process.exit(0), 20);
    };
    view = new View(tui, theme, done, { cwd: folder });
    tui.addChild(view);
    tui.setFocus(view);
    for (const sig of ["SIGTERM", "SIGHUP"]) process.on(sig, done);
    tui.start();
  });
}
