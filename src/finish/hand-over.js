// The working agent's hand-over (`worker.fallback`, docs/fallback.md): the agent on a task cannot go on, and the next
// one on the list takes the task over in the same worktree and the same pane, with the task, what was done so far
// and the open findings. Nobody extra runs until then. With the list used up nothing happens here, and the task
// waits for you as it did before there was a list.
import * as S from "../store.js";
import * as F from "../flow.js";
import * as G from "../gate.js";
import { adapter, installed } from "../agents.js";
import { firstPrompt, startAgent } from "../delegate.js";

// Can this agent be started here, as the role's access says? "" or why not, for the task's note.
export function usable(agent, access = "full") {
  const { kind } = S.agentOf(agent);
  if (!installed(kind)) return `${kind} is not installed here`;
  if (access !== "full" && !(adapter(kind).access && Object.hasOwn(adapter(kind).access, access))) return `${kind} cannot ask before it acts, and the access is "${access}"`;
  return "";
}
// What the one before it left: its commits on the branch, and whether changes lie uncommitted.
function doneSoFar(t) {
  const tree = S.cwdOf(t);
  if (!t.worktree) return "";
  let commits = [], loose = 0;
  try { commits = S.gitOut(tree, ["log", "--oneline", "--no-decorate", "-20", `${t.baseSha || t.from || "HEAD"}..HEAD`]).split("\n").filter(Boolean); } catch {}
  try { loose = F.dirty(tree).split("\n").filter(Boolean).length; } catch {}
  return [commits.length ? `Its commits on this branch so far, newest first:\n${commits.map((c) => `- ${c}`).join("\n")}` : "It committed nothing on this branch yet.",
    loose ? `${loose} file${loose === 1 ? " has" : "s have"} changes that are not committed yet.` : ""].filter(Boolean).join("\n");
}
// The findings that are still open: the last review's, when it failed the gate and the work has not passed one since.
const openFindings = (t) => (t.review && !G.passes(t.review) && G.sendable(t.review) ? `The last review of this work failed (${G.result(t.review)}), and what it found is still open:\n\n${G.findingsText(t.review)}` : "");
// All the next agent is given: the task as a first agent gets it, then that it takes over, from whom and why, what
// was done, the last words of the one before it, and what is open.
export function handoverPrompt(t, { from, why, findings = "" }) {
  const where = t.worktree ? `in the same folder, on the same branch (${t.branch})` : "in the same folder";
  return [firstPrompt(t),
    `You are taking this task over from another agent (${from}), which could not go on: ${why}. You work ${where}: everything it did is there. Look at it first${t.worktree ? " (git log, git status, git diff)" : ""} and carry on from where it stands. Do not start over, and do not undo its work without a reason.`,
    doneSoFar(t),
    t.said ? `Its last message was:\n${t.said}` : "",
    findings || openFindings(t),
    "Finish the task as its rules say.",
  ].filter(Boolean).join("\n\n");
}
// What a hand-over changes on the task, put back whole when the next agent cannot be started: nobody took over, so
// the agent that was on it, its failure, its wait and the rounds it used up are as they were.
const KEPT = ["agent", "app", "on", "tried", "session", "transcript", "handled", "agentVersion", "hooked", "model", "usage", "failure", "waiting", "cutRetry", "checkFails", "reviewRounds", "kind", "watch", "review", "mergeIntent", "requireApproval", "fallbacks", "handovers"];
// Hand the task to the next agent on `worker.fallback`, read now. `why`: why the one on it cannot go on, in plain
// words. `findings`: what is open, when the caller knows it better than the saved review does (a failed check).
// Returns true when another agent is on it; false when nobody took over, and the caller goes on as it always did.
export function handOver(id, g, { why, findings = "" } = {}) {
  let t = g.check();
  const now = S.work(t), list = S.listOf(now["worker.fallback"]);
  if (!list.length || !t.link?.pane) return false;
  const api = F.h(t), from = S.onNow(t, now["worker.agent"]);
  const tried = [...new Set([...(t.tried || []), from])], skipped = [];
  const note = (words) => { try { g.set((t) => { t.fallbacks = { ...(t.fallbacks || {}), worker: words }; }); } catch (e) { if (e.aborted) throw e; } };
  for (;;) {
    const next = S.nextFallback(list, { on: from, tried, usable: (a) => usable(a, now["worker.access"]) });
    skipped.push(...next.skipped.filter((s) => !skipped.includes(s)));
    if (!next.agent) { note(S.nobodyLeft("worker.fallback", skipped)); return false; }
    tried.push(next.agent);
    // The program that cannot go on is ended, so the pane is at its shell for the next one. One that will not end
    // keeps the task: two programs are never typed into one pane.
    if (!api.paneGet(t.link.pane)) { note("worker.fallback: nobody took over, the agent's terminal is gone"); return false; }
    if (api.agentGet(t.link.pane) && !api.paneQuit(t.link.pane)) { note(`worker.fallback: nobody took over, ${S.agentOf(from).kind} could not be ended`); return false; }
    const before = Object.fromEntries(KEPT.map((k) => [k, t[k]])), kind = S.agentOf(next.agent).kind;
    let entry = null;
    t = g.set((t) => {
      entry = S.logHandover(t, { role: "worker", from, to: next.agent, why });
      t.on = next.agent; t.tried = [...tried]; t.agent = kind; t.app = kind;
      t.session = null; t.transcript = null; t.handled = { ...(t.handled || {}), msg: null, pos: 0 }; t.model = null; t.usage = null;
      // The work goes on under a new agent: what the one before it used up is not counted against this one, and a
      // yes that was given to the earlier work is asked for again.
      t.failure = null; t.waiting = null; t.cutRetry = null; t.checkFails = 0; t.reviewRounds = 0; t.kind = undefined; t.watch = null;
      if (t.review && !t.review.stale) t.review = { ...t.review, stale: true };
      if (t.mergeIntent) { if (!t.mergeIntent.auto) t.requireApproval = true; t.mergeIntent = null; }
      t.fallbacks = { ...(t.fallbacks || {}), worker: undefined };
    });
    try {
      startAgent(id, g, { prompt: handoverPrompt(t, { from: S.agentOf(from).kind === kind ? from : S.agentOf(from).kind, why, findings }) });
    } catch (e) {
      if (e.aborted) throw e;
      // It could not be started: the task is the one before it's again, and the next on the list is asked.
      skipped.push(`${next.agent} could not be started (${S.oneLine(e.message, 120)})`);
      t = g.set((t) => { Object.assign(t, before); });
      continue;
    }
    // It is on the task. The row says so until the Watcher has a line of it, and herdr's sidebar names it.
    t = g.set((t) => { t.msg = S.handoverLine(entry); t.since = Date.now(); t.workAt = Date.now(); });
    try { F.tellSidebar(t); } catch {}
    return true;
  }
}
