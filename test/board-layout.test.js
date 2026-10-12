// The whole screen: the chat pinned to the bottom, through a resize.
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { world, until } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { open } from "./board-helpers.js";

// The chat block (who you talk to and their message, the text box, what just happened, the hints) ends on the
// window's last line, and the list has every line above it: at any height, through a resize, whatever the block holds.
test("the chat is pinned to the bottom of the window: tall, resized, and while the chat block grows or shrinks", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    for (let i = 1; i <= 230; i++) A.add(w.root, `Task number ${i}`);
    const s = open(w, { rows: 84, side: false });
    const chatOf = s.v.chatOf.bind(s.v);
    let said = "";
    s.v.chatOf = (r) => { const c = chatOf(r); return c && said ? { ...c, text: said, said: true, always: true } : c; };
    const pinned = (rows, what) => {
      s.v.tui.terminal.rows = rows; // the same open board: the window was resized under it
      const lines = s.screen(120), note = `${what}, ${rows} rows`;
      assert.equal(lines.length, rows, note); // one line per row of the window: nothing is left over below
      const last = lines.length - 1, said = s.v.msg ? 1 : 0;
      assert.match(lines[last], /^ {2}\S.* · /, note); // the hints are the last line
      // The text box: plain between two rules, or (with a message showing) inside the one rounded box.
      const box = lines.findLastIndex((l) => /^(│ )?❯/.test(l));
      assert.ok(box > 0, note);
      const rule = lines.findLastIndex((l) => /^(─+|╰─+╯)$/.test(l));
      assert.equal(rule, last - 1 - said, note); // the text box sits right on the hints (and on what just happened)
      const head = lines.findIndex((l) => /^ \+ New task {2}/.test(l)); // where the chat block starts: who your words go to
      assert.ok(head > 0, note); assert.match(lines[head + 1], /^(─+|╭─+╮)$/, note); // the box is right under that line
      if (rows >= 16) assert.equal(lines[head - 1].trim(), "", `${note}: an empty line sets the chat off from the list`);
      for (let n = head; n <= last; n++) assert.notEqual(lines[n].trim(), "", `${note}: an empty line inside the chat block`);
      const tasks = lines.slice(0, head).filter((l) => /Task number \d+/.test(l)).length;
      // Every spare line is the list's: with more tasks than fit, no line above the chat is empty but the one under the
      // header and the one above the chat.
      if (rows >= 16) assert.ok(tasks >= head - 5, `${note}: ${tasks} tasks in ${head} lines`);
      return { head, tasks };
    };
    const tall = pinned(84, "tall");
    assert.ok(tall.tasks > 70);
    for (const rows of [120, 200, 61, 84, 40, 24, 16, 12, 9, 58, 84]) pinned(rows, "resized");
    assert.deepEqual(pinned(84, "back to tall"), tall);
    // A longer message from the Coordinator: the block grows upwards, into the list.
    said = Array.from({ length: 6 }, (_, i) => `Line ${i + 1} of what it said.`).join("\n");
    const long = pinned(84, "long message");
    assert.equal(long.head, tall.head - 7); // its six lines, and the empty one between them and the line you type on
    assert.deepEqual(s.screen(120).slice(long.head + 1, long.head + 10).map((l) => l.replace(/ +│$/, "")), ["╭" + "─".repeat(118) + "╮", ...Array.from({ length: 6 }, (_, i) => `│ Line ${i + 1} of what it said.`), "│", "│ ❯ what's next?"]);
    for (const rows of [200, 30, 84]) pinned(rows, "long message, resized");
    // A draft that wraps: the box grows upwards too.
    s.type("word ".repeat(60));
    const draft = pinned(84, "wrapped draft");
    assert.ok(draft.head < long.head);
    for (const rows of [200, 20, 84]) pinned(rows, "wrapped draft, resized");
    // A message on the line of what just happened, then back to nothing at all: it shrinks back down.
    s.v.flash("Something just happened.", "yellow");
    pinned(84, "with a message"); pinned(140, "with a message, resized");
    s.v.msg = ""; s.v.setValue(""); said = "";
    assert.deepEqual(pinned(84, "shrunk back"), tall);
  } finally { w.cleanup(); }
});

