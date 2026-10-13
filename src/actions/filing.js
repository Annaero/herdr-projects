// Adding and editing a task: add, rename, describe, pin, and a report of where it stands.
import fs from "node:fs";
import * as S from "../store.js";
import * as F from "../flow.js";
import { spawnRunner, runnerAlive } from "../runner.js";
import { AGENT_STAGES } from "./shared.js";
import { delegate } from "./start.js";
import { stop } from "./talk.js";
import { details } from "./finish-line.js";
import { inherited } from "../automations/told.js";

// ---- adding and editing ----------------------------------------------------------------------------------------------
// `research`: the task is research only from the start (research.js). `from`: the task whose agent adds it. A task
// an automation made hands that on, so the new task's events never fire that automation (automations/told.js).
export function add(folder, title, { description = "", repo, research = false, from = null } = {}) {
  const t = S.create(S.folderFor(repo, folder), title, { description }), automation = inherited(from);
  if (research || automation) S.update(t.id, { ...(research ? { research: true } : {}), ...(automation ? { automation } : {}) });
  return research || automation ? S.get(t.id) : t;
}
// A new title follows the same limit as a first one: too long, it is shortened and its full text opens the description.
const retitle = (t, title) => { const now = S.titled(title, t.description); if (now.title) { t.title = now.title; t.description = now.description; if (now.subject) t.subject = now.subject; else delete t.subject; } };
export function rename(id, title) { return S.update(S.find(id).id, (t) => { S.assertUnarchived(t); retitle(t, title); }); }
export function describe(id, text) { return S.update(S.find(id).id, (t) => { S.assertUnarchived(t); t.description = String(text || "").replace(/\r/g, "").trim(); }); }
export function pin(id) { return S.update(S.find(id).id, (t) => { S.assertUnarchived(t); t.pinned = !t.pinned; }); }

// A report, as in pi-work: the human (or any agent) says where a task stands. A delegated task's own agent is told to
// say only that it is blocked (the finish line marks its work done), and is refused nothing: `asAgent` only marks
// that the turn after its own "blocked" is not a finish.
export function report(id, { state, kind, msg, title, progress, eta, asAgent = false } = {}) {
  const cur = S.find(id);
  if (title && !state) return rename(cur.id, title);
  if (!["idle", "working", "blocked", "done", "error"].includes(state)) throw new Error("state must be one of: idle, working, blocked, done, error");
  // "Mark it idle" on a task whose agent is working means "stop it": the same stop as the stop command.
  if (state === "idle" && F.isAgentTask(cur) && AGENT_STAGES.includes(cur.stage)) return stop(cur.id);
  const delegated = F.isAgentTask(cur) && AGENT_STAGES.concat(["asks", "nosummary", "approval", "reviewneeds", "failed"]).includes(cur.stage);
  const mark = state === "done" ? F.tidyMark(cur, "merged") : null;
  const t = S.update(cur.id, (t) => {
    S.assertUnarchived(t);
    if (title) retitle(t, title);
    if (state === "blocked") {
      t.stage = "asks"; t.kind = S.KINDS.includes(kind) ? kind : "question"; t.msg = S.oneLine(msg) || "Needs you"; t.turnOpen = false;
      if (asAgent) t.selfBlocked = Date.now(); // the turn that follows this report is not a finish
      return;
    }
    if (delegated && runnerAlive(t)) throw new Error(`${t.id} is in the middle of a workflow step. Stop it first.`);
    t.kind = undefined; t.msg = S.oneLine(msg); t.failure = state === "error" ? t.failure : null;
    if (state === "idle") { t.stage = F.isAgentTask(t) ? "stopped" : "todo"; if (!F.isAgentTask(t)) t.app = null; }
    else if (state === "working") { if (F.isAgentTask(t)) throw new Error(`${t.id} has an agent. Reply to it, or delegate it again, to make it work.`); t.stage = "progress"; t.app = t.owner; t.since = Date.now(); if (progress !== undefined || eta !== undefined) t.watch = { progress: progress === undefined ? t.watch?.progress : clampPct(progress), eta: eta === undefined ? t.watch?.eta : S.minutes(eta) }; } // one given alone keeps the other
    else if (state === "done") { t.stage = "done"; t.mergeIntent = null; t.tidy = F.isAgentTask(t) ? mark : null; }
    else if (state === "error") { t.stage = "failed"; Object.assign(t, S.failurePatch({ stage: "agent", title: "Marked as failed", detail: S.oneLine(msg) || "No details given.", auth: false })); }
  });
  // Called done by you: its space leaves herdr's sidebar as after a merge. Unmerged work stays on its branch.
  if (state === "done" && F.isAgentTask(t)) { try { F.labelPane(t, null); } catch {} spawnRunner("cleanup", t.id, ["--merged"]); }
  return t;
}
const clampPct = (p) => Math.max(0, Math.min(100, Math.round(Number(p)) || 0));
// ---- the human's own tasks -------------------------------------------------------------------------------------------
export function startHuman(id) { return report(id, { state: "working" }); }
export function existsWorktree(t) { return !!t.worktree && fs.existsSync(t.worktree); }
