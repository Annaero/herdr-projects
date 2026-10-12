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
const KEY = { enter: "\r", tab: "\t", esc: "\x1b", space: " ", right: "\x1b[C", down: "\x1b[B", up: "\x1b[A", "ctrl+a": "\x01", "ctrl+e": "\x05", "ctrl+x": "\x18", "ctrl+t": "\x14", "ctrl+r": "\x12", "ctrl+y": "\x19", "ctrl+g": "\x07", "ctrl+z": "\x1a", "ctrl+b": "\x02", "ctrl+f": "\x06", "ctrl+s": "\x13", "alt+a": "\x1ba", "alt+h": "\x1bh", "ctrl+d": "\x04", delete: "\x1b[3~" };
function open(w, { rows = 34 } = {}) {
  let closed;
  const tui = { terminal: { rows, columns: 120 }, requestRender() {}, stop() {}, start() {} };
  const v = new View(tui, theme, (x) => { closed = x ?? null; }, { cwd: w.root, canReload: true });
  clearInterval(v.timer);
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
    const s = open(w);
    s.v.sel = big.id; s.v.load();
    let text = s.text(120);
    assert.match(text, /│ {2}Long one/); assert.match(text, /Line 1 of a very long/);
    assert.match(text, /│ {2}more: ctrl\+e shows the whole panel/); // the pointer is the panel's last line, not its first
    assert.doesNotMatch(text, /Line 80 of/);
    // A setting shows beside the list only when this task differs from your defaults in it.
    for (const fact of ["Project", "Permissions", "Worktree", "Agent", "Reviewer", "Watcher"]) assert.doesNotMatch(text, new RegExp(`│  ${fact} `), fact);
    S.setTaskConfig(big.id, "model", "opus"); s.v.load();
    text = s.text(120);
    assert.match(text, /│ {2}Agent {2}\S+ · opus · default effort/); assert.doesNotMatch(text, /│ {2}Reviewer /);
    // The whole panel: the same panel full screen, scrolled, with every setting at its end.
    s.press("ctrl+e");
    assert.equal(s.v.full, true);
    assert.match(s.text(120), /^ task panel · proj\/2 {2}· {2}lines 1–\d+ of \d+/);
    s.v.panelTop = 1e9; text = s.text(120);
    assert.match(text, /Line 80 of/); assert.match(text, /\n Settings/);
    for (const fact of ["Project", "Permissions", "Worktree", "Agent", "Reviewer", "Watcher"]) assert.match(text, new RegExp(`\\n ${fact} `), fact);
    assert.match(text, /opus · default effort \*/); assert.match(text, /\* this task's own, not your default/);
    s.press("up"); assert.ok(s.v.panelTop < s.v.panelLength); assert.equal(s.v.sel, big.id); // the arrows scroll the panel, they do not move the selection
    s.press("esc"); assert.equal(s.v.full, false);
    s.v.sel = "proj/1"; s.v.load();
    text = s.text(120);
    assert.match(text, /Brief\./);
    assert.doesNotMatch(text, /shows the whole panel/); // a short one is left alone
    assert.doesNotMatch(text, /None\./); // and nothing is an empty box
  } finally { w.cleanup(); }
});

