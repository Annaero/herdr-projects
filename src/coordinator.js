// The Coordinator: the agent behind the box at the bottom of the board. One long-lived, ordinary herdr agent per herdr
// session, in a space of its own ("Coordinator"), started with the same arguments as any working agent: nothing is
// held back from it. What you type in the box is typed into that one conversation; it is kept across board
// openings, and resumed when the program exited or herdr restarted. Its state is one file beside the tasks.
//
// Nothing here blocks the board: `send`, `restart`, `fresh`, `stop` and `open` only write the request down and start
// the detached job (`pump`), which makes the herdr calls (an agent's start-up can take a while).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as S from "./store.js";
import * as F from "./flow.js";
import { herdr, currentSocket, sessionName, socketExists, readScreen } from "./herdr.js";
import { adapter, installed, startArgs, preTrust, readTurnOf, versionOf } from "./agents.js";
import { inline } from "./runner.js";
import { spawnLoose } from "./housekeeping.js";

const dirOf = (socket) => path.join(S.dataDir(), "coordinator", sessionName(socket));
const fileOf = (socket) => path.join(dirOf(socket), "state.json");
export const get = (socket = currentSocket()) => S.readJson(fileOf(socket)) || null;
function change(socket, fn) {
  return S.withLock(`coordinator:${sessionName(socket)}`, () => {
    const c = get(socket) || { queue: [] };
    if (fn(c) === false) return c;
    S.writeJson(fileOf(socket), c);
    return c;
  }, { waitMs: 5000 });
}
// Where it runs: a folder of its own (HERDR_SUPERWORK_COORDINATOR_DIR names another, which should be used for nothing
// else). It is one agent for the whole board, whichever repo the board was opened in, and a folder nothing else
// chats in is how its conversation is told from any other: the newest one saved there is the one it is in, also
// after its own "new chat" command (/clear, /new).
export const home = (socket = currentSocket()) => process.env.HERDR_SUPERWORK_COORDINATOR_DIR || path.join(dirOf(socket), "chat");

// ---- who it is ---------------------------------------------------------------------------------------------------------
// The default: `coordinator`, `coordinatorModel`, `coordinatorEffort`, set as the agent's own are; out of the box it
// is Claude Code on its default model and effort, whatever the working agent is set to. Any `herdr agent start --kind`
// value works. "off": no Coordinator.
export function choice() {
  const c = S.config();
  if (c.coordinator === "off") return null;
  return { kind: c.coordinator || S.DEFAULTS.coordinator, model: c.coordinatorModel, effort: c.coordinatorEffort };
}
// A choice for one Coordinator only ("new, on codex"): what is named wins, and a model or effort set for another
// program is not passed on to it.
export function pickOf({ agent, model, effort } = {}) {
  const base = choice() || { kind: S.DEFAULTS.coordinator, model: "", effort: "" };
  const kind = String(agent || "").trim().toLowerCase() || base.kind;
  if (!/^[a-z][a-z0-9_-]*$/.test(kind)) throw new Error("The Coordinator's agent must be an agent kind such as claude or codex.");
  if (!agent && !model && !effort) return null;
  const same = kind === base.kind;
  return { kind, model: String(model || "").trim() || (same ? base.model : ""), effort: String(effort || "").trim() || (same ? base.effort : "") };
}
export const describe = (k) => (k ? `${k.kind} · ${k.model || "default model"} · ${k.effort || "default effort"}` : "off");
export const sameChoice = (a, b) => !!a && !!b && a.kind === b.kind && (a.model || "") === (b.model || "") && (a.effort || "") === (b.effort || "");
// Can the box talk to a Coordinator here? It needs a running herdr to live in, and its program installed.
export function ready(socket = currentSocket()) {
  const k = choice();
  if (!k || !socketExists(socket)) return false;
  return !!get(socket)?.run || installed(k.kind); // one that is already there (a one-off, say) answers whatever the default is
}

