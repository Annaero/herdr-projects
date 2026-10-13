// A task's tabs in its herdr space: the agent's tab is named `Agent`, and each reviewer has a tab of its own, named
// after its review round. A task done several times at once has a tab per attempt: `Agent A`, `Agent B`. Once an
// agent took over from another (docs/fallback.md), its tab names the one that is on it now: `Agent (codex)`,
// `Reviewer #2 (claude)`. A planner of its own (`plan.agent`) has the tab `Planner`.
//
// Checked on herdr 0.9.3: `tab create --no-focus` leaves the focus where it is and the other tabs' panes at their size
// (a split halved the agent's pane); closing a tab's last pane closes the tab; a tab's id is not given out again.
export const AGENT_TAB = "Agent";
// The number is the review round: the one in the row's `R#2`.
export const reviewerTab = (round, by = "") => `Reviewer #${round}${by ? ` (${by})` : ""}`;
// A planner of its own, while it writes the plan (plan.js); the reviewer that checks a plan.
export const PLANNER_TAB = "Planner";
export const PLAN_REVIEW_TAB = "Plan review";

// A name is a convenience, as an agent's is: a herdr that will not rename a tab does not stop the task.
export function nameTab(api, tab, label) {
  if (!tab) return;
  try { api.tabRename(tab, label); } catch {}
}
// An attempt's tab says which attempt it is (`Agent B`), and keeps saying so once that attempt is the task (attempts.js).
export const agentTab = (t) => { const letter = t?.letter || t?.picked?.letter; return `${AGENT_TAB}${letter ? ` ${letter}` : ""}${t?.on ? ` (${t.agent})` : ""}`; };
export const nameAgentTab = (api, tab, t = null) => nameTab(api, tab, agentTab(t));
// The tab of the reviewer that compares a task's attempts.
export const PICKER_TAB = "Picker";
// A tab of its own in the task's space, with one pane at its shell. Returns { tab, pane, terminal }: ids.
export function openTab(api, t, label, { cwd, env } = {}, who = "the reviewer") {
  const workspace = t.link.workspace || api.paneGet(t.link.pane)?.workspace_id;
  if (!workspace) throw new Error("the task's space is gone");
  const r = api.tabCreate({ workspace, cwd, label, env });
  const tab = r.tab?.tab_id || r.root_pane?.tab_id;
  const pane = r.root_pane || api.panes(workspace).find((p) => p.tab_id === tab);
  if (!pane) { if (tab) api.tabClose(tab); throw new Error(`herdr opened no terminal for ${who}`); }
  return { tab: tab || pane.tab_id, pane: pane.pane_id, terminal: pane.terminal_id || null };
}
// The reviewer's own tab: `label` names another one than its round's (the look at a plan).
export const openReviewerTab = (api, t, round, { by = "", ...opts } = {}, label = reviewerTab(round, by)) => openTab(api, t, label, opts);
// `reviewer`: what the task keeps of it (link.reviewer). One from before reviewers had tabs has only a pane, in the
// agent's tab: that pane alone is closed.
export function closeReviewerTab(api, reviewer) {
  if (!reviewer) return;
  if (reviewer.tab) api.tabClose(reviewer.tab);
  if (reviewer.pane) api.paneClose(reviewer.pane);
}
