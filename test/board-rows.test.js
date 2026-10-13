// One row of the list: its name, what it says, its columns; what a section's rows give up together when space is short; and a row on a narrow screen: its third line, and names and words that wrap. And a live task's row of two lines: which rows are, what
// the second line says, the highlight, scrolling by whole rows, the done rows giving way in a list taller than its room.
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { View, osc } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { machines } from "../src/remote.js";
import { open } from "./board-helpers.js";
import { GROUPS, groupOf, isLive } from "../src/board/view/states.js";
import { NAME_OWED } from "../src/board/view/row-fit.js";
import { TALL_BELOW } from "../src/board/view/row-tall.js";

test("a tight row keeps the task's name, then the columns on the right; what a live task says is on a line of its own", async () => {
  const w = await world();
  try {
    const s = open(w);
    const at = Date.now() - 6 * 60000;
    const records = [
      { id: "proj/1", state: "working", title: "Remove notification pop-ups", msg: "Removing pop-up calls from plugin, fixing tests, writing closing note.", progress: 95, at },
      { id: "proj/2", state: "working", title: "Fix ugly blocked row on the board", msg: "Fixing layout so approval names keep width.", progress: 55, pr: 3, at },
      { id: "proj/3", state: "done", title: "Truncate long descriptions in sidebar", pr: 2, at },
    ];
    const draw = (width) => { const layout = s.v.rowLayout(records, width, undefined, 200); return records.map((r) => stripVTControlCharacters(s.v.row(r, width, layout))); };
    for (const width of [200, 120, 90, 72, 64, 50, 40, 30, 20]) assert.ok(draw(width).every((l) => l.length <= width), `fits ${width}`);
    let rows = draw(200); // room for everything. The columns, in order: bar, percent, PR, time
    assert.match(rows[0], /Remove notification pop-ups +█+ +95% {8}6m {4}$/);
    assert.match(rows[1], /Fix ugly blocked row on the board +█+░+ +55% {2}PR#3 {2}6m {4}$/);
    { // what a working task says is under its name, with the row's whole width: cut at its end only when it is longer than that
      const under = (width) => stripVTControlCharacters(s.v.rowLines(records[0], width, s.v.rowLayout([records[0]], width, undefined, 200))[1]);
      assert.equal(under(200), "      Removing pop-up calls from plugin, fixing tests, writing closing note."); assert.equal(under(80), under(200));
      assert.match(under(50), /^[ ▌] {5}Removing pop-up calls from plugin, fixing[^…]*…$/); assert.equal(under(50).length, 50);
      assert.equal(s.v.rowLines(records[2], 200).length, 1); // a finished task has nothing to say: one line
    }
    assert.match(rows[2], /Truncate long descriptions in sidebar +PR#2 {2}6m ago$/); // "ago" on what has ended, a bare time on what still runs
    assert.equal(rows[1].indexOf("PR#3"), rows[2].indexOf("PR#2")); // the PR numbers sit in one column, next to the time
    rows = draw(75); // the name and the columns are whole
    assert.match(rows[0], /Remove notification pop-ups +\S.* 95% +6m {4}$/); assert.doesNotMatch(rows[0], /Remov[^ ]* {2}Re/);
    assert.match(rows[1], /Fix ugly blocked row on the board +█+░+ +55% {2}PR#3 {2}6m {4}$/);
    rows = draw(59); // a name needs its bar's room, so no row has a bar; "ago" stays wherever there is room for it
    assert.match(rows[0], /Remove notification pop-ups +95% +6m {4}$/);
    assert.match(rows[1], /Fix ugly blocked row on the board +55% {2}PR#3 +6m {4}$/); // a PR row keeps its percent while it fits
    assert.match(rows[2], /Truncate long descriptions in sidebar +PR#2 +6m ago$/);
    { // narrow, a finished task still reads differently from a working one
      const pair = [{ id: "proj/5", state: "working", title: "Still going", at }, { id: "proj/6", state: "done", title: "All done", at }];
      const lay = s.v.rowLayout(pair, 50, undefined, 200), [going, ended] = pair.map((r) => stripVTControlCharacters(s.v.row(r, 50, lay)));
      assert.match(going, /^[ ▌]◐ #\d+ Still going +6m {4}$/); assert.match(ended, /^[ ▌]✓ #\d+ All done +6m ago$/);
    }
    rows = draw(48); // the rows give up together what one name needs, from the left: the percent, then the PR number
    assert.match(rows[0], /Remove notification pop-ups +6m$/); assert.doesNotMatch(rows[0], /%/);
    assert.match(rows[1], /Fix ugly blocked row on the board +6m$/);
    assert.match(rows[2], /Truncate long descriptions in sidebar +6m$/);
    rows = draw(43); // last of all the time
    assert.match(rows[0], /^ \S #\d+ Remove notification pop-ups *$/); assert.match(rows[1], /^ \S #\d+ Fix ugly blocked row on the board *$/); assert.match(rows[2], /^ \S #\d+ Truncate long descriptions in sidebar$/);
    rows = draw(33); // only now is a name cut
    assert.match(rows[0], /^ \S #\d+ Remove notification pop-ups$/); assert.match(rows[1], /^ \S #\d+ Fix ugly blocked row on th…$/);
    { // the minutes left: right of the percent, always in minutes, in a column of their own so the percents line up
      const eta = [{ ...records[0], eta: 3 }, { ...records[1], eta: 130 }, records[2], { id: "proj/4", state: "working", title: "No guess yet", progress: 0, at }];
      const lines = (width) => { const lay = s.v.rowLayout(eta, width, undefined, 200); return eta.map((r) => stripVTControlCharacters(s.v.row(r, width, lay))); };
      for (const width of [200, 120, 90, 72, 64, 50, 40, 30, 20]) assert.ok(lines(width).every((l) => l.length <= width), `fits ${width}`);
      let e = lines(200);
      assert.match(e[0], /█+ +95% {3}3m left {8}6m {4}$/); assert.equal(e[0].indexOf("3m"), e[1].indexOf("130m") + 2); assert.match(e[1], /█+░+ +55% 130m left {2}PR#3 {2}6m {4}$/);
      assert.match(e[2], /sidebar +PR#2 {2}6m ago$/); assert.match(e[3], /No guess yet +░+ {2}0% {18}6m {4}$/); // no guess: no "m", the percent stays in line
      assert.equal(e[0].indexOf("95%"), e[1].indexOf("55%"));
      e = lines(66); // no bars: the minutes left stay beside the percent
      assert.match(e[0], /Remove notification pop-ups +95% {3}3m left +6m$/); assert.match(e[1], /Fix ugly blocked row on the board +55% 130m left {2}PR#3 +6m$/);
      assert.match(e[2], /sidebar +PR#2 +6m$/); // the list gives up the word "ago" so that a row keeps its percent
      e = lines(55); // short of room, the rows give up their percent and their minutes left together: no row keeps either
      assert.match(e[1], /Fix ugly blocked row on the board +PR#3 +6m$/); assert.match(e[0], /pop-ups +6m$/); assert.match(e[3], /No guess yet +6m$/);
      assert.equal(e[1].indexOf("PR#3"), e[2].indexOf("PR#2")); assert.ok(e.every((l) => !/%|\dm .*\dm/.test(l)));
      if (!process.env.NO_COLOR) { // the same colour as the percent, whatever the state: green under review
        const paint = (r) => s.v.row(r, 120, s.v.rowLayout([r], 120)), yellow = "\x1b[38;2;249;226;175m";
        assert.ok(paint(eta[1]).includes(`${yellow}55%\x1b[39m`) && paint(eta[1]).includes(`${yellow}130m left\x1b[39m`));
        const under = paint({ ...eta[1], stage: "reviewing", agent: "claude" }), colour = (s, word) => s.slice(0, s.indexOf(word)).match(/\x1b\[38;2;[\d;]+m(?!.*\x1b\[38)/s)?.[0];
        assert.ok(colour(under, "130m") && colour(under, "130m") === colour(under, "55%") && colour(under, "130m") !== yellow);
      }
      { // minutes left with no percent still show
        const only = { id: "proj/7", state: "working", title: "Only minutes", eta: 7, at };
        assert.match(stripVTControlCharacters(s.v.row(only, 60, s.v.rowLayout([only], 60, undefined, 200))), /^[ ▌]◐ #\d+ Only minutes +7m left +6m$/);
        assert.match(stripVTControlCharacters(s.v.row(only, 20, s.v.rowLayout([only], 20, undefined, 200))), /^[ ▌]◐ Only minutes +6m$/);
      }
      assert.match(osc(eta[1]), /:progress=55:eta=130:/); assert.doesNotMatch(osc(eta[3]), /eta=/);
    }
    // A long name beside a short one: the two rows show the same columns (the tests of the fit, below, have the rule).
    records.splice(0, 3,
      { id: "proj/8", state: "working", title: "Fix login", msg: "Tracing why the login form rejects valid passwords.", progress: 55, pr: 3, at },
      { id: "proj/9", state: "working", title: "Fix layout for task names in narrow terminal board", msg: "Working.", progress: 20, at });
    rows = draw(103);
    assert.match(rows[0], /Fix login +█+░+ +55% {2}PR#3 +6m$/); assert.match(rows[1], /board +█+░+ +20% +6m$/);
    rows = draw(75); // the long name has no room for a bar: neither row has one
    assert.match(rows[0], /Fix login +55% {2}PR#3 +6m$/); assert.match(rows[1], /Fix layout for task names in narrow terminal board +20% +6m$/);
    // All machines: the machine stands in the task's tag (`box#8`); a long name is cut there, before the number is,
    // so it costs a row fourteen cells at most.
    s.v.scope = "*";
    const far = { ...records[0], host: "very-long-machine-name-on-the-tailnet" };
    const one = (width) => stripVTControlCharacters(s.v.row(far, width, s.v.rowLayout([far], width, undefined, 200)));
    assert.match(one(120), /^ ◐ very-long-m…#\d+ Fix login +█/);
    assert.match(one(53), /^ ◐ very-long-m…#\d+ Fix login +(█+░+ +)?55% {2}PR#3 +6m$/); assert.match(one(44), /^ ◐ (very-long-m…#\d+ )?Fix login +(55% {2})?PR#3 +6m$/);
    assert.match(one(29), /^ \S Fix login +(55% {2})?PR#3 +6m$/); assert.match(one(27), /^ \S Fix login +PR#3 +6m$/); assert.match(one(18), /^ \S Fix login +6m$/); // too narrow for the task's number: it went too
    for (const width of [200, 60, 40, 30, 24, 16]) assert.ok(one(width).length <= width, `fits ${width}`);
  } finally { w.cleanup(); }
});

test("a row with no PR and no bar uses the empty space on its right, also with colours on and beside rows that fill every column", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() }); // "0s ago" is compared to the second: the clock stands still
  const v = Object.create(View.prototype); v.theme = theme; v.scope = "";
  const now = Date.now();
  const quiz = { id: "proj/1", title: "Choose the palette", state: "blocked", kind: "question", stage: "asks", agent: "claude", at: now, msg: "Sand or pebbles on the beach, and which palm?" };
  const full = [
    { id: "proj/2", title: "Add an undo", state: "blocked", kind: "permission", stage: "approval", agent: "claude", at: now, pr: 18, prState: "passing", review: { score: 3, recommend: false, text: "No." }, reviewRound: 2 },
    { id: "proj/3", title: "Tidy", state: "working", stage: "reviewing", agent: "claude", at: now, pr: 17, prState: "failing", progress: 40, reviewRound: 1, msg: "Running the tests" },
    { id: "proj/4", title: "Docs", state: "working", stage: "working", agent: "claude", at: now, progress: 80, msg: "Writing" },
  ];
  // The raw line, colour codes and all: this is what the terminal gets. (Comparing only the stripped text hid the bug:
  // an empty cell wrapped in colour codes is not empty, and was taken for a column the row had to leave room for.)
  for (const width of [80, 100, 150]) {
    const [line, under] = v.rowLines(quiz, width, v.rowLayout([quiz, ...full], width, undefined, SCREEN)).map((l) => stripVTControlCharacters(l));
    assert.match(line, /^[ ▌]\? #\d+ Choose the palette +0s ago$/, `the time at the right edge at ${width}`);
    assert.equal(line.length, width);
    assert.equal(under, "      Sand or pebbles on the beach, and which palm?", `whole sentence at ${width}`);
  }
  // Too narrow for the whole sentence: it is cut at the window's edge, not where the other rows' columns start.
  const tight = stripVTControlCharacters(v.rowLines(quiz, 43, v.rowLayout([quiz, ...full], 43, undefined, SCREEN))[1]);
  assert.match(tight, /^[ ▌] {5}Sand or pebbles on the beach, and wh[^…]*…$/); assert.equal(tight.length, 43);
  // The cause, pinned down: a cell a row does not have is the empty string, never colour codes around nothing.
  for (const r of [quiz, ...full, { ...quiz, state: "done", stage: "done" }, { ...quiz, state: "idle", stage: "todo" }])
    for (const [name, cell] of Object.entries(v.rowFields(r, now)))
      if (typeof cell === "string" && stripVTControlCharacters(cell) === "") assert.equal(cell, "", `${r.id} ${name}: an empty cell carries no colour codes`);
});

// ---- two lines ------------------------------------------------------------------------------------------------------
// The whole screen in these tests: a wide one, with the list beside the task panel at whatever width is drawn. So a
// live row keeps two lines and gives its columns up beside its name; under 80 columns of screen it has a third line.
const SCREEN = 120;
const at = Date.now() - 2 * 3600000;
const work = { state: "working", stage: "working", agent: "claude", at }, ready = { state: "blocked", kind: "permission", stage: "approval", agent: "claude", at };
const done = { state: "done", stage: "done", at }, todo = { state: "idle", stage: "todo", at };
const pass = { meets: true, gate: "major", pass: true, text: "Works.", findings: [{ id: "F1", severity: "minor", subject: "A name is unclear", where: "a.js", proof: "" }] };
const fail = { meets: false, gate: "major", pass: false, text: "No.", findings: [{ id: "F1", severity: "critical", subject: "It crashes", where: "a.js", proof: "ran it" }] };
// A board with these tasks under their headings, as load() leaves it.
const board = (list, more = {}) => {
  const v = Object.assign(Object.create(View.prototype), { theme, scope: "", byRepo: false, top: 0, sel: "", jobs: [], ...more });
  v.grouped = { groups: GROUPS.map((g) => [g, list.filter((r) => groupOf(r) === g)]), whole: false };
  v.rows = v.foldRows();
  return v;
};
const plain = (lines) => lines.map((l) => stripVTControlCharacters(l));
const LIVE = [
  { ...work, id: "p/1", title: "Agent at work", msg: "Reading the panel and its tests.", progress: 40, eta: 12 },
  { ...work, id: "p/2", title: "Under review", stage: "reviewing", reviewRound: 1, msg: "Running the tests", pr: 17 },
  { ...work, id: "p/3", title: "The board checks it", stage: "checking", msg: "Running the repo's check" },
  { ...ready, id: "p/4", title: "Good work", review: pass, reviewRound: 1, pr: 18 },
  { ...ready, id: "p/5", title: "Bad work", review: fail, reviewRound: 2, pr: 19 },
  { state: "blocked", kind: "question", stage: "asks", agent: "claude", at, id: "p/6", title: "Has a question", msg: "Sand or pebbles?" },
  { state: "error", stage: "failed", agent: "claude", at, id: "p/7", title: "Went wrong", msg: "The check failed" },
];
const QUIET = [{ ...done, id: "p/8", title: "Finished", pr: 3 }, { ...todo, id: "p/9", title: "Not begun" }, { ...work, id: "p/10", title: "Put away", msg: "Was busy.", archivedAt: at }];

test("a live task's row is two lines, the second what it says under its name; a done, to-do or archived one stays one line", () => {
  const v = board([]);
  for (const r of LIVE) assert.equal(isLive(r), true, r.title);
  for (const r of QUIET) { assert.equal(isLive(r), false, r.title); assert.equal(v.rowLines(r, 100).length, 1, r.title); }
  const under = (r, width = 100) => { const lines = plain(v.rowLines(r, width, v.rowLayout([r], width, undefined, SCREEN))); assert.equal(lines.length, 2, r.title); assert.doesNotMatch(lines[0], /Reading|Running|Pass|Fail|Sand|check failed/); assert.ok(lines.every((l) => l.length <= width)); return lines[1]; };
  // Indented to the name, which starts after the mark and the task's number; never beside the name.
  assert.deepEqual(LIVE.map((r) => under(r)), ["      Reading the panel and its tests.", "      Running the tests", "      Running the repo's check", "      Pass · 1 minor", "      Review failed · 1 critical", "      Sand or pebbles?", "      The check failed"]);
  assert.match(plain(v.rowLines(LIVE[0], 100))[0], /^[ ▌]◐ #\d+ Agent at work +█+░+ +40% 12m left +2h$/);
  // It has the row's whole width, and is cut at its end when it is longer still: never a third line.
  const long = { ...LIVE[0], msg: "Tracing how prefix+w got suggested, checking keys.js and the herdr defaults before changing the hint line." };
  assert.equal(under(long, 120), "      " + long.msg);
  assert.match(under(long, 63), /^[ ▌] {5}Tracing how prefix\+w got suggested, checking k[^…]*…$/); assert.equal(under(long, 63).length, 63);
  assert.equal(v.rowLines(long, 20, v.rowLayout([long], 20, undefined, SCREEN)).length, 2);
  if (!process.env.NO_COLOR) { // greyed, in the brighter of the two greys (it has to be read), and a review's result in its own colour
    const muted = theme.soft("\0").split("\0")[0], green = theme.fg("green", "\0").split("\0")[0], red = theme.fg("red", "\0").split("\0")[0];
    assert.ok(v.rowLines(LIVE[0], 100)[1].includes(`${muted}Reading`)); assert.ok(v.rowLines(LIVE[3], 100)[1].includes(`${green}Pass`)); assert.ok(v.rowLines(LIVE[4], 100)[1].includes(`${red}Review failed`));
  }
});

test("all machines: a remote task's second line starts under its task's name, right of the machine's name, at every width", () => {
  const v = board([], { scope: "*" });
  const far = { ...LIVE[0], host: "other-machine", title: "Remote task", msg: "Checking the implementation" }, near = { ...far, host: "" };
  for (const width of [200, 100, 60, 45, 38, 30, 24]) for (const list of [[far], [far, near, { ...far, host: "a-much-longer-machine-name-on-the-tailnet" }]]) for (const r of list) {
    const [first, under] = plain(v.rowLines(r, width, v.rowLayout(list, width, undefined, SCREEN)));
    assert.equal(under.search(/\S/), first.indexOf("Remote"), `${r.host || "this machine"} at ${width}:\n${first}\n${under}`); assert.ok(under.length <= width);
  }
  // (With every machine shown the machine stands in the task's tag, `other-machine#1`, never in its title.)
  assert.deepEqual(plain(v.rowLines(far, 100)).map((l) => l.slice(0, 47).trimEnd()), [" ◐ other-machi…#1 Remote task", " ".repeat(18) + "Checking the implementation"]);
  v.scope = ""; // one machine's board names no machine: under the name, right of the mark
  assert.equal(plain(v.rowLines(far, 100))[1], "      Checking the implementation");
});

test("a row with nothing to say yet keeps its second line, which says something true and quiet: rows do not change height when the words arrive", () => {
  const silent = { ...work, id: "p/1", title: "New one", msg: "Just started" }, waits = { ...ready, id: "p/2", title: "Never reviewed" };
  const v = board([silent, waits, { ...done, id: "p/3", title: "Finished" }]);
  // A working task: "Just started" until its first words, never a bare "…" and never an empty line: with no words
  // at all it says where it stands. Finished work nobody reviewed says that.
  assert.deepEqual(plain(v.rowLines(silent, 60, v.rowLayout([silent], 60, undefined, SCREEN))), [" ◐ #1 New one" + " ".repeat(45) + "2h", "      Just started"]);
  assert.equal(plain(v.rowLines({ ...silent, msg: "" }, 60, v.rowLayout([silent], 60, undefined, SCREEN)))[1].trim(), "Working"); // a board of an older version says nothing: the plain word, never a gap
  assert.equal(plain(v.rowLines({ ...silent, msg: "", stage: "progress" }, 60, v.rowLayout([silent], 60, undefined, SCREEN)))[1].trim(), "Yours: no agent on it");
  assert.deepEqual(plain(v.rowLines(waits, 60, v.rowLayout([waits], 60, undefined, SCREEN))).map((l) => l.trimEnd()), [" ◆ #2 Never reviewed" + " ".repeat(34) + "2h ago", "      Not reviewed"]);
  const before = plain(v.listLines(60, 20, SCREEN));
  silent.msg = "Reading the code."; waits.review = pass;
  const after = plain(v.listLines(60, 20, SCREEN));
  assert.equal(before.findIndex((l) => l.includes("Finished")), after.findIndex((l) => l.includes("Finished"))); // nothing below moved
  assert.deepEqual(after.filter((l) => l.startsWith("      ")).map((l) => l.trimEnd()), ["      Pass · 1 minor", "      Reading the code."]);
});

test("the highlight covers both lines of the selected row, and the arrow keys go task by task", () => {
  const v = board([...LIVE.slice(0, 2), QUIET[0]], { sel: "p/1" });
  const mark = theme.selected("\0").split("\0")[0], lit = () => v.listLines(80, 20).filter((l) => l.startsWith(mark)).map((l) => stripVTControlCharacters(l));
  if (!process.env.NO_COLOR) {
    assert.equal(lit().length, 2); assert.match(lit()[0], /^[ ▌]◐ #\d+ Agent at work +█+░+ +40% 12m left +2h *$/); assert.equal(lit()[1].trimEnd(), "▌     Reading the panel and its tests."); // the bar in the gutter is on every line of the selected row
    assert.ok(lit().every((l) => l.length === 80)); // each to the window's edge
  }
  v.move(1); assert.equal(v.sel, "p/2"); // one press, one task: never onto a row's second line
  if (!process.env.NO_COLOR) assert.deepEqual(lit().map((l) => l.slice(0, 23).trimEnd()), ["▌◑ #2 Under review", "▌     Running the tests"]);
  v.move(1); assert.equal(v.sel, "p/8");
  if (!process.env.NO_COLOR) assert.equal(lit().length, 1); // a done row is one line
  v.move(-1); v.move(-1); v.move(-1); assert.equal(v.sel, "p/1");
});

test("the list scrolls by whole rows: no row is ever shown half, and the selected one is always whole", () => {
  const many = [...Array.from({ length: 5 }, (_, n) => ({ ...work, id: `p/${n + 1}`, title: `Working ${n + 1}`, msg: `Says ${n + 1}` })), ...Array.from({ length: 3 }, (_, n) => ({ ...todo, id: `p/${n + 20}`, title: `Later ${n + 1}` }))];
  for (const h of [2, 3, 4, 5, 8]) {
    const v = board(many, { sel: "p/1" });
    const look = () => {
      const lines = plain(v.listLines(60, h, SCREEN));
      assert.equal(lines.length, h);
      lines.forEach((l, n) => {
        const first = /^[ ▌]◐ #\d+ +Working (\d+) /.exec(l), second = /^[ ▌] {6}Says (\d+)/.exec(l); // `#1` and `#20` share one column: every name starts in the same place
        if (first) assert.equal(lines[n + 1]?.trimEnd().replace(/^▌/, " "), `       Says ${first[1]}`, `h ${h}, at ${v.sel}: a first line with no second\n${lines.join("\n")}`);
        if (second) assert.match(lines[n - 1] ?? "", new RegExp(`^[ ▌]◐ #\\d+ +Working ${second[1]} `), `h ${h}, at ${v.sel}: a second line with no first\n${lines.join("\n")}`);
      });
      const n = v.sel.split("/")[1];
      assert.ok(lines.some((l) => new RegExp(n < 20 ? `^[ ▌]◐ #${n}  Working ${n} ` : `^[ ▌]○ #${n} Later ${n - 19} `).test(l)), `h ${h}: ${v.sel} is in view\n${lines.join("\n")}`);
    };
    look();
    for (let n = 1; n < many.length; n++) { v.move(1); look(); }
    for (let n = 1; n < many.length; n++) { v.move(-1); look(); }
  }
  // In a list of one line there is no room for both: the selected row's first line, its name, is what shows.
  const v = board(many, { sel: "p/3" });
  assert.match(plain(v.listLines(60, 1, SCREEN))[0], /^[ ▌]◐ #3  Working 3 /);
});

test("a list taller than its room shows fewer done rows first, down to the newest one, before it scrolls", () => {
  const list = [
    ...Array.from({ length: 3 }, (_, n) => ({ ...work, id: `p/${n + 1}`, title: `Working ${n + 1}`, msg: "Busy." })),
    ...Array.from({ length: 8 }, (_, n) => ({ ...done, id: `p/${n + 10}`, title: `Finished ${n + 1}`, at: at - n * 60000 })),
    { ...todo, id: "p/30", title: "Later" },
  ];
  const v = board(list, { sel: "p/1" });
  const look = (h) => { const lines = plain(v.listLines(60, h, SCREEN)).map((l) => l.trimEnd()); return { lines, done: lines.filter((l) => /Finished/.test(l)).length, note: lines.find((l) => /more/.test(l)) }; };
  // Room for all of it: the usual fold, the latest five. working 2+6, done 2+5+1, to do 2+1 = 19 lines.
  assert.deepEqual([look(30).done, look(30).note], [5, "   ↓ 3 more done (alt+d shows them)"]); assert.equal(look(19).done, 5);
  // Each line short takes one done row away, and the note counts it.
  assert.deepEqual([look(18).done, look(18).note], [4, "   ↓ 4 more done (alt+d shows them)"]);
  assert.deepEqual([look(16).done, look(16).note], [2, "   ↓ 6 more done (alt+d shows them)"]);
  for (const h of [18, 17, 16, 15]) { const { lines } = look(h); assert.ok(lines.some((l) => /Working 3/.test(l)) && lines.some((l) => /Later/.test(l)), `everything else is in view at ${h}`); assert.equal(v.top, 0); }
  // The newest one always stays; under that the list scrolls, as it always did.
  assert.deepEqual([look(15).done, look(15).note], [1, "   ↓ 7 more done (alt+d shows them)"]);
  assert.equal(v.rows.filter((row) => row.rec && row.rec.state === "done").length, 1); assert.equal(v.rows.find((row) => row.rec?.state === "done").rec.id, "p/10");
  look(8); assert.equal(v.rows.filter((row) => row.rec && row.rec.state === "done").length, 1);
  // More room brings them back; the selected task is never folded away; all done, or a search, folds nothing.
  assert.equal(look(30).done, 5);
  v.sel = "p/16"; v.rows = v.foldRows(); assert.ok(look(15).lines.some((l) => /Finished 7/.test(l)));
  v.sel = "p/1"; v.grouped.whole = true; v.rows = v.foldRows(); assert.equal(look(30).done, 8); assert.equal(v.rows.filter((row) => row.rec?.state === "done").length, 8);
});

// ---- what the rows of a section show when space is short (its own names: a block) ----
// What the rows of a section show when space is short: the same things on every row, given up together in one order.
{
const at = Date.now() - 2 * 3600000; // "2h": the only "…m" on a row is then its minutes left
const work = { state: "working", stage: "working", agent: "claude", at }, ready = { state: "blocked", kind: "permission", stage: "approval", agent: "claude", at };
const done = { state: "done", stage: "done", at }, todo = { state: "idle", stage: "todo", at };
const GROUPS = ["ready to approve", "working", "done", "to do"];
const group = (r) => (r.kind ? GROUPS[0] : r.state === "working" ? GROUPS[1] : r.state === "done" ? GROUPS[2] : GROUPS[3]);
const board = () => { const v = Object.create(View.prototype); return Object.assign(v, { theme, scope: "", byRepo: false, top: 0, sel: "" }); };
// The list as the board draws it, under its headings: each task's first line (its name and its columns), in the order
// given. A live task's second line, what it says, is not part of the fit: test/board-rows.test.js. The screen is a
// wide one with the list beside the task panel: on a screen under 80 columns a live row's columns are on its third line.
// `lead`: where a name starts on the lines last drawn, right of the mark and of the column of the tasks' numbers
// (`#1` … `#10`: as wide as the widest, so every name starts in the same place; gone from the narrowest lists).
let lead = 3;
const draw = (v, list, width) => {
  v.rows = GROUPS.flatMap((g) => [{ header: g }, ...list.filter((r) => group(r) === g).map((rec) => ({ rec }))]);
  const lines = v.listLines(width, 80, 200).map((l) => stripVTControlCharacters(l)), cells = v.numberCells(width);
  lead = 3 + (cells ? cells + 1 : 0);
  return list.map((r) => lines.find((l) => l.slice(lead).startsWith(r.title.slice(0, 8))));
};
// Where each column sits on a line: the bar and the PR number by their first cell, the right-aligned ones by their
// last. The review tag is one of those, with its mark: it ends where the pull request starts.
const COLS = { bar: /[█░]{8}/, percent: /\d%/, eta: /\d[mh](?= .*\dh)/, review: /(?<=(?<!P)R#\d+( [✓✗])?) (?![✓✗])/, pr: /PR#/, time: /\dh(?=( ago)? *$)/ };
const ORDER = Object.keys(COLS);
const places = (line) => Object.fromEntries(Object.entries(COLS).map(([key, re]) => [key, line.slice(lead).search(re)]).filter(([, n]) => n >= 0));
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
    if (r.msg && !["working", "blocked"].includes(r.state)) { set.says ??= says(r, lines[n]); assert.equal(says(r, lines[n]), set.says, `${g}: some rows say what they do and others do not at ${width}:\n${lines.join("\n")}`); }
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
  { ...todo, id: "p/10", title: "Not begun", msg: "Waits for the first-run screen." },
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
      const name = line.slice(lead).match(/^(.*?)(…| {2}|$)/)[1];
      if ("bar" in here) assert.ok(line.slice(lead).startsWith(r.title), `${r.id}: its name is cut beside a bar at ${width}`);
      if (Object.keys(here).length) assert.ok(name === r.title || name.length >= NAME_OWED - 1, `${r.id}: its name is cut to ${name.length} beside a column at ${width}`);
    });
    for (const g of GROUPS) {
      // A section gives its columns up from the left, the minutes left with their percent: what it shows is the right end.
      const set = sets[g], kept = ORDER.filter((key) => set[key]), could = ORDER.filter((key) => key in set);
      assert.deepEqual(kept, could.slice(could.length - kept.length), `${g} shows the right end of its columns at ${width}`);
      if ("eta" in set) assert.equal(set.percent, set.eta, `${g}: percent and minutes go together at ${width}`);
      if ("review" in set && "pr" in set) assert.equal(set.review, set.pr, `${g}: review tag and pull request go together at ${width}`);
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
  assert.deepEqual(shown(MIX, draw(v, MIX, 200), 200).working, { bar: true, percent: true, eta: true, time: true, review: true, pr: true });
  assert.deepEqual(shown(MIX, draw(v, MIX, 200), 200)["to do"], { time: true, says: true });
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
  let lines = draw(v, five, 90); // (the minutes left say "left": five cells more than the bare number had)
  assert.ok(lines.every((l) => !/[█░]/.test(l)), lines.join("\n")); // no bar on any row, the short names too
  assert.ok(lines.every((l, n) => l.slice(lead).startsWith(five[n].title) && /\d%/.test(l) && /\dm left /.test(l))); // and nothing else went
  lines = draw(v, five, 98);
  assert.ok(lines.every((l) => /[█░]{8}/.test(l)), lines.join("\n")); // room for the longest name's bar: every row has its bar
  // The scope is the section: a long name under another heading leaves the bars of `working` alone.
  const two = [five[2], five[4], { ...ready, id: "p/8", title: "Rewrite the whole of the first-run screen and what it asks", progress: 100, pr: 7 }, { ...ready, id: "p/9", title: "Add an undo", progress: 100, pr: 12 }];
  lines = draw(v, two, 99);
  assert.match(lines[0], /^[ ▌]◐ #\d+ Coordinator as a tab in the home space +█{6}░░ {2}72% {2}3m left {13}2h {4}$/); assert.match(lines[1], /[█░]{8}/);
  assert.match(lines[2], /^[ ▌]◆ #\d+ Rewrite the whole of the first-run screen and what it asks +100% +PR#7 +2h ago$/); assert.match(lines[3], /^[ ▌]◆ #\d+ Add an undo +100% +PR#12 +2h ago$/); // its bar went with its neighbour's
  // One column down the whole list, whatever each section shows of it.
  assert.equal(lines[1].indexOf("PR#61"), lines[2].indexOf("PR#7")); assert.equal(lines[2].indexOf("PR#7"), lines[3].indexOf("PR#12")); assert.equal(lines[0].indexOf("72%") + 3, lines[3].indexOf("100%") + 4);
});

test("a long name is cut a little before its section loses a column, never for a bar, and never under its first cells", () => {
  const v = board();
  const long = { ...work, id: "p/1", title: "Rewrite the whole of the first-run screen and what it asks", progress: 40, eta: 12, pr: 7 }; // 58 cells
  const list = [long, { ...work, id: "p/2", title: "Fix login", progress: 55, eta: 3, pr: 35 }];
  const columns = 2 + 4 + 1 + 9 + 2 + 5 + 1 + 3, room = (width) => width - 6 - columns; // 6: the mark, and the task's number (`#1`) with the cell after it; gap, percent, minutes (at their widest), the gap between the groups, PR#35, time
  assert.equal(long.title.length, 58);
  let lines = draw(v, list, 6 + 58 + columns); // the whole name beside every column but the bar
  assert.match(lines[0], /^[ ▌]◐ #\d+ Rewrite the whole of the first-run screen and what it asks +40% 12m left {2}PR#7 +2h$/); assert.match(lines[1], /^[ ▌]◐ #\d+ Fix login +55% {2}3m left {2}PR#35 +2h$/);
  lines = draw(v, list, 6 + 58 + columns + 8); // not yet room for a bar: the name is not cut for one
  assert.ok(lines.every((l) => !/[█░]/.test(l)) && lines[0].includes(long.title));
  assert.ok(draw(v, list, 6 + 58 + columns + 9).every((l) => /[█░]{8}/.test(l)));
  for (const width of [6 + 56 + columns, 73, 6 + NAME_OWED + columns]) { // narrower: the long name is cut, and both rows keep every column
    lines = draw(v, list, width);
    assert.match(lines[0], /^[ ▌]◐ #\d+ Rewrite the whole of the first-run scre[^…]*… +40% 12m left {2}PR#7 +2h$/, `cut at ${width}`); assert.match(lines[1], /^[ ▌]◐ #\d+ Fix login +55% {2}3m left {2}PR#35 +2h$/);
    assert.ok(lines[0].slice(lead).indexOf("…") + 1 >= Math.min(NAME_OWED, room(width)), `the name keeps its first ${NAME_OWED} cells at ${width}`);
  }
  lines = draw(v, list, 6 + NAME_OWED + columns - 1); // under that the name wins: the percent and the minutes go, on both rows
  assert.match(lines[0], /^[ ▌]◐ #\d+ Rewrite the whole of the first-run screen [^…]*… +PR#7 +2h$/); assert.match(lines[1], /^[ ▌]◐ #\d+ Fix login +PR#35 +2h$/);
  // A short name is never cut for a column: it is whole wherever one shows.
  for (const width of WIDTHS) { const line = draw(v, list, width)[1]; if (Object.keys(places(line)).length) assert.ok(line.slice(lead).startsWith("Fix login ")); }
});

test("what a one-line row says shows on every row of its section that says something, or on none", () => {
  const v = board();
  // Only a row of one line says anything beside its name: a task that is to do, with a note. (A live task says it
  // on its second line.)
  const list = [
    { ...todo, id: "p/1", title: "Fix login", msg: "Tracing why the login form rejects valid passwords.", pr: 3 },
    { ...todo, id: "p/2", title: "Fix layout for task names in narrow terminal board", msg: "Writing the tests for every width." },
    { ...todo, id: "p/3", title: "Quiet" },
  ];
  let lines = draw(v, list, 99);
  assert.match(lines[0], /^[ ▌]○ #\d+ Fix login {2}Tracing why the login form rejects valid passwords\. +PR#3/); assert.match(lines[1], /board {2}Writing the tests for every w[^…]*… +2h ago$/); // each cut to its own room
  lines = draw(v, list, 85); // the long name leaves too little to say anything worth reading: the short one says nothing either
  assert.match(lines[0], /^[ ▌]○ #\d+ Fix login +PR#3 +2h ago$/); assert.match(lines[1], /board +2h ago$/); assert.match(lines[2], /^[ ▌]○ #\d+ Quiet +2h ago$/);
  for (const width of WIDTHS) shown(list, draw(v, list, width), width);
  // A row with nothing to say does not count: beside it the others still say what they do.
  assert.match(draw(v, [list[0], list[2]], 85)[0], /^[ ▌]○ #\d+ Fix login {2}Tracing why the login form rejects valid pa/);
  // A live task never says anything beside its name, whatever the room.
  assert.match(draw(v, [{ ...work, id: "p/4", title: "Fix login", msg: "Tracing why.", progress: 55 }], 200)[0], /^[ ▌]◐ #\d+ Fix login {3,}█/);
});

test("what is shown does not change as percents, minutes left and times tick", () => {
  const v = board();
  const ticks = [[0, 1, at], [9, 9, at], [10, 10, at - 3600000], [55, 99, at - 9 * 3600000], [100, 100, at - 20 * 3600000], [99, 240, at], [50, 999, at], [50, 1000, at], [5, 1007, at], [5, 99999, at], [3, 7, at]];
  for (const width of WIDTHS.concat([95, 94, 93, 92, 91, 89, 88, 87, 86, 85, 75, 74, 73, 71])) {
    // What a row shows is what the layout decided for it (where its section's columns start, whether it says anything,
    // its room, the word "ago"): that is compared at every tick, and the drawn lines at the first and the last.
    const sets = ticks.map(([progress, eta, since], n) => {
      const list = MIX.map((r) => ({ ...r, at: since, ...(r.progress !== undefined ? { progress } : {}), ...(r.eta !== undefined ? { eta } : {}) }));
      const sections = GROUPS.map((g) => list.filter((r) => group(r) === g)), layout = v.rowLayout(sections.flat(), width, sections, 200);
      const drawn = n === 0 || n === ticks.length - 1 ? shown(list, draw(v, list, width), width) : null;
      return [JSON.stringify([layout.ago, layout.cols.map(([key]) => key), sections.map((recs) => recs.map((r) => layout.show.get(r)))]), JSON.stringify(drawn)];
    });
    assert.deepEqual([...new Set(sets.map(([decided]) => decided))], [sets[0][0]], `the things shown change with the numbers at ${width}`);
    assert.equal(sets.at(-1)[1], sets[0][1], `the lines drawn change with the numbers at ${width}`);
  }
});

test("minutes left are never wider than nine cells (999m left), and a machine's name beside a task's takes no row's words", () => {
  const v = board();
  // The reviewer's case: 999m turning 1000m at a fixed width. From a thousand on they read as hours.
  const pair = (eta) => [{ ...work, id: "p/1", title: "A title that is forty cells long, exactly", progress: 5, eta }, { ...work, id: "p/2", title: "Fix login", progress: 5, eta }];
  assert.equal(pair(1)[0].title.length, 41);
  for (const width of [67, 66, 58, 57, 50]) {
    const sets = [999, 1000, 1007, 999].map((eta) => { const list = pair(eta); return JSON.stringify(shown(list, draw(v, list, width), width)); });
    assert.deepEqual([...new Set(sets)], [sets[0]], `999m to 1000m changes what shows at ${width}`);
  }
  assert.match(draw(v, pair(999), 80)[1], /% 999m left +2h$/); assert.match(draw(v, pair(1000), 80)[1], /% 17h left +2h$/); assert.match(draw(v, pair(1e7), 80)[1], /% 999h left +2h$/);
  // All machines: a machine's name sits in the room the fit counted, never in room the row's words were promised.
  v.scope = "*";
  const far = [{ ...todo, id: "p/1", title: "A title that is forty cells long, exactly", host: "long-machine-name", msg: "X", progress: 50, eta: 1 }, { ...todo, id: "p/2", title: "Fix login", msg: "X", progress: 50, eta: 1 }];
  for (let width = 30; width <= 120; width++) {
    draw(v, far, width); // with a machine's name before it a line does not start with its task's name: found by it anywhere
    const all = v.listLines(width, 20, 200).map((l) => stripVTControlCharacters(l)), lines = far.map((r) => all.find((l) => l.includes(r.title.slice(0, 6)))), said = lines.map((l) => / {2}X( |$)/.test(l));
    assert.equal(said[0], said[1], `only one row says X at ${width}:\n${lines.join("\n")}`);
    assert.ok(lines.every((l) => l.length <= width));
  }
});
}

// ---- a live task's row on a narrow screen: its third line (its own names: a block) ----
// A live task's row on a narrow screen: its third line (the bar, the percent, the minutes left, the review tag, the
// pull request, the time), the width where it switches, the highlight, scrolling, and the to-dos giving way after the
// done rows in a list taller than its room.
{
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
const fresh = { ...work, id: "p/4", title: "Brand new", msg: "Just started" };
const LIVE = [agent, review, waits, fresh];

test("narrow screen: a live row's third line has the bar, the percent, the minutes left, the review tag, the pull request and the time, and fills the width", () => {
  const v = board(LIVE);
  for (const width of [40, 44, 48, 50, 55, 79]) {
    const layout = v.rowLayout(LIVE, width), rows = LIVE.map((r) => plain(v.rowLines(r, width, layout)));
    const note = `at ${width}:\n${rows.flat().join("\n")}`;
    // A name longer than its line wraps onto a second one (the wrap tests, below): that row is one line taller.
    const long = width < 6 + review.title.length ? 1 : 0; // 6: the mark, and the task's number with the cell after it
    // A row with nothing for a third line but its time (the one that has just started) has the time at the end of
    // what it says, and no line for it alone.
    rows.forEach((lines, n) => { assert.equal(lines.length, n === 1 ? 3 + long : n === 3 ? 2 : 3, note); assert.ok(lines.every((l) => l.length <= width), note); assert.equal(lines.at(-1).length, width, note); });
    // Line 1 is the mark, the task's number and the name with the whole width: nothing beside it.
    assert.equal(rows[0][0].trimEnd(), " ◐ #1 Agent at work"); assert.equal(rows[2][0].trimEnd(), " ◆ #3 Good work"); assert.equal(rows[3][0].trimEnd(), " ◐ #4 Brand new");
    assert.equal(rows[1].slice(0, 1 + long).map((l) => l.trim().replace(/^◑ #2 /, "")).join(" "), review.title, note);
    // Then what the task says, as on a wide screen.
    assert.deepEqual(rows.slice(0, 3).map((lines) => lines.at(-2).trimEnd()), ["      Reading the panel and its tests.", "      Running the tests", "      Pass · 1 minor"]);
    assert.match(rows[3].at(-1), /^ {6}Just started +2h$/, note);
    for (const lines of rows) lines[2] = lines.at(-1);
    // Line 3, in order. The bar takes the room the others leave, so it is as long on every row.
    // (It starts where the title starts, right of the mark and of the numbers: one left edge for a row's lines.)
    const bar = /[█░]+/.exec(rows[0][2])[0].length; assert.ok(bar >= 4, note);
    assert.match(rows[0][2], new RegExp(`^ {6}█+░+ 40% 12m left +2h$`), note); assert.match(rows[1][2], new RegExp(`^ {6}█+░+ 70% {2}3m left {2}R#1 PR#17 +2h$`), note);
    for (const n of [0, 1]) assert.equal(/[█░]+/.exec(rows[n][2])[0].length, bar, note);
    assert.equal(/█+/.exec(rows[0][2])[0].length, Math.round(0.4 * bar), note);
    assert.match(rows[2][2], /^ +R#1 PR#18 +2h( ago)?$/, note); // no progress: the bar's room is empty
    assert.equal(rows[1][2].indexOf("R#1"), rows[2][2].indexOf("R#1"), note); // the tags start under each other
  }
  if (!process.env.NO_COLOR) { // their usual colours: the agent's amber, the reviewer's blue, a passed review's green, the time greyed
    const ink = (c) => theme.fg(c, "\0").split("\0")[0], layout = v.rowLayout(LIVE, 48), third = (r) => v.rowLines(r, 48, layout).at(-1);
    assert.ok(third(agent).includes(`${ink("yellow")}█`) && third(agent).includes(`${ink("yellow")}40%`) && third(agent).includes(`${ink("yellow")}12m`));
    assert.ok(third(review).includes(`${ink("review")}█`) && third(review).includes(`${ink("review")}R#1`));
    assert.ok(third(waits).includes(`${ink("green")}R#1`)); assert.ok(stripVTControlCharacters(third(fresh)).endsWith("2h"));
  }
});

test("the third line is there under 80 columns of screen and gone from 80 on, for every live row at once; done and to-do rows stay one line", () => {
  const quiet = [{ ...todo, id: "p/8", title: "Not begun" }, { ...done, id: "p/9", title: "Finished", pr: 3, reviewRound: 1, review: pass }];
  const v = board([...LIVE, ...quiet]);
  assert.equal(TALL_BELOW, 80);
  const heights = (width, screen) => { const layout = v.rowLayout([...LIVE, ...quiet], width, undefined, screen); return [...LIVE, ...quiet].map((r) => v.rowLines(r, width, layout).length); };
  // (The fourth has only a time for its third line: it goes on the second, and the row is two lines.)
  for (const width of [60, 79]) assert.deepEqual(heights(width), [3, 3, 3, 2, 1, 1], `at ${width}`);
  // Narrower, the names and words that do not fit their line wrap (the wrap tests, below): no live row with columns is under three.
  for (const width of [30, 40, 55]) { const tall = heights(width); assert.ok(tall.slice(0, 3).every((n) => n >= 3) && tall[3] >= 2, `at ${width}`); assert.deepEqual(tall.slice(4), [1, 1], `at ${width}`); }
  for (const width of [80, 81, 120, 200]) assert.deepEqual(heights(width), [2, 2, 2, 2, 1, 1], `at ${width}`);
  // It is the screen that counts: a list made narrow by the task panel beside it, on a wide screen, is as it was.
  assert.deepEqual(heights(60, 120), [2, 2, 2, 2, 1, 1]);
  // The list: headings and one-line rows as ever, a one-line row's tags still beside its name. Its time is not: on
  // a narrow screen its name has that room.
  const narrow = plain(v.listLines(60, 40)), wide = plain(v.listLines(80, 40));
  assert.equal(narrow.filter((l) => l.trim()).length - wide.filter((l) => l.trim()).length, 3, "one more line for each live row that has columns for it: three of the four");
  assert.match(narrow.find((l) => /Finished/.test(l)), /^[ ▌]✓ #\d+ Finished +R#1 PR#3$/); assert.match(narrow.find((l) => /Not begun/.test(l)), /^[ ▌]○ #\d+ Not begun *$/);
  assert.match(wide.find((l) => /Finished/.test(l)), /^[ ▌]✓ #\d+ Finished +R#1 PR#3 +2h$/); assert.match(wide.find((l) => /Not begun/.test(l)), /^[ ▌]○ #\d+ Not begun +2h$/);
  // At 80 the columns sit beside a name of 40 cells: the widest of each kind, bar and all (the percent is counted at
  // the four cells of "100%", so a cell is left over). The task's number is not counted in the 80: with it (`#1` and
  // the cell after it) that is 83, and at 80 the bar is what gives way.
  const full = [{ ...agent, title: "A".repeat(40), eta: 120, reviewRound: 12, stage: "reviewing", pr: 123 }];
  assert.match(plain(v.rowLines(full[0], 88, v.rowLayout(full, 88)))[0], /^[ ▌]◑ #1 A{40} {3}[█░]{8} 40% 120m left {2}R#12 PR#123 {2}2h$/); // (88: the minutes left say "left")
  assert.match(plain(v.rowLines(full[0], 80, v.rowLayout(full, 80)))[0], /^[ ▌]◑ #1 A{40} +40% 120m left {2}R#12 PR#123 {2}2h$/);
});

test("in a width too small for all of the third line the time stays and nothing runs off the edge", () => {
  const v = board(LIVE);
  for (const width of [14, 20, 24, 30, 36]) {
    const layout = v.rowLayout(LIVE, width);
    for (const r of LIVE) { const lines = plain(v.rowLines(r, width, layout)); assert.ok(lines.every((l) => l.length <= width), `at ${width}`); assert.match(lines.at(-1), / 2h( ago)?$/, `at ${width}: ${lines.at(-1)}`); }
  }
  const third = (width) => plain(v.rowLines(review, width, v.rowLayout(LIVE, width))).at(-1);
  assert.match(third(40), /^ {6}[█░]+ 70% {2}3m left {2}R#1 PR#17 {2}2h$/); // the word "ago" goes for a bar that can be read
  assert.match(third(33), /^ {6}[█░]+ 70% {2}3m left {3}2h$/); // then the tags
  assert.match(third(26), /^ +70% {2}3m left {3}2h$/); // then the bar, where it would be too short to read
  assert.match(third(20), /^ {3}[█░]+ {3}2h$/); // then the percent and the minutes: the bar alone says the progress, in the room the numbers left
  assert.match(third(14), /^ {3}[█░]+ {3}2h$/);
});

test("all machines, narrow screen: a machine's name, however long, takes nothing from the third line", () => {
  const v = board([], { scope: "*" });
  const far = { ...work, id: "p/1", title: "Fix login", stage: "reviewing", msg: "Running the tests", progress: 50, eta: 12, reviewRound: 12, pr: 123, host: "very-long-machine-name-on-the-tailnet" };
  const near = { ...far, id: "p/2", host: "" }, short = { ...far, id: "p/3", host: "box" };
  for (const width of [46, 48, 50, 55, 79]) {
    const list = [far, near, short], layout = v.rowLayout(list, width), rows = list.map((r) => plain(v.rowLines(r, width, layout)));
    const note = `at ${width}:\n${rows.flat().join("\n")}`;
    for (const lines of rows) { assert.equal(lines.length, 3, note); assert.ok(lines.every((l) => l.length <= width), note); }
    // Every field is there, the same line on each row whatever its machine: the bar as long, the time at the edge.
    assert.match(rows[0][2], /^ +█+░+ 50% 12m left {2}R#12 PR#123 {2}2h$/, note); assert.equal(rows[0][2].length, width, note);
    assert.equal(rows[1][2], rows[0][2], note); assert.equal(rows[2][2], rows[0][2], note);
    assert.match(rows[0][0], /Fix login/, note); // the name wins over the machine's on line 1
  }
});

test("narrow screen: the highlight covers all three lines of the selected row, and the arrow keys go task by task", () => {
  const v = board([agent, fresh, { ...done, id: "p/9", title: "Finished" }], { sel: "p/1" });
  const mark = theme.selected("\0").split("\0")[0], lit = () => v.listLines(50, 20).filter((l) => l.startsWith(mark)).map((l) => stripVTControlCharacters(l));
  if (!process.env.NO_COLOR) {
    assert.deepEqual(lit().map((l) => l.trimEnd().replace(/ {2,}/g, "  ").replace(/[█░]+/, "bar")), ["▌◐ #1 Agent at work", "▌  Reading the panel and its tests.", "▌  bar 40% 12m left  2h"]); // the bar in the gutter on each of its lines
    assert.ok(lit().every((l) => l.length === 50)); // each to the screen's edge
  }
  v.move(1); assert.equal(v.sel, "p/4"); // one press, one task: never onto a row's second or third line
  if (!process.env.NO_COLOR) assert.deepEqual(lit().map((l) => l.trim().replace(/ {2,}/g, "  ")), ["▌◐ #4 Brand new", "▌  Just started  2h"]); // only a time for a third line: it stands on the second
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
      const kind = (l) => { const m = /^[ ▌]◐ #\d+ +Working (\d) /.exec(l) || /^[ ▌] {6}Says (\d)/.exec(l) || /^[ ▌] +[█░]+ +(\d)0% /.exec(l); return m ? [[/^[ ▌]◐/, /^[ ▌] {6}S/, /^[ ▌] +[█░]/].findIndex((re) => re.test(l)), m[1]] : null; };
      lines.forEach((l, n) => {
        const k = kind(l); if (!k) return;
        const [part, row] = k;
        for (let p = 0; p < 3; p++) assert.deepEqual(kind(lines[n - part + p] ?? ""), [p, row], `line ${p + 1} of Working ${row} is missing: ${note}`);
      });
      const n = v.sel.split("/")[1];
      assert.ok(lines.some((l) => new RegExp(n < 20 ? `^[ ▌]◐ #${n}  Working ${n} ` : `^[ ▌]○ #${n} Later ${n - 19} `).test(l)), `the selected task is in view: ${note}`);
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
  // Room for all of it: working 2+4 (two lines a row: only a time for a third), to do 2+6, done 2+5+1 = 22 lines.
  assert.deepEqual([look(22).done, look(22).later.length, look(22).note], [5, 6, undefined]);
  // Short of room, the done rows go first, down to the newest; no to-do goes while a done row can.
  assert.deepEqual([look(19).done, look(19).later.length], [2, 6]); assert.deepEqual([look(18).done, look(18).later.length, look(18).note], [1, 6, undefined]);
  // Then the to-dos, from the last one up, with a line that counts them.
  assert.deepEqual([look(16).done, look(16).later, look(16).note], [1, [1, 2, 3], "   ↓ 3 more to do"]);
  assert.deepEqual([look(15).later, look(15).note], [[1, 2], "   ↓ 4 more to do"]);
  for (const h of [24, 21, 20, 18, 17, 16]) liveInView(h);
  // Down to the first one; under that the list scrolls.
  assert.deepEqual([look(14).later, look(14).note], [[1], "   ↓ 5 more to do"]); assert.deepEqual(look(10).later.length <= 1, true);
  assert.equal(v.rows.filter((row) => row.rec && groupOf(row.rec) === "to do").length, 1);
  // The arrow keys still go through every to-do: the one they land on shows, with the ones before it.
  look(16);
  const walk = [];
  for (let n = 0; n < 9; n++) { v.move(1); const seen = look(16); walk.push(v.sel); if (groupOf(list.find((r) => r.id === v.sel)) === "to do") { assert.ok(seen.later.includes(+v.sel.split("/")[1] - 9), `${v.sel} shows`); assert.equal(seen.later.length, 3); liveInView(18); } }
  assert.deepEqual(walk, ["p/2", "p/10", "p/11", "p/12", "p/13", "p/14", "p/15", "p/20", "p/20"]);
  v.sel = "p/14"; assert.deepEqual([look(16).later, look(16).note], [[3, 4, 5], "   ↓ 3 more to do"]);
  v.move(-1); v.move(-1); v.move(-1); assert.deepEqual(look(16).later, [1, 2, 3]);
  // More room brings them back; all done, or a search, folds nothing.
  v.sel = "p/1"; assert.equal(look(22).later.length, 6);
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
}

// ---- rows on a narrow screen wrap instead of being cut (its own names: a block) ----
// Rows on a narrow screen wrap instead of being cut: a live task's name and what it says take up to two lines each,
// the selected task's name as many as it needs, one-line rows go without their time, and the highlight, the scroll and
// the fold work with rows of different heights. A wider screen is as it was.
{
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
  assert.deepEqual(rows(busy, 52).slice(0, 4), [
    " ◐ #1 Research capy.ai and other coding agents for",
    "      ideas we could use",
    "      Researching coding agents and harnesses for",
    "      ideas, reading what each one says about itself",
  ]);
  assert.match(rows(busy, 52)[4], /^ {6}[█░]+ +3% +5h$/); assert.equal(rows(busy, 52).length, 5); // the progress line stays under them
  // Longer than two lines: the second one is cut with "…", never a third.
  const wordy = { ...busy, title: words(30), msg: words(30, "say") }, lines = rows(wordy, 43);
  assert.equal(lines.length, 5); assert.ok(lines.every((l) => l.length <= 43));
  assert.match(lines[0], /^[ ▌]◐ #1 word1 word2 .*\d$/); assert.match(lines[1], /^[ ▌] {5}word\d+ .*…$/); assert.match(lines[2], /^[ ▌] {5}say1 say2 .*\d$/); assert.match(lines[3], /^[ ▌] {5}say\d+ .*…$/);
  // What fits one line takes one line: a short row is the three lines it was.
  assert.deepEqual(rows({ ...busy, title: "Short", msg: "Busy." }, 52).slice(0, 2), [" ◐ #1 Short", "      Busy."]);
  // With nothing to say, its line is still there and says where it stands: never empty, never a bare "…".
  assert.deepEqual(rows({ ...busy, msg: "" }, 52).slice(2, 3).map((l) => l.trim()), ["Working"]); assert.equal(rows({ ...busy, msg: "" }, 52).length, rows({ ...busy, msg: "Busy." }, 52).length);
  // Every width: nothing runs off the edge, every line after the first starts under the name (right of the task's
  // number, where the list is wide enough to have it).
  for (const width of [20, 30, 38, 49, 60, 79]) for (const l of rows(wordy, width)) { assert.ok(l.length <= width, `at ${width}: ${l}`); assert.match(l, /^ ◐ | {3}\S/, `at ${width}: ${l}`); }
});

test("narrow screen: the selected row shows its whole name, on as many lines as it needs, in every section", () => {
  for (const r of [busy, long, old]) {
    const title = `${words(40)} end`, rec = { ...r, title }, list = LIST.map((x) => (x === r ? rec : x));
    const v = board(list, { sel: r.id }), lines = plain(v.rowLines(rec, 52, v.rowLayout(list, 52)));
    const name = lines.slice(0, groupOf(rec) === "working" ? -3 : undefined);
    assert.ok(name.length > 4, "more than two lines"); assert.ok(name.every((l) => l.length <= 52));
    assert.equal(name.map((l) => l.slice(6)).join(" "), title, "the whole name, not cut"); assert.ok(name.slice(1).every((l) => l.startsWith("      ") && l[6] !== " ")); // under the name, right of the task's number
    // Not selected, it is cut again: two lines for a live task, one for any other.
    v.sel = ""; const back = plain(v.rowLines(rec, 52, v.rowLayout(list, 52)));
    assert.equal(back.length, groupOf(rec) === "working" ? 5 : 1); assert.match(back[groupOf(rec) === "working" ? 1 : 0], /…$/);
  }
  // In the list: the highlight covers every line of it, each to the edge, and its neighbours stay one line.
  const v = board(LIST, { sel: "p/2" }), mark = theme.selected("\0").split("\0")[0];
  const drawn = v.listLines(52, 30), lit = drawn.filter((l) => l.startsWith(mark));
  assert.deepEqual(plain(drawn).filter((l) => /Rethink|told before|Bring/.test(l)), ["▌○ #2 Rethink how the Coordinator works, restarts", "▌     and remembers what it was told before it", " ○ #3 Bring the board to herdr's web UI"]);
  if (!process.env.NO_COLOR) { assert.equal(lit.length, 3); assert.ok(lit.every((l) => stripVTControlCharacters(l).length === 52)); }
});

test("narrow screen: to-do and done rows stay one line and go without their time, so the name has that room", () => {
  const v = board(LIST), narrow = plain(v.listLines(52, 30)), wide = plain(v.listLines(140, 30));
  assert.ok(narrow.includes(" ✓ #4 Third row line on narrow screens for progress…")); assert.ok(narrow.includes(" ○ #3 Bring the board to herdr's web UI"));
  assert.ok(narrow.includes(` ○ #2 ${long.title.slice(0, 45)}…`), "a name cut at the edge, not before a time");
  assert.ok(!narrow.some((l) => /^ [○✓].* 5h/.test(l)));
  // A wider screen is as it was: the time at the right of every row, one line for a to-do or done row, two for a live one.
  assert.equal(wide.filter((l) => / 5h ago$/.test(l)).length, 3); assert.match(wide.find((l) => /Research/.test(l)), /^[ ▌]◐ #\d+ Research.* 5h {4}$|^[ ▌]◐ #\d+ Research.* 5h$/);
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
  const look = (h) => { const lines = plain(v.listLines(49, h)); return { lines, done: lines.filter((l) => /Finished/.test(l)).length, later: lines.filter((l) => /Later/.test(l)).length, more: lines.find((l) => /more to do/.test(l)), folded: lines.find((l) => /more done \(/.test(l)) }; };
  // Room for all of it: working 2+5 (two lines of name, two of words, the progress), to do 2+6, done 2+5+1 = 23.
  assert.deepEqual([look(23).done, look(23).later, look(23).more, look(23).folded], [5, 6, undefined, "   ↓ 3 more done (alt+d shows them)"]);
  // One line short, and it is the wrapped lines that are counted: a done row gives way.
  assert.deepEqual([look(22).done, look(22).later], [4, 6]);
  assert.deepEqual([look(19).done, look(19).later, look(19).folded], [1, 6, "   ↓ 7 more done (alt+d shows them)"]);
  assert.deepEqual([look(17).later, look(17).more], [3, "   ↓ 3 more to do"]);
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
  const rows = (r) => plain(v.rowLines(r, 43, v.rowLayout([far, wordy], 43)));
  // The machine stands in the task's tag (`box#1`), cut before the number is; behind a long one, what the task says
  // starts right of the mark, with the row's width.
  assert.match(rows(far)[0], /^[ ▌]◐ very-long-m…#1 Fix login *$/); assert.equal(rows(far)[1], "   Running the tests one by one"); assert.equal(rows(far).length, 3);
  assert.deepEqual(rows(wordy).slice(0, 2), [" ◐ box#1 Research capy.ai and other coding", "         agents for ideas we could use"]);
  assert.deepEqual(rows({ ...far, host: "box" }).slice(0, 2).map((l) => l.trimEnd()), [" ◐ box#1 Fix login", "         Running the tests one by one"]);
});
}
