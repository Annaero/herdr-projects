// What the pieces share: reading herdr's view of a task, and sending text to its agent.
import fs from "node:fs";
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
const pick = (s) => ({ state: s.state, kind: s.kind, note: s.msg, shownApp: s.app, progress: s.progress, asReview: !!s.review, stale: s.stale, exited: s.exited });
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
// `summary` token (both show once the sidebar rows from the README are in the config of the herdr client you look
// through; a client on another machine reads its own config, so the name is always set as well).
const sidebarFile = () => path.join(S.dataDir(), "sidebar.json");
export function labelPane(t, text) {
  if (!isAgentTask(t)) return;
  const api = h(t);
  const label = text ? String(text).slice(0, 40) : "";
  try { const seen = S.readJson(sidebarFile(), {}) || {}; seen[`${t.link.socket}|${t.link.pane}`] = label; for (const k of Object.keys(seen).slice(0, -400)) delete seen[k]; S.writeJson(sidebarFile(), seen); } catch {}
  if (label) api.metadata(t.link.pane, ["--state-label", `idle=${label}`, "--state-label", `done=${label}`, "--state-label", `unknown=${label}`, "--state-label", `blocked=${label}`, "--display-agent", `${label} · ${t.agent || "agent"}`]);
  else api.metadata(t.link.pane, ["--clear-state-labels", "--clear-display-agent"]);
  if (t.link.workspace && t.link.ownsWorkspace) { try { api.call(["workspace", "report-metadata", t.link.workspace, "--source", "plugin:herdr-superwork", ...(label ? ["--token", `summary=${label}`] : ["--clear-token", "summary"])]); } catch {} }
}
// A verdict in a few words, with which review gave it: "review 2 · 4/5".
export const verdictLabel = (t, rv) => `${S.reviewLabel(t) || "review"}${S.reviewLabel(t) ? " · " : " "}${rv.score}/5`;
// The stage in plain words, for herdr's sidebar. Nothing while the agent simply works: herdr's own status says that.
export function labelOf(t) {
  const rv = S.currentReview(t);
  switch (t.stage) {
    case "approval": return t.mergeFailed ? "merge blocked" : t.syncBlocked ? "behind main" : t.prFailure ? "pr blocked" : rv ? verdictLabel(t, rv) : "approve?";
    case "asks": return t.kind === "auth" ? "needs login" : "needs you";
    case "nosummary": return "needs you";
    case "reviewneeds": return [S.reviewLabel(t), "needs you"].filter(Boolean).join(" · ");
    case "failed": return t.failure?.auth ? "needs login" : t.failure?.phase === "sync" ? "conflict" : "failed";
    case "merging": return t.autoMerge ? "merges on green" : "merging";
    case "reviewing": return S.reviewLabel(t) || "in review";
    case "checking": case "pushing": return "checking";
    case "working": return t.expectedWake?.reason === "conflict" ? "conflict" : "";
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
  const t = S.update(id, (t) => { Object.assign(t, patch); t.expectedWake = wake; t.armedAt = wake.at; t.stage = "working"; t.turnOpen = false; t.msg = ""; t.watch = null; t.app = t.agent || t.app; t.seen = false; }, { waitMs: 10000 });
  labelPane(t, null);
  return deliver(t, withTail(t, text), wake);
}

// ---- git/gh helpers used by more than one step -----------------------------------------------------------------------
export function hasOrigin(root) { try { return S.gitOut(root, ["remote"]).split("\n").includes("origin"); } catch { return false; } }
export const gh = (args, cwd, timeout = 120000) => spawnSync("gh", args, { cwd, encoding: "utf8", timeout, env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" } });
export const prNumber = (pr) => (String(pr).match(/\/pull\/(\d+)/) || [])[1] || String(pr);
// All messages that resume work must first revoke a queued GitHub auto-merge. Throws when that fails: nothing is sent.
export function cancelAutoMerge(t) {
  if (!t.autoMerge) return;
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
