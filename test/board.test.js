import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { world, settle, git } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import * as H from "../src/helpers.js";
import { View, osc } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { runJob } from "../src/jobs.js";
import { drainJobs } from "../src/runner.js";
import { remoteMain, machines, sshCommand, attachCommand } from "../src/remote.js";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY = { enter: "\r", tab: "\t", esc: "\x1b", space: " ", right: "\x1b[C", down: "\x1b[B", up: "\x1b[A", "ctrl+a": "\x01", "ctrl+e": "\x05", "ctrl+x": "\x18", "ctrl+t": "\x14", "ctrl+r": "\x12", "ctrl+y": "\x19", "ctrl+g": "\x07", "ctrl+z": "\x1a", "ctrl+b": "\x02", "ctrl+p": "\x10", "ctrl+f": "\x06", "ctrl+s": "\x13", "alt+a": "\x1ba", "alt+h": "\x1bh", "ctrl+d": "\x04", delete: "\x1b[3~" };
// The side panel is closed until you ask for it; most of these tests read it, so they start with it open.
function open(w, { rows = 34, side = true } = {}) {
  let closed;
  const tui = { terminal: { rows, columns: 120 }, requestRender() {}, stop() {}, start() {} };
  const v = new View(tui, theme, (x) => { closed = x ?? null; }, { cwd: w.root, canReload: true });
  clearInterval(v.timer);
  v.side = side;
  const screen = (width = 120) => v.render(width).map((l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, ""));
  const press = (...keys) => { for (const k of keys) v.handleInput(KEY[k] ?? k); };
  const type = (text) => { for (const ch of text) v.handleInput(ch); };
  return { v, screen, press, type, closed: () => closed, text: (width) => screen(width).join("\n") };
}

