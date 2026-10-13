// Putting an agent on a task: the request, and starting queued tasks while slots are free.
import * as S from "../store.js";
import { herdr, currentSocket } from "../herdr.js";
import * as F from "../flow.js";
import { spawnRunner, runnerAlive } from "../runner.js";
import { AGENT_STAGES } from "./shared.js";
import { fanOut } from "../attempts/fan-out.js";
import { discard } from "../attempts/adopt.js";
import { RESEARCH, turnRefusal } from "../research.js";

// ---- delegate --------------------------------------------------------------------------------------------------------
// Records the request (stage "queued") and lets the housekeeping pass start it when a slot is free.
export function delegate(id, opts = {}) {
  const cur = S.find(id);
  // Its options are any work setting, for this task: all checked before anything is saved, so a refused delegate
  // changes nothing on the task. `research` is the short form (--research, --no-research) of the setting research.only.
  const { research, ...asked } = opts;
  if (research !== undefined) asked[RESEARCH] = research === true;
  const values = S.checked(Object.fromEntries(Object.entries(asked).filter(([, v]) => v !== undefined && v !== null && v !== "")), { task: cur });
  const socket = currentSocket();
  let stale = [];
  let old = null; // the last round's space, when its clean-up had not managed to close it yet
  const t = S.update(cur.id, (t) => {
    S.assertUnarchived(t);
    if (t.stage === "attempts") throw new Error(`${t.id} already has its attempts working on it.`);
    if (t.stage === "pick") throw new Error(`${t.id} waits for you to pick one of its attempts: herdr-superwork pick ${t.id} <letter>.`);
    if (AGENT_STAGES.includes(t.stage) || runnerAlive(t)) throw new Error(`${t.id} already has an agent working on it.`);
    if (t.autoMerge) throw new Error(`${t.id} is waiting for an automatic merge. Reply to its agent to cancel that first.`);
    if (t.link?.socket && t.link.socket !== socket) throw new Error(`${t.id} lives in another herdr session. Open the board there.`);
    if (Object.keys(values).length) t.settings = { ...(t.settings || {}), ...values };
    if (values["merge.by"] === "itself") t.requireApproval = false;
    // Work that already landed and was cleaned up starts a new round in a fresh worktree, never in your checkout.
    if (F.cleanedUp(t)) {
      if (t.link?.workspace && t.link.ownsWorkspace) old = { socket: t.link.socket, workspace: t.link.workspace };
      for (const k of ["startedOnce", "startedAgentAt", "cleaned", "worktree", "branch", "from", "baseSha", "pr", "prMerged", "prState", "prHead", "prSeen", "prFeedbackSeen", "prFailure", "review", "reviewedHead", "syncedTo", "syncSeen", "syncBranch", "syncRepairs", "syncRetryAt", "syncBlocked", "handled", "session", "said", "summary", "stat", "kept", "tidy", "exitedAt", "repoFile", "repoRefused", "researchRun", "researchTurned", "attempts", "picked", "as", "comparison", "comparing", "checkedHead", "checkedWith", "spaceDir"]) delete t[k];
      t.link = {};
    }
    t.on = null; S.freshList(t); // a new start is `worker.agent` again, with its whole fallback list before it
    // Attempts of an earlier round that none was chosen from (all were out, or it was stopped): it starts over.
    if (t.attempts?.length && !t.picked) { stale = S.attemptsOf(t); for (const k of ["attempts", "comparison", "comparing", "spaceDir"]) delete t[k]; if (t.link?.workspace && t.link.ownsWorkspace) old = { socket: t.link.socket, workspace: t.link.workspace }; t.link = { socket: t.link?.socket }; }
    // Research only or not is decided when the agent starts (delegate.js: startsAs), not here: until then the task
    // follows the setting (`researchOpen`), so a change while it waits for a slot counts for this start. A task that
    // worked as an ordinary one and would start as research only is refused now, where you can read why.
    const why = turnRefusal(t, S.setting(RESEARCH, t) === true);
    if (why) throw new Error(`${why} To start it as it was: herdr-superwork set ${RESEARCH} false --task ${t.id}`);
    t.researchOpen = true;
    t.agent = S.agentOf(S.setting("worker.agent", t)).kind;
    t.app = t.agent;
    t.stage = "queued"; t.queuedAt = Date.now(); t.msg = ""; t.kind = undefined; t.since = Date.now(); t.watch = null;
    t.link = { ...(t.link || {}), socket };
    t.mergeIntent = null; t.requireApproval = t.requireApproval || !!t.review; t.failure = null; t.expectedWake = null; t.turnOpen = false; t.waiting = null;
    if (t.review) t.review = { ...t.review, stale: true };
    t.checkFails = 0; t.reviewRounds = 0; t.prRounds = 0; t.syncRepairs = 0;
  });
  for (const c of stale) { try { discard(t, c); } catch {} }
  if (old) F.closeLater(old.socket, old.workspace);
  F.tellSidebar(t);
  startQueued(socket);
  return S.get(t.id);
}
// Start queued tasks while slots are free. Counting and claiming happen under one global lock, so two passes cannot
// both take the last slot. A turn the human started in an agent's terminal counts toward the total.
export function startQueued(socket = currentSocket()) {
  const started = [];
  // A task done several times at once is split into its attempts first (`attempts.by`, read now): each then waits
  // for a slot of its own, in the task's place in the line.
  for (const w of S.list()) if (w.stage === "queued" && w.link?.socket === socket) { try { fanOut(w.id); } catch {} }
  S.withLock("slots", () => {
    const all = S.list({ attempts: true });
    let busy = all.filter((t) => S.SLOT_STAGES.includes(t.stage) && !t.autoMerge).length; // a remembered auto-merge runs nothing
    const waiting = all.filter((t) => t.stage === "queued" && t.link?.socket === socket).sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0));
    for (const w of waiting) {
      if (busy >= S.setting("board.agents")) break;
      const t = S.update(w.id, (t) => { if (t.stage !== "queued") return false; t.stage = "starting"; t.msg = ""; });
      if (t.stage !== "starting") continue;
      busy++;
      started.push(t.id);
    }
  }, { waitMs: 5000 });
  for (const id of started) spawnRunner("delegate", id);
  return started;
}
