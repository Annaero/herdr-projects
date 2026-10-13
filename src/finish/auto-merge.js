// Auto-merge, the setting: a task that may merge does so by itself while `merge.by` is `itself`, and waits for you
// while it is `you`. The pipeline asks the setting when a task turns green; this is the housekeeping pass's part, for a
// setting changed while a task already waits.
import * as S from "../store.js";
import * as F from "../flow.js";
import * as G from "../gate.js";
import { liftOldHolds } from "./old-holds.js";
import { runnerAlive, spawnRunner } from "../runner.js";
import { approvalMessage } from "./shared.js";
import { isResearch } from "../research.js";

// Green to merge: checked, reviewed past the gate (or not to be reviewed at all), up to date with main, and nothing
// that is yours to decide: no failure, no pull-request blocker, no approval you are owed after stepping in.
// Does this task merge by itself? Asked each time: the setting is read right before the merge.
export const byItself = (t) => S.setting("merge.by", t) === "itself";
// Is this task's work reviewed at all? `review.when`: never, always, or only work in a repo.
export const reviewed = (t) => S.setting("review.when", t) !== "never";
export function green(t) {
  if (t.stage !== "approval" || t.archivedAt || !F.isAgentTask(t) || !t.reviewedHead || isResearch(t)) return false; // research only: never merged
  if (t.failure || t.prFailure || t.syncBlocked || t.mergeFailed || t.requireApproval || t.mergeIntent || t.autoMerge) return false;
  return t.review ? G.passes(t.review) : !reviewed(t);
}
// Will this task merge with nobody's yes? A merge already under way says it itself (the board's own, or one you
// approved); otherwise the setting does, unless you are owed an approval. Such a task has only the review to answer
// for what merges, so a merge of main its agent had to repair by hand is reviewed (the pipeline).
export const mergesItself = (t) => (t.mergeIntent ? !!t.mergeIntent.auto : byItself(t) && !t.requireApproval);
// A merge the board itself started and that still waits (for GitHub's checks or its merge queue).
const pending = (t) => t.stage === "merging" && !!t.autoMerge && !!t.mergeIntent?.auto;

// Turned on: a green task that waits for your yes merges now, at the commit that was reviewed.
// Turned off: a task waiting to merge by itself waits for your yes instead.
export function autoMergePass(tasks, socket) {
  try { liftOldHolds(tasks, socket); } catch {} // tried again on the next pass
  for (const seen of tasks) {
    if (seen.link?.socket !== socket || (seen.stage !== "approval" && !pending(seen)) || runnerAlive(seen)) continue;
    try {
      if (byItself(seen)) { if (green(seen)) start(seen.id); }
      else if (pending(seen)) hold(seen);
    } catch {} // tried again on the next pass
  }
}
// Asked by the land runner, when it starts and again right before it merges: a merge the board started by itself is
// only carried out while the setting is still on. Turned off since: the task waits for your yes, and this says so.
export function calledOff(g) {
  const cur = g.check();
  if (!cur.mergeIntent?.auto || byItself(cur)) return false;
  const t = g.set((t) => { t.stage = "approval"; t.autoMerge = false; t.autoMergeLocal = false; t.mergeIntent = null; t.requireApproval = false; t.since = Date.now(); t.msg = approvalMessage(t); });
  F.tellSidebar(t);
  return true;
}
function start(id) {
  let go = false;
  const t = S.update(id, (t) => {
    if (runnerAlive(t) || !byItself(t) || !green(t)) return false;
    t.stage = "merging"; t.msg = "Merging"; t.since = Date.now();
    t.mergeIntent = { approvedAt: Date.now(), repairs: 0, verifiedHead: t.reviewedHead, auto: true };
    go = true;
  });
  if (!go) return;
  F.tellSidebar(t);
  spawnRunner("land", id);
}
function hold(seen) {
  // Where GitHub's own auto-merge is what waits (a merge queue), that is switched off first: if it cannot be, the
  // task goes on waiting to merge and this is tried again.
  if (!seen.autoMergeLocal && F.gh(["pr", "merge", F.prNumber(seen.pr), "--disable-auto"], S.folderOf(seen.id), 60000).status !== 0) return;
  const t = S.update(seen.id, (t) => {
    if (runnerAlive(t) || t.stage !== "merging" || !t.mergeIntent?.auto || byItself(t)) return false;
    t.stage = "approval"; t.autoMerge = false; t.autoMergeLocal = false; t.mergeIntent = null; t.requireApproval = false; t.since = Date.now();
    t.msg = approvalMessage(t);
  });
  if (t.stage === "approval") F.tellSidebar(t);
}
