// Live readings: a task as herdr sees it right now, and the board's list made from them.
import * as S from "../store.js";
import { herdr, currentSocket, sessionName, socketExists } from "../herdr.js";
import { show } from "../state.js";
import { isAgentTask } from "./task.js";

// ---- live readings ---------------------------------------------------------------------------------------------------
// One `agent list` and one `pane list` per herdr session answer for every task on the board.
export function readSession(socket) {
  if (!socketExists(socket)) return { down: true };
  try {
    const api = herdr(socket);
    const agents = new Map(api.agents().map((a) => [a.pane_id, a]));
    const panes = new Map(api.panes().map((p) => [p.pane_id, p]));
    return { agents, panes };
  } catch (e) { return { down: true, error: e }; }
}
export function liveOf(t, session, here = currentSocket()) {
  if (!isAgentTask(t)) return undefined;
  if (t.link.socket && t.link.socket !== here) return { away: sessionName(t.link.socket) };
  if (!session || session.down) return { down: true };
  const pane = session.panes.get(t.link.pane);
  if (!pane) return { gone: true };
  const a = session.agents.get(t.link.pane);
  return a ? { status: a.agent_status, agent: a, pane } : { status: null, pane };
}
// A task as the board and `list` show it: the task plus its derived state.
export function shown(t, session, here) {
  const live = liveOf(t, session, here);
  const pending = isAgentTask(t) && S.pendingText(t.id).length > 0;
  return { ...t, live, ...pick(show({ ...t, pendingText: pending }, live)) };
}
// Names that cannot collide with a task's own fields (a task has its own `review` and `msg`).
const pick = (s) => ({ state: s.state, kind: s.kind, note: s.msg, shownApp: s.app, progress: s.progress, eta: s.eta, asReview: !!s.review, stale: s.stale, exited: s.exited });
// This machine's tasks as one herdr session sees them (the keeper serves several sessions from one data folder).
export function boardFor(socket) {
  const tasks = S.list();
  const session = tasks.some((t) => isAgentTask(t) && t.link.socket === socket) ? readSession(socket) : null;
  return tasks.map((t) => shown(t, session, socket));
}
export function board({ includeArchived = false } = {}) {
  const here = currentSocket();
  const tasks = S.list({ includeArchived });
  const session = tasks.some((t) => isAgentTask(t) && t.link.socket === here) ? readSession(here) : null;
  return tasks.map((t) => shown(t, session, here));
}
// Refuse a live action with the reason the board shows.
export function assertLive(t) {
  if (!isAgentTask(t)) throw new Error(`No agent has been on ${t.id} yet. Delegate it first.`);
  const here = currentSocket();
  if (t.link.socket !== here) throw new Error(`${t.id} lives in herdr session ${sessionName(t.link.socket)}. Open the board there.`);
  if (!socketExists(here) || !herdr(here).alive()) throw new Error("herdr is not running.");
}

// The terminals a task's agent has been read in, oldest first. herdr gives a pane a new terminal_id when it restarts
// and never an old one again, so a reading from any terminal but the newest was taken before that restart. Returns
// false for such a reading; a terminal not seen before becomes the newest.
export function seeTerminal(t, term) {
  if (!term) return true;
  const seen = t.terms || [t.handled?.term || t.link?.terminal].filter(Boolean);
  if (seen.includes(term)) { if (seen.at(-1) !== term) return false; }
  else seen.push(term);
  t.terms = seen.slice(-8);
  return true;
}
