// The chosen attempt becomes the task: its worktree, branch, tab, agent and conversation are the task's from then on,
// and the task goes on like any other (one review loop, one push, one pull request, one merge). The other attempts'
// tabs close; their worktrees and branches stay until the task is done, and go with it then (`workspace.cleanup`).
import fs from "node:fs";
import * as S from "../store.js";
import * as F from "../flow.js";
import { herdr, socketExists } from "../herdr.js";
import { spawnRunner } from "../runner.js";
import { reportFolder } from "../research.js";

// What of an attempt is the task's once it is chosen.
const TAKEN = ["worktree", "branch", "from", "baseSha", "repoFile", "repoRefused", "agent", "session", "transcript", "said", "summary", "usage", "model", "hooked", "agentVersion", "handled", "terms", "last",
  "startedAgentAt", "workedAt", "workAt", "armedAt", "ownNote", "stat", "checkedHead", "checkedWith", "syncedTo", "syncSeen", "syncBranch", "fallbacks"];
const apiOf = (t) => (t.link?.socket && socketExists(t.link.socket) ? herdr(t.link.socket) : null);

// `by`: who chose ("you", "reviewer", or "check" when it was the only one that passed). Returns the task, on its
// way to the rest of the finish line.
export function adopt(id, letter, by) {
  const task = S.get(id), kid = S.attemptsOf(task).find((c) => c.letter === String(letter).toUpperCase());
  if (!kid || kid.stage !== "tried") throw new Error(`${id} has no attempt ${letter} that passed.`);
  const report = !!kid.report;
  S.copyToken(kid.id, id);
  // Its report is the task's, unless the picker wrote one from all of them into the task's own folder.
  if (report) { try { const to = reportFolder(task); if (!fs.existsSync(to) || !fs.readdirSync(to).length) fs.cpSync(reportFolder(kid), to, { recursive: true }); } catch {} }
  const t = S.update(id, (t) => {
    if (t.picked) throw new Error(`${id}: attempt ${t.picked.letter} was chosen already.`);
    if (!["attempts", "pick", "reviewing"].includes(t.stage)) throw new Error(`${id} is not choosing among attempts.`);
    for (const k of TAKEN) if (kid[k] !== undefined) t[k] = kid[k];
    t.app = kid.agent; t.as = kid.id; t.startedOnce = true; t.root = kid.root || t.root;
    t.link = { socket: t.link?.socket || kid.link?.socket, workspace: t.link?.workspace || kid.link?.workspace, ownsWorkspace: true, tab: kid.link?.tab, pane: kid.link?.pane, terminal: kid.link?.terminal, agent: kid.link?.agent, reviewer: null };
    // Its program, and its model, are this task's own from now on: a restart starts the one that did the work.
    t.settings = { ...(t.settings || {}), "worker.agent": kid.settings?.["worker.agent"] || kid.agent };
    t.picked = { letter: kid.letter, by, at: Date.now() }; t.comparing = null;
    t.stage = "checking"; t.msg = `Attempt ${kid.letter} goes on`; t.failure = null; t.checkFails = 0; t.reviewRounds = 0; t.turnOpen = false; t.expectedWake = null; t.watch = null; t.kind = undefined;
  }, { waitMs: 10000 });
  // The attempt lets go of its pane: one pane, one task, for everything that finds a task by its pane.
  S.update(kid.id, (c) => { c.chosen = true; c.link = { socket: c.link?.socket }; }, { waitMs: 10000 });
  for (const c of S.attemptsOf(t)) if (c.id !== kid.id) closeTab(c);
  try { F.tellSidebar(t); } catch {}
  spawnRunner("pipeline", id);
  return t;
}
// A losing attempt's tab closes (its agent with it). What it made stays on disk.
export function closeTab(c) {
  const api = apiOf(c);
  try { if (api && c.link?.tab) api.tabClose(c.link.tab); else if (api && c.link?.pane) api.paneClose(c.link.pane); } catch {}
  try { S.update(c.id, (c) => { c.link = { socket: c.link?.socket }; c.closedAt = Date.now(); }, { waitMs: 10000 }); } catch {}
}
// An attempt is thrown away: its tab, its worktree, its branch and its own folder on the board. For the losers of a
// task that is done or removed, and for the attempts of an earlier round when a task is delegated again. What it
// committed goes: that is what not being chosen means. Any file in its worktree that was never committed, one that .gitignore covers
// too (git cannot tell a draft from a build's output, so neither is removed), is somebody's unsaved work: then its worktree and branch stay, and what is returned says where (else "").
export function discard(task, c) {
  const root = S.folderOf(task.id);
  if (c.link?.pane || c.link?.tab) closeTab(c);
  if (c.chosen) { S.removeAttempt(c.id); return ""; } // its worktree and branch are the task's own, and go with the task
  const there = !!c.worktree && fs.existsSync(c.worktree);
  let unsaved = false;
  try { unsaved = there && !!S.gitOut(c.worktree, ["status", "--porcelain", "--ignored"]); } catch { unsaved = there; } // what cannot be read is not removed
  if (!unsaved) {
    try { if (there) S.gitOut(root, ["worktree", "remove", "--force", c.worktree], { timeout: 60000 }); } catch {}
    try { S.gitOut(root, ["worktree", "prune"]); } catch {}
    try { if (c.branch) S.gitOut(root, ["branch", "-D", c.branch]); } catch {}
  }
  try { fs.rmSync(reportFolder(c), { recursive: true, force: true }); } catch {}
  S.removeAttempt(c.id);
  return unsaved ? `${S.tilde(c.worktree)} (attempt ${c.letter}: files that were never committed)` : "";
}
// The task is done and tidied, or removed: the attempts that were not chosen go with it. Returns what was kept.
export function discardAll(id) {
  const t = S.get(id), kept = [];
  for (const c of t?.attempts?.length ? S.attemptsOf(t) : []) { try { const k = discard(t, c); if (k) kept.push(k); } catch {} }
  return kept;
}
