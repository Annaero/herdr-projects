// One row of the list: its name, what it says, its columns. And a live task's row of two lines: which rows are, what
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

test("a tight row keeps the task's name, then the columns on the right; what a live task says is on a line of its own", async () => {
  const w = await world({ settings: { helper: "off" } });
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
      assert.equal(under(200), "   Removing pop-up calls from plugin, fixing tests, writing closing note."); assert.equal(under(80), under(200));
      assert.match(under(50), /^ {3}Removing pop-up calls from plugin, fixing[^…]*…$/); assert.equal(under(50).length, 50);
      assert.equal(s.v.rowLines(records[2], 200).length, 1); // a finished task has nothing to say: one line
    }
    assert.match(rows[2], /Truncate long descriptions in sidebar +PR#2 {2}6m ago$/); // "ago" on what has ended, a bare time on what still runs
    assert.equal(rows[1].indexOf("PR#3"), rows[2].indexOf("PR#2")); // the PR numbers sit in one column, next to the time
    rows = draw(72); // the name and the columns are whole
    assert.match(rows[0], /Remove notification pop-ups +\S.* 95% +6m {4}$/); assert.doesNotMatch(rows[0], /Remov[^ ]* {2}Re/);
    assert.match(rows[1], /Fix ugly blocked row on the board +█+░+ +55% {2}PR#3 {2}6m {4}$/);
    rows = draw(56); // a name needs its bar's room, so no row has a bar; "ago" stays wherever there is room for it
    assert.match(rows[0], /Remove notification pop-ups +95% +6m {4}$/);
    assert.match(rows[1], /Fix ugly blocked row on the board +55% {2}PR#3 +6m {4}$/); // a PR row keeps its percent while it fits
    assert.match(rows[2], /Truncate long descriptions in sidebar +PR#2 +6m ago$/);
    { // narrow, a finished task still reads differently from a working one
      const pair = [{ id: "proj/5", state: "working", title: "Still going", at }, { id: "proj/6", state: "done", title: "All done", at }];
      const lay = s.v.rowLayout(pair, 50, undefined, 200), [going, ended] = pair.map((r) => stripVTControlCharacters(s.v.row(r, 50, lay)));
      assert.match(going, /^ ◐ Still going +6m {4}$/); assert.match(ended, /^ ✓ All done +6m ago$/);
    }
    rows = draw(45); // the rows give up together what one name needs, from the left: the percent, then the PR number
    assert.match(rows[0], /Remove notification pop-ups +6m$/); assert.doesNotMatch(rows[0], /%/);
    assert.match(rows[1], /Fix ugly blocked row on the board +6m$/);
    assert.match(rows[2], /Truncate long descriptions in sidebar +6m$/);
    rows = draw(40); // last of all the time
    assert.match(rows[0], /^ \S Remove notification pop-ups *$/); assert.match(rows[1], /^ \S Fix ugly blocked row on the board *$/); assert.match(rows[2], /^ \S Truncate long descriptions in sidebar$/);
    rows = draw(30); // only now is a name cut
    assert.match(rows[0], /^ \S Remove notification pop-ups$/); assert.match(rows[1], /^ \S Fix ugly blocked row on th…$/);
    { // the minutes left: right of the percent, always in minutes, in a column of their own so the percents line up
      const eta = [{ ...records[0], eta: 3 }, { ...records[1], eta: 130 }, records[2], { id: "proj/4", state: "working", title: "No guess yet", progress: 0, at }];
      const lines = (width) => { const lay = s.v.rowLayout(eta, width, undefined, 200); return eta.map((r) => stripVTControlCharacters(s.v.row(r, width, lay))); };
      for (const width of [200, 120, 90, 72, 64, 50, 40, 30, 20]) assert.ok(lines(width).every((l) => l.length <= width), `fits ${width}`);
      let e = lines(200);
      assert.match(e[0], /█+ +95% {3}3m {8}6m {4}$/); assert.equal(e[0].indexOf("3m"), e[1].indexOf("130m") + 2); assert.match(e[1], /█+░+ +55% 130m {2}PR#3 {2}6m {4}$/);
      assert.match(e[2], /sidebar +PR#2 {2}6m ago$/); assert.match(e[3], /No guess yet +░+ {3}0% {13}6m {4}$/); // no guess: no "m", the percent stays in line
      assert.equal(e[0].indexOf("95%"), e[1].indexOf("55%"));
      e = lines(57); // no bars: the minutes left stay beside the percent
      assert.match(e[0], /Remove notification pop-ups +95% {3}3m +6m$/); assert.match(e[1], /Fix ugly blocked row on the board +55% 130m {2}PR#3 +6m$/);
      assert.match(e[2], /sidebar +PR#2 +6m$/); // the list gives up the word "ago" so that a row keeps its percent
      e = lines(52); // short of room, the rows give up their percent and their minutes left together: no row keeps either
      assert.match(e[1], /Fix ugly blocked row on the board +PR#3 +6m$/); assert.match(e[0], /pop-ups +6m$/); assert.match(e[3], /No guess yet +6m$/);
      assert.equal(e[1].indexOf("PR#3"), e[2].indexOf("PR#2")); assert.ok(e.every((l) => !/%|\dm .*\dm/.test(l)));
      if (!process.env.NO_COLOR) { // the same colour as the percent, whatever the state: green under review
        const paint = (r) => s.v.row(r, 120, s.v.rowLayout([r], 120)), yellow = "\x1b[38;2;249;226;175m";
        assert.ok(paint(eta[1]).includes(`${yellow} 55%\x1b[39m`) && paint(eta[1]).includes(`${yellow}130m\x1b[39m`));
        const under = paint({ ...eta[1], stage: "reviewing", agent: "claude" }), colour = (s, word) => s.slice(0, s.indexOf(word)).match(/\x1b\[38;2;[\d;]+m(?!.*\x1b\[38)/s)?.[0];
        assert.ok(colour(under, "130m") && colour(under, "130m") === colour(under, " 55%") && colour(under, "130m") !== yellow);
      }
      { // minutes left with no percent still show
        const only = { id: "proj/7", state: "working", title: "Only minutes", eta: 7, at };
        assert.match(stripVTControlCharacters(s.v.row(only, 60, s.v.rowLayout([only], 60, undefined, 200))), /^ ◐ Only minutes +7m +6m$/);
        assert.match(stripVTControlCharacters(s.v.row(only, 20, s.v.rowLayout([only], 20, undefined, 200))), /^ ◐ Only minutes +6m$/);
      }
      assert.match(osc(eta[1]), /:progress=55:eta=130:/); assert.doesNotMatch(osc(eta[3]), /eta=/);
    }
    // A long name beside a short one: the two rows show the same columns (test/board-row-fit.test.js has the rule).
    records.splice(0, 3,
      { id: "proj/8", state: "working", title: "Fix login", msg: "Tracing why the login form rejects valid passwords.", progress: 55, pr: 3, at },
      { id: "proj/9", state: "working", title: "Fix layout for task names in narrow terminal board", msg: "Working.", progress: 20, at });
    rows = draw(100);
    assert.match(rows[0], /Fix login +█+░+ +55% {2}PR#3 +6m$/); assert.match(rows[1], /board +█+░+ +20% +6m$/);
    rows = draw(72); // the long name has no room for a bar: neither row has one
    assert.match(rows[0], /Fix login +55% {2}PR#3 +6m$/); assert.match(rows[1], /Fix layout for task names in narrow terminal board +20% +6m$/);
    // All machines: the machine's name is cut before the task's, and before any column goes.
    s.v.scope = "*";
    const far = { ...records[0], host: "very-long-machine-name-on-the-tailnet" };
    const one = (width) => stripVTControlCharacters(s.v.row(far, width, s.v.rowLayout([far], width, undefined, 200)));
    assert.match(one(120), /very-long-machine-name-on-the-tailnet Fix login +█/);
    assert.match(one(50), /very-long-m\S*… Fix login +█+░+ +55% {2}PR#3 +6m$/); assert.match(one(41), /^ \S ve… Fix login +█+░+ +55% {2}PR#3 +6m$/);
    assert.match(one(26), /^ \S ve… Fix login +PR#3 +6m$/); assert.match(one(24), /^ \S Fix login +PR#3 +6m$/); assert.match(one(18), /^ \S Fix login +6m$/);
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
    assert.match(line, /^ × Choose the palette +0s ago$/, `the time at the right edge at ${width}`);
    assert.equal(line.length, width);
    assert.equal(under, "   Sand or pebbles on the beach, and which palm?", `whole sentence at ${width}`);
  }
  // Too narrow for the whole sentence: it is cut at the window's edge, not where the other rows' columns start.
  const tight = stripVTControlCharacters(v.rowLines(quiz, 40, v.rowLayout([quiz, ...full], 40, undefined, SCREEN))[1]);
  assert.match(tight, /^ {3}Sand or pebbles on the beach, and wh[^…]*…$/); assert.equal(tight.length, 40);
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
  // Indented to the name, which starts after the mark; never beside the name.
  assert.deepEqual(LIVE.map((r) => under(r)), ["   Reading the panel and its tests.", "   Running the tests", "   Running the repo's check", "   Pass · 1 minor", "   Fail · 1 critical", "   Sand or pebbles?", "   The check failed"]);
  assert.match(plain(v.rowLines(LIVE[0], 100))[0], /^ ◐ Agent at work +█+░+ +40% 12m +2h$/);
  // It has the row's whole width, and is cut at its end when it is longer still: never a third line.
  const long = { ...LIVE[0], msg: "Tracing how prefix+w got suggested, checking keys.js and the herdr defaults before changing the hint line." };
  assert.equal(under(long, 120), "   " + long.msg);
  assert.match(under(long, 60), /^ {3}Tracing how prefix\+w got suggested, checking k[^…]*…$/); assert.equal(under(long, 60).length, 60);
  assert.equal(v.rowLines(long, 20, v.rowLayout([long], 20, undefined, SCREEN)).length, 2);
  if (!process.env.NO_COLOR) { // muted, and a review's result in its own colour
    const muted = theme.muted("\0").split("\0")[0], green = theme.fg("green", "\0").split("\0")[0], red = theme.fg("red", "\0").split("\0")[0];
    assert.ok(v.rowLines(LIVE[0], 100)[1].includes(`${muted}Reading`)); assert.ok(v.rowLines(LIVE[3], 100)[1].includes(`${green}Pass`)); assert.ok(v.rowLines(LIVE[4], 100)[1].includes(`${red}Fail`));
  }
});

test("all machines: a remote task's second line starts under its task's name, right of the machine's name, at every width", () => {
  const v = board([], { scope: "*" });
  const far = { ...LIVE[0], host: "other-machine", title: "Remote task", msg: "Checking the implementation" }, near = { ...far, host: "" };
  for (const width of [200, 100, 60, 45, 38, 30, 24]) for (const list of [[far], [far, near, { ...far, host: "a-much-longer-machine-name-on-the-tailnet" }]]) for (const r of list) {
    const [first, under] = plain(v.rowLines(r, width, v.rowLayout(list, width, undefined, SCREEN)));
    assert.equal(under.search(/\S/), first.indexOf("Remote"), `${r.host || "this machine"} at ${width}:\n${first}\n${under}`); assert.ok(under.length <= width);
  }
  assert.deepEqual(plain(v.rowLines(far, 100)).map((l) => l.slice(0, 44).trimEnd()), [" ◐ other-machine Remote task", " ".repeat(17) + "Checking the implementation"]);
  v.scope = ""; // one machine's board names no machine: under the name, right of the mark
  assert.equal(plain(v.rowLines(far, 100))[1], "   Checking the implementation");
});

test("a row with nothing to say yet keeps its second line: rows do not change height when the words arrive", () => {
  const silent = { ...work, id: "p/1", title: "Just started" }, waits = { ...ready, id: "p/2", title: "Never reviewed" };
  const v = board([silent, waits, { ...done, id: "p/3", title: "Finished" }]);
  // A working task: a quiet "…" until its first words. One that waits with nothing to say: an empty line.
  assert.deepEqual(plain(v.rowLines(silent, 60, v.rowLayout([silent], 60, undefined, SCREEN))), [" ◐ Just started" + " ".repeat(43) + "2h", "   …"]);
  assert.deepEqual(plain(v.rowLines(waits, 60, v.rowLayout([waits], 60, undefined, SCREEN))).map((l) => l.trimEnd()), [" ✓ Never reviewed" + " ".repeat(37) + "2h ago", ""]);
  const before = plain(v.listLines(60, 20, SCREEN));
  silent.msg = "Reading the code."; waits.review = pass;
  const after = plain(v.listLines(60, 20, SCREEN));
  assert.equal(before.findIndex((l) => l.includes("Finished")), after.findIndex((l) => l.includes("Finished"))); // nothing below moved
  assert.deepEqual(after.filter((l) => l.startsWith("   ")).map((l) => l.trimEnd()), ["   Pass · 1 minor", "   Reading the code."]);
});

test("the highlight covers both lines of the selected row, and the arrow keys go task by task", () => {
  const v = board([...LIVE.slice(0, 2), QUIET[0]], { sel: "p/1" });
  const mark = theme.selected("\0").split("\0")[0], lit = () => v.listLines(80, 20).filter((l) => l.startsWith(mark)).map((l) => stripVTControlCharacters(l));
  if (!process.env.NO_COLOR) {
    assert.equal(lit().length, 2); assert.match(lit()[0], /^ ◐ Agent at work +█+░+ +40% 12m +2h *$/); assert.equal(lit()[1].trimEnd(), "   Reading the panel and its tests.");
    assert.ok(lit().every((l) => l.length === 80)); // each to the window's edge
  }
  v.move(1); assert.equal(v.sel, "p/2"); // one press, one task: never onto a row's second line
  if (!process.env.NO_COLOR) assert.deepEqual(lit().map((l) => l.slice(0, 20).trimEnd()), [" ◐ Under review", "   Running the tests"]);
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
        const first = /^ ◐ Working (\d+) /.exec(l), second = /^ {3}Says (\d+)/.exec(l);
        if (first) assert.equal(lines[n + 1]?.trimEnd(), `   Says ${first[1]}`, `h ${h}, at ${v.sel}: a first line with no second\n${lines.join("\n")}`);
        if (second) assert.match(lines[n - 1] ?? "", new RegExp(`^ ◐ Working ${second[1]} `), `h ${h}, at ${v.sel}: a second line with no first\n${lines.join("\n")}`);
      });
      const n = v.sel.split("/")[1];
      assert.ok(lines.some((l) => new RegExp(n < 20 ? `^ ◐ Working ${n} ` : `^ ○ Later ${n - 19} `).test(l)), `h ${h}: ${v.sel} is in view\n${lines.join("\n")}`);
    };
    look();
    for (let n = 1; n < many.length; n++) { v.move(1); look(); }
    for (let n = 1; n < many.length; n++) { v.move(-1); look(); }
  }
  // In a list of one line there is no room for both: the selected row's first line, its name, is what shows.
  const v = board(many, { sel: "p/3" });
  assert.match(plain(v.listLines(60, 1, SCREEN))[0], /^ ◐ Working 3 /);
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
  assert.deepEqual([look(30).done, look(30).note], [5, "   … 3 more (? shows all done)"]); assert.equal(look(19).done, 5);
  // Each line short takes one done row away, and the note counts it.
  assert.deepEqual([look(18).done, look(18).note], [4, "   … 4 more (? shows all done)"]);
  assert.deepEqual([look(16).done, look(16).note], [2, "   … 6 more (? shows all done)"]);
  for (const h of [18, 17, 16, 15]) { const { lines } = look(h); assert.ok(lines.some((l) => /Working 3/.test(l)) && lines.some((l) => /Later/.test(l)), `everything else is in view at ${h}`); assert.equal(v.top, 0); }
  // The newest one always stays; under that the list scrolls, as it always did.
  assert.deepEqual([look(15).done, look(15).note], [1, "   … 7 more (? shows all done)"]);
  assert.equal(v.rows.filter((row) => row.rec && row.rec.state === "done").length, 1); assert.equal(v.rows.find((row) => row.rec?.state === "done").rec.id, "p/10");
  look(8); assert.equal(v.rows.filter((row) => row.rec && row.rec.state === "done").length, 1);
  // More room brings them back; the selected task is never folded away; all done, or a search, folds nothing.
  assert.equal(look(30).done, 5);
  v.sel = "p/16"; v.rows = v.foldRows(); assert.ok(look(15).lines.some((l) => /Finished 7/.test(l)));
  v.sel = "p/1"; v.grouped.whole = true; v.rows = v.foldRows(); assert.equal(look(30).done, 8); assert.equal(v.rows.filter((row) => row.rec?.state === "done").length, 8);
});
