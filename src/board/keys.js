// The board's keys, each one defined once: the ? menu, the hint line, the words that name a key and docs/keys.md are
// all made from this list. To add or change a key, change its entry here and run `node scripts/docs.js`.
//
// An entry:
//   id     its name in the code: K.is(data, "yes"), K.name("yes")
//   keys   the chords that press it, as pi-tui names them; the first is the one shown. To move an action to another
//          chord, change this and nothing else.
//   raw    characters compared as typed instead ("?", " ")
//   fixed  the text box owns this chord (pi-tui's editor): it is named here, and cannot be moved from here
//   show   how the key is written on the board, when that is not keys[0]
//   gap    what stands between it and the keys described with it, when that is not one space
//   doc    what it does, for docs/keys.md (`with`: it is described in another entry's row instead)
//          In doc, help and hint, another key is named as {id}, never by its chord: "{back} says no"
//   help   its short line under "keys" in the ? menu: only the keys worth remembering have one
//   hint   its usual words on the hint line (view/hints.js says them, and other words where the moment asks for them)
//   menu   (v, r, j) => its line in the ? menu right now, or nothing when it has none
//   run    (v, r) => what it does on the board with the text box empty, and from its menu line. A key with no `run`
//          is handled where the board's state decides (view/keys.js)
//   on     (v, r) => whether the key is the board's right now; otherwise it goes to the text box
//   early  it acts before anything else is looked at (the chat's keys); a draft in the text box still takes it
//
// The order is the order everywhere: docs/keys.md, the keys in the ? menu, the menu's lines.
import { matchesKey } from "@earendil-works/pi-tui";

const task = (v, r) => !!r;
const coordFree = (v) => !v.reply && v.canDispatch;

