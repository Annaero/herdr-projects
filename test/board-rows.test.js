// One row of the list: its name, what it says, its columns.
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

test("a tight row keeps the task's name, then the columns on the right; the sentence takes what is left or goes", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const s = open(w);
    const at = Date.now() - 6 * 60000;
    const records = [
      { id: "proj/1", state: "working", title: "Remove notification pop-ups", msg: "Removing pop-up calls from plugin, fixing tests, writing closing note.", progress: 95, at },
      { id: "proj/2", state: "working", title: "Fix ugly blocked row on the board", msg: "Fixing layout so approval names keep width.", progress: 55, pr: 3, at },
      { id: "proj/3", state: "done", title: "Truncate long descriptions in sidebar", pr: 2, at },
    ];
    const draw = (width) => { const layout = s.v.rowLayout(records, width); return records.map((r) => stripVTControlCharacters(s.v.row(r, width, layout))); };
    for (const width of [200, 120, 90, 72, 64, 50, 40, 30, 20]) assert.ok(draw(width).every((l) => l.length <= width), `fits ${width}`);
    let rows = draw(200); // room for everything. The columns, in order: bar, percent, PR, time
    assert.match(rows[0], /Remove notification pop-ups {2}Removing pop-up calls from plugin, fixing tests, writing closing note\. +█+ +95% {7}6m {4}$/);
    assert.match(rows[1], /Fix ugly blocked row on the board {2}Fixing layout so approval names keep width\. +█+░+ +55% PR#3 {2}6m {4}$/);
    assert.match(rows[2], /Truncate long descriptions in sidebar +PR#2 {2}6m ago$/); // "ago" on what has ended, a bare time on what still runs
    assert.equal(rows[1].indexOf("PR#3"), rows[2].indexOf("PR#2")); // the PR numbers sit in one column, next to the time
    rows = draw(92); // the sentence is cut, the name and the columns are whole
    assert.match(rows[0], /Remove notification pop-ups {2}Removing pop-up calls[^…]*… +█+ +95% +6m {4}$/);
    assert.match(rows[1], /Fix ugly blocked row on the board {2}Fixing layout[^#]*… +█+░+ +55% PR#3 {2}6m {4}$/);
    rows = draw(72); // too little left for a sentence worth reading: none at all
    assert.match(rows[0], /Remove notification pop-ups +\S.* 95% +6m {4}$/); assert.doesNotMatch(rows[0], /Remov[^ ]* {2}Re/);
    assert.match(rows[1], /Fix ugly blocked row on the board +█+░+ +55% PR#3 {2}6m {4}$/);
    rows = draw(56); // each name needs its bar's room; "ago" stays wherever there is room for it
    assert.match(rows[0], /Remove notification pop-ups +95% +6m {4}$/);
    assert.match(rows[1], /Fix ugly blocked row on the board +55% PR#3 +6m {4}$/); // a PR row keeps its percent while it fits
    assert.match(rows[2], /Truncate long descriptions in sidebar +PR#2 +6m ago$/);
    { // narrow, a finished task still reads differently from a working one
      const pair = [{ id: "proj/5", state: "working", title: "Still going", at }, { id: "proj/6", state: "done", title: "All done", at }];
      const lay = s.v.rowLayout(pair, 50), [going, ended] = pair.map((r) => stripVTControlCharacters(s.v.row(r, 50, lay)));
      assert.match(going, /^ ◐ Still going +6m {4}$/); assert.match(ended, /^ ✓ All done +6m ago$/);
    }
    rows = draw(45); // each row gives up only what its own name needs, from the left: the percent, then the PR number
    assert.match(rows[0], /Remove notification pop-ups +95% +6m$/);
    assert.match(rows[1], /Fix ugly blocked row on the board +6m$/);
    assert.match(rows[2], /Truncate long descriptions in sidebar +6m$/);
    rows = draw(40); // last of all the time
    assert.match(rows[0], /Remove notification pop-ups +6m {4}$/); assert.match(rows[1], /^ \S Fix ugly blocked row on the board *$/); assert.match(rows[2], /^ \S Truncate long descriptions in sidebar$/);
    rows = draw(30); // only now is a name cut
    assert.match(rows[0], /^ \S Remove notification pop-ups$/); assert.match(rows[1], /^ \S Fix ugly blocked row on th…$/);
    { // the minutes left: right of the percent, always in minutes, in a column of their own so the percents line up
      const eta = [{ ...records[0], eta: 3 }, { ...records[1], eta: 130 }, records[2], { id: "proj/4", state: "working", title: "No guess yet", progress: 0, at }];
      const lines = (width) => { const lay = s.v.rowLayout(eta, width); return eta.map((r) => stripVTControlCharacters(s.v.row(r, width, lay))); };
      for (const width of [200, 120, 90, 72, 64, 50, 40, 30, 20]) assert.ok(lines(width).every((l) => l.length <= width), `fits ${width}`);
      let e = lines(200);
      assert.match(e[0], /█+ +95% {3}3m {7}6m {4}$/); assert.equal(e[0].indexOf("3m"), e[1].indexOf("130m") + 2); assert.match(e[1], /█+░+ +55% 130m PR#3 {2}6m {4}$/);
      assert.match(e[2], /sidebar +PR#2 {2}6m ago$/); assert.match(e[3], /No guess yet +░+ {3}0% {12}6m {4}$/); // no guess: no "m", the percent stays in line
      assert.equal(e[0].indexOf("95%"), e[1].indexOf("55%"));
      e = lines(56); // no bars: the minutes left stay beside the percent
      assert.match(e[0], /Remove notification pop-ups +95% {3}3m +6m$/); assert.match(e[1], /Fix ugly blocked row on the board +55% 130m PR#3 +6m$/);
      assert.match(e[2], /sidebar +PR#2 +6m$/); // the list gives up the word "ago" so that a row keeps its percent
      e = lines(52); // short of room, a row gives up its percent and its minutes left together; the other rows keep theirs, in place
      assert.match(e[1], /Fix ugly blocked row on the board +PR#3 +6m$/); assert.match(e[0], /pop-ups +95% {3}3m +6m$/);
      assert.equal(e[1].indexOf("PR#3"), e[2].indexOf("PR#2")); assert.equal(e[0].indexOf("95%"), e[3].indexOf(" 0%"));
      if (!process.env.NO_COLOR) { // the same colour as the percent, whatever the state: green under review
        const paint = (r) => s.v.row(r, 120, s.v.rowLayout([r], 120)), yellow = "\x1b[38;2;249;226;175m";
        assert.ok(paint(eta[1]).includes(`${yellow} 55%\x1b[39m`) && paint(eta[1]).includes(`${yellow}130m\x1b[39m`));
        const under = paint({ ...eta[1], stage: "reviewing", agent: "claude" }), colour = (s, word) => s.slice(0, s.indexOf(word)).match(/\x1b\[38;2;[\d;]+m(?!.*\x1b\[38)/s)?.[0];
        assert.ok(colour(under, "130m") && colour(under, "130m") === colour(under, " 55%") && colour(under, "130m") !== yellow);
      }
      { // minutes left with no percent still show
        const only = { id: "proj/7", state: "working", title: "Only minutes", eta: 7, at };
        assert.match(stripVTControlCharacters(s.v.row(only, 60, s.v.rowLayout([only], 60))), /^ ◐ Only minutes +7m +6m$/);
        assert.match(stripVTControlCharacters(s.v.row(only, 20, s.v.rowLayout([only], 20))), /^ ◐ Only minutes +6m$/);
      }
      assert.match(osc(eta[1]), /:progress=55:eta=130:/); assert.doesNotMatch(osc(eta[3]), /eta=/);
    }
    // A long name on one row costs the other rows nothing: their columns still come before their sentence.
    records.splice(0, 3,
      { id: "proj/8", state: "working", title: "Fix login", msg: "Tracing why the login form rejects valid passwords.", progress: 55, pr: 3, at },
      { id: "proj/9", state: "working", title: "Fix layout for task names in narrow terminal board", msg: "Working.", progress: 20, at });
    rows = draw(60);
    assert.match(rows[0], /Fix login {2}Tracing why the login[^#]*… +█+░+ +55% PR#3 +6m$/); // narrow, and its bar stays: only a name takes a bar away
    { // no width hides the bars by itself: at 40 a short name still has every column, a long one beside it gives up its own
      const lay = s.v.rowLayout(records, 40), [brief, wordy] = records.map((r) => stripVTControlCharacters(s.v.row(r, 40, lay)));
      assert.match(brief, /^ ◐ Fix login +█{4}░{4} {2}55% PR#3 {2}6m$/); assert.match(wordy, /^ ◐ Fix layout for task names in narrow \S*…$/);
    }
    assert.match(rows[1], /Fix layout for task names in narrow terminal board +6m$/);
    rows = draw(72);
    assert.match(rows[0], /Fix login {2}Tracing[^#]*… +█+░+ +55% PR#3 +6m$/);
    assert.match(rows[1], /Fix layout for task names in narrow terminal board +20% +6m$/); // its bar goes, its percent stays
    // All machines: the machine's name is cut before the task's, and before any column goes.
    s.v.scope = "*";
    const far = { ...records[0], host: "very-long-machine-name-on-the-tailnet" };
    const one = (width) => stripVTControlCharacters(s.v.row(far, width, s.v.rowLayout([far], width)));
    assert.match(one(120), /very-long-machine-name-on-the-tailnet Fix login {2}Tracing/);
    assert.match(one(50), /very-long-m\S*… Fix login +█+░+ +55% PR#3 +6m$/); assert.match(one(40), /^ \S ve… Fix login +█+░+ +55% PR#3 +6m$/);
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
    const raw = v.row(quiz, width, v.rowLayout([quiz, ...full], width));
    const line = stripVTControlCharacters(raw);
    assert.match(line, /^ × Choose the palette {2}Sand or pebbles on the beach, and which palm\? +0s ago$/, `whole sentence at ${width}`);
    assert.equal(line.length, width);
  }
  // Just too narrow for the whole sentence: it is cut right before the time, not where the other rows' columns start.
  const tight = stripVTControlCharacters(v.row(quiz, 70, v.rowLayout([quiz, ...full], 70)));
  assert.match(tight, /^ × Choose the palette {2}Sand or pebbles on the beach, and whi… {3}0s ago$/);
  // The cause, pinned down: a cell a row does not have is the empty string, never colour codes around nothing.
  for (const r of [quiz, ...full, { ...quiz, state: "done", stage: "done" }, { ...quiz, state: "idle", stage: "todo" }])
    for (const [name, cell] of Object.entries(v.rowFields(r, now)))
      if (typeof cell === "string" && stripVTControlCharacters(cell) === "") assert.equal(cell, "", `${r.id} ${name}: an empty cell carries no colour codes`);
});

test("the columns on the right start at the same place on every row, at every width; what a row says never moves them", () => {
  const v = Object.create(View.prototype); Object.assign(v, { theme, scope: "", byRepo: false, top: 0, sel: "" });
  const at = Date.now() - 2 * 3600000; // "2h": the only "…m" on a row is then its minutes left
  const work = { state: "working", stage: "working", agent: "claude", at }, ready = { state: "blocked", kind: "permission", stage: "approval", agent: "claude", at };
  const pass = { meets: true, gate: "major", pass: true, text: "Works.", findings: [{ id: "F1", severity: "minor", subject: "A name is unclear", where: "a.js", proof: "" }] };
  // The mix on a busy board: with and without something to say, a percent, minutes left, a pull request, a review.
  const recs = [
    { ...ready, id: "p/1", title: "Add an undo", pr: 18, prState: "passing", review: pass, reviewRound: 12 },
    { ...ready, id: "p/2", title: "Sort the done list", pr: 9, prState: "passing" },
    { ...work, id: "p/3", title: "Show the review round in the panel", progress: 4 },
    { ...work, id: "p/4", title: "Rename the keeper", msg: "Reading the keeper and its tests before changing anything in there.", progress: 0 },
    { ...work, id: "p/5", title: "Fix the fold of the done list", msg: "Writing tests.", progress: 8, eta: 3 },
    { ...work, id: "p/6", title: "Make the watcher cheaper to run every minute", msg: "Opening the pull request now.", progress: 5, eta: 14, pr: 35 },
    { ...work, id: "p/7", title: "Tidy the words", msg: "Running the tests", stage: "reviewing", reviewRound: 1, progress: 100, eta: 1, pr: 1234, prState: "failing" },
    { ...work, id: "p/8", title: "Start", msg: "Looking around." },
    { id: "p/9", state: "done", stage: "done", title: "An old thing", pr: 12, prState: "merged", at },
    { id: "p/10", state: "idle", stage: "todo", title: "Not begun", at },
  ];
  const groups = ["ready to approve", "working", "done", "to do"];
  const group = (r) => (r.kind ? groups[0] : r.state === "working" ? groups[1] : r.state === "done" ? groups[2] : groups[3]);
  // The list as the board draws it: one line for each task, by its name.
  const draw = (list, width) => {
    v.rows = groups.flatMap((g) => [{ header: g }, ...list.filter((r) => group(r) === g).map((rec) => ({ rec }))]);
    const lines = v.listLines(width, 60).map((l) => stripVTControlCharacters(l));
    return list.map((r) => lines.find((l) => l.slice(3).startsWith(r.title.slice(0, 8))));
  };
  // Where each column sits on a line: the bar and the PR number by their first cell, the right-aligned ones by their last.
  const COLS = { bar: /[█░]{8}/, percent: /\d%/, eta: /\dm(?= )/, review: /(?<!P)R#/, reviewCheck: /[✓✗](?= +PR#)/, pr: /PR#/, check: /[✓✗](?= +\d+h)/, time: /\dh(?=( ago)? *$)/ };
  const places = (line) => Object.fromEntries(Object.entries(COLS).map(([key, re]) => [key, line.slice(3).search(re)]).filter(([, n]) => n >= 0));
  const ORDER = ["bar", "percent", "eta", "review", "pr", "time"];
  const own = (r, width) => ORDER.filter((key) => ({ bar: r.progress !== undefined, percent: r.progress !== undefined, eta: r.eta !== undefined, review: !!r.reviewRound, pr: !!r.pr, time: true }[key]));
  const seen = new Set();
  for (const width of [200, 130, 104, 90, 84, 76, 70, 64, 63, 60, 56, 50, 46, 40, 34, 28]) { // 130: the board in the report; 63: just under where a fixed cutoff once hid every bar
    const lines = draw(recs, width), at = {};
    lines.forEach((line, n) => {
      const r = recs[n], here = places(line), kept = ORDER.filter((key) => key in here), has = own(r, width);
      assert.ok(line && line.length <= width, `${r.id} fits ${width}`);
      for (const [key, x] of Object.entries(here)) { at[key] ??= x; assert.equal(x, at[key], `${key} of ${r.id} is in line at ${width}:\n${lines.join("\n")}`); seen.add(key); }
      // A row gives its columns up from the left, the minutes left with their percent: what it keeps is the right end.
      assert.deepEqual(kept, has.slice(has.length - kept.length), `${r.id} keeps the right end of its columns at ${width}`);
      if (has.includes("eta")) assert.equal(kept.includes("percent"), kept.includes("eta"), `${r.id}: percent and minutes go together at ${width}`);
      // The name is the last thing cut: it is whole wherever a column shows.
      const whole = line.slice(3).startsWith(r.title);
      if (kept.length) assert.ok(whole, `${r.id}: its name is cut beside a column at ${width}`);
    });
    // What a row says goes before any column: the same list with nothing to say has every column where it was.
    v.sentence = () => ({ text: "" });
    const silent = draw(recs, width); delete v.sentence;
    silent.forEach((line, n) => assert.deepEqual(places(line), places(lines[n]), `${recs[n].id}: what it says moved a column at ${width}`));
    // A column goes only for the name: a row that lost one has no room for it beside its whole name.
    const lay = v.rowLayout(recs, width), keys = lay.cols.map(([key]) => key);
    lines.forEach((line, n) => {
      const r = recs[n], has = own(r, width), kept = ORDER.filter((key) => key in places(line)), lost = has.slice(0, has.length - kept.length);
      if (!lost.length) return;
      // From that column to the right edge, the other rows' columns between them too: a cell between each, two before them.
      const last = lost.at(-1) === "eta" && lost.includes("percent") ? "percent" : lost.at(-1); // those two go as one
      const room = lay.cols.slice(keys.indexOf(last)).reduce((sum, [key, w]) => sum + w + (key === "time" && lay.ago ? 4 : 0) + 1, 1);
      assert.ok(3 + r.title.length + room > width, `${r.id} gave up its ${last} at ${width} with room for it`);
    });
  }
  assert.deepEqual([...seen].sort(), Object.keys(COLS).sort()); // every column was looked at
  // No width hides the bars by itself: a short name beside a long one keeps its bar, down to the last cell it fits in.
  const short = { ...work, id: "p/11", title: "Fix", progress: 8, eta: 3, pr: 35 };
  const fits = 3 + short.title.length + 2 + 8 + 1 + 4 + 1 + 3 + 1 + 5 + 1 + 3; // mark, name, gap, bar, percent, minutes, PR#35, time
  for (const width of [63, 50, fits]) assert.match(draw([short, recs[5]], width)[0], /^ . Fix +█░{7} {3}8% {2}3m PR#35 +2h( {4})?$/, `the bar shows at ${width}`);
  assert.doesNotMatch(draw([short, recs[5]], fits - 1)[0], /[█░]/);
  // The report's board: a row that says something, beside rows that end ("ago") and rows that run. Its bar stays put.
  const [quiet, loud] = draw([recs[2], recs[5], recs[8]], 110);
  assert.match(quiet, /panel +░{8} {3}4% {12}2h {4}$/); assert.match(loud, /every minute {2}Opening the pull request \S*… {2}░{8} {3}5% 14m PR#35 {2}2h {4}$/);
  assert.equal(quiet.indexOf("░"), loud.indexOf("░"));
});
