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
    rows = draw(56); // no bars below 64 columns; "ago" stays wherever there is room for it
    assert.match(rows[0], /Remove notification pop-ups +95% +6m {4}$/);
    assert.match(rows[1], /Fix ugly blocked row on the board +55% PR#3 +6m {4}$/); // a PR row keeps its percent while it fits
    assert.match(rows[2], /Truncate long descriptions in sidebar +PR#2 +6m ago$/);
    { // narrow, a finished task still reads differently from a working one
      const pair = [{ id: "proj/5", state: "working", title: "Still going", at }, { id: "proj/6", state: "done", title: "All done", at }];
      const lay = s.v.rowLayout(pair, 50), [going, ended] = pair.map((r) => stripVTControlCharacters(s.v.row(r, 50, lay)));
      assert.match(going, /^ ◐ Still going +6m {4}$/); assert.match(ended, /^ ✓ All done +6m ago$/);
    }
    rows = draw(45); // each row gives up only what its own name needs: the percent, then the PR number
    assert.match(rows[0], /Remove notification pop-ups +95% +6m$/);
    assert.match(rows[1], /Fix ugly blocked row on the board +6m$/);
    assert.match(rows[2], /Truncate long descriptions in sidebar +6m$/);
    rows = draw(40); // last of all the time
    assert.match(rows[0], /Remove notification pop-ups +6m$/); assert.match(rows[2], /^ \S Truncate long descriptions in sidebar$/);
    rows = draw(30); // only now is a name cut
    assert.match(rows[0], /^ \S Remove notification pop-ups$/); assert.match(rows[1], /^ \S Fix ugly blocked row on th…$/);
    { // the minutes left: right of the percent, always in minutes, in a column of their own so the percents line up
      const eta = [{ ...records[0], eta: 3 }, { ...records[1], eta: 130 }, records[2], { id: "proj/4", state: "working", title: "No guess yet", progress: 0, at }];
      const lines = (width) => { const lay = s.v.rowLayout(eta, width); return eta.map((r) => stripVTControlCharacters(s.v.row(r, width, lay))); };
      for (const width of [200, 120, 90, 72, 64, 50, 40, 30, 20]) assert.ok(lines(width).every((l) => l.length <= width), `fits ${width}`);
      let e = lines(200);
      assert.match(e[0], /█+ +95% {3}3m {7}6m {4}$/); assert.match(e[1], /█+░+ +55% 130m PR#3 {2}6m {4}$/);
      assert.match(e[2], /sidebar +PR#2 {2}6m ago$/); assert.match(e[3], /No guess yet +░+ {3}0% {12}6m {4}$/); // no guess: no "m", the percent stays in line
      assert.equal(e[0].indexOf("95%"), e[1].indexOf("55%"));
      e = lines(56); // no bars: the minutes left stay beside the percent
      assert.match(e[0], /Remove notification pop-ups +95% {3}3m +6m {4}$/); assert.match(e[1], /Fix ugly blocked row on the board +55% 130m PR#3 +6m/);
      e = lines(52); // short of room, a row gives up its minutes left before its percent
      assert.match(e[1], /Fix ugly blocked row on the board +55% PR#3 +6m$/);
      if (!process.env.NO_COLOR) { // the same colour as the percent, whatever the state: the reviewer's colour under review
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
    assert.match(rows[0], /Fix login {2}Tracing why the login form[^#]*… +55% PR#3 +6m$/);
    assert.match(rows[1], /Fix layout for task names in narrow terminal board +6m$/);
    rows = draw(72);
    assert.match(rows[0], /Fix login {2}Tracing[^#]*… +█+░+ +55% PR#3 +6m$/);
    assert.match(rows[1], /Fix layout for task names in narrow terminal board +20% +6m$/); // its bar goes, its percent stays
    // All machines: the machine's name is cut before the task's, and before any column goes.
    s.v.scope = "*";
    const far = { ...records[0], host: "very-long-machine-name-on-the-tailnet" };
    const one = (width) => stripVTControlCharacters(s.v.row(far, width, s.v.rowLayout([far], width)));
    assert.match(one(120), /very-long-machine-name-on-the-tailnet Fix login {2}Tracing/);
    assert.match(one(40), /very-long-m\S*… Fix login +55% PR#3 +6m$/);
    assert.match(one(26), /^ \S ve… Fix login +PR#3 +6m$/); assert.match(one(24), /^ \S Fix login +PR#3 +6m$/); assert.match(one(18), /^ \S Fix login +6m$/);
    for (const width of [200, 60, 40, 30, 24, 16]) assert.ok(one(width).length <= width, `fits ${width}`);
  } finally { w.cleanup(); }
});

test("a row with no PR and no bar uses the empty space on its right, also with colours on and beside rows that fill every column", () => {
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
    for (const bars of [true, false]) for (const [name, cell] of Object.entries(v.rowFields(r, bars, now)))
      if (typeof cell === "string" && stripVTControlCharacters(cell) === "") assert.equal(cell, "", `${r.id} ${name}: an empty cell carries no colour codes`);
});
