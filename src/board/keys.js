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
//   draft  it is the board's key with a draft in the text box too (it changes nothing, so the draft is safe)
//   web    what its button is called on the web board (src/webui/), where a key is a button: the board's words name
//          it so there ("“Undo” brings it back")
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
  { id: "pageUp", keys: ["pageUp"], show: "pgup", group: "plain", help: "a page of tasks up or down (in the whole task: a page of its text)",
    doc: "a page up or down: ten tasks in the list, a page of text in the whole task",
    run: (v) => v.move(-10) },
  { id: "pageDown", keys: ["pageDown"], show: "pgdn", with: "pageUp",
    run: (v) => v.move(10) },
  { id: "enter", web: "Open agent", keys: ["enter", "return"], group: "plain", help: "send what is typed; with nothing typed, open this task's agent", hint: "open this task's agent",
    doc: "send what you typed; with nothing typed, open the task's agent: its real herdr pane. The board keeps running in its own tab and is there as you left it; your key goes back to it (as a popup it closes, and your key opens it again where it was)" },
  { id: "newline", keys: ["shift+enter"], fixed: true, hint: "new line",
    doc: "a new line in what you are typing. Like the cursor keys and backspace, it is the text box's own editing key, not a key of the board" },
  { id: "talk", web: "Talk", keys: [], raw: [" "], show: "space", group: "plain", help: "flip who you talk to: the Coordinator, or this task's agent", hint: "talk to this task's agent",
    doc: "flip who you talk to: the selected task's agent, and back to the Coordinator. The chat says who. Nothing else changes it: while it is a task's agent, moving with {up} {down} makes it the agent of the task you moved to. On a task with no agent, your message puts one on it",
    run: (v, r) => v.flipReply(r) },
  { id: "delegate", web: "Put an agent on this task", keys: ["tab"], group: "plain", help: "put an agent on this task", hint: "put an agent on this task",
    doc: "put an agent on the task. With text typed for the Coordinator: send it, and every task it adds from that message gets an agent at once, with nothing more to confirm (a message that adds no task delegates nothing)" },
  { id: "back", web: "Back", keys: ["escape"], show: "esc", group: "plain", help: "back, one step at a time (as a popup, the board closes on the last one)", hint: "back",
    doc: "back, one step at a time, and nothing else: find is left, a draft is put away, then the whole task, the filter and the archive close. With none of those left it shows the same hint as {close}; the board as a popup (`board.open`) closes on it. It never shows or hides the chat and never changes who you talk to" },
  { id: "menu", web: "More", keys: [], raw: ["?"], show: "?", group: "plain", help: "this menu", hint: "all keys",
    doc: "the menu: every key in these three groups, each line with its key. A ctrl or alt line can be picked with {up} {down} and {enter}, which does what its key does. It opens with no line picked. Under the keys, what a row shows: each mark with its word, the numbers on the right, and what the colour of a review tag and of a pull request say. Every line is whole (a long one wraps); where the window is too short for all of it the last line says how many lines are below, and {down} on the last key scrolls on down, {up} on the first scrolls up",
    run: (v) => { v.menu = { at: -1, top: 0 }; } },
  { id: "sayYes", web: "Yes", keys: ["y", "shift+y"], raw: ["y", "Y"], show: "y", gap: "  ", group: "plain", help: "answer a question: {sayYes} yes, {sayNo} or {back} no ({enter} never confirms)",
    doc: "answer a question the board asks: {sayYes} yes, {sayNo} or {back} no. Only while a question is up; {enter} never confirms" },
  { id: "sayNo", web: "No", keys: ["n", "shift+n"], raw: ["n", "N"], show: "n", with: "sayYes" },

  { id: "yes", web: "Yes", keys: ["ctrl+l"], group: "ctrl", hint: "retry the failed step",
    doc: "yes, to whatever the task waits for: approve the merge (it asks first), say yes to the agent, retry the step that went wrong as it stands, or take work that stopped without a summary as it is",
    menu: () => "yes: approve the merge, say yes, retry, take it as it is",
    run: (v, r) => (r ? v.yes(r) : undefined) },
  { id: "sendBack", web: "Send back", keys: ["ctrl+r"], group: "ctrl", hint: "tell this task's agent to fix it",
    doc: "send it back: whatever went wrong (a failed check, a conflict, an error, a review with findings) goes to the task's agent to fix; a stopped agent is told to continue",
    menu: () => "send it back: tell the agent to fix it, or to continue",
    run: (v, r) => (r ? v.sendBack(r) : undefined) },
  { id: "stop", web: "Stop", keys: ["ctrl+x"], group: "ctrl", hint: "stop this task's agent",
    doc: "stop the agent, when one is running (working, starting, checking, under review, or waiting for your answer); the selection stays on that row. On a task with no agent running (idle, never started, stopped, finished, archived) it asks to remove the task instead: {sayYes} removes it, its worktree too. A task you marked as your own work in progress has no agent to stop: there the key puts it back in to do. A stop never goes on to that question by itself: removing takes a second {stop}, and a {sayYes}",
    menu: (v, r) => (!r ? "stop the agent, or remove the task" : r.stage === "progress" ? "put this task back in to do" : v.running(r) ? "stop this task's agent" : "remove this task"),
    run: (v, r) => (r ? v.stop(r) : undefined) },
  { id: "archive", web: "Archive", keys: ["ctrl+a"], group: "ctrl", hint: "restore this task",
    doc: "archive the selected task, or restore it from the archive",
    menu: (v, r) => (r?.archivedAt ? "restore this task" : "archive this task"),
    run: (v, r) => (r ? v.archiveSelected(r) : v.flash("Select a task to archive or restore.")) },
  { id: "pin", web: "Pin", keys: ["ctrl+p"], group: "ctrl",
    doc: "pin the selected task to the top, or unpin it",
    menu: (v, r) => (r?.pinned ? "unpin this task" : "pin this task to the top"),
    run: (v, r) => (r ? v.pinTask(r) : undefined) },
  { id: "settings", keys: ["ctrl+e"], group: "ctrl",
    doc: "the selected task's settings, full screen: every work setting by its name, its value, and the place it comes from (this task, your entry for its repo, you, the repo's file, built in). {up} {down} move to a row; {enter} changes it (a switch or a choice goes to its next value, anything else is typed and saved with {enter}); rows that are this task's own are marked `*`. {putBack} puts the selected row back to what it would be without this task's own answer. {back} or {settings} again goes back ([settings.md](settings.md))",
    menu: (v) => (v.editing ? "back from this task's settings" : "this task's settings: see and change each one"),
    run: (v, r) => v.editSettings(r) },
  { id: "putBack", keys: ["ctrl+u"], with: "settings" }, // on the settings page only, which takes it itself (view/panel-edit.js)
  { id: "undo", web: "Undo", keys: ["ctrl+z"], group: "ctrl",
    doc: "undo: bring back a draft that was put away, or take the last archiving back",
    menu: (v) => (v.draftAway ? "undo: bring back what you typed" : v.archiveUndo ? "undo the archive" : "undo"),
    run: (v) => v.undo() },
  { id: "find", web: "Find", keys: ["ctrl+f"], group: "ctrl",
    doc: "find: type, and the list shows only the tasks that match, archived ones too. {enter} keeps the filter, {back} leaves find; {back} on the list clears a filter that is kept",
    menu: () => "find: show only the tasks that match",
    run: (v) => { v.mode = "find"; v.full = false; v.setValue(v.filter); } },
  { id: "free", keys: ["ctrl+k"], group: "ctrl",
    doc: "only while a remote view holds the board's terminal at another size than herdr shows it (the line at the top says so): end that view, so the board has its own size again ([board-size.md](board-size.md))",
    menu: (v) => (v.holder() ? "end the remote view that holds this pane at another size" : null),
    on: (v) => !!v.holder(),
    run: (v) => v.freeSize() },
  { id: "close", keys: ["ctrl+c"], group: "ctrl",
    doc: "twice: close the board, with text typed too: the draft is kept and is back when the board reopens",
    menu: () => "twice: close the board",
    run: (v) => v.closeHint() },

  { id: "chatMessage", keys: ["alt+c"], group: "alt",
    doc: "the chat's latest message, the Coordinator's or a task agent's. The one key for it, both ways",
    menu: (v) => `${v.chatOpen ? "hide" : "show"} the chat's latest message`,
    run: (v) => v.toggleChat() },
  { id: "chatScrollUp", keys: ["alt+u"], group: "alt", draft: true,
    doc: "more of a chat message that is longer than its box: {chatScrollUp} scrolls it up, {chatScrollDown} down, half a box at a time, also while you type. The box says where there is more, and names the key (`alt+u more ↑`, `alt+j more ↓`). The mouse wheel does the same with the pointer over the chat ([mouse.md](mouse.md))",
    menu: () => "scroll the chat's message up",
    run: (v) => v.scrollChat(-v.chatPage()) },
  { id: "chatScrollDown", keys: ["alt+j"], group: "alt", with: "chatScrollUp", draft: true,
    menu: () => "scroll the chat's message down",
    run: (v) => v.scrollChat(v.chatPage()) },
  { id: "side", keys: ["alt+p"], group: "alt",
    doc: "the side panel: the selected task, beside the list",
    menu: (v) => `${v.side ? "hide" : "show"} the side panel: this task, beside the list`,
    run: (v) => (v.full ? undefined : v.toggleSide()) },
  { id: "panel", web: "Open the task", keys: ["alt+t"], group: "alt",
    doc: "the whole task, full screen, and back to the list",
    menu: (v) => (v.full ? "back to the list" : "show the whole task, full screen"),
    run: (v) => (v.full ? v.foldPanel() : v.openPanel()) },
  { id: "archiveView", web: "Show the archive", keys: ["alt+a"], group: "alt",
    doc: "the archive, and back to the board",
    menu: (v) => `${v.archiveView ? "hide" : "show"} the archive`,
    run: (v) => v.toggleArchive() },
  { id: "automations", web: "Show the automations", keys: ["alt+o"], group: "alt",
    doc: "the automations, and back to the board: tasks made on a schedule or when something happens on the board, in a list of their own. There {up} {down} move between them, {enter} opens the selected one (its prompt, its trigger, its settings, its firings: {up} {down} pick a firing and {enter} goes to the task it made), {talk} turns it on or off, {delegate} fires it now, {stop} removes it (it asks first) and {settings} opens its settings, as a task's. What you type goes to the Coordinator, which makes and rewords them ([automations.md](automations.md))",
    menu: (v) => `${v.automationsView ? "hide" : "show"} the automations`,
    run: (v) => v.toggleAutomations() },
  { id: "byRepo", web: "Group by repo", keys: ["alt+s"], group: "alt",
    doc: "the list grouped by repo, each group under its repo's name (a row's tag never names a repo), or by status",
    menu: (v) => (v.byRepo ? "group by status" : "group by repo: see which repo each task is in"),
    run: (v) => v.toggleByRepo() },
  { id: "allDone", web: "Show all done", keys: ["alt+d"], group: "alt",
    doc: "every done task, or only the latest",
    menu: (v) => (v.allDone ? "show only the latest done" : "show all done"),
    run: (v) => v.toggleAllDone() },
  { id: "scope", web: "Other machines", keys: ["alt+m"], group: "alt",
    doc: "other machines: this machine only, every machine, then each machine by itself",
    menu: (v) => { const next = v.scopeNext(); return `${next === "" ? "show this machine's tasks only" : next === "*" ? "show every machine's tasks" : `show only ${next}'s tasks`} (now: ${v.scope === "" ? "this machine" : v.scope === "*" ? "every machine" : `only ${v.scope}`})`; },
    run: (v) => v.nextScope() },

];

