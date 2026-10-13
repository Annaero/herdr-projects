// Requests to the Coordinator: written down here (send, restart, new, stop, open), carried out by the pump.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as S from "../store.js";
import { herdr, currentSocket, socketExists } from "../herdr.js";
import { inline } from "../runner.js";
import { spawnLoose } from "../housekeeping.js";
import { get, change, home } from "./state.js";
import { choice, OFF_WORDS } from "./who.js";
import { turns } from "./look.js";
import { name as keyName } from "../board/keys.js";

// ---- requests: written down here, carried out by the pump --------------------------------------------------------------
// What the human types goes in word for word. Where they were (the repo, the task they had open) is kept beside it,
// and the Coordinator asks for it with `coordinator where`, so one conversation serves every repo the board is
// opened in. One thing is not left to its asking: a message sent with tab carries a line under the words saying so,
// since "start it right away" must not depend on the Coordinator remembering to look. The chat shows the words alone.
export const TAB_NOTE = `[Sent with ${keyName("delegate")} on the board: start every task you add from this message right away, without asking. Add each with "board add … --delegate"; if "board add" answers only "added", run "board delegate <id>". If this message leads to no new task, delegate nothing extra.]`;
export function context(cwd, { delegate = false, about = null } = {}) {
  const here = S.repoOf(cwd);
  const t = about ? S.get(about) : null;
  return { repo: here.name, root: here.root, task: t ? t.id : "", title: t ? S.oneLine(t.title, 120) : "", delegate: !!delegate };
}
// Said per message, the newest last: a second message sent while the first is still being worked on does not take
// the first one's repo or delegate choice away. Only messages that really went in are listed, and one is kept for as
// long as the Coordinator may still have it ahead of it. It counts as dealt with once the same run of its program
// has finished a turn since the last message went in and is at rest, a while after this one went in. At rest alone
// says nothing: a program that was restarted (or exited) in the middle of its work is idle with the work undone.
// Of those dealt with, the last few stay. One not dealt with yet is never dropped, however many there are.
const KEPT = 5;
export const restMs = () => Number(process.env.HERDR_SUPERWORK_HANDLED_MS ?? 15000);
export const trimmed = (list) => { const cut = list.length - KEPT; return list.filter((x, i) => i >= cut || !x.handled); };
export function where(socket = currentSocket()) {
  const list = get(socket)?.where || [];
  if (!list.length) return "Nothing was sent from the board yet, so it is not known which repo the human is in: ask them, or see \"board list\".";
  const one = (w) => [`"${S.oneLine(w.said, 80)}" was sent from the repo "${w.repo}" (${S.tilde(w.root)}).`,
    w.task ? `Task ${w.task} ("${w.title}") was open: for this message "it" and "this" mean that task.` : "No task was open.",
    w.delegate ? `It was sent with ${keyName("delegate")}: put an agent on every task you add from it, without asking.` : `It was sent with ${keyName("enter")}: delegate only what the human asked you to.`].join(" ");
  return [`The human's last ${list.length > 1 ? `${list.length} messages` : "message"} from the board${list.length > 1 ? ", the newest last. Each has its own repo, open task and delegate choice: use the ones of the message you are acting on" : ""}:`, ...list.map((w) => `- ${one(w)}`)].join("\n");
}
// The board's own half of "sent with tab": a task added from the Coordinator's pane is delegated by `add` itself when
// it can only come from a tab message, so a Coordinator that forgets the flag changes nothing. That is known when
// the last message went in while it was at rest and it has not finished a turn since (it is still in that
// message's turn), and no message it may still have ahead of it was sent with enter. Anything less clear (messages
// with different choices in flight, words that went in while it was busy, a restart) is left to the line the
// message carries.
export function tabTurn(pane, socket = currentSocket()) {
  const c = get(socket);
  // Moved into its tab while it ran (place.js), its program still names the pane it was started in.
  if (!pane || !c || (c.pane !== pane && c.paneWas !== pane) || !c.mark?.rest || c.mark.run !== (c.startedAt || 0)) return false;
  const open = (Array.isArray(c.where) ? c.where : []).filter((x) => x.sentAt && !x.handled);
  if (!open.length || !open.every((x) => x.delegate)) return false;
  let ag = null; try { ag = herdr(socket).agentGet(c.pane); } catch {}
  return !!ag && (ag.completion_seq ?? null) === c.mark.seq;
}
// The Coordinator's own folder (or one inside it) is never where the human is working.
export function inHome(dir, socket = currentSocket()) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const h = real(home(socket)), d = real(String(dir || ""));
  return d === h || d.startsWith(h + path.sep);
}
// The pump is told which herdr session it serves: the keeper ticks for several from one process.
export function kick(socket) {
  if (inline()) { (globalThis.__swJobs ||= []).push(["coordinator", socket, []]); return; }
  spawnLoose(["run", "coordinator", socket]);
}
// Say something to the Coordinator. It is started (or started again, in the same conversation) when it is not there.
export function send(cwd, text, opts = {}, socket = currentSocket()) {
  if (!socketExists(socket)) throw new Error("herdr is not running: the Coordinator lives in herdr.");
  const c = change(socket, (c) => { c.queue = [...(c.queue || []), { id: randomUUID(), text: opts.delegate ? `${text}\n\n${TAB_NOTE}` : String(text), said: String(text), where: context(cwd, opts), at: Date.now() }]; c.error = ""; c.stopped = false; });
  kick(socket);
  return c;
}
// restart: the same conversation, the program started again. new: a fresh conversation, on the default or on `pick`
// (a choice for that one Coordinator only). stop: close it; the next message starts it again where it left off.
// open: have it running, with nothing said (there must be a chat to go into).
function want(what, pick, socket) {
  if (!socketExists(socket)) throw new Error("herdr is not running: the Coordinator lives in herdr.");
  if (what !== "stop" && !pick && !get(socket)?.run && !choice()) throw new Error(OFF_WORDS);
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
// The chat on the board showed this finished message: it is not announced as new again.
export function seen(id, socket = currentSocket()) { try { change(socket, (c) => { if (!c.run || c.seen === id) return false; c.seen = id; }); } catch {} }
