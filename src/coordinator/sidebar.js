// The Coordinator in herdr's sidebar: named `Coordinator`, standing as the line above the board's box says, with its last message under it.
import * as S from "../store.js";
import { currentSocket, sessionName, socketExists } from "../herdr.js";
import { tellPane } from "../flow/sidebar.js";
import { coordinatorEntry } from "../flow/sidebar-entry.js";
import { get } from "./state.js";
import { look } from "./look.js";

// herdr names its pane after the agent's inner name (`sw-coordinator`) and reads a finished turn as `done`: the
// board says `Coordinator` and `idle`. Written like a task's entry (flow/sidebar.js), by whoever ticks, and only
// when a word changed. Looked at every other second: a look reads herdr and the end of its conversation.
export function tellSidebar(socket = currentSocket()) {
  const c = get(socket);
  if (!c?.pane || !socketExists(socket) || !S.due(`coordinator-sidebar-${sessionName(socket)}`, 2000)) return;
  const v = look(socket);
  if (v.pane && v.status) tellPane(socket, v.pane, coordinatorEntry(v), v.agent); // `v.agent`: herdr's reading, so a restarted herdr gets it again
}
