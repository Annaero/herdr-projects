// A title's length limit: one number, the same for a task typed, added or renamed. A longer title is shortened at a word and its full text is kept in the description.
import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { main } from "../src/cli.js";

const LONG = "After the startup dialog handoff, finish jobs wrongly mark the untouched task as stopped without a summary.";
const SHORT = "After the startup dialog handoff, finish jobs wrongly mark…";
const len = (s) => Array.from(s).length;

test("a title that fits is kept; a longer one is cut at a word and ends in an ellipsis", () => {
  assert.equal(S.TITLE_MAX, 60);
  assert.equal(S.shortTitle("Add a column"), "Add a column");
  const exact = "x".repeat(60); assert.equal(S.shortTitle(exact), exact);
  assert.equal(S.shortTitle(LONG), SHORT); assert.ok(len(SHORT) <= 60);
  // Only the full stop was too much: it goes, and nothing is marked as cut.
  assert.equal(S.shortTitle("x".repeat(60) + "."), exact); assert.equal(S.titled("x".repeat(60) + ".").cut, false);
  // One very long word has no word boundary to cut at: it is cut where the room ends.
  assert.equal(S.shortTitle("y".repeat(90)), "y".repeat(59) + "…");
  // The cut never leaves a comma or a dash hanging, and characters are counted, not bytes.
  assert.equal(S.shortTitle(`${"ab ".repeat(18)}cd, - efgh ijkl`), `${"ab ".repeat(18)}cd…`);
  assert.equal(len(S.shortTitle("é".repeat(80))), 60);
  // Room on the screen is what is limited: a wide character takes two cells, so 30 of them fill a title, and the
  // store counts cells as the board's rows do.
  assert.equal(S.shortTitle("界".repeat(30)), "界".repeat(30)); assert.equal(S.shortTitle("界".repeat(60)), "界".repeat(29) + "…"); assert.equal(S.shortTitle("😀".repeat(80)), "😀".repeat(29) + "…");
  for (const x of ["Add a column", "界".repeat(60), "😀".repeat(80), "☀️".repeat(60), "©️".repeat(60), "↔️".repeat(60), "⌚".repeat(60), "⚡".repeat(60), "🈀".repeat(60), "👨‍👩‍👧".repeat(40), "🇸🇪".repeat(40), "한국어 제목 ".repeat(20), "e\u0301".repeat(80), "ｆｕｌｌ ｗｉｄｔｈ ".repeat(9), "日本語のタイトル and English words mixed ".repeat(4)]) {
    assert.equal(S.titleWidth(x), visibleWidth(x), x); assert.ok(visibleWidth(S.shortTitle(x)) <= 60, x);
  }
  assert.equal(S.shortTitle("two\nlines"), "two lines");
  for (const n of [61, 75, 120, 300]) assert.ok(len(S.shortTitle("word ".repeat(n).slice(0, n))) <= 60, String(n));
});

test("where the board's measure cannot be loaded, the count used is never too low: the title still fits the row", () => {
  // Every character below U+2800 (all the narrow alphabets, and the symbols that become emoji) and a spread of the
  // rest, alone, shown as an emoji, and after a letter: never counted as less than the row counts it.
  const low = [];
  for (let cp = 0x20; cp < 0x3ffff; cp += cp < 0x2800 ? 1 : 37) {
    if ((cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0x7f && cp < 0xa0)) continue;
    const c = String.fromCodePoint(cp);
    for (const x of [c, `${c}\ufe0f`, `a${c}`]) if (S.roughWidth(x) < visibleWidth(x)) low.push(cp.toString(16));
  }
  assert.deepEqual(low, []);
  // Titles shortened by that count alone fit 60 cells as the row measures them.
  for (const x of ["☀️".repeat(60), "©️".repeat(60), "↔️".repeat(60), "⌚".repeat(60), "⚡".repeat(60), "🈀".repeat(60), "界".repeat(60), "😀".repeat(80), "👨‍👩‍👧".repeat(40), "🇸🇪".repeat(40), "e\u0301".repeat(80), "Ünïcödé wörds ánd ☀️ sün ".repeat(5)]) {
    const short = S.shortTitle(x, 60, S.roughWidth);
    assert.ok(S.roughWidth(x) >= visibleWidth(x), x); assert.ok(visibleWidth(short) <= 60, x); assert.ok(short.endsWith("…"), x);
  }
  // Plain and accented letters are counted exactly: such a title is not cut sooner than with the board's measure.
  for (const x of ["Add a column", "é".repeat(80), "Ünïcödé wörds ".repeat(8), "Заголовок задачи ".repeat(6)]) assert.equal(S.shortTitle(x, 60, S.roughWidth), S.shortTitle(x), x);
});

test("add, rename and report --title follow the limit, and the full text stays in the description", async () => {
  const w = await world();
  const write = process.stdout.write; let said = "";
  const board = async (...args) => { said = ""; process.stdout.write = (x, ...more) => { if (typeof x !== "string") return write.call(process.stdout, x, ...more); said += x; return true; }; try { await main(args); } finally { process.stdout.write = write; } return said; };
  try {
    const one = A.add(w.root, LONG, { description: "It happens on a slow machine." });
    assert.deepEqual([one.title, one.description], [SHORT, `${LONG}\n\nIt happens on a slow machine.`]);
    // A description that already says it is not given it twice; a title that fits changes nothing.
    assert.equal(A.add(w.root, LONG, { description: `Seen today:\n${LONG}` }).description, `Seen today:\n${LONG}`);
    assert.deepEqual([A.add(w.root, LONG).description, A.add(w.root, "Add a column", { description: "why" }).description], [LONG, "why"]);
    // Renamed: the same rule, and what the task already said is kept under the new full text.
    const plain = A.add(w.root, "Old name", { description: "Details." });
    assert.deepEqual([A.rename(plain.id, "New name").title, S.get(plain.id).description], ["New name", "Details."]);
    const again = A.rename(plain.id, LONG);
    assert.deepEqual([again.title, again.description], [SHORT, `${LONG}\n\nDetails.`]);
    assert.equal(A.rename(plain.id, "  ").title, SHORT); // an empty title changes nothing
    const told = A.report(plain.id, { title: `${"Renamed while it is marked as blocked ".repeat(3)}`, state: "blocked", msg: "why" });
    assert.ok(len(told.title) <= 60); assert.match(told.title, /^Renamed while it is marked as blocked Renamed while it is…$/); assert.match(told.description, /^Renamed while it is marked as blocked Renamed .*\n\n/);
    // The command line says so, with the number, to whoever gave the long title; a title that fits says nothing.
    assert.match(await board("add", LONG, "--repo", w.root), /added The title was over 60 characters, so it was shortened to "After the startup dialog handoff, finish jobs wrongly mark…" and the full text was kept in the description\./);
    assert.doesNotMatch(await board("add", "A short one", "--repo", w.root), /60 characters/);
    assert.match(await board("report", plain.id, "--title", LONG), /updated \(title\) The title was over 60 characters/);
    assert.match(await board("report", "--title", LONG, "--repo", w.root), /added The title was over 60 characters/);
    assert.ok(S.list().every((t) => len(t.title) <= 60));
    assert.match(await board("help"), /a title is at most 60 characters/);
  } finally { w.cleanup(); }
});
