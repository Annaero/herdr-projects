// What the rows of a section show when space is short: the same things on every row, given up together in one order.
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { NAME_OWED } from "../src/board/view/row-fit.js";

const at = Date.now() - 2 * 3600000; // "2h": the only "…m" on a row is then its minutes left
const work = { state: "working", stage: "working", agent: "claude", at }, ready = { state: "blocked", kind: "permission", stage: "approval", agent: "claude", at };
const done = { state: "done", stage: "done", at }, todo = { state: "idle", stage: "todo", at };
const GROUPS = ["ready to approve", "working", "done", "to do"];
const group = (r) => (r.kind ? GROUPS[0] : r.state === "working" ? GROUPS[1] : r.state === "done" ? GROUPS[2] : GROUPS[3]);
const board = () => { const v = Object.create(View.prototype); return Object.assign(v, { theme, scope: "", byRepo: false, top: 0, sel: "" }); };
// The list as the board draws it, under its headings: one line for each task, in the order given.
const draw = (v, list, width) => {
  v.rows = GROUPS.flatMap((g) => [{ header: g }, ...list.filter((r) => group(r) === g).map((rec) => ({ rec }))]);
  const lines = v.listLines(width, 80).map((l) => stripVTControlCharacters(l));
  return list.map((r) => lines.find((l) => l.slice(3).startsWith(r.title.slice(0, 8))));
};
// Where each column sits on a line: the bar and the PR number by their first cell, the right-aligned ones by their last.
const COLS = { bar: /[█░]{8}/, percent: /\d%/, eta: /\d[mh](?= .*\dh)/, review: /(?<!P)R#/, pr: /PR#/, time: /\dh(?=( ago)? *$)/ };
const ORDER = Object.keys(COLS);
const places = (line) => Object.fromEntries(Object.entries(COLS).map(([key, re]) => [key, line.slice(3).search(re)]).filter(([, n]) => n >= 0));
const has = (r) => ORDER.filter((key) => ({ bar: r.progress !== undefined, percent: r.progress !== undefined, eta: r.eta !== undefined, review: !!r.reviewRound, pr: !!r.pr, time: true }[key]));
const says = (r, line) => !!r.msg && line.includes("  " + r.msg.slice(0, 6));
// What each section shows, read off the drawn lines. It fails when two rows of a section differ: a thing is on
// every row that has it, or on none.
const shown = (list, lines, width) => Object.fromEntries(GROUPS.map((g) => {
  const set = {};
  list.forEach((r, n) => {
    if (group(r) !== g) return;
    const here = places(lines[n]);
    for (const key of has(r)) { set[key] ??= key in here; assert.equal(key in here, set[key], `${g}: ${key} is on some rows and not on others at ${width}:\n${lines.join("\n")}`); }
    if (r.msg) { set.says ??= says(r, lines[n]); assert.equal(says(r, lines[n]), set.says, `${g}: some rows say what they do and others do not at ${width}:\n${lines.join("\n")}`); }
  });
  return [g, set];
}));
const WIDTHS = [200, 160, 130, 118, 110, 104, 96, 90, 84, 80, 76, 72, 68, 64, 63, 60, 56, 52, 48, 46, 44, 40, 36, 30, 24];
// The mix on a busy board: short names and long ones (a title is 60 characters at most), with and without something
// to say, a percent, minutes left, a pull request, a review.
const pass = { meets: true, gate: "major", pass: true, text: "Works.", findings: [{ id: "F1", severity: "minor", subject: "A name is unclear", where: "a.js", proof: "" }] };
const MIX = [
  { ...ready, id: "p/1", title: "Add an undo", pr: 18, prState: "passing", review: pass, reviewRound: 12 },
  { ...ready, id: "p/2", title: "Sort the done list by when each task was finished, newest", pr: 9, prState: "passing" },
  { ...work, id: "p/3", title: "Details page crashes: artifactLines is not defined", msg: "Reading the panel and its tests.", progress: 72, eta: 1 },
  { ...work, id: "p/4", title: "Side panel: Status heading and wrapped Now text", msg: "Running the tests", stage: "reviewing", reviewRound: 1, progress: 5, eta: 5, pr: 63 },
  { ...work, id: "p/5", title: "Coordinator as a tab in the home space", progress: 72, eta: 3 },
  { ...work, id: "p/6", title: "Fix", msg: "Opening the pull request now.", progress: 60, eta: 16, pr: 1234, prState: "failing" },
  { ...work, id: "p/7", title: "Start", msg: "Looking around." },
  { ...done, id: "p/8", title: "An old thing", pr: 12, prState: "merged" },
  { ...done, id: "p/9", title: "Rewrite the whole of the first-run screen and what it asks", pr: 7, prState: "merged", reviewRound: 2, review: pass },
  { ...todo, id: "p/10", title: "Not begun" },
];

test("the rows of a section show the same things at every width, in one order, and the columns line up down the whole list", () => {
  const v = board(), seen = new Set(), was = {};
  for (const width of WIDTHS) {
    const lines = draw(v, MIX, width), where = {}, sets = shown(MIX, lines, width);
    lines.forEach((line, n) => {
      const r = MIX[n], here = places(line);
      assert.ok(line && line.length <= width, `${r.id} fits ${width}`);
      // A column starts at the same place on every row of the list, whatever its section shows.
      for (const [key, x] of Object.entries(here)) { where[key] ??= x; assert.equal(x, where[key], `${key} of ${r.id} is in line at ${width}:\n${lines.join("\n")}`); seen.add(key); }
      // The name comes before the extras: whole beside a bar, and never under NAME_OWED cells beside any column.
      const name = line.slice(3).match(/^(.*?)(…| {2}|$)/)[1];
      if ("bar" in here) assert.ok(line.slice(3).startsWith(r.title), `${r.id}: its name is cut beside a bar at ${width}`);
      if (Object.keys(here).length) assert.ok(name === r.title || name.length >= NAME_OWED - 1, `${r.id}: its name is cut to ${name.length} beside a column at ${width}`);
    });
    for (const g of GROUPS) {
      // A section gives its columns up from the left, the minutes left with their percent: what it shows is the right end.
      const set = sets[g], kept = ORDER.filter((key) => set[key]), could = ORDER.filter((key) => key in set);
      assert.deepEqual(kept, could.slice(could.length - kept.length), `${g} shows the right end of its columns at ${width}`);
      if ("eta" in set) assert.equal(set.percent, set.eta, `${g}: percent and minutes go together at ${width}`);
      // Narrower never brings a column back (the bar aside: the word "ago" going can make room for it again).
      const count = kept.filter((key) => key !== "bar").length;
      assert.ok(count <= (was[g] ?? count), `${g} shows more columns at ${width} than in a wider window`); was[g] = count;
    }
    // What the rows say goes before any column: the same list with nothing to say has every column where it was.
    v.sentence = () => ({ text: "" });
    const silent = draw(v, MIX, width); delete v.sentence;
    silent.forEach((line, n) => assert.deepEqual(places(line), places(lines[n]), `${MIX[n].id}: what it says moved a column at ${width}`));
  }
  assert.deepEqual([...seen].sort(), [...ORDER].sort()); // every column was looked at
  // Wide enough, everything shows; narrow enough, only names.
  assert.deepEqual(shown(MIX, draw(v, MIX, 200), 200).working, { bar: true, percent: true, eta: true, time: true, says: true, review: true, pr: true });
  assert.ok(draw(v, MIX, 24).every((line, n) => group(MIX[n]) === "to do" || !Object.keys(places(line)).length));
});

test("one row with no room for its bar takes the bar off every row of its section, and off no other section", () => {
  const v = board();
  // The board in the report: five working rows, three of them with names too long for a bar beside them.
  const five = [
    { ...work, id: "p/1", title: "Details page crashes: artifactLines is not defined", progress: 72, eta: 1 },
    { ...work, id: "p/2", title: "Side panel: Status heading and wrapped Now text", stage: "reviewing", reviewRound: 1, progress: 5, eta: 5, pr: 63 },
    { ...work, id: "p/3", title: "Coordinator as a tab in the home space", progress: 72, eta: 3 },
    { ...work, id: "p/4", title: "Board screen glitches when agents start or finish", progress: 60, eta: 16 },
    { ...work, id: "p/5", title: "Board closes when jumping into an agent", progress: 45, eta: 32, pr: 61, reviewRound: 5 },
  ];
  let lines = draw(v, five, 82);
  assert.ok(lines.every((l) => !/[█░]/.test(l)), lines.join("\n")); // no bar on any row, the short names too
  assert.ok(lines.every((l, n) => l.slice(3).startsWith(five[n].title) && /\d%/.test(l) && /\dm /.test(l))); // and nothing else went
  lines = draw(v, five, 90);
  assert.ok(lines.every((l) => /[█░]{8}/.test(l)), lines.join("\n")); // room for the longest name's bar: every row has its bar
  // The scope is the section: a long name under another heading leaves the bars of `working` alone.
  const two = [five[2], five[4], { ...ready, id: "p/8", title: "Rewrite the whole of the first-run screen and what it asks", progress: 100, pr: 7 }, { ...ready, id: "p/9", title: "Add an undo", progress: 100, pr: 12 }];
  lines = draw(v, two, 90);
  assert.match(lines[0], /^ ◐ Coordinator as a tab in the home space +█{6}░░ {2}72% {2}3m {12}2h {4}$/); assert.match(lines[1], /[█░]{8}/);
  assert.match(lines[2], /^ ✓ Rewrite the whole of the first-run screen and what it asks +100% +PR#7 +2h ago$/); assert.match(lines[3], /^ ✓ Add an undo +100% +PR#12 +2h ago$/); // its bar went with its neighbour's
  // One column down the whole list, whatever each section shows of it.
  assert.equal(lines[1].indexOf("PR#61"), lines[2].indexOf("PR#7")); assert.equal(lines[2].indexOf("PR#7"), lines[3].indexOf("PR#12")); assert.equal(lines[0].indexOf("72%") + 3, lines[3].indexOf("100%") + 4);
});

test("a long name is cut a little before its section loses a column, never for a bar, and never under its first cells", () => {
  const v = board();
  const long = { ...work, id: "p/1", title: "Rewrite the whole of the first-run screen and what it asks", progress: 40, eta: 12, pr: 7 }; // 58 cells
  const list = [long, { ...work, id: "p/2", title: "Fix login", progress: 55, eta: 3, pr: 35 }];
  const columns = 2 + 4 + 1 + 4 + 1 + 5 + 1 + 3, room = (width) => width - 3 - columns; // gap, percent, minutes (at their widest), PR#35, time
  assert.equal(long.title.length, 58);
  let lines = draw(v, list, 3 + 58 + columns); // the whole name beside every column but the bar
  assert.match(lines[0], /^ ◐ Rewrite the whole of the first-run screen and what it asks +40% 12m PR#7 +2h$/); assert.match(lines[1], /^ ◐ Fix login +55% {2}3m PR#35 +2h$/);
  lines = draw(v, list, 3 + 58 + columns + 8); // not yet room for a bar: the name is not cut for one
  assert.ok(lines.every((l) => !/[█░]/.test(l)) && lines[0].includes(long.title));
  assert.ok(draw(v, list, 3 + 58 + columns + 9).every((l) => /[█░]{8}/.test(l)));
  for (const width of [3 + 56 + columns, 70, 3 + NAME_OWED + columns]) { // narrower: the long name is cut, and both rows keep every column
    lines = draw(v, list, width);
    assert.match(lines[0], /^ ◐ Rewrite the whole of the first-run scre[^…]*… +40% 12m PR#7 +2h$/, `cut at ${width}`); assert.match(lines[1], /^ ◐ Fix login +55% {2}3m PR#35 +2h$/);
    assert.ok(lines[0].slice(3).indexOf("…") + 1 >= Math.min(NAME_OWED, room(width)), `the name keeps its first ${NAME_OWED} cells at ${width}`);
  }
  lines = draw(v, list, 3 + NAME_OWED + columns - 1); // under that the name wins: the percent and the minutes go, on both rows
  assert.match(lines[0], /^ ◐ Rewrite the whole of the first-run screen [^…]*… +PR#7 +2h$/); assert.match(lines[1], /^ ◐ Fix login +PR#35 +2h$/);
  // A short name is never cut for a column: it is whole wherever one shows.
  for (const width of WIDTHS) { const line = draw(v, list, width)[1]; if (Object.keys(places(line)).length) assert.ok(line.slice(3).startsWith("Fix login ")); }
});

test("what a row says shows on every row of its section that says something, or on none", () => {
  const v = board();
  const list = [
    { ...work, id: "p/1", title: "Fix login", msg: "Tracing why the login form rejects valid passwords.", progress: 55, pr: 3 },
    { ...work, id: "p/2", title: "Fix layout for task names in narrow terminal board", msg: "Writing the tests for every width.", progress: 20 },
    { ...work, id: "p/3", title: "Quiet", progress: 20 },
  ];
  let lines = draw(v, list, 110);
  assert.match(lines[0], /^ ◐ Fix login {2}Tracing why the login form rejects valid passwords\. +█/); assert.match(lines[1], /board {2}Writing the tests for every wi… +█/); // each cut to its own room
  lines = draw(v, list, 95); // the long name leaves too little to say anything worth reading: the short one says nothing either
  assert.match(lines[0], /^ ◐ Fix login +█{4}░{4} {2}55% PR#3 +2h$/); assert.match(lines[1], /board +█/); assert.match(lines[2], /^ ◐ Quiet +█/);
  for (const width of WIDTHS) shown(list, draw(v, list, width), width);
  // A row with nothing to say does not count: beside it the others still say what they do.
  assert.match(draw(v, [list[0], list[2]], 95)[0], /^ ◐ Fix login {2}Tracing why the login form rejects valid pa/);
});

test("what is shown does not change as percents, minutes left and times tick", () => {
  const v = board();
  const ticks = [[0, 1, at], [9, 9, at], [10, 10, at - 3600000], [55, 99, at - 9 * 3600000], [100, 100, at - 20 * 3600000], [99, 240, at], [50, 999, at], [50, 1000, at], [5, 1007, at], [5, 99999, at], [3, 7, at]];
  for (const width of WIDTHS.concat([95, 94, 93, 92, 91, 89, 88, 87, 86, 85, 75, 74, 73, 71])) {
    const sets = ticks.map(([progress, eta, since]) => {
      const list = MIX.map((r) => ({ ...r, at: since, ...(r.progress !== undefined ? { progress } : {}), ...(r.eta !== undefined ? { eta } : {}) }));
      return JSON.stringify(shown(list, draw(v, list, width), width));
    });
    assert.deepEqual([...new Set(sets)], [sets[0]], `the things shown change with the numbers at ${width}`);
  }
});

test("minutes left are never wider than four cells, and a machine's name beside a task's takes no row's words", () => {
  const v = board();
  // The reviewer's case: 999m turning 1000m at a fixed width. From a thousand on they read as hours.
  const pair = (eta) => [{ ...work, id: "p/1", title: "A title that is forty cells long, exactly", progress: 5, eta }, { ...work, id: "p/2", title: "Fix login", progress: 5, eta }];
  assert.equal(pair(1)[0].title.length, 41);
  for (const width of [67, 66, 58, 57, 50]) {
    const sets = [999, 1000, 1007, 999].map((eta) => { const list = pair(eta); return JSON.stringify(shown(list, draw(v, list, width), width)); });
    assert.deepEqual([...new Set(sets)], [sets[0]], `999m to 1000m changes what shows at ${width}`);
  }
  assert.match(draw(v, pair(999), 80)[1], /% 999m +2h$/); assert.match(draw(v, pair(1000), 80)[1], /% 17h +2h$/); assert.match(draw(v, pair(1e7), 80)[1], /% 999h +2h$/);
  // All machines: a machine's name sits in the room the fit counted, never in room the row's words were promised.
  v.scope = "*";
  const far = [{ ...work, id: "p/1", title: "A title that is forty cells long, exactly", host: "long-machine-name", msg: "X", progress: 50, eta: 1 }, { ...work, id: "p/2", title: "Fix login", msg: "X", progress: 50, eta: 1 }];
  for (let width = 30; width <= 120; width++) {
    draw(v, far, width); // with a machine's name before it a line does not start with its task's name: found by it anywhere
    const all = v.listLines(width, 20).map((l) => stripVTControlCharacters(l)), lines = far.map((r) => all.find((l) => l.includes(r.title.slice(0, 6)))), said = lines.map((l) => / {2}X( |$)/.test(l));
    assert.equal(said[0], said[1], `only one row says X at ${width}:\n${lines.join("\n")}`);
    assert.ok(lines.every((l) => l.length <= width));
  }
});
