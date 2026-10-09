// Opens the board: full screen in the current terminal, or inside herdr's popup when run as the plugin's pane.
import { TuiAltScreen, ProcessTerminal } from "@earendil-works/pi-tui";
import { View } from "./view.js";
import { theme } from "./theme.js";
import { userEnv } from "../runner.js";

export function openBoard({ folder }) {
  userEnv(); // the popup starts with herdr's server environment: helpers and git need the user's PATH
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
