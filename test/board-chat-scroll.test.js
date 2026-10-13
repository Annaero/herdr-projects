// The chat's message when it is long: the box grows with it, it scrolls with two keys and the mouse wheel, and the
// box says where there is more. The wheel on the rest of the board.
import test from "node:test";
import assert from "node:assert/strict";
import * as A from "../src/actions.js";
import { coordWorld, open as openCoord } from "./coordinator-helpers.js";

const KEYS = { "alt+u": "\x1bu", "alt+j": "\x1bj" };
const answer = (n) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of the answer.`).join("\n");
// A board whose chat says `said.text`, whoever it talks to. `said.raw`: it is a screen, not a message.
async function board({ rows = 30, tasks = 30 } = {}) {
  const w = await coordWorld();
  for (let i = 1; i <= tasks; i++) A.add(w.root, `Task number ${i}`);
  const s = openCoord(w, { rows });
  s.v.side = false;
  const base = s.v.chatOf.bind(s.v), said = { text: answer(40), raw: false, turn: "turn-1" };
  s.v.chatOf = (r) => { const c = base(r); return c && { ...c, parts: undefined, text: said.text, raw: said.raw, turn: said.turn, mine: false, said: true }; };
  const key = (...keys) => s.press(...keys.map((k) => KEYS[k] ?? k));
  // The chat as drawn: its box's first and last row on the screen, the message's lines, and what the box says of more.
  const chat = (width = 120) => {
    const lines = s.screen(width), top = lines.findLastIndex((l) => /^╭─.*╮$/.test(l)), end = lines.findLastIndex((l) => /^╰─+╯$/.test(l));
    const inside = lines.slice(top + 1, end).map((l) => l.slice(2, -2).trimEnd()), at = inside.findLastIndex((l) => /^( *(alt\+j )?more ↓)?$/.test(l));
    return { lines, top, end, message: inside.slice(0, at), up: /more ↑/.test(lines[top]), down: /more ↓/.test(inside[at]), draft: inside.slice(at + 1), hints: lines[end + 1].trim() };
  };
  const wheel = (y, wheelDelta) => s.v.handleMouse({ type: "wheel", button: "none", x: 5, y, wheelDelta });
  return { w, s, said, key, chat, wheel, base };
}

test("the chat's box grows with the answer, up to two thirds of the window, and shrinks back; the selected task stays in view", async () => {
  const b = await board();
  try {
    // 40 lines in a window of 30 rows: the box takes 20 of them (16 of the message), from the answer's first line.
    let c = b.chat();
    assert.equal(c.end - c.top + 1, 20); assert.equal(c.message.length, 16);
    assert.equal(c.message[0], "Line 1 of the answer."); assert.equal(c.message.at(-1), "Line 16 of the answer.");
    assert.equal(c.up, false); assert.equal(c.down, true, "the box says there is more under it");
    // The list gave up the rows, and still shows the task that is selected, wherever it is.
    for (const n of [1, 15, 30]) { b.s.v.sel = b.s.v.items.find((r) => r.title === `Task number ${n}`).id; c = b.chat(); assert.ok(c.lines.slice(0, c.top).some((l) => new RegExp(`Task number ${n}( |$)`).test(l)), `task ${n} is in view`); }
    // An answer that fits is whole, with nothing said of more: 12 lines, and a short one takes one.
    b.said.text = answer(12); c = b.chat();
    assert.equal(c.message.length, 12); assert.equal(c.up || c.down, false);
    b.said.text = "Done."; c = b.chat();
    assert.deepEqual(c.message, ["Done."]); assert.equal(c.end - c.top + 1, 5);
    // A taller window shows more of a long one: two thirds of 60 rows.
    b.said.text = answer(40); b.s.v.tui.terminal.rows = 60; c = b.chat();
    assert.equal(c.end - c.top + 1, 40); assert.equal(c.message.length, 36);
    // Under the whole task, which is there to be read itself, the message keeps to a third of the window.
    b.s.v.tui.terminal.rows = 30; b.s.press("\x1bt"); c = b.chat();
    assert.equal(b.s.v.full, true); assert.equal(c.message.length, 8); assert.equal(c.down, true);
  } finally { b.w.cleanup(); }
});

test("alt+u and alt+j scroll a message longer than its box, with a draft too; the box says where there is more; a new message starts over", async () => {
  const b = await board();
  try {
    // The box names the key where there is more: under the message at first, on its top edge too once scrolled.
    let c = b.chat();
    assert.match(c.lines[c.top], /^╭─+╮$/); assert.match(c.lines[c.end - 2], / alt\+j more ↓ │$/);
    // Down half a box at a time, to the end and no further.
    b.key("alt+j"); c = b.chat();
    assert.equal(c.message[0], "Line 9 of the answer."); assert.equal(c.up, true); assert.equal(c.down, true);
    assert.match(c.lines[c.top], /^╭─+ alt\+u more ↑ ─╮$/); assert.match(b.chat(40).lines.find((l) => /↑/.test(l)), /^╭─+ alt\+u more ↑ ─╮$/);
    assert.match(b.chat(14).lines.find((l) => /↑/.test(l)), /^╭─+ more ↑ ─╮$/); assert.match(b.chat(9).lines.find((l) => /↑/.test(l)), /^╭─+ ↑ ─╮$/);
    b.key("alt+j", "alt+j", "alt+j", "alt+j"); c = b.chat();
    assert.equal(c.message.at(-1), "Line 40 of the answer."); assert.equal(c.message.length, 16); assert.equal(c.up, true); assert.equal(c.down, false);
    // And up again, to the start and no further.
    b.key("alt+u"); assert.equal(b.chat().message[0], "Line 17 of the answer.");
    b.key("alt+u", "alt+u", "alt+u", "alt+u"); c = b.chat();
    assert.equal(c.message[0], "Line 1 of the answer."); assert.equal(c.up, false);
    // The selection never moved, and nothing was typed.
    const sel = b.s.v.sel; b.key("alt+j"); assert.equal(b.s.v.sel, sel); assert.equal(b.s.v.value(), "");
    // With a draft in the text box the two keys still scroll, the box still names them, and the draft is whole.
    b.s.type("my draft"); c = b.chat();
    assert.match(c.lines[c.top], / alt\+u more ↑ ─╮$/);
    b.key("alt+j"); c = b.chat();
    assert.equal(c.message[0], "Line 17 of the answer."); assert.equal(b.s.v.value(), "my draft"); assert.match(c.draft.join(" "), /❯ my draft/);
    b.key("alt+u", "alt+u", "alt+u"); assert.equal(b.s.v.value(), "my draft"); assert.equal(b.chat().message[0], "Line 1 of the answer.");
    // A message that fits has nothing to scroll: the keys do nothing, and are not typed into the draft.
    b.said.text = "Done."; b.chat(); b.key("alt+j", "alt+u"); assert.equal(b.s.v.value(), "my draft"); assert.deepEqual(b.chat().message, ["Done."]);
    b.s.press("esc");
    // Scrolled down, then the message changes: the new one starts at its beginning.
    b.said.text = answer(40); b.chat(); b.key("alt+j"); assert.equal(b.chat().message[0], "Line 9 of the answer.");
    b.said.text = answer(41); assert.equal(b.chat().message[0], "Line 1 of the answer.");
    // So does an answer in the very same words: it is another turn. And the same words after nothing was said.
    b.key("alt+j"); assert.equal(b.chat().message[0], "Line 9 of the answer.");
    b.said.turn = "turn-2"; assert.equal(b.chat().message[0], "Line 1 of the answer.");
    b.key("alt+j"); const words = b.said.text; b.said.text = ""; b.chat(); b.said.text = words; assert.equal(b.chat().message[0], "Line 1 of the answer.");
    // The turn is the chat's own to name: the Coordinator's turn, and a task's handled turn.
    b.s.v.coord = { ...b.s.v.coord, state: "idle", said: "Done.", turn: { id: "t-7" } }; assert.equal(b.base(undefined).turn, "t-7");
    const rec = b.s.v.items[0]; b.s.v.reply = true; b.s.v.hasAgent = () => true;
    assert.notEqual(b.base({ ...rec, handled: { msg: "m1" } }).turn, b.base({ ...rec, handled: { msg: "m2" } }).turn); b.s.v.reply = false; delete b.s.v.hasAgent;
    // So does the same words in another chat: the selected task's agent, and back.
    b.key("alt+j"); assert.equal(b.chat().message[0], "Line 9 of the answer.");
    b.s.press("space"); assert.equal(b.s.v.reply, true); assert.equal(b.chat().message[0], "Line 1 of the answer.");
    // A screen (a dialog that is up) starts at its end, where a terminal has what is new; it scrolls up from there.
    b.said.raw = true; c = b.chat();
    assert.equal(c.message.at(-1), "Line 41 of the answer."); assert.equal(c.up, true); assert.equal(c.down, false);
    b.key("alt+u"); assert.equal(b.chat().message.at(-1), "Line 33 of the answer.");
  } finally { b.w.cleanup(); }
});

test("the mouse wheel scrolls the chat under the pointer, also while you type; elsewhere it does what the arrows do", async () => {
  const b = await board();
  try {
    let c = b.chat();
    // Over the chat (its box, and the line that says who): two lines a step.
    assert.deepEqual(b.wheel(c.top + 3, 1), { handled: true, render: true }); assert.equal(b.chat().message[0], "Line 3 of the answer.");
    b.wheel(c.top - 1, 3); assert.equal(b.chat().message[0], "Line 9 of the answer.");
    b.wheel(c.end, -1); assert.equal(b.chat().message[0], "Line 7 of the answer.");
    b.s.type("a draft"); b.wheel(c.top + 1, 2); assert.equal(b.chat().message[0], "Line 11 of the answer."); assert.equal(b.s.v.value(), "a draft");
    b.wheel(c.top + 1, -100); assert.equal(b.chat().message[0], "Line 1 of the answer."); b.s.press("esc");
    // Over the list: the selection moves a task a step, and the message stays where it is.
    const ids = b.s.v.rows.filter((r) => r.rec).map((r) => r.rec.id); b.s.v.sel = ids[0];
    b.wheel(2, 1); assert.equal(b.s.v.sel, ids[1]); b.wheel(2, 3); assert.equal(b.s.v.sel, ids[2]); b.wheel(2, -1); assert.equal(b.s.v.sel, ids[1]);
    assert.equal(b.chat().message[0], "Line 1 of the answer.");
    // In the menu the pick moves.
    b.s.press("?"); b.s.screen(); b.wheel(2, 1); assert.equal(b.s.v.menu.at, 1); b.wheel(2, -1); assert.equal(b.s.v.menu.at, 0); b.s.press("esc");
    // A question keeps the screen as it is, and only the wheel is the board's: a click or a move is not taken.
    b.s.v.ask = { text: "Sure?", yes() {} }; b.wheel(2, 1); assert.equal(b.s.v.sel, ids[1]); b.s.v.ask = null;
    for (const type of ["press", "release", "move", "drag", "click"]) assert.equal(b.s.v.handleMouse({ type, button: "left", x: 5, y: 2 }), undefined);
    assert.equal(b.s.v.sel, ids[1]);
  } finally { b.w.cleanup(); }
});

test("the mouse wheel scrolls the whole-task page, with a draft too; over the chat under it, the chat", async () => {
  const b = await board({ tasks: 1 });
  try {
    const id = b.s.v.items[0].id;
    A.describe(id, Array.from({ length: 80 }, (_, i) => `Description line ${i + 1}.`).join("\n"));
    b.s.beat(); b.s.v.sel = id; b.s.press("\x1bt");
    let c = b.chat();
    assert.equal(b.s.v.full, true); assert.match(c.lines[0], /Task details .* lines 1–\d+ of \d+/);
    b.wheel(5, 1); assert.match(b.chat().lines[0], /lines 3–/); assert.equal(b.s.v.sel, id);
    b.wheel(5, 2); assert.match(b.chat().lines[0], /lines 7–/);
    b.s.type("typing"); b.wheel(5, -1); assert.match(b.chat().lines[0], /lines 5–/); assert.equal(b.s.v.value(), "typing");
    // Over the chat under the page it is the chat that scrolls; the page stays.
    b.wheel(c.top + 1, 1); c = b.chat(); assert.equal(c.message[0], "Line 3 of the answer."); assert.match(c.lines[0], /lines 5–/);
    b.wheel(5, -100); assert.match(b.chat().lines[0], /lines 1–/);
  } finally { b.w.cleanup(); }
});

test("a long message at every board size: the window is filled exactly, nothing is wider than it, and the text box is whole", async () => {
  const b = await board({ tasks: 12 });
  try {
    b.said.text = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of an answer that is long enough to wrap in a window that is narrow.`).join("\n");
    for (const rows of [8, 12, 20, 34, 60]) {
      b.s.v.tui.terminal.rows = rows;
      for (const width of [8, 20, 80, 200]) {
        for (const scrolled of [false, true]) {
          if (scrolled) b.key("alt+j");
          const note = `${width}×${rows}${scrolled ? ", scrolled" : ""}`, lines = b.s.screen(width);
          assert.equal(lines.length, rows, note); assert.ok(lines.every((l) => l.length <= width), `${note}: nothing is wider than the window`);
          assert.ok(lines.some((l) => /❯/.test(l)), `${note}: the line you type on is there`);
          const top = lines.findLastIndex((l) => /^╭─.*╮$/.test(l)), end = lines.findLastIndex((l) => /^╰─+╯$/.test(l));
          if (top >= 0) { assert.ok(end > top, note); assert.ok(end - top + 1 <= Math.max(6, Math.floor((rows * 2) / 3)), `${note}: the box keeps to two thirds`); for (const l of lines.slice(top, end + 1)) assert.equal(l.length, width, `${note}: the box is whole`); }
          if (b.s.v.chatFit?.above) assert.match(lines[top], /↑/, `${note}: it says there is more above`);
        }
        b.key("alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u");
      }
    }
  } finally { b.w.cleanup(); }
});

