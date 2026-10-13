// Several attempts at one task, as kept on disk: what `attempts.by` says (who makes each attempt), an attempt's letter
// and id, and the attempts of a task. An attempt is a small task of its own in a folder beside its task's
// (`<repo>/12a` for task `<repo>/12`): it has its own agent, worktree, branch and tab and goes through the check like
// any task, but it is never a row of the board, and the task it belongs to shows it (src/attempts.js does the rest).
import fs from "node:fs";
import path from "node:path";
import { tasksDir, dirOf, readJson, writeJson, withLock } from "./files.js";

// Five at most: every attempt is a whole agent with its own worktree, holds one of `board.agents`' slots and costs
// what the task costs when it is done once.
export const MAX_ATTEMPTS = 5;
export const LETTERS = ["A", "B", "C", "D", "E"];
export const TOO_MANY = `at most ${MAX_ATTEMPTS}: every attempt is a whole agent with its own worktree, holds one of board.agents' slots and costs what the task costs when it is done once`;
// `attempts.by` as kept (a number, or "claude, codex/gpt-5.5, pi") -> the agents, one per attempt. A count means that
// many of the working agent (`worker`: what `worker.agent` says). One attempt is the task done the usual way: [].
export function attemptAgents(by, worker) {
  if (typeof by === "number" || /^\d+$/.test(String(by))) { const n = Math.min(MAX_ATTEMPTS, Number(by)); return n > 1 ? Array.from({ length: n }, () => String(worker)) : []; }
  const names = String(by || "").split(/[\s,]+/).filter(Boolean).slice(0, MAX_ATTEMPTS);
  return names.length > 1 ? names : [];
}
export const attemptCount = (by) => Math.max(1, attemptAgents(by, "x").length);
// `herdr-superwork/12` and `B` -> `herdr-superwork/12b`. An attempt's id is its task's with its letter.
export const attemptId = (id, letter) => `${id}${String(letter).toLowerCase()}`;
export const isAttemptId = (id) => /^[^/]+\/\d+[a-e]$/.test(String(id));
export const taskOfAttempt = (id) => String(id).replace(/[a-e]$/, "");
const fileOf = (id) => path.join(dirOf(id), "task.json");
// The attempts of a task, in the order of their letters: the sub-tasks as they are on disk now.
export function attemptsOf(t) {
  return (t?.attempts || []).map((a) => readJson(fileOf(a.id))).filter((c) => c && c.id);
}
// Every attempt on disk, of every task: what holds a slot, waits for one or has a pane is looked at like a task.
export function allAttempts() {
  const out = [];
  let repos = [];
  try { repos = fs.readdirSync(tasksDir()); } catch {}
  for (const repo of repos) {
    let ns = [];
    try { ns = fs.readdirSync(path.join(tasksDir(), repo)); } catch { continue; }
    for (const n of ns) { if (!/^\d+[a-e]$/.test(n)) continue; const t = readJson(fileOf(`${repo}/${n}`)); if (t && t.id && t.attemptOf) out.push(t); }
  }
  return out;
}
// A new attempt of a task: saved as queued, with its own program and nothing else of its own. Every other setting is
// its task's, looked up as its task's whenever it is asked (store/settings/lookup.js).
export function createAttempt(task, letter, agent, extra = {}) {
  const id = attemptId(task.id, letter), now = Date.now();
  return withLock(`task:${id}`, () => {
    fs.rmSync(dirOf(id), { recursive: true, force: true }); // an attempt of an earlier round, already cleaned up
    const t = { id, repo: task.repo, n: `${task.n}${letter.toLowerCase()}`, root: task.root, title: task.title, description: task.description, owner: task.owner, attemptOf: task.id, letter,
      automation: task.automation || undefined, carried: task.carried || undefined,
      stage: "queued", msg: "", created: now, at: now, since: now, pinned: false, archivedAt: null, settings: { "worker.agent": agent }, ...extra };
    writeJson(fileOf(id), t);
    return t;
  });
}
export function removeAttempt(id) { if (isAttemptId(id)) fs.rmSync(dirOf(id), { recursive: true, force: true }); }
