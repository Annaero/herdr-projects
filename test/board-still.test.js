// The board stands still: a size that changes for a moment, a second herdr window on the session, agents starting and ending, its own reload
import test from "node:test";
import assert from "node:assert/strict";
import { world, toApproval } from "./helpers.js";
import * as A from "../src/actions.js";
import * as C from "../src/coordinator.js";
import { runJob } from "../src/jobs.js";
import { drainJobs } from "../src/runner.js";
import { open } from "./board-helpers.js";
import { coordWorld } from "./coordinator-helpers.js";

// An open board as main.js starts it: a size has to last a second before the board lays itself out for it. `at` is
// what a window resize does: the terminal has another size, and the board is drawn for it.
function still(w, t, { cols = 141, rows = 46 } = {}) {
  const s = open(w, { rows });
  if (!t.clock) { t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() }); t.clock = true; }
  Object.assign(s.v.ctx, { settleMs: 1000, pane: "w1:p1" });
  s.asked = 0; s.v.askShown = () => { s.asked++; }; // herdr is asked by the test itself: `seeShown` is its answer
  for (const row of s.v.rows) if (row.rec) row.rec.at = Date.now() - 5 * 3600000; // "5h ago" on every row, however far a test moves the clock
  s.at = (c, r) => { Object.assign(s.v.tui.terminal, { columns: c, rows: r }); return s.screen(c); };
  s.wait = (ms) => t.mock.timers.tick(ms);
  s.at(cols, rows);
  return s;
}
// The screen as it was, in a terminal of another size: the same lines, cut on the right and from the top.
const cut = (lines, cols, rows) => lines.slice(Math.max(0, lines.length - rows)).map((l) => l.slice(0, cols).trimEnd());
const trimmed = (lines) => lines.map((l) => l.trimEnd());
const sidePanel = (lines) => lines.filter((l) => /\S.* │ /.test(l)).length > 10; // the list on the left, the task panel on the right

// Seen on a real board (2026-10-12, herdr 0.9.3): its terminal went from 141x46 to 138x44 and back within 0.6 s, and to
// 47x44 when a phone-sized herdr window took the session. Each time the board laid itself out for the other size, and
// again for its own: the side panel gone and back, every row moved twice.
test("a size that changes for a moment and is back does not move the board", async (t) => {
  const w = await world();
  try {
    for (let i = 1; i <= 30; i++) A.add(w.root, `Task number ${i}`);
    const s = still(w, t), wide = s.at(141, 46);
    assert.ok(sidePanel(wide)); assert.equal(wide.length, 46);
    // Another window's size for a moment: the screen is the one it was, cut to the room there is. The text box and
    // its hints, at the bottom, stay.
    for (const [cols, rows, ms] of [[138, 44, 600], [140, 46, 200], [47, 44, 900], [200, 60, 500]]) {
      const during = s.at(cols, rows), note = `${cols}x${rows}`;
      assert.equal(during.length, rows, note);
      assert.deepEqual(trimmed(during).slice(0, Math.min(rows, 46)), cut(wide, cols, rows), note);
      assert.match(during[Math.min(rows, 46) - 1], /^[ ▌] {1}\S/, `${note}: the hints are on its last drawn row`);
      s.wait(ms / 2); assert.deepEqual(trimmed(s.at(cols, rows)).slice(0, Math.min(rows, 46)), cut(wide, cols, rows), `${note}, still`);
      s.wait(ms / 2);
      assert.deepEqual(s.at(141, 46), wide, `${note}: back, and nothing has moved`);
      s.wait(3000);
    }
    // A size that lasts is the board's size after a second: laid out for it, as a board opened at that size is.
    assert.deepEqual(trimmed(s.at(47, 44)), cut(wide, 47, 44));
    s.wait(1000);
    const narrow = s.at(47, 44);
    assert.equal(sidePanel(narrow), false); assert.equal(narrow.length, 44); assert.match(narrow[43], /^[ ▌] {1}\S/);
    for (const l of narrow) assert.ok(l.length <= 47);
    assert.notDeepEqual(trimmed(narrow), cut(wide, 47, 44));
    { const fresh = open(w, { rows: 44 }); fresh.v.sel = s.v.sel; for (const row of fresh.v.rows) if (row.rec) row.rec.at = Date.now() - 5 * 3600000; assert.deepEqual(narrow, fresh.screen(47)); }
    // Right after a size has lasted, a short change is held like any other (the reviewer's case: 141 to 120 columns
    // for good, then 47x44 for a fifth of a second): the side panel does not go and come back.
    s.at(120, 46); s.wait(1150);
    const mid = s.at(120, 46);
    assert.ok(sidePanel(mid)); for (const l of mid) assert.ok(l.length <= 120);
    assert.deepEqual(trimmed(s.at(47, 44)), cut(mid, 47, 44)); s.wait(200);
    assert.deepEqual(s.at(120, 46), mid);
    // A window that is being dragged: the screen as it was, cut, and laid out again once a second, never per step.
    let laid = mid;
    for (const cols of [118, 116, 114, 112, 110, 108, 106, 104]) {
      s.wait(300);
      const l = s.at(cols, 46);
      if (trimmed(l).join("\n") !== cut(laid, cols, 46).join("\n")) { laid = l; assert.ok(sidePanel(l), `${cols}`); for (const x of l) assert.ok(x.trimEnd().length <= cols); }
    }
    assert.notDeepEqual(laid, mid); // it did follow
    s.wait(1000); s.at(141, 46); s.wait(1000);
    assert.deepEqual(s.at(141, 46), wide);
    // Without the wait (the tests' boards, and any board not opened by main.js) a size is the board's at once.
    { const plain = open(w, { rows: 46 }); plain.screen(141); assert.equal(sidePanel(plain.screen(47)), false); }
  } finally { t.mock.timers.reset(); w.cleanup(); }
});

