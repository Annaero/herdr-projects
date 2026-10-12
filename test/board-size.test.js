// A terminal held at another size than herdr shows.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { open } from "./board-helpers.js";

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
    s.v.chatOf = () => ({ mark: "○", name: "Coordinator", status: "idle · claude · default model · default effort", enter: true, said: true, always: true, notes: [], text: "Tasks 31 and 32 are both waiting." });
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
    assert.match(lines[54], /^ {2}Another viewer holds this terminal at 435×58; herdr shows it at 412×56\. The ownTerminal setting, turned on, takes it back\. *$/);
    assert.equal(lines[53], "─".repeat(411)); assert.match(lines[52], /^❯ /); assert.equal(lines[51], "─".repeat(411));
    const row = lines.find((l) => /Pin the chat/.test(l));
    assert.match(row, /Checking every window size\. +█+░+ +55% 12m PR#3 {2}6m {4}$/); assert.equal(row.length, 411); // the columns are back in view
    assert.equal(lines.find((l) => /^ ○ Coordinator/.test(l)).trimEnd(), " ○ Coordinator  idle · claude · default model · default effort"); // the name and its status, no keys
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
      assert.match(a.screen(435).join("\n"), /Another viewer holds this terminal at 435×58; herdr shows it at 184×78\. The ownTerminal setting, turned on, takes it back\./);
      a.v.seeShown(tall); assert.deepEqual(took, [["w1:p1", { cols: 183, rows: 58 }]]);
      a.v.seeShown(tall);
      let l = a.screen(184);
      assert.equal(l.length, 78); assert.match(l[77], /^ {2}\S.* · /); assert.equal(l[75], "─".repeat(184));
      assert.match(l[76], /Another viewer held this terminal at 435×58: it was disconnected, and your window has it again\./);
      // A viewer that comes back is sent away again, every time: the board has its pane's size, always.
      for (let round = 2; round <= 4; round++) {
        Object.assign(a.v.tui.terminal, { columns: 435, rows: 58 });
        a.v.seeShown(tall); assert.equal(took.length, round - 1);
        assert.match(a.screen(435)[56], /Another viewer holds this terminal at 435×58; herdr shows it at 184×78\. The ownTerminal setting, turned on, takes it back\./); // what is true now, not what was done before
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
      // `ownTerminal` off: the other viewer stays. The board draws inside what both see, says so, and disconnects nobody.
      const d = open(w, { rows: 58, side: false }), never = [];
      Object.assign(d.v.tui.terminal, { columns: 435 }); d.v.ctx.pane = "w1:p1"; d.v.ctx.ownTerminal = false; d.v.ctx.takeTerminal = (...x) => never.push(x);
      for (let n = 0; n < 5; n++) d.v.seeShown(tall);
      assert.deepEqual(never, []); assert.match(d.screen(435)[56], /Another viewer holds this terminal at 435×58; herdr shows it at 184×78\. The ownTerminal setting, turned on, takes it back\./);
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
    // No key takes the terminal back: alt+w, the key that once did, disconnects nobody, on an empty text box or in a
    // draft. (With the setting on, the board does it by itself: above.)
    const taken = [];
    s.v.tui.terminal.columns = 435; s.v.ctx.pane = "w1:p1"; s.v.ctx.takeTerminal = (socket, pane, size) => { taken.push([pane, size]); };
    s.v.askShown = () => {};
    s.screen(435); s.press("\x1bw"); assert.deepEqual(taken, []); assert.equal(s.v.value(), "");
    s.type("half a draft"); s.press("\x1bw"); assert.deepEqual(taken, []); assert.equal(s.v.value(), "half a draft");
    s.v.setValue("");
    assert.match(s.screen(435).join("\n"), /Another viewer holds this terminal/);
    s.v.tui.terminal.columns = 184;
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
    s.press("alt+t"); assert.match(head(), /Held at/); s.press("esc");
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
