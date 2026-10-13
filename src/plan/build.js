// The plan step's two ends: it begins when the agent would first start, and after the yes the build starts.
// `begin`: with `plan.approve` on, the task gets its plan step, and with `plan.agent` naming a program, a planner of
// its own. A planner takes the task's place in herdr while it writes: its tab (`Planner`) and pane become the
// task's, so everything a working agent has holds for it too (the row, the Watcher, the chat, a reply, a stop). The
// working agent's own tab waits beside it, at its shell.
// `startBuild`: the yes is written down, the repo is looked at once more, and the builder is handed the plan. The
// plan's own writer hears it in its conversation; a program that was in its own plan mode is started again in that
// conversation with its usual access, since that mode does not end by itself. After a planner, its tab closes, its
// time and tokens are kept on the task, and the working agent starts in its own tab with the task and the plan.
// A task done several times at once (`attempts.by`) is split only now: one plan, made and approved once, and every
// attempt is handed it (plan.js: `handed`). The place the plan was written in becomes attempt A's.
import * as S from "../store.js";
import * as F from "../flow.js";
import * as P from "../plan.js";
import { installed } from "../agents.js";
import { startAgent, firstPrompt, resumable } from "../delegate.js";
import { putBack, ignoredMark, heldFailure } from "./untouched.js";
import { lock, unlock } from "./lock.js";
import { fail } from "../finish/shared.js";
import { sandboxOk, NO_MOUNT } from "./sandbox.js";
import path from "node:path";

export function begin(g, t, api) {
  const by = t.attemptOf ? "" : P.wanted(t); // an attempt builds its task's plan: it never has a plan step of its own
  if (!by) return t;
  // In a repo the plan's writer runs in a read-only mount (sandbox.js). Where none can be made, no plan is written
  // and nothing starts: the task says what is missing, and a lesser guard is never taken for the whole one.
  const repo = (() => { const dir = S.cwdOf(t); return !!dir && S.isRepo(dir); })();
  if (repo && !sandboxOk()) throw new Error(NO_MOUNT.replace("<id>", t.id));
  const who = S.agentOf(S.setting("plan.agent", t));
  // A planner that is not installed here: the working agent plans, and the task says so.
  const own = !!who.kind && installed(who.kind), missing = who.kind && !own ? `planned by the working agent: ${who.kind} is not installed here` : undefined;
  let made = null;
  if (own) { made = F.openTab(api, t, F.PLANNER_TAB, { cwd: S.cwdOf(t), env: S.boardEnv() }, "the planner"); F.nameAgentTab(api, t.link.tab); }
  // From here until the yes nothing can be written in the task's own worktree (lock.js), and what git ignores
  // there is written down, so a change to it is seen too (untouched.js).
  const dir = S.cwdOf(t), ignored = dir && S.isRepo(dir) ? ignoredMark(dir) : null, locked = lock(t);
  t = g.set((t) => {
    t.plan = { asked: Date.now(), by, locked, ...(ignored ? { ignored } : {}), ...(made ? { home: { tab: t.link.tab, pane: t.link.pane, terminal: t.link.terminal, agent: t.agent }, writer: { kind: who.kind, model: who.model } } : {}) };
    t.fallbacks = { ...(t.fallbacks || {}), planner: missing, attempts: undefined };
    if (made) { t.link = { ...t.link, tab: made.tab, pane: made.pane, terminal: made.terminal }; t.agent = who.kind; t.app = who.kind; t.session = null; t.transcript = null; }
  });
  return t;
}
// Who makes each attempt, when the task is done several times at once ([] when once). Read now, as the build starts.
const attemptsNow = (t) => (t.attemptOf || t.picked || !t.worktree ? [] : S.attemptAgents(S.setting("attempts.by", t), S.setting("worker.agent", t)));

