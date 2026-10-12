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
  const w = await world({ settings: { helper: "off", reviewer: "off" } });
  try {
    process.env.HERDR_ENV = "1";
    w.script({ worker: [{ status: "working", screen: "● Editing greet.sh\n  esc to interrupt\n" }] });
    const s = open(w);
    s.type("Add a greeting");
    assert.match(s.text(), /\n─+\n \+ New task {2}[^\n]*\n─+\n❯ Add a greeting/); assert.match(s.text(), /enter add a task · tab add it and start an agent · esc put away/);
    s.press("enter");
    assert.equal(S.get("proj/1").title, "Add a greeting"); assert.equal(s.v.sel, "proj/1"); assert.equal(s.v.value(), "");
    assert.match(s.text(), /\n {2}tab put an agent on it · space reply · \? more/);
    s.press("right"); assert.match(s.text(), /No agent has been on this yet/);
    s.press("tab");
    await settle("proj/1"); s.v.load();
    assert.match(s.text(), /\n working +│[^\n]*\n ◐ Add a greeting/);
    assert.match(s.text(), /│ {2}On its screen now ─+ *\n[^\n]*│ {2}● Editing greet\.sh/); // the panel shows what the agent is doing
    assert.match(s.text(), /\n {2}enter open the agent · space reply · ctrl\+x stop · \? more/);
    // space: the text box now belongs to this task's agent, and says so for as long as you type
    s.press("space");
    assert.match(s.text(), /\n─+\n . Add a greeting {2}[^\n]*\n(?:[^\n]*\n)*?─+\n❯ your reply/);
    w.script({ worker: [{ status: "working" }] });
    s.type("also say goodbye");
    assert.match(s.text(), /\n─+\n . Add a greeting {2}[^\n]*\n(?:[^\n]*\n)*?─+\n❯ also say goodbye/); assert.match(s.text(), /enter send to its agent · esc put away/);
    s.press("enter");
    assert.match(s.text(), /Sent to the agent/);
    const t = S.get("proj/1");
    assert.match(w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts.at(-1), /also say goodbye/);
    // esc has nothing to go back from here: it never hides the chat's message, never changes who you talk to, never
    // closes the board. alt+v is the one key for the message, space the one key for who. The chat's line names neither key.
    assert.doesNotMatch(s.text(), /alt\+v|alt\+c/); assert.doesNotMatch(s.text(), /esc hide|esc back/); assert.match(s.text(), /space back to the Coordinator *$/);
    s.press("esc"); assert.equal(s.v.chatOpen, true); assert.equal(s.v.reply, true); assert.equal(s.v.ask, null); assert.equal(s.closed(), undefined); assert.ok(s.v.closing); assert.match(s.text(), /Press ctrl\+c again to close the board *$/); s.v.closeSoon();
    s.press("\x1bv"); assert.equal(s.v.chatOpen, false); assert.equal(s.v.reply, true); assert.match(s.text(), /\n─+\n . Add a greeting {2}\S[^\n]*\n─+\n❯ /); assert.doesNotMatch(s.text(), /alt\+v/);
    s.press("\x1bv"); assert.equal(s.v.chatOpen, true);
    s.press("space"); assert.equal(s.v.reply, false); assert.match(s.text(), /\n─+\n \+ New task {2}[^\n]*\n─+\n❯/);
    // enter: focus the agent's real pane by pane id and close the board; selection and filter come back on reopen
    s.press("enter");
    assert.deepEqual(s.closed(), { entered: "proj/1" });
    assert.ok(w.state().focus.includes(`agent ${t.link.pane}`));
    s.v.dispose();
    assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).sel, "proj/1");
    // ctrl+x stops the agent, and the selection stays on that row: a second tap neither stops another task nor deletes
    A.add(w.root, "Another one"); A.add(w.root, "And one more");
    const s2 = open(w);
    assert.equal(s2.v.sel, "proj/1");
    s2.press("ctrl+x");
    assert.equal(S.get("proj/1").stage, "stopped"); assert.match(s2.text(), /proj\/1: stopped\./); assert.equal(s2.v.sel, "proj/1");
    s2.press("ctrl+x");
    assert.equal(s2.v.sel, "proj/1"); assert.ok(S.get("proj/1")); assert.ok(S.get("proj/2")); assert.match(s2.text(), /No agent is working on this/);
    // the first few times, the board says how to get back before it closes for an agent
    const tui = { terminal: { rows: 34, columns: 120 }, requestRender() {}, stop() {}, start() {} };
    let closed;
    tt.mock.timers.enable({ apis: ["setTimeout"] }); // the board closes a moment after the line shows: the clock is moved, not waited for
    const v3 = new View(tui, theme, (x) => { closed = x; }, { cwd: w.root, leaveMs: 30, boardKey: "prefix+w" }); clearInterval(v3.timer);
    v3.sel = "proj/1"; v3.load(); v3.handleInput("\r");
    assert.equal(closed, undefined); assert.match(v3.render(120).map((l) => stripVTControlCharacters(l)).join("\n"), /Opening the agent\. prefix\+w brings the board back\./);
    v3.handleInput("\x18"); assert.equal(S.get("proj/1").stage, "stopped"); // nothing more is taken from the keyboard
    tt.mock.timers.tick(80); tt.mock.timers.reset();
    assert.deepEqual(closed, { entered: "proj/1" }); v3.dispose();
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("while the text box holds text it owns the keyboard: no shortcut fires in the middle of a draft", async (tt) => {
  const w = await world({ settings: { helper: "off", coordinator: "off" } });
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f." }], reviewer: [{ verdict: { meets: true, text: "Good.", findings: [{ severity: "minor", subject: "f.txt has no title", where: "f.txt" }] } }] });
    const id = A.add(w.root, "Make f").id; A.add(w.root, "Other");
    A.delegate(id); await settle(id);
    const s = open(w);
    s.v.sel = id; s.v.load();
    s.type("half a thought");
    const before = JSON.stringify([S.get(id).stage, S.get(id).pinned, S.get(id).archivedAt, S.list().length]);
    for (const k of ["ctrl+a", "ctrl+e", "ctrl+y", "ctrl+r", "ctrl+g", "ctrl+t", "ctrl+d", "ctrl+x", "ctrl+x", "ctrl+b", "ctrl+f", "ctrl+s", "alt+a", "alt+h", "\x1bc", "\x1bv", "ctrl+z", "?", "space", "up", "down"]) s.press(k);
    assert.equal(JSON.stringify([S.get(id).stage, S.get(id).pinned, S.get(id).archivedAt, S.list().length]), before, "nothing happened to any task");
    assert.equal(s.v.sel, id); assert.equal(s.v.ask, null); assert.equal(s.v.menu, null); assert.equal(s.v.full, false); assert.equal(s.v.mode, "new"); assert.equal(s.v.archiveView, false); assert.equal(s.v.allDone, false); assert.equal(s.v.byRepo, false); assert.equal(s.v.chatOpen, true); assert.equal(s.v.msg, "");
    assert.equal(S.get(id).stage, "approval"); assert.equal(s.closed(), undefined);
    assert.match(s.v.value(), /half a thought/); assert.match(s.v.value(), /\?/); // "?" and space are typed, not acted on
    // esc puts the draft away, and it can be brought back; nothing is thrown away
    s.press("esc"); assert.equal(s.v.value(), ""); assert.match(s.text(), /Put away\. ctrl\+z brings it back\./);
    s.press("ctrl+z"); assert.match(s.v.value(), /half a thought/);
    s.press("esc");
    // one esc too many does not close the board: it shows the hint, in place of the key hints, and asks nothing
    const hint = /\n {2}Press ctrl\+c again to close the board *$/;
    s.press("esc"); assert.equal(s.closed(), undefined); assert.equal(s.v.ask, null); assert.match(s.text(), hint); assert.doesNotMatch(s.text(), /Close the board\?/);
    // closing is not a question: y and n are just typed, and enter no longer confirms: the hint goes, and enter does what it always does on an empty box (here: no agent to open)
    s.press("down", "esc"); assert.match(s.text(), hint);
    s.press("enter"); assert.equal(s.closed(), undefined); assert.doesNotMatch(s.text(), hint); assert.match(s.text(), /No agent has been on this yet/);
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
    tt.mock.timers.tick(900); tt.mock.timers.reset();
    assert.doesNotMatch(s.text(), hint); s.press("ctrl+c"); assert.equal(s.closed(), undefined); assert.match(s.text(), hint);
    // esc again is not a yes and not a no: only ctrl+c closes, after esc's hint as after its own
    s.press("esc"); assert.equal(s.closed(), undefined); assert.match(s.text(), hint);
    s.press("ctrl+c"); assert.equal(s.closed(), null);
    // the other questions keep y = yes · n = no, and ctrl+c is a no there
    const s2 = open(w); s2.press("ctrl+a"); assert.match(s2.text(), /\? Merge [^\n]*y = yes · n = no/);
    s2.press("ctrl+c"); assert.equal(s2.v.ask, null); assert.equal(s2.closed(), undefined); assert.equal(S.get(id).stage, "approval");
    s2.press("ctrl+c", "ctrl+c"); assert.equal(s2.closed(), null);
    // ctrl+c twice closes with a draft in the text box, for the Coordinator or for a task's agent, and the draft is kept
    const s3 = open(w); s3.type("half a thought"); s3.press("ctrl+c"); assert.equal(s3.closed(), undefined); assert.match(s3.text(), hint);
    s3.press("ctrl+c"); assert.equal(s3.closed(), null); assert.equal(s3.v.value(), "half a thought");
    const s4 = open(w); s4.press("space"); assert.equal(s4.v.reply, true); s4.type("to the agent"); s4.press("ctrl+c", "ctrl+c"); assert.equal(s4.closed(), null); assert.equal(s4.v.value(), "to the agent");
  } finally { w.cleanup(); }
});
