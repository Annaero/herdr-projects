// A plan that waits for you ("plan ready"): the yes that starts the build, and the reply that sends the plan back.
import * as S from "../store.js";
import * as F from "../flow.js";
import * as P from "../plan.js";
import { spawnRunner, runnerAlive } from "../runner.js";
import { say } from "./shared.js";

export const awaitsPlan = (t) => t?.stage === "plan" && P.open(t);
// Yes: the plan is approved as it stands, and the build starts (plan/build.js, in a runner: a program is started).
export function approvePlan(id) {
  const cur = S.find(id);
  S.assertUnarchived(cur);
  F.assertLive(cur);
  const t = S.update(cur.id, (t) => {
    if (!awaitsPlan(t)) throw new Error(`${t.id} has no plan that waits for a yes.`);
    if (runnerAlive(t)) throw new Error(`${t.id} is busy. Try again in a moment.`);
    t.plan = { ...t.plan, approvedAt: Date.now(), approvedBy: "you" };
    t.stage = "starting"; t.msg = "Starting the build"; t.kind = undefined; t.since = Date.now(); t.failure = null;
  });
  F.tellSidebar(t);
  spawnRunner("delegate", t.id);
  return say(t, `${t.id}: plan approved, the build starts`);
}
// The words a reply to a waiting plan is sent as: the plan goes back to its writer with them, and is written again.
export const planReply = (t, words) => P.backWords(t, words);
// What a reply does to the step: the reviewer's look at the older plan says nothing about the next one.
export function sentBack(t) { t.plan = { ...t.plan, review: null, sentBack: Date.now(), was: P.planMark(t), backs: (t.plan.backs || 0) + 1 }; }
