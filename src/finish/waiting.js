// An agent that stopped to wait for the human: the end of that turn is not a finish, so no check, no review, no
// push and no merge follow it.
// The agent says that it waits with `report --state blocked` (actions/filing.js), in the turn it then ends. That end
// reaches the board twice, in no fixed order: herdr sees the pane at rest (hook.js), and the agent's own turn-end
// report starts the finish line. Whichever came second used to find the mark gone and took the turn for a new one,
// the human's, and reviewed it. So the turn is known by what it is, not by who saw it first: it began before the
// agent said that it waits, and ended after. A turn that began later is the human's answer being worked on, and its
// end is a finish like any other.
import * as S from "../store.js";
import * as R from "../research.js";
import { readTurnOf } from "../agents.js";
import { artifactBase } from "../review-page.js";

// The saved conversation says when the turn began (agents/read-turn.js); where it cannot be read, only the mark is left.
// Only the end of that file is read as a rule, and a long turn (a large tool result, hours of work) has its prompt
// further back: then the whole file is read for it, this once. No prompt in all of it: none since the agent said it waits.
function began(t, turn) {
  if (turn.began > 0) return turn.began;
  const all = readTurnOf(t.agent, { file: turn.file, whole: true });
  return all && all.id === turn.id ? all.began : null;
}
function sameTurn(t, turn) {
  if (!t.blocked?.at || !turn?.finished || !(turn.pos >= t.blocked.at)) return false;
  const at = began(t, turn);
  return at !== null && at < t.blocked.at;
}
// Does this turn's end leave the task waiting for the human?
// A conversation that cannot be read says nothing about the turn: a task that still says it waits then goes on waiting.
export const waits = (t, turn) => (!!t.selfBlocked && t.stage === "asks") || (!turn && !!t.blocked?.at && t.stage === "asks") || sameTurn(t, turn);

// The turn is handled and the task waits, with the kind and the words its agent gave: also when a late reading from
// herdr had taken the same turn for a new one meanwhile. A report that is there already gets its link: an interim
// report can be read while the task waits, and it ends nothing.
export function stay(id, t, turn, seen, session = "") {
  let report = null;
  try { report = R.keepReport(t, () => artifactBase(t.id)); } catch {}
  return S.update(id, (t) => {
    t.handled = { ...(t.handled || {}), ...seen, at: Date.now(), msg: turn?.id ?? t.handled?.msg ?? null, pos: turn?.pos ?? t.handled?.pos ?? 0 };
    t.selfBlocked = null; t.turnOpen = false; t.turnBy = null; t.expectedWake = null;
    if (t.stage !== "asks") { t.stage = "asks"; t.kind = t.blocked?.kind || "question"; t.msg = t.blocked?.msg || "Needs you"; }
    if (turn?.said) t.said = turn.said;
    if (turn?.file) t.transcript = turn.file; // so that herdr counting this same turn later is known for that (flow/handled-turn.js)
    if (session) t.session = session;
    if (report && !(t.report && t.report.file === report.file && t.report.link === report.link)) t.report = report;
  }, { waitMs: 10000 });
}
