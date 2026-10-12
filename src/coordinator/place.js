// Where the Coordinator lives in herdr: a tab of its own, named `Coordinator`, in the home space (`~`); one still in
// the space of its own it had before is moved there.
//
// Checked on herdr 0.9.3 (docs/checked-on-herdr.md): a space is labelled after the folder of its first tab's pane, so
// the home space is `~` only while that pane sits in the home folder: the space the tab was last put in is remembered.
// `pane move --new-tab --workspace <id> --no-focus` carries a running agent over as it is (same terminal, same
// name), takes no focus, gives the pane a new id, and closes the space it left when that was its last pane.
import os from "node:os";
import { real } from "../flow/spaces.js";
import { get, change, home, pumping } from "./state.js";

export const COORDINATOR_TAB = "Coordinator";
export const HOME_SPACE = "~";
// `space` (the home space it was last in) is kept: it is how that space is found again under another label.
const NOWHERE = { workspace: null, tab: null, pane: null, terminal: null, agent: null, paneWas: null };
export const nowhere = (c) => Object.assign(c, NOWHERE);

// The home space's id: the one labelled `~`, else the one the tab was last in, else a new one. Never a task's space.
export function homeSpace(api, c) {
  const list = api.workspaces().filter((w) => !w.worktree);
  const found = list.find((w) => w.label === HOME_SPACE) || (c?.space && list.find((w) => w.workspace_id === c.space));
  return found ? found.workspace_id : api.workspaceCreate({ cwd: os.homedir() }).workspace.workspace_id;
}
// Not written down (the state file was lost) but there: the pane in the Coordinator's own folder, which nothing else
// chats in. In whatever space it is, under whatever label: the one with an agent running, else one at its shell that is
// alone in a tab named `Coordinator`. A tab of that name anywhere else is yours and left alone.
function adopt(api, socket) {
  const here = api.panes().filter((p) => real(p.cwd) === real(home(socket)));
  const alone = (p) => { const t = api.tabGet(p.tab_id); return t?.label === COORDINATOR_TAB && t.pane_count === 1; };
  return here.find((p) => p.agent) || here.find((p) => api.paneIdle(p.pane_id) && alone(p)) || null;
}
const put = (c, socket, space, pane, was = null) => Object.assign(c, { socket, workspace: null, space, tab: pane.tab_id, pane: pane.pane_id, terminal: pane.terminal_id, paneWas: was });
// Its tab, found or opened: one pane, in its own folder. Returns the pane.
export function openTab(api, socket, env = {}) {
  let pane = adopt(api, socket), old = null;
  if (pane) { const w = api.workspaceGet(pane.workspace_id); if (w?.label === COORDINATOR_TAB && !w.worktree && w.pane_count === 1) old = w.workspace_id; } // still in the space of its own from before
  const space = pane ? pane.workspace_id : homeSpace(api, get(socket));
  if (!pane) {
    const r = api.tabCreate({ workspace: space, cwd: home(socket), label: COORDINATOR_TAB, env });
    pane = r.root_pane || api.panes(space).find((p) => p.tab_id === r.tab?.tab_id);
    if (!pane) { if (r.tab?.tab_id) api.tabClose(r.tab.tab_id); throw new Error("herdr opened no terminal for the Coordinator"); }
  }
  change(socket, (c) => {
    put(c, socket, old ? c.space || null : space, pane);
    if (old) c.workspace = old; // moved over by whoever looks next (moveOver)
    if (!c.run && pane.agent) c.run = { kind: pane.agent }; // found running: its conversation is the newest one in its folder
  });
  return pane;
}
// From before it lived in a tab (`workspace`: the space of its own): the pane is moved into a `Coordinator` tab of the
// home space, with its program running on, and herdr closes the emptied space. Returns the pane where it is now, or
// null when there was none to move. `quiet`: not while a pump is typing into it. Throws when herdr will not move it.
export function moveOver(api, socket, { quiet = false } = {}) {
  let pane = null;
  change(socket, (c) => {
    if (!c.workspace || (quiet && pumping(c))) return false;
    const old = c.pane ? api.paneGet(c.pane) : null;
    if (!old) { nowhere(c); return; } // closed meanwhile: a space still there holds only panes of yours
    const space = homeSpace(api, c);
    pane = api.paneMove(old.pane_id, { workspace: space, label: COORDINATOR_TAB }).pane;
    put(c, socket, space, pane, c.pane);
  });
  return pane;
}
// Close it: its tab, never the home space around it. In the space of its own from before, its pane alone: herdr closes
// that space with its last pane, and one that holds panes of yours stays open with those.
export function closePlace(api, c) {
  if (c.workspace) { if (c.pane) api.paneClose(c.pane); return; }
  if (c.tab && c.pane && api.paneGet(c.pane)?.tab_id === c.tab) api.tabClose(c.tab);
  else if (c.pane) api.paneClose(c.pane);
}