// `by`: who said yes (you, reviewer, or nobody: the setting was taken off). A yes of yours is written down by the
// action already (actions/plan.js), and this is the start that follows it.
export async function startBuild(id, g, by = "") {
  let t = g.check();
  const api = F.h(t);
  if (!P.approved(t)) t = g.set((t) => { t.plan = { ...t.plan, approvedAt: Date.now(), approvedBy: by || "you" }; });
  // Once more, right before the first change may be made: a reviewer, or you in the agent's terminal, were in there since.
  const undone = putBack(t);
  // Something is changed that the board may not or could not undo: nothing is built on it. The yes stands, and the
  // start is tried again once the change is gone (the agent is told to undo it, or you retry).
  if (undone === null) return void fail(g, heldFailure(t));
  unlock(t);
  if (undone.length) t = g.set((t) => { t.plan = { ...t.plan, undone: { list: undone.slice(0, 30), n: undone.length, at: Date.now() } }; });
  // The writer's conversation is counted onto the task before it is let go: its tokens count for `limit.tokens` (limits/spent.js).
  try { (await import("../limits/spent.js")).count(id); t = g.check(); } catch (e) { if (e.aborted) throw e; }
  const planner = !!t.plan.home;
  if (planner) {
    const was = { tab: t.link.tab, pane: t.link.pane };
    t = g.set((t) => {
      const home = t.plan.home, worker = S.agentOf(S.setting("worker.agent", t)).kind || home.agent;
      t.plan = { ...t.plan, home: null, usage: t.usage || null, model: t.model || t.plan.writer?.model || "", took: Date.now() - (t.plan.asked || Date.now()) };
      t.link = { ...t.link, tab: home.tab, pane: home.pane, terminal: home.terminal };
      t.agent = worker; t.app = worker;
      // Another program in another pane: nothing the board knew of the planner's is the worker's.
      for (const k of FORGET) delete t[k];
    });
    try { api.tabClose(was.tab); api.paneClose(was.pane); } catch {}
  }
  const many = attemptsNow(t);
  if (many.length > 1) {
    if (!planner && api.agentGet(t.link.pane) && !api.paneQuit(t.link.pane)) throw new Error("The plan writer's program could not be ended to start the attempts. Close its terminal, then retry.");
    return fanOut(g, many);
  }
  const waiting = S.takeText(id).map((m) => m.text);
  try {
    if (planner) startAgent(id, g, { prompt: [firstPrompt(t), ...waiting].join("\n\n") });
    else {
      const a = api.agentGet(t.link.pane), words = [P.goWords(t), ...waiting].join("\n\n");
      if (a && !t.plan.mode) {
        // The same program goes on in the same conversation: the turn this starts is the first of the work.
        t = g.set((t) => { t.stage = "working"; t.armedAt = Date.now(); t.expectedWake = null; t.turnOpen = true; t.turnBy = "start"; t.msg = ""; t.watch = null; t.kind = undefined; });
        F.deliver(t, F.withTail(t, words));
      } else {
        // In its own plan mode, or in the read-only mount (sandbox.js): neither ends by itself. Ended, and started again.
        if (a && !api.paneQuit(t.link.pane)) throw new Error("The agent's program could not be ended to leave its plan step. Close its terminal, then retry.");
        startAgent(id, g, resumable(t) ? { resume: t.session, prompt: F.withTail(t, words) } : { prompt: [firstPrompt(t), ...waiting].join("\n\n") });
      }
    }
  } catch (e) { if (waiting.length) S.untakeText(id, waiting.length); throw e; }
  t = S.update(id, (t) => { t.plan = { ...t.plan, built: Date.now(), locked: false, ignored: undefined }; t.kind = undefined; }, { waitMs: 10000 });
  F.tellSidebar(t);
  return t;
}
// What the board knew of one program in one pane, which is not the next one's.
const FORGET = ["session", "transcript", "handled", "last", "terms", "startedAgentAt", "usage", "model", "said", "sent", "unsent", "workedAt", "exitedAt", "owedTurn"];
// The plan has its yes and the task is done several times at once: its attempts are made now, as attempts/fan-out.js
// makes them for a task with no plan, each queued for a slot of its own. The task's space stays, and the worktree,
// the branch and the tab the plan was written in are attempt A's (as the first attempt's always are the space's own);
// every other attempt gets a worktree and a tab beside it when it starts (attempts/place.js).
function fanOut(g, agents) {
  let t = g.check();
  const place = Object.fromEntries(["worktree", "branch", "from", "baseSha", "repoFile", "repoRefused", "root", "ownNote"].filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
  const made = agents.map((agent, n) => {
    const kind = S.agentOf(agent).kind;
    return S.createAttempt(t, S.LETTERS[n], agent, { queuedAt: Date.now() + n, agent: kind, app: kind,
      ...(n ? { link: { socket: t.link.socket } } : { ...place, startedOnce: true, link: { socket: t.link.socket, workspace: t.link.workspace, tab: t.link.tab, pane: t.link.pane, terminal: t.link.terminal, ownsWorkspace: false, reviewer: null } }) });
  });
  t = g.set((t) => {
    t.stage = "attempts"; t.msg = ""; t.since = Date.now(); t.app = null; t.kind = undefined; t.turnOpen = false; t.expectedWake = null; t.watch = null;
    t.attempts = made.map((c) => ({ id: c.id, letter: c.letter, agent: c.settings["worker.agent"] }));
    t.picked = null; t.comparison = null; t.as = undefined;
    t.spaceDir = path.dirname(t.worktree);
    t.link = { socket: t.link.socket, workspace: t.link.workspace, ownsWorkspace: true };
    t.plan = { ...t.plan, built: Date.now(), locked: false, ignored: undefined };
    for (const k of [...FORGET, "worktree", "branch", "from", "baseSha", "startedOnce"]) delete t[k];
  });
  F.tellSidebar(t);
  return t;
}