// The same promise through the real screen: the library draws the board on a terminal that is resized under it, the
// way a window is. What reaches the terminal is checked, at narrow, normal, very wide and very tall sizes.
test("resizing the real screen keeps the chat on the last line and the working rows' columns at the right edge", async () => {
  const w = await world({ settings: { helper: "off" } });
  const { TuiAltScreen, visibleWidth } = await import("@earendil-works/pi-tui");
  let tui;
  try {
    A.add(w.root, "Pin the chat to the bottom");
    for (let i = 2; i <= 150; i++) A.add(w.root, `Task number ${i}`);
    let resized = () => {};
    const terminal = {
      columns: 120, rows: 34, kittyProtocolActive: false,
      start(_onInput, onResize) { resized = onResize; }, stop() {}, async drainInput() {}, write() {},
      moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
    };
    tui = new TuiAltScreen(terminal, { mouse: false });
    const v = new View(tui, theme, () => {}, { cwd: w.root, canReload: true });
    clearInterval(v.timer);
    v.side = false;
    // One task an agent works on: the bar, the percent, the minutes left, the PR number and the time are its columns on the right.
    const first = v.rows.find((row) => row.rec).rec;
    Object.assign(first, { title: "Pin the chat to the bottom", state: "working", msg: "Checking every window size.", progress: 55, eta: 12, pr: 3, at: Date.now() - 6 * 60000 });
    v.chatOf = () => ({ mark: "○", name: "Coordinator", status: "idle", color: "green", enter: true, said: true, always: true, text: "Tasks 31 and 32 are both waiting." });
    tui.addChild(v); tui.setFocus(v); tui.start();
    const frame = async (columns, rows) => {
      terminal.columns = columns; terminal.rows = rows; resized(); // what a window resize does
      let lines = [];
      await until(() => { lines = tui.getScreenLines(); return lines.length === rows && visibleWidth(lines[rows - 2]) === columns; }); // the real renderer draws on its own beat
      return lines.map((l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, ""));
    };
    for (const [columns, rows] of [[120, 34], [190, 84], [435, 58], [412, 78], [50, 22], [50, 84], [435, 22], [300, 120], [40, 12], [435, 58], [120, 34]]) {
      const lines = await frame(columns, rows), note = `${columns}x${rows}`;
      assert.equal(lines.length, rows, note); // the whole window is drawn, to its last row
      for (const l of lines) assert.ok(visibleWidth(l) <= columns, `${note}: a line is wider than the window`);
      // The bottom: the hints on the last row, and right above them the one rounded box, as wide as the window: the
      // message, an empty line, the line you type on.
      assert.match(lines[rows - 1], /^ {2}\S/, note); assert.doesNotMatch(lines[rows - 1].trimEnd(), /·$/, note);
      const inBox = (n) => { assert.match(lines[n], /^│ .* │$/, note); assert.equal(visibleWidth(lines[n]), columns, note); return lines[n].slice(2, -2).trimEnd(); };
      assert.equal(lines[rows - 2], "╰" + "─".repeat(columns - 2) + "╯", note); assert.match(inBox(rows - 3), /^❯ /, note); assert.equal(inBox(rows - 4), "", note);
      const head = lines.findIndex((l) => /^ ○ Coordinator/.test(l));
      assert.equal(lines[head + 1], "╭" + "─".repeat(columns - 2) + "╮", note);
      assert.equal(Array.from({ length: rows - 5 - head - 1 }, (_, i) => inBox(head + 2 + i)).join(" "), "Tasks 31 and 32 are both waiting.", note);
      // Who you talk to: a mark, the name, where it stands. No keys, no program, no label.
      assert.equal(lines[head].trimEnd(), " ○ Coordinator  idle", note);
      // The working row: its columns sit at the window's right edge, however wide the window is.
      const row = lines.find((l) => /Pin the chat to the bottom/.test(l)) || "";
      if (rows >= 20) assert.ok(row, `${note}: the working row is in view`);
      if (row && columns >= 120) { assert.match(row, /Checking every window size\. +█+░+ +55% 12m {2}PR#3 {2}6m {4}$/, note); assert.equal(visibleWidth(row), columns, note); }
      else if (row) { assert.match(row, /6m *$/, note); if (columns >= 50) assert.match(row, /55% 12m {2}PR#3 +6m *$/, note); }
      // All spare height is the list's.
      if (rows >= 20) assert.ok(lines.slice(0, head).filter((l) => /Task number \d+/.test(l)).length >= head - 7, `${note}: the list fills the space above the chat`);
    }
  } finally { try { tui?.stop(); } catch {} w.cleanup(); }
});
