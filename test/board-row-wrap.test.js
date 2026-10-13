// Rows on a narrow screen wrap instead of being cut: a live task's name and what it says take up to two lines each,
// the selected task's name as many as it needs, one-line rows go without their time, and the highlight, the scroll and
// the fold work with rows of different heights. A wider screen is as it was.
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { GROUPS, groupOf } from "../src/board/view/states.js";

const at = Date.now() - 5 * 3600000;
const work = { state: "working", stage: "working", agent: "claude", at }, done = { state: "done", stage: "done", at }, todo = { state: "idle", stage: "todo", at };
const board = (list, more = {}) => {
  const v = Object.assign(Object.create(View.prototype), { theme, scope: "", byRepo: false, top: 0, sel: "", jobs: [], ...more });
  v.grouped = { groups: GROUPS.map((g) => [g, list.filter((r) => groupOf(r) === g)]), whole: false };
  v.rows = v.foldRows();
  return v;
};
const plain = (lines) => lines.map((l) => stripVTControlCharacters(l).trimEnd());
const words = (n, w = "word") => Array.from({ length: n }, (_, k) => `${w}${k + 1}`).join(" ");
const busy = { ...work, id: "p/1", title: "Research capy.ai and other coding agents for ideas we could use", msg: "Researching coding agents and harnesses for ideas, reading what each one says about itself", progress: 3 };
const long = { ...todo, id: "p/2", title: "Rethink how the Coordinator works, restarts and remembers what it was told before it stopped" };
const brief = { ...todo, id: "p/3", title: "Bring the board to herdr's web UI" };
const old = { ...done, id: "p/4", title: "Third row line on narrow screens for progress and more" };
const LIST = [busy, long, brief, old];

test("narrow screen: a live task's name and what it says wrap to two lines each, under the name, and are cut only after the second", () => {
  const v = board(LIST), rows = (r, width) => plain(v.rowLines(r, width, v.rowLayout(LIST, width)));
  assert.deepEqual(rows(busy, 49).slice(0, 4), [
    " ◐ Research capy.ai and other coding agents for",
    "   ideas we could use",
    "   Researching coding agents and harnesses for",
    "   ideas, reading what each one says about itself",
  ]);
  assert.match(rows(busy, 49)[4], /^ {3}[█░]+ +3% +5h$/); assert.equal(rows(busy, 49).length, 5); // the progress line stays under them
  // Longer than two lines: the second one is cut with "…", never a third.
  const wordy = { ...busy, title: words(30), msg: words(30, "say") }, lines = rows(wordy, 40);
  assert.equal(lines.length, 5); assert.ok(lines.every((l) => l.length <= 40));
  assert.match(lines[0], /^ ◐ word1 word2 .*\d$/); assert.match(lines[1], /^ {3}word\d+ .*…$/); assert.match(lines[2], /^ {3}say1 say2 .*\d$/); assert.match(lines[3], /^ {3}say\d+ .*…$/);
  // What fits one line takes one line: a short row is the three lines it was.
  assert.deepEqual(rows({ ...busy, title: "Short", msg: "Busy." }, 49).slice(0, 2), [" ◐ Short", "   Busy."]);
  // With nothing to say yet, its line is still there.
  assert.deepEqual(rows({ ...busy, msg: "" }, 49).slice(2, 3), ["   …"]);
  // Every width: nothing runs off the edge, every line after the first starts under the name.
  for (const width of [20, 30, 38, 49, 60, 79]) for (const l of rows(wordy, width)) { assert.ok(l.length <= width, `at ${width}: ${l}`); assert.match(l, /^ ◐ | {3}\S/, `at ${width}: ${l}`); }
});