// herdr is asked what it shows of the pane, and answers a moment later: an answer about a size the terminal no longer
// has was drawn for until the next one came, two seconds on. That was the board "in another shape for a moment".
test("what herdr said about another size, or says once, is not drawn for", async (t) => {
  const w = await world();
  try {
    for (let i = 1; i <= 30; i++) A.add(w.root, `Task number ${i}`);
    const s = still(w, t), took = [];
    s.v.ctx.takeTerminal = (socket, pane, size) => took.push(size);
    const whole = { cols: 141, rows: 46, split: false }, phone = { cols: 47, rows: 44, split: false };
    s.v.seeShown(whole);
    const wide = s.at(141, 46);
    // The size changes: herdr is asked at once, and what it said for the old size is put aside.
    let asked = s.asked;
    s.at(47, 44); assert.equal(s.asked, asked + 1);
    s.v.seeShown(phone); // herdr's answer for the moment the terminal was that small
    asked = s.asked;
    assert.deepEqual(s.at(141, 46), wide); assert.equal(s.asked, asked + 1); // back: its own size, at once, and herdr is asked again
    // The answer from during that moment comes in late: it disagrees with the terminal, once. Nothing is drawn for it,
    // nothing is said, nobody is disconnected.
    s.v.seeShown(phone);
    assert.deepEqual(s.at(141, 46), wide); assert.doesNotMatch(wide.join("\n"), /Another viewer/); assert.deepEqual(took, []);
    s.v.seeShown(whole); s.wait(2000); s.v.seeShown(whole);
    assert.deepEqual(s.at(141, 46), wide); assert.deepEqual(took, []);
    // The same said again two seconds on is how things are: the board draws inside what herdr shows, and says so.
    s.v.seeShown(phone); s.wait(2000); s.v.seeShown(phone);
    const inside = s.at(141, 46);
    assert.match(inside.join(" ").replace(/\s+/g, " "), /Another viewer holds this terminal at 141×46; herdr shows it at 47×44\./);
    for (const l of inside) assert.ok(l.trimEnd().length <= 46);
  } finally { t.mock.timers.reset(); w.cleanup(); }
});

