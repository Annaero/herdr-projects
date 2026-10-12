// Going into an agent never ends the board: in a pane of its own it runs on, and opening the board goes back to it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as P from "../src/board/place.js";
import { main } from "../src/cli.js";
import { open } from "./board-helpers.js";

test("enter on a task goes into its agent and the board stays as it was: from the row, from the chat, with ownTerminal on and off", async () => {
  const w = await world({ settings: { helper: "off", coordinator: "off", reviewer: "off" } });
  try {
    process.env.HERDR_ENV = "1";
    w.script({ worker: [{ status: "working", screen: "● Editing greet.sh\n" }] });
    const id = A.add(w.root, "Add a greeting").id; A.add(w.root, "Another one");
    A.delegate(id); await settle(id);
    const pane = S.get(id).link.pane;
    const ways = { "from its row": [], "from its row, the chat hidden": ["alt+c"], "from the chat with its agent": ["space"] };
    for (const ownTerminal of [true, false]) for (const [way, keys] of Object.entries(ways)) {
      const what = `${way}, ownTerminal ${ownTerminal ? "on" : "off"}`;
      const s = open(w, { ctx: { ownTerminal, boardKey: "prefix+w" } });
      s.v.sel = id; s.v.filter = "greeting"; s.v.load();
      s.press(...keys);
      const before = w.state().focus.length;
      s.press("enter");
      assert.equal(s.closed(), undefined, `the board is not closed: ${what}`);
      assert.equal(s.v.leaving, undefined, what); assert.equal(s.v.disposed, false, what);
      assert.deepEqual(w.state().focus.slice(before), [`agent ${pane}`], `herdr moved to the agent: ${what}`);
      assert.equal(s.v.sel, id, what); assert.equal(s.v.filter, "greeting", what); assert.deepEqual(s.v.repo, S.repoOf(w.root), what);
      assert.match(s.text().replace(/\s+/g, " "), /Opened proj\/1's agent\. prefix\+w brings you back to the board\./, what);
      assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).sel, id, `where you were is saved: ${what}`);
      // It still takes keys when you are back, and a second enter goes in again.
      s.press("enter");
      assert.equal(s.closed(), undefined, what); assert.equal(w.state().focus.length, before + 2, what);
      if (way === "from its row") { s.press("esc"); assert.equal(s.v.filter, "", what); s.press("down"); assert.notEqual(s.v.sel, id, what); }
      s.v.dispose();
    }
    // While you are in the agent its task changes where it stands (it stops, it finishes): the selection is still on
    // that task when you come back, not on the row that took its place, and enter goes into the same agent again.
    {
      const s = open(w); s.v.sel = id; s.v.filter = ""; s.v.load(); // the filter of the board before came back with it
      s.press("enter"); assert.equal(s.closed(), undefined);
      A.stop(id); assert.equal(S.get(id).stage, "stopped");
      s.v.beat(); s.v.beat();
      assert.equal(s.v.sel, id, "the selection did not move to its neighbour"); assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).sel, id);
      const before = w.state().focus.length;
      s.press("enter");
      assert.doesNotMatch(s.text(), /No agent has been on this yet/); assert.deepEqual(w.state().focus.slice(before), [`agent ${pane}`]);
      s.v.beat(); assert.equal(s.v.sel, id);
      // Back and moving on your own: the rows follow the keys again.
      s.press("down"); if (s.v.sel === id) s.press("up");
      assert.equal(s.v.sel, "proj/2");
      s.v.dispose();
    }
    // The same under a filter the task stops matching while you are away ("working", and its agent stops): its row
    // stays, selected, until you move on yourself.
    {
      w.script({ worker: [{ status: "working", screen: "● Editing\n" }] });
      const other = A.add(w.root, "Say goodbye").id, near = A.add(w.root, "A working neighbour").id;
      A.delegate(other); await settle(other); assert.equal(S.get(other).stage, "working");
      const there = S.get(other).link.pane, shown = (s) => s.v.rows.filter((r) => r.rec).map((r) => r.rec.id).sort();
      const s = open(w); s.v.filter = "working"; s.v.sel = other; s.v.load();
      assert.deepEqual(shown(s), [other, near].sort());
      s.press("enter"); assert.equal(s.closed(), undefined);
      A.stop(other); s.v.beat(); s.v.beat();
      assert.equal(s.v.sel, other, "the selection did not move to the task that still matches"); assert.equal(s.v.filter, "working");
      assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).sel, other);
      const before = w.state().focus.length;
      s.press("enter");
      assert.doesNotMatch(s.text(), /No agent has been on this yet/); assert.deepEqual(w.state().focus.slice(before), [`agent ${there}`]);
      // Moving on yourself lets the row go: it does not match what you are looking for.
      s.press("down"); if (s.v.sel === other) s.press("up");
      s.v.beat(); assert.equal(s.v.sel, near); assert.deepEqual(shown(s), [near]);
      s.v.filter = ""; s.v.dispose();
    }
    // Outside a herdr client (plain SSH) the same terminal attaches to the agent and the board comes back when that
    // ends. It is the same there: the task stopped while you were in it, under a filter it no longer matches.
    {
      w.script({ worker: [{ status: "working", screen: "● Editing\n" }] });
      const other = A.add(w.root, "Say hello again").id, near = A.add(w.root, "Another working neighbour").id;
      A.delegate(other); await settle(other);
      const there = S.get(other).link.pane, went = [];
      delete process.env.HERDR_ENV;
      const write = process.stdout.write; process.stdout.write = () => true; // the attach clears the screen first
      try {
        const s = open(w, { ctx: { attach: (pane) => { went.push(pane); A.stop(other); } } }); s.v.filter = "working"; s.v.sel = other; s.v.load();
        s.press("enter");
        assert.deepEqual(went, [there]); assert.equal(s.closed(), undefined); assert.equal(S.get(other).stage, "stopped");
        assert.equal(s.v.sel, other, "back on the task you went into"); s.v.beat(); s.v.beat(); assert.equal(s.v.sel, other);
        s.press("enter"); assert.deepEqual(went, [there, there]);
        s.press("down"); if (s.v.sel === other) s.press("up");
        s.v.beat(); assert.notEqual(s.v.sel, other); assert.ok(!s.v.rows.some((r) => r.rec?.id === other));
        s.v.filter = ""; s.v.dispose();
      } finally { process.stdout.write = write; process.env.HERDR_ENV = "1"; }
      assert.ok(near);
    }
    // An agent that has exited leaves a bare pane: herdr goes to its space and tab, and the board stays too.
    w.patchState((st) => { st.panes.find((p) => p.pane_id === pane).agent = null; });
    const s = open(w); s.v.sel = id; s.v.load();
    const before = w.state().focus.length;
    s.press("enter");
    assert.equal(s.closed(), undefined); assert.match(w.state().focus.slice(before).join(" "), /^workspace \S+/); assert.match(s.text(), /The board stays here\./);
    s.v.dispose();
    // Only a board someone opened as herdr's popup closes for an agent: a popup lies over every pane, the agent's too.
    // The board key never opens one (the next test), and it comes back where it was.
    const p = open(w, { ctx: { popup: true } }); p.v.sel = id; p.v.load(); p.press("enter");
    assert.deepEqual(p.closed(), { entered: id }); p.v.dispose();
    assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).sel, id);
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("opening the board from anywhere in herdr goes back to the one that is running, and opens it in a tab of its own, never the popup, when there is none", async () => {
  const w = await world({ settings: { helper: "off", coordinator: "off" } });
  try {
    w.patchState((s) => { s.workspaces.push({ workspace_id: "w9", label: "b", cwd: w.root }); s.panes.push({ pane_id: "w9:p1", workspace_id: "w9", tab_id: "w9:t1", terminal_id: "term_board", cwd: w.root, agent: null }); });
    assert.equal(P.ownPane({ HERDR_ENV: "1", HERDR_PANE_ID: "w9:p1" }), "w9:p1");
    assert.equal(P.ownPane({ HERDR_ENV: "1", HERDR_PANE_ID: "w9:t2", HERDR_PLUGIN_ID: "herdr-superwork" }), "w9:t2", "the plugin's own tab is a pane like any other");
    assert.equal(P.ownPane({ HERDR_ENV: "1", HERDR_PLUGIN_ID: "herdr-superwork" }), "", "a popup is no pane to go back to");
    assert.equal(P.ownPane({ HERDR_PANE_ID: "w9:p1" }), "");
    assert.equal(P.inPopup({ HERDR_ENV: "1", HERDR_PLUGIN_ID: "herdr-superwork" }), true);
    assert.equal(P.inPopup({ HERDR_ENV: "1", HERDR_PLUGIN_ID: "herdr-superwork", HERDR_PANE_ID: "w9:t2" }), false); assert.equal(P.inPopup({ HERDR_ENV: "1", HERDR_PANE_ID: "w9:p1" }), false);
    // The plugin's own entry says the same: a tab, so nothing of it is herdr's one popup.
    assert.match(fs.readFileSync(path.join(S.ROOT, "herdr-plugin.toml"), "utf8"), /\[\[panes\]\]\nid = "board"\n[^\[]*\nplacement = "tab"\n/);
    // No board is running: one is opened in a tab of its own, named, and herdr goes to it.
    assert.equal(await main(["open"]), 0);
    assert.equal(w.state().boardPlacement, "tab");
    const made = w.state().panes.find((x) => x.label === "Work board"); assert.ok(made);
    assert.equal(w.state().tabs.find((t) => t.tab_id === made.tab_id).label, "board");
    assert.deepEqual(w.state().focus, ["board", `workspace ${made.workspace_id}`, `tab ${made.tab_id}`]);
    w.patchState((s) => { s.focus = ["board"]; });
    // One is running in a pane: herdr goes to its space and tab, and no second board is started.
    P.arrive("w9:p1");
    assert.equal(await main(["open"]), 0); assert.deepEqual(w.state().focus, ["board", "workspace w9", "tab w9:t1"]);
    // The board shares its tab with another pane that has the keyboard (the agent you went into, split beside it):
    // the keyboard goes to the board's pane, and the tab is as it was, not left zoomed.
    w.patchState((s) => { s.panes.push({ pane_id: "w9:p2", workspace_id: "w9", tab_id: "w9:t1", terminal_id: "term_agent", cwd: w.root, agent: null }); s.layouts = { "w9:p1": { zoomed: false, focused_pane_id: "w9:p2", panes: [] } }; });
    assert.equal(await main(["open"]), 0);
    assert.deepEqual(w.state().focus.slice(-3), ["workspace w9", "tab w9:t1", "pane w9:p1"]);
    assert.deepEqual(w.state().layouts["w9:p1"], { zoomed: false, focused_pane_id: "w9:p1", panes: [] });
    // It has the keyboard already: nothing is zoomed, not even for a moment.
    assert.equal(await main(["open"]), 0); assert.deepEqual(w.state().focus.slice(-2), ["workspace w9", "tab w9:t1"]);
    // The tab was zoomed on the other pane: the board takes the zoom, since a zoomed tab shows one pane only.
    w.patchState((s) => { s.layouts["w9:p1"] = { zoomed: true, focused_pane_id: "w9:p2", panes: [] }; });
    assert.equal(await main(["open"]), 0); assert.deepEqual(w.state().layouts["w9:p1"], { zoomed: true, focused_pane_id: "w9:p1", panes: [] });
    w.patchState((s) => { delete s.layouts; });
    // Its pane was closed, or the board in it ended without saying so: a new one is opened.
    const note = fs.readdirSync(S.dataDir()).filter((f) => f.startsWith("board-pane-")).map((f) => path.join(S.dataDir(), f));
    assert.equal(note.length, 1);
    S.writeJson(note[0], { pane: "w9:p1", pid: 2 ** 22 + 1 }); // no process has this number
    assert.equal(P.goBack(), false);
    S.writeJson(note[0], { pane: "gone:p1", pid: process.pid });
    assert.equal(P.goBack(), false);
    const n = w.state().focus.length;
    assert.equal(await main(["open"]), 0); assert.equal(w.state().focus[n], "board");
    // Another board's note is left alone; the board that wrote it takes it away when it ends.
    S.writeJson(note[0], { pane: "w9:p1", pid: 1 }); P.depart(); assert.ok(fs.existsSync(note[0]));
    P.arrive("w9:p1"); P.depart(); assert.ok(!fs.existsSync(note[0]));
  } finally { w.cleanup(); }
});