test("narrow screen: the selected row shows its whole name, on as many lines as it needs, in every section", () => {
  for (const r of [busy, long, old]) {
    const title = `${words(40)} end`, rec = { ...r, title }, list = LIST.map((x) => (x === r ? rec : x));
    const v = board(list, { sel: r.id }), lines = plain(v.rowLines(rec, 49, v.rowLayout(list, 49)));
    const name = lines.slice(0, groupOf(rec) === "working" ? -3 : undefined);
    assert.ok(name.length > 4, "more than two lines"); assert.ok(name.every((l) => l.length <= 49));
    assert.equal(name.map((l) => l.slice(3)).join(" "), title, "the whole name, not cut"); assert.ok(name.slice(1).every((l) => l.startsWith("   ") && l[3] !== " "));
    // Not selected, it is cut again: two lines for a live task, one for any other.
    v.sel = ""; const back = plain(v.rowLines(rec, 49, v.rowLayout(list, 49)));
    assert.equal(back.length, groupOf(rec) === "working" ? 5 : 1); assert.match(back[groupOf(rec) === "working" ? 1 : 0], /…$/);
  }
  // In the list: the highlight covers every line of it, each to the edge, and its neighbours stay one line.
  const v = board(LIST, { sel: "p/2" }), mark = theme.selected("\0").split("\0")[0];
  const drawn = v.listLines(49, 30), lit = drawn.filter((l) => l.startsWith(mark));
  assert.deepEqual(plain(drawn).filter((l) => /Rethink|told before|Bring/.test(l)), [" ○ Rethink how the Coordinator works, restarts", "   and remembers what it was told before it", " ○ Bring the board to herdr's web UI"]);
  if (!process.env.NO_COLOR) { assert.equal(lit.length, 3); assert.ok(lit.every((l) => stripVTControlCharacters(l).length === 49)); }
});

test("narrow screen: to-do and done rows stay one line and go without their time, so the name has that room", () => {
  const v = board(LIST), narrow = plain(v.listLines(49, 30)), wide = plain(v.listLines(140, 30));
  assert.ok(narrow.includes(" ✓ Third row line on narrow screens for progress…")); assert.ok(narrow.includes(" ○ Bring the board to herdr's web UI"));
  assert.ok(narrow.includes(` ○ ${long.title.slice(0, 45)}…`), "a name cut at the edge, not before a time");
  assert.ok(!narrow.some((l) => /^ [○✓].* 5h/.test(l)));
  // A wider screen is as it was: the time at the right of every row, one line for a to-do or done row, two for a live one.
  assert.equal(wide.filter((l) => / 5h ago$/.test(l)).length, 3); assert.match(wide.find((l) => /Research/.test(l)), /^ ◐ Research.* 5h {4}$|^ ◐ Research.* 5h$/);
  assert.equal(wide.filter((l) => l.trim()).length, 3 + 5);
  const sel = board(LIST, { sel: "p/2" }), list = plain(sel.listLines(140, 30));
  assert.equal(list.filter((l) => l.trim()).length, 3 + 5, "the selected row does not wrap on a wide screen");
});

test("narrow screen, rows of different heights: the selected row is whole and in view while you move, and the list never runs past its room", () => {
  const many = [
    ...Array.from({ length: 4 }, (_, n) => ({ ...work, id: `p/${n + 1}`, title: n % 2 ? `Working ${n + 1}` : `Working ${n + 1} ${words(12)}`, msg: n > 1 ? words(20, "say") : "Busy.", progress: 10 })),
    ...Array.from({ length: 4 }, (_, n) => ({ ...todo, id: `p/${n + 10}`, title: `Later ${n + 1} ${words(n * 9)}`.trim() })),
    ...Array.from({ length: 7 }, (_, n) => ({ ...done, id: `p/${n + 20}`, title: `Finished ${n + 1} ${words(n * 4)}`.trim(), at: at - n * 60000 })),
  ];
  for (const h of [6, 9, 14, 22, 40]) {
    const v = board(many, { sel: "p/1" }), mark = theme.selected("\0").split("\0")[0];
    const look = () => {
      const drawn = v.listLines(44, h), lines = plain(drawn), rec = many.find((r) => r.id === v.sel), note = `h ${h}, at ${v.sel}\n${lines.join("\n")}`;
      assert.equal(drawn.length, h, note); assert.ok(lines.every((l) => l.length <= 44), note);
      const tall = v.rowHeight(rec, 44, true);
      assert.equal(tall, v.rowLines(rec, 44, v.rowLayout(many, 44)).length, "the height the list counts with is the height drawn");
      assert.ok(lines.some((l) => l.includes(rec.title.split(" ").slice(0, 2).join(" "))), `the selected task's name is in view: ${note}`);
      if (!process.env.NO_COLOR) assert.equal(drawn.filter((l) => l.startsWith(mark)).length, Math.min(tall, h), `every line of the selected row is lit: ${note}`);
    };
    look();
    for (let n = 1; n < many.length; n++) { v.move(1); look(); }
    assert.equal(groupOf(many.find((r) => r.id === v.sel)), "done");
    for (let n = 1; n < many.length; n++) { v.move(-1); look(); }
    assert.equal(v.sel, "p/1");
  }
});

