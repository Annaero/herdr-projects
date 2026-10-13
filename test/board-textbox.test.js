// The text box: wrapping, growing, scrolling, editing keys.
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { world, settle } from "./helpers.js";
import * as A from "../src/actions.js";
import { open } from "./board-helpers.js";

// The text box as the screen shows it: its rows without the prompt, how many rows it hides, and where the cursor is.
function draft(s, width) {
  const raw = s.v.render(width), lines = raw.map((l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, ""));
  // With the chat open the text box is inside the chat's rounded box: the same rows, two cells in from each side.
  const framed = lines.some((l) => l.startsWith("│ ❯ ")), inner = lines.map((l) => (framed && /^│ .* │$/.test(l) ? l.slice(2, -2) : l));
  const first = inner.findIndex((l) => l.startsWith("❯ ")), last = inner.findIndex((l, n) => n > first && /^[─╰]/.test(l));
  const at = raw.findIndex((l) => l.includes("\x1b_pi:c\x07"));
  const hidden = (l) => Number(l.match(/(\d+) more/)?.[1] || 0);
  return { lines, framed, rows: inner.slice(first, last).map((l) => l.slice(2).trimEnd()), above: hidden(inner[first - 1]), below: hidden(inner[last]),
    cursor: [at - first, stripVTControlCharacters(raw[at].split("\x1b_pi:c\x07")[0]).length - 2 - (framed ? 2 : 0)] };
}

test("a draft longer than the text box wraps onto further lines, between words, and the box grows with it", async () => {
  const w = await world();
  try {
    A.add(w.root, "Some task");
    const s = open(w, { rows: 30 });
    const words = Array.from({ length: 40 }, (_, i) => `word${i + 1}`).join(" ");
    s.type(words);
    for (const width of [40, 61, 120]) {
      const d = draft(s, width);
      assert.ok(d.rows.length > 1, `wraps at ${width} columns`);
      assert.equal(d.rows.join(" "), words, "the whole draft is in view, cut only between words");
      assert.equal(d.above + d.below, 0);
      assert.equal(d.lines.length, 30); assert.ok(d.lines.every((l) => l.length <= width), "no line runs past the window");
      assert.match(d.lines.at(-1), /enter add it as a task/); // the hints stay under a tall box
      assert.deepEqual(d.cursor, [d.rows.length - 1, d.rows.at(-1).length], "the cursor is after the last word");
    }
    // More lines than pi-tui shows on its own (5, or 30% of the window): the box takes them, the list above gives way.
    assert.equal(draft(s, 40).rows.length, 8);
    assert.match(draft(s, 40).lines[0], /herdr-superwork/);
    // Emptied again, the box is one line.
    s.press("esc"); assert.equal(draft(s, 40).rows.length, 1);
  } finally { w.cleanup(); }
});

test("the text box stops growing at half the window: a longer draft scrolls inside it and the cursor stays in view", async () => {
  const w = await world();
  try {
    A.add(w.root, "Some task");
    const words = Array.from({ length: 200 }, (_, i) => `word${i + 1}`).join(" ");
    for (const [rows, most] of [[30, 15], [12, 6], [8, 5]]) {
      const s = open(w, { rows });
      s.type(words);
      let d = draft(s, 40);
      assert.ok(d.rows.length <= most && d.rows.length >= Math.min(most, rows - 6), `${d.rows.length} rows of text in a window of ${rows}`);
      assert.equal(d.lines.length, rows); assert.match(d.lines.at(-1), /enter add it as a task/);
      assert.ok(d.above > 0, "the top border says how many lines are above"); assert.equal(d.below, 0);
      assert.match(d.rows.at(-1), /word200$/); assert.equal(d.cursor[0], d.rows.length - 1);
      // Walking up past the top of the box scrolls it; the cursor never leaves it.
      for (let i = 0; i < d.rows.length + 2; i++) s.press("up");
      const up = draft(s, 40);
      assert.equal(up.cursor[0], 0); assert.equal(up.above, d.above - 3); assert.equal(up.below, 3); assert.equal(up.rows.length, d.rows.length);
      for (let i = 0; i < 100; i++) s.press("up");
      d = draft(s, 40);
      assert.equal(d.above, 0); assert.match(d.rows[0], /^word1 word2 /); assert.equal(d.cursor[0], 0);
      assert.equal(s.v.value(), words);
    }
  } finally { w.cleanup(); }
});

