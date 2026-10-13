// Main moved while a task waits for approval: bring its branch up to date and check it again.
import * as S from "../store.js";
import * as F from "../flow.js";
import { claim, release, guardFor } from "../runner.js";
import * as Y from "../sync.js";
import { firstLine, approvalMessage, fail } from "./shared.js";
import { pipeline } from "./pipeline.js";
import { closeReviewer } from "./review.js";

// Main moved while a task waits for your approval (another task merged, or anything else): the board brings the
// task's branch up to date by itself. Started by the housekeeping pass. Only a task at rest is touched: waiting for
// approval, its worktree clean and on exactly the commit that was reviewed.
// `force`: main could not even be asked about (the periodic fetch failed), so look whatever is known locally.
export async function syncJob(id, { force = false } = {}) {
  let t = claim(id, "sync");
  if (!t) return;
  const g = guardFor(id);
  try {
    const tree = Y.treeOf(t);
    if (!Y.resyncable(t) || !tree || (Y.knownTarget(t) === t.syncSeen && !t.syncBlocked && !force)) return;
    g.expect(t);
    // Only a task at rest is merged into. One that is not, or whose main cannot be read, is held as "behind main":
    // it no longer invites an approval, and the sync is tried again soon.
    let r = null, why = "";
    if (S.branchOf(tree) !== t.branch) why = `its worktree is not on its own branch ${t.branch}`;
    else if (F.dirty(tree)) why = "its worktree has unsaved files";
    else if (t.reviewedHead && F.headOf(tree) !== t.reviewedHead) why = "its branch changed after the review";
    else r = Y.syncMain(t, tree);
    if (r?.status === "error") why = `main could not be fetched (${S.oneLine(firstLine(r.detail), 200) || "git fetch failed"})`;
    if (r?.status === "skip") why = Y.skipWhy(r);
    if (why) {
      const b = g.set((t) => ({ ...Y.seenPatch(t, null), syncBlocked: { why, at: Date.now() }, msg: Y.behindMsg(why) }));
      return void F.tellSidebar(b);
    }
    if (r.status === "conflict") return void Y.conflictBack(id, g, tree, r, (failure, seen) => { fail(g, failure, { patch: seen }); });
    if (r.status !== "merged") { // already current: asked again when main moves
      const c = g.set((t) => ({ ...Y.seenPatch(t, r), ...(t.syncBlocked ? { syncBlocked: null, msg: approvalMessage(t) } : {}) }));
      return void F.tellSidebar(c);
    }
    await pipeline(id, g, t.summary || "", { reason: "sync" }, r);
  } catch (e) { if (!e.aborted) try { fail(g, { stage: "workflow", title: "The finish line failed", detail: e.stack || e.message, next: "Investigate the error, then finish again." }); } catch {} else await closeReviewer(id); }
  finally { release(id); }
}
