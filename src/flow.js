// What the pieces share: reading herdr's view of a task, and sending text to its agent.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as S from "./store.js";
import { herdr, currentSocket, sessionName, socketExists } from "./herdr.js";
import { show } from "./state.js";
import { adapter, needsNote, readTurnOf } from "./agents.js";

export const RULE_DIR = ".herdr-superwork";
export const noteFile = (t) => path.join(S.cwdOf(t), RULE_DIR, `closing-${t.n}.md`);
export const reviewDir = (t) => path.join(S.cwdOf(t), RULE_DIR, `review-${t.n}`);
export const isAgentTask = (t) => !!t.link?.pane;
export const h = (t) => herdr(t.link?.socket || null);

// ---- live readings ---------------------------------------------------------------------------------------------------
// One `agent list` and one `pane list` per herdr session answer for every task on the board.
export function readSession(socket) {
  if (!socketExists(socket)) return { down: true };
  try {
    const api = herdr(socket);
    const agents = new Map(api.agents().map((a) => [a.pane_id, a]));
    const panes = new Map(api.panes().map((p) => [p.pane_id, p]));
    return { agents, panes };
  } catch (e) { return { down: true, error: e }; }
}
export function liveOf(t, session, here = currentSocket()) {
  if (!isAgentTask(t)) return undefined;
  if (t.link.socket && t.link.socket !== here) return { away: sessionName(t.link.socket) };
  if (!session || session.down) return { down: true };
  const pane = session.panes.get(t.link.pane);
  if (!pane) return { gone: true };
  const a = session.agents.get(t.link.pane);
  return a ? { status: a.agent_status, agent: a, pane } : { status: null, pane };
}
// A task as the board and `list` show it: the task plus its derived state.
export function shown(t, session, here) {
  const live = liveOf(t, session, here);
  const pending = isAgentTask(t) && S.pendingText(t.id).length > 0;
  return { ...t, live, ...pick(show({ ...t, pendingText: pending }, live)) };
}
// Names that cannot collide with a task's own fields (a task has its own `review` and `msg`).
const pick = (s) => ({ state: s.state, kind: s.kind, note: s.msg, shownApp: s.app, progress: s.progress, eta: s.eta, asReview: !!s.review, stale: s.stale, exited: s.exited });
// This machine's tasks as one herdr session sees them (the keeper serves several sessions from one data folder).
export function boardFor(socket) {
  const tasks = S.list();
  const session = tasks.some((t) => isAgentTask(t) && t.link.socket === socket) ? readSession(socket) : null;
  return tasks.map((t) => shown(t, session, socket));
}
export function board({ includeArchived = false } = {}) {
  const here = currentSocket();
  const tasks = S.list({ includeArchived });
  const session = tasks.some((t) => isAgentTask(t) && t.link.socket === here) ? readSession(here) : null;
  return tasks.map((t) => shown(t, session, here));
}
// Refuse a live action with the reason the board shows.
export function assertLive(t) {
  if (!isAgentTask(t)) throw new Error(`No agent has been on ${t.id} yet. Delegate it first.`);
  const here = currentSocket();
  if (t.link.socket !== here) throw new Error(`${t.id} lives in herdr session ${sessionName(t.link.socket)}. Open the board there.`);
  if (!socketExists(here) || !herdr(here).alive()) throw new Error("herdr is not running.");
}

// The terminals a task's agent has been read in, oldest first. herdr gives a pane a new terminal_id when it restarts
// and never an old one again, so a reading from any terminal but the newest was taken before that restart. Returns
// false for such a reading; a terminal not seen before becomes the newest.
export function seeTerminal(t, term) {
  if (!term) return true;
  const seen = t.terms || [t.handled?.term || t.link?.terminal].filter(Boolean);
  if (seen.includes(term)) { if (seen.at(-1) !== term) return false; }
  else seen.push(term);
  t.terms = seen.slice(-8);
  return true;
}

