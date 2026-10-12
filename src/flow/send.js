// Sending text to an agent: delivering or queueing it, the closing-note rule, the command's path, a cut-off turn tried again.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import { spawnRunner } from "../runner.js";
import { herdr } from "../herdr.js";
import { adapter, needsNote } from "../agents.js";
import { RULE_DIR, h } from "./task.js";
import { labelPane } from "./sidebar.js";

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
export function sendOwn(id, text, { reason, keepIntent = false, patch = {}, tries = 0 } = {}) {
  const wake = { reason, keepIntent, at: Date.now(), ...(tries ? { tries } : {}) };
  const t = S.update(id, (t) => { Object.assign(t, patch); t.waiting = null; t.expectedWake = wake; t.armedAt = wake.at; t.stage = "working"; t.turnOpen = false; t.msg = ""; t.watch = null; t.app = t.agent || t.app; }, { waitMs: 10000 });
  labelPane(t, null);
  return deliver(t, withTail(t, text), wake);
}

// The wait after a working agent's turn was cut off by a passing provider error is over: it is told to carry on, as
// the plugin's own turn (counters and an approved merge survive it). Called by the housekeeping pass, board open or
// closed. The wait is taken under the task lock, so two passes cannot both send. An agent that has exited meanwhile
// is started again first.
export function resumeCut(id) {
  const due = (t) => { const cur = S.waitingOf(t); return cur && cur.who === "agent" && Date.now() >= cur.until && !S.markerAlive(t.runner) ? cur : null; };
  const seen = S.get(id);
  if (!seen || !due(seen)) return false;
  // herdr is asked before the wait is taken: a lookup it did not answer leaves the wait for the next pass.
  let a = null;
  try { a = h(seen).agentGet(seen.link.pane); } catch { return false; }
  let w = null, before = null;
  S.update(id, (t) => { const cur = due(t); if (!cur) return false; w = cur; before = { stage: t.stage, msg: t.msg, failure: t.failure, waiting: cur, expectedWake: t.expectedWake, armedAt: t.armedAt }; t.waiting = null; }, { waitMs: 10000 });
  if (!w) return false;
  const words = `Your last turn was cut off by an error at the model's provider, not by anything you did: ${S.oneLine(w.error, 300)}\n\nContinue the task where you left off.`;
  if (!a) {
    // The program exited with the error: it is started again in the same conversation, with the words waiting for
    // it, as a reply to an exited agent does. A start clears the plugin's own wake, so the count of tries rides on
    // the task (`cutRetry`) until a turn finishes or you reply.
    try {
      S.queueText(id, withTail(seen, words));
      S.update(id, (t) => { t.failure = null; t.stage = "working"; t.msg = ""; t.watch = null; t.armedAt = Date.now(); t.expectedWake = null; t.turnOpen = true; t.turnBy = "reply"; t.cutRetry = { tries: w.tries, keepIntent: !!w.keepIntent }; }, { waitMs: 10000 });
      spawnRunner("restart", id);
      return true;
    } catch { return false; }
  }
  try {
    sendOwn(id, words, { reason: "retry", keepIntent: !!w.keepIntent, tries: w.tries, patch: { failure: null } });
    return true;
  } catch {
    // Nothing reached the agent: the task is as it was, and the next pass tries again.
    try { S.update(id, (t) => { if (t.expectedWake?.reason !== "retry" || t.stage !== "working") return false; Object.assign(t, before); }, { waitMs: 10000 }); } catch {}
    return false;
  }
}
