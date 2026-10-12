// Making sure that what the board hands an agent is really taken: nothing is typed before the agent's program is up,
// and a prompt that was typed but not submitted gets its enter again. The text itself is never typed a second time.
//
// Seen on herdr 0.9.3 with claude 2.1.296 (docs/checked-on-herdr.md): `agent start` answers "ready" as soon as the
// program is the pane's foreground process, which on a loaded machine is seconds before it has drawn anything.
// `agent prompt` pastes the text and presses enter 300 ms later. A program that is still starting keeps the typed text
// for its box and drops the enter: the task sat in the box, unsent, and the agent stayed idle.
import * as S from "./store.js";
import { saidTo, adapter } from "./agents.js";
import { taskLine } from "./delegate.js"; // a cycle, used only at call time
import { name as keyName } from "./board/keys.js";

const ms = (name, d) => (process.env[name] !== undefined ? Number(process.env[name]) : d);
export const TRIES = 3; // how often enter is pressed again
// How long the agent gets to start before enter is pressed again: 5 seconds, then twice as long each time, and 40 more
// before the board calls it not started (75 in all). On a starved machine a program that did take its text was seen
// to need 12 seconds to show that it works; an enter too many does nothing to a program with an empty box.
const waitMs = (m) => ms("HERDR_SUPERWORK_SUBMIT_MS", 5000) * 2 ** (m?.tries || 0);
const stepMs = () => ms("HERDR_SUPERWORK_READY_STEP_MS", 400);
const QUIET_MAX = 4000;

