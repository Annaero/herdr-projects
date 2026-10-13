// Archive, restore, and clearing a task away for good.
import * as S from "../store.js";
import { herdr, currentSocket } from "../herdr.js";
import * as F from "../flow.js";
import { runnerAlive } from "../runner.js";
import { stop } from "./talk.js";

// ---- archive, restore, clear -----------------------------------------------------------------------------------------
// Archive closes the task's herdr workspace (the agent ends with it) and keeps everything else.
export function archive(id) {
  const cur = S.find(id);
  if (cur.archivedAt) return cur;
  let workspace = null, socket = null;
  const t = S.update(cur.id, (t) => {
    if (t.archivedAt) return false;
    if (runnerAlive(t) && t.runner.job === "cleanup") throw Object.assign(new Error(`${t.id} is busy cleaning up after its merge. Try again in a moment.`), { code: "BUSY" });
    if (S.SLOT_STAGES.includes(t.stage) || t.stage === "queued" || runnerAlive(t) || t.autoMerge || t.mergeIntent) throw new Error(`${t.id} is still active. Stop its agent first; an automatic merge must finish first.`);
    t.archivedAt = Date.now();
    if (t.link?.workspace && t.link.ownsWorkspace) { workspace = t.link.workspace; socket = t.link.socket; }
  });
  if (workspace && socket === currentSocket()) { try { herdr(socket).workspaceClose(workspace); } catch {} F.closeRepoSpace(herdr(socket), S.folderOf(t.id)); }
  return t;
}
// Restore changes nothing in herdr and starts nothing.
export function restore(id) { return S.update(S.find(id).id, (t) => { t.archivedAt = null; }); }
// Clear: stop the agent, run teardown, remove the worktree without force, delete the branch only if merged.
// A checkout with unsaved or unmerged work is kept and the caller is told where.
export async function clear(id) {
  const cur = S.find(id);
  if (S.SLOT_STAGES.includes(cur.stage) && F.isAgentTask(cur) && !cur.archivedAt) { try { stop(cur.id); } catch {} }
  const { cleanup } = await import("../land.js");
  const t = S.get(cur.id);
  if (!t) return { id: cur.id, kept: [] };
  if (runnerAlive(t)) { try { process.kill(t.runner.pid, "SIGTERM"); } catch {} }
  // Removing the worktree is a clean-up like the one after a merge: it holds a runner marker while it runs.
  try { S.update(cur.id, (t) => { t.runner = S.marker({ job: "cleanup" }); }, { waitMs: 5000 }); } catch {}
  const kept = await cleanup(t, { deleteBranch: "merged" }); // herdr and git calls: never under the task lock
  if (!kept.length) F.clearNotes(t); // the old place too: the task's folder goes whole below
  S.withTaskLock(cur.id, () => S.remove(cur.id), { waitMs: 5000 });
  return { id: cur.id, kept };
}