export const KEYS = [
  { id: "up", keys: ["up", "shift+up"], show: "↑", help: "move between tasks",
    doc: "move between tasks",
    run: (v) => v.move(-1) },
  { id: "down", keys: ["down", "shift+down"], show: "↓", with: "up",
    run: (v) => v.move(1) },
  { id: "pageUp", keys: ["pageUp"], show: "PgUp",
    doc: "ten tasks up or down",
    run: (v) => v.move(-10) },
  { id: "pageDown", keys: ["pageDown"], show: "PgDn", with: "pageUp",
    run: (v) => v.move(10) },
  { id: "groupUp", keys: ["alt+up"], show: "alt+↑",
    doc: "to the first task of the group above or below",
    run: (v) => v.jump(-1) },
  { id: "groupDown", keys: ["alt+down"], show: "alt+↓", with: "groupUp",
    run: (v) => v.jump(1) },
  { id: "top", keys: ["home"],
    doc: "in the whole task, full screen: to its top or its end ({up} {down} and {pageUp} {pageDown} scroll it)" },
  { id: "bottom", keys: ["end"], with: "top" },
  { id: "enter", keys: ["enter", "return"], help: "send, or open the agent", hint: "open the agent",
    doc: "send what you typed; with nothing typed, open the task's agent: its real herdr pane. The board closes (the first few times it says how to get back); your key brings it back where you left it" },
  { id: "newline", keys: ["shift+enter"], fixed: true, hint: "new line",
    doc: "a new line in what you are typing" },
  { id: "open", keys: ["right"], show: "→",
    doc: "open the selected task's agent, as {enter} does with nothing typed",
    on: task, run: (v, r) => v.chat(r) },
  { id: "talk", keys: [], raw: [" "], show: "space", help: "talk to this task's agent, or back to the Coordinator", hint: "reply",
    doc: "flip who you talk to: the selected task's agent, and back to the Coordinator. The chat says who. Nothing else changes it: while it is a task's agent, moving with {up} {down} makes it the agent of the task you moved to. On a task with no agent, your message puts one on it",
    run: (v, r) => v.flipReply(r) },
  { id: "delegate", keys: ["tab"], help: "put an agent on it", hint: "put an agent on it",
    doc: "put an agent on the task. With text typed for the Coordinator: send it, and every task it files from that message gets an agent at once, with nothing more to confirm (a message that files nothing delegates nothing)" },
  { id: "yes", keys: ["ctrl+a"], help: "yes: approve, retry, continue", hint: "retry",
    doc: "yes, to whatever the task waits for: approve the merge (it asks first), say yes to the agent, retry the step that went wrong as it stands, or take work that stopped without a summary as it is",
    run: (v, r) => (r ? v.yes(r) : undefined) },
  { id: "sayYes", keys: ["y", "shift+y"], raw: ["y", "Y"], show: "y", gap: "  ", help: "answer a question: {sayYes} yes, {sayNo} or {back} no ({enter} never confirms)",
    doc: "answer a question the board asks: {sayYes} yes, {sayNo} or {back} no. Only while a question is up; {enter} never confirms" },
  { id: "sayNo", keys: ["n", "shift+n"], raw: ["n", "N"], show: "n", with: "sayYes" },
  { id: "sendBack", keys: ["ctrl+r", "ctrl+g"], help: "send it back to fix", hint: "send it to the agent to fix",
    doc: "send it back: whatever went wrong (a failed check, a conflict, an error, a review with findings) goes to the task's agent to fix; a stopped agent is told to continue",
    run: (v, r) => (r ? v.sendBack(r) : undefined) },
  { id: "stop", keys: ["ctrl+x"], help: "stop the agent", hint: "stop",
    doc: "stop the agent. The selection stays on that row",
    run: (v, r) => (r ? v.stop(r) : undefined) },
  { id: "finishAnyway", keys: ["ctrl+y"],
    doc: "finish anyway: take a turn that stopped without a summary as finished work, and run the finish line on it",
    on: task, run: (v, r) => v.finishAnyway(r) },
  { id: "find", keys: ["ctrl+f"], help: "find",
    doc: "find",
    run: (v) => { v.mode = "find"; v.full = false; v.setValue(v.filter); } },
  { id: "panel", keys: ["ctrl+e"], help: "the whole task, full screen",
    doc: "the whole task, full screen, and back to the list",
    menu: (v, r, j) => (r || j) && (v.full ? "back to the list" : "show the whole task panel"),
    run: (v) => (v.full ? v.foldPanel() : v.openPanel()) },
  { id: "archive", keys: ["alt+a"],
    doc: "archive the selected task, or restore it from the archive",
    menu: (v, r) => r && (r.archivedAt ? "restore from the archive" : "archive"),
    run: (v, r) => (r ? v.archiveSelected(r) : v.flash("Select a task to archive or restore.")) },
  { id: "pin", keys: ["ctrl+t"],
    doc: "pin the selected task to the top, or unpin it",
    menu: (v, r) => r && !r.archivedAt && (r.pinned ? "unpin" : "pin to the top"),
    on: task, run: (v, r) => v.pinTask(r) },
  { id: "delete", keys: ["delete"],
    doc: "delete the selected task (it asks first)",
    menu: (v, r) => r && "delete",
    run: (v, r) => (r ? v.remove(r) : undefined) },
  { id: "undo", keys: ["ctrl+z"],
    doc: "undo: bring back a draft that was put away, or take the last archiving back",
    menu: (v) => (v.draftAway || v.archiveUndo) && (v.draftAway ? "bring back what you typed" : "undo the archive"),
    run: (v) => v.undo() },
  { id: "archiveView", keys: ["alt+h"],
    doc: "open the archive, and back to the board",
    menu: (v) => (v.archiveView ? "back to the board" : "open the archive"),
    run: (v) => v.toggleArchive() },
  { id: "side", keys: ["ctrl+p"], help: "side panel, on or off",
    doc: "the side panel, on or off (`Ctrl+B` is herdr's own prefix key, so this is the side panel's)",
    menu: (v) => !v.full && (v.side ? "hide the side panel" : "show the side panel"),
    run: (v) => (v.full ? undefined : v.toggleSide()) },
  { id: "byRepo", keys: ["ctrl+s"],
    doc: "group the list by repo, or by state",
    menu: (v) => (v.byRepo ? "group by state" : "group by repo"),
    run: (v) => v.toggleByRepo() },
  { id: "allDone", keys: ["ctrl+d"],
    doc: "show every done task, or only the latest",
    menu: (v) => (v.allDone ? "show only the latest done" : "show all done"),
    run: (v) => v.toggleAllDone() },
  { id: "chat", keys: ["alt+c"], early: true,
    doc: "into the whole chat of whoever the chat talks to: the Coordinator's or the task agent's own pane. The board closes",
    menu: (v, r) => v.chatOf(r)?.enter && (v.reply && r ? "open this agent's chat" : "open the Coordinator's chat"),
    run: (v) => v.openChat() },
  { id: "chatMessage", keys: ["alt+v"], early: true,
    doc: "show or hide the chat's latest message, the Coordinator's or a task agent's. The one key for it, both ways",
    menu: (v, r) => v.chatOf(r)?.said && (v.chatOpen ? "hide the latest message in the chat" : "show the latest message in the chat"),
    run: (v) => v.toggleChat() },
  { id: "coordRestart", keys: ["alt+r"], early: true,
    doc: "restart the Coordinator: the same conversation, the program started again (it asks first)",
    menu: (v) => coordFree(v) && v.coord.state !== "none" && "restart the Coordinator",
    on: coordFree, run: (v) => v.coordAct("restart") },
  { id: "coordNew", keys: ["alt+n"], early: true,
    doc: "start a new Coordinator, with a fresh conversation (it asks first)",
    menu: (v) => coordFree(v) && v.coord.state !== "none" && "start a new Coordinator",
    on: coordFree, run: (v) => v.coordAct("new") },
  { id: "scope", keys: ["ctrl+o"],
    doc: "other machines: this machine only, every machine, then each machine by itself. The {menu} menu names each stop",
    run: (v) => v.nextScope() },
  { id: "jobDown", keys: ["ctrl+down"], show: "ctrl+↓",
    doc: "down to the words on their way to another machine, and back up to the list",
    run: (v) => v.stepJob(1) },
  { id: "jobUp", keys: ["ctrl+up"], show: "ctrl+↑", with: "jobDown", hint: "back to the list",
    run: (v) => v.stepJob(-1) },
  { id: "takeBack", keys: ["alt+w"],
    doc: "disconnect another viewer that holds the board's terminal at its own size. Only while one does" },
  { id: "menu", keys: [], raw: ["?"], show: "?", help: "this menu", hint: "more",
    doc: "a menu of everything else for the selected task, picked with {up} {down} and {enter}: the whole task full screen, the side panel, archive, pin, delete, undo, the archive, group by repo, show all done, other machines, the Coordinator. Under them, the keys worth remembering and what a row's `R#2 ✓` review tag says; where the window is too short for all of it, {down} on the menu's last line scrolls on down, and {up} comes back",
    run: (v) => { v.menu = { at: 0 }; } },
  { id: "back", keys: ["escape"], show: "esc", help: "one step back: a draft, find, the whole task, the filter, the archive", hint: "back",
    doc: "back, one step at a time, and nothing else: find is left, a draft is put away, then the whole task, the filter and the archive close. With none of those left it shows the same hint as {close}. It never shows or hides the chat, never changes who you talk to, and never closes the board by itself" },
  { id: "close", keys: ["ctrl+c"], help: "twice: close the board",
    doc: "twice: close the board, with text typed too: the draft is kept and is back when the board reopens" },
];