// ---- its standing rules ------------------------------------------------------------------------------------------------
export function rules(cmd = F.shim()) {
  return `You are the Coordinator of the human's work board in herdr (herdr-superwork). You are an ordinary agent in a long-lived chat: you have all your tools, you may answer questions, look things up, ask the human something when you need to, and do what they ask of you. Your messages from the box at the bottom of the board start with a line in [square brackets] saying where the human is; the human sees your last message in a small drawer, so answer briefly and lead with the result.
The board's command is: ${cmd}  (written "board" below; always run it by that full path).
- Work the human describes ("fix the login page", "add dark mode") is not yours to do: file it as a task. board add "<short title: a few words, no trailing period>" --repo <repo> --desc "<the full description in your own clear words; Markdown is fine; keep every requirement the human gave>". One task per distinct piece of work. The description says only what to build or do: never put handling instructions in it (delegating, reviewers, models, settings); act on those with the command instead. Do the work yourself only when the human plainly asks you, yourself, to do it or to answer something.
- You run in a folder of your own, not in a repo and not in the human's home folder (${os.homedir()}): use full paths for the human's files, and every "board add" says where the task goes: --repo <a known repo's name, a folder name, or a path; "~" is the home folder>. That is the repo named in the bracket line, unless the human names another place ("in the other repo", "for project X", "in my home folder"). "board list" shows the tasks; "board list --archived" the archive; "board list --query <text>" searches everything; "board details <id>" says where one stands.
- If they ask to start it, delegate it, or hand it to an agent, also run: board delegate <id>. Agents get their own git worktree by default; add --no-worktree only if the human says to work in place, in their checkout, or without a worktree. Worktrees start from the remote's default branch; add --base head if the human says to build on their current branch or their unpushed work.
- Existing tasks: delegate them, "board tell <id> <text>" to say something to their agents (on a task that never had an agent it puts one on it with that message), "board stop <id>" to stop a task's agent at once, "board report <id> --state <idle|working|done> [--msg <one line>] [--progress <0 to 100>]" to say where one of the human's own tasks stands. "board clear <id>" only when the human plainly asks to delete or remove something. "board archive <id>" to archive or hide a task (kept, not deleted) and "board restore <id>" to bring it back; archived tasks are read-only until restored.
- Who does the work can be chosen per task: the working agent (--agent <kind such as claude or codex>, --model, --effort), the reviewer that attacks finished work and rates it 1 to 5 (--reviewer <kind>, or --reviewer off for none; reviewerModel, reviewerEffort, artifacts, serve), the Watcher that writes the "doing now" line (watcher on or off), and the review loop: reviewAuto (true: a rating below 5/5 goes back to the agent by itself), review (repos, all or none), rounds, conflictAuto (on by default: a conflict with main goes back to the task's agent by itself, at most "rounds" times in a row; false: it waits for the human to send it). If the human chooses any of these for a particular task ("with codex", "on high effort", "no reviewer for this one"), pass it to delegate as --<name> <value>, or run "board config <name> <value> --id <id>" if it is not being delegated now. If they choose one in general, run "board config <name> <value>".
- To send a review back to its agent: board review <id>. To send a saved error back: board retry <id>. To send failure details: board fix <id>.
- Settings (default agent, model, effort; the Watcher: watcher, watcherAgent, watcherModel; worktrees, the review loop, pull requests, how work is merged, cleanup, how many agents at once): "board config <key> <value>"; "board config" shows them. You are the Coordinator: coordinator, coordinatorModel and coordinatorEffort choose who the next Coordinator is by default. "board coordinator new [--agent <kind>] [--model <m>] [--effort <e>]" replaces you with a fresh one (with options: for that one only) and "board coordinator restart" restarts you in this same conversation; either ends your current turn, so say so first and run it last.
- Approve finished work ("approve it", "merge the poem one", "ship it") with: board approve <id>. Only when they plainly say so.
- A task's title: board report <id> --title "<new title>". Its description: board describe <id> "<the full new text>".
When you acted on the board, end with one short line saying what you did, naming the ids.`;
}

