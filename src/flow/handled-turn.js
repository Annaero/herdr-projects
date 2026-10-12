// A turn that is already handled: the same turn seen again, and a task re-armed for a turn that never came.
import * as S from "../store.js";
import { readTurnOf } from "../agents.js";
import { noteStat } from "./git.js";

// ---- a turn that is already handled ------------------------------------------------------------------------------------
// The saved conversation still ends in the message the finish line already handled.
export function sameTurn(t) {
  if (!t.handled?.msg) return false;
  const turn = readTurnOf(t.agent, { file: t.transcript || null, session: t.session, cwd: S.cwdOf(t) });
  return !!turn && turn.id === t.handled.msg;
}
// A task opened for a turn that never came. Versions before the status hook told a late "working" from a new turn
// (hook.js afterHandled) re-armed a turn the moment its finish line had handled it, and nothing would ever move it
// again: it is handed to the human instead (finish.js recoverJob). Only that state qualifies:
//   - nobody is known to have opened the turn. Everything that opens one now says who (turnBy: a reply, a start, or
//     herdr seeing the agent work), so a real turn, however quiet its agent looks, is never taken for this;
//   - it was armed within seconds of the handled turn, which is what a late reading does and a person does not;
//   - herdr counts no turn finished since, and the agent has written nothing since.
const REOPEN_MS = () => (process.env.HERDR_SUPERWORK_REOPEN_MS !== undefined ? Number(process.env.HERDR_SUPERWORK_REOPEN_MS) : 60000);
export function reopened(t, comp) {
  if (t.stage !== "working" || comp == null || !t.handled || comp !== t.handled.comp || !t.turnOpen || t.turnBy || t.expectedWake) return false;
  const gap = (t.armedAt || 0) - (t.handled.at || 0);
  if (!(gap >= 0 && gap <= 15000) || Date.now() - (t.armedAt || 0) < REOPEN_MS()) return false;
  if (t.handled.msg) return sameTurn(t);
  const note = noteStat(t);
  return !!note && note.mtime === t.handled.note;
}
