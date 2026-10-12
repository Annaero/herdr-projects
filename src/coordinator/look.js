// What the board shows of the Coordinator: its state, latest message and screen; going into its chat.
import fs from "node:fs";
import * as S from "../store.js";
import { herdr, currentSocket, sessionName, socketExists, readScreen } from "../herdr.js";
import { adapter, readTurnOf } from "../agents.js";
import { get, home } from "./state.js";
import { choice, describe, sameChoice } from "./who.js";
import { open, typedThere } from "./requests.js";
import { pumping, active } from "./pump.js";

// ---- what the board shows ----------------------------------------------------------------------------------------------
// Read on every beat of the board: one small file, one `agent get`, and the end of the saved conversation when that
// file changed. `state` is one of: none, starting, working, blocked, idle, exited.
export const turns = new Map(), screens = new Map();
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
    turn, readable: !!adapter(run?.kind).readTurn, said: turn?.said || "", last: c.last || "",
    // Your newest words while they are not answered yet: still waiting to go in, or gone in with nothing new said
    // since (no other words, and no other finished turn: it may answer twice with the same "Done.").
    sent: (c.queue || []).length ? c.queue[c.queue.length - 1].said : c.last && adapter(run?.kind).readTurn && typeof c.over === "string" && c.over === (turn?.said || "") && !(turn?.finished && turn.id && String(turn.id) !== (c.overId || "")) ? c.last : "", unseen: turn?.finished && turn.id && turn.said && turn.id !== c.seen ? turn.id : "",
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
// Going into it: herdr moves to its real pane, as it does for any task's agent. Whatever is typed there, the box's
// last words no longer head its last message.
export function focus(v, socket = currentSocket()) { herdr(socket).agentFocus(v.pane); typedThere(socket); }
// "Go into the Coordinator's chat" from anywhere in herdr (a herdr key can ask for it): no board in between. Not
// running: it is started with nothing said first, and this waits for it.
export async function goIn(socket = currentSocket(), { waitMs = 90000, stepMs = 400 } = {}) {
  let asked = false;
  for (const until = Date.now() + waitMs; ;) {
    const v = look(socket);
    if (v.status && v.pane) { focus(v, socket); return v; }
    if (asked && v.error) throw new Error(`The Coordinator could not be started: ${v.error}`);
    if (!asked) { open(socket); asked = true; }
    if (Date.now() > until) throw new Error("The Coordinator did not start in time.");
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
// For the command line and for other machines.
export function summary(socket = currentSocket()) {
  const v = look(socket);
  return { state: v.state, agent: v.run?.kind || "", model: v.run?.model || "", effort: v.run?.effort || "", oneOff: v.oneOff, default: v.def ? describe(v.def) : "off", pane: v.pane, queued: v.queue, error: v.error, said: v.said };
}
