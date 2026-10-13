// The board's keys, and the text box owning the keyboard.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { world, settle } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { open } from "./board-helpers.js";

test("the board's keys: typing adds a task, tab puts an agent on it, space replies to it, enter opens the agent", async (tt) => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    process.env.HERDR_ENV = "1";
    w.script({ worker: [{ status: "working", screen: "● Editing greet.sh\n  esc to interrupt\n" }] });
    const s = open(w, { rows: 36, ctx: { popup: true } });
    s.type("Add a greeting");
    assert.match(s.text(), /\n *\n \+ New task {2}[^\n]*\n─[^\n]*\n❯ Add a greeting/); assert.match(s.text(), /enter add it as a task · tab add it and put an agent on it · shift\+enter new line · esc put away/);
    s.press("enter");
    assert.equal(S.get("proj/1").title, "Add a greeting"); assert.equal(s.v.sel, "proj/1"); assert.equal(s.v.value(), "");
    assert.match(s.text(), /\n[ ▌] {1}tab put an agent on this task · space talk about this task · esc close · \? all keys/);
    s.press("enter"); assert.match(s.text(), /No agent has been on this yet/);
    s.press("tab");
    await settle("proj/1"); s.v.load();
    assert.match(s.text(), /\n working +│[^\n]*\n[ ▌]◐ #\d+ Add a greeting/);
    assert.doesNotMatch(s.text(), /On its screen|Editing greet|esc to interrupt/); // nothing of the program's screen is shown: the row says what the agent is doing
    assert.match(s.text(), /\n[ ▌] {1}enter open this task's agent · space talk to the agent · ctrl\+x stop the agent · esc close · \? all keys/);
    // space: the text box now belongs to this task's agent, and says so for as long as you type
    s.press("space");
    assert.match(s.text(), /\n *\n[ ▌]. #\d+ Add a greeting {2}[^\n]*\n(?:[^\n]*\n)*?│ ❯ Send message to Agent/);
    w.script({ worker: [{ status: "working" }] });
    s.type("also say goodbye");
    assert.match(s.text(), /\n *\n[ ▌]. #\d+ Add a greeting {2}[^\n]*\n(?:[^\n]*\n)*?│ ❯ also say goodbye/); assert.match(s.text(), /enter send to this task's agent · shift\+enter new line · esc put away/);
    s.press("enter");
    // What you just sent stands in the box, in place of what the agent had said, until it says something new.
    assert.match(s.text(), /\n╭─[^\n]*╮\n│ You: +│\n│ also say goodbye +│\n│ +│\n│ ❯ Send message to Agent +│\n╰─+╯\n/); assert.doesNotMatch(s.text(), /Sent to the agent/);
    const t = S.get("proj/1");
    assert.match(w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts.at(-1), /also say goodbye/);
    // esc has nothing to go back from here: it never hides the chat's message and never changes who you talk to.
    // This board is the popup, so that last esc closes it (a board in a pane only shows how it closes: the test
    // about closing). alt+c is the one key for the message, space the one key for who.
    assert.match(s.text(), /esc close · space back to the Coordinator/); assert.doesNotMatch(s.text(), /esc hide|esc back/); // (the popup's "esc close" has the place of the chat's own key, which the ? menu has too) assert.match(s.text(), /space back to the Coordinator *$/);
    s.press("esc"); assert.equal(s.v.chatOpen, true); assert.equal(s.v.reply, true); assert.equal(s.v.ask, null); assert.equal(s.closed(), null); assert.ok(!s.v.closing);
    s.press("\x1bc"); assert.equal(s.v.chatOpen, false); assert.equal(s.v.reply, true); assert.match(s.text(), /\n *\n[ ▌]. #\d+ Add a greeting {2}[^\n]*\n─[^\n]*\n❯ Send message to Agent *\n─+\n[^\n]*alt\+c show the latest message/);
    s.press("\x1bc"); assert.equal(s.v.chatOpen, true);
    s.press("space"); assert.equal(s.v.reply, false); assert.match(s.text(), /\n *\n \+ New task {2}[^\n]*\n─[^\n]*\n❯/);
    // enter: focus the agent's real pane by pane id; the popup closes for it, and selection and filter come back on reopen
    s.press("enter");
    assert.deepEqual(s.closed(), { entered: "proj/1" });
    assert.ok(w.state().focus.includes(`agent ${t.link.pane}`));
    s.v.dispose();
    // The popup keeps its view in a file of its own: a board in a tab may be open beside it, with its own selection.
    assert.equal(S.readJson(path.join(S.dataDir(), "view-popup.json")).sel, "proj/1"); assert.equal(S.readJson(path.join(S.dataDir(), "view.json")), null);
    // ctrl+x stops the agent, and the selection stays on that row. The stop asks nothing and deletes nothing: only a
    // second ctrl+x, on the task that now has no agent running, asks to remove it, and only y would.
    A.add(w.root, "Another one"); A.add(w.root, "And one more");
    const s2 = open(w, { ctx: { popup: true } });
    assert.equal(s2.v.sel, "proj/1");
    s2.press("ctrl+x");
    assert.equal(S.get("proj/1").stage, "stopped"); assert.match(s2.text(), /Stopped #1 "Add a greeting"\./); assert.equal(s2.v.sel, "proj/1"); assert.equal(s2.v.ask, null);
    s2.press("?"); assert.match(s2.text(), /ctrl\+x +remove this task/); s2.press("esc");
    s2.press("ctrl+x");
    assert.equal(s2.v.sel, "proj/1"); assert.match(s2.text(), /\n[ ▌]\? Remove #1 "Add a greeting"\?[^?]*\n {3}y = remove · n = keep/);
    s2.press("enter", "ctrl+x"); assert.ok(s2.v.ask); s2.press("n"); assert.equal(s2.v.ask, null); assert.ok(S.get("proj/1")); assert.ok(S.get("proj/2")); assert.ok(S.get("proj/3"));
    // the first few times, the popup says how to get back before it closes for an agent
    const tui = { terminal: { rows: 34, columns: 120 }, requestRender() {}, stop() {}, start() {} };
    let closed;
    tt.mock.timers.enable({ apis: ["setTimeout"] }); // the board closes a moment after the line shows: the clock is moved, not waited for
    const v3 = new View(tui, theme, (x) => { closed = x; }, { cwd: w.root, leaveMs: 30, boardKey: "prefix+w", popup: true }); clearInterval(v3.timer);
    v3.sel = "proj/1"; v3.load(); v3.handleInput("\r");
    assert.equal(closed, undefined); assert.match(v3.render(120).map((l) => stripVTControlCharacters(l)).join("\n"), /Opening the agent\. prefix\+w brings the board back\./);
    v3.handleInput("\x18"); assert.equal(S.get("proj/1").stage, "stopped"); // nothing more is taken from the keyboard
    tt.mock.timers.tick(80); tt.mock.timers.reset();
    assert.deepEqual(closed, { entered: "proj/1" }); v3.dispose();
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("ctrl does something, alt only shows or hides: every key of the set, as a terminal sends it, and no old key left", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    const id = A.add(w.root, "One").id; A.add(w.root, "Two");
    const s = open(w); s.v.sel = id; s.v.load();
    const tasks = () => JSON.stringify(S.list().map((t) => [t.id, t.stage, !!t.pinned, !!t.archivedAt]));
    const shown = () => JSON.stringify([s.v.chatOpen, s.v.side, s.v.full, s.v.archiveView, s.v.byRepo, s.v.allDone, s.v.scope]);
    const first = tasks(), start = shown();
    // Alt: each key flips one thing you see, and flips it back; no task changes. A terminal sends esc and the letter,
    // or (kitty keyboard protocol) CSI <letter>;3u: both are the same key.
    const alt = { c: "chatOpen", p: "side", t: "full", a: "archiveView", s: "byRepo", d: "allDone" };
    for (const [letter, field] of Object.entries(alt)) for (const seq of [`\x1b${letter}`, `\x1b[${letter.charCodeAt(0)};3u`]) {
      const was = s.v[field];
      s.press(seq); assert.equal(s.v[field], !was, `alt+${letter} as ${JSON.stringify(seq)}`); assert.equal(s.v.value(), "");
      s.press(seq); assert.equal(s.v[field], was, `alt+${letter} again`);
      assert.equal(tasks(), first, `alt+${letter} changes no task`); assert.equal(s.v.ask, null);
    }
    // alt+m goes round whose board you see; with no other machine there is nothing to show, and it says so.
    s.press("alt+m"); assert.equal(s.v.scope, ""); assert.match(s.text(), /No other machines\./); assert.equal(tasks(), first);
    assert.equal(shown(), start);
    // The keys that are gone do nothing at all: not their old action, not a new one, and nothing is typed.
    for (const k of ["alt+v", "alt+h", "alt+r", "alt+n", "delete", "ctrl+s", "ctrl+d", "ctrl+o", "ctrl+t", "ctrl+g", "right", "\x1b[118;3u", "\x1b[1;3A", "\x1b[1;3B", "\x1b[1;5A", "\x1b[1;5B", "\x1b[H", "\x1b[F", "\x1bw", "\x1b[1;2A", "\x1b[1;2B", "\x1b[1;2C", "\x1b[1;6A", "\x1b[1;6B", "\x1b[1;4A", "\x1b[1;4B"]) {
      s.press(k); assert.equal(tasks(), first, k); assert.equal(shown(), start, k); assert.equal(s.v.ask, null, k); assert.equal(s.v.menu, null, k); assert.equal(s.v.value(), "", k); assert.equal(s.v.sel, id, k); assert.equal(s.closed(), undefined, k);
    }
    // Ctrl: each does its one thing. ctrl+p pins (it is no longer the side panel), ctrl+a archives (no longer "yes").
    s.press("ctrl+p"); assert.equal(S.get(id).pinned, true); assert.equal(shown(), start); s.press("\x1b[112;5u"); assert.ok(!S.get(id).pinned);
    s.press("ctrl+l"); assert.match(s.text(), /Nothing here waits for a yes\./); assert.equal(s.v.ask, null);
    s.press("ctrl+a"); assert.ok(S.get(id).archivedAt); assert.equal(s.v.ask, null);
    s.press("ctrl+z"); assert.ok(!S.get(id).archivedAt);
    s.press("ctrl+f"); assert.equal(s.v.mode, "find"); s.press("esc"); assert.equal(s.v.mode, "new");
    // ctrl+e opens the task's settings full screen and the key again (or esc) closes them; as a terminal sends it too
    for (const seq of ["ctrl+e", "\x1b[101;5u"]) { s.press(seq); assert.deepEqual([s.v.full, s.v.editing?.id], [true, s.v.sel]); s.press(seq); assert.deepEqual([s.v.full, s.v.editing], [true, null]); s.press("esc"); assert.equal(shown(), start); }
    assert.equal(tasks(), first);
  } finally { w.cleanup(); }
});

test("ctrl+x stops whatever agent is alive, also one that waits for your answer; it asks to remove only where none runs", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    const id = A.add(w.root, "One").id;
    const s = open(w); s.v.sel = id; s.v.load();
    const row = (over) => ({ ...s.v.current(), ...over });
    // An agent is alive in each of these: the key is "stop", and so is its line in the menu.
    for (const live of [{ agent: "claude", stage: "working", state: "working" }, { agent: "claude", stage: "asks", state: "blocked", kind: "question" }, { agent: "claude", stage: "asks", state: "blocked", kind: "permission" },
      { agent: "claude", stage: "working", state: "blocked", kind: "question" }, { agent: "claude", stage: "reviewing", state: "working" }, { agent: "claude", stage: "checking", state: "working" }, { agent: "claude", stage: "starting", state: "working" },
      { stage: "queued", state: "idle" }, { stage: "progress", state: "working" }]) assert.equal(s.v.running(row(live)), true, JSON.stringify(live));
    // No agent runs in these: the same key asks to remove.
    for (const still of [{ stage: "todo", state: "idle" }, { agent: "claude", stage: "stopped", state: "idle" }, { agent: "claude", stage: "approval", state: "blocked" }, { agent: "claude", stage: "failed", state: "error" },
      { agent: "claude", stage: "nosummary", state: "blocked" }, { agent: "claude", stage: "done", state: "done" }]) assert.equal(s.v.running(row(still)), false, JSON.stringify(still));
    // On the board: a task whose agent waits for an answer. ctrl+x stops it and asks nothing; only the next ctrl+x,
    // with no agent running any more, asks to remove.
    w.script({ worker: [{ status: "blocked", screen: "Which colour?\n" }] });
    A.delegate(id); await settle(id);
    S.update(id, (t) => { t.stage = "asks"; t.kind = "question"; }); s.v.load();
    assert.equal(s.v.current().stage, "asks"); assert.equal(s.v.current().state, "blocked");
    s.press("?"); assert.equal(s.v.menuItems().find((i) => i.id === "stop").label, "stop this task's agent"); s.press("esc");
    s.press("ctrl+x"); assert.equal(s.v.ask, null); assert.equal(S.get(id).stage, "stopped"); assert.match(s.text(), /Stopped #1 "One"\./);
    s.press("ctrl+x"); assert.match(s.text(), /\n[ ▌]\? Remove #1 "One"\? /); s.press("n"); assert.ok(S.get(id));
  } finally { w.cleanup(); }
});

test("while the text box holds text it owns the keyboard: no shortcut fires in the middle of a draft", async (tt) => {
  const w = await world();
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f." }], reviewer: [{ verdict: { meets: true, text: "Good.", findings: [{ severity: "minor", subject: "f.txt has no title", where: "f.txt" }] } }] });
    const id = A.add(w.root, "Make f").id; A.add(w.root, "Other");
    A.delegate(id); await settle(id);
    const s = open(w);
    s.v.sel = id; s.v.load();
    s.type("half a thought");
    const before = JSON.stringify([S.get(id).stage, S.get(id).pinned, S.get(id).archivedAt, S.list().length]);
    const prefs = JSON.stringify([s.v.side, s.v.scope]);
    for (const k of ["ctrl+l", "ctrl+r", "ctrl+x", "ctrl+x", "ctrl+p", "ctrl+f", "alt+c", "alt+p", "alt+t", "alt+a", "alt+s", "alt+d", "alt+m", "ctrl+e", "ctrl+g", "ctrl+t", "ctrl+d", "ctrl+b", "ctrl+s", "ctrl+o", "alt+h", "alt+v", "alt+r", "alt+n", "ctrl+a", "ctrl+e", "?", "space", "up", "down"]) s.press(k);
    assert.equal(JSON.stringify([s.v.side, s.v.scope]), prefs);
    assert.equal(JSON.stringify([S.get(id).stage, S.get(id).pinned, S.get(id).archivedAt, S.list().length]), before, "nothing happened to any task");
    assert.equal(s.v.sel, id); assert.equal(s.v.ask, null); assert.equal(s.v.menu, null); assert.equal(s.v.full, false); assert.equal(s.v.mode, "new"); assert.equal(s.v.archiveView, false); assert.equal(s.v.allDone, false); assert.equal(s.v.byRepo, false); assert.equal(s.v.chatOpen, true); assert.equal(s.v.msg, "");
    assert.equal(S.get(id).stage, "approval"); assert.equal(s.closed(), undefined);
    assert.match(s.v.value(), /half a thought/); assert.match(s.v.value(), /\?/); // "?" and space are typed, not acted on
    // esc puts the draft away, and it can be brought back; nothing is thrown away
    s.press("esc"); assert.equal(s.v.value(), ""); assert.match(s.text(), /Put away\. ctrl\+z brings it back\./);
    s.press("ctrl+z"); assert.match(s.v.value(), /half a thought/);
    s.press("esc");
    // one esc too many does not close the board: it shows the hint, in place of the key hints, and asks nothing
    // (after esc the line names the key that closes, which you have not pressed yet; after ctrl+c it asks for it again)
    const hint = /\n[ ▌] {1}Press ctrl\+c again to close the board *$/, escHint = /\n[ ▌] {1}ctrl\+c closes the board *$/;
    s.press("esc"); assert.equal(s.closed(), undefined); assert.equal(s.v.ask, null); assert.match(s.text(), escHint); assert.doesNotMatch(s.text(), /Close the board\?/);
    // closing is not a question: y and n are just typed, and enter no longer confirms: the hint goes, and enter does what it always does on an empty box (here: no agent to open)
    s.press("down", "esc"); assert.match(s.text(), escHint);
    s.press("enter"); assert.equal(s.closed(), undefined); assert.doesNotMatch(s.text(), escHint); assert.match(s.text(), /No agent has been on this yet/);
    s.press("up");
    // any other key takes the hint away and still does its own thing; ctrl+c after it is a first press again
    s.press("ctrl+c"); assert.match(s.text(), hint); s.type("x"); assert.doesNotMatch(s.text(), hint); assert.equal(s.v.value(), "x");
    // with text typed ctrl+c is a first press too: the hint shows and the draft stays as it was
    s.press("ctrl+c"); assert.equal(s.closed(), undefined); assert.equal(s.v.value(), "x"); assert.match(s.text(), hint);
    s.press("esc", "ctrl+c"); assert.equal(s.closed(), undefined); assert.match(s.text(), hint);
    s.press("?"); assert.ok(s.v.menu); assert.match(s.text(), /ctrl\+c +twice: close the board/); s.press("ctrl+c"); assert.equal(s.v.menu, null); assert.equal(s.closed(), undefined);
    // a short wait takes it away too: ctrl+c after it only shows the hint again
    tt.mock.timers.enable({ apis: ["setTimeout"] }); // the clock is moved, not waited for
    s.press("ctrl+c"); assert.match(s.text(), hint);
    tt.mock.timers.tick(1900); assert.match(s.text(), hint, "two seconds: time enough to read the line");
    tt.mock.timers.tick(200); tt.mock.timers.reset();
    assert.doesNotMatch(s.text(), hint); s.press("ctrl+c"); assert.equal(s.closed(), undefined); assert.match(s.text(), hint);
    // esc again is not a yes and not a no: only ctrl+c closes, after esc's hint as after its own
    s.press("esc"); assert.equal(s.closed(), undefined); assert.match(s.text(), escHint);
    s.press("ctrl+c"); assert.equal(s.closed(), null);
    // the other questions keep y and n, and ctrl+c is a no there
    // (ctrl+y was the yes key once: it asks nothing now, and types nothing)
    const s2 = open(w); s2.press("ctrl+y"); assert.equal(s2.v.ask, null); assert.equal(s2.v.value(), ""); assert.equal(S.get(id).stage, "approval");
    s2.press("ctrl+l"); assert.match(s2.text(), /\? Merge #1 "Make f" into \S+\? *\n[ ▌] {2}A merge cannot be undone\. *\n[ ▌] {2}y = merge · n = do not merge/);
    s2.press("ctrl+c"); assert.equal(s2.v.ask, null); assert.equal(s2.closed(), undefined); assert.equal(S.get(id).stage, "approval");
    s2.press("ctrl+c", "ctrl+c"); assert.equal(s2.closed(), null);
    // ctrl+c twice closes with a draft in the text box, for the Coordinator or for a task's agent, and the draft is kept
    const s3 = open(w); s3.type("half a thought"); s3.press("ctrl+c"); assert.equal(s3.closed(), undefined); assert.match(s3.text(), hint);
    s3.press("ctrl+c"); assert.equal(s3.closed(), null); assert.equal(s3.v.value(), "half a thought");
    const s4 = open(w); s4.press("space"); assert.equal(s4.v.reply, true); s4.type("to the agent"); s4.press("ctrl+c", "ctrl+c"); assert.equal(s4.closed(), null); assert.equal(s4.v.value(), "to the agent");
  } finally { w.cleanup(); }
});
