// A live task's row on a narrow screen: its third line (the bar, the percent, the minutes left, the review tag, the
// pull request, the time), the width where it switches, the highlight, scrolling, and the to-dos giving way after the
// done rows in a list taller than its room.
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { GROUPS, groupOf } from "../src/board/view/states.js";
import { TALL_BELOW } from "../src/board/view/row-tall.js";

const at = Date.now() - 2 * 3600000; // "2h": the only "…m" on a row is then its minutes left
const work = { state: "working", stage: "working", agent: "claude", at }, ready = { state: "blocked", kind: "permission", stage: "approval", agent: "claude", at };
const done = { state: "done", stage: "done", at }, todo = { state: "idle", stage: "todo", at };
const pass = { meets: true, gate: "major", pass: true, text: "Works.", findings: [{ id: "F1", severity: "minor", subject: "A name is unclear", where: "a.js", proof: "" }] };
// A board with these tasks under their headings, as load() leaves it.
const board = (list, more = {}) => {
  const v = Object.assign(Object.create(View.prototype), { theme, scope: "", byRepo: false, top: 0, sel: "", jobs: [], ...more });
  v.grouped = { groups: GROUPS.map((g) => [g, list.filter((r) => groupOf(r) === g)]), whole: false };
  v.rows = v.foldRows();
  return v;
};
const plain = (lines) => lines.map((l) => stripVTControlCharacters(l));
const agent = { ...work, id: "p/1", title: "Agent at work", msg: "Reading the panel and its tests.", progress: 40, eta: 12 };
const review = { ...work, id: "p/2", title: "Under review with a name that is long enough to be cut", stage: "reviewing", reviewRound: 1, msg: "Running the tests", progress: 70, eta: 3, pr: 17 };
const waits = { ...ready, id: "p/3", title: "Good work", review: pass, reviewRound: 1, pr: 18 };
const fresh = { ...work, id: "p/4", title: "Just started" };
const LIVE = [agent, review, waits, fresh];