test("narrow screen: the fold counts wrapped lines, so the '… N more' lines still keep the live rows in view", () => {
  const list = [
    { ...busy, id: "p/1" },
    ...Array.from({ length: 6 }, (_, n) => ({ ...todo, id: `p/${n + 10}`, title: `Later ${n + 1}` })),
    ...Array.from({ length: 8 }, (_, n) => ({ ...done, id: `p/${n + 20}`, title: `Finished ${n + 1}`, at: at - n * 60000 })),
  ];
  const v = board(list, { sel: "p/10" });
  const look = (h) => { const lines = plain(v.listLines(49, h)); return { lines, done: lines.filter((l) => /Finished/.test(l)).length, later: lines.filter((l) => /Later/.test(l)).length, more: lines.find((l) => /more to do/.test(l)), folded: lines.find((l) => /more \(/.test(l)) }; };
  // Room for all of it: working 2+5 (two lines of name, two of words, the progress), to do 2+6, done 2+5+1 = 23.
  assert.deepEqual([look(23).done, look(23).later, look(23).more, look(23).folded], [5, 6, undefined, "   … 3 more (? shows all done)"]);
  // One line short, and it is the wrapped lines that are counted: a done row gives way.
  assert.deepEqual([look(22).done, look(22).later], [4, 6]);
  assert.deepEqual([look(19).done, look(19).later, look(19).folded], [1, 6, "   … 7 more (? shows all done)"]);
  assert.deepEqual([look(17).later, look(17).more], [3, "   … 3 more to do"]);
  for (const h of [23, 22, 19, 17]) { assert.ok(look(h).lines.some((l) => /Research capy/.test(l)), `the live row is in view at ${h}`); assert.equal(v.top, 0); }
  // The selected row growing to its whole name takes lines from the rows that give way, not from the screen.
  const wordy = list.map((r) => (r.id === "p/10" ? { ...r, title: `Later 1 ${words(20)}` } : r)), w = board(wordy, { sel: "p/10" });
  const lines = plain(w.listLines(49, 23)); assert.equal(lines.length, 23); assert.ok(lines.some((l) => /word20$/.test(l)));
  const grown = w.rowHeight(wordy.find((r) => r.id === "p/10"), 49, true) - 1;
  assert.ok(grown >= 2); assert.equal(lines.filter((l) => /Finished/.test(l)).length, 5 - grown); assert.equal(w.top, 0);
});

test("all machines, narrow screen: a wrapped name has the line to itself, and what a task says never wraps in a few cells beside a long machine name", () => {
  const v = board([], { scope: "*" });
  const far = { ...busy, host: "very-long-machine-name-on-the-tailnet", title: "Fix login", msg: "Running the tests one by one" }, wordy = { ...busy, host: "box" };
  const rows = (r) => plain(v.rowLines(r, 40, v.rowLayout([far, wordy], 40)));
  assert.match(rows(far)[0], /^ ◐ very-long-machine.*… Fix login$/); assert.equal(rows(far)[1], "   Running the tests one by one"); assert.equal(rows(far).length, 3);
  assert.deepEqual(rows(wordy).slice(0, 2), [" ◐ Research capy.ai and other coding", "   agents for ideas we could use"]); // the name wins over the machine's
  assert.deepEqual(rows({ ...far, host: "box" }).slice(0, 2), [" ◐ box Fix login", "       Running the tests one by one"]);
});