test("the task panel beside the list cuts a long description short and says where the rest is; the whole panel shows all of it", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const long = Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of a very long description.`).join("\n");
    A.add(w.root, "Short one", { description: "Brief." });
    const big = A.add(w.root, "Long one", { description: long });
    const s = open(w, { rows: 44 });
    s.v.sel = big.id; s.v.load();
    let text = s.text(120);
    assert.match(text, /│ {2}Long one/); assert.match(text, /Line 1 of a very long/);
    // Beside the list the description is short: a few lines, then where the rest is.
    assert.match(text, /Line 8 of a very long description\. … *\n/); assert.match(text, /│ {2}ctrl\+e shows the whole task/);
    assert.doesNotMatch(text, /Line 9 of/); assert.doesNotMatch(text, /Line 80 of/);
    // Status first, then the description, then the settings: each part under its own headline, an empty line between.
    assert.match(text, /│ {2}Long one *\n[^\n]*│ {2}○ to do · \ds ago · proj\/2 *\n[^\n]*│ *\n[^\n]*│ {2}Description ─+ *\n/);
    assert.match(text, /│ {2}Settings ─+ *\n[^\n]*│ {2}Project {6}\S+ *\n[^\n]*│ {2}Worktree {5}on *\n[^\n]*│ {2}Branch {7}main *\n[^\n]*│ {2}Agent /);
    // Every setting shows beside the list, also one that is only your default.
    const SETTINGS = ["Project", "Worktree", "Agent", "Reviewer", "Reviewed", "Send back", "Evidence", "Watcher", "Conflicts", "Permissions"];
    for (const fact of SETTINGS) assert.match(text, new RegExp(`│  ${fact} `), fact);
    assert.match(text, /│ {2}Reviewed {5}work in a repo *\n[^\n]*│ {2}Send back {4}major or worse · 3 rounds max *\n[^\n]*│ {2}Evidence {5}on · local links/);
    // A short window keeps every setting too: the long parts give way, never the settings.
    { const low = open(w, { rows: 24 }); low.v.sel = big.id; low.v.load(); const t24 = low.text(120);
      for (const fact of SETTINGS) assert.match(t24, new RegExp(`│  ${fact} `), `${fact} in a 24-row window`);
      assert.match(t24, /│ {2}ctrl\+e shows the whole task/); assert.doesNotMatch(t24, /Line 1 of/); }
    S.setTaskConfig(big.id, "model", "opus"); s.v.load();
    text = s.text(120);
    assert.match(text, /│ {2}Agent {8}\S+ · opus · default effort/); assert.match(text, /│ {2}Reviewer {5}codex · default model/);
    // A long text with no line breaks is cut between words after a few hundred characters.
    const prose = A.add(w.root, "Prose", { description: "word ".repeat(400).trim() });
    s.v.sel = prose.id; s.v.load();
    const shown = s.screen(160).map((l) => l.split("│")[1] || "").join(" ").match(/Description ─+\s+((?:word\s+)+)…/);
    assert.ok(shown && shown[1].replace(/\s+/g, " ").length <= 400 && shown[1].replace(/\s+/g, " ").length >= 280, "a description beside the list keeps to 280 to 400 characters");
    s.v.sel = big.id; s.v.load();
    if (!process.env.NO_COLOR) {
      // A headline is bold and a label is greyed out. A setting chosen for this task is in the text colour; one that
      // is only your default is quieter.
      const raw = s.v.render(120).join("\n"), grey = "\x1b[38;2;108;112;134m", ink = "\x1b[38;2;205;214;244m", quiet = "\x1b[38;2;166;173;200m";
      assert.ok(raw.includes("\x1b[1mDescription\x1b[22m") && raw.includes(`${grey}Agent        \x1b[39m${ink}`) && raw.includes(`${ink}  Line 1 of a very long`), "headlines are bold, labels grey, the text is neither");
      assert.ok(raw.includes(`${grey}Reviewer     \x1b[39m${ink}${quiet}codex`), "a default setting is quieter");
    }
    // The task details: the same parts full screen, scrolled, with every setting.
    s.press("ctrl+e");
    assert.equal(s.v.full, true);
    assert.match(s.text(120), /^ Task details {2}proj\/2 +lines 1–\d+ of \d+/);
    s.v.panelTop = 1e9; text = s.text(120);
    assert.match(text, /Line 80 of/);
    for (const fact of SETTINGS) assert.match(text, new RegExp(`\\n ${fact} `), fact);
    // A choice made for this task alone shows in both, and is starred on the full screen.
    for (const [k, v] of [["review", "all"], ["gate", "minor"], ["rounds", "5"], ["artifacts", "false"]]) S.setTaskConfig(big.id, k, v);
    s.v.load(); s.v.panelTop = 1e9; text = s.text(120);
    assert.match(text, /\n Reviewed {5}all work \*/); assert.match(text, /\n Send back {4}minor or worse · 5 rounds max \*/); assert.match(text, /\n Evidence {5}off \*/);
    assert.match(text, /opus · default effort \*/); assert.match(text, /\* this task's own, not your default/);
    s.press("up"); assert.ok(s.v.panelTop < s.v.panelLength); assert.equal(s.v.sel, big.id); // the arrows scroll the panel, they do not move the selection
    s.press("esc"); assert.equal(s.v.full, false);
    s.v.sel = "proj/1"; s.v.load();
    text = s.text(120);
    assert.match(text, /Brief\./);
    assert.doesNotMatch(text, /shows the whole task|…/); // a short one is left alone
    assert.doesNotMatch(text, /None\./); // and nothing is an empty box
  } finally { w.cleanup(); }
});

test("the board: one header line, the five groups, a symbol for each state, the task panel from 90 columns", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    A.add(w.root, "Write the docs", { description: "All of them." });
    const b = A.add(w.root, "My own task"); A.report(b.id, { state: "working", msg: "half way", progress: 50, eta: 12.4 });
    // A report with only one of the two keeps the other; minutes alone, on a task with no percent, are kept too.
    A.report(b.id, { state: "working", msg: "half way", eta: 12 }); assert.deepEqual(S.get(b.id).watch, { progress: 50, eta: 12 });
    A.report(b.id, { state: "working", msg: "half way", progress: 50 }); assert.deepEqual(S.get(b.id).watch, { progress: 50, eta: 12 });
    const s = open(w);
    let text = s.text(120);
    // One header line, then the list.
    assert.match(text, /^ herdr-superwork {2}proj · \S+ +│ *\n +│/); assert.doesNotMatch(text, /work board for herdr|\d (blocked|idle|working)/);
    // Every line is in herdr's text colour (Catppuccin's here), unless colours are switched off. Each task's mark is
    // a symbol of its own in its group's colour (working yellow, to do grey), and its title stays plain text.
    const raw = s.v.render(120), text0 = "\x1b[38;2;205;214;244m", yellow = "\x1b[38;2;249;226;175m", grey = "\x1b[38;2;108;112;134m";
    assert.ok(raw.every((l) => (process.env.NO_COLOR ? !l.includes("\x1b[38;2;") : l.startsWith(text0))));
    if (!process.env.NO_COLOR) {
      assert.ok(raw.some((l) => l.includes(`${yellow}◐\x1b[39m${text0} \x1b[1mMy own task\x1b[22m  `)), "a working task's mark is the working colour, its title plain text");
      assert.ok(raw.some((l) => l.includes(`${grey}○\x1b[39m${text0} Write the docs `)), "a task nobody started is grey, not green");
      assert.ok(raw.some((l) => l.includes(`${yellow}working\x1b[39m`)) && raw.some((l) => l.includes(`${grey}to do\x1b[39m`)), "the headings are in their group's colour");
      assert.ok(raw.some((l) => l.includes(`${yellow} 50%`)), "progress is in the working colour while working");
      assert.ok(raw.some((l) => l.includes(`${yellow} 50%\x1b[39m${text0} ${yellow}12m\x1b[39m`)), "the minutes left sit right of the percent, in the same colour");
    }
    // A row does not repeat its heading ("idle" under "to do"), and its time says which kind it is.
    assert.match(text, /\n working +│/); assert.match(text, /\n to do +│/);
    assert.match(text, /◐ My own task {2}half way +█+░+ +50% 12m +\ds {5}│/); assert.match(text, /│ +█+░+ 50% 12m *\n/); // on the row and in the task panel assert.match(text, /○ Write the docs {6,}\ds ago │/);
    assert.match(text, /│ {2}My own task/); assert.match(text, /◐ working · you · for \ds · proj\/2/);
    // The text box names who gets your words, and its empty line says only "what's next?".
    assert.match(text, /\n─+\n \+ New task {2}[^\n]*\n─+\n❯ what's next\? *\n/); assert.doesNotMatch(text, /Coordinator|sidebar/);
    assert.equal(s.screen(120).length, 34); assert.ok(s.screen(120).every((l) => l.length <= 120));
    assert.ok(!/│ {2}My own task/.test(s.text(80)), "no panel beside the list below 90 columns");
    // ctrl+b is herdr's own prefix key: the board has no use for it.
    s.press("ctrl+b"); assert.match(s.text(120), /│ {2}My own task/); assert.equal(s.v.value(), "");
    // ctrl+p closes the side panel and opens it again: closed, each row has the whole width for what it says.
    s.press("ctrl+p"); text = s.text(120);
    assert.equal(s.v.side, false); assert.doesNotMatch(text, /│/); assert.match(text, /◐ My own task {2}half way {60,}█/); assert.match(text, /Side panel off\. ctrl\+p shows it\./);
    assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).side, false); // your choice is remembered
    s.press("?"); assert.match(s.text(120), /show the side panel +ctrl\+p/); s.press("esc");
    // Closed, it stays closed while you talk to a task's agent: only ctrl+p opens it.
    s.press("space"); assert.equal(s.v.reply, true); assert.doesNotMatch(s.text(120), /│ {2}My own task/); assert.equal(s.v.full, false);
    s.press("space"); assert.equal(s.v.reply, false);
    s.press("ctrl+p"); assert.equal(s.v.side, true); assert.match(s.text(120), /│ {2}My own task/);
    s.screen(80); s.press("ctrl+p", "ctrl+p"); assert.match(s.text(80), /The side panel needs a wider window\. ctrl\+e shows the task full screen\./); s.screen(120);
    // A board opened for the first time has it closed.
    { const fresh = open(w, { side: false }); fs.rmSync(path.join(S.dataDir(), "view.json"), { force: true }); const first = new View(fresh.v.tui, theme, () => {}, { cwd: w.root }); clearInterval(first.timer); assert.equal(first.side, false); }
    s.press("down", "ctrl+e");
    text = s.text(80);
    assert.match(text, /^ Task details {2}proj\/1/); assert.match(text, /○ to do · \ds ago · proj\/1/); assert.match(text, /Description ─+ *\n All of them\./);
    // The whole panel never changes who you talk to: only space does. Space there talks to the task, space again goes back.
    assert.equal(s.v.reply, false); assert.match(text, /\n─+\n \+ New task {2}[^\n]*\n─+\n❯ what's next\?/);
    s.press("space"); assert.equal(s.v.reply, true); assert.equal(s.v.full, true);
    assert.match(s.text(80), /\n─+\n . Write the docs {2}[^\n]*\n(?:[^\n]*\n)*?─+\n❯ your message starts an agent on it/);
    s.press("ctrl+e"); assert.equal(s.v.full, false); assert.equal(s.v.reply, true, "folding the panel keeps who you talk to");
    s.press("ctrl+e", "space"); assert.equal(s.v.reply, false); assert.equal(s.v.full, false);
    s.press("ctrl+e"); assert.equal(s.v.full, true); assert.equal(s.v.reply, false);
    s.press("esc");
    assert.match(s.text(120), /^ herdr-superwork/); assert.equal(s.v.reply, false);
    for (const width of [24, 40, 64, 89, 90, 200]) assert.ok(s.screen(width).every((l) => l.length <= width), `fits ${width}`);
  } finally { w.cleanup(); }
});

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

test("the task panel never opens full screen by itself: something going wrong only changes the hint line", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const id = A.add(w.root, "Match the colors").id;
    S.update(id, (t) => { t.stage = "failed"; t.failure = { stage: "merge", phase: "sync", title: "Merge conflict with main", detail: "Conflicting files:\nsrc/board/view.js", agentCanFix: true, next: "Resolve the conflict." }; });
    const s = open(w);
    s.v.load();
    assert.equal(s.v.sel, id); assert.equal(s.v.full, false); assert.equal(s.v.reply, false);
    let text = s.text(80);
    assert.match(text, /\n needs you *\n ✗ Match the colors {2}Merge conflict with main/);
    assert.doesNotMatch(text, /Conflicting files/);
    // The hint line: what matters now, the main thing first, never more than four.
    assert.match(text, /\n {2}ctrl\+r send it to the agent to fix · ctrl\+a retry · space reply · \? more *$/);
    assert.match(s.text(60), /\n {2}ctrl\+r send it to the agent to fix · ctrl\+a retry · \? more *$/); assert.match(s.text(50), /\n {2}ctrl\+r send it to the agent to fix · \? more *$/); // and it never runs off a narrow screen
    // Wide, the panel beside the list already says it, in order: where it stands, then what it needs from you.
    text = s.text(120);
    assert.match(text, /│ {2}✗ needs you · \ds ago · proj\/1 *\n[^\n]*│ *\n[^\n]*│ {2}▎ Merge conflict with main/); assert.match(text, /│ {2}▎ Next step/); assert.match(text, /│ {2}▎ What went wrong *\n[^\n]*│ {2}▎ Conflicting files:/);
    // Narrow, space opens the same panel full screen, with the text box naming the task; space or esc closes it.
    s.screen(80); s.press("space"); text = s.text(80);
    assert.equal(s.v.full, true); assert.equal(s.v.reply, true);
    assert.match(text, /^ Task details {2}proj\/1/); assert.match(text, /Merge conflict with main/); assert.match(text, /▎ Conflicting files: *\n ▎ src\/board\/view\.js/);
    assert.match(text, /\n─+\n . Match the colors {2}[^\n]*\n(?:[^\n]*\n)*?─+\n❯/);
    s.press("esc");
    assert.equal(s.v.full, false); assert.doesNotMatch(s.text(80), /Conflicting files/);
    // Nor does coming back from the archive bring it up, and an open panel is not remembered when the board reopens.
    s.press("space"); assert.equal(s.v.full, true);
    s.press("esc", "alt+h"); assert.equal(s.v.archiveView, true);
    s.press("alt+h"); assert.equal(s.v.archiveView, false); assert.equal(s.v.sel, id); assert.equal(s.v.full, false);
    s.press("space"); s.v.savePrefs();
    const again = open(w);
    again.v.load();
    assert.equal(again.v.sel, id); assert.equal(again.v.full, false); assert.equal(again.v.reply, false);
    assert.doesNotMatch(again.text(80), /Conflicting files/);
  } finally { w.cleanup(); }
});

test("the board's keys: typing adds a task, tab puts an agent on it, space replies to it, enter opens the agent", async () => {
  const w = await world({ settings: { helper: "off", reviewer: "off" } });
  try {
    process.env.HERDR_ENV = "1";
    w.script({ worker: [{ status: "working", screen: "● Editing greet.sh\n  esc to interrupt\n" }] });
    const s = open(w);
    s.type("Add a greeting");
    assert.match(s.text(), /\n─+\n \+ New task {2}[^\n]*\n─+\n❯ Add a greeting/); assert.match(s.text(), /enter add a task · tab add it and start an agent · esc put away/);
    s.press("enter");
    assert.equal(S.get("proj/1").title, "Add a greeting"); assert.equal(s.v.sel, "proj/1"); assert.equal(s.v.value(), "");
    assert.match(s.text(), /\n {2}tab put an agent on it · space reply · \? more/);
    s.press("right"); assert.match(s.text(), /No agent has been on this yet/);
    s.press("tab");
    await settle("proj/1"); s.v.load();
    assert.match(s.text(), /\n working +│[^\n]*\n ◐ Add a greeting/);
    assert.match(s.text(), /│ {2}On its screen now ─+ *\n[^\n]*│ {2}● Editing greet\.sh/); // the panel shows what the agent is doing
    assert.match(s.text(), /\n {2}enter open the agent · space reply · ctrl\+x stop · \? more/);
    // space: the text box now belongs to this task's agent, and says so for as long as you type
    s.press("space");
    assert.match(s.text(), /\n─+\n . Add a greeting {2}[^\n]*\n(?:[^\n]*\n)*?─+\n❯ your reply/);
    w.script({ worker: [{ status: "working" }] });
    s.type("also say goodbye");
    assert.match(s.text(), /\n─+\n . Add a greeting {2}[^\n]*\n(?:[^\n]*\n)*?─+\n❯ also say goodbye/); assert.match(s.text(), /enter send to its agent · esc put away/);
    s.press("enter");
    assert.match(s.text(), /Sent to the agent/);
    const t = S.get("proj/1");
    assert.match(w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts.at(-1), /also say goodbye/);
    // esc, one step at a time: the agent's message in the chat is hidden first, and only the next esc leaves the reply
    assert.match(s.text(), /esc hide its message/); assert.doesNotMatch(s.text(), /esc back/);
    s.press("esc"); assert.equal(s.v.chatOpen, false); assert.equal(s.v.reply, true); assert.equal(s.v.ask, null); assert.match(s.text(), /alt\+v show its message/); assert.match(s.text(), /esc back/);
    s.press("esc"); assert.equal(s.v.reply, false); assert.match(s.text(), /\n─+\n \+ New task {2}[^\n]*\n─+\n❯/);
    s.press("\x1bv"); assert.equal(s.v.chatOpen, true);
    // enter: focus the agent's real pane by pane id and close the board; selection and filter come back on reopen
    s.press("enter");
    assert.deepEqual(s.closed(), { entered: "proj/1" });
    assert.ok(w.state().focus.includes(`agent ${t.link.pane}`));
    s.v.dispose();
    assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).sel, "proj/1");
    // ctrl+x stops the agent, and the selection stays on that row: a second tap neither stops another task nor deletes
    A.add(w.root, "Another one"); A.add(w.root, "And one more");
    const s2 = open(w);
    assert.equal(s2.v.sel, "proj/1");
    s2.press("ctrl+x");
    assert.equal(S.get("proj/1").stage, "stopped"); assert.match(s2.text(), /proj\/1: stopped\./); assert.equal(s2.v.sel, "proj/1");
    s2.press("ctrl+x");
    assert.equal(s2.v.sel, "proj/1"); assert.ok(S.get("proj/1")); assert.ok(S.get("proj/2")); assert.match(s2.text(), /No agent is working on this/);
    // the first few times, the board says how to get back before it closes for an agent
    const tui = { terminal: { rows: 34, columns: 120 }, requestRender() {}, stop() {}, start() {} };
    let closed;
    const v3 = new View(tui, theme, (x) => { closed = x; }, { cwd: w.root, leaveMs: 30, boardKey: "prefix+w" }); clearInterval(v3.timer);
    v3.sel = "proj/1"; v3.load(); v3.handleInput("\r");
    assert.equal(closed, undefined); assert.match(v3.render(120).map((l) => stripVTControlCharacters(l)).join("\n"), /Opening the agent\. prefix\+w brings the board back\./);
    v3.handleInput("\x18"); assert.equal(S.get("proj/1").stage, "stopped"); // nothing more is taken from the keyboard
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(closed, { entered: "proj/1" }); v3.dispose();
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("while the text box holds text it owns the keyboard: no shortcut fires in the middle of a draft", async () => {
  const w = await world({ settings: { helper: "off", coordinator: "off" } });
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f." }], reviewer: [{ verdict: { meets: true, text: "Good.", findings: [{ severity: "minor", subject: "f.txt has no title", where: "f.txt" }] } }] });
    const id = A.add(w.root, "Make f").id; A.add(w.root, "Other");
    A.delegate(id); await settle(id);
    const s = open(w);
    s.v.sel = id; s.v.load();
    s.type("half a thought");
    const before = JSON.stringify([S.get(id).stage, S.get(id).pinned, S.get(id).archivedAt, S.list().length]);
    for (const k of ["ctrl+a", "ctrl+e", "ctrl+y", "ctrl+r", "ctrl+g", "ctrl+t", "ctrl+d", "ctrl+x", "ctrl+x", "ctrl+b", "ctrl+f", "ctrl+s", "alt+a", "alt+h", "\x1bc", "\x1bv", "ctrl+z", "?", "space", "up", "down"]) s.press(k);
    assert.equal(JSON.stringify([S.get(id).stage, S.get(id).pinned, S.get(id).archivedAt, S.list().length]), before, "nothing happened to any task");
    assert.equal(s.v.sel, id); assert.equal(s.v.ask, null); assert.equal(s.v.menu, null); assert.equal(s.v.full, false); assert.equal(s.v.mode, "new"); assert.equal(s.v.archiveView, false); assert.equal(s.v.allDone, false); assert.equal(s.v.byRepo, false); assert.equal(s.v.chatOpen, true); assert.equal(s.v.msg, "");
    assert.equal(S.get(id).stage, "approval"); assert.equal(s.closed(), undefined);
    assert.match(s.v.value(), /half a thought/); assert.match(s.v.value(), /\?/); // "?" and space are typed, not acted on
    // esc puts the draft away, and it can be brought back; nothing is thrown away
    s.press("esc"); assert.equal(s.v.value(), ""); assert.match(s.text(), /Put away\. ctrl\+z brings it back\./);
    s.press("ctrl+z"); assert.match(s.v.value(), /half a thought/);
    s.press("esc");
    // one esc too many does not close the board: it asks, and esc again says no
    s.press("esc"); assert.equal(s.closed(), undefined); assert.match(s.text(), /\n \? Close the board\? {2}enter = yes · esc = no/);
    s.press("ctrl+a", "x", "space"); assert.ok(s.v.ask, "a question takes enter or esc, nothing else"); assert.equal(S.get(id).stage, "approval");
    s.press("esc"); assert.equal(s.v.ask, null); assert.equal(s.closed(), undefined);
    s.press("esc", "enter"); assert.equal(s.closed(), null);
  } finally { w.cleanup(); }
});

test("the board: ready to approve, the merge asks first, the ? menu acts, delete asks, messages stay", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f." }], reviewer: [{ verdict: { meets: true, text: "Good.", findings: [{ severity: "minor", subject: "f.txt has no title", where: "f.txt" }] } }] });
    const id = A.add(w.root, "Make f").id; A.add(w.root, "Other");
    A.delegate(id); await settle(id);
    const s = open(w);
    s.v.sel = id; s.v.load();
    // Finished, reviewed work is good news: its own group, the reviewer's advice in words, no "approve to merge?" on every row.
    assert.match(s.text(80), /\n ready to approve *\n ✓ Make f {2}Pass · 1 minor +\ds ago *\n/); assert.doesNotMatch(s.text(80), /blocked|approve to merge|r1/);
    let text = s.text();
    assert.match(text, /│ {2}✓ ready to approve · claude · \ds ago/);
    assert.match(text, /│ {2}Review ─+ *\n[^\n]*│ {2}╭─ Review 1 ─[^\n]*\n[^\n]*│ {2}│ Pass · 1 minor +│ *\n[^\n]*│ {2}│ Good\./); assert.match(text, /│ {2}1 file, \+1 −0/);
    assert.equal(S.get(id).reviews.length, 1); assert.deepEqual([S.get(id).reviews[0].round, S.get(id).reviews[0].pass, S.get(id).reviews[0].findings.length, S.get(id).reviews[0].text], [1, true, 1, "Good."]); // the task keeps every review it had assert.match(text, /│ {2}The agent said *\n[^\n]*│ {2}Made f\./);
    assert.match(text, /\n {2}ctrl\+a approve and merge · ctrl\+r send back · space reply · \? more/);
    // ctrl+a asks once before the merge; esc says no and nothing happened
    s.press("ctrl+a");
    assert.match(s.text(), /\n \? Merge "Make f"\? {2}enter = yes · esc = no/); assert.equal(S.get(id).stage, "approval");
    s.press("esc"); assert.equal(S.get(id).stage, "approval"); assert.equal(s.v.ask, null);
    // The question is about what it names. The task changes underneath it (a new commit was reviewed, another pull
    // request): the question goes, and enter merges nothing until you have been asked about what is there now.
    s.press("ctrl+a"); assert.ok(s.v.ask);
    const head = S.get(id).reviewedHead;
    S.update(id, (t) => { t.pr = "https://github.com/a/b/pull/19"; });
    s.v.load(); // what every beat does
    assert.equal(s.v.ask, null); assert.match(s.text(), /It changed while you were asked, so nothing was merged\./);
    s.press("enter"); assert.equal(S.get(id).stage, "approval"); assert.equal(s.closed(), undefined);
    // also when it changes between the last look and the key press
    s.press("ctrl+a"); assert.match(s.text(), /\n \? Merge PR#19\? /);
    S.update(id, (t) => { t.pr = undefined; });
    s.press("enter"); assert.equal(S.get(id).stage, "approval"); assert.equal(s.v.ask, null); assert.match(s.text(), /It changed while you were asked/);
    // and the action itself refuses a yes that was given to something else
    assert.throws(() => A.approve(id, { pr: "https://github.com/a/b/pull/18", head }), /changed while you were asked\. Nothing was merged/);
    assert.throws(() => A.approve(id, { pr: null, head: "f".repeat(40) }), /changed while you were asked\. Nothing was merged/); assert.equal(S.get(id).stage, "approval");
    s.press("ctrl+a", "enter");
    assert.equal(S.get(id).stage, "merging");
    assert.match(s.text(), /proj\/1: approved, merging/); // a result stays until the next key press, however long that takes
    s.v.beat(); s.v.beat(); assert.match(s.text(), /proj\/1: approved, merging/);
    await settle(id); s.v.load();
    assert.match(s.text(80), /\n done *\n ✓ Make f *\d/); assert.doesNotMatch(s.text(80), /unread/); // a done row says nothing more than its name and time
    // the ? menu: lines to act from, each with its old chord beside it, and the few keys worth remembering
    s.v.sel = "proj/2"; s.v.load(); s.press("?");
    text = s.text();
    assert.match(text, /^ menu {2}for "Other"/); assert.match(text, /\n ❯ show the whole task panel +ctrl\+e/);
    for (const line of [/archive +alt\+a/, /pin to the top +ctrl\+t/, /delete +delete/, /open the archive +alt\+h/, /group by repo +ctrl\+s/, /show all done +ctrl\+d/]) assert.match(text, line);
    assert.match(text, /\n {3}ctrl\+a {2}yes: approve, retry, continue/); assert.match(text, /↑↓ pick · enter do it · esc close/);
    s.press("x", "ctrl+a"); assert.ok(s.v.menu, "a stray key neither acts nor closes the menu");
    s.press("down", "enter"); assert.ok(S.get("proj/2").archivedAt); assert.equal(s.v.menu, null); assert.ok(!/Other/.test(s.screen().slice(0, 12).join("\n")));
    // the old chords still work: the archive, undo, pin
    s.press("alt+h"); assert.match(s.text(), /^ herdr-superwork {2}archive/); assert.match(s.text(), /Other \[archived\]/);
    s.press("alt+h", "ctrl+z"); assert.ok(!S.get("proj/2").archivedAt);
    s.v.sel = "proj/2"; s.v.load(); s.press("ctrl+t"); assert.equal(S.get("proj/2").pinned, true); assert.match(s.text(80), /\n pinned +\n/);
    s.press("ctrl+f"); assert.match(s.text(), /\nfind ❯ /); s.type("make"); s.press("enter");
    assert.match(s.text(), /^ herdr-superwork {2}proj · \S+ · find: make/); assert.ok(!/○ Other/.test(s.text()));
    s.press("esc"); assert.equal(s.v.filter, "");
    // ctrl+x only ever stops an agent. Deleting is a line in the menu, with a plain question of its own.
    s.v.sel = "proj/2"; s.v.load(); s.press("ctrl+x", "ctrl+x"); assert.ok(S.get("proj/2")); assert.equal(s.v.ask, null);
    s.press("delete"); assert.match(s.text(), /\n \? Delete "Other"\? Its worktree goes too\. {2}enter = yes · esc = no/);
    s.press("esc"); assert.ok(S.get("proj/2"));
    // a question too long for the window never loses its keys: it wraps, and "enter = yes · esc = no" stays whole
    A.rename("proj/2", "A task with quite a long title here"); s.v.load(); s.press("delete");
    for (const width of [80, 60, 40, 30]) {
      const lines = s.screen(width);
      assert.ok(lines.some((l) => l.includes("enter = yes · esc = no")), `the keys show at ${width}`);
      assert.match(lines.join(" ").replace(/\s+/g, " "), /\? Delete "A task with quite a long title …"\? Its worktree goes too\./, `the question shows at ${width}`);
      assert.ok(lines.every((l) => l.length <= width) && lines.length === 34);
    }
    s.press("esc"); A.rename("proj/2", "Other"); s.v.load();
    s.press("?"); const at = s.v.menuItems().findIndex((i) => i.label === "delete"); for (let i = 0; i < at; i++) s.press("down");
    s.press("enter", "enter");
    for (let i = 0; i < 100 && S.get("proj/2"); i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(S.get("proj/2"), null);
    // an error stays until esc dismisses it; other keys leave it where it is
    s.v.flash("It broke.", "red"); s.press("down", "up"); assert.match(s.text(), /It broke\. {2}\(esc\)/);
    s.press("esc"); assert.doesNotMatch(s.text(), /It broke/); assert.equal(s.v.ask, null);
    assert.equal(osc({ state: "blocked", kind: "question", id: "proj/1", title: "T", msg: "m", app: "claude" }), "\x1b]7501;state=blocked:id=proj/1:kind=question:app=claude:title=VA==:msg=bQ==\x1b\\");
  } finally { w.cleanup(); }
});

test("only space chooses a task's agent: moving to another task is back to the Coordinator, and never sends your words to the task you moved to", async () => {
  const w = await world({ settings: { helper: "off", reviewer: "off" } });
  try {
    const alpha = A.add(w.root, "Alpha"), beta = A.add(w.root, "Beta");
    const s = open(w); s.v.sel = alpha.id; s.v.load(); s.screen(120);
    s.press("space"); assert.equal(s.v.reply, true); assert.equal(s.v.replyId, alpha.id); assert.match(s.text(), /\n─+\n . Alpha {2}to do {2}no agent yet: your message starts one/);
    // Up or down selects the other task: nobody pressed space on it, so the chat is not its agent's.
    s.press(s.v.rows.filter((x) => x.rec).map((x) => x.rec.id).indexOf(alpha.id) ? "up" : "down");
    assert.equal(s.v.sel, beta.id); assert.equal(s.v.reply, false);
    assert.match(s.text(), /\n─+\n \+ New task {2}[^\n]*\n─+\n❯ what's next\?/); assert.doesNotMatch(s.text(), /\n─+\n . Beta {2}/);
    s.type("for nobody's agent"); s.press("enter");
    assert.equal(S.get(beta.id).stage, "todo", "Beta's agent was not started"); assert.equal(S.get(alpha.id).stage, "todo"); assert.equal(S.list().length, 3, "it went where the chat said: a new task");
    // Space on Beta talks to Beta; after the message is sent the chat is still Beta's, on the same row.
    s.v.sel = beta.id; s.v.load(); s.press("space"); s.type("start on this"); s.press("enter");
    assert.notEqual(S.get(beta.id).stage, "todo"); assert.equal(S.get(alpha.id).stage, "todo");
    await settle(beta.id); s.v.load();
    assert.equal(s.v.sel, beta.id); assert.equal(s.v.reply, true); assert.match(s.text(), /\n─+\n . Beta {2}/);
    // The task you talk to going away is back to the Coordinator too, never on to a neighbour.
    await A.clear(beta.id); s.v.load();
    assert.equal(s.v.reply, false); assert.notEqual(s.v.sel, beta.id); assert.match(s.text(), /\n─+\n \+ New task {2}/);
  } finally { w.cleanup(); }
});

test("a reply that was put away comes back as a reply to the same task, never as a new task", async () => {
  const w = await world({ settings: { helper: "off", reviewer: "off" } });
  try {
    process.env.HERDR_ENV = "1";
    w.script({ worker: [{ status: "working", screen: "● Working\n" }] });
    const id = A.add(w.root, "Add a greeting").id; A.add(w.root, "Another one");
    A.delegate(id); await settle(id);
    const s = open(w);
    for (const width of [120, 80]) { // beside the list, and with the panel full screen
      s.screen(width); s.v.sel = id; s.v.load();
      s.press("space"); s.type("also say goodbye");
      s.press("esc"); assert.equal(s.v.value(), ""); assert.equal(s.v.reply, true); // the first esc only puts the words away
      s.press("esc"); assert.equal(s.v.chatOpen, false); assert.equal(s.v.reply, true); // the second hides the agent's message in the chat
      s.press("esc"); assert.equal(s.v.reply, false); assert.match(s.text(width), /\n─+\n \+ New task {2}[^\n]*\n─+\n❯/);
      s.press("\x1bv"); assert.equal(s.v.chatOpen, true);
      s.press("down"); assert.notEqual(s.v.sel, id);
      s.press("ctrl+z");
      assert.equal(s.v.sel, id); assert.equal(s.v.reply, true); assert.equal(s.v.full, width < 90);
      assert.match(s.text(width), /\n─+\n . Add a greeting {2}[^\n]*\n(?:[^\n]*\n)*?─+\n❯ also say goodbye/);
      w.script({ worker: [{ status: "working" }] });
      const before = S.list().length;
      s.press("enter");
      assert.equal(S.list().length, before, "no new task was filed");
      assert.match(w.state().panes.find((p) => p.pane_id === S.get(id).link.pane).agent.prompts.at(-1), /also say goodbye/);
      s.press("esc"); if (s.v.reply || s.v.full) s.press("esc"); // the message in the chat, then the reply
      assert.equal(s.v.reply, false); assert.equal(s.v.ask, null); s.press("\x1bv"); assert.equal(s.v.chatOpen, true);
    }
    // a new task that was put away comes back as a new task, also when you are replying to something by then
    s.screen(120); s.type("buy milk"); s.press("esc", "space"); assert.equal(s.v.reply, true);
    s.press("ctrl+z"); assert.equal(s.v.reply, false); assert.match(s.text(), /\n─+\n \+ New task {2}[^\n]*\n─+\n❯ buy milk/);
    s.press("esc");
    // the task a reply was for is gone: the words stay put away rather than go somewhere else
    const gone = A.add(w.root, "Short lived").id; s.v.sel = gone; s.v.load();
    s.press("space"); s.type("for the short lived one"); s.press("esc", "esc");
    await A.clear(gone); s.v.load();
    s.press("ctrl+z"); assert.equal(s.v.value(), ""); assert.match(s.text(), /The task that reply was for is gone\. ctrl\+z again brings the words back as a draft of their own\./);
    s.press("ctrl+z"); assert.match(s.text(), /\n─+\n \+ New task {2}[^\n]*\n─+\n❯ for the short lived one/); assert.equal(s.v.reply, false); // asked for, so never lost and never a surprise
    s.press("esc");
    // the task disappears while the reply is still being typed: the words never slide over to whichever task is selected next
    const doomed = A.add(w.root, "Doomed").id; s.v.sel = doomed; s.v.load();
    s.press("space"); s.type("only for the doomed one");
    await A.clear(doomed); s.v.beat();
    assert.notEqual(s.v.sel, doomed); assert.equal(s.v.reply, false); assert.equal(s.v.value(), "");
    assert.match(s.text(), /The task you were replying to is gone\. Nothing was sent; your words are put away\./);
    const tasks = S.list().length, asked = JSON.stringify(w.state().panes.map((p) => p.agent?.prompts?.length));
    s.press("enter"); // enter now only opens the selected agent or does nothing: it has no words to send anywhere
    assert.equal(S.list().length, tasks); assert.equal(JSON.stringify(w.state().panes.map((p) => p.agent?.prompts?.length)), asked);
    assert.equal(s.v.draftAway.text, "only for the doomed one");
    // words that were put away survive the board closing or reloading itself: ctrl+z still brings them back
    const s4 = open(w);
    s4.v.sel = id; s4.v.load(); s4.press("space"); s4.type("kept across a reload"); s4.press("esc", "esc");
    s4.v.tick = 4; s4.v.stamp = "old"; s4.v.beat(); s4.v.tick = 9; s4.v.beat();
    assert.deepEqual(s4.closed(), { reload: true }); s4.v.dispose();
    const s5 = open(w);
    s5.press("ctrl+z"); assert.equal(s5.v.sel, id); assert.match(s5.text(), /\n─+\n . Add a greeting {2}[^\n]*\n(?:[^\n]*\n)*?─+\n❯ kept across a reload/);
    // and so does a reply still in the text box when the board is closed from outside
    s5.v.dispose();
    const s6 = open(w); assert.equal(s6.v.value(), ""); s6.press("ctrl+z");
    assert.match(s6.text(), /\n─+\n . Add a greeting {2}[^\n]*\n(?:[^\n]*\n)*?─+\n❯ kept across a reload/);
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("ctrl+a on something that went wrong retries it as it stands; the focused-pane action asks before it merges", async () => {
  const w = await world({ repoSettings: { check: "test -f good.txt" }, settings: { helper: "off", reviewer: "off" } });
  try {
    w.script({ worker: [{ note: "Done 1." }, { note: "Done 2." }, { note: "Done 3." }] });
    const id = A.add(w.root, "Never passes").id;
    A.delegate(id);
    let t = await settle(id, { max: 30 });
    assert.equal(t.stage, "failed"); assert.match(t.failure.title, /Check failed after 3 tries/);
    const s = open(w);
    s.v.sel = id; s.v.load();
    assert.match(s.text(), /\n {2}ctrl\+r send it to the agent to fix · ctrl\+a retry · space reply · \? more/);
    // You fixed the cause yourself: yes runs the same step again, with nothing sent to the agent.
    const prompts = () => w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts.length;
    const sent = prompts();
    fs.writeFileSync(path.join(t.worktree, "good.txt"), "ok\n"); git(t.worktree, "add", "-A"); git(t.worktree, "commit", "-qm", "good");
    s.press("ctrl+a");
    assert.match(s.text(), /proj\/1: trying again/); assert.equal(S.get(id).stage, "checking");
    t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(prompts(), sent);
    // An agent that said it needs a login: the panel says ctrl+a after you have signed in, and ctrl+a tells it to carry on.
    {
      w.script({ worker: [{ status: "working" }] });
      const lid = A.add(w.root, "Needs a login").id; A.delegate(lid); const lt = await settle(lid);
      S.update(lid, (x) => { x.stage = "asks"; x.kind = "auth"; x.msg = "Please log in to the registry."; });
      const l = open(w); l.v.sel = lid; l.v.load();
      assert.match(l.text(), /│ {2}Needs a login/); assert.match(l.text(), /press ctrl\+a to tell the agent to try\s+[^\n]*│?\s*again|ctrl\+a/); assert.match(l.text(), /\n {2}ctrl\+a retry · space reply · enter open the agent · \? more/);
      const n = w.state().panes.find((p) => p.pane_id === lt.link.pane).agent.prompts.length;
      l.press("ctrl+a");
      assert.match(l.text(), /told the agent to continue/); assert.doesNotMatch(l.text(), /Nothing here waits for a yes/);
      const after = w.state().panes.find((p) => p.pane_id === lt.link.pane).agent.prompts;
      assert.equal(after.length, n + 1); assert.match(after.at(-1), /Continue the task where you left off/); assert.equal(S.get(lid).stage, "working");
      A.stop(lid);
    }
    // herdr's own action for the focused pane has no screen to ask on: it leaves a request and opens the board,
    // which opens on that task with the question up. Nothing is merged until enter.
    A.add(w.root, "Something else");
    process.env.HERDR_PLUGIN_CONTEXT_JSON = JSON.stringify({ focused_pane_id: t.link.pane });
    try { execFileSync(process.execPath, [S.BIN, "approve-current"], { encoding: "utf8", cwd: w.root }); } finally { delete process.env.HERDR_PLUGIN_CONTEXT_JSON; }
    assert.equal(S.get(id).stage, "approval", "the action alone merges nothing");
    assert.ok(w.state().calls.some((c) => /popup|open|plugin/.test(c)), "it opens the board");
    const b = open(w);
    assert.equal(b.v.sel, id); assert.match(b.text(), /\n \? Merge "Never passes"\? {2}enter = yes · esc = no/);
    b.press("esc"); assert.equal(S.get(id).stage, "approval");
    assert.equal(open(w).v.ask, null, "asked once, not every time the board opens");
    execFileSync(process.execPath, [S.BIN, "approve-current"], { encoding: "utf8", cwd: w.root, env: { ...process.env, HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_id: t.link.pane }) } });
    const b2 = open(w); b2.press("enter");
    assert.equal(S.get(id).stage, "merging");
    assert.equal((await settle(id, { max: 30 })).stage, "done");
  } finally { w.cleanup(); }
});

test("the first run is one screen: both choices, answered with single keys", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const added = [];
    const offers = () => ({ asked: false, file: "/home/u/.config/herdr/config.toml", key: { suggest: "prefix+a" }, sidebar: {} });
    const addBlock = (what, arg) => { if (what === "key" && arg === "prefix+q") return { ok: false, msg: "herdr itself uses prefix+q. Choose another." }; added.push([what, arg]); return { ok: true, msg: "Added." }; };
    const start = () => {
      const tui = { terminal: { rows: 30, columns: 100 }, requestRender() {}, stop() {}, start() {} };
      const v = new View(tui, theme, () => {}, { cwd: w.root, offers, addBlock }); clearInterval(v.timer);
      delete process.env.HERDR_SUPERWORK_INLINE; process.env.HERDR_ENV = "1";
      try { v.startSetup(); } finally { process.env.HERDR_SUPERWORK_INLINE = "1"; delete process.env.HERDR_ENV; }
      return { v, text: () => v.render(100).map((l) => stripVTControlCharacters(l)).join("\n"), press: (...keys) => { for (const k of keys) v.handleInput(KEY[k] ?? k); } };
    };
    let s = start();
    let text = s.text();
    assert.match(text, /herdr-superwork · first run/); assert.doesNotMatch(text, /question 1 of/);
    assert.match(text, /1 {2}\[x\] Open this board with prefix\+a, from anywhere in herdr/); assert.match(text, /2 {2}\[x\] Show each task's stage/);
    assert.match(text, /1 2 on or off · enter save · esc ask me next time/);
    s.press("2"); assert.match(s.text(), /2 {2}\[ \] Show each task's stage/); // one key, no "y" and enter
    s.press("k"); for (const ch of "prefix+q") s.press(ch); s.press("enter");
    assert.match(s.text(), /Open this board with prefix\+q/);
    s.press("enter"); // herdr refuses that key: the screen stays and says why
    assert.ok(s.v.setup); assert.match(s.text(), /herdr itself uses prefix\+q/); assert.deepEqual(added, []);
    s.press("k"); for (const ch of "prefix+y") s.press(ch); s.press("enter", "2", "enter");
    assert.equal(s.v.setup, null); assert.deepEqual(added, [["key", "prefix+y"], ["sidebar", undefined]]);
    assert.match(s.text().replace(/\s+/g, " "), /Added to .*config\.toml: prefix\+y opens the board; herdr's sidebar shows each task's stage/);
    // esc changes nothing and asks again next time
    added.length = 0; s = start(); s.press("esc");
    assert.equal(s.v.setup, null); assert.deepEqual(added, []); assert.match(s.text(), /Asked again next time\. Nothing was changed\./);
  } finally { w.cleanup(); }
});

test("after a plugin update the board loads the new version by itself, once nothing is half typed", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const s = open(w);
    s.v.tick = 4; s.v.stamp = "old"; // the files on disk are newer than what this board runs
    s.type("a draft"); s.v.beat(); s.v.tick = 9; s.v.beat();
    assert.equal(s.closed(), undefined); assert.match(s.text(), /herdr-superwork was updated: the new version loads when nothing is half typed\./); // never under a draft
    assert.doesNotMatch(s.text(), /Close the board \(esc\) and open it again/);
    s.press("esc"); s.v.tick = 14; s.v.beat();
    assert.deepEqual(s.closed(), { reload: true });
  } finally { w.cleanup(); }
});

test("the hidden helper: the watcher writes a line and a guess", async () => {
  const w = await world({ settings: { reviewer: "off", watcher: "on" } });
  try {
    process.env.HERDR_SUPERWORK_HELPER_CMD = JSON.stringify(["node", path.join(here, "fake-helper.js")]);
    const seen = path.join(w.root, "..", "watcher-prompt.txt"); process.env.FAKE_HELPER_PROMPT = seen;
    A.add(w.root, "build a login page", { description: "It needs a password field.\n" + "x".repeat(3000) });
    // the watcher: only while herdr says working; 100k auto-compact on the watcher only
    w.script({ worker: [{ status: "working", screen: "● Writing greet.sh\n" }] });
    A.delegate("proj/1"); await settle("proj/1");
    S.update("proj/1", (t) => { t.since = Date.now() - 40 * 60000; t.workAt = 0; }); // forty minutes into the work
    H.watchTick(F.board());
    for (let i = 0; i < 60 && !S.get("proj/1").watch; i++) await new Promise((r) => setTimeout(r, 50));
    // It guesses the line and the percent only; the minutes left are worked out, never stored.
    assert.deepEqual([S.get("proj/1").watch.msg, S.get("proj/1").watch.progress, "eta" in S.get("proj/1").watch], ["editing the greeting file", 42, false]);
    const shown = F.board().find((t) => t.id === "proj/1");
    assert.deepEqual([shown.note, shown.progress, shown.eta], ["editing the greeting file", 42, 55]); // 40 × 58 ÷ 42
    assert.ok(w.state().metadata.some((m) => m.args.join(" ").includes("summary=editing the greeting file") && m.args.join(" ").includes("progress=42% --token eta=55m")));
    // What it was told: the task's description (cut short), the time spent, and no rule against going lower.
    const first = fs.readFileSync(seen, "utf8");
    assert.match(first, /Task: build a login page\nWhat the task asks for:\nIt needs a password field\. x+\n/); assert.ok(!first.includes("x".repeat(1600)));
    assert.match(first, /The agent has been on this for 40 minutes so far\./); assert.match(first, /This is your first look at it\./);
    assert.doesNotMatch(first, /"eta"|minutes are left|started over/);
    // The next look gets the previous guess, and may lower it when new work shows up.
    w.patchState((st) => { st.panes.find((p) => p.pane_id === S.get("proj/1").link.pane).agent.screen = "● 3 tests failed\n"; });
    const at = S.get("proj/1").watch.at;
    H.watchTick(F.board(), Date.now() + 20000);
    for (let i = 0; i < 60 && S.get("proj/1").watch.at === at; i++) await new Promise((r) => setTimeout(r, 50));
    const second = fs.readFileSync(seen, "utf8");
    assert.match(second, /Your previous guess was 42 percent\. Keep it unless something on the screen is a reason to change it\./); assert.match(second, /Lower it when new work shows up: a failing test/);
    // Stopped and delegated again: the old guess goes, so the new assignment starts with no percent and no minutes.
    A.stop("proj/1"); S.update("proj/1", (t) => { t.watch = { msg: "reading the diff", progress: 80, role: "reviewer", at: Date.now() }; t.reviewAt = Date.now() - 40 * 60000; });
    w.script({ worker: [{ status: "working", screen: "● Starting over\n" }] });
    A.delegate("proj/1"); await settle("proj/1");
    const fresh = F.board().find((t) => t.id === "proj/1");
    assert.deepEqual([S.get("proj/1").stage, S.get("proj/1").watch, fresh.eta], ["working", null, undefined]);
  } finally { delete process.env.HERDR_SUPERWORK_HELPER_CMD; delete process.env.FAKE_HELPER_PROMPT; w.cleanup(); }
});

test("other machines: the door answers one line of JSON, actions run where the task lives, and the SSH line uses a login shell", async () => {
  const w = await world({ settings: { helper: "off", reviewer: "off", machines: "exedev@vm-a, vm-b" } });
  try {
    const t = A.add(w.root, "Remote task");
    const door = (...args) => execFileSync(process.execPath, [S.BIN, "remote", ...args], { encoding: "utf8" }).trim();
    const pack = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
    const lines = [door("list"), door("do", pack({ action: "pin", id: t.id })), door("do", pack({ action: "nope", id: t.id })), door("dispatch", pack({ text: "Filed from afar" }))];
    const [list, pin, nope, disp] = lines.map((l) => JSON.parse(l));
    assert.equal(list.tasks[0].id, t.id); assert.equal(list.tasks[0].state, "idle"); assert.ok(list.tasks[0].snap.folder);
    assert.deepEqual(pin, { ok: true, msg: "" }); assert.equal(S.get(t.id).pinned, true);
    assert.equal(nope.ok, false); assert.equal(disp.ok, true); assert.match(disp.msg, /filed/);
    let found; machines((m) => { found = m; });
    assert.deepEqual(found.map((m) => [m.target, m.label]), [["exedev@vm-a", "vm-a"], [`${S.me() === "exedev" ? "exedev" : (await import("node:os")).userInfo().username}@vm-b`, "vm-b"]]);
    const cmd = sshCommand({ target: "exedev@vm-a", session: "work" }, "herdr-superwork remote list");
    assert.equal(cmd.command, "ssh"); assert.ok(cmd.args.includes("BatchMode=yes"));
    assert.equal(cmd.args.at(-1), `exec "\${SHELL:-/bin/sh}" -lc 'HERDR_SESSION=work herdr-superwork remote list'`);
    const at = attachCommand({ target: "exedev@vm-a", session: "" }, "w4:p1; rm -rf /");
    assert.ok(at.args.includes("-t")); assert.match(at.args.at(-1), /herdr agent attach w4:p1rm-rf'$/);
  } finally { w.cleanup(); }
});

test("the command: add, list, report, config, and the hook entry does nothing when there are no tasks", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const sw = (...args) => execFileSync(process.execPath, [S.BIN, ...args], { encoding: "utf8", cwd: w.root });
    assert.equal(sw("hook"), "");
    assert.ok(!fs.existsSync(path.join(S.dataDir(), "tasks")));
    const out = [sw("add", "From", "the", "shell", "--desc", "d", "--json"), sw("report", "1", "--state", "working", "--msg", "on it"), sw("list", "--json"), sw("config", "max", "2"), sw("config", "reviewer", "off", "--id", "1"), sw("--skill")];
    assert.equal(JSON.parse(out[0]).id, "proj/1");
    const listed = JSON.parse(out[2]); assert.deepEqual([listed[0].state, listed[0].app, listed[0].msg], ["working", S.me(), "on it"]);
    assert.equal(S.config().max, 2); assert.equal(S.choices(S.get("proj/1")).review, "none");
    assert.match(out.at(-1), /report <your id> --state blocked/);
    assert.throws(() => sw("frobnicate"), /Unknown command/);
  } finally { w.cleanup(); }
});

test("the board: a row waiting for approval says the reviewer's advice in words, with the PR and its checks on the right", () => {
  const v = Object.create(View.prototype); v.theme = theme; v.scope = ""; v.screens = new Map(); v.repo = { root: "/nowhere", name: "proj" };
  const row = (r, width, list = [r]) => stripVTControlCharacters(v.row(r, width, v.rowLayout(list, width)));
  const page = (r, full = false) => stripVTControlCharacters(v.panel({ owner: "me", ...r }, 80, full).join("\n"));
  const base = { id: "proj/1", title: "Build a flying game", state: "blocked", kind: "permission", stage: "approval", agent: "claude", app: "claude", at: Date.now(), msg: "Approve to merge? Reviewed 3/5, says don't merge. Built **Skylark**: a little plane over endless sunny islands, with clouds." };
  const review = { score: 3, recommend: false, text: "Crashes." };
  const pr = { ...base, pr: "https://github.com/a/b/pull/12", prState: "passing", review }, plain = { ...base, review };
  const working = { id: "proj/2", title: "Other", state: "working", agent: "claude", stage: "work", progress: 50, msg: "A long sentence about what the other agent is doing right now, in detail.", at: Date.now() };
  // wide: the name, the score with the advice in words and, on the right, the PR with a mark for its checks. The row
  // does not repeat its heading ("approve to merge?" on every row), and there is no r1 marker.
  assert.match(row(pr, 120), /^ ✓ Build a flying game {2}3\/5 reviewer says no +PR#12 ✓ {2}0s ago$/);
  assert.match(row({ ...pr, prState: "" }, 120), / PR#12 {2}0s ago$/);
  // failed checks are not ready to approve: the row needs you, says why, and offers no "approve and merge"
  const redPr = { ...pr, prState: "failing", prFailure: { stage: "pr", title: "Pull request checks failed", detail: "test: failure", agentCanFix: true, next: "Fix the checks." } };
  assert.match(row(redPr, 120), /^ × Build a flying game {2}Pull request checks failed +PR#12 ✗ {2}0s ago$/);
  assert.match(row({ ...pr, prState: "failing" }, 120), /^ × Build a flying game {2}the pull request's checks fail +PR#12 ✗ {2}0s ago$/);
  assert.match(page(redPr), /× needs you · claude · 0s ago · proj\/1\n PR#12 ✗\n\n ▎ Pull request checks failed\n ▎ The agent can fix this: ctrl\+r sends it\.\n ▎ ?\n ▎ Next step\n ▎ Fix the checks\./); assert.doesNotMatch(page(redPr), /ready to approve/);
  v.reply = false; v.full = false; v.menu = null; v.ask = null; v.mode = "new"; v.chatOpen = true; v.input = { getText: () => "" }; v.jobs = []; v.sel = "";
  assert.deepEqual(v.hints(redPr).map(([k]) => k), ["ctrl+r", "ctrl+a", "space", "?"]); assert.ok(!v.hints(redPr).some(([, d]) => /approve/.test(d)));
  assert.equal(v.hints(pr)[0][1], "approve and merge");
  if (!process.env.NO_COLOR) assert.ok(v.row(redPr, 120).includes("\x1b[38;2;243;139;168m\x1b[1m×") || /243;139;168m[^m]*×/.test(v.row(redPr, 120)), "its mark is the needs-you red, not the ready green");
  assert.match(row(plain, 120), /^ ✓ Build a flying game {2}3\/5 reviewer says no +0s ago$/);
  assert.match(row({ ...pr, review: { ...review, recommend: true, score: 5 } }, 120), / {2}5\/5 reviewer says yes +PR#12 ✓ {2}0s ago$/);
  assert.match(row({ ...pr, review: { score: 3 } }, 120), /^ ✓ Build a flying game {2}3\/5 +PR#12/); // no advice given: the score alone
  // the PR number is always written the same way and left-aligned, so the "PR#" parts line up
  const short = { ...pr, id: "proj/7", pr: 9, prState: "merged" }, list = [pr, short];
  assert.equal(row(pr, 120, list).indexOf("PR#12 ✓"), row(short, 120, list).indexOf("PR#9")); assert.match(row(short, 120, list), / PR#9 {5}0s ago$/);
  if (!process.env.NO_COLOR) {
    const red = "\x1b[38;2;243;139;168m", green = "\x1b[38;2;166;227;161m", yellow = "\x1b[38;2;249;226;175m", mauve = "\x1b[38;2;203;166;247m";
    assert.ok(v.row(pr, 120).includes(`${red}3/5`)); assert.ok(v.row({ ...pr, review: { ...review, recommend: true } }, 120).includes(`${green}3/5`));
    assert.ok(v.row(pr, 120).includes(`${green}PR#12`) && v.row(pr, 120).includes(`${green}✓`)); // the colour only repeats the mark
    // whatever the state, the title is plain text
    for (const r of [pr, working, { ...working, state: "error", stage: "failed" }, { ...working, state: "done" }, { ...working, state: "idle" }]) assert.match(v.row(r, 120), /^ \S+ (\x1b\[1m)?[A-Z]/);
    // while the reviewer works, the mark, the bar and the percent are a colour no other state uses
    const reviewed = v.row({ ...working, stage: "reviewing", reviewRound: 1 }, 120);
    assert.ok(reviewed.includes(`${mauve}◐`) && reviewed.includes(`${mauve} 50%`) && reviewed.includes(`${mauve}█`) && !reviewed.includes(`${mauve}review`) && !reviewed.includes(yellow));
    const plainWork = v.row(working, 120);
    assert.ok(plainWork.includes(`${yellow}◐`) && !plainWork.includes(mauve));
  }
  assert.match(row(base, 120), /^ ✓ Build a flying game +0s ago$/); // no reviewer: the heading says the rest
  assert.match(row({ ...pr, review: { ...review, stale: true } }, 120), /^ ✓ Build a flying game {2}the work changed since its review +PR#12 ✓ {2}0s ago$/);
  // which review it is on: nothing on the first, in words from the second
  const second = { ...pr, reviewRound: 2 };
  assert.doesNotMatch(row({ ...pr, reviewRound: 1 }, 120), /review\b.*review|r1|1st/);
  assert.match(row(second, 120), /^ ✓ Build a flying game {2}3\/5 reviewer says no · 2nd review +PR#12 ✓ {2}0s ago$/);
  assert.match(row({ ...pr, reviewRound: 3 }, 120), /3\/5 reviewer says no · 3rd review/);
  // narrower, the verdict is never cut: first the round goes, then the words, the score last
  assert.match(row(second, 60), /^ ✓ Build a flying game {2}3\/5 reviewer says no +PR#12 ✓ {2}0s$/);
  assert.match(row(second, 44), /^ ✓ Build a flying game {2}3\/5 +PR#12 ✓ {2}0s ago$/);
  assert.match(row(second, 34), /^ ✓ Build a flying game {2}3\/5 +0s$/);
  assert.match(row(pr, 24), /^ ✓ Build a flying game *$/);
  // a failed merge needs you: it says why, and the panel still has the score and which review gave it
  const failedMerge = { ...second, mergeFailed: true, review: { ...review, recommend: true, score: 5 }, msg: "The merge failed: conflict in src/game.js" };
  assert.match(row(failedMerge, 120), /^ × Build a flying game {2}The merge failed: conflict in src\/game\.js +PR#12 ✓ {2}0s ago$/);
  assert.match(page(failedMerge), /× needs you · 2nd review · claude · 0s ago · proj\/1/); assert.match(page(failedMerge), /\n Review ─+\n ╭─ Review 2 ─+╮\n │ 5\/5, says merge +│\n │ Crashes\. +│\n ╰─+╯\n/);
  // behind main and not brought up to date yet: neither the row nor the panel say it is ready
  const behind = { ...pr, summary: "Did the work.", syncBlocked: { why: "main could not be fetched (network is down)" }, msg: "Behind main, and not up to date yet: main could not be fetched (network is down). The board keeps trying; it cannot be approved until then." };
  assert.match(row(behind, 120), /^ × Build a flying game {2}Behind main, and not up to date yet/);
  assert.match(page(behind), /Behind main, cannot be approved yet/); assert.match(page(behind), /main could not be fetched \(network is down\)/); assert.doesNotMatch(page(behind), /ready to approve/);
  // the panel, in the order you need it: where it stands and the change, the review in its box, what the agent said, the settings
  const ready = page({ ...second, summary: "Did the work.", said: "Built Skylark.", stat: " 4 files changed, 120 insertions(+), 31 deletions(-)" });
  assert.match(ready, /^\n Build a flying game\n ✓ ready to approve · 2nd review · claude · 0s ago · proj\/1\n 4 files, \+120 −31 · PR#12 ✓\n\n Review ─+\n ╭─ Review 2 ─+╮\n │ 3\/5, says don't merge +│\n │ Crashes\. +│\n ╰─+╯\n\n The agent said ─+\n Built Skylark\.\n\n Settings ─+\n Project /);
  assert.match(ready, /\n Permissions {2}[^\n]+$/); assert.doesNotMatch(ready, /https:|shows the whole task/); // every setting, tightly, at the end; the link is in the PR's number
  assert.match(page({ ...second, stat: " 4 files changed, 120 insertions(+), 31 deletions(-)" }, true), /\n 4 files, \+120 −31 · PR#12 ✓\n https:\/\/github\.com\/a\/b\/pull\/12\n/); // full screen it is printed too
  assert.doesNotMatch(ready, /Description|None\./);
  // Every review the task had: how many, how each went, and the latest in a box of its own, on both shapes of the panel.
  const spiral = { ...second, reviewRound: 3, review: { score: 4, recommend: true, text: "Fine now.", stale: false }, reviews: [
    { round: 1, at: Date.now() - 7200000, score: 2, recommend: false, text: "Crashes on start.", problems: ["game.js: null plane."], checks: ["Ran it."], limitations: [], head: "1111111aaaa" },
    { round: 2, at: Date.now() - 3600000, error: "the reviewer finished without a verdict" },
    { round: 3, at: Date.now() - 60000, score: 4, recommend: true, text: "Fine now.", problems: [], checks: ["Ran the tests: all pass."], limitations: ["Not tried on a phone."], head: "abcdef12345" }] };
  assert.match(page(spiral), /\n Reviews · 3 ─+\n 2\/5 no → no verdict → 4\/5 yes\n ╭─ Review 3 ─+ 1m ago ─╮\n │ 4\/5, says merge +│\n │ Fine now\. +│\n ╰─+╯\n/);
  assert.doesNotMatch(page(spiral), /Crashes on start|the newest first|Review [12] /); assert.match(page(spiral), /\n\n ctrl\+e shows the whole task$/); // beside the list: only the latest, and where the rest is
  const whole = page(spiral, true);
  assert.match(whole, /\n Reviews · 3, the newest first ─+\n 2\/5 no → no verdict → 4\/5 yes\n ╭─ Review 3 ─+ 1m ago · abcdef1 ─╮\n │ 4\/5, says merge +│\n │ Fine now\. +│\n │ +│\n │ Checked +│\n │ • Ran the tests: all pass\. +│\n │ +│\n │ Could not verify +│\n │ • Not tried on a phone\. +│\n ╰─+╯\n\n ╭─ Review 2 ─+ 1h ago ─╮\n │ No verdict +│\n │ the reviewer finished without a verdict +│\n ╰─+╯\n\n ╭─ Review 1 ─+ 2h ago · 1111111 ─╮\n │ 2\/5, says don't merge +│\n │ Crashes on start\. +│\n │ +│\n │ Problems +│\n │ • game\.js: null plane\. +│\n │ +│\n │ Checked +│\n │ • Ran it\. +│\n ╰─+╯\n/);
  assert.ok(whole.indexOf("\n ✓ ready to approve") < whole.indexOf("Reviews · 3, the newest first") && whole.indexOf("╭─ Review 1 ") < whole.indexOf("\n Settings ") && whole.indexOf("\n Settings ") < whole.indexOf("\n Permissions")); // where it stands, every review, then the settings
  // a narrow full screen drops nothing of a review: its age and commit move from the box's edge to its first line
  { const thin = stripVTControlCharacters(v.panel({ owner: "me", ...spiral }, 24, true).join("\n"));
    assert.match(thin, /\n ╭─ Review 3 ─+╮\n │ 1m ago · abcdef1 +│\n │ 4\/5, says merge +│\n/); assert.match(thin, /\n ╭─ Review 2 ─+╮\n │ 1h ago +│\n │ No verdict +│\n/); assert.match(thin, /\n ╭─ Review 1 ─+╮\n │ 2h ago · 1111111 +│\n/); }
  // a side panel too short for every setting still has the latest review, on one line, before any setting
  for (const fit of [12, 8, 4]) {
    const lines = v.panel({ owner: "me", ...spiral, worktree: "", description: "Long. ".repeat(200) }, 46, false, fit).map((l) => stripVTControlCharacters(l));
    assert.ok(lines.length <= fit); assert.equal(lines[0], " Build a flying game"); assert.equal(lines[1], " Review 3  4/5, says merge"); assert.match(lines[2], /^ Project /); assert.ok(!lines.some((l) => l.startsWith(" Branch ")), "the branch row goes before the review does");
  }
  // many reviews in a narrow panel: the trail keeps the newest and says that older ones are left out
  const many = { ...spiral, reviews: Array.from({ length: 12 }, (_, n) => ({ round: n + 1, score: 2, recommend: false, text: "Still broken." })) };
  assert.match(stripVTControlCharacters(v.panel({ owner: "me", ...many }, 44, false).join("\n")), /\n Reviews · 12 ─+\n … 2\/5 no → 2\/5 no → 2\/5 no → 2\/5 no\n ╭─ Review 12 ─/);
  // a short window never costs a setting: the long parts give way, and in the end the review is one line
  const busy = { ...spiral, title: "Build a flying game with a very long name that wraps onto two lines", state: "working", kind: undefined, stage: "working", progress: 40, eta: 12, msg: "Running the whole test suite again after the last fix", said: "Working on it.", description: "Long. ".repeat(200), usage: { in: 1000, out: 2000, context: 5000, window: 200000 }, link: { pane: "p1", workspace: "w1" } };
  for (const fit of [30, 20, 16, 14]) {
    const lines = v.panel({ owner: "me", ...busy }, 45, false, fit).map((l) => stripVTControlCharacters(l));
    assert.ok(lines.length <= fit, `fits in ${fit} lines`);
    for (const fact of ["Project", "Worktree", "Agent", "Reviewer", "Reviewed", "Send back", "Evidence", "Watcher", "Conflicts", "Permissions"]) assert.ok(lines.some((l) => l.startsWith(` ${fact} `)), `${fact} with room for ${fit} lines`);
    assert.ok(lines.some((l) => /^ (╭─ )?Review 3 /.test(l)), `the latest review with room for ${fit} lines`);
    assert.match(lines[lines.length - 1], /^ ctrl\+e shows the whole task$/);
  }
  assert.match(stripVTControlCharacters(v.panel({ owner: "me", ...busy }, 45, false, 30).join("\n")), /\n ▎ Now\n ▎ Running the whole test suite/); // with room, what it is doing is there, behind its bar
  if (!process.env.NO_COLOR) {
    // what a row says is greyed out, never in the title's colour
    const grey = "\x1b[38;2;108;112;134m";
    assert.ok(v.row(working, 120).includes(`${grey}A long sentence about what the other agent`), "a working row's status line is grey");
    assert.ok(v.row({ ...working, state: "blocked", kind: "question", stage: "asks", msg: "Which colour?" }, 120).includes(`${grey}Which colour?`), "and so is a row that needs you");
    assert.ok(!v.row(working, 120).includes(`${grey}Other`), "the title is not");
  }
  assert.match(row({ ...second, stage: "merging", state: "working", kind: undefined, msg: "merging" }, 120), /^ ◐ Build a flying game {2}merging +PR#12 ✓ {2}0s$/);
  assert.doesNotMatch(row({ ...second, state: "done", stage: "done" }, 120), /review|3\/5/);
  // while the reviewer works the row's sentence is only what the reviewer is doing
  const under = { ...working, stage: "reviewing", reviewRound: 3, msg: "Running the tests." };
  assert.match(row(under, 120), /^ ◐ Other {2}Running the tests\. +█+░+ +50% +0s$/); // no word "review", whichever review it is: the colour says it
  assert.match(row({ ...under, reviewRound: 1 }, 120), /^ ◐ Other {2}Running the tests\. /);
  assert.match(row({ ...under, reviewRound: 1, msg: "under review" }, 120), /^ ◐ Other +█/);
  assert.match(row(under, 30), /^ ◐ Other +50% +0s$/); // no room for the sentence: the row never falls back to a word
  assert.match(row({ ...under, stage: "reviewneeds", state: "blocked", progress: undefined, msg: "the reviewer shows a dialog" }, 120), /^ × Other {2}the reviewer shows a dialog +0s ago$/);
  assert.doesNotMatch(row({ ...working, reviewRound: 3 }, 120), /review/); // back with the agent: no review is running
  assert.match(page(under), /◐ reviewer is working · 3rd review · for 0s · proj\/2/);
  // another row's long sentence or progress does not take the verdict away
  assert.match(row(pr, 80, [pr, working]), /^ ✓ Build a flying game {2}3\/5 reviewer says no +PR#12 ✓ {2}0s ago$/);
  for (const width of [24, 30, 40, 60, 80, 120]) for (const r of [pr, plain, base]) {
    const line = row(r, width, [r, working]);
    assert.ok(line.length <= width, `fits ${width}`); assert.ok(!/Skylark|\*\*|Reviewed|approve to merge/.test(line)); assert.match(line, /^ \S Build a flying game/);
  }
  // a review judged by the gate: the result and a short tally in place of a score, in the row, the facts and the history
  const tagged = { meets: true, gate: "major", pass: true, text: "Works.", findings: [{ id: "F1", severity: "minor", subject: "A name is unclear", where: "game.js", proof: "" }, { id: "F2", severity: "minor", subject: "A comment is stale", where: "sky.js", proof: "" }] };
  const failing = { meets: false, gate: "major", pass: false, text: "No fix.", left: 1, findings: [{ id: "F1", severity: "critical", subject: "The plane never takes off", where: "game.js", proof: "ran it" }, { id: "F2", severity: "major", subject: "Crashes without a sky", where: "sky.js", proof: "ran it" }, { id: "F3", severity: "minor", subject: "A name is unclear", where: "game.js", proof: "" }, { id: "F4", severity: "major", subject: "The old menu flickers", where: "menu.js", proof: "", preexisting: true, task: "proj/7" }] };
  const gated = { ...pr, msg: "Approve to merge? Review: Pass · 2 minor. Built **Skylark**.", review: tagged };
  assert.match(row(gated, 120), /^ ✓ Build a flying game {2}Pass · 2 minor +PR#12 ✓ {2}0s ago$/);
  assert.match(row({ ...gated, review: failing }, 120), /^ ✓ Build a flying game {2}Fail · 1 critical, 1 major, 1 minor, 1 pre-existing +PR#12 ✓ {2}0s ago$/);
  assert.match(row({ ...gated, reviewRound: 2 }, 120), / {2}Pass · 2 minor · 2nd review +PR#12/); assert.match(row({ ...gated, review: { ...tagged, findings: [] } }, 120), / {2}Pass +PR#12/);
  assert.match(row({ ...gated, reviewRound: 2 }, 54), /^ ✓ Build a flying game {2}Pass · 2 minor +PR#12 ✓ {2}0s( ago)?$/); assert.match(row({ ...gated, reviewRound: 2 }, 34), /^ ✓ Build a flying game {2}Pass +0s$/); // never cut: shorter, then the one word
  { const paint = { ...theme, fg: (c, s) => `<${c}>${s}</>` }, cv = Object.create(View.prototype); Object.assign(cv, v, { theme: paint }); assert.ok(cv.row(gated, 120, cv.rowLayout([gated], 120)).includes("<green>Pass</>")); assert.ok(cv.row({ ...gated, review: failing }, 120, cv.rowLayout([gated], 120)).includes("<red>Fail</>")); }
  const loop = { ...gated, reviewRound: 3, reviews: [{ round: 1, at: Date.now() - 7200000, ...failing, head: "1111111aaaa" }, { round: 2, at: Date.now() - 3600000, score: 4, recommend: true, text: "An old one.", problems: ["game.js: old."] }, { round: 3, at: Date.now() - 60000, ...tagged, head: "abcdef12345" }] };
  assert.match(page(loop), /\n Reviews · 3 ─+\n fail → 4\/5 yes → pass\n ╭─ Review 3 ─+ 1m ago ─╮\n │ Pass · 2 minor +│\n │ Works\. +│\n ╰─+╯\n/); assert.doesNotMatch(page(loop), /Skylark[^\n]*Review:|Review: Pass/); // the board's own words about the review are not said twice
  assert.match(page(loop, true), /\n ╭─ Review 3 ─+ 1m ago · abcdef1 ─╮\n │ Pass · 2 minor +│\n │ Works\. +│\n │ +│\n │ Findings +│\n │ • \[minor\] A name is unclear \(game\.js\) · not required +│\n │ • \[minor\] A comment is stale \(sky\.js\) · not required +│\n ╰─+╯\n\n ╭─ Review 2 ─+ 1h ago ─╮\n │ 4\/5, says merge +│\n │ An old one\. +│\n │ +│\n │ Problems +│\n │ • game\.js: old\. +│\n ╰─+╯\n\n ╭─ Review 1 ─+ 2h ago · 1111111 ─╮\n │ Fail · 1 critical, 1 major, 1 minor, 1 pre-existing +│\n │ No fix\. +│\n │ +│\n │ Findings +│\n │ • \[critical\] The plane never takes off \(game\.js\) +│\n │ • \[major\] Crashes without a sky \(sky\.js\) +│\n │ • \[minor\] A name is unclear \(game\.js\) · not required +│\n │ • \[major\] The old menu flickers \(menu\.js\) · pre-existing, filed as proj\/7 +│\n │ • 1 smaller finding noticed late, left out +│\n ╰─+╯\n/);
  // what a row needs from you outranks its bar
  const stuck = { ...working, state: "blocked", kind: "question", stage: "asks", title: "Build a flying game", msg: "Which colour should the plane be?" };
  assert.match(row(stuck, 72), /^ × Build a flying game {2}Which colour should the plane be\? +50% +0s ago$/); assert.match(row(stuck, 120), /be\? +█+░+ +50% +0s ago$/);
  // rows that need you say what blocks them, after the name and without Markdown marks; with nothing said, in plain words
  const ask = "Which colour should the plane be, and should the **islands** have `palm` trees?";
  for (const r of [{ ...base, stage: "", kind: "question", msg: ask }, { ...base, mergeFailed: true, msg: ask }, { ...base, state: "error", kind: "", stage: "failed", msg: ask }])
    assert.match(row(r, 120), /^ \S Build a flying game {2}Which colour should the plane be, and should the islands have palm trees\? +0s ago$/);
  assert.match(row({ ...base, stage: "asks", kind: "question", msg: "" }, 120), / {2}has a question +0s ago$/);
  assert.match(row({ ...base, stage: "asks", kind: undefined, msg: "needs you" }, 120), /^ × Build a flying game +0s ago$/); // not the heading's own words again
});

test("a reply typed on the board to work that was merged and cleaned up starts a new round, also with the Coordinator off", async () => {
  const w = await world({ settings: { helper: "off", reviewer: "off", coordinator: "off" } });
  try {
    process.env.HERDR_ENV = "1";
    w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }] });
    const id = A.add(w.root, "Work").id;
    A.delegate(id);
    assert.equal((await settle(id)).stage, "approval");
    A.approve(id);
    let t = await settle(id);
    assert.equal(t.stage, "done"); assert.ok(t.cleaned && !t.link.pane);
    const s = open(w);
    s.v.sel = id; s.v.load();
    s.press("space");
    w.script({ worker: [{ files: { "g.txt": "g\n" }, commit: "g", note: "Did g." }] });
    s.type("now add g"); s.press("enter");
    assert.match(s.text(), /new round/); assert.equal(s.v.value(), "");
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.ok(!String(t.description || "").includes("now add g"));
    assert.ok(w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts.some((x) => /now add g/.test(x)));
    s.v.dispose();
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("the done list is plain: newest first, and nothing marks a task as read or not", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const titles = ["oldest", "middle", "newest"], ids = titles.map((title) => A.add(w.root, title).id), now = Date.now();
    // `seen` is what an older version saved in a task: it changes neither the order nor the row
    ids.forEach((id, n) => { S.update(id, { stage: "done" }); S.update(id, { at: now - (3 - n) * 60000, seen: n !== 0 }); });
    const s = open(w);
    const lines = s.screen(80), at = titles.map((title) => lines.findIndex((l) => l.startsWith(` ✓ ${title}`)));
    assert.ok(at[2] > 0 && at[2] < at[1] && at[1] < at[0], lines.join("\n"));
    assert.doesNotMatch(lines.join("\n"), /unread/);
    for (const r of s.v.items) assert.equal(s.v.row(r, 80).includes("\x1b[1m"), false, "no done row stands out from the others");
    s.press("enter", "esc"); assert.equal(S.get(s.v.sel).seen, s.v.sel !== ids[0], "looking at a task changes nothing about it");
  } finally { w.cleanup(); }
});

// The chat block (who you talk to and their message, the text box, what just happened, the hints) ends on the
// window's last line, and the list has every line above it: at any height, through a resize, whatever the block holds.
test("the chat is pinned to the bottom of the window: tall, resized, and while the chat block grows or shrinks", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    for (let i = 1; i <= 230; i++) A.add(w.root, `Task number ${i}`);
    const s = open(w, { rows: 84, side: false });
    const chatOf = s.v.chatOf.bind(s.v);
    let said = "";
    s.v.chatOf = (r) => { const c = chatOf(r); return c && said ? { ...c, text: said, always: true } : c; };
    const pinned = (rows, what) => {
      s.v.tui.terminal.rows = rows; // the same open board: the window was resized under it
      const lines = s.screen(120), note = `${what}, ${rows} rows`;
      assert.equal(lines.length, rows, note); // one line per row of the window: nothing is left over below
      const last = lines.length - 1, said = s.v.msg ? 1 : 0;
      assert.match(lines[last], /^ {2}\S.* · /, note); // the hints are the last line
      const box = lines.findLastIndex((l) => /^❯/.test(l));
      assert.ok(box > 0, note); assert.match(lines[box - 1], /^─+$/, note);
      const rule = lines.findLastIndex((l) => /^─+$/.test(l));
      assert.equal(rule, last - 1 - said, note); // the text box sits right on the hints (and on what just happened)
      const head = lines.findIndex((l) => /^─+$/.test(l)); // where the chat block starts
      assert.match(lines[head + 1], /^ \S/, note); // who your words go to
      for (let n = head; n <= last; n++) assert.notEqual(lines[n].trim(), "", `${note}: an empty line inside the chat block`);
      const tasks = lines.slice(0, head).filter((l) => /Task number \d+/.test(l)).length;
      // Every spare line is the list's: with more tasks than fit, no line above the chat is empty but the one under the header.
      if (rows >= 16) assert.ok(tasks >= head - 4, `${note}: ${tasks} tasks in ${head} lines`);
      return { head, tasks };
    };
    const tall = pinned(84, "tall");
    assert.ok(tall.tasks > 70);
    for (const rows of [120, 200, 61, 84, 40, 24, 16, 12, 9, 58, 84]) pinned(rows, "resized");
    assert.deepEqual(pinned(84, "back to tall"), tall);
    // A longer message from the Coordinator: the block grows upwards, into the list.
    said = Array.from({ length: 6 }, (_, i) => `Line ${i + 1} of what it said.`).join("\n");
    const long = pinned(84, "long message");
    assert.equal(long.head, tall.head - 6); // its six lines
    for (const rows of [200, 30, 84]) pinned(rows, "long message, resized");
    // A draft that wraps: the box grows upwards too.
    s.type("word ".repeat(60));
    const draft = pinned(84, "wrapped draft");
    assert.ok(draft.head < long.head);
    for (const rows of [200, 20, 84]) pinned(rows, "wrapped draft, resized");
    // A message on the line of what just happened, then back to nothing at all: it shrinks back down.
    s.v.flash("Something just happened.", "yellow");
    pinned(84, "with a message"); pinned(140, "with a message, resized");
    s.v.msg = ""; s.v.setValue(""); said = "";
    assert.deepEqual(pinned(84, "shrunk back"), tall);
  } finally { w.cleanup(); }
});

// The same promise through the real screen: the library draws the board on a terminal that is resized under it, the
// way a window is. What reaches the terminal is checked, at narrow, normal, very wide and very tall sizes.
test("resizing the real screen keeps the chat on the last line and the working rows' columns at the right edge", async () => {
  const w = await world({ settings: { helper: "off" } });
  const { TuiAltScreen, visibleWidth } = await import("@earendil-works/pi-tui");
  let tui;
  try {
    A.add(w.root, "Pin the chat to the bottom");
    for (let i = 2; i <= 150; i++) A.add(w.root, `Task number ${i}`);
    let resized = () => {};
    const terminal = {
      columns: 120, rows: 34, kittyProtocolActive: false,
      start(_onInput, onResize) { resized = onResize; }, stop() {}, async drainInput() {}, write() {},
      moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
    };
    tui = new TuiAltScreen(terminal, { mouse: false });
    const v = new View(tui, theme, () => {}, { cwd: w.root, canReload: true });
    clearInterval(v.timer);
    v.side = false;
    // One task an agent works on: the bar, the percent, the minutes left, the PR number and the time are its columns on the right.
    const first = v.rows.find((row) => row.rec).rec;
    Object.assign(first, { title: "Pin the chat to the bottom", state: "working", msg: "Checking every window size.", progress: 55, eta: 12, pr: 3, at: Date.now() - 6 * 60000 });
    v.chatOf = () => ({ mark: "○", name: "Coordinator", word: "idle", color: "green", meta: "claude · default model · default effort", label: "last message", enter: true, said: true, always: true, notes: [], text: "Tasks 31 and 32 are both waiting." });
    tui.addChild(v); tui.setFocus(v); tui.start();
    const frame = async (columns, rows) => {
      terminal.columns = columns; terminal.rows = rows; resized(); // what a window resize does
      let lines = [];
      for (let n = 0; n < 100 && !(lines.length === rows && visibleWidth(lines[rows - 2]) === columns); n++) { await new Promise((r) => setTimeout(r, 10)); lines = tui.getScreenLines(); }
      return lines.map((l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, ""));
    };
    for (const [columns, rows] of [[120, 34], [190, 84], [435, 58], [412, 78], [50, 22], [50, 84], [435, 22], [300, 120], [40, 12], [435, 58], [120, 34]]) {
      const lines = await frame(columns, rows), note = `${columns}x${rows}`;
      assert.equal(lines.length, rows, note); // the whole window is drawn, to its last row
      for (const l of lines) assert.ok(visibleWidth(l) <= columns, `${note}: a line is wider than the window`);
      // The bottom: the hints on the last row, the text box with its rules right above them.
      assert.match(lines[rows - 1], /^ {2}\S/, note); assert.doesNotMatch(lines[rows - 1].trimEnd(), /·$/, note);
      assert.equal(lines[rows - 2], "─".repeat(columns), note); assert.match(lines[rows - 3], /^❯ /, note); assert.equal(lines[rows - 4], "─".repeat(columns), note);
      const head = lines.findIndex((l) => /^─+$/.test(l));
      for (let n = head; n < rows; n++) assert.notEqual(lines[n].trim(), "", `${note}: an empty line inside the chat block`);
      // Who you talk to: its keys end at the right edge, whole, never on a dangling separator.
      const who = lines[head + 1].trimEnd();
      assert.match(who, /^ ○ Coordinator/, note); assert.doesNotMatch(who, /·$/, note);
      if (columns >= 120) { assert.match(who, /alt\+c open its chat · esc hide its message$/, note); assert.ok(visibleWidth(who) >= columns - 1, note); }
      // The working row: its columns sit at the window's right edge, however wide the window is.
      const row = lines.find((l) => /Pin the chat to the bottom/.test(l)) || "";
      if (rows >= 20) assert.ok(row, `${note}: the working row is in view`);
      if (row && columns >= 120) { assert.match(row, /Checking every window size\. +█+░+ +55% 12m PR#3 {2}6m {4}$/, note); assert.equal(visibleWidth(row), columns, note); }
      else if (row) { assert.match(row, /6m *$/, note); if (columns >= 50) assert.match(row, /55% 12m PR#3 +6m *$/, note); }
      // All spare height is the list's.
      if (rows >= 20) assert.ok(lines.slice(0, head).filter((l) => /Task number \d+/.test(l)).length >= head - 6, `${note}: the list fills the space above the chat`);
    }
  } finally { try { tui?.stop(); } catch {} w.cleanup(); }
});

// The text box as the screen shows it: its rows without the prompt, how many rows it hides, and where the cursor is.
function draft(s, width) {
  const raw = s.v.render(width), lines = raw.map((l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, ""));
  const first = lines.findIndex((l) => l.startsWith("❯ ")), last = lines.findIndex((l, n) => n > first && /^─/.test(l));
  const at = raw.findIndex((l) => l.includes("\x1b_pi:c\x07"));
  const hidden = (l) => Number(l.match(/(\d+) more/)?.[1] || 0);
  return { lines, rows: lines.slice(first, last).map((l) => l.slice(2).trimEnd()), above: hidden(lines[first - 1]), below: hidden(lines[last]),
    cursor: [at - first, stripVTControlCharacters(raw[at].split("\x1b_pi:c\x07")[0]).length - 2] };
}

test("a draft longer than the text box wraps onto further lines, between words, and the box grows with it", async () => {
  const w = await world({ settings: { helper: "off", coordinator: "off" } });
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
      assert.match(d.lines.at(-1), /enter add a task/); // the hints stay under a tall box
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
  const w = await world({ settings: { helper: "off", coordinator: "off" } });
  try {
    A.add(w.root, "Some task");
    const words = Array.from({ length: 200 }, (_, i) => `word${i + 1}`).join(" ");
    for (const [rows, most] of [[30, 15], [12, 6], [8, 5]]) {
      const s = open(w, { rows });
      s.type(words);
      let d = draft(s, 40);
      assert.ok(d.rows.length <= most && d.rows.length >= Math.min(most, rows - 6), `${d.rows.length} rows of text in a window of ${rows}`);
      assert.equal(d.lines.length, rows); assert.match(d.lines.at(-1), /enter add a task/);
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
  const w = await world({ settings: { helper: "off", coordinator: "off" } });
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
  const w = await world({ settings: { helper: "off", coordinator: "off" } });
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
    assert.equal(d.rows.length, 15); assert.ok(d.above > 40); assert.equal(d.lines.length, 30); assert.match(d.lines.at(-1), /enter add a task/);
  } finally { w.cleanup(); }
});

test("a reply to a task's agent wraps in the same box, under the agent's latest message", async () => {
  const w = await world({ settings: { helper: "off", coordinator: "off" } });
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
    assert.ok(d.lines.some((l) => /Make f/.test(l)), "who the reply goes to still shows above the box");
  } finally { w.cleanup(); }
});

// herdr shows a pane at one size, the terminal behind it can be held at another: a second viewer attached to the
// same terminal sets its size, and herdr then shows a cut-out of it from the top left. Seen live: a terminal held at
// 435x58, shown in windows of 184x78 (empty below the hints) and 412x56 (the right-hand columns and the text box cut off).
test("a terminal held at another size than herdr shows: the board draws inside what is shown, and says what holds it", async () => {
  const { fitShown } = await import("../src/board/view.js");
  const { shownOf } = await import("../src/herdr.js");
  // What `herdr pane layout` answers, as measured on 0.9.3 next to the pane's own terminal size.
  const layout = (panes, zoomed = false, focused_pane_id = "w1:p1") => ({ area: { width: 124, height: 59, x: 0, y: 0 }, zoomed, focused_pane_id, panes: panes.map(([pane_id, width, height]) => ({ pane_id, rect: { width, height, x: 0, y: 0 } })) });
  assert.deepEqual(shownOf(layout([["w1:p1", 124, 59]]), "w1:p1"), { cols: 124, rows: 59, split: false });
  assert.deepEqual(shownOf(layout([["w1:p1", 124, 30], ["w1:p2", 124, 29]]), "w1:p2"), { cols: 124, rows: 29, split: true });
  assert.deepEqual(shownOf(layout([["w1:p1", 124, 30], ["w1:p2", 124, 29]], true), "w1:p1"), { cols: 124, rows: 59, split: true }); // zoomed: the whole tab
  // The pane beside it is the zoomed one: this one is hidden and keeps its place and its size, so nothing holds it.
  { const hidden = shownOf(layout([["w1:p1", 124, 30], ["w1:p2", 124, 29]], true, "w1:p2"), "w1:p1");
    assert.deepEqual(hidden, { cols: 124, rows: 30, split: true }); assert.equal(fitShown({ cols: 121, rows: 28 }, hidden).held, false); }
  assert.equal(shownOf(layout([["w1:p1", 124, 59]]), "w9:p9"), null); assert.equal(shownOf(null, "w1:p1"), null);
  // A terminal that fits what is shown is left alone: alone in its tab, beside other panes (borders), zoomed, or with no answer.
  for (const [cols, rows, shown] of [[184, 78, { cols: 184, rows: 78, split: false }], [123, 59, { cols: 124, rows: 59, split: false }], [121, 28, { cols: 124, rows: 30, split: true }], [121, 27, { cols: 124, rows: 29, split: true }], [121, 57, { cols: 124, rows: 59, split: true }], [120, 34, null]])
    assert.deepEqual(fitShown({ cols, rows }, shown), { cols, rows, held: false }, `${cols}x${rows}`);
  // Held wider and taller than shown: cut down to it. Held smaller: nothing to draw on beyond it, but it is said.
  assert.deepEqual(fitShown({ cols: 435, rows: 58 }, { cols: 412, rows: 56, split: false }), { cols: 411, rows: 56, held: true });
  assert.deepEqual(fitShown({ cols: 435, rows: 58 }, { cols: 184, rows: 78, split: false }), { cols: 183, rows: 58, held: true });
  assert.deepEqual(fitShown({ cols: 435, rows: 58 }, { cols: 124, rows: 30, split: true }), { cols: 121, rows: 28, held: true });
  // One row short is a gap below the hints too: nothing is let through as close enough.
  assert.equal(fitShown({ cols: 385, rows: 54 }, { cols: 386, rows: 55, split: false }).held, true);
  assert.equal(fitShown({ cols: 122, rows: 59 }, { cols: 124, rows: 59, split: false }).held, true);
  assert.equal(fitShown({ cols: 121, rows: 27 }, { cols: 124, rows: 30, split: true }).held, true);
  // Beside other panes the borders are inside herdr's rectangle: a terminal held at exactly that rectangle is too big.
  assert.deepEqual(fitShown({ cols: 386, rows: 28 }, { cols: 386, rows: 28, split: true }), { cols: 383, rows: 26, held: true });
  assert.deepEqual(fitShown({ cols: 124, rows: 59 }, { cols: 124, rows: 59, split: true }), { cols: 121, rows: 57, held: true });

  const w = await world({ settings: { helper: "off" } });
  try {
    for (let i = 1; i <= 150; i++) A.add(w.root, `Task number ${i}`);
    const s = open(w, { rows: 58, side: false });
    const first = s.v.rows.find((row) => row.rec).rec;
    Object.assign(first, { title: "Pin the chat to the bottom", state: "working", msg: "Checking every window size.", progress: 55, eta: 12, pr: 3, at: Date.now() - 6 * 60000 });
    s.v.chatOf = () => ({ mark: "○", name: "Coordinator", word: "idle", color: "green", meta: "claude · default model · default effort", label: "last message", enter: true, said: true, always: true, notes: [], text: "Tasks 31 and 32 are both waiting." });
    // Not held: the board is the terminal's size, as before.
    let lines = s.screen(435);
    assert.equal(lines.length, 58); assert.match(lines[57], /^ {2}\S/); assert.match(lines.find((l) => /Pin the chat/.test(l)), /55% 12m PR#3 {2}6m {4}$/); assert.doesNotMatch(lines.join("\n"), /Another viewer/);
    // Held at 435x58 while a 412x56 window shows it: everything is inside the 412x56 that can be seen.
    s.v.shown = { cols: 412, rows: 56, split: false };
    lines = s.screen(435);
    assert.equal(lines.length, 58); // the terminal is still filled: the rows nobody sees are empty
    assert.deepEqual(lines.slice(56).map((l) => l.trim()), ["", ""]);
    for (const l of lines) assert.ok(l.trimEnd().length <= 411, "nothing is drawn right of what is shown");
    assert.match(lines[55], /^ {2}\S.* · /); // the hints: the last row that is seen
    assert.match(lines[54], /^ {2}Another viewer holds this terminal at 435×58; herdr shows it at 412×56\. alt\+w takes it back\. *$/);
    assert.equal(lines[53], "─".repeat(411)); assert.match(lines[52], /^❯ /); assert.equal(lines[51], "─".repeat(411));
    const row = lines.find((l) => /Pin the chat/.test(l));
    assert.match(row, /Checking every window size\. +█+░+ +55% 12m PR#3 {2}6m {4}$/); assert.equal(row.length, 411); // the columns are back in view
    assert.match(lines.find((l) => /^ ○ Coordinator/.test(l)).trimEnd(), /alt\+c open its chat · esc hide its message$/); // whole, not cut after the dot
    // Held at 435x58 while a taller, narrower window shows it: the width is cut down, the rows are all there are.
    s.v.shown = { cols: 184, rows: 78, split: false };
    lines = s.screen(435);
    assert.equal(lines.length, 58); assert.match(lines[57], /^ {2}\S.* · /); assert.match(lines[56], /Another viewer holds this terminal at 435×58; herdr shows it at 184×78/);
    for (const l of lines) assert.ok(l.trimEnd().length <= 183);
    assert.match(lines.find((l) => /Pin the chat/.test(l)), /55% 12m PR#3 {2}6m {4}$/);
    // The board takes its terminal back by itself: seen held twice in a row, the other viewer is disconnected and herdr
    // gives the terminal the window's size, so the chat is on the window's last row again with no key pressed.
    {
      const a = open(w, { rows: 58, side: false }), took = [];
      Object.assign(a.v.tui.terminal, { columns: 435 }); a.v.ctx.pane = "w1:p1";
      let comesBack = false;
      a.v.ctx.takeTerminal = (socket, pane, size) => { took.push([pane, size]); if (!comesBack) Object.assign(a.v.tui.terminal, { columns: 184, rows: 78 }); };
      const tall = { cols: 184, rows: 78, split: false };
      a.v.seeShown(tall); assert.deepEqual(took, []); // once is a resize under way
      assert.match(a.screen(435).join("\n"), /Another viewer holds this terminal at 435×58; herdr shows it at 184×78\. alt\+w takes it back\./);
      a.v.seeShown(tall); assert.deepEqual(took, [["w1:p1", { cols: 183, rows: 58 }]]);
      a.v.seeShown(tall);
      let l = a.screen(184);
      assert.equal(l.length, 78); assert.match(l[77], /^ {2}\S.* · /); assert.equal(l[75], "─".repeat(184));
      assert.match(l[76], /Another viewer held this terminal at 435×58: it was disconnected, and your window has it again\./);
      // A viewer that comes back is sent away again, every time: the board has its pane's size, always.
      for (let round = 2; round <= 4; round++) {
        Object.assign(a.v.tui.terminal, { columns: 435, rows: 58 });
        a.v.seeShown(tall); assert.equal(took.length, round - 1);
        assert.match(a.screen(435)[56], /Another viewer holds this terminal at 435×58; herdr shows it at 184×78\. alt\+w takes it back\./); // what is true now, not what was done before
        a.v.seeShown(tall); assert.equal(took.length, round);
        l = a.screen(184); assert.equal(l.length, 78); assert.match(l[77], /^ {2}\S.* · /); assert.doesNotMatch(l.join("\n"), /holds this terminal/);
      }
      // A try that fails is made again at every look, and says so; when herdr answers again the window is back.
      let fails = true; const tries = [];
      const c = open(w, { rows: 58, side: false });
      Object.assign(c.v.tui.terminal, { columns: 435 }); c.v.ctx.pane = "w1:p1";
      c.v.ctx.takeTerminal = () => { tries.push(fails); if (fails) throw new Error("herdr did not answer"); Object.assign(c.v.tui.terminal, { columns: 184, rows: 78 }); };
      for (let n = 0; n < 5; n++) c.v.seeShown(tall);
      assert.deepEqual(tries, [true, true, true, true]);
      assert.match(c.screen(435)[56], /Another viewer holds this terminal at 435×58; herdr shows it at 184×78\. Taking it back failed \(herdr did not answer\): trying again\./);
      fails = false; c.v.seeShown(tall); c.v.seeShown(tall);
      assert.deepEqual(tries, [true, true, true, true, false]);
      l = c.screen(184); assert.equal(l.length, 78); assert.match(l[77], /^ {2}\S.* · /); assert.match(l[76], /it was disconnected, and your window has it again/);
      // `ownTerminal` off: the other viewer stays. The board draws inside what both see, says so, and alt+w is the way.
      const d = open(w, { rows: 58, side: false }), never = [];
      Object.assign(d.v.tui.terminal, { columns: 435 }); d.v.ctx.pane = "w1:p1"; d.v.ctx.ownTerminal = false; d.v.ctx.takeTerminal = (...x) => never.push(x);
      for (let n = 0; n < 5; n++) d.v.seeShown(tall);
      assert.deepEqual(never, []); assert.match(d.screen(435)[56], /Another viewer holds this terminal at 435×58; herdr shows it at 184×78\. alt\+w takes it back\./);
      delete d.v.ctx.ownTerminal; // the setting itself: on unless turned off
      d.v.seeShown(tall); assert.equal(never.length, 1);
      S.setConfig("ownTerminal", false); d.v.seeShown(tall); d.v.seeShown(tall); assert.equal(never.length, 1);
      S.setConfig("ownTerminal", true);
      // Sizes that agree never take anything, and a transient disagreement that is gone at the next look does not either.
      const b = open(w, { rows: 78, side: false }), none = [];
      b.v.tui.terminal.columns = 184; b.v.ctx.pane = "w1:p1"; b.v.ctx.takeTerminal = (...x) => none.push(x);
      for (const shown of [tall, tall, { cols: 150, rows: 60, split: false }, tall, { cols: 150, rows: 60, split: false }, tall, null, null]) b.v.seeShown(shown);
      assert.deepEqual(none, []);
    }
    // alt+w takes the terminal back, also in the middle of a draft: the other viewer is disconnected, and herdr gives
    // the terminal the size of your window, so the chat is on its last row again. Nothing does this by itself.
    const taken = [];
    s.v.tui.terminal.columns = 435; s.v.ctx.pane = "w1:p1"; s.v.ctx.takeTerminal = (socket, pane, size) => { taken.push([pane, size]); Object.assign(s.v.tui.terminal, { columns: 184, rows: 78 }); };
    s.v.askShown = () => {};
    s.type("half a draft"); s.screen(435); assert.deepEqual(taken, []);
    s.press("\x1bw");
    assert.deepEqual(taken, [["w1:p1", { cols: 183, rows: 58 }]]); assert.equal(s.v.value(), "half a draft");
    s.v.setValue("");
    lines = s.screen(184);
    assert.equal(lines.length, 78); assert.match(lines[77], /^ {2}\S.* · /); assert.match(lines[76], /Taken back: the other viewer was disconnected\./); assert.doesNotMatch(lines.join("\n"), /Another viewer/);
    s.press("\x1bw"); assert.equal(taken.length, 1); // not held: the key is not the board's
    s.v.msg = "";
    // The other viewer went away: herdr and the terminal agree again, and the note is gone.
    s.v.tui.terminal.rows = 78; s.v.shown = { cols: 184, rows: 78, split: false };
    lines = s.screen(184);
    assert.equal(lines.length, 78); assert.match(lines[77], /^ {2}\S.* · /); assert.equal(lines[76], "─".repeat(184)); assert.doesNotMatch(lines.join("\n"), /Another viewer/);
  } finally { w.cleanup(); }
});

test("a terminal held at another view's size is told from herdr's own window, a zoomed pane and a frame's width", async () => {
  const { heldSize, holders } = await import("../src/board/held.js");
  const layout = (rect, more = {}) => ({ area: { x: 0, y: 0, width: 184, height: 78 }, zoomed: false, focused_pane_id: "w1:p1", panes: [{ pane_id: "w1:p1", rect: { x: 0, y: 0, ...rect } }, { pane_id: "w1:p2", rect: { x: 92, y: 0, width: 92, height: 78 } }], ...more });
  const whole = { width: 184, height: 78 }, half = { width: 92, height: 78 };
  // What herdr 0.9.3 gives a pane: its place, less a scrollbar column, less a frame when the tab is split.
  assert.equal(heldSize({ columns: 183, rows: 78 }, layout(whole), "w1:p1"), null);
  assert.equal(heldSize({ columns: 89, rows: 76 }, layout(half), "w1:p1"), null);
  // The incident: 435x58 in a pane herdr's window has 184x78 for. Wider or taller than its place is always another view's.
  assert.deepEqual(heldSize({ columns: 435, rows: 58 }, layout(whole), "w1:p1"), { columns: 435, rows: 58, room: { columns: 184, rows: 78 } });
  assert.ok(heldSize({ columns: 183, rows: 50 }, layout(whole), "w1:p1"));
  assert.ok(heldSize({ columns: 100, rows: 76 }, layout(half), "w1:p1"));
  // A zoomed pane has the whole tab, whatever its place in the split.
  assert.equal(heldSize({ columns: 181, rows: 76 }, layout(half, { zoomed: true }), "w1:p1"), null);
  // Its old place in the split is not its size while it is zoomed: 89x76 there is another view's.
  assert.deepEqual(heldSize({ columns: 89, rows: 76 }, layout(half, { zoomed: true }), "w1:p1"), { columns: 89, rows: 76, room: { columns: 184, rows: 78 } });
  // The pane beside a zoomed one keeps its place.
  assert.equal(heldSize({ columns: 89, rows: 76 }, layout(half, { zoomed: true }), "w1:p2"), null);
  assert.ok(heldSize({ columns: 181, rows: 76 }, layout(half, { zoomed: true }), "w1:p2"));
  assert.deepEqual(heldSize({ columns: 300, rows: 76 }, layout(half, { zoomed: true }), "w1:p1").room, { columns: 184, rows: 78 });
  // Nothing known, nothing said.
  assert.equal(heldSize({ columns: 435, rows: 58 }, null, "w1:p1"), null);
  assert.equal(heldSize({ columns: 435, rows: 58 }, layout(whole), "w9:p9"), null);
  assert.equal(heldSize({}, layout(whole), "w1:p1"), null);
  // Who holds it: the attach processes for this very terminal, the oldest first.
  const ps = ["  100   2400 /home/u/.local/bin/herdr terminal attach term_aa", "  101     30 herdr terminal attach --takeover term_aa", "  102     99 herdr terminal attach term_bb", "  103     50 bash -c echo herdr terminal attach term_aa", "  104      5 herdr server",
    "  105    600 herdr --session work terminal attach term_aa", "  106      7 /usr/bin/herdr --session work terminal session observe term_aa", "  107      8 herdr --session terminal attach term_cc", "  108    300 herdr --session terminal terminal attach term_aa",
    // Another terminal's viewer, in a session named like this terminal: never the one to stop.
    "  109   9000 herdr --session term_aa terminal attach term_zz", "  110   9001 herdr --session=term_aa terminal attach term_zz", "  111     20 herdr terminal attach term_aa --session work", "  112   9002 herdr terminal session observe term_aa"].join("\n");
  assert.deepEqual(holders("term_aa", ps), [{ pid: 100, seconds: 2400 }, { pid: 105, seconds: 600 }, { pid: 108, seconds: 300 }, { pid: 101, seconds: 30 }, { pid: 111, seconds: 20 }]);
  assert.deepEqual(holders("term_zz", ps), [{ pid: 110, seconds: 9001 }, { pid: 109, seconds: 9000 }]);
  assert.deepEqual(holders("", ps), []);
});

test("the board says so, top left, when another view holds its pane's size, and stops when the size is its own again", async () => {
  const w = await world({ settings: { helper: "off" } });
  const tmux = process.env.TMUX;
  try {
    A.add(w.root, "A task");
    w.patchState((s) => { s.workspaces.push({ workspace_id: "w1", label: "b", cwd: w.root }); s.panes.push({ pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", terminal_id: "term_board", cwd: w.root, agent: null }); });
    Object.assign(process.env, { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" });
    delete process.env.TMUX; delete process.env.HERDR_PLUGIN_ID;
    const s = open(w, { rows: 58 });
    const head = () => s.screen(120)[0];
    // The fake pane has 120x34 in herdr's window, the terminal says 120x58: one look is not enough (a resize under way).
    assert.doesNotMatch(s.text(120), /Held at/);
    s.v.lookHeld();
    assert.match(head(), /^ ! Held at 120×58: closing its remote view frees it\. Drawn for a remote view/);
    assert.equal(s.screen(120).length, 58);
    assert.match(s.screen(120)[1], /herdr-superwork/); // the header and the list move down one line, nothing else changes
    assert.match(s.screen(435)[0], /so herdr's own window \(120×34\) shows it cut off or half empty\s*$/);
    assert.match(s.screen(60)[0], /^ ! Held at 120×58: closing its remote view frees/); // what to do survives a narrow window
    // The same line over the whole task and the menu.
    s.press("ctrl+e"); assert.match(head(), /Held at/); s.press("esc");
    // Named with its process when one holds this terminal.
    s.v.held = { ...s.v.held, by: [{ pid: 4242, seconds: 2400 }] };
    assert.match(s.screen(435)[0], /half empty · herdr terminal attach, open 40m\s*$/);
    for (const width of [40, 90, 94]) assert.match(s.screen(width)[0], /^ ! Held at 120×58: kill 4242 frees it\./, `at ${width}`);
    // The size is the window's again: gone at the next look.
    s.v.tui.terminal.rows = 34;
    s.v.lookHeld();
    assert.doesNotMatch(s.text(120), /Held at/);
    // A new size held: again only after a second look.
    s.v.tui.terminal.columns = 300; s.v.lookHeld();
    assert.doesNotMatch(s.text(120), /Held at/);
    s.v.lookHeld();
    assert.match(head(), /Held at 300×34/);
    // Not in the popup (no pane of its own) and not in a tmux inside the pane.
    for (const k of ["HERDR_PLUGIN_ID", "TMUX"]) { process.env[k] = "x"; s.v.lookHeld(); s.v.lookHeld(); assert.equal(s.v.held, null, k); delete process.env[k]; }
    // A window too short for it keeps the text box and its hints.
    s.v.lookHeld(); s.v.lookHeld(); assert.ok(s.v.held);
    s.v.tui.terminal.rows = 8;
    assert.equal(s.screen(120).length, 8);
    assert.match(s.screen(120)[7], /\S/);
  } finally { for (const k of ["HERDR_ENV", "HERDR_PANE_ID", "HERDR_PLUGIN_ID", "TMUX"]) delete process.env[k]; if (tmux) process.env.TMUX = tmux; w.cleanup(); }
});
