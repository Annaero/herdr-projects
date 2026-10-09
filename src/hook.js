// The event hook entry. herdr runs it on pane.agent_status_changed (and a few lifecycle events). It decides, starts
// a detached runner when a turn has ended, and exits: hook commands must not hold herdr up.
//
// Verified on herdr 0.9.3: plugin hooks do fire on agent status changes; HERDR_PLUGIN_EVENT_JSON carries
// {event, data: {pane_id, workspace_id, agent_status, agent}}; an agent exiting to its shell fires
// pane.agent_detected (released) and a status change to "unknown"; herdr does not replay missed events.
import fs from "node:fs";
import * as S from "./store.js";
import * as F from "./flow.js";
import { herdr, currentSocket } from "./herdr.js";
import { spawnRunner, runnerAlive } from "./runner.js";
import { housekeeping } from "./housekeeping.js";

// Stages in which a finished turn nobody saw start (a short turn, a herdr restart, a lock wait) still counts.
const WAITING = ["asks", "nosummary", "approval", "failed", "reviewneeds"];

export function hookMain() {
  if (!S.hasTasks()) return; // nothing of ours anywhere: do nothing, in any herdr session
  const socket = currentSocket();
  let event = process.env.HERDR_PLUGIN_EVENT || "", data = {};
  try { const j = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON || "{}"); data = j.data || {}; } catch {}
  try {
    if (event === "startup") { /* housekeeping below reconciles everything */ }
    else if (event === "worktree.removed") onGone(socket, (t) => t.link.workspace === data.workspace_id || (t.worktree && t.worktree === data.worktree?.path));
    else if (event === "pane.closed") onGone(socket, (t) => t.link.pane === data.pane_id || t.link.pane === data.pane?.pane_id);
    else if (data.pane_id) onPane(socket, data.pane_id);
  } catch (e) { log(e); }
  try { housekeeping(socket); } catch (e) { log(e); }
}
const log = (e) => { try { fs.appendFileSync(`${S.dataDir()}/hook.log`, `${new Date().toISOString()} ${e.stack || e}\n`); } catch {} };
const mine = (socket) => S.list().filter((t) => F.isAgentTask(t) && t.link.socket === socket);
function onGone(socket, match) { for (const t of mine(socket)) if (match(t)) reconcile(t, herdr(socket)); }

// The hook looks the pane up by herdr socket path plus pane id (pane ids repeat across herdr sessions) and does
// nothing when there is no match. Reviewer panes never trigger the finish line.
export function onPane(socket, paneId) {
  const t = mine(socket).find((t) => t.link.pane === paneId);
  if (!t) return;
  const api = herdr(socket);
  const a = api.agentGet(paneId);
  if (!a) return void reconcile(t, api);
  // Ids can change: a match also requires the pane to be in the task's working folder. No prompt is ever sent to a
  // pane that fails this check.
  if (!sameDir(a.cwd, S.cwdOf(t)) && !sameDir(a.foreground_cwd, S.cwdOf(t))) return;
  apply(t.id, a, api);
}
const sameDir = (a, b) => { if (!a || !b) return false; try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return a === b; } };