// ---- telling herdr's own sidebar -------------------------------------------------------------------------------------
// While a task waits for approval its pane says so in herdr's sidebar, with no change to the client's herdr settings.
// herdr's default sidebar shows neither state labels nor custom tokens (verified on 0.9.3): only the agent's display
// name. So the label goes three ways: into the display name (shows with no setup), as a state label and as the
// `summary` token (both show once the sidebar rows from the README are in herdr's config). Once those rows are in
// this machine's config the display name is left alone: beside the state text it would say the label twice.
const sidebarFile = () => path.join(S.dataDir(), "sidebar.json");
export function labelPane(t, text) {
  if (!isAgentTask(t)) return;
  const api = h(t);
  const label = text ? String(text).slice(0, 40) : "";
  try { const seen = S.readJson(sidebarFile(), {}) || {}; seen[`${t.link.socket}|${t.link.pane}`] = label; for (const k of Object.keys(seen).slice(0, -400)) delete seen[k]; S.writeJson(sidebarFile(), seen); } catch {}
  // With the plugin's sidebar rows installed the state text sits beside the agent's name, so a renamed agent would
  // say the label twice on one line ("needs you · claude  needs you"): the name is left alone then.
  const rename = label && !sidebarRows() ? ["--display-agent", `${label} · ${t.agent || "agent"}`] : ["--clear-display-agent"];
  if (label) api.metadata(t.link.pane, ["--state-label", `idle=${label}`, "--state-label", `done=${label}`, "--state-label", `unknown=${label}`, "--state-label", `blocked=${label}`, ...rename]);
  else api.metadata(t.link.pane, ["--clear-state-labels", "--clear-display-agent"]);
  if (t.link.workspace && t.link.ownsWorkspace) { try { api.call(["workspace", "report-metadata", t.link.workspace, "--source", "plugin:herdr-superwork", ...(label ? ["--token", `summary=${label}`] : ["--clear-token", "summary"])]); } catch {} }
}
// Are the plugin's sidebar rows in herdr's config (the first run adds them, between its marker lines)?
let rowsSeen = { at: 0, on: false };
function sidebarRows() {
  if (process.env.HERDR_SUPERWORK_INLINE === "1" && process.env.HERDR_CONFIG_PATH === undefined) return false; // tests never read the real config
  const file = process.env.HERDR_CONFIG_PATH || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "herdr", "config.toml");
  if (Date.now() - rowsSeen.at > 5000 || rowsSeen.file !== file) { let on = false; try { on = fs.readFileSync(file, "utf8").includes("# >>> herdr-superwork sidebar"); } catch {} rowsSeen = { at: Date.now(), on, file }; }
  return rowsSeen.on;
}
// What herdr's sidebar says about a task: one of four labels, each saying what to do. The exact reason is on the
// board. Nothing while the agent simply works, or while the board is busy by itself: herdr's own status says that.
export function labelOf(t) {
  const rv = S.currentReview(t);
  switch (t.stage) {
    case "approval": return t.mergeFailed || t.prFailure || t.prState === "failing" ? "failed" : t.syncBlocked ? "needs you" : rv && Number.isInteger(rv.score) ? `approve? ${rv.score}/5` : "approve?";
    case "asks": case "nosummary": case "reviewneeds": return "needs you";
    case "failed": return t.failure?.auth ? "needs you" : "failed";
    case "reviewing": return "reviewing";
  }
  return "";
}
// Keep every live pane's label current; writes only when the value for that pane id changed (a restored task's new
// pane therefore gets its label). Called by whoever ticks: the keeper, or the board when no keeper is alive.
export function syncSidebar(tasks) {
  const seen = S.readJson(sidebarFile(), {}) || {};
  for (const t of tasks) {
    if (!isAgentTask(t) || t.archivedAt || !t.live || t.live.gone || t.live.down || t.live.away) continue;
    const want = labelOf(t).slice(0, 40);
    if ((seen[`${t.link.socket}|${t.link.pane}`] ?? "") !== want) { try { labelPane(t, want); } catch {} }
  }
}

// ---- the repo's own space ---------------------------------------------------------------------------------------------
// Asked for a worktree of a repo that has no workspace open, herdr also opens the repo itself as one. Nobody asked
// for that space, so it is remembered here and closed again with the repo's last task space. One that existed
// before, or that you have since started using, is yours and is left alone.
const spacesFile = () => path.join(S.dataDir(), "spaces.json");
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(String(p || "")); } };
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
  if (!S.config().cleanup) return; // `cleanup` off: nothing is closed behind your back
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
  if (!S.config().cleanup || t.archivedAt) return null;
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
  if (!S.config().cleanup) return;
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

