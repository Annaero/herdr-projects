// Starting several attempts: a queued task whose `attempts.by` says more than one gets one small task per attempt,
// each queued for a slot of its own, and stands as "attempts" until they are through.
import * as S from "../store.js";
import { discard } from "./adopt.js";

// Read now, as the task starts: who makes each attempt ([] when the task is done once, the usual way). A task in no
// repo, or one that already has its worktree (its agent is only started again), is never split. One that starts with
// a plan is not split here: its plan is made and approved once, and then it is split (plan/build.js).
export function attemptsFor(t) {
  if (t.attemptOf || t.startedOnce || !S.canWorktree(S.folderOf(t.id))) return [];
  if (S.setting("plan.approve", t) !== "none") return []; // a plan first: it is split after the plan's yes (plan/build.js)
  return S.attemptAgents(S.setting("attempts.by", t), S.setting("worker.agent", t));
}
// Returns the task as it now stands, or null when it is done once. Attempts of an earlier round go first: the task
// was delegated again, which starts over.
export function fanOut(id) {
  const cur = S.get(id);
  if (!cur || cur.stage !== "queued") return null;
  const agents = attemptsFor(cur);
  if (!agents.length) return null;
  for (const old of S.attemptsOf(cur)) discard(cur, old);
  const made = agents.map((agent, n) => {
    const kind = S.agentOf(agent).kind;
    return S.createAttempt(cur, S.LETTERS[n], agent, { queuedAt: (cur.queuedAt || Date.now()) + n, link: { socket: cur.link?.socket }, agent: kind, app: kind });
  });
  return S.update(id, (t) => {
    if (t.stage !== "queued") return false;
    t.stage = "attempts"; t.msg = ""; t.since = Date.now(); t.app = null;
    t.attempts = made.map((c) => ({ id: c.id, letter: c.letter, agent: c.settings["worker.agent"] }));
    t.picked = null; t.comparison = null; t.as = undefined;
    t.link = { socket: t.link?.socket };
  });
}
