// A finished turn re-armed by mistake: hand the task to the human as stopped without a summary.
import * as S from "../store.js";
import * as F from "../flow.js";
import { readScreen } from "../herdr.js";
import { claim, release, guardFor } from "../runner.js";
import { lastLines } from "./shared.js";

// A finished turn that was re-armed by mistake (F.reopened) and would stand in "working" for ever. The status hook
// only suspects it, from a reading that may be old: this runner asks herdr itself, holding the task, and does nothing
// unless the agent is at rest right now in the newest terminal with no turn finished since the handled one.
// It never finishes the task: what the saved state shows cannot prove that nothing was asked or changed since, so
// nothing is committed, checked or put up for approval here. The task goes to the human as a turn that stopped
// without a summary: "finish anyway" runs the finish line, a reply continues the work. If the agent turns out to be
// working after all, its next status re-arms the task as any typing does.
export async function recoverJob(id) {
  let t = claim(id, "recover");
  if (!t) return;
  const g = guardFor(id);
  try {
    if (!F.isAgentTask(t) || t.archivedAt || t.stage !== "working") return;
    const api = F.h(t), a = api.agentGet(t.link.pane);
    if (!a || (a.agent_status !== "idle" && a.agent_status !== "done")) return;
    if (a.terminal_id && t.terms?.length && t.terms.at(-1) !== a.terminal_id) return; // a terminal the hook has not seen yet: it decides first
    if (!F.reopened(t, a.completion_seq ?? null) || S.pendingText(id).length) return;
    const screen = lastLines(readScreen(api, t.link.pane, a.agent_status, 60));
    g.expect(t);
    g.set((t) => { t.stage = "nosummary"; t.msg = "Stopped without a summary"; t.screen = screen; t.turnOpen = false; t.since = Date.now(); });
  } catch (e) { if (!e.aborted) process.stderr.write(`${new Date().toISOString()} recover ${id}: ${e.stack || e}\n`); }
  finally { release(id); }
}
