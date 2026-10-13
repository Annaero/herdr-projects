// Where an attempt works: a worktree and a branch of its own (`work/12a-…`), and a tab of its own (`Agent A`) in the
// task's one herdr space. The first attempt to start makes that space, as herdr makes any worktree's; each later one
// gets a worktree beside it and a tab in the same space.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import * as F from "../flow.js";

// Answers as `herdr worktree create` does: { workspace, tab, root_pane, worktree: { path } }. One attempt at a time
// per task: two that start together must not both make the space.
export function openPlace(api, root, t, { branch, from }) {
  return S.withLock(`space:${t.attemptOf}`, () => {
    const p = S.get(t.attemptOf);
    const space = p?.link?.workspace ? api.workspaceGet(p.link.workspace) : null;
    if (!space) {
      const res = F.openingWorktree(api, root, () => api.worktreeCreate({ cwd: root, branch, base: from, label: String(p?.title || t.title).slice(0, 60) }));
      const dir = res.worktree?.path || res.workspace?.worktree?.checkout_path;
      S.update(t.attemptOf, (p) => { p.link = { ...(p.link || {}), workspace: res.workspace.workspace_id, ownsWorkspace: true }; p.spaceDir = path.dirname(dir); }, { waitMs: 10000 });
      return res;
    }
    // Beside the first one's worktree, named as herdr names one: the branch with its slashes as dashes.
    const dir = path.join(p.spaceDir || path.dirname(S.attemptsOf(p).find((c) => c.worktree)?.worktree || path.join(S.dataDir(), "worktrees", t.repo, "x")), branch.replace(/[^A-Za-z0-9._-]+/g, "-"));
    if (!fs.existsSync(dir)) S.gitOut(root, ["worktree", "add", "--no-track", "-b", branch, dir, from], { timeout: 120000 });
    const r = api.tabCreate({ workspace: space.workspace_id, cwd: dir, label: F.agentTab(t), env: S.boardEnv() });
    const tab = r.tab?.tab_id || r.root_pane?.tab_id, pane = r.root_pane || api.panes(space.workspace_id).find((x) => x.tab_id === tab);
    if (!pane) { if (tab) api.tabClose(tab); throw new Error(`herdr opened no terminal for attempt ${t.letter}`); }
    return { workspace: { workspace_id: space.workspace_id }, tab: { tab_id: tab || pane.tab_id }, root_pane: pane, worktree: { path: dir } };
  }, { waitMs: 180000 });
}
// A tab for an attempt whose terminal is gone, in the task's space, in its own worktree.
export function reopenPlace(api, t) {
  const workspace = t.link?.workspace || S.get(t.attemptOf)?.link?.workspace;
  if (!workspace || !api.workspaceGet(workspace)) return null;
  const r = api.tabCreate({ workspace, cwd: S.cwdOf(t), label: F.agentTab(t), env: S.boardEnv() });
  return r.root_pane || api.panes(workspace).find((x) => x.tab_id === r.tab?.tab_id) || null;
}