// Seen in herdr's own log of a real session: the board took its terminal 179 times in twelve minutes, every four
// seconds, while a second herdr window (47x44, then 138x44) was on the session. Taking the terminal disconnects a
// viewer attached to that one terminal; a second herdr window is not one, so nothing changed and it went on.
test("a second herdr window on the session: the board takes its terminal twice, then says what frees the size", async (t) => {
  const w = await world();
  try {
    A.add(w.root, "A task");
    const s = still(w, t, { cols: 54, rows: 24 }), took = [];
    s.v.ctx.takeTerminal = (socket, pane, size) => took.push(size); // herdr takes it, and the size stays as it was
    const big = { cols: 142, rows: 47, split: false };
    const look = (shown = big) => { s.wait(2000); s.v.seeShown(shown); }; // the board asks every two seconds
    look(); assert.deepEqual(took, []); // once is a size change under way
    look(); assert.deepEqual(took, [{ cols: 54, rows: 24 }]);
    assert.match(s.at(54, 24).join("\n"), /Another viewer holds this terminal at 54×24; herdr\s+shows it at 142×47\./);
    for (let n = 0; n < 30; n++) look();
    assert.equal(took.length, 2); // a minute on: not once more
    const text = s.at(54, 24).join(" ").replace(/\s+/g, " ");
    assert.match(text, /herdr shows it at 142×47\. A key typed in this window takes it back: another he/); // three lines of a narrow window: what frees it is in them
    { const room = still(w, t, { cols: 100, rows: 24 }); room.v.ctx.takeTerminal = () => {}; for (let n = 0; n < 6; n++) { room.wait(2000); room.v.seeShown(big); }
      assert.match(room.at(100, 24).join(" ").replace(/\s+/g, " "), /A key typed in this window takes it back: another herdr window \(a second device, a browser tab\) has this session at its own size\./); }
    assert.doesNotMatch(text, /trying again|turned on, takes it back/);
    // The line at the top (the one a cut-out still shows) says the same, with what frees the size first.
    s.v.held = { columns: 54, rows: 24, room: { columns: 142, rows: 47 }, by: [] };
    assert.match(s.at(54, 24)[0], /^[ ▌]! Shown cut off: another herdr window on this/);
    assert.match(s.at(54, 24).join("\n"), /^(?![\s\S]*Another viewer holds)/); // one note, not two
    s.v.held = { ...s.v.held, by: [{ pid: 4242, seconds: 60 }] }; // a real attach on the terminal: the line names the key that ends it, never its process
    assert.match(s.at(54, 24).slice(0, 3).join(" ").replace(/\s+/g, " "), /Shown cut off: a remote view holds this pane at 54×24 [^.]*\. ctrl\+k ends that view/); assert.doesNotMatch(s.at(54, 24).join("\n"), /kill 4242/);
    s.v.held = null;
    // You type in your window and herdr gives it the size: nothing claims to have disconnected anybody.
    s.at(141, 46); s.wait(2000); s.v.seeShown({ cols: 141, rows: 46, split: false });
    assert.doesNotMatch(s.at(141, 46).join("\n"), /disconnected|Another viewer/);
    // The next time the sizes come apart is a new one: the board tries again, twice at most.
    s.at(54, 24);
    for (let n = 0; n < 12; n++) look();
    assert.equal(took.length, 4);
  } finally { t.mock.timers.reset(); w.cleanup(); }
});

// Where the board's helpers run. Checked on herdr 0.9.3 with a real board, agent, reviewer and Coordinator: a space
// opened without focus, and a pane or tab opened in another space, change neither the size nor the layout of the
// board's own pane. Only a pane split off the board's own pane does, or a focus that moves herdr's window away.
const OPENS = /^(workspace create|worktree create|worktree open|pane split|tab create)\b/;
const MOVES = /^(workspace focus|tab focus|agent focus|pane focus|pane zoom|pane resize|pane swap|pane move)\b/;
function outOfSight(calls, board) {
  const opened = calls.filter((c) => OPENS.test(c));
  for (const c of opened) assert.match(c, / --no-focus( |$)/, `opened in front of you: herdr ${c}`);
  for (const c of calls) assert.doesNotMatch(c, MOVES, `moves herdr's window: herdr ${c}`);
  for (const c of calls) assert.ok(!c.startsWith(`pane split ${board} `) && !c.startsWith(`pane close ${board}`), `takes room from the board: herdr ${c}`);
  return opened;
}
test("an agent, its reviewer and the Coordinator start and end out of sight: nothing is focused, nothing is split off the board's pane", async () => {
  const board = "w0:p1";
  const boardPane = (w) => w.patchState((s) => { s.workspaces.push({ workspace_id: "w0", label: "board", cwd: w.root }); s.panes.push({ pane_id: board, workspace_id: "w0", tab_id: "w0:t1", terminal_id: "term_board", cwd: w.root, agent: null }); });
  const w = await world({ settings: { "reviewer.agent": "codex", "review.when": "always" } });
  try {
    boardPane(w);
    // A task's whole life: its agent starts in a space of its own, the reviewer in a tab of that space, both end,
    // the work is merged and the space is closed.
    const id = await toApproval(w, "Work", { reviewer: [{ verdict: { meets: true, findings: [], text: "Fine." } }] });
    let opened = outOfSight(w.state().calls, board);
    assert.ok(opened.some((c) => /^worktree create /.test(c)), "the agent's space");
    // The reviewer: a tab of its own in the task's space, opened behind the agent's. No pane is split off anything.
    const tabs = opened.filter((c) => /^tab create /.test(c));
    assert.equal(tabs.length, 1, "the reviewer's tab");
    assert.match(tabs[0], new RegExp(`--workspace ${(await import("../src/store.js")).get(id).link.workspace} `), "in the task's own space");
    assert.deepEqual(opened.filter((c) => /^pane split /.test(c)), []);
    A.approve(id); await drainJobs(runJob);
    outOfSight(w.state().calls, board);
    assert.ok(w.state().panes.some((p) => p.pane_id === board), "the board's pane is as it was");
    assert.deepEqual(w.state().focus, []);
  } finally { w.cleanup(); }
  // The Coordinator: a space of its own, opened behind the board, closed again when it is stopped.
  const c = await coordWorld();
  try {
    boardPane(c);
    c.script({ coordinator: [{ said: "ready" }] });
    C.send(c.root, "Say ready."); await drainJobs(runJob);
    assert.equal(c.agents().length, 1);
    const opened = outOfSight(c.state().calls, board);
    const kinds = opened.map((x) => x.split(" ").slice(0, 2).join(" "));
    assert.equal(kinds[0], "workspace create"); assert.deepEqual(kinds.filter((k) => !["workspace create", "tab create"].includes(k)), []); // its own space, and tabs in it
    C.stop(); await drainJobs(runJob);
    outOfSight(c.state().calls, board);
    assert.deepEqual(c.state().focus, []);
  } finally { c.cleanup(); }
  // The Watcher is a hidden model call: it has no pane at all (src/helpers.js never talks to herdr's layout).
});