test("a tall draft in a small window never takes the answer away: it gives rows back, and the answer still scrolls", async () => {
  const b = await board({ tasks: 4 });
  try {
    const draft = Array.from({ length: 6 }, (_, i) => `draft line ${i + 1} of thirty characters`).join("\n");
    b.s.v.setValue(draft);
    for (const [rows, least] of [[8, 1], [12, 3], [15, 3], [30, 3]]) {
      b.s.v.tui.terminal.rows = rows;
      let lines = b.s.screen();
      assert.equal(lines.length, rows); assert.ok(b.s.v.chatFit, `the answer shows at ${rows} rows`); assert.ok(b.s.v.chatFit.rows >= least, `at least ${least} of its lines at ${rows} rows`);
      assert.ok(lines.some((l) => /Line 1 of the answer\./.test(l)), `its first line at ${rows} rows`); assert.ok(lines.some((l) => /more ↓/.test(l) || /↓ │$/.test(l)), `it says there is more at ${rows} rows`);
      assert.ok(lines.some((l) => /draft line \d/.test(l)), `the draft is on show at ${rows} rows`);
      b.key("alt+j"); lines = b.s.screen();
      assert.ok(b.s.v.chatFit.above > 0, `alt+j scrolls at ${rows} rows`); assert.ok(lines.some((l) => /↑/.test(l)));
      assert.equal(b.s.v.value(), draft, "the draft is whole");
      b.key("alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u", "alt+u");
    }
  } finally { b.w.cleanup(); }
});