test("the board: one header line, the five groups, a symbol for each state, the task panel from 90 columns", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    A.add(w.root, "Write the docs", { description: "All of them." });
    const b = A.add(w.root, "My own task"); A.report(b.id, { state: "working", msg: "half way", progress: 50 });
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
    }
    // A row does not repeat its heading ("idle" under "to do"), and its time says which kind it is.
    assert.match(text, /\n working +│/); assert.match(text, /\n to do +│/);
    assert.match(text, /◐ My own task {2}half way +█+░+ +50% +\ds {5}│/); assert.match(text, /○ Write the docs {6,}\ds ago │/);
    assert.match(text, /│ {2}My own task/); assert.match(text, /◐ working · you · for \ds · proj\/2/);
    // The text box names who gets your words, and its empty line says only "what's next?".
    assert.match(text, /\nnew task ❯ what's next\? *\n/); assert.doesNotMatch(text, /Coordinator|sidebar/);
    assert.equal(s.screen(120).length, 34); assert.ok(s.screen(120).every((l) => l.length <= 120));
    assert.ok(!/│ {2}My own task/.test(s.text(80)), "no panel beside the list below 90 columns");
    // ctrl+b is herdr's own prefix key: the board has no use for it, the panel simply follows the width.
    s.press("ctrl+b"); assert.match(s.text(120), /│ {2}My own task/); assert.equal(s.v.value(), "");
    s.press("down", "ctrl+e");
    text = s.text(80);
    assert.match(text, /^ task panel · proj\/1/); assert.match(text, /○ to do · \ds ago · proj\/1/); assert.match(text, /Description *\n All of them\./);
    assert.match(text, /reply to "Write the docs" ❯ your message starts an agent on it/); // the whole panel holds the text box for its task
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
    assert.match(text, /│ {2}✗ needs you · \ds ago · proj\/1 *\n[^\n]*│ *\n[^\n]*│ {2}Merge conflict with main/); assert.match(text, /│ {2}Next step/); assert.match(text, /│ {2}What went wrong *\n[^\n]*│ {2}Conflicting files:/);
    // Narrow, space opens the same panel full screen, with the text box naming the task; space or esc closes it.
    s.screen(80); s.press("space"); text = s.text(80);
    assert.equal(s.v.full, true); assert.equal(s.v.reply, true);
    assert.match(text, /^ task panel · proj\/1/); assert.match(text, /Merge conflict with main/); assert.match(text, /Conflicting files: *\n src\/board\/view\.js/);
    assert.match(text, /reply to "Match the colors" ❯/);
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
    assert.match(s.text(), /\nnew task ❯ Add a greeting/); assert.match(s.text(), /enter add a task · tab add it and start an agent · esc put away/);
    s.press("enter");
    assert.equal(S.get("proj/1").title, "Add a greeting"); assert.equal(s.v.sel, "proj/1"); assert.equal(s.v.value(), "");
    assert.match(s.text(), /\n {2}tab put an agent on it · space reply · \? more/);
    s.press("right"); assert.match(s.text(), /No agent has been on this yet/);
    s.press("tab");
    await settle("proj/1"); s.v.load();
    assert.match(s.text(), /\n working +│[^\n]*\n ◐ Add a greeting/);
    assert.match(s.text(), /│ {2}On its screen now *\n[^\n]*│ {2}● Editing greet\.sh/); // the panel shows what the agent is doing
    assert.match(s.text(), /\n {2}enter open the agent · space reply · ctrl\+x stop · \? more/);
    // space: the text box now belongs to this task's agent, and says so for as long as you type
    s.press("space");
    assert.match(s.text(), /\nreply to "Add a greeting" ❯ your reply/);
    w.script({ worker: [{ status: "working" }] });
    s.type("also say goodbye");
    assert.match(s.text(), /\nreply to "Add a greeting" ❯ also say goodbye/); assert.match(s.text(), /enter send to its agent · esc put away/);
    s.press("enter");
    assert.match(s.text(), /Sent to the agent/);
    const t = S.get("proj/1");
    assert.match(w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts.at(-1), /also say goodbye/);
    s.press("esc"); assert.equal(s.v.reply, false); assert.match(s.text(), /\nnew task ❯/);
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
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f." }], reviewer: [{ verdict: { score: 4, recommend: true, text: "Good." } }] });
    const id = A.add(w.root, "Make f").id; A.add(w.root, "Other");
    A.delegate(id); await settle(id);
    const s = open(w);
    s.v.sel = id; s.v.load();
    s.type("half a thought");
    const before = JSON.stringify([S.get(id).stage, S.get(id).pinned, S.get(id).archivedAt, S.list().length]);
    for (const k of ["ctrl+a", "ctrl+e", "ctrl+y", "ctrl+r", "ctrl+g", "ctrl+t", "ctrl+d", "ctrl+x", "ctrl+x", "ctrl+b", "ctrl+f", "ctrl+s", "alt+a", "alt+h", "\x1bc", "\x1bv", "ctrl+z", "?", "space", "up", "down"]) s.press(k);
    assert.equal(JSON.stringify([S.get(id).stage, S.get(id).pinned, S.get(id).archivedAt, S.list().length]), before, "nothing happened to any task");
    assert.equal(s.v.sel, id); assert.equal(s.v.ask, null); assert.equal(s.v.menu, null); assert.equal(s.v.full, false); assert.equal(s.v.mode, "new"); assert.equal(s.v.archiveView, false); assert.equal(s.v.allDone, false); assert.equal(s.v.byRepo, false); assert.equal(s.v.drawer, "hidden"); assert.equal(s.v.msg, "");
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
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f." }], reviewer: [{ verdict: { score: 4, recommend: true, text: "Good." } }] });
    const id = A.add(w.root, "Make f").id; A.add(w.root, "Other");
    A.delegate(id); await settle(id);
    const s = open(w);
    s.v.sel = id; s.v.load();
    // Finished, reviewed work is good news: its own group, the reviewer's advice in words, no "approve to merge?" on every row.
    assert.match(s.text(80), /\n ready to approve *\n ✓ Make f {2}4\/5 reviewer says yes +\ds ago *\n/); assert.doesNotMatch(s.text(80), /blocked|approve to merge|r1/);
    let text = s.text();
    assert.match(text, /│ {2}✓ ready to approve · claude · \ds ago/);
    assert.match(text, /│ {2}Reviewer {3}4\/5, says merge *\n[^\n]*│ {13}Good\./); assert.match(text, /│ {2}Change {5}1 file, \+1 −0/); assert.match(text, /│ {2}The agent said *\n[^\n]*│ {2}Made f\./);
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
      s.press("esc"); assert.equal(s.v.reply, false); assert.match(s.text(width), /\nnew task ❯/);
      s.press("down"); assert.notEqual(s.v.sel, id);
      s.press("ctrl+z");
      assert.equal(s.v.sel, id); assert.equal(s.v.reply, true); assert.equal(s.v.full, width < 90);
      assert.match(s.text(width), /\nreply to "Add a greeting" ❯ also say goodbye/);
      w.script({ worker: [{ status: "working" }] });
      const before = S.list().length;
      s.press("enter");
      assert.equal(S.list().length, before, "no new task was filed");
      assert.match(w.state().panes.find((p) => p.pane_id === S.get(id).link.pane).agent.prompts.at(-1), /also say goodbye/);
      s.press("esc"); if (s.v.reply || s.v.full) s.press("esc");
    }
    // a new task that was put away comes back as a new task, also when you are replying to something by then
    s.screen(120); s.type("buy milk"); s.press("esc", "space"); assert.equal(s.v.reply, true);
    s.press("ctrl+z"); assert.equal(s.v.reply, false); assert.match(s.text(), /\nnew task ❯ buy milk/);
    s.press("esc");
    // the task a reply was for is gone: the words stay put away rather than go somewhere else
    const gone = A.add(w.root, "Short lived").id; s.v.sel = gone; s.v.load();
    s.press("space"); s.type("for the short lived one"); s.press("esc", "esc");
    await A.clear(gone); s.v.load();
    s.press("ctrl+z"); assert.equal(s.v.value(), ""); assert.match(s.text(), /The task that reply was for is gone\. ctrl\+z again brings the words back as a draft for a new task\./);
    s.press("ctrl+z"); assert.match(s.text(), /\nnew task ❯ for the short lived one/); assert.equal(s.v.reply, false); // asked for, so never lost and never a surprise
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
    s5.press("ctrl+z"); assert.equal(s5.v.sel, id); assert.match(s5.text(), /\nreply to "Add a greeting" ❯ kept across a reload/);
    // and so does a reply still in the text box when the board is closed from outside
    s5.v.dispose();
    const s6 = open(w); assert.equal(s6.v.value(), ""); s6.press("ctrl+z");
    assert.match(s6.text(), /\nreply to "Add a greeting" ❯ kept across a reload/);
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
    A.add(w.root, "build a login page");
    // the watcher: only while herdr says working; 100k auto-compact on the watcher only
    w.script({ worker: [{ status: "working", screen: "● Writing greet.sh\n" }] });
    A.delegate("proj/1"); await settle("proj/1");
    H.watchTick(F.board());
    for (let i = 0; i < 60 && !S.get("proj/1").watch; i++) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual([S.get("proj/1").watch.msg, S.get("proj/1").watch.progress], ["editing the greeting file", 42]);
    const shown = F.board().find((t) => t.id === "proj/1");
    assert.deepEqual([shown.note, shown.progress], ["editing the greeting file", 42]);
    assert.ok(w.state().metadata.some((m) => m.args.join(" ").includes("summary=editing the greeting file")));
  } finally { delete process.env.HERDR_SUPERWORK_HELPER_CMD; w.cleanup(); }
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
  assert.match(page(redPr), /× needs you · claude · 0s ago · proj\/1\n\n Pull request checks failed/); assert.doesNotMatch(page(redPr), /ready to approve/);
  v.reply = false; v.full = false; v.menu = null; v.ask = null; v.mode = "new"; v.drawer = "hidden"; v.input = { getText: () => "" }; v.jobs = []; v.sel = "";
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
    assert.ok(reviewed.includes(`${mauve}◐`) && reviewed.includes(`${mauve} 50%`) && reviewed.includes(`${mauve}█`) && reviewed.includes(`${mauve}review`) && !reviewed.includes(yellow));
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
  assert.match(page(failedMerge), /× needs you · 2nd review · claude · 0s ago · proj\/1/); assert.match(page(failedMerge), /Reviewer {3}5\/5, says merge \(2nd review\)/);
  // behind main and not brought up to date yet: neither the row nor the panel say it is ready
  const behind = { ...pr, summary: "Did the work.", syncBlocked: { why: "main could not be fetched (network is down)" }, msg: "Behind main, and not up to date yet: main could not be fetched (network is down). The board keeps trying; it cannot be approved until then." };
  assert.match(row(behind, 120), /^ × Build a flying game {2}Behind main, and not up to date yet/);
  assert.match(page(behind), /Behind main, cannot be approved yet/); assert.match(page(behind), /main could not be fetched \(network is down\)/); assert.doesNotMatch(page(behind), /ready to approve/);
  // the panel, in the order you need it: where it stands, the reviewer, the change, what the agent said
  const ready = page({ ...second, summary: "Did the work.", said: "Built Skylark.", stat: " 4 files changed, 120 insertions(+), 31 deletions(-)" });
  assert.match(ready, /^\n Build a flying game\n ✓ ready to approve · 2nd review · claude · 0s ago · proj\/1\n\n Reviewer {3}3\/5, says don't merge \(2nd review\)\n {12}Crashes\.\n\n Change {5}4 files, \+120 −31 · PR#12 ✓\n {12}https:\/\/github\.com\/a\/b\/pull\/12\n\n The agent said\n Built Skylark\./);
  assert.doesNotMatch(ready, /Description|None\.|Permissions|Watcher/);
  assert.match(page({ ...second, summary: "Did the work." }, true), /\n Settings\n Project /); // every setting, at the end of the whole panel
  assert.match(row({ ...second, stage: "merging", state: "working", kind: undefined, msg: "merging" }, 120), /^ ◐ Build a flying game {2}merging +PR#12 ✓ {2}0s$/);
  assert.doesNotMatch(row({ ...second, state: "done", stage: "done" }, 120), /review|3\/5/);
  // while the reviewer works the row's sentence starts with the word, and says which review from the second on
  const under = { ...working, stage: "reviewing", reviewRound: 3, msg: "Running the tests." };
  assert.match(row(under, 120), /^ ◐ Other {2}review \(3rd\) · Running the tests\. +█+░+ +50% +0s$/);
  assert.match(row({ ...under, reviewRound: 1 }, 120), /^ ◐ Other {2}review · Running the tests\. /);
  assert.match(row({ ...under, reviewRound: 1, msg: "under review" }, 120), /^ ◐ Other {2}review +█/);
  assert.match(row(under, 30), /^ ◐ Other {2}review +50% +0s$/); // always the word "review" first, whichever review it is
  assert.match(row({ ...under, stage: "reviewneeds", state: "blocked", progress: undefined, msg: "the reviewer shows a dialog" }, 120), /^ × Other {2}the reviewer shows a dialog +0s ago$/);
  assert.doesNotMatch(row({ ...working, reviewRound: 3 }, 120), /review/); // back with the agent: no review is running
  assert.match(page(under), /◐ reviewer is working · 3rd review · for 0s · proj\/2/);
  // another row's long sentence or progress does not take the verdict away
  assert.match(row(pr, 80, [pr, working]), /^ ✓ Build a flying game {2}3\/5 reviewer says no +PR#12 ✓ {2}0s ago$/);
  for (const width of [24, 30, 40, 60, 80, 120]) for (const r of [pr, plain, base]) {
    const line = row(r, width, [r, working]);
    assert.ok(line.length <= width, `fits ${width}`); assert.ok(!/Skylark|\*\*|Reviewed|approve to merge/.test(line)); assert.match(line, /^ \S Build a flying game/);
  }
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
