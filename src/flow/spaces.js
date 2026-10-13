// herdr spaces the board opened and owes closing: a repo's own space, a done task's clean-up, spaces left over.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import { herdr, socketExists } from "../herdr.js";

// ---- the repo's own space ---------------------------------------------------------------------------------------------
// Asked for a worktree of a repo that has no workspace open, herdr also opens the repo itself as one. Nobody asked
// for that space, so it is remembered here and closed again with the repo's last task space. One that existed
// before, or that you have since started using, is yours and is left alone.
const spacesFile = () => path.join(S.dataDir(), "spaces.json");
export const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(String(p || "")); } };
const repoSpaces = (api, root) => api.workspaces().filter((w) => w.worktree && !w.worktree.is_linked_worktree && real(w.worktree.checkout_path) === real(root));
// Run a `herdr worktree create` or `open` and note the repo space it made, if it made one.
export function openingWorktree(api, root, fn) {
  let before = null;
  try { before = repoSpaces(api, root).map((w) => w.workspace_id); } catch {}
  const res = fn();
  try {
    const made = before && repoSpaces(api, root).find((w) => !before.includes(w.workspace_id));
    if (made) { const all = S.readJson(spacesFile(), {}) || {}; all[`${api.socket}|${real(root)}`] = made.workspace_id; S.writeJson(spacesFile(), all); }
  } catch {}
  return res;
}
// The housekeeping pass looks again at the ones that could not be closed when their last task ended.
export function sweepRepoSpaces(socket) {
  if (S.setting("workspace.cleanup") !== true) return; // off for you: nothing is closed behind your back
  const all = S.readJson(spacesFile(), {}) || {};
  const mine = Object.keys(all).filter((k) => k.startsWith(`${socket}|`));
  if (mine.length) { const api = herdr(socket); for (const k of mine) closeRepoSpace(api, k.slice(socket.length + 1)); }
}
export function closeRepoSpace(api, root) {
  try {
    const key = `${api.socket}|${real(root)}`;
    const all = S.readJson(spacesFile(), {}) || {};
    const id = all[key];
    if (!id) return;
    const forget = () => { delete all[key]; S.writeJson(spacesFile(), all); };
    const list = api.workspaces();
    const w = list.find((x) => x.workspace_id === id);
    if (!w || !w.worktree || w.worktree.is_linked_worktree || real(w.worktree.checkout_path) !== real(root)) return forget();
    if (list.some((x) => x.worktree?.is_linked_worktree && real(x.worktree.repo_root) === real(root))) return; // another task's space is still open
    if (w.focused) return; // you are looking at it: the next task that ends closes it
    const panes = api.panes(id);
    const used = panes.length !== 1 || (w.tab_count || 1) > 1 || api.agentGet(panes[0].pane_id) || real(panes[0].foreground_cwd || panes[0].cwd) !== real(root) || !api.paneIdle(panes[0].pane_id); // a command of yours runs in it
    if (!used) api.workspaceClose(id);
    forget();
  } catch {}
}

// A done task's clean-up is owed from the moment it is done, not from the moment a clean-up has reported back: this
// note goes onto the task in the same write that makes it done, so a clean-up that was killed half-way (or never
// started) is picked up by the housekeeping pass. `fresh`: no attempt has looked at the task yet.
// `tip` is the commit this is about, when the caller knows it (the one that was merged): a branch that has moved
// past it holds work that landed nowhere, and clean-up keeps it.
export function tidyMark(t, deleteBranch, tip = "") {
  if (S.setting("workspace.cleanup", t) !== true || t.archivedAt) return null; // off: nothing is closed behind your back
  try { if (!tip && t.branch) tip = S.gitOut(S.folderOf(t.id), ["rev-parse", "--verify", `refs/heads/${t.branch}`]); } catch {}
  return { fresh: true, deleteBranch, tip, eventSeq: t.eventSeq || 0, quietFrom: 0 };
}

// ---- spaces left to close ---------------------------------------------------------------------------------------------
// A task that starts a new round while its old space could not be closed yet (herdr did not answer, something of
// yours ran in it) lets go of that space here. The housekeeping pass closes it once it is free, however long that takes.
const closingFile = () => path.join(S.dataDir(), "closing.json");
export function closeLater(socket, workspace) {
  if (!socket || !workspace) return;
  try { const all = (S.readJson(closingFile(), []) || []).filter((x) => !(x.socket === socket && x.workspace === workspace)); all.push({ socket, workspace }); S.writeJson(closingFile(), all.slice(-200)); } catch {}
  sweepClosing(socket);
}
export function sweepClosing(socket) {
  if (S.setting("workspace.cleanup") !== true) return;
  let all = [];
  try { all = S.readJson(closingFile(), []) || []; } catch {}
  if (!all.some((x) => x.socket === socket) || !socketExists(socket)) return;
  const api = herdr(socket);
  const gone = (e) => /not_found/.test(String(e.code));
  const closed = ({ workspace }) => {
    try {
      api.call(["workspace", "get", workspace]);
      const busy = api.panes(workspace).some((p) => { const a = api.agentGet(p.pane_id); return a ? !["idle", "done"].includes(a.agent_status) || !api.paneChildless(p.pane_id) : !api.paneIdle(p.pane_id); }); // status "unknown" may be an agent at work
      if (busy) return false;
      api.workspaceClose(workspace);
      return true;
    } catch (e) { return gone(e); }
  };
  const left = all.filter((x) => x.socket !== socket || !closed(x));
  try { if (left.length !== all.length) S.writeJson(closingFile(), left); } catch {}
}