// ---- requests: written down here, carried out by the pump --------------------------------------------------------------
// One line of context before the human's words, so one conversation serves every repo the board is opened in.
export function compose(cwd, text, { delegate = false, about = null } = {}) {
  const here = S.repoOf(cwd);
  const t = about ? S.get(about) : null;
  const where = `[board: the human is in the repo "${here.name}" (${S.tilde(here.root)})${t ? `; task ${t.id} ("${S.oneLine(t.title, 120)}") is open, so "it" and "this" mean that task` : ""}]`;
  return `${where}\n${text}${delegate ? "\n\nDelegate what you file to an agent." : ""}`;
}
// The pump is told which herdr session it serves: the keeper ticks for several from one process.
function kick(socket) {
  if (inline()) { (globalThis.__swJobs ||= []).push(["coordinator", socket, []]); return; }
  spawnLoose(["run", "coordinator", socket]);
}
// Say something to the Coordinator. It is started (or started again, in the same conversation) when it is not there.
export function send(cwd, text, opts = {}, socket = currentSocket()) {
  if (!socketExists(socket)) throw new Error("herdr is not running: the Coordinator lives in herdr.");
  const c = change(socket, (c) => { c.queue = [...(c.queue || []), { text: compose(cwd, text, opts), said: String(text), at: Date.now() }]; c.error = ""; c.stopped = false; });
  kick(socket);
  return c;
}
// restart: the same conversation, the program started again. new: a fresh conversation, on the default or on `pick`
// (a choice for that one Coordinator only). stop: close it; the next message starts it again where it left off.
// open: have it running, with nothing said (the full-screen chat needs something to show).
function want(what, pick, socket) {
  if (!socketExists(socket)) throw new Error("herdr is not running: the Coordinator lives in herdr.");
  if (what !== "stop" && !pick && !get(socket)?.run && !choice()) throw new Error("The Coordinator is off. `herdr-superwork config coordinator default` turns it on.");
  const c = change(socket, (c) => { if (what === "open" && c.want) return false; c.want = { what, pick: pick || null, at: Date.now() }; c.error = ""; if (what !== "stop") c.stopped = false; });
  kick(socket);
  return c;
}
export const restart = (socket = currentSocket()) => want("restart", null, socket);
export const fresh = (pick = null, socket = currentSocket()) => want("new", pick, socket);
export const stop = (socket = currentSocket()) => want("stop", null, socket);
export const open = (socket = currentSocket()) => want("open", null, socket);
// Its own chat was on screen: whatever was typed there, the box's last words no longer head its last message.
export function typedThere(socket = currentSocket()) { try { change(socket, (c) => { if (!c.last) return false; c.last = ""; }); } catch {} }
// The drawer showed this finished message: it does not pop up for it again.
export function seen(id, socket = currentSocket()) { try { change(socket, (c) => { if (!c.run || c.seen === id) return false; c.seen = id; }); } catch {} }

