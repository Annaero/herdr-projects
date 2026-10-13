// The pump: the detached job that starts the Coordinator and types into it, one at a time per herdr session.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import { herdr, currentSocket, sessionName, socketExists } from "../herdr.js";
import { adapter, installed, startArgs, preTrust, versionOf } from "../agents.js";
import { dirOf, get, change, home, pumping } from "./state.js";
import { openTab, moveOver, closePlace, nowhere } from "./place.js";
import { choice } from "./who.js";
import { writeRules, introLine } from "./rules.js";
import { restMs, trimmed, where, kick, send, stop, open, seen } from "./requests.js";
import { turns, look as lookNow } from "./look.js";
import { settle, hand, confirm, look, shown } from "../submit.js";

// ---- the pump: one at a time per herdr session -------------------------------------------------------------------------
// Whoever ticks (the keeper, or the board without one) starts a pump for anything left waiting: a message that met a
// dialog on the Coordinator's screen is typed in once the dialog is gone.
const UNSENT = "your message sits unsent in its box. Go into it and press enter.";
const saidIn = (socket, mark, text) => () => { const c = get(socket); return shown(c.run?.kind, { file: c.transcript || null, session: c.session, cwd: home(socket) }, mark, text); };
// Words typed into a turn the Coordinator was in the middle of (submit.js): one look per tick, at most one enter.
function lookTyped(socket, c) {
  const mark = { ...c.typed }, was = JSON.stringify(mark);
  const r = look(herdr(socket), c.pane, mark, saidIn(socket, mark, mark.text));
  const done = r === "took" || r === "unknown" || r === "lost";
  if (done || JSON.stringify(mark) !== was) change(socket, (x) => { if (x.typed?.typedAt !== c.typed.typedAt || x.typed?.at !== c.typed.at) return false; x.typed = done ? null : mark; if (r === "lost") x.error = UNSENT; });
}
export function tick(socket = currentSocket()) {
  let c = get(socket);
  // Still in the space of its own from before it lived in a tab: moved over as it is, whatever it is doing.
  if (c?.workspace && socketExists(socket) && !pumping(c) && S.due(`coordinator-move-${sessionName(socket)}`, 60000)) { try { moveOver(herdr(socket), socket, { quiet: true }); } catch {} c = get(socket); }
  if (c?.typed && c.pane && socketExists(socket) && !(pumping(c) && c.pump.pid !== process.pid)) { try { lookTyped(socket, c); } catch {} }
  if (!c || (!(c.queue || []).length && !c.want) || (pumping(c) && c.pump.pid !== process.pid) || !socketExists(socket)) return;
  if (c.stopped && !c.want) return; // stopped stays stopped, also with words still waiting: your next message starts it
  if (c.error && !c.want) return; // a start that failed is not tried again by itself: your next message does, or coordinator restart, or coordinator new
  if (S.due(`coordinator-${sessionName(socket)}`, 3000)) kick(socket);
}
// The conversation it is in: the newest one saved in its folder since this Coordinator began. That finds the id of
// a program that names its own conversations (Codex), and follows the agent's own "new chat" command. Looked up
// wherever the id is needed, so a restart never depends on the board having looked first.
export function active(socket, c) {
  if (!c?.run) return c?.session || null;
  let id = null;
  try { id = adapter(c.run.kind).latestSession?.(home(socket), c.since || c.startedAt || 0, S.movedFrom(home(socket))) || null; } catch {}
  if (id && id !== c.session) { try { change(socket, (x) => { if (x.since !== c.since || x.session === id) return false; x.session = id; }); } catch {} }
  return id || c.session || null;
}
function ensure(api, socket) {
  let c = get(socket);
  if (c.run) { active(socket, c); c = get(socket); }
  fs.mkdirSync(home(socket), { recursive: true });
  // Its standing rules are files in its folder, brought up to date here: before every message, so also when the
  // rules changed under a Coordinator that is running (it reads them at its next new chat).
  const who = c.run || c.pick || choice();
  if (who) { try { writeRules(home(socket), who.kind); } catch {} }
  let pane = c.pane ? api.paneGet(c.pane) : null;
  // From before it lived in a tab: moved over with its program running. A herdr that will not move it: its pane there
  // is closed (and with it the old space, unless panes of yours are in it) and it starts again in its tab, in the
  // same conversation.
  if (c.workspace) { try { pane = moveOver(api, socket); } catch { closePlace(api, c); change(socket, nowhere); pane = null; } }
  // A board kept somewhere else than the default (its data or settings folder) is the board its commands must reach.
  if (!pane) pane = openTab(api, socket, Object.fromEntries(["HERDR_SUPERWORK_DATA_DIR", "HERDR_SUPERWORK_CONFIG_DIR"].filter((k) => process.env[k]).map((k) => [k, process.env[k]])));
  c = get(socket);
  if (api.agentGet(pane.pane_id)) return { c, blocked: false };
  // Its program is not running: start it. The same conversation when there was one and the program can reopen it.
  const run = c.run || (c.pick ? { ...c.pick, oneOff: true } : choice());
  if (!run) throw new Error("The Coordinator is off. `herdr-superwork config coordinator default` turns it on.");
  if (!installed(run.kind)) throw new Error(`"${run.kind}" is not installed here, so it cannot be the Coordinator.`);
  const a = adapter(run.kind);
  const resume = c.run && c.session && a.resume && (() => { try { return !a.transcript || !!a.transcript(c.session, home(socket)); } catch { return false; } })() ? c.session : null;
  const session = !resume && a.newSession ? a.newSession() : null;
  // The rules ride on no launch flag: the program reads them from its folder (rules.js says why), so they are told
  // once, and the launch line stays short (herdr types it into the pane's shell, and a terminal takes at most 4096
  // bytes on one line). The file an older version pointed its flag at is gone with the flag.
  const { reads } = writeRules(home(socket), run.kind);
  try { fs.rmSync(path.join(dirOf(socket), "rules.md"), { force: true }); } catch {}
  preTrust(run.kind, home(socket));
  const taken = api.agents().filter((x) => x.pane_id !== pane.pane_id).map((x) => x.name);
  let name = "sw-coordinator";
  for (let n = 2; taken.includes(name); n++) name = `sw-coordinator-${n}`;
  let blocked = false;
  const began = Date.now();
  change(socket, (c) => { c.starting = began; });
  const args = startArgs(run.kind, { model: run.model, effort: run.effort, resume, session });
  try { api.agentStart(name, run.kind, pane.pane_id, args); settle(api, pane.pane_id, [run.kind, ...args].join(" ")); } // up before anything is typed (submit.js)
  catch (e) {
    // A dialog is in the way (folder trust, first run): what you said waits. Anything else: the pane may hold half a
    // command or a program that never became ready, so its tab is closed and the next try starts in a clean one.
    if (e.code !== "agent_not_ready") { try { closePlace(api, get(socket)); change(socket, (c) => { nowhere(c); c.starting = 0; }); } catch {} throw e; }
    blocked = true;
  }
  c = change(socket, (c) => {
    c.run = run; c.pick = null; c.agent = name; c.startedAt = Date.now(); c.version = versionOf(run.kind) || ""; c.starting = 0;
    c.intro = !reads && !resume; // a program not known to read a rules file: one line before the first message points at it
    if (!resume) { c.session = session; c.transcript = null; c.since = began; c.seen = null; }
  });
  return { c, blocked };
}
export function pump(socket = currentSocket()) {
  let mine = false;
  change(socket, (c) => { if (pumping(c) && c.pump.pid !== process.pid) return false; mine = true; c.pump = S.marker(); });
  if (!mine) return;
  const taken = new Set(); // the requests this pump took up
  try {
    const api = herdr(socket);
    for (let round = 0; round < 50; round++) {
      let c = get(socket);
      const w = c.want;
      if (w) {
        taken.add(w.at);
        if (w.what !== "open") closePlace(api, c);
        c = change(socket, (c) => {
          if (c.want?.at === w.at) c.want = null;
          if (w.what === "open") return;
          nowhere(c);
          if (w.what === "new") Object.assign(c, { run: null, pick: w.pick, session: null, transcript: null, seen: null, intro: false, last: "", where: [], mark: null });
        });
        // Stopped is stopped: words that were still waiting stay waiting, and go in with your next message. Only
        // something said after the stop was asked for starts it again.
        if (w.what === "stop") {
          c = change(socket, (c) => { c.stopped = !c.want && !(c.queue || []).some((m) => m.at > w.at); });
          if (c.stopped) break;
          continue;
        }
      } else if (!c.queue.length || c.stopped) break;
      const { blocked } = ensure(api, socket);
      if (blocked) break; // the tick tries again
      // It is there: whatever an earlier start failed on (written down after this request was made) is history.
      if (get(socket).error) change(socket, (c) => { c.error = ""; });
      c = get(socket);
      let stuck = false;
      for (const m of c.queue) {
        // Asked to stop (or restart, or begin anew) while an earlier message went in: that comes first, and the rest
        // of what was waiting is not sent ahead of it.
        if (get(socket).want) break;
        // Known before it reads the words: it may ask where they came from at once.
        // A message that is refused (a dialog is up) takes it back: it did not go in, and what is said about the
        // messages before it stays as it was.
        // Each message is its own (an id, not the time it was sent: two can share a millisecond), and the list is
        // only cut down once this one really went in, so a refused one costs an older one nothing. Before these
        // words go in: has this run of the program finished a turn since the last ones did, and is it at rest? Then
        // whatever went in a while ago has been dealt with. Typed in a moment ago, a message may not have set it
        // working yet, so that one is not counted.
        let ag = null; try { ag = api.agentGet(c.pane); } catch {}
        const run = get(socket).startedAt || 0, seq = ag?.completion_seq ?? null;
        if (ag && ["idle", "done"].includes(ag.agent_status) && seq != null) change(socket, (c) => {
          if (!c.mark || c.mark.run !== run || c.mark.seq === seq) return false;
          const due = (Array.isArray(c.where) ? c.where : []).filter((x) => !x.handled && x.sentAt && Date.now() - x.sentAt >= restMs());
          if (!due.length) return false;
          for (const x of due) x.handled = true;
        });
        const same = (x) => (m.id ? x.id === m.id : x.at === m.at && x.text === m.text);
        const note = m.where ? { ...m.where, said: m.said, at: m.at, id: m.id || `${m.at}` } : null;
        const said = (c) => (Array.isArray(c.where) ? c.where : []).filter((x) => x.id !== note.id);
        const unsay = () => { if (note) { try { change(socket, (c) => { c.where = said(c); }); } catch {} } };
        if (note) change(socket, (c) => { c.where = [...said(c), note]; });
        // What it had last said when these words went in: the board shows them in its place until it says something new.
        // (Its turn's id too: an answer in the very same words is still a new one.)
        let over = "", overId = ""; try { const now = lookNow(socket); over = now.said; overId = now.turn?.finished ? String(now.turn.id || "") : ""; } catch {}
        let typed = null;
        try { typed = hand(api, c.pane, c.intro ? `${introLine(home(socket))}\n\n${m.text}` : m.text); }
        catch (e) {
          if (["agent_blocked", "agent_not_ready"].includes(e.code)) { unsay(); stuck = true; break; }
          unsay(); throw e;
        }
        change(socket, (c) => { c.queue = c.queue.filter((x) => !same(x)); if (Array.isArray(c.where)) { for (const x of c.where) if (note && x.id === note.id) x.sentAt = Date.now(); c.where = trimmed(c.where); } c.mark = { run, seq, rest: !!ag && ["idle", "done"].includes(ag.agent_status) }; c.intro = false; c.sentAt = Date.now(); c.last = m.said; c.over = over; c.overId = overId; });
        // Typed is not sent: if it still sits at its prompt, enter is pressed again (never the words). Words that
        // stay in its box are said so on the board, and nothing more is typed on top of them.
        // Typed into a turn it was in the middle of: looked at again by the tick, once it is at rest.
        const words = typed?.busy ? [get(socket).typed?.text, m.text].filter(Boolean).join("\n\n") : m.text;
        change(socket, (c) => { c.typed = typed?.busy ? { ...typed, text: words } : null; });
        if (!confirm(api, c.pane, typed, saidIn(socket, typed, words))) throw new Error(UNSENT);
      }
      if (stuck) break;
    }
  } catch (e) {
    // Only the error is written down. A request made meanwhile (restart, new) is still there for the next pump, and
    // so are your words.
    try { change(socket, (c) => { c.error = S.oneLine(e.message, 300) || "it could not be started"; }); } catch {}
  } finally {
    let more = false;
    try { change(socket, (c) => { if (c.pump?.pid !== process.pid) return false; c.pump = null; c.starting = 0; more = !!c.want && !taken.has(c.want.at); }); } catch {}
    if (more) kick(socket); // asked for while this one ran
  }
}