// ---- before the first prompt: is the program up? ----------------------------------------------------------------------
// Until a program has drawn something, the bottom of its pane is still the command herdr typed to start it. Line
// breaks and quoting differ between what was asked for and what the shell shows, so both are compared without them.
const flat = (s) => String(s || "").replace(/[\s'"\\]/g, "");
export const drawn = (screen, launch) => { const tail = flat(launch).slice(-24); return !tail || !flat(screen).endsWith(tail); };
// Wait, after `agent start`, until the program has drawn its screen and that screen stands still for a moment (or
// has been there a few seconds: some programs never stand still). Gives up after a minute and says so with `false`;
// the prompt goes in anyway then, and the look afterwards (below) catches an enter that was lost.
export function settle(api, pane, launch) {
  const max = ms("HERDR_SUPERWORK_READY_MS", 60000);
  if (!(max > 0)) return true;
  const until = Date.now() + max;
  let prev = null, since = 0;
  for (;;) {
    let screen = null;
    try { screen = api.paneRead(pane, { source: "visible" }); } catch { return false; } // herdr does not show it: nothing to wait on
    if (drawn(screen, launch)) { since ||= Date.now(); if (screen === prev || Date.now() - since >= QUIET_MAX) return true; }
    else since = 0;
    prev = screen;
    if (Date.now() >= until) return false;
    if (stepMs() > 0) S.sleepSync(stepMs());
  }
}

// ---- after a prompt: did the agent start on it? -----------------------------------------------------------------------
// What herdr says of an agent just before text is typed into it: a later reading is compared with this.
// `busy`: herdr saw it work when the text was typed (a message sent into a running turn). Nothing it does then says
// whether the text was taken: it works either way. Such a mark waits for the agent to come to rest and is taken anew
// there (`rest`): an agent that took the text goes straight on with it, one that lost the enter sits at its prompt.
// An agent herdr cannot classify (status unknown) counts as at rest: its counters and its saved conversation still
// tell whether it started, and an enter too many does nothing to a program with an empty box.
const working = (a) => a?.agent_status === "working" || a?.agent_status === "blocked";
const atRest = (a) => !!a && !working(a);
export const markOf = (a) => (a ? { at: Date.now(), seq: a.state_change_seq ?? null, comp: a.completion_seq ?? null, term: a.terminal_id ?? null, tries: 0, busy: working(a) } : null);
// For a mark taken anew, herdr's counters say nothing of the time before: only the words standing in its saved
// conversation since they were typed (`typedAt`) prove that they went in.
export const rest = (mark, a) => (mark.busy && atRest(a) ? { ...mark, ...markOf(a), pressedAt: undefined, rested: true, typedAt: mark.typedAt || mark.at } : mark);
// Do the words stand in the agent's saved conversation? true, false, or null when there is nothing to read.
export const shown = (kind, src, mark, text) => saidTo(kind, src, text, mark.typedAt || mark.at);
// Is something typed into this task's agent still waiting to be taken? The finish line holds back while it is: the
// turn that just ended is not the one that answers it.
// The same holds once the board has given up on it ("not started"): what ended then is still not its answer.
export const notStarted = (t) => t.stage === "failed" && t.failure?.stage === "send" && !!t.unsent;
// An agent that is gone settles nothing: the pass that follows decides what became of the text (checkSent).
export function pendingSent(t, a) { const m = t.sent; return notStarted(t) || (!!m && t.stage === "working" && (!a || m.busy || took(m, a) === false)); }
// Type a prompt into an agent. Returns the mark to look again with (null when herdr said nothing of the agent before).
// Throws what herdr answers when nothing was typed (agent_blocked, agent_not_ready, and anything unexpected).
export function hand(api, pane, text) {
  let a = null;
  try { a = api.agentGet(pane); } catch {}
  try { api.agentPrompt(pane, text); }
  catch (e) { if (!["agent_prompt_stalled", "timeout"].includes(e.code)) throw e; } // herdr: these do not prove nothing was sent; never send twice
  return markOf(a);
}
// true: it started on the text. false: it sits at its prompt exactly as before. null: herdr cannot say.
// `said`: the words stand in its saved conversation (`shown`), which settles it.
export function took(mark, a, said = null) {
  if (!a || mark.busy) return null;
  if (mark.term && a.terminal_id && a.terminal_id !== mark.term) return null; // herdr restarted: its counters started over
  if (said === true || working(a)) return true;
  return (a.state_change_seq ?? null) !== mark.seq || (a.completion_seq ?? null) !== mark.comp; // also a turn so short that only the counters show it
}
// One look at a prompt typed a while ago, for a sender that keeps the mark itself (the reviewer, the Coordinator).
// "took" | "unknown": nothing more to do. "wait": too early to say. "pressed": enter was pressed again. "lost": enter
// was pressed TRIES times and the agent still sits at its prompt. `said`: a function giving `shown` for this text.
export function look(api, pane, mark, said = null) {
  let a = null;
  try { a = api.agentGet(pane); } catch { return "wait"; }
  if (mark.busy && a) { Object.assign(mark, rest(mark, a)); return "wait"; }
  const v = took(mark, a);
  if (v !== false) return v ? "took" : "unknown";
  if (Date.now() - (mark.pressedAt || mark.at) < waitMs(mark)) return "wait";
  let proof = null;
  try { proof = said ? said() : null; } catch {}
  if (took(mark, a, proof)) return "took";
  if (mark.tries >= TRIES) return "lost";
  mark.tries += 1; mark.pressedAt = Date.now();
  try { api.agentKeys(pane, "enter"); } catch {}
  return "pressed";
}
// The same, waited for: for a detached job that has nothing else to do meanwhile. False when the text was lost.
export function confirm(api, pane, mark, said = null) {
  if (!mark || mark.busy) return true; // typed into a running turn: its end is not waited for here
  for (let i = 0; i < 600; i++) { // five minutes at most, whatever herdr answers
    const r = look(api, pane, mark, said);
    if (r === "took" || r === "unknown") return true;
    if (r === "lost") return false;
    if (waitMs() > 0) S.sleepSync(500);
  }
  return true;
}

// ---- a task's agent: the mark rides on the task, and the housekeeping pass looks again --------------------------------
// `first`: the text is everything a freshly started program was given, so sending it again needs nothing added.
// Text typed earlier that the agent has not started on is still in its box, above the new text: both are one message
// now, and both are what a retry hands over again.
export function noteSent(id, mark, text, first = false) {
  try {
    S.update(id, (t) => {
      const was = { agent_status: mark?.busy ? "working" : "idle", state_change_seq: mark?.seq, completion_seq: mark?.comp, terminal_id: mark?.term };
      const old = t.unsent || (t.sent && mark && (t.sent.busy || took(t.sent, was) === false) ? t.sent : null);
      t.sent = mark ? { ...mark, text: old ? `${old.text}\n\n${text}` : text, first: old ? !!old.first : first } : null;
      if (mark) t.unsent = null;
    }, { waitMs: 10000 });
  } catch {}
}
export const NOT_STARTED = "not started: its instructions sit unsent in its box";
// Called on every pass with the agent as herdr shows it now. Never waits: one look, at most one enter.
export function checkSent(id, a, api) {
  const t = S.get(id), m = t?.sent;
  if (!m) return;
  const mine = (c) => c.sent && c.sent.at === m.at && c.sent.tries === m.tries;
  const clear = () => { try { S.update(id, (c) => { if (!mine(c)) return false; c.sent = null; }, { waitMs: 10000 }); } catch {} };
  if (t.stage !== "working") return clear(); // stopped, or taken over by a step of the finish line
  const said = () => { try { return shown(t.agent, { file: t.transcript || null, session: t.session || adapter(t.agent).findSession?.(S.cwdOf(t), t.startedAgentAt || 0, taskLine(t)) || null, cwd: S.cwdOf(t) }, m, m.text); } catch { return null; } };
  // The board says "not started" instead of showing work that is not going on; the text is kept for retry.
  const lost = (detail, next) => S.update(id, (c) => {
    if (!mine(c) || c.stage !== "working") return false;
    c.sent = null; c.unsent = { text: m.text, first: !!m.first, at: m.at };
    c.stage = "failed"; c.msg = NOT_STARTED; c.turnOpen = false; c.watch = null;
    Object.assign(c, S.failurePatch({ stage: "send", title: "The agent has not started on its instructions", auth: false, agentCanFix: false, detail, next }));
  }, { waitMs: 10000 });
  const secs = Math.max(1, Math.round((Date.now() - m.at) / 1000));
  // Its program is gone, and the text with it, unless its saved conversation shows that the text went in first.
  if (!a && S.markerAlive(t.runner)) return; // a job of the board's own is starting its program again
  if (!a) return said() === true ? clear() : void lost(`The board typed the text into the agent's box ${secs} seconds ago. The agent's program ended before it started on it: nothing was submitted.`, `Retry (${keyName("yes")}) starts the agent's program again and hands it the text once more.`);
  if (m.busy) { // typed into a running turn: looked at from the moment the agent is at rest
    if (atRest(a)) { try { S.update(id, (c) => { if (!mine(c)) return false; c.sent = rest(c.sent, a); }, { waitMs: 10000 }); } catch {} }
    return;
  }
  if (took(m, a) !== false) return clear();
  if (Date.now() - (m.pressedAt || m.at) < waitMs(m)) return;
  if (took(m, a, said())) return clear();
  if (m.tries < TRIES) {
    // Counted before the key goes out: a pass that dies here presses once less, never without end.
    let go = false;
    S.update(id, (c) => { if (!mine(c) || c.stage !== "working") return false; go = true; c.sent = { ...c.sent, tries: m.tries + 1, pressedAt: Date.now() }; }, { waitMs: 10000 });
    if (go) { try { api.agentKeys(t.link.pane, "enter"); } catch {} }
    return;
  }
  lost(`The board typed the text into the agent's box ${secs} seconds ago and has pressed enter ${TRIES} more times since. The agent still sits at its prompt: nothing was submitted, and no work is going on.`,
    `Retry (${keyName("yes")}) starts the agent's program again and hands it the text once more. Or go into the agent and press enter yourself.`);
}