// ---- the pump: one at a time per herdr session -------------------------------------------------------------------------
const pumping = (c) => !!c?.pump && S.markerAlive(c.pump);
// Whoever ticks (the keeper, or the board without one) starts a pump for anything left waiting: a message that met a
// dialog on the Coordinator's screen is typed in once the dialog is gone.
export function tick(socket = currentSocket()) {
  const c = get(socket);
  if (!c || (!(c.queue || []).length && !c.want) || (pumping(c) && c.pump.pid !== process.pid) || !socketExists(socket)) return;
  if (c.stopped && !c.want) return; // stopped stays stopped, also with words still waiting: your next message starts it
  if (c.error && !c.want) return; // a start that failed is not tried again by itself: your next message, alt+r or alt+n does
  if (S.due(`coordinator-${sessionName(socket)}`, 3000)) kick(socket);
}
function closeSpace(api, c) {
  if (c.workspace && api.workspaceGet(c.workspace)) { try { api.workspaceClose(c.workspace); } catch {} }
  else if (c.pane) api.paneClose(c.pane);
}
// The conversation it is in: the newest one saved in its folder since this Coordinator began. That finds the id of
// a program that names its own conversations (Codex), and follows the agent's own "new chat" command. Looked up
// wherever the id is needed, so a restart never depends on the board having looked first.
function active(socket, c) {
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
  // in a file, the flag only points at it, and the rules themselves go in with the first message.
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
    c.intro = (!a.standing || pointer) && !resume; // no launch flag that can hold the rules: they ride on the first message
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
          if (w.what === "new") Object.assign(c, { run: null, pick: w.pick, session: null, transcript: null, seen: null, intro: false, last: "" });
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
        try { api.agentPrompt(c.pane, c.intro ? `${rules()}\n\n${m.text}` : m.text); }
        catch (e) {
          if (["agent_blocked", "agent_not_ready"].includes(e.code)) { stuck = true; break; }
          if (!["agent_prompt_stalled", "timeout"].includes(e.code)) throw e; // herdr: these do not prove nothing was sent; never send twice
        }
        change(socket, (c) => { c.queue = c.queue.filter((x) => x.at !== m.at || x.text !== m.text); c.intro = false; c.sentAt = Date.now(); c.last = m.said; });
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

// ---- what the board shows ----------------------------------------------------------------------------------------------
// Read on every beat of the board: one small file, one `agent get`, and the end of the saved conversation when that
// file changed. `state` is one of: none, starting, working, blocked, idle, exited.
const turns = new Map(), screens = new Map();
export function look(socket = currentSocket()) {
  const c = get(socket);
  const def = choice();
  if (!c || (!c.run && !c.pane && !(c.queue || []).length && !c.want && !c.error)) return { state: "none", run: def, def, queue: 0, said: "", error: "", stale: false };
  let agent = null;
  if (c.pane && socketExists(socket)) { try { agent = herdr(socket).agentGet(c.pane); } catch {} }
  const status = agent ? agent.agent_status : null;
  const run = c.run || c.pick || c.want?.pick || def;
  const busy = pumping(c) || !!c.want;
  let turn = null;
  if (c.run) {
    const a = adapter(c.run.kind);
    const session = S.due(`coordinator-session-${sessionName(socket)}`, 3000) ? active(socket, c) : c.session;
    const key = `${socket}|${session}`;
    const hit = turns.get(key) || {};
    let file = hit.file;
    if (session && (!file || !fs.existsSync(file))) { try { file = a.transcript ? a.transcript(session, home(socket)) : null; } catch { file = null; } }
    let mtime = 0;
    try { mtime = file ? fs.statSync(file).mtimeMs : 0; } catch {}
    if (file && mtime !== hit.mtime) turns.set(key, { file, mtime, turn: readTurnOf(c.run.kind, { file }) });
    turn = turns.get(key)?.turn || null;
  }
  // While it is being launched herdr may already see its program in the pane: it is not ready until the start returned.
  const state = c.starting && pumping(c) ? "starting" : status === "working" ? "working" : status === "blocked" ? "blocked" : status ? "idle" : c.stopped && !c.want ? "exited" : busy || (c.queue || []).length ? "starting" : c.run ? "exited" : "none";
  return { state, status, run, oneOff: !!c.run?.oneOff, queue: (c.queue || []).length, waiting: (c.queue || []).map((m) => m.said), error: c.error || "", pane: c.pane || "", workspace: c.workspace || "", agent,
    turn, readable: !!adapter(run?.kind).readTurn, said: turn?.said || "", last: c.last || "", unseen: turn?.finished && turn.id && turn.said && turn.id !== c.seen ? turn.id : "",
    // The default changed since this one started: it keeps running as it is until you start a new one.
    stale: !!c.run && !c.run.oneOff && !!def && !sameChoice(c.run, def), def };
}
// What is on its screen, for when there is no message to show (a dialog, a program without a readable conversation).
export function screen(v, socket = currentSocket()) {
  if (!v.pane || !v.status) return "";
  const hit = screens.get(socket);
  if (hit && hit.pane === v.pane && Date.now() - hit.at < 2000) return hit.text;
  let text = "";
  try { text = readScreen(herdr(socket), v.pane, v.status === "idle" || v.status === "done" ? v.status : "working", 60); } catch {}
  text = text.split("\n").map((l) => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  screens.set(socket, { pane: v.pane, at: Date.now(), text });
  return text;
}
// "Open the board on the Coordinator's chat": a herdr key can ask for it, whether the board is open or not.
// Kept per herdr session, as the Coordinator is: a board open in another session must not take this one's request.
const fullFile = (socket) => path.join(dirOf(socket), "open-full");
export function askFull(socket = currentSocket()) { fs.mkdirSync(dirOf(socket), { recursive: true }); fs.writeFileSync(fullFile(socket), String(Date.now())); }
export function takeFull(socket = currentSocket()) {
  let at = 0;
  try { at = Number(fs.readFileSync(fullFile(socket), "utf8")) || 0; fs.rmSync(fullFile(socket), { force: true }); } catch { return false; }
  return Date.now() - at < 15000;
}
// For the command line and for other machines.
export function summary(socket = currentSocket()) {
  const v = look(socket);
  return { state: v.state, agent: v.run?.kind || "", model: v.run?.model || "", effort: v.run?.effort || "", oneOff: v.oneOff, default: v.def ? describe(v.def) : "off", pane: v.pane, queued: v.queue, error: v.error, said: v.said };
}