// ---- sending text to an agent ----------------------------------------------------------------------------------------
// Undelivered text is never dropped: when herdr refuses a prompt because the agent is blocked on a dialog (or not
// ready yet), the text goes to the task's inbox and the hook delivers it on the pane's next change to idle or done.
// Returns "sent" or "queued".
export function deliver(t, text, wake = null) {
  const api = h(t);
  try {
    api.agentPrompt(t.link.pane, text);
    return "sent";
  } catch (e) {
    if (!["agent_blocked", "agent_not_ready", "agent_prompt_stalled", "timeout"].includes(e.code)) throw e;
    if (e.code === "agent_prompt_stalled" || e.code === "timeout") return "sent"; // herdr: this does not prove nothing was sent; never send twice
    S.queueText(t.id, text, wake ? { wake } : {});
    return "queued";
  }
}
// The closing-note rule. With a working hook the note is only the fallback, so it is repeated on plugin-sent prompts
// only for kinds without one; kinds with no launch flag for standing rules also get a two-line short form of the rules.
export const promptTail = (t) => [
  adapter(t.agent).standing ? "" : `Rules still apply: do the work yourself on your own branch, never push or merge.\nIf you cannot continue without the human, run: ${shim()} report ${t.id} --state blocked --msg "<why>" and stop.`,
  needsNote(t.agent) || t.hooked === false ? noteRule(t) : "",
].filter(Boolean).join("\n\n");
export const withTail = (t, text) => [text, promptTail(t)].filter(Boolean).join("\n\n");
// The absolute path of the command, kept in the data folder, so agents and hooks find it without `npm link`.
// It names its own board: herdr cannot hand a worktree's space any environment, so an agent's `add` and `report` would
// otherwise land on the default board when this one is kept in another folder.
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export function shim() {
  const dir = path.join(S.dataDir(), "bin"), file = path.join(dir, "herdr-superwork");
  const text = `#!/bin/sh\n${Object.entries(S.boardEnv()).map(([k, v]) => `export ${k}=${quote(v)}\n`).join("")}exec node ${quote(S.BIN)} "$@"\n`;
  try {
    let have = null;
    try { if (!fs.lstatSync(file).isSymbolicLink()) have = fs.readFileSync(file, "utf8"); } catch {}
    if (have !== text) { fs.mkdirSync(dir, { recursive: true }); const tmp = `${file}.${process.pid}`; fs.writeFileSync(tmp, text, { mode: 0o755 }); fs.renameSync(tmp, file); }
  } catch {}
  return file;
}
export const noteRule = (t) => `Before you stop, write your closing summary (or your question to the human, if you cannot continue) to ${RULE_DIR}/closing-${t.n}.md in this folder.`;
// A prompt the plugin itself sends (check output, review findings, conflict or pull-request repair). It writes
// expectedWake first, so the turn it causes is known to be the plugin's own: counters and an approved merge survive.
export function sendOwn(id, text, { reason, keepIntent = false, patch = {} } = {}) {
  const wake = { reason, keepIntent, at: Date.now() };
  const t = S.update(id, (t) => { Object.assign(t, patch); t.expectedWake = wake; t.armedAt = wake.at; t.stage = "working"; t.turnOpen = false; t.msg = ""; t.watch = null; t.app = t.agent || t.app; }, { waitMs: 10000 });
  labelPane(t, null);
  return deliver(t, withTail(t, text), wake);
}

