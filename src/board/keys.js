// The board's keys, each one defined once: the ? menu, the hint line, the words that name a key and docs/keys.md are
// all made from this list. To add or change a key, change its entry here and run `node scripts/docs.js`.
//
// One rule sorts them: ctrl does something; alt only shows or hides a part of the screen and never changes anything.
// A chord that is not in this list does nothing on the board.
//
// An entry:
//   id     its name in the code: K.is(data, "yes"), K.name("yes")
//   keys   the chords that press it, as pi-tui names them; the first is the one shown. To move an action to another
//          chord, change this and nothing else.
//   raw    characters compared as typed instead ("?", " ")
//   fixed  the text box owns this chord (pi-tui's editor): it is named here, and cannot be moved from here
//   show   how the key is written on the board, when that is not keys[0]
//   gap    what stands between it and the keys described with it, when that is not one space
//   group  where it stands in the ? menu and in docs/keys.md: "plain", "ctrl" (does something) or "alt" (only shows
//          or hides). Only a `fixed` key has none: it is the text box's, not the board's
//   doc    what it does, for docs/keys.md (`with`: it is described in another entry's row instead)
//          In doc, help and hint, another key is named as {id}, never by its chord: "{back} says no"
//   help   a plain key's line in the ? menu
//   hint   its usual words on the hint line (view/hints.js says them, and other words where the moment asks for them)
//   menu   (v, r) => a ctrl or alt key's line in the ? menu right now. The line can be picked there: that runs `run`
//   run    (v, r) => what it does on the board with the text box empty, and from its menu line. A key with no `run`
//          is handled where the board's state decides (view/keys.js)
//   on     (v, r) => whether the key is the board's right now; otherwise it goes to the text box
//
// The order is the order everywhere: docs/keys.md and the ? menu.
import { matchesKey } from "@earendil-works/pi-tui";

// The groups, in the order the ? menu and docs/keys.md show them.
export const GROUPS = [["plain", "plain keys"], ["ctrl", "ctrl: does something"], ["alt", "alt: only shows or hides"]];