// One live reading of a worker pane, applied to its task under the task lock.
export function apply(id, a, api) {
  const status = a.agent_status, seq = a.state_change_seq ?? 0, comp = a.completion_seq ?? null;
  let then = null; // what to do after the lock is released: never a herdr call or a spawn under it
  const t = S.update(id, (t) => {
    if (t.archivedAt || !F.isAgentTask(t)) return false;
    t.last = { status, seq, comp, at: Date.now() };
    if (a.agent_session?.value) t.session = a.agent_session.value;
    if (t.stage === "stopped") {
      // A late hook cannot undo the stop: `working` re-arms only with a higher seq and an idle seen in between.
      if (status !== "working") { if (seq > (t.stopSeq || 0)) t.sawIdleAfterStop = true; return; }
      if (!(seq > (t.stopSeq || 0) && t.sawIdleAfterStop)) return;
    }
    if (t.stage === "todo" || t.stage === "progress" || t.stage === "done" || t.stage === "queued" || t.stage === "starting" || t.stage === "setup") return;
    if (status === "working") {
      if (t.selfBlocked) return; // it reported itself blocked and has not stopped yet: still that same turn
      if (t.expectedWake) { if (t.stage !== "working" && !runnerAlive(t)) t.stage = "working"; return; } // the plugin's own turn: flaps change nothing
      // The turn is the human's: typing in the agent's own terminal re-arms the pipeline.
      if (!t.turnOpen || t.stage !== "working") {
        then = t.autoMerge ? "cancel-auto" : null;
        if (t.mergeIntent || t.stage === "approval") t.requireApproval = true;
        t.mergeIntent = null;
        if (t.review && !t.review.stale) t.review = { ...t.review, stale: true };
        t.checkFails = 0; t.reviewRounds = 0; t.prRounds = 0;
        t.armedAt = Date.now(); t.turnOpen = true;
        t.stage = "working"; t.msg = ""; t.kind = undefined; t.watch = null; t.seen = false; t.since = Date.now(); t.mergeFailed = false;
        then = then || "unlabel";
      } else {
        // A second `working` in the same human turn (a flap) only moves armedAt if no closing note is newer than it.
        const note = F.noteStat(t);
        if (!(note && note.mtime > (t.armedAt || 0))) t.armedAt = Date.now();
      }
      return;
    }
    if (status === "idle" || status === "done") {
      // Undelivered text first, whatever the previous status was: a first prompt queued behind a trust dialog is
      // delivered when the dialog is answered.
      if (S.pendingText(id).length) { then = "inbox"; return; }
      if (t.selfBlocked && t.stage === "asks") { // it said it is blocked, then stopped: that is not a finish
        t.handled = { comp, note: F.noteStat(t)?.mtime ?? t.handled?.note ?? null, at: Date.now() }; t.selfBlocked = null; t.turnOpen = false;
        return;
      }
      if (t.stage === "working") {
        // completion_seq is absent until an agent's first completed turn: absent means "no finished turn yet".
        if (comp != null && comp !== t.handled?.comp && !runnerAlive(t)) then = "finish";
        return;
      }
      if (WAITING.includes(t.stage) && !runnerAlive(t) && missedTurn(t, comp)) { humanTurnEnded(t); then = "finish-force"; }
      return;
    }
    if (status === "unknown" && t.stage === "working" && !runnerAlive(t)) {
      // herdr cannot classify this agent (normal for Codex): a closing note newer than armedAt is the stop signal.
      const note = F.noteStat(t);
      if (note && note.mtime > (t.armedAt || 0) && note.mtime !== t.handled?.note) then = "finish";
    }
  }, { waitMs: 10000 });
  if (then === "inbox") return void deliverInbox(t, api);
  if (then === "cancel-auto") { try { F.cancelAutoMerge(t); } catch (e) { log(e); } F.labelPane(t, null); }
  if (then === "unlabel") F.labelPane(t, null);
  if (then === "finish") spawnRunner("finish", id);
  if (then === "finish-force") spawnRunner("finish", id, ["--force"]);
}
// A human turn that has already ended without the hook seeing it start: a completion newer than the last handled
// one, a closing note newer than the last consumed one, or a worktree HEAD or dirty tree different from the
// recorded reviewed commit.
function missedTurn(t, comp) {
  if (comp != null && t.handled && comp !== t.handled.comp && comp > (t.handled.comp || 0)) return true;
  const note = F.noteStat(t);
  if (note && t.handled && note.mtime > (t.handled.note || 0) && note.mtime > (t.armedAt || 0)) return true;
  if (t.stage === "approval" && t.reviewedHead && t.worktree && fs.existsSync(t.worktree) && (F.headOf(t.worktree) !== t.reviewedHead || F.dirty(t.worktree))) return true;
  return false;
}
function humanTurnEnded(t) {
  if (t.mergeIntent || t.stage === "approval") t.requireApproval = true;
  t.mergeIntent = null;
  if (t.review && !t.review.stale) t.review = { ...t.review, stale: true };
  t.checkFails = 0; t.reviewRounds = 0; t.prRounds = 0;
  // armedAt is never hook wall-clock time here: it is the time of the last handled completion, so a note written
  // during a fast turn still counts.
  t.armedAt = t.handled?.at || t.armedAt || 0; t.expectedWake = null; t.turnOpen = false;
  t.stage = "working"; t.msg = ""; t.kind = undefined; t.mergeFailed = false;
}
function deliverInbox(t, api) {
  const items = S.takeText(t.id);
  if (!items.length) return;
  const wake = items.map((m) => m.wake).filter(Boolean).pop() || null;
  // The send time arms the pipeline for the turn this starts, so it is written before the text goes out.
  const before = { armedAt: t.armedAt, expectedWake: t.expectedWake, stage: t.stage, msg: t.msg };
  S.update(t.id, (t) => { t.armedAt = Date.now(); if (wake) t.expectedWake = wake; if (["asks", "nosummary", "failed", "approval", "reviewneeds"].includes(t.stage)) { t.stage = "working"; t.msg = ""; } }, { waitMs: 10000 });
  try { api.agentPrompt(t.link.pane, items.map((m) => m.text).join("\n\n")); }
  catch (e) {
    S.untakeText(t.id, items.length);
    S.update(t.id, before, { waitMs: 10000 });
    if (e.code !== "agent_blocked" && e.code !== "agent_not_ready") log(e);
  }
}