// ---- git/gh helpers used by more than one step -----------------------------------------------------------------------
export function hasOrigin(root) { try { return S.gitOut(root, ["remote"]).split("\n").includes("origin"); } catch { return false; } }
export const gh = (args, cwd, timeout = 120000) => spawnSync("gh", args, { cwd, encoding: "utf8", timeout, env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" } });
export const prNumber = (pr) => (String(pr).match(/\/pull\/(\d+)/) || [])[1] || String(pr);
// All messages that resume work must first revoke a queued GitHub auto-merge. Throws when that fails: nothing is sent.
// How GitHub words a check's result.
export const CHECK_BAD = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"];
export const CHECK_GOOD = ["SUCCESS", "NEUTRAL", "SKIPPED"];
// Delete a merged pull request's branch at the remote, only while it still is the commit that was merged. (gh's own
// --delete-branch also removes the local branch and its worktree, past every look clean-up takes first.)
export function dropRemoteBranch(root, branch, head) {
  if (!branch || !head || !hasOrigin(root)) return;
  try { S.gitOut(root, ["push", "origin", "--delete", branch, `--force-with-lease=${branch}:${head}`], { timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }); } catch {}
}
// A merge waiting for GitHub's checks is remembered here, on the task: the board merges it itself when they have
// passed, at the reviewed commit only. (GitHub's own auto-merge would also merge commits pushed later.) Only a task
// from an older version still has GitHub's auto-merge to switch off.
export function cancelAutoMerge(t) {
  if (!t.autoMerge) return;
  if (t.autoMergeLocal) return void S.update(t.id, { autoMerge: false, autoMergeLocal: false, requireApproval: true }, { waitMs: 10000 });
  const r = gh(["pr", "merge", prNumber(t.pr), "--disable-auto"], S.folderOf(t.id), 60000);
  if (r.status !== 0) throw new Error(`Could not cancel the pending auto-merge; nothing was sent. ${String(r.stderr || r.stdout || r.error?.message || "").trim().split("\n").pop() || ""}`.trim());
  S.update(t.id, { autoMerge: false, requireApproval: true }, { waitMs: 10000 });
}
// The change a task would land, against where its worktree started.
export function changeOf(t) {
  if (!t.worktree || !fs.existsSync(t.worktree)) return null;
  // Once the branch holds a newer main (sync.js), the change is what it adds to that main, not to where it started.
  for (const from of [t.syncedTo, t.baseSha || t.from || "HEAD"].filter(Boolean)) {
    try {
      const range = `${from}...HEAD`;
      return { stat: S.gitOut(t.worktree, ["diff", "--shortstat", range]), diff: S.gitOut(t.worktree, ["diff", "--stat", range]), head: S.gitOut(t.worktree, ["rev-parse", "HEAD"]), range };
    } catch {}
  }
  return null;
}
// Work that ended and was cleaned up: the next round starts fresh, never in your checkout.
export const cleanedUp = (t) => !!t.cleaned || (t.stage === "done" && !!t.worktree && !fs.existsSync(t.worktree));
export const headOf = (dir) => { try { return S.gitOut(dir, ["rev-parse", "HEAD"]); } catch { return ""; } };
export const dirty = (dir) => { try { return S.gitOut(dir, ["status", "--porcelain"]); } catch { return ""; } };
export const noteStat = (t) => { try { const s = fs.statSync(noteFile(t)); return { mtime: s.mtimeMs, text: fs.readFileSync(noteFile(t), "utf8").trim() }; } catch { return null; } };

// ---- a turn that is already handled ------------------------------------------------------------------------------------
// The saved conversation still ends in the message the finish line already handled.
export function sameTurn(t) {
  if (!t.handled?.msg) return false;
  const turn = readTurnOf(t.agent, { file: t.transcript || null, session: t.session, cwd: S.cwdOf(t) });
  return !!turn && turn.id === t.handled.msg;
}
// A task opened for a turn that never came. Versions before the status hook told a late "working" from a new turn
// (hook.js afterHandled) re-armed a turn the moment its finish line had handled it, and nothing would ever move it
// again: it is handed to the human instead (finish.js recoverJob). Only that state qualifies:
//   - nobody is known to have opened the turn. Everything that opens one now says who (turnBy: a reply, a start, or
//     herdr seeing the agent work), so a real turn, however quiet its agent looks, is never taken for this;
//   - it was armed within seconds of the handled turn, which is what a late reading does and a person does not;
//   - herdr counts no turn finished since, and the agent has written nothing since.
const REOPEN_MS = () => (process.env.HERDR_SUPERWORK_REOPEN_MS !== undefined ? Number(process.env.HERDR_SUPERWORK_REOPEN_MS) : 60000);
export function reopened(t, comp) {
  if (t.stage !== "working" || comp == null || !t.handled || comp !== t.handled.comp || !t.turnOpen || t.turnBy || t.expectedWake) return false;
  const gap = (t.armedAt || 0) - (t.handled.at || 0);
  if (!(gap >= 0 && gap <= 15000) || Date.now() - (t.armedAt || 0) < REOPEN_MS()) return false;
  if (t.handled.msg) return sameTurn(t);
  const note = noteStat(t);
  return !!note && note.mtime === t.handled.note;
}