// Recorded on a real terminal: when the board loaded its new version (the plugin's code changes each time a task's
// work is merged into the checkout it runs from), the whole board stood one line off for a third of a second, then
// the screen was empty, then the board was back. That is the glitch "when an agent finishes".
test("a board that loads its new version keeps its screen: nothing leaves the full-screen view, nothing clears it", async () => {
  const { stopKeepingScreen, keptEnv, startOnKeptScreen, giveScreenBack } = await import("../src/board/reload-screen.js");
  const stream = () => { const o = { got: [], write(chunk, cb) { o.got.push(chunk); if (typeof cb === "function") cb(); return true; } }; return o; };
  // The old board stops: the modes it took are given back, the full-screen view and its frame stay.
  const old = stream(), plain = old.write;
  let called = 0;
  stopKeepingScreen(() => {
    old.write("\x1b[?2026h\x1b[?1000l\x1b[?7h\x1b[?2026l"); old.write("\x1b[?25h"); old.write("\x1b[?2004l"); old.write("\x1b[<u");
    old.write("\x1b[?2026h\x1b[?1049l\x1b[?7l\r\x1b[2K herdr-superwork  proj\r\n\r\x1b[2K to do\x1b[?2026l", () => { called++; });
  }, old);
  assert.deepEqual(old.got, ["\x1b[?2026h\x1b[?1000l\x1b[?7h\x1b[?2026l", "\x1b[?25h", "\x1b[?2004l", "\x1b[<u"]);
  assert.equal(called, 1); assert.equal(old.write, plain); // whoever waited for that write is answered, and the stream is as it was
  old.write("\x1b[?1049l"); assert.equal(old.got.at(-1), "\x1b[?1049l"); // afterwards nothing is held back
  { const o = stream(), w = o.write; assert.throws(() => stopKeepingScreen(() => { throw new Error("stop failed"); }, o)); assert.equal(o.write, w); }
  // The new board is told, once, and enters the full-screen view without clearing it: its first frame is drawn over the old one.
  const env = { ...keptEnv() }, next = stream();
  assert.equal(startOnKeptScreen(next, env), true); assert.deepEqual(env, {});
  next.write("\x1b[?2004h");
  next.write("\x1b[?1049h\x1b[?7l\x1b[2J\x1b[H\x1b[?25l");
  next.write("\x1b[2J frame");
  assert.deepEqual(next.got, ["\x1b[?2004h", "\x1b[?7l\x1b[H\x1b[?25l", "\x1b[2J frame"]);
  // A board opened by you starts as always: the view is cleared as it is entered.
  const first = stream();
  assert.equal(startOnKeptScreen(first, {}), false);
  first.write("\x1b[?1049h\x1b[?7l\x1b[2J\x1b[H\x1b[?25l"); assert.deepEqual(first.got, ["\x1b[?1049h\x1b[?7l\x1b[2J\x1b[H\x1b[?25l"]);
  // The new board never came up: the terminal gets its plain screen and its cursor back.
  const dead = stream(); giveScreenBack(dead); assert.deepEqual(dead.got, ["\x1b[?1049l\x1b[?25h"]);
  // main.js uses all of it on the reload path.
  const main = (await import("node:fs")).readFileSync(new URL("../src/board/main.js", import.meta.url), "utf8");
  assert.match(main, /stopKeepingScreen\(\(\) => tui\.stop\(\)\); if \(!result\?\.reload\) giveScreenBack\(\)/); // closing takes the same way out, and then leaves the full-screen view: no last frame is printed above the prompt assert.match(main, /\.\.\.keptEnv\(\)/); assert.match(main, /startOnKeptScreen\(\);[^\n]*\n\s*tui\.start\(\)/); assert.match(main, /giveScreenBack\(\)/);
});