// Reconcile compares a linked task with herdr: pane gone, pane alive with no agent, a finished turn nobody handled,
// a runner marker whose process is dead.
export function reconcile(t, api) {
  if (!F.isAgentTask(t) || t.archivedAt) return;
  let pane = api.paneGet(t.link.pane);
  if (!pane) pane = relink(t, api);
  if (!pane) return void S.update(t.id, (t) => { if (t.last?.gone) return false; t.last = { ...(t.last || {}), gone: true, status: null, at: Date.now() }; }, { waitMs: 10000 });
  const a = api.agentGet(pane.pane_id);
  if (!a) return void S.update(t.id, (t) => { if (t.last?.status === null && !t.last?.gone && t.exitedAt) return false; t.last = { ...(t.last || {}), status: null, gone: false, at: Date.now() }; t.exitedAt = t.exitedAt || Date.now(); }, { waitMs: 10000 });
  if (!sameDir(a.cwd, S.cwdOf(t)) && !sameDir(a.foreground_cwd, S.cwdOf(t))) return;
  // A runner marker whose pid is dead is cleared and the step retried once.
  if (t.runner && !S.pidAlive(t.runner.pid)) {
    const dead = t.runner;
    const cur = S.update(t.id, (t) => { if (!t.runner || S.pidAlive(t.runner.pid)) return false; t.runner = null; t.retried = (t.retried || 0) + 1; }, { waitMs: 10000 });
    if (!cur.runner && (cur.retried || 0) <= 1 && S.RUNNER_STAGES.includes(cur.stage)) {
      const job = cur.stage === "merging" ? "land" : cur.stage === "starting" || cur.stage === "setup" ? "delegate" : "pipeline";
      if (job === "delegate") S.update(t.id, { stage: "starting" }, { waitMs: 10000 });
      if (job === "pipeline") S.update(t.id, { stage: "checking" }, { waitMs: 10000 });
      if (!(cur.stage === "merging" && cur.autoMerge)) spawnRunner(job, t.id);
    } else if (!cur.runner && S.RUNNER_STAGES.includes(cur.stage) && !(cur.stage === "merging" && cur.autoMerge)) {
      S.update(t.id, (t) => { t.stage = "failed"; t.msg = "a workflow step stopped unexpectedly"; Object.assign(t, S.failurePatch({ stage: "workflow", title: "A workflow step stopped unexpectedly", detail: `The ${dead.job} step ended without finishing, twice.`, next: "Reply to the agent or delegate again to retry.", auth: false })); }, { waitMs: 10000 });
    }
    return;
  }
  apply(t.id, a, api); // covers hooks missed while herdr restarted
}
// When the stored pane id no longer matches, the task is relinked: first by terminal_id, then by agent name, then
// to the single agent pane whose folder is the task's worktree. Otherwise its terminal is gone.
function relink(t, api) {
  let panes = [];
  try { panes = api.panes(); } catch { return null; }
  const agents = (() => { try { return api.agents(); } catch { return []; } })();
  const dir = S.cwdOf(t);
  const inDir = (p) => sameDir(p.cwd, dir) || sameDir(p.foreground_cwd, dir);
  let hit = panes.find((p) => t.link.terminal && p.terminal_id === t.link.terminal && inDir(p));
  if (!hit && t.link.agent) { const a = agents.find((a) => a.name === t.link.agent && inDir(a)); if (a) hit = panes.find((p) => p.pane_id === a.pane_id); }
  if (!hit && t.worktree) { const cands = agents.filter((a) => inDir(a) && a.pane_id !== t.link.reviewer?.pane); if (cands.length === 1) hit = panes.find((p) => p.pane_id === cands[0].pane_id); }
  if (!hit) return null;
  S.update(t.id, (t) => { t.link = { ...t.link, pane: hit.pane_id, tab: hit.tab_id, workspace: hit.workspace_id, terminal: hit.terminal_id }; t.last = { ...(t.last || {}), gone: false }; }, { waitMs: 10000 });
  return hit;
}
