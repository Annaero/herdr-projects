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

test("the board's keys: typing adds a task, tab puts an agent on it, space replies to it, enter opens the agent", async () => {
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
    // esc, one step at a time: the agent's message in the chat is hidden first, and only the next esc leaves the reply
    assert.match(s.text(), /esc hide its message/); assert.doesNotMatch(s.text(), /esc back/);
    s.press("esc"); assert.equal(s.v.chatOpen, false); assert.equal(s.v.reply, true); assert.equal(s.v.ask, null); assert.match(s.text(), /alt\+v show its message/); assert.match(s.text(), /esc back/);
    s.press("esc"); assert.equal(s.v.reply, false); assert.match(s.text(), /\n─+\n \+ New task {2}[^\n]*\n─+\n❯/);
    s.press("\x1bv"); assert.equal(s.v.chatOpen, true);
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
    const v3 = new View(tui, theme, (x) => { closed = x; }, { cwd: w.root, leaveMs: 30, boardKey: "prefix+w" }); clearInterval(v3.timer);
    v3.sel = "proj/1"; v3.load(); v3.handleInput("\r");
    assert.equal(closed, undefined); assert.match(v3.render(120).map((l) => stripVTControlCharacters(l)).join("\n"), /Opening the agent\. prefix\+w brings the board back\./);
    v3.handleInput("\x18"); assert.equal(S.get("proj/1").stage, "stopped"); // nothing more is taken from the keyboard
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(closed, { entered: "proj/1" }); v3.dispose();
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("while the text box holds text it owns the keyboard: no shortcut fires in the middle of a draft", async () => {
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
    // one esc too many does not close the board: it asks, and esc again says no
    s.press("esc"); assert.equal(s.closed(), undefined); assert.match(s.text(), /\n \? Close the board\? {2}enter = yes · esc = no/);
    s.press("ctrl+a", "x", "space"); assert.ok(s.v.ask, "a question takes its own keys, nothing else"); assert.equal(S.get(id).stage, "approval");
    s.press("y", "Y", "n"); assert.ok(s.v.ask, "closing is not a y/n question: it keeps enter and ctrl+c"); assert.equal(s.closed(), undefined);
    s.press("esc"); assert.equal(s.v.ask, null); assert.equal(s.closed(), undefined);
    s.press("\x03"); assert.match(s.text(), /\n \? Close the board\? {2}enter = yes · esc = no/); assert.equal(s.closed(), undefined); s.press("esc");
    s.press("esc", "enter"); assert.equal(s.closed(), null); // enter still says yes to closing
    const c = open(w); c.press("\x03", "y"); assert.equal(c.closed(), undefined); c.press("\x03"); assert.equal(c.closed(), null, "and ctrl+c twice still closes");
  } finally { w.cleanup(); }
});
