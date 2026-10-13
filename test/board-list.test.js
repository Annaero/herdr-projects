// The task list: the header, the groups, the done list.
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
    assert.match(text, /^ herdr-superwork {2}proj · \S+ +│ *\n +│/); assert.doesNotMatch(text, /work board for herdr|\d (blocked|idle|working)/);
    // Every line is in herdr's text colour (Catppuccin's here), unless colours are switched off. Each task's mark is
    // a symbol of its own in its group's colour (working yellow, to do grey), and its title stays plain text.
    const raw = s.v.render(120), text0 = "\x1b[38;2;205;214;244m", yellow = "\x1b[38;2;249;226;175m", grey = "\x1b[38;2;108;112;134m";
    assert.ok(raw.every((l) => (process.env.NO_COLOR ? !l.includes("\x1b[38;2;") : l.startsWith(text0))));
    if (!process.env.NO_COLOR) {
      assert.ok(raw.some((l) => l.includes(`${yellow}◐\x1b[39m${text0} \x1b[1mMy own task\x1b[22m `)), "a working task's mark is the working colour, its title plain text");
      assert.ok(raw.some((l) => l.includes(`${grey}○\x1b[39m${text0} Write the docs `)), "a task nobody started is grey, not green");
      assert.ok(raw.some((l) => l.includes(`${yellow}working\x1b[39m`)) && raw.some((l) => l.includes(`${grey}to do\x1b[39m`)), "the headings are in their group's colour");
      assert.ok(raw.some((l) => l.includes(`${yellow}50%`)), "progress is in the working colour while working");
      assert.ok(raw.some((l) => l.includes(`${yellow}50%\x1b[39m${text0} ${yellow}12m\x1b[39m`)), "the minutes left sit right of the percent, in the same colour");
    }
    // A row does not repeat its heading ("idle" under "to do"), and its time says which kind it is.
    assert.match(text, /\n working +│/); assert.match(text, /\n to do +│/);
    assert.match(text, /◐ My own task +█+░+ +50% 12m +\ds {5}│[^\n]*\n {3}half way +│/); assert.match(text, /│ {2}Progress {5}█+░+ 50% · 12m left *\n/); // on the row and in the task panel assert.match(text, /○ Write the docs {6,}\ds ago │/);
    assert.match(text, /│ {2}My own task/); assert.match(text, /│ {2}State {8}◐ working · for \ds *\n/); assert.match(text, /│ {2}On it {8}you *\n[^\n]*│ {2}Task {9}proj\/2 *\n/);
    // The text box names who gets your words, and its empty line says only "what's next?".
    assert.match(text, /\n *\n \+ New task {2}[^\n]*\n─+\n❯ what's next\? *\n/); assert.doesNotMatch(text, /Coordinator|sidebar/);
    assert.equal(s.screen(120).length, 34); assert.ok(s.screen(120).every((l) => l.length <= 120));
    assert.ok(!/│ {2}My own task/.test(s.text(80)), "no panel beside the list below 90 columns");
    // ctrl+b is herdr's own prefix key: the board has no use for it.
    s.press("ctrl+b"); assert.match(s.text(120), /│ {2}My own task/); assert.equal(s.v.value(), "");
    // alt+p closes the side panel and opens it again: closed, the list has the whole width.
    s.press("alt+p"); text = s.text(120);
    assert.equal(s.v.side, false); assert.doesNotMatch(text, /│/); assert.match(text, /◐ My own task {70,}█[^\n]*\n {3}half way *\n/); assert.match(text, /Side panel off\. alt\+p shows it\./);
    assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).side, false); // your choice is remembered
    s.press("?"); assert.match(s.text(120), /alt\+p +show the side panel/);
    // what a row's R# tag says is the menu's last lines, under the keys. A window too short for the whole menu cuts
    // them: ↓ on the menu's last line scrolls on down to them, however little room the chat leaves, and ↑ comes back
    { const tall = s.v.tui.terminal.rows, legend = /\n on a row *\n {3}R#2 {5}the review it is on or last had, coloured by where it stands: passed, failed, the reviewer working/, n = s.v.menuItems().length;
      for (const rows of [60, 34, 24, 18, 14]) {
        s.v.tui.terminal.rows = rows; const top = s.text(120);
        if (rows === 60) assert.match(top, legend); if (rows <= 24) assert.doesNotMatch(top, legend);
        let downs = 0; while (!legend.test(s.text(120)) && downs < 80) { s.press("down"); downs++; }
        assert.match(s.text(120), legend, `reached with ${rows} lines`); assert.match(s.text(120), /^ menu /, "the menu's first line stays");
        for (let k = 0; k < 80; k++) s.press("down");
        const end = s.text(120); assert.match(end, legend); s.press("down", "down"); assert.equal(s.text(120), end, "nothing under the end"); assert.equal(s.v.menu.at, n - 1);
        for (let k = 0; k < 80; k++) s.press("up");
        // ↑ on the first line scrolls on up to what is above the list (the plain keys), and ↓ comes back from there
        assert.equal(s.v.menu.at, 0); assert.match(s.text(120), /^ menu [^\n]*\n *\n plain keys *\n {3}↑ ↓ /, `the top with ${rows} lines`);
        for (let k = 0; k < 80 && s.text(120) !== top; k++) s.press("down");
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
    s.press("space"); assert.equal(s.v.reply, true); assert.doesNotMatch(s.text(120), /│ {2}My own task/); assert.equal(s.v.full, false);
    s.press("space"); assert.equal(s.v.reply, false);
    s.press("alt+p"); assert.equal(s.v.side, true); assert.match(s.text(120), /│ {2}My own task/);
    s.screen(80); s.press("alt+p", "alt+p"); assert.match(s.text(80), /The side panel needs a wider window\. alt\+t shows the task full screen\./); s.screen(120);
    // A board opened for the first time has it closed.
    { const fresh = open(w, { side: false }); fs.rmSync(path.join(S.dataDir(), "view.json"), { force: true }); const first = new View(fresh.v.tui, theme, () => {}, { cwd: w.root }); clearInterval(first.timer); assert.equal(first.side, false); }
    s.press("down", "alt+t");
    text = s.text(80);
    assert.match(text, /^ Task details {2}proj\/1/); assert.match(text, /\n State {8}○ to do · \ds ago *\n Task {9}proj\/1 *\n/); assert.match(text, /Description ─+ *\n All of them\./);
    // The whole panel never changes who you talk to: only space does. Space there talks to the task, space again goes back.
    assert.equal(s.v.reply, false); assert.match(text, /\n *\n \+ New task {2}[^\n]*\n─+\n❯ what's next\?/);
    s.press("space"); assert.equal(s.v.reply, true); assert.equal(s.v.full, true);
    assert.match(s.text(80), /\n *\n . Write the docs {2}[^\n]*\n─+\n❯ your message starts an agent on it/);
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
    const lines = s.screen(80), at = titles.map((title) => lines.findIndex((l) => l.startsWith(` ✓ ${title}`)));
    assert.ok(at[2] > 0 && at[2] < at[1] && at[1] < at[0], lines.join("\n"));
    assert.doesNotMatch(lines.join("\n"), /unread/);
    for (const r of s.v.items) assert.equal(s.v.row(r, 80).includes("\x1b[1m"), false, "no done row stands out from the others");
    s.press("enter", "esc"); assert.equal(S.get(s.v.sel).seen, s.v.sel !== ids[0], "looking at a task changes nothing about it");
  } finally { w.cleanup(); }
});
