// The pump: the detached job that starts the Coordinator and types into it, one at a time per herdr session.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import { herdr, currentSocket, sessionName, socketExists } from "../herdr.js";
import { adapter, installed, startArgs, preTrust, versionOf } from "../agents.js";
import { dirOf, get, change, home } from "./state.js";
import { choice } from "./who.js";
import { rules } from "./rules.js";
import { restMs, trimmed, where, kick, send, stop, open, seen } from "./requests.js";
import { turns } from "./look.js";

// ---- the pump: one at a time per herdr session -------------------------------------------------------------------------
export const pumping = (c) => !!c?.pump && S.markerAlive(c.pump);
// Whoever ticks (the keeper, or the board without one) starts a pump for anything left waiting: a message that met a
// dialog on the Coordinator's screen is typed in once the dialog is gone.
export function tick(socket = currentSocket()) {
  const c = get(socket);
  if (!c || (!(c.queue || []).length && !c.want) || (pumping(c) && c.pump.pid !== process.pid) || !socketExists(socket)) return;
  if (c.stopped && !c.want) return; // stopped stays stopped, also with words still waiting: your next message starts it
  if (c.error && !c.want) return; // a start that failed is not tried again by itself: your next message does, or coordinator restart, or coordinator new
  if (S.due(`coordinator-${sessionName(socket)}`, 3000)) kick(socket);
}
function closeSpace(api, c) {
  if (c.workspace && api.workspaceGet(c.workspace)) { try { api.workspaceClose(c.workspace); } catch {} }
  else if (c.pane) api.paneClose(c.pane);
}
// The conversation it is in: the newest one saved in its folder since this Coordinator began. That finds the id of
// a program that names its own conversations (Codex), and follows the agent's own "new chat" command. Looked up
// wherever the id is needed, so a restart never depends on the board having looked first.
export function active(socket, c) {
  if (!c?.run) return c?.session || null;
  let id = null;
  try { id = adapter(c.run.kind).latestSession?.(home(socket), c.since || c.startedAt || 0) || null; } catch {}
  if (id && id !== c.session) { try { change(socket, (x) => { if (x.since !== c.since || x.session === id) return false; x.session = id; }); } catch {} }
  return id || c.session || null;
}
const LAUNCH_MAX = 1500;
function ensure(api, socket) {
  let c = get(socket);
  if (c.run) { active(socket, c); c = get(socket); }
  fs.mkdirSync(home(socket), { recursive: true });
  let pane = c.pane ? api.paneGet(c.pane) : null;
  if (!pane) {
    // A board kept somewhere else than the default (its data or settings folder) is the board its commands must reach.
    const env = Object.fromEntries(["HERDR_SUPERWORK_DATA_DIR", "HERDR_SUPERWORK_CONFIG_DIR"].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
    const res = api.workspaceCreate({ cwd: home(socket), label: "Coordinator", env });
    pane = res.root_pane || api.panes(res.workspace.workspace_id)[0];
    c = change(socket, (c) => { Object.assign(c, { socket, workspace: pane.workspace_id, tab: res.tab?.tab_id || pane.tab_id, pane: pane.pane_id, terminal: pane.terminal_id }); });
  }
  if (api.agentGet(pane.pane_id)) return { c, blocked: false };
  // Its program is not running: start it. The same conversation when there was one and the program can reopen it.
  const run = c.run || (c.pick ? { ...c.pick, oneOff: true } : choice());
  if (!run) throw new Error("The Coordinator is off. `herdr-superwork config coordinator default` turns it on.");
  if (!installed(run.kind)) throw new Error(`"${run.kind}" is not installed here, so it cannot be the Coordinator.`);
  const a = adapter(run.kind);
  const resume = c.run && c.session && a.resume && (() => { try { return !a.transcript || !!a.transcript(c.session, home(socket)); } catch { return false; } })() ? c.session : null;
  const session = !resume && a.newSession ? a.newSession() : null;
  fs.mkdirSync(dirOf(socket), { recursive: true });
  // herdr types the launch command into the pane's shell, and a terminal takes at most 4096 bytes on one line: a
  // longer one arrives cut off (seen with Codex, whose flag for standing rules carries the text itself, as an
  // unfinished quote at a shell continuation prompt). So where the rules would ride on the command line they are put
  // in a file and the flag only points at it. What the human says is never made to carry them.
  const rulesFile = path.join(dirOf(socket), "rules.md");
  fs.writeFileSync(rulesFile, rules());
  let standing = a.standing ? a.standing(rules(), dirOf(socket)) : [], pointer = false;
  if (standing.join(" ").length > LAUNCH_MAX) { pointer = true; standing = a.standing(`You are the Coordinator of the human's work board in herdr. Your standing rules are in the file ${rulesFile}: read it before your first reply, and again whenever you are unsure of them.`, dirOf(socket)); }
  preTrust(run.kind, home(socket));
  const taken = api.agents().filter((x) => x.pane_id !== pane.pane_id).map((x) => x.name);
  let name = "sw-coordinator";
  for (let n = 2; taken.includes(name); n++) name = `sw-coordinator-${n}`;
  let blocked = false;
  const began = Date.now();
  change(socket, (c) => { c.starting = began; });
  try { api.agentStart(name, run.kind, pane.pane_id, startArgs(run.kind, { model: run.model, effort: run.effort, resume, session, extra: standing })); }
  catch (e) {
    // A dialog is in the way (folder trust, first run): what you said waits. Anything else: the pane may hold half a
    // command or a program that never became ready, so it is closed and the next try starts in a clean one.
    if (e.code !== "agent_not_ready") { try { closeSpace(api, get(socket)); change(socket, (c) => { Object.assign(c, { workspace: null, tab: null, pane: null, terminal: null, agent: null, starting: 0 }); }); } catch {} throw e; }
    blocked = true;
  }
  c = change(socket, (c) => {
    c.run = run; c.pick = null; c.agent = name; c.startedAt = Date.now(); c.version = versionOf(run.kind) || ""; c.starting = 0;
    c.intro = !a.standing && !resume; // no launch flag for the rules at all: one line before the first message points at them
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
        if (w.what !== "open") closeSpace(api, c);
        c = change(socket, (c) => {
          if (c.want?.at === w.at) c.want = null;
          if (w.what === "open") return;
          Object.assign(c, { workspace: null, tab: null, pane: null, terminal: null, agent: null });
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
        try { api.agentPrompt(c.pane, c.intro ? `[Your standing rules as the Coordinator of the human's work board are in the file ${path.join(dirOf(socket), "rules.md")}: read it first.]\n\n${m.text}` : m.text); }
        catch (e) {
          if (["agent_blocked", "agent_not_ready"].includes(e.code)) { unsay(); stuck = true; break; }
          if (!["agent_prompt_stalled", "timeout"].includes(e.code)) { unsay(); throw e; } // herdr: these do not prove nothing was sent; never send twice
        }
        change(socket, (c) => { c.queue = c.queue.filter((x) => !same(x)); if (Array.isArray(c.where)) { for (const x of c.where) if (note && x.id === note.id) x.sentAt = Date.now(); c.where = trimmed(c.where); } c.mark = { run, seq, rest: !!ag && ["idle", "done"].includes(ag.agent_status) }; c.intro = false; c.sentAt = Date.now(); c.last = m.said; });
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