export const KEYS = [
  { id: "up", keys: ["up"], show: "↑", group: "plain", help: "move between tasks",
    doc: "move between tasks",
    run: (v) => v.move(-1) },
  { id: "down", keys: ["down"], show: "↓", with: "up",
    run: (v) => v.move(1) },
  { id: "enter", keys: ["enter", "return"], group: "plain", help: "send what is typed; with nothing typed, open the task's agent", hint: "open the agent",
    doc: "send what you typed; with nothing typed, open the task's agent: its real herdr pane. The board keeps running in its own tab and is there as you left it; your key goes back to it" },
  { id: "newline", keys: ["shift+enter"], fixed: true, hint: "new line",
    doc: "a new line in what you are typing. Like the cursor keys and backspace, it is the text box's own editing key, not a key of the board" },
  { id: "talk", keys: [], raw: [" "], show: "space", group: "plain", help: "flip who you talk to: the Coordinator, or this task's agent", hint: "reply",
    doc: "flip who you talk to: the selected task's agent, and back to the Coordinator. The chat says who. Nothing else changes it: while it is a task's agent, moving with {up} {down} makes it the agent of the task you moved to. On a task with no agent, your message puts one on it",
    run: (v, r) => v.flipReply(r) },
  { id: "delegate", keys: ["tab"], group: "plain", help: "put an agent on the task", hint: "put an agent on it",
    doc: "put an agent on the task. With text typed for the Coordinator: send it, and every task it adds from that message gets an agent at once, with nothing more to confirm (a message that adds no task delegates nothing)" },
  { id: "back", keys: ["escape"], show: "esc", group: "plain", help: "back, one step at a time", hint: "back",
    doc: "back, one step at a time, and nothing else: find is left, a draft is put away, then the whole task, the filter and the archive close. With none of those left it shows the same hint as {close}. It never shows or hides the chat, never changes who you talk to, and never closes the board by itself" },
  { id: "menu", keys: [], raw: ["?"], show: "?", group: "plain", help: "this menu", hint: "more",
    doc: "the menu: every key in these three groups, each line with its key. A ctrl or alt line can be picked with {up} {down} and {enter}, which does what its key does. Under the keys, what a row's `R#2 ✓` review tag says; where the window is too short for all of it, {down} on the last line scrolls on down, and {up} on the first scrolls up",
    run: (v) => { v.menu = { at: 0 }; } },
  { id: "sayYes", keys: ["y", "shift+y"], raw: ["y", "Y"], show: "y", gap: "  ", group: "plain", help: "answer a question: {sayYes} yes, {sayNo} or {back} no ({enter} never confirms)",
    doc: "answer a question the board asks: {sayYes} yes, {sayNo} or {back} no. Only while a question is up; {enter} never confirms" },
  { id: "sayNo", keys: ["n", "shift+n"], raw: ["n", "N"], show: "n", with: "sayYes" },

  { id: "yes", keys: ["ctrl+l"], group: "ctrl", hint: "retry",
    doc: "yes, to whatever the task waits for: approve the merge (it asks first), say yes to the agent, retry the step that went wrong as it stands, or take work that stopped without a summary as it is",
    menu: () => "yes: approve the merge, say yes, retry, take it as it is",
    run: (v, r) => (r ? v.yes(r) : undefined) },
  { id: "sendBack", keys: ["ctrl+r"], group: "ctrl", hint: "send it to the agent to fix",
    doc: "send it back: whatever went wrong (a failed check, a conflict, an error, a review with findings) goes to the task's agent to fix; a stopped agent is told to continue",
    menu: () => "send it back to the agent",
    run: (v, r) => (r ? v.sendBack(r) : undefined) },
  { id: "stop", keys: ["ctrl+x"], group: "ctrl", hint: "stop",
    doc: "stop the agent, when one is running (working, starting, checking, under review, or waiting for your answer); the selection stays on that row. On a task with no agent running (idle, never started, stopped, finished, archived) it asks to remove the task instead: {sayYes} removes it, its worktree too. A stop never goes on to that question by itself: removing takes a second {stop}, and a {sayYes}",
    menu: (v, r) => (!r ? "stop the agent, or remove the task" : v.running(r) ? "stop the agent" : "remove the task"),
    run: (v, r) => (r ? v.stop(r) : undefined) },
  { id: "archive", keys: ["ctrl+a"], group: "ctrl", hint: "restore",
    doc: "archive the selected task, or restore it from the archive",
    menu: (v, r) => (r?.archivedAt ? "restore the task from the archive" : "archive the task"),
    run: (v, r) => (r ? v.archiveSelected(r) : v.flash("Select a task to archive or restore.")) },
  { id: "pin", keys: ["ctrl+p"], group: "ctrl",
    doc: "pin the selected task to the top, or unpin it",
    menu: (v, r) => (r?.pinned ? "unpin" : "pin to the top"),
    run: (v, r) => (r ? v.pinTask(r) : undefined) },
  { id: "suggested", keys: ["ctrl+n"], group: "ctrl", hint: "suggested task",
    doc: "suggested tasks: asks about the selected task's first open suggestion, or goes to the first task that has one. In that question {sayYes} makes it a task, {sayNo} dismisses it and {back} leaves it for later ([suggestions.md](suggestions.md))",
    menu: (v) => (v.suggestionCount() ? `suggested tasks (${v.suggestionCount()}): make one a task, or dismiss it` : "suggested tasks: none wait"),
    run: (v) => v.suggestKey() },
  { id: "undo", keys: ["ctrl+z"], group: "ctrl",
    doc: "undo: bring back a draft that was put away, or take the last archiving back",
    menu: (v) => (v.draftAway ? "undo: bring back what you typed" : v.archiveUndo ? "undo the archive" : "undo"),
    run: (v) => v.undo() },
  { id: "find", keys: ["ctrl+f"], group: "ctrl",
    doc: "find",
    menu: () => "find",
    run: (v) => { v.mode = "find"; v.full = false; v.setValue(v.filter); } },
  { id: "close", keys: ["ctrl+c"], group: "ctrl",
    doc: "twice: close the board, with text typed too: the draft is kept and is back when the board reopens",
    menu: () => "twice: close the board",
    run: (v) => v.closeHint() },

  { id: "chatMessage", keys: ["alt+c"], group: "alt",
    doc: "the chat's latest message, the Coordinator's or a task agent's. The one key for it, both ways",
    menu: (v) => `${v.chatOpen ? "hide" : "show"} the chat's latest message`,
    run: (v) => v.toggleChat() },
  { id: "side", keys: ["alt+p"], group: "alt",
    doc: "the side panel",
    menu: (v) => `${v.side ? "hide" : "show"} the side panel`,
    run: (v) => (v.full ? undefined : v.toggleSide()) },
  { id: "panel", keys: ["alt+t"], group: "alt",
    doc: "the whole task, full screen, and back to the list",
    menu: (v) => (v.full ? "back to the list" : "the whole task, full screen"),
    run: (v) => (v.full ? v.foldPanel() : v.openPanel()) },
  { id: "archiveView", keys: ["alt+a"], group: "alt",
    doc: "the archive, and back to the board",
    menu: (v) => `${v.archiveView ? "hide" : "show"} the archive`,
    run: (v) => v.toggleArchive() },
  { id: "byRepo", keys: ["alt+s"], group: "alt",
    doc: "the list grouped by repo, or by status",
    menu: (v) => (v.byRepo ? "group by status" : "group by repo"),
    run: (v) => v.toggleByRepo() },
  { id: "allDone", keys: ["alt+d"], group: "alt",
    doc: "every done task, or only the latest",
    menu: (v) => (v.allDone ? "show only the latest done" : "show all done"),
    run: (v) => v.toggleAllDone() },
  { id: "scope", keys: ["alt+m"], group: "alt",
    doc: "other machines: this machine only, every machine, then each machine by itself",
    menu: (v) => `other machines (now: ${v.scope === "" ? "this machine only" : v.scope === "*" ? "every machine" : `only ${v.scope}`})`,
    run: (v) => v.nextScope() },

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
// The same key as a page writes it: `Ctrl+A`, `Esc`, `↑` `↓`.
export const written = (shown) => shown.split(/\s+/).map((c) => "`" + c.split("+").map((w) => (/^[a-z]{2,}$/.test(w) || (c.includes("+") && /^[a-z]$/.test(w)) ? w[0].toUpperCase() + w.slice(1) : w)).join("+") + "`").join(" ");