test("the arrows and the editing keys work across the lines of a wrapped draft", async () => {
  const w = await world();
  try {
    A.add(w.root, "Some task");
    const s = open(w, { rows: 30 });
    // 40 columns: 37 for the text. "aaaa bbbb cccc dddd eeee ffff gggg" is 34 wide, so every row holds seven words.
    const row = (c) => Array.from({ length: 7 }, () => c.repeat(4)).join(" ");
    s.type([row("a"), row("b"), row("c")].join(" "));
    let d = draft(s, 40);
    assert.deepEqual(d.rows, [row("a"), row("b"), row("c")]); assert.deepEqual(d.cursor, [2, 34]);
    // up and down move by the lines you see, not by the one long line the draft really is
    s.press("up"); assert.deepEqual(draft(s, 40).cursor, [1, 34]);
    s.press("up"); assert.deepEqual(draft(s, 40).cursor, [0, 34]);
    s.press("down"); assert.deepEqual(draft(s, 40).cursor, [1, 34]);
    // left from the start of a row goes to the end of the row above, right comes back
    s.press("ctrl+a"); assert.deepEqual(draft(s, 40).cursor, [0, 0]); // the start of the line
    for (let i = 0; i < 35; i++) s.press("right");
    assert.deepEqual(draft(s, 40).cursor, [1, 0]);
    s.type("X"); assert.equal(s.v.value(), [row("a"), "X" + row("b"), row("c")].join(" "));
    s.press("\x7f", "\x7f"); // backspace, twice: the X, then the space the first row ended on
    assert.equal(s.v.value(), [row("a") + row("b"), row("c")].join(" "));
    // the two words that were on two rows are now one word, moved whole to the row it fits on; the rest wraps again
    d = draft(s, 40);
    assert.deepEqual(d.rows, [row("a").slice(0, 29), "aaaabbbb" + row("b").slice(4, 29), "bbbb " + row("c").slice(0, 29), "cccc"]); assert.deepEqual(d.cursor, [1, 4]);
    s.press("down", "down", "ctrl+e"); s.type(" end"); assert.match(s.v.value(), /cccc end$/);
    assert.deepEqual(draft(s, 40).rows.at(-1), "cccc end");
    // shift+enter starts a new line; the rows before and after it wrap each on their own
    s.press("esc"); s.type("one"); s.press("\x1b[13;2u"); s.type(row("d") + " " + row("e"));
    assert.equal(s.v.value(), `one\n${row("d")} ${row("e")}`);
    assert.deepEqual(draft(s, 40).rows, ["one", row("d"), row("e")]);
  } finally { w.cleanup(); }
});

test("a word longer than the text box is cut at its edge, and a long paste wraps like typed text", async () => {
  const w = await world();
  try {
    A.add(w.root, "Some task");
    const s = open(w, { rows: 30 });
    const url = "https://example.com/" + "x".repeat(100);
    s.type(`see ${url} now`);
    let d = draft(s, 40);
    assert.equal(d.rows.join("").replace(/ /g, ""), `see${url}now`, "every character of the long word shows");
    assert.ok(d.lines.every((l) => l.length <= 40)); assert.equal(d.lines.length, 30); assert.equal(d.above + d.below, 0);
    assert.deepEqual(d.cursor, [d.rows.length - 1, d.rows.at(-1).length]);
    s.press("up"); assert.equal(draft(s, 40).cursor[0], d.rows.length - 2); // the arrows walk the pieces of the word
    s.press("esc");
    // A paste: its own line breaks are kept, each of its lines wraps, a tab is four spaces, and nothing in it acts as a key.
    const pasted = `First line of the paste, long enough to need a second row in the box.\n\tindented\n${"y".repeat(90)}\x01\x18`;
    s.press(`\x1b[200~${pasted.slice(0, 50)}`); s.press(`${pasted.slice(50)}\x1b[201~`);
    assert.equal(s.v.value(), "First line of the paste, long enough to need a second row in the box.\n    indented\n" + "y".repeat(90));
    d = draft(s, 40);
    assert.deepEqual(d.rows.slice(0, 3), ["First line of the paste, long enough", "to need a second row in the box.", "    indented"]);
    assert.equal(d.rows.slice(3).join(""), "y".repeat(90));
    assert.ok(d.lines.every((l) => l.length <= 40)); assert.equal(d.above + d.below, 0);
    // A paste taller than the box scrolls inside it: the window keeps its size and its hints.
    s.press(`\x1b[200~${"line\n".repeat(60)}\x1b[201~`);
    d = draft(s, 40);
    assert.equal(d.rows.length, 15); assert.ok(d.above > 40); assert.equal(d.lines.length, 30); assert.match(d.lines.at(-1), /enter add it as a task/);
  } finally { w.cleanup(); }
});

test("a reply to a task's agent wraps in the same box, under the agent's latest message", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f." }], reviewer: [{ verdict: { meets: true, text: "Good.", findings: [{ severity: "minor", subject: "f.txt has no title", where: "f.txt" }] } }] });
    const id = A.add(w.root, "Make f").id;
    A.delegate(id); await settle(id);
    const s = open(w, { rows: 24 });
    s.v.sel = id; s.v.load(); s.press("space");
    assert.equal(s.v.reply, true);
    const words = Array.from({ length: 60 }, (_, i) => `word${i + 1}`).join(" ");
    s.type(words);
    const d = draft(s, 50);
    assert.equal(d.rows.join(" "), words); assert.ok(d.rows.length > 5); assert.equal(d.above + d.below, 0);
    assert.equal(d.lines.length, 24); assert.ok(d.lines.every((l) => l.length <= 50));
    assert.ok(d.lines.some((l) => /^ . #\d+ Make f/.test(l)), "who the reply goes to still shows above the box");
    assert.ok(d.framed); assert.ok(d.lines.some((l) => /^│ Made f\. +│$/.test(l)), "the agent's latest message is in the same box");
    // A draft taller than the box scrolls inside it, and the box's own lines say how much is off it.
    s.type(" " + words + " " + words);
    const e = draft(s, 50);
    assert.equal(e.lines.length, 24); assert.ok(e.above > 0); assert.equal(e.below, 0); assert.match(e.lines.at(-1), /enter send to this task's agent/);
  } finally { w.cleanup(); }
});