test("narrow screen: a live row's third line has the bar, the percent, the minutes left, the review tag, the pull request and the time, and fills the width", () => {
  const v = board(LIVE);
  for (const width of [40, 44, 48, 50, 55, 79]) {
    const layout = v.rowLayout(LIVE, width), rows = LIVE.map((r) => plain(v.rowLines(r, width, layout)));
    const note = `at ${width}:\n${rows.flat().join("\n")}`;
    // A name longer than its line wraps onto a second one (board-row-wrap.test.js): that row is one line taller.
    const long = width < 3 + review.title.length ? 1 : 0;
    rows.forEach((lines, n) => { assert.equal(lines.length, n === 1 ? 3 + long : 3, note); assert.ok(lines.every((l) => l.length <= width), note); assert.equal(lines.at(-1).length, width, note); });
    // Line 1 is the mark and the name with the whole width: nothing beside it.
    assert.equal(rows[0][0].trimEnd(), " ◐ Agent at work"); assert.equal(rows[2][0].trimEnd(), " ✓ Good work"); assert.equal(rows[3][0].trimEnd(), " ◐ Just started");
    assert.equal(rows[1].slice(0, 1 + long).map((l) => l.trim().replace(/^◐ /, "")).join(" "), review.title, note);
    // Then what the task says, as on a wide screen.
    assert.deepEqual(rows.map((lines) => lines.at(-2).trimEnd()), ["   Reading the panel and its tests.", "   Running the tests", "   Pass · 1 minor", "   …"]);
    for (const lines of rows) lines[2] = lines.at(-1);
    // Line 3, in order. The bar takes the room the others leave, so it is as long on every row.
    const bar = width - 34;
    assert.match(rows[0][2], new RegExp(`^ {3}█+░+ {3}40% {2}12m +2h$`), note); assert.match(rows[1][2], new RegExp(`^ {3}█+░+ {3}70% {3}3m {2}R#1 PR#17 +2h$`), note);
    for (const n of [0, 1]) assert.equal(/[█░]+/.exec(rows[n][2])[0].length, bar, note);
    assert.equal(/█+/.exec(rows[0][2])[0].length, Math.round(0.4 * bar), note);
    assert.match(rows[2][2], /^ +R#1 PR#18 +2h ago$/, note); // no progress: the bar's room is empty
    assert.match(rows[3][2], /^ +2h$/, note); // nothing yet: the time alone, so the row is as tall as the others
    assert.equal(rows[1][2].indexOf("R#1"), rows[2][2].indexOf("R#1"), note); // the tags start under each other
  }
  if (!process.env.NO_COLOR) { // their usual colours: the agent's amber, the reviewer's blue, a passed review's green, the time greyed
    const ink = (c) => theme.fg(c, "\0").split("\0")[0], layout = v.rowLayout(LIVE, 48), third = (r) => v.rowLines(r, 48, layout).at(-1);
    assert.ok(third(agent).includes(`${ink("yellow")}█`) && third(agent).includes(`${ink("yellow")} 40%`) && third(agent).includes(`${ink("yellow")}12m`));
    assert.ok(third(review).includes(`${ink("review")}█`) && third(review).includes(`${ink("review")}R#1`));
    assert.ok(third(waits).includes(`${ink("green")}R#1`)); assert.ok(third(fresh).includes(`${ink("overlay0")}2h`));
  }
});

test("the third line is there under 80 columns of screen and gone from 80 on, for every live row at once; done and to-do rows stay one line", () => {
  const quiet = [{ ...todo, id: "p/8", title: "Not begun" }, { ...done, id: "p/9", title: "Finished", pr: 3, reviewRound: 1, review: pass }];
  const v = board([...LIVE, ...quiet]);
  assert.equal(TALL_BELOW, 80);
  const heights = (width, screen) => { const layout = v.rowLayout([...LIVE, ...quiet], width, undefined, screen); return [...LIVE, ...quiet].map((r) => v.rowLines(r, width, layout).length); };
  for (const width of [60, 79]) assert.deepEqual(heights(width), [3, 3, 3, 3, 1, 1], `at ${width}`);
  // Narrower, the names and words that do not fit their line wrap (board-row-wrap.test.js): no live row is under three.
  for (const width of [30, 40, 55]) { const tall = heights(width); assert.ok(tall.slice(0, 4).every((n) => n >= 3), `at ${width}`); assert.deepEqual(tall.slice(4), [1, 1], `at ${width}`); }
  for (const width of [80, 81, 120, 200]) assert.deepEqual(heights(width), [2, 2, 2, 2, 1, 1], `at ${width}`);
  // It is the screen that counts: a list made narrow by the task panel beside it, on a wide screen, is as it was.
  assert.deepEqual(heights(60, 120), [2, 2, 2, 2, 1, 1]);
  // The list: headings and one-line rows as ever, a one-line row's tags still beside its name. Its time is not: on
  // a narrow screen its name has that room.
  const narrow = plain(v.listLines(60, 40)), wide = plain(v.listLines(80, 40));
  assert.equal(narrow.filter((l) => l.trim()).length - wide.filter((l) => l.trim()).length, 4, "one more line for each of the four live rows");
  assert.match(narrow.find((l) => /Finished/.test(l)), /^ ✓ Finished +R#1 PR#3$/); assert.match(narrow.find((l) => /Not begun/.test(l)), /^ ○ Not begun *$/);
  assert.match(wide.find((l) => /Finished/.test(l)), /^ ✓ Finished +R#1 PR#3 +2h$/); assert.match(wide.find((l) => /Not begun/.test(l)), /^ ○ Not begun +2h$/);
  // At 80 the columns sit beside a name of 40 cells: the widest of each kind, bar and all.
  const full = [{ ...agent, title: "A".repeat(40), eta: 120, reviewRound: 12, stage: "reviewing", pr: 123 }];
  assert.match(plain(v.rowLines(full[0], 80, v.rowLayout(full, 80)))[0], /^ ◐ A{40} {2}[█░]{8} {2}40% 120m {2}R#12 PR#123 {2}2h$/);
});

test("in a width too small for all of the third line the time stays and nothing runs off the edge", () => {
  const v = board(LIVE);
  for (const width of [14, 20, 24, 30, 36]) {
    const layout = v.rowLayout(LIVE, width);
    for (const r of LIVE) { const lines = plain(v.rowLines(r, width, layout)); assert.ok(lines.every((l) => l.length <= width), `at ${width}`); assert.match(lines.at(-1), / 2h( ago)?$/, `at ${width}: ${lines.at(-1)}`); }
  }
  const third = (width) => plain(v.rowLines(review, width, v.rowLayout(LIVE, width))).at(-1);
  assert.match(third(36), /^ {3}[█░]+ {3}70% {3}3m {2}R#1 PR#17 {3}2h$/); // the word "ago" goes for a bar that can be read
  assert.match(third(30), /^ +70% {3}3m {2}R#1 PR#17 {3}2h$/); // then the bar
  assert.match(third(20), /^ +70% {3}3m +2h$/); // then the tags, the percent and the minutes last
  assert.match(third(14), /^ {3}[█░]+ {3}2h$/); // the bar alone says the progress, in the room the numbers left
});

test("all machines, narrow screen: a machine's name, however long, takes nothing from the third line", () => {
  const v = board([], { scope: "*" });
  const far = { ...work, id: "p/1", title: "Fix login", stage: "reviewing", msg: "Running the tests", progress: 50, eta: 12, reviewRound: 12, pr: 123, host: "very-long-machine-name-on-the-tailnet" };
  const near = { ...far, id: "p/2", host: "" }, short = { ...far, id: "p/3", host: "box" };
  for (const width of [38, 40, 50, 55, 79]) {
    const list = [far, near, short], layout = v.rowLayout(list, width), rows = list.map((r) => plain(v.rowLines(r, width, layout)));
    const note = `at ${width}:\n${rows.flat().join("\n")}`;
    for (const lines of rows) { assert.equal(lines.length, 3, note); assert.ok(lines.every((l) => l.length <= width), note); }
    // Every field is there, the same line on each row whatever its machine: the bar as long, the time at the edge.
    assert.match(rows[0][2], /^ {3}█+░+ {3}50% {2}12m {2}R#12 PR#123 {3}2h$/, note); assert.equal(rows[0][2].length, width, note);
    assert.equal(rows[1][2], rows[0][2], note); assert.equal(rows[2][2], rows[0][2], note);
    assert.match(rows[0][0], /Fix login/, note); // the name wins over the machine's on line 1
  }
});

test("narrow screen: the highlight covers all three lines of the selected row, and the arrow keys go task by task", () => {
  const v = board([agent, fresh, { ...done, id: "p/9", title: "Finished" }], { sel: "p/1" });
  const mark = theme.selected("\0").split("\0")[0], lit = () => v.listLines(50, 20).filter((l) => l.startsWith(mark)).map((l) => stripVTControlCharacters(l));
  if (!process.env.NO_COLOR) {
    assert.deepEqual(lit().map((l) => l.trimEnd().replace(/ {2,}/g, "  ").replace(/[█░]+/, "bar")), [" ◐ Agent at work", "  Reading the panel and its tests.", "  bar  40%  12m  2h"]);
    assert.ok(lit().every((l) => l.length === 50)); // each to the screen's edge
  }
  v.move(1); assert.equal(v.sel, "p/4"); // one press, one task: never onto a row's second or third line
  if (!process.env.NO_COLOR) assert.deepEqual(lit().map((l) => l.trim()), ["◐ Just started", "…", "2h"]);
  v.move(1); assert.equal(v.sel, "p/9");
  if (!process.env.NO_COLOR) assert.equal(lit().length, 1); // a done row is one line
  v.move(-1); v.move(-1); assert.equal(v.sel, "p/1");
});

test("narrow screen: the list scrolls by whole rows, a row of three lines is never shown in part", () => {
  const many = [...Array.from({ length: 5 }, (_, n) => ({ ...work, id: `p/${n + 1}`, title: `Working ${n + 1}`, msg: `Says ${n + 1}`, progress: (n + 1) * 10 })), ...Array.from({ length: 3 }, (_, n) => ({ ...todo, id: `p/${n + 20}`, title: `Later ${n + 1}` }))];
  for (const h of [3, 4, 5, 6, 7, 8, 11]) {
    const v = board(many, { sel: "p/1" });
    const look = () => {
      const lines = plain(v.listLines(50, h)), note = `h ${h}, at ${v.sel}\n${lines.join("\n")}`;
      assert.equal(lines.length, h);
      const kind = (l) => { const m = /^ ◐ Working (\d) /.exec(l) || /^ {3}Says (\d)/.exec(l) || /^ {3}[█░]+ +(\d)0% /.exec(l); return m ? [[/^ ◐/, /^ {3}S/, /^ {3}[█░]/].findIndex((re) => re.test(l)), m[1]] : null; };
      lines.forEach((l, n) => {
        const k = kind(l); if (!k) return;
        const [part, row] = k;
        for (let p = 0; p < 3; p++) assert.deepEqual(kind(lines[n - part + p] ?? ""), [p, row], `line ${p + 1} of Working ${row} is missing: ${note}`);
      });
      const n = v.sel.split("/")[1];
      assert.ok(lines.some((l) => new RegExp(n < 20 ? `^ ◐ Working ${n} ` : `^ ○ Later ${n - 19} `).test(l)), `the selected task is in view: ${note}`);
    };
    look();
    for (let n = 1; n < many.length; n++) { v.move(1); look(); }
    for (let n = 1; n < many.length; n++) { v.move(-1); look(); }
  }
});

test("a list taller than its room: the done rows give way first, then the to-dos, and the live rows stay in view", () => {
  const list = [
    ...Array.from({ length: 2 }, (_, n) => ({ ...work, id: `p/${n + 1}`, title: `Working ${n + 1}`, msg: "Busy." })),
    ...Array.from({ length: 6 }, (_, n) => ({ ...todo, id: `p/${n + 10}`, title: `Later ${n + 1}` })),
    ...Array.from({ length: 8 }, (_, n) => ({ ...done, id: `p/${n + 20}`, title: `Finished ${n + 1}`, at: at - n * 60000 })),
  ];
  const v = board(list, { sel: "p/1" });
  const look = (h) => { const lines = plain(v.listLines(50, h)).map((l) => l.trimEnd()); return { lines, done: lines.filter((l) => /Finished/.test(l)).length, later: lines.filter((l) => /Later/.test(l)).map((l) => +/Later (\d)/.exec(l)[1]), note: lines.find((l) => /more to do/.test(l)) }; };
  const liveInView = (h) => { const { lines } = look(h); assert.ok(lines.some((l) => /Working 1/.test(l)) && lines.some((l) => /Working 2/.test(l)), `the live rows are in view at ${h}\n${lines.join("\n")}`); assert.equal(v.top, 0); };
  // Room for all of it: working 2+6, to do 2+6, done 2+5+1 = 24 lines.
  assert.deepEqual([look(24).done, look(24).later.length, look(24).note], [5, 6, undefined]);
  // Short of room, the done rows go first, down to the newest; no to-do goes while a done row can.
  assert.deepEqual([look(21).done, look(21).later.length], [2, 6]); assert.deepEqual([look(20).done, look(20).later.length, look(20).note], [1, 6, undefined]);
  // Then the to-dos, from the last one up, with a line that counts them.
  assert.deepEqual([look(18).done, look(18).later, look(18).note], [1, [1, 2, 3], "   … 3 more to do"]);
  assert.deepEqual([look(17).later, look(17).note], [[1, 2], "   … 4 more to do"]);
  for (const h of [24, 21, 20, 18, 17, 16]) liveInView(h);
  // Down to the first one; under that the list scrolls.
  assert.deepEqual([look(16).later, look(16).note], [[1], "   … 5 more to do"]); assert.deepEqual(look(12).later.length <= 1, true);
  assert.equal(v.rows.filter((row) => row.rec && groupOf(row.rec) === "to do").length, 1);
  // The arrow keys still go through every to-do: the one they land on shows, with the ones before it.
  look(18);
  const walk = [];
  for (let n = 0; n < 9; n++) { v.move(1); const seen = look(18); walk.push(v.sel); if (groupOf(list.find((r) => r.id === v.sel)) === "to do") { assert.ok(seen.later.includes(+v.sel.split("/")[1] - 9), `${v.sel} shows`); assert.equal(seen.later.length, 3); liveInView(18); } }
  assert.deepEqual(walk, ["p/2", "p/10", "p/11", "p/12", "p/13", "p/14", "p/15", "p/20", "p/20"]);
  v.sel = "p/14"; assert.deepEqual([look(18).later, look(18).note], [[3, 4, 5], "   … 3 more to do"]);
  v.move(-1); v.move(-1); v.move(-1); assert.deepEqual(look(18).later, [1, 2, 3]);
  // More room brings them back; all done, or a search, folds nothing.
  v.sel = "p/1"; assert.equal(look(24).later.length, 6);
  v.grouped.whole = true; v.rows = v.foldRows(); assert.equal(v.rows.filter((row) => row.rec).length, list.length);
});

test("to-dos give way only for live rows: a list with none scrolls as it always did", () => {
  const v = board(Array.from({ length: 12 }, (_, n) => ({ ...todo, id: `p/${n + 1}`, title: `Later ${n + 1}` })), { sel: "p/1" });
  for (const width of [50, 120]) {
    const lines = plain(v.listLines(width, 6));
    assert.equal(lines.filter((l) => /Later/.test(l)).length, 4); assert.ok(!lines.some((l) => /more to do/.test(l)));
  }
  for (let n = 0; n < 11; n++) v.move(1);
  assert.ok(plain(v.listLines(50, 6)).some((l) => /Later 12/.test(l)));
});
