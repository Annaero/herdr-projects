// The task list: the header, the groups, the done list. Also what the second UI/UX check asked of the list: failed-review work under needs you, typed words that keep who they are for, the mark on the selected row, the cut note and the header.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { here, open } from "./board-helpers.js";
import { stripVTControlCharacters } from "node:util";
import * as F from "../src/flow.js";
import { groupOf, standing } from "../src/board/view/states.js";
import { sidebarWords } from "../src/status-words.js";
import { sizeFor } from "../src/board/popup.js";

test("the board: one header line, the five groups, a symbol for each state, the task panel from 90 columns", async () => {
  const w = await world();
  try {
    A.add(w.root, "Write the docs", { description: "All of them." });
    const b = A.add(w.root, "My own task"); A.report(b.id, { state: "working", msg: "half way", progress: 50, eta: 12.4 });
    // A report with only one of the two keeps the other; minutes alone, on a task with no percent, are kept too.
    A.report(b.id, { state: "working", msg: "half way", eta: 12 }); assert.deepEqual(S.get(b.id).watch, { progress: 50, eta: 12 });
    A.report(b.id, { state: "working", msg: "half way", progress: 50 }); assert.deepEqual(S.get(b.id).watch, { progress: 50, eta: 12 });
    const s = open(w);
    let text = s.text(120);
    // One header line, then the list.
    assert.match(text, /^ herdr-superwork {2}proj · 1 working · 1 to do +│ *\n +│/); // where you are and how many tasks stand where: no folder path assert.doesNotMatch(text, /work board for herdr|\d (blocked|idle|working)/);
    // Every line is in herdr's text colour (Catppuccin's here), unless colours are switched off. Each task's mark is
    // a symbol of its own in its group's colour (working yellow, to do grey), and its title stays plain text.
    const raw = s.v.render(120), text0 = "\x1b[38;2;205;214;244m", yellow = "\x1b[38;2;249;226;175m", grey = "\x1b[38;2;126;131;155m";
    assert.ok(raw.every((l) => (process.env.NO_COLOR ? !l.includes("\x1b[38;2;") : l.startsWith(text0))));
    if (!process.env.NO_COLOR) {
      assert.ok(raw.some((l) => l.includes(`${yellow}◐\x1b[39m${text0} ${grey}#2\x1b[39m${text0} \x1b[1mMy own task\x1b[22m `)), "a working task's mark is the working colour, its title plain text");
      assert.ok(raw.some((l) => l.includes(`${grey}○\x1b[39m${text0} ${grey}#1\x1b[39m${text0} Write the docs `)), "a task nobody started is grey, not green");
      assert.ok(raw.some((l) => l.includes(`${yellow}working\x1b[39m`)) && raw.some((l) => l.includes(`${grey}to do\x1b[39m`)), "the headings are in their group's colour");
      assert.ok(raw.some((l) => l.includes(`${yellow}50%`)), "progress is in the working colour while working");
      assert.ok(raw.some((l) => l.includes(`${yellow}50%\x1b[39m${text0} ${yellow}12m left\x1b[39m`)), "the minutes left sit right of the percent, in the same colour");
    }
    // A row does not repeat its heading ("idle" under "to do"), and its time says which kind it is.
    assert.match(text, /\n working +│/); assert.match(text, /\n to do +│/);
    assert.match(text, /◐ #2 My own task +█+░+ +50% 12m left +\ds {5}│[^\n]*\n[ ▌] {5}half way +│/); assert.match(text, /│ {2}Progress {5}█+░+ 50% · 12m left *\n/); // on the row and in the task panel assert.match(text, /○ #1 Write the docs {6,}\ds ago │/);
    assert.match(text, /│ {2}#2 My own task/); assert.match(text, /│ {2}State {8}◐ working · for \ds *\n/); assert.match(text, /│ {2}On it {8}you *\n/);
    // The text box names who gets your words, and its empty line says only "Add a task".
    assert.match(text, /\n *\n \+ New task {2}[^\n]*\n─[^\n]*\n❯ Add a task *\n/); assert.doesNotMatch(text, /Coordinator|sidebar/);
    assert.equal(s.screen(120).length, 34); assert.ok(s.screen(120).every((l) => l.length <= 120));
    assert.ok(!/│ {2}#2 My own task/.test(s.text(80)), "no panel beside the list below 90 columns");
    // ctrl+b is herdr's own prefix key: the board has no use for it.
    s.press("ctrl+b"); assert.match(s.text(120), /│ {2}#2 My own task/); assert.equal(s.v.value(), "");
    // alt+p closes the side panel and opens it again: closed, the list has the whole width.
    s.press("alt+p"); text = s.text(120);
    assert.equal(s.v.side, false); assert.doesNotMatch(text, /│/); assert.match(text, /◐ #2 My own task {70,}█[^\n]*\n[ ▌] {5}half way *\n/); assert.match(text, /Side panel off\. alt\+p shows it\./);
    assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).side, false); // your choice is remembered
    s.press("?"); assert.match(s.text(120), /alt\+p +show the side panel/);
    // what a row's R# tag says is the menu's last lines, under the keys. A window too short for the whole menu cuts
    // them: ↓ on the menu's last line scrolls on down to them, however little room the chat leaves, and ↑ comes back
    { const tall = s.v.tui.terminal.rows, legend = /\n[ ▌] {2}R#2 +the review it is on or last had, coloured by where it stands: passed, failed, the reviewer working/, n = s.v.menuItems().length;
      s.press("down"); assert.equal(s.v.menu.at, 0); // (the menu opens with no line picked: the first ↓ picks the first)
      for (const rows of [60, 24, 14]) {
        s.v.tui.terminal.rows = rows; const top = s.text(120);
        if (rows === 60) { assert.match(top, legend); assert.match(top, /\n on a row *\n[ ▌] {2}◐ +an agent works *\n[ ▌] {2}◑ +its reviewer works *\n/); assert.match(top, /\n[ ▌] {2}◆ +ready to approve *\n/); assert.match(top, /\n[ ▌] {2}65% 2m left +how far it is, and the time left/); } if (rows <= 24) assert.doesNotMatch(top, legend);
        let downs = 0; while (!legend.test(s.text(120)) && downs < 60) { s.press("down"); downs++; }
        assert.match(s.text(120), legend, `reached with ${rows} lines`); assert.match(s.text(120), /^ Menu /, "the menu's first line stays");
        for (let k = 0; k < 60; k++) s.press("down");
        const end = s.text(120); assert.match(end, legend); s.press("down", "down"); assert.equal(s.text(120), end, "nothing under the end"); assert.equal(s.v.menu.at, n - 1);
        for (let k = 0; k < 60; k++) s.press("up");
        // ↑ on the first line scrolls on up to what is above the list (the plain keys), and ↓ comes back from there
        assert.equal(s.v.menu.at, 0); assert.match(s.text(120), /^ Menu [^\n]*\n plain keys *\n[ ▌] {2}↑ ↓ /, `the top with ${rows} lines`);
        for (let k = 0; k < 60 && s.text(120) !== top; k++) s.press("down");
        assert.equal(s.v.menu.at, 0); assert.equal(s.text(120), top, "↓ goes back the way ↑ came");
      }
      // narrow: the line wraps, so every state it names can be read, at any width a word fits in, and nothing is cut
      for (const [cols, rows] of [[60, 18], [44, 18], [36, 24], [80, 14]]) {
        s.v.tui.terminal.rows = rows; let seen = ""; const flat = () => s.text(cols).replace(/\s+/g, " ");
        for (let k = 0; k < 90; k++) { s.press("down"); seen = flat(); }
        assert.match(seen, /R#2 the review it is on or last had, coloured by where it stands: passed, failed, the reviewer working/, `whole at ${cols}×${rows}`); assert.ok(!/R#2[^\n]*…/.test(s.text(cols)), "not cut");
        for (const l of s.screen(cols)) assert.ok(l.length <= cols, `fits ${cols}`);
        for (let k = 0; k < 95; k++) s.press("up");
      }
      s.v.tui.terminal.rows = tall; }
    s.press("esc");
    // Closed, it stays closed while you talk to a task's agent: only alt+p opens it.
    s.press("space"); assert.equal(s.v.reply, true); assert.doesNotMatch(s.text(120), /│ {2}#2 My own task/); assert.equal(s.v.full, false);
    s.press("space"); assert.equal(s.v.reply, false);
    s.press("alt+p"); assert.equal(s.v.side, true); assert.match(s.text(120), /│ {2}#2 My own task/);
    s.screen(80); s.press("alt+p", "alt+p"); assert.match(s.text(80), /The side panel needs a wider window\. alt\+t shows the task full screen\./); s.screen(120);
    // A board opened for the first time has it closed.
    { const fresh = open(w, { side: false }); fs.rmSync(path.join(S.dataDir(), "view.json"), { force: true }); const first = new View(fresh.v.tui, theme, () => {}, { cwd: w.root }); clearInterval(first.timer); assert.equal(first.side, false); }
    s.press("down", "alt+t");
    text = s.text(80);
    assert.match(text, /^ Task details {2}#1 "/); assert.match(text, /\n State {8}○ to do · \ds ago *\n/); assert.doesNotMatch(text.split("Session ─")[0], /proj\/1/, "the task is named as its row names it; its id stands once, with the session, for a command"); assert.match(text, /Description ─+ *\n All of them\./);
    // The whole panel never changes who you talk to: only space does. Space there talks to the task, space again goes back.
    assert.equal(s.v.reply, false); assert.match(text, /\n *\n \+ New task {2}[^\n]*\n─[^\n]*\n❯ Add a task/);
    s.press("space"); assert.equal(s.v.reply, true); assert.equal(s.v.full, true);
    assert.match(s.text(80), /\n *\n[ ▌]. #\d+ Write the docs {2}[^\n]*\n─[^\n]*\n❯ your message starts an agent on it/);
    s.press("alt+t"); assert.equal(s.v.full, false); assert.equal(s.v.reply, true, "folding the panel keeps who you talk to");
    s.press("alt+t", "space"); assert.equal(s.v.reply, false); assert.equal(s.v.full, true, "space never opens or folds the panel");
    // esc leaves the whole task, and who you talk to stays as it was: also a task's agent.
    s.press("space", "esc"); assert.equal(s.v.full, false); assert.equal(s.v.reply, true); s.press("space");
    assert.match(s.text(120), /^ herdr-superwork/); assert.equal(s.v.reply, false);
    for (const width of [24, 40, 64, 89, 90, 200]) assert.ok(s.screen(width).every((l) => l.length <= width), `fits ${width}`);
  } finally { w.cleanup(); }
});

test("the done list is plain: newest first, and nothing marks a task as read or not", async () => {
  const w = await world();
  try {
    const titles = ["oldest", "middle", "newest"], ids = titles.map((title) => A.add(w.root, title).id), now = Date.now();
    // `seen` is what an older version saved in a task: it changes neither the order nor the row
    ids.forEach((id, n) => { S.update(id, { stage: "done" }); S.update(id, { at: now - (3 - n) * 60000, seen: n !== 0 }); });
    const s = open(w);
    const lines = s.screen(80), at = titles.map((title) => lines.findIndex((l) => /^[ ▌]✓ #\d /.test(l) && l.slice(6).startsWith(title)));
    assert.ok(at[2] > 0 && at[2] < at[1] && at[1] < at[0], lines.join("\n"));
    assert.doesNotMatch(lines.join("\n"), /unread/);
    for (const r of s.v.items) assert.equal(s.v.row(r, 80).includes("\x1b[1m"), false, "no done row stands out from the others");
    s.press("enter", "esc"); assert.equal(S.get(s.v.sel).seen, s.v.sel !== ids[0], "looking at a task changes nothing about it");
  } finally { w.cleanup(); }
});

// ---- the second UI/UX check ------------------------------------------------------------------------------------------
const failing = { text: "No.", meets: false, pass: false, gate: "major", findings: [{ id: "F1", severity: "critical", subject: "Loses data", where: "a.js" }, { id: "F2", severity: "major", subject: "No test", where: "a.js" }] };
const passing = { text: "Fine.", meets: true, pass: true, gate: "major", findings: [] };
// A task that waits for its yes, with this review: set by hand, so no agent and no merge ever runs.
const waiting = (w, title, review) => { const t = A.add(w.root, title); S.update(t.id, (x) => { Object.assign(x, { stage: "approval", app: "claude", agent: "claude", review, reviewRound: 1, summary: "Done." }); }); return t.id; };

test("work whose review failed is not ready: it stands under needs you, its yes is 'merge anyway', and a plain approve never merges it", async () => {
  const w = await world();
  try {
    const bad = waiting(w, "Add an undo for clear", failing), good = waiting(w, "Max length for titles", passing);
    const s = open(w, { side: false });
    const rows = Object.fromEntries(s.v.items.map((r) => [r.id, r]));
    assert.deepEqual([groupOf(rows[bad]), standing(rows[bad]), groupOf(rows[good]), standing(rows[good])], ["needs you", "review failed", "ready to approve", "ready to approve"]);
    // On the list: under needs you, with what the review found; the passed one keeps its own group and its own mark.
    assert.match(s.text(), /\n needs you *\n[ ▌]! #1 Add an undo for clear +R#1 +\d+s ago *\n[ ▌] {5}Review failed · 1 critical, 1 major *\n/);
    assert.match(s.text(), /\n ready to approve *\n[ ▌]◆ #2 Max length for titles +R#1 +\d+s ago *\n[ ▌] {5}Pass *\n/);
    assert.match(s.text(), /^ herdr-superwork {2}proj · 1 needs you · 1 ready/);
    // Its hints: send the review back first, and the yes is "merge anyway". The question says what failed.
    s.v.sel = bad; s.v.load();
    assert.match(s.text(), /\n {2}ctrl\+r send the review to this task's agent · ctrl\+l merge this task anyway · /);
    s.press("ctrl+l");
    assert.match(s.text(), /\n \? Merge #1 "Add an undo for clear" into \S+\? *\n {3}Its last review failed: 1 critical, 1 major\. A merge cannot be undone\. *\n {3}y = merge anyway · n = do not merge *\n/);
    assert.equal(s.v.ask.danger, true);
    // Any other key is not an answer: the box says which keys are, and nothing is merged or typed.
    s.press("enter", "x"); assert.ok(s.v.ask); assert.match(s.text(), /\n {3}press y or n: y = merge anyway · n = do not merge *\n/); assert.equal(s.v.value(), "");
    s.press("n"); assert.equal(s.v.ask, null); assert.equal(S.get(bad).stage, "approval");
    // The guard is in the action itself: the command line (and so the Coordinator) cannot merge it by a plain approve.
    assert.throws(() => A.approve(bad), /proj\/1 was not merged: its last review failed \(1 critical, 1 major\)\..*herdr-superwork approve proj\/1 --anyway/);
    assert.equal(S.get(bad).stage, "approval");
    // herdr's sidebar says the same, in the board's own words, with what it says on a line of its own.
    assert.deepEqual(sidebarWords(S.get(bad)), { label: "review failed", line: "1 critical, 1 major" });
    assert.deepEqual(sidebarWords(S.get(good)), { label: "ready to approve", line: "Pass" });
    assert.deepEqual([F.labelOf({ stage: "asks", kind: "question", msg: "Sand or pebbles?" }), F.lineOf({ stage: "asks", kind: "question", msg: "Sand or pebbles?" })], ["asks you", "Sand or pebbles?"]);
    assert.deepEqual(sidebarWords({ stage: "working" }), { label: "", line: "" });
  } finally { w.cleanup(); }
});

test("typed words keep who they are for: the box says so, the wheel moves the view and a click selects nothing while it holds text", async () => {
  const w = await world();
  try {
    for (let n = 1; n <= 22; n++) A.add(w.root, `Task number ${n}`);
    const s = open(w, { rows: 20, side: false }), v = s.v;
    const wheel = (y, by) => v.handleMouse({ type: "wheel", button: "none", x: 5, y, wheelDelta: by }), click = (y, x = 5) => v.handleMouse({ type: "click", button: "left", x, y });
    s.screen();
    // With an empty box the wheel moves between tasks, and a click on a row selects it.
    const first = v.sel; wheel(4, 1); assert.notEqual(v.sel, first); const second = v.sel;
    s.screen(); const at = v.listIds.findIndex((id) => id && id !== v.sel); assert.ok(at >= 0);
    assert.deepEqual(click(v.listAt[0] + at), { handled: true, render: true }); assert.equal(v.sel, v.listIds[at]); assert.notEqual(v.sel, second);
    assert.equal(click(0), undefined, "a click that is on no row is not the board's");
    // Words for a task's agent: the box's top edge says who gets them.
    const mine = v.sel; s.press("space"); s.type("pebbles please");
    assert.match(s.text(), /\n─ To: #\d+ ─+\n❯ pebbles please/);
    // The wheel now moves the view of the list only: the selection, and so the recipient, stays.
    const top = v.top; wheel(4, 1); wheel(4, 1); s.screen();
    assert.equal(v.sel, mine); assert.equal(v.replyId, mine); assert.ok(v.top > top, "the list scrolled"); assert.equal(v.value(), "pebbles please");
    // A click selects nothing then, and says why. A key brings the view back to the selected task.
    s.screen(); const other = v.listIds.findIndex((id) => id && id !== mine);
    if (other >= 0) { click(v.listAt[0] + other); assert.equal(v.sel, mine); assert.match(v.msg, /Send or put away what you typed first/); }
    s.type("!"); s.screen(); assert.equal(v.topFree, false); assert.ok(v.listIds.includes(mine), "the selected task is in view again");
    // For the Coordinator, or as a new task, it says that.
    s.press("esc", "space"); s.type("hello"); assert.match(s.text(), /\n─ To: a new task ─+\n❯ hello/);
  } finally { w.cleanup(); }
});

test("the selected row has a bar in its gutter on every line, and inverse video where no colour can show it", async () => {
  const w = await world();
  const had = process.env.NO_COLOR;
  try {
    const live = waiting(w, "Reviewed work", passing); A.add(w.root, "A to-do");
    const s = open(w, { side: false }); s.v.sel = live; s.v.load();
    delete process.env.NO_COLOR;
    let raw = s.v.render(100), lit = raw.filter((l) => stripVTControlCharacters(l).startsWith("▌"));
    assert.equal(lit.length, 2, "both lines of the selected row"); assert.ok(lit.every((l) => l.includes("\x1b[48;")), "with the theme's tint behind it"); assert.ok(lit.every((l) => !l.includes("\x1b[7m")));
    assert.ok(!raw.filter((l) => /A to-do/.test(l)).some((l) => l.includes("▌")), "no other row has it");
    // No colour: the bar is still there, and the row is in inverse video.
    process.env.NO_COLOR = "1";
    raw = s.v.render(100); lit = raw.filter((l) => stripVTControlCharacters(l).startsWith("▌"));
    assert.equal(lit.length, 2); assert.ok(lit.every((l) => l.includes("\x1b[7m") && l.includes("\x1b[27m")), "inverse video"); assert.ok(lit.every((l) => !/\x1b\[(38|48);/.test(l)), "and no colour codes");
    // The same in the ? menu's picked line.
    s.press("?", "down"); assert.equal(s.v.render(100).filter((l) => l.includes("\x1b[7m") && stripVTControlCharacters(l).startsWith("▌")).length, 1);
  } finally { if (had === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = had; w.cleanup(); }
});

test("the list says what it hides, the header says where you are, and an action says what it did to which task", async () => {
  const w = await world();
  try {
    for (let n = 1; n <= 40; n++) A.add(w.root, `Task number ${n}`);
    const s = open(w, { rows: 24, side: false }), v = s.v;
    let lines = s.screen(100);
    // The header: where you are and how many tasks stand where; never a folder path.
    assert.match(lines[0], /^ herdr-superwork {2}proj · 40 to do *$/); assert.doesNotMatch(lines[0], /\//);
    // A list cut at the bottom says how many tasks are below, on its last line; no heading stands with nothing under it.
    const list = lines.slice(1, lines.findIndex((l) => /New task|Coordinator/.test(l)));
    const shown = list.filter((l) => /Task number/.test(l)).length, note = list.filter((l) => l.trim()).at(-1).trimEnd();
    assert.match(note, /^ ↓ \d+ more$/); assert.equal(Number(/\d+/.exec(note)[0]), 40 - shown);
    // Page keys move ten tasks at a time; then tasks are above too.
    const from = v.steps.indexOf(v.sel); s.press("\x1b[6~"); assert.equal(v.steps.indexOf(v.sel), from + 10); s.press("\x1b[6~", "\x1b[6~");
    assert.match(s.screen(100).filter((l) => /more/.test(l)).join("\n"), /↓ \d+ more · ↑ \d+ more/);
    s.press("\x1b[5~", "\x1b[5~", "\x1b[5~"); assert.equal(v.steps.indexOf(v.sel), from);
    // A filter has a line of its own: what it is, how many match, the key that clears it.
    s.press("ctrl+f"); s.type("number 3"); assert.match(s.screen(100)[1], /^ filter "number 3" · 11 of 40 · esc cancels *$/);
    s.press("enter"); assert.match(s.screen(100)[1], /^ filter "number 3" · 11 of 40 · esc clears *$/); s.press("esc"); assert.doesNotMatch(s.screen(100)[1], /filter/);
    s.press("ctrl+f"); s.type("zzzq"); assert.match(s.text(100), /Nothing matches "zzzq"\./); s.press("esc");
    // Pinning says so, by the task's name; the selection follows the task to the top.
    const id = v.sel, tag = `#${id.split("/")[1]}`, title = S.get(id).title;
    s.press("ctrl+p"); assert.equal(v.msg, `Pinned ${tag} "${title}" to the top. ctrl+p unpins it.`); assert.equal(v.sel, id); assert.match(s.text(100), /\n pinned *\n▌/);
    s.press("ctrl+p"); assert.equal(v.msg, `Unpinned ${tag} "${title}".`); assert.equal(v.sel, id);
    // A message names a task as its row does, also one written with the task's id.
    v.flash("proj/7: started, an agent is on it"); assert.equal(v.msg, "#7: started, an agent is on it");
    v.flash("Run: herdr-superwork approve proj/7 --anyway"); assert.match(v.msg, /approve proj\/7 --anyway/, "a command keeps the id it takes");
    // A key that does nothing here says so quietly, never in the red of something that went wrong.
    s.press("ctrl+r"); assert.equal(v.msg, "Nothing to send back here."); assert.notEqual(v.msgKind, "red");
    // With every machine shown, whose tasks these are comes first in the header and is never cut; the tag names the machine.
    v.scope = "*"; v.remotes = { otherbox: { label: "otherbox", ok: true, items: [{ id: "otherbox:proj/1", rid: "proj/1", host: "otherbox", title: "Far away", state: "idle", stage: "todo", at: Date.now() }] } }; v.load();
    for (const width of [100, 40, 24]) assert.match(s.screen(width)[0], /all machines: otherbox/, `at ${width}`);
    v.sel = "otherbox:proj/1"; v.load();
    assert.match(s.text(100), /\n[ ▌]○ otherbox#1 +Far away /); assert.doesNotMatch(s.text(100), /otherbox Far away/);
    s.press("ctrl+f"); s.type("1"); assert.ok(v.rows.some((r) => r.rec?.host === "otherbox"), "find takes the number alone: no machine in it"); s.press("esc");
    // Machine names too long for the line go on to the next one, whole: never cut.
    const long = ["a-very-long-machine-name-on-the-tailnet", "another-extremely-long-machine-name-there"];
    v.remotes = Object.fromEntries(long.map((label) => [label, { label, ok: true, items: [] }])); v.load();
    for (const width of [80, 50]) { const head = s.screen(width).slice(0, 4).join(" ").replace(/\s+/g, " "); for (const name of long) assert.ok(head.includes(name), `${name} whole at ${width}: ${head}`); assert.doesNotMatch(s.screen(width).slice(0, 4).join("\n"), /machine[^\n]*…/); }
    // Another machine's work: the merge question says where it lands there, as that machine told it; an older one
    // that does not say still gets a destination.
    const far = { id: "otherbox:proj/7", rid: "proj/7", host: "otherbox", title: "Remote merge", state: "blocked", kind: "permission", stage: "approval", agent: "claude", at: Date.now(), snap: { landsOn: "trunk" } };
    v.remotes = { otherbox: { label: "otherbox", ok: true, items: [far] } }; v.load(); v.sel = far.id; v.load();
    s.press("ctrl+l"); assert.equal(v.ask.q, 'Merge otherbox#7 "Remote merge" into trunk on otherbox?'); assert.match(v.ask.detail, /A merge cannot be undone\./); s.press("n");
    delete far.snap.landsOn; s.press("ctrl+l"); assert.equal(v.ask.q, 'Merge otherbox#7 "Remote merge" into its main branch on otherbox?'); s.press("n");
  } finally { w.cleanup(); }
});

test("the popup takes the whole pane where the window is small, and keeps its margin where it is not", () => {
  assert.deepEqual(sizeFor({ width: 150, height: 45 }), { width: "90%", height: "90%" });
  assert.deepEqual(sizeFor({ width: 80, height: 45 }), { width: "100%", height: "100%" });
  assert.deepEqual(sizeFor({ width: 150, height: 24 }), { width: "100%", height: "100%" });
  assert.deepEqual(sizeFor(null), { width: "90%", height: "90%" });
});