export const KEY = Object.fromEntries(KEYS.map((k) => [k.id, k]));
const entry = (id) => { const k = KEY[id]; if (!k) throw new Error(`No key is called "${id}" (src/board/keys.js)`); return k; };

// Is this what was typed a chord that is not the board's own: the key herdr's config gives the board (view/place.js)?
export const pressed = (data, chord) => { try { return matchesKey(data, chord) || (chord.length === 1 && data === chord); } catch { return false; } };
// A chord as the old terminals send it: esc, then the letter, for alt. The board asks its terminal for the newer way
// (the kitty keyboard protocol) and is told it has it, and the key reader then takes esc-and-a-letter for alt no
// longer. A view that types into the pane from outside (the terminal view of herdr's web UI, in a browser or on a
// phone: checked on herdr-web-ui 0.4.8) still sends the old bytes, so every alt key was dead there.
const old = (chord) => { const m = /^alt\+([a-z0-9])$/.exec(chord); return m ? `\x1b${m[1]}` : ""; };
// Is this what was typed the key called `id`?
export const is = (data, id) => { const k = entry(id); return !!k.raw?.includes(data) || k.keys.some((c) => matchesKey(data, c) || (data.length === 2 && data === old(c))); };
// The key called `id` as the board writes it: "ctrl+a". `pair`: with the keys described in the same row ("↑ ↓").
// The web board (one thread of the front door, never the terminal's process) has buttons, not keys: there a key is
// named as its button is.
let buttons = false;
export const nameAsButtons = () => { buttons = true; };
const own = (k) => (buttons && k.web ? `“${k.web}”` : k.show || k.keys[0]);
export const name = (id, pair = false) => { const k = entry(id); return pair ? [k, ...KEYS.filter((x) => x.with === id)].map(own).join(k.gap || " ") : own(k); };
// The key that was typed, among those `pick` lets through.
export const typed = (data, pick = () => true) => KEYS.find((k) => pick(k) && is(data, k.id));
// A pair for the hint line: the key and its usual words, or the words this moment asks for.
// Words that name other keys as {id}, with each key as the board writes it.
export const say = (text) => String(text).replace(/\{(\w+)\}/g, (m, id) => name(id));
export const hint = (id, text) => [name(id), say(text ?? entry(id).hint)];
// The same key as a page writes it: `Ctrl+A`, `Esc`, `↑` `↓`.
export const written = (shown) => shown.split(/\s+/).map((c) => "`" + c.split("+").map((w) => (/^[a-z]{2,}$/.test(w) || (c.includes("+") && /^[a-z]$/.test(w)) ? w[0].toUpperCase() + w.slice(1) : w)).join("+") + "`").join(" ");