export const KEY = Object.fromEntries(KEYS.map((k) => [k.id, k]));
const entry = (id) => { const k = KEY[id]; if (!k) throw new Error(`No key is called "${id}" (src/board/keys.js)`); return k; };

// Is this what was typed the key called `id`?
export const is = (data, id) => { const k = entry(id); return !!k.raw?.includes(data) || k.keys.some((c) => matchesKey(data, c)); };
// The key called `id` as the board writes it: "ctrl+a". `pair`: with the keys described in the same row ("↑ ↓").
const own = (k) => k.show || k.keys[0];
export const name = (id, pair = false) => { const k = entry(id); return pair ? [k, ...KEYS.filter((x) => x.with === id)].map(own).join(k.gap || " ") : own(k); };
// The key that was typed, among those `pick` lets through.
export const typed = (data, pick = () => true) => KEYS.find((k) => pick(k) && is(data, k.id));
// A pair for the hint line: the key and its usual words, or the words this moment asks for.
// Words that name other keys as {id}, with each key as the board writes it.
export const say = (text) => String(text).replace(/\{(\w+)\}/g, (m, id) => name(id));
export const hint = (id, text) => [name(id), say(text ?? entry(id).hint)];
// The keys worth remembering, for the ? menu.
export const remembered = () => KEYS.filter((k) => k.help).map((k) => [name(k.id, true), say(k.help)]);

// The same key as a page writes it: `Ctrl+A`, `Esc`, `↑` `↓`.
export const written = (shown) => shown.split(/\s+/).map((c) => "`" + c.split("+").map((w) => (/^[a-z]{2,}$/.test(w) || (c.includes("+") && /^[a-z]$/.test(w)) ? w[0].toUpperCase() + w.slice(1) : w)).join("+") + "`").join(" ");
