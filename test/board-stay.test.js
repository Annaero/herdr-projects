// Going into an agent never ends the board: in a pane of its own it runs on, and opening the board goes back to it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as P from "../src/board/place.js";
import * as Popup from "../src/board/popup.js";
import { say, heard } from "../src/board/say.js";
import { main } from "../src/cli.js";
import { open } from "./board-helpers.js";

test("enter on a task goes into its agent and the board stays as it was: from the row, from the chat", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    process.env.HERDR_ENV = "1";
    w.script({ worker: [{ status: "working", screen: "● Editing greet.sh\n" }] });
    const id = A.add(w.root, "Add a greeting").id; A.add(w.root, "Another one");
    A.delegate(id); await settle(id);
    const pane = S.get(id).link.pane;
    const ways = { "from its row": [], "from its row, the chat hidden": ["alt+c"], "from the chat with its agent": ["space"] };
    for (const [way, keys] of Object.entries(ways)) {
      const what = way;
      const s = open(w, { ctx: { boardKey: "prefix+w" } });
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
    assert.equal(S.readJson(path.join(S.dataDir(), "view-popup.json")).sel, id);
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("opening the board from anywhere in herdr goes back to the one that is running, and opens it in a tab of its own, never the popup, when there is none", async () => {
  const w = await world();
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

// ---- the board key's two ways to open the board (`board.open`): the popup it opens, closes and moves, beside a board
// in a tab; and the tab, where the key pressed on the board itself goes back to where you came from.
// A space with a shell in it, and a second tab: where the human is when the key is pressed.
const space = (w) => w.patchState((s) => {
  s.workspaces.push({ workspace_id: "w9", label: "b", cwd: w.root });
  for (const [pane, tab] of [["w9:p1", "w9:t1"], ["w9:p2", "w9:t2"]]) s.panes.push({ pane_id: pane, workspace_id: "w9", tab_id: tab, terminal_id: `term_${pane}`, cwd: w.root, agent: null });
});
const note = (name) => S.readJson(path.join(S.dataDir(), `board-${name}-default.json`));
const overlays = (w) => w.state().panes.filter((p) => p.label === "Work board" && /:over/.test(p.pane_id));

test("board.open is a setting like the others: a tab unless you choose the popup", async () => {
  const w = await world();
  try {
    assert.equal(S.setting("board.open"), "tab"); assert.equal(Popup.wanted(), false);
    assert.equal(await main(["set", "board.open", "popup"]), 0); assert.equal(Popup.wanted(), true);
    await assert.rejects(() => main(["set", "board.open", "window"]), /tab|popup/);
    assert.equal(await main(["unset", "board.open"]), 0); assert.equal(S.setting("board.open"), "tab");
    // The board the key opens in the overlay is told so; herdr's floating popup has no pane; anything else is a pane.
    const over = { HERDR_ENV: "1", HERDR_PLUGIN_ID: "herdr-superwork", HERDR_PANE_ID: "w9:p7", HERDR_SUPERWORK_POPUP: "1" };
    assert.equal(Popup.overPane(over), "w9:p7"); assert.equal(P.inPopup(over), true); assert.equal(P.ownPane(over), "", "a popup is never gone back to");
    assert.equal(Popup.overPane({ ...over, HERDR_SUPERWORK_POPUP: "" }), ""); assert.equal(P.inPopup({ ...over, HERDR_SUPERWORK_POPUP: "" }), false);
    assert.deepEqual(P.context({ HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_id: "w9:p1", tab_id: "w9:t1" }) }), { pane: "w9:p1", tab: "w9:t1" });
    assert.deepEqual(P.context({ HERDR_PLUGIN_CONTEXT_JSON: "{" }), { pane: "", tab: "" });
  } finally { w.cleanup(); }
});

test("with the popup chosen the key opens the board over the tab you are in, closes it when pressed again, and takes one left behind over another tab with it", async () => {
  const w = await world({ settings: { "board.open": "popup" } });
  const waited = Popup.pace.goneMs; Popup.pace.goneMs = 0; // the board that closes is this test's own process
  try {
    space(w);
    const here = { pane: "w9:p1", tab: "w9:t1" };
    w.patchState((s) => { s.shows = "w9:t1"; });
    // None is open: one opens in herdr's overlay, told that it is the popup. No tab is made.
    const first = P.show(undefined, { here });
    assert.equal(overlays(w).length, 1); assert.equal(overlays(w)[0].pane_id, first); assert.deepEqual(overlays(w)[0].env, ["HERDR_SUPERWORK_POPUP=1"]);
    assert.equal(w.state().boardPlacement, "overlay"); assert.ok(!w.state().tabs?.some((t) => t.label === "board"));
    // Pressed again before its board has even started: that one is closed, and no second is laid over it.
    assert.equal(note("popup").pane, first);
    assert.equal(P.show(undefined, { here: { pane: first, tab: "w9:t1" } }), ""); assert.equal(overlays(w).length, 0); assert.equal(note("popup"), null);
    assert.equal(P.show(undefined, { here }), first.replace(/\d+$/, (n) => String(Number(n) + 1))); assert.equal(overlays(w).length, 1);
    const up = overlays(w)[0].pane_id;
    Popup.arrive(up); // its board starts and writes down where it is
    assert.equal(note("popup").pid, process.pid);
    // A command that needs the board (approve the task in this pane) leaves the one that shows open.
    assert.equal(P.show(undefined, { here: { pane: up, tab: "w9:t1" }, keep: true }), up); assert.equal(overlays(w).length, 1);
    // Pressed again while it shows: closed. herdr gives the key to the popup's own pane, so that is where it comes from.
    assert.equal(P.show(undefined, { here: { pane: up, tab: "w9:t1" } }), ""); assert.equal(overlays(w).length, 0);
    assert.equal(w.state().focus.at(-1), `closed ${up}`);
    // Left behind over a tab you are no longer in, where herdr hides it: closed there, opened here. The key is never dead.
    const second = P.show(undefined, { here }); Popup.arrive(second);
    w.patchState((s) => { s.shows = "w9:t2"; });
    const third = P.show(undefined, { here: { pane: "w9:p2", tab: "w9:t2" } });
    assert.deepEqual(overlays(w).map((p) => [p.pane_id, p.tab_id]), [[third, "w9:t2"]]); assert.notEqual(third, second);
    assert.deepEqual(w.state().focus.slice(-2), [`closed ${second}`, "over w9:t2"]);
    // Its board ended without saying so (its pane is gone): the note is taken away and a new one opens.
    S.writeJson(path.join(S.dataDir(), "board-popup-default.json"), { pane: "gone:p1", pid: process.pid });
    w.patchState((s) => { s.panes = s.panes.filter((p) => !/:over/.test(p.pane_id)); });
    assert.ok(P.show(undefined, { here: { pane: "w9:p2", tab: "w9:t2" } })); assert.equal(overlays(w).length, 1);
    // Only the board that wrote the note takes it away.
    Popup.arrive("w9:p7"); S.writeJson(path.join(S.dataDir(), "board-popup-default.json"), { pane: "w9:p7", pid: 1 }); Popup.depart(); assert.ok(note("popup"));
    Popup.arrive("w9:p7"); Popup.depart(); assert.equal(note("popup"), null);
  } finally { Popup.pace.goneMs = waited; w.cleanup(); }
});

test("a board in a tab keeps running beside the popup: each has its own note, and its own selection and words", async () => {
  const w = await world({ settings: { "board.open": "popup" } });
  const waited = Popup.pace.goneMs; Popup.pace.goneMs = 0;
  try {
    space(w);
    process.env.HERDR_ENV = "1";
    const a = A.add(w.root, "First").id, b = A.add(w.root, "Second").id;
    P.arrive("w9:p2"); // a board you started yourself in a pane
    const tab = open(w, { ctx: { ownPane: "w9:p2" } }); tab.v.sel = a; tab.v.load(); tab.type("for the tab"); tab.v.savePrefs();
    const over = P.show(undefined, { here: { pane: "w9:p1", tab: "w9:t1" } }); Popup.arrive(over);
    assert.equal(note("pane").pane, "w9:p2", "the tab board's note is its own"); assert.equal(note("popup").pane, over);
    // The first popup starts from the tab's view, without the words typed there: they are in that board's box.
    const pop = open(w, { ctx: { popup: true, ownPane: over } });
    assert.equal(pop.v.sel, a); assert.equal(pop.v.value(), "");
    pop.v.sel = b; pop.v.load(); pop.type("for the popup"); pop.v.dispose();
    assert.equal(S.readJson(path.join(S.dataDir(), "view-popup.json")).draft, "for the popup");
    assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).draft, "for the tab"); assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).sel, a);
    const again = open(w, { ctx: { popup: true, ownPane: over } }); assert.equal(again.v.sel, b); assert.equal(again.v.value(), "for the popup");
    // esc steps back as on every board (the draft is put away), and the last esc closes the popup. The tab board
    // only shows how it closes.
    again.press("esc"); assert.equal(again.closed(), undefined); assert.equal(again.v.value(), "");
    again.press("esc"); assert.equal(again.closed(), null);
    tab.press("esc", "esc"); assert.equal(tab.closed(), undefined); assert.match(tab.text(), /Press ctrl\+c again to close the board/);
    // Closing the popup leaves the tab board's note alone.
    P.show(undefined, { here: { pane: over, tab: "w9:t1" } }); assert.equal(note("pane").pane, "w9:p2");
    // "Approve the task in this pane" is asked by the board that was shown for it, not by whichever looks first.
    A.askApprove(a, undefined, over);
    assert.equal(A.takeApprove(undefined, "w9:p2"), "", "the tab board leaves it"); assert.equal(A.takeApprove(undefined, over), a);
    A.askApprove(a); assert.equal(A.takeApprove(undefined, "w9:p2"), a, "one for no board in particular is anybody's");
  } finally { delete process.env.HERDR_ENV; Popup.pace.goneMs = waited; w.cleanup(); }
});

test("the popup opens on the task of the pane you were in, and words left in its box stay with the repo they were typed for", async () => {
  const w = await world();
  try {
    space(w);
    process.env.HERDR_ENV = "1";
    const a = A.add(w.root, "First").id, b = A.add(w.root, "Second").id, c = A.add(w.root, "Third").id;
    S.update(b, (t) => { t.link = { socket: w.socket, workspace: "w9", tab: "w9:t1", pane: "w9:p1" }; });
    S.update(c, (t) => { t.link = { socket: w.socket, workspace: "w9", tab: "w9:t2", pane: "w9:p9", reviewer: { pane: "w9:p2" } }; });
    assert.equal(Popup.taskAt("w9:p1").id, b); assert.equal(Popup.taskAt("w9:p2").id, c, "its reviewer's pane too"); assert.equal(Popup.taskAt("w9:p5"), null); assert.equal(Popup.taskAt(""), null);
    S.writeJson(path.join(S.dataDir(), "view-popup.json"), { sel: a, filter: "first" });
    // From the agent's pane: that task, shown also while the filter left from last time would hide it.
    const s = open(w, { ctx: { popup: true, from: "w9:p1" } });
    assert.equal(s.v.sel, b); assert.match(s.text(), /Second/);
    // The popup was last looking at one other machine only: this machine's tasks show, or the task would be hidden
    // and the chat would talk to that machine. Every machine at once has the task, and stays.
    S.writeJson(path.join(S.dataDir(), "view-popup.json"), { sel: a, scope: "otherbox" });
    const far = open(w, { ctx: { popup: true, from: "w9:p1" } });
    assert.equal(far.v.scope, ""); assert.equal(far.v.sel, b); assert.match(far.text(), /Second/); assert.equal(far.v.current()?.id, b);
    assert.equal(open(w, { ctx: { popup: true, from: "w9:p5" } }).v.scope, "otherbox", "from no task's pane the view is as it was left");
    S.writeJson(path.join(S.dataDir(), "view-popup.json"), { sel: a, scope: "*" });
    const all = open(w, { ctx: { popup: true, from: "w9:p1" } }); assert.equal(all.v.scope, "*"); assert.equal(all.v.sel, b);
    S.writeJson(path.join(S.dataDir(), "view-popup.json"), { sel: a, filter: "first" });
    // From a pane that is no task's: where the popup was when it closed.
    assert.equal(open(w, { ctx: { popup: true, from: "w9:p5" } }).v.sel, a);
    // A board in a pane stays where you left it, wherever you come from.
    S.writeJson(path.join(S.dataDir(), "view.json"), { sel: a });
    assert.equal(open(w, { ctx: { from: "w9:p1" } }).v.sel, a);
    // Words left in the popup's box are sent from the repo they were typed in, also when it reopens somewhere else.
    S.writeJson(path.join(S.dataDir(), "view-popup.json"), {});
    const other = fs.mkdtempSync(path.join(w.base, "elsewhere-"));
    const typed = open(w, { ctx: { popup: true } }); typed.type("Fix the greeting"); typed.v.dispose();
    assert.equal(S.readJson(path.join(S.dataDir(), "view-popup.json")).cwd, w.root);
    // Reopened from a pane in another folder: the draft is back, and the board is still in the repo it was typed for.
    const dr = open(w, { ctx: { popup: true, cwd: other } });
    assert.equal(dr.v.value(), "Fix the greeting"); assert.equal(dr.v.ctx.cwd, w.root); assert.equal(dr.v.repo.name, "proj");
    assert.match(dr.text().replace(/\s+/g, " "), /What you typed was for proj, so the board is there now\. Once it is sent or put away, it opens where you are\./);
    dr.press("enter");
    const made = S.list().find((t) => t.title === "Fix the greeting"); assert.equal(made.root, w.root); assert.equal(made.repo, "proj");
    dr.v.dispose();
    // With nothing left in the box the popup opens where you are.
    assert.equal(open(w, { ctx: { popup: true, cwd: other } }).v.ctx.cwd, other);
    // Words put away with esc keep their repo too: brought back in a popup that opened elsewhere, the board goes to
    // the repo they were typed for and says so, and enter sends them from there.
    const put = open(w, { ctx: { popup: true } }); put.type("Tidy the greeting"); put.press("esc"); assert.equal(put.v.value(), ""); put.v.dispose();
    assert.equal(S.readJson(path.join(S.dataDir(), "view-popup.json")).away.cwd, w.root);
    const far2 = open(w, { ctx: { popup: true, cwd: other } });
    assert.equal(far2.v.ctx.cwd, other); assert.equal(far2.v.value(), "");
    far2.v.dispose(); // closed and opened once more elsewhere: the words still know where they are from
    assert.equal(S.readJson(path.join(S.dataDir(), "view-popup.json")).away.cwd, w.root);
    const back = open(w, { ctx: { popup: true, cwd: other } });
    back.press("ctrl+z");
    assert.equal(back.v.value(), "Tidy the greeting"); assert.equal(back.v.ctx.cwd, w.root); assert.equal(back.v.repo.name, "proj");
    assert.match(back.text().replace(/\s+/g, " "), /What you typed was for proj, so the board is there now\./); assert.match(back.text(), /herdr-superwork {2}proj · /);
    back.press("enter");
    assert.equal(S.list().find((t) => t.title === "Tidy the greeting").root, w.root); assert.ok(!S.list().some((t) => t.root === other));
    back.v.dispose();
    // The folder the words were typed for is gone (removed, moved): there is no repo to go back to, so the board says
    // where they go now, for a draft in the box and for words brought back alike. Never without a word.
    const lost = path.join(w.base, "was-here"), goneMsg = /What you typed was for was-here, a folder that is gone\. Sent now, it goes from elsewhere-\w+; esc puts it away\./;
    S.writeJson(path.join(S.dataDir(), "view-popup.json"), { draft: "old words", cwd: lost });
    const g1 = open(w, { ctx: { popup: true, cwd: other } });
    assert.equal(g1.v.ctx.cwd, other); assert.equal(g1.v.value(), "old words"); assert.match(g1.text().replace(/\s+/g, " "), goneMsg);
    S.writeJson(path.join(S.dataDir(), "view-popup.json"), { away: { text: "older words", to: "", cwd: lost }, cwd: lost });
    const g2 = open(w, { ctx: { popup: true, cwd: other } });
    assert.doesNotMatch(g2.text(), /folder that is gone/); g2.press("ctrl+z");
    assert.equal(g2.v.value(), "older words"); assert.equal(g2.v.ctx.cwd, other); assert.match(g2.text().replace(/\s+/g, " "), goneMsg);
    // The same repo from another of its folders is no move, and nothing is said. A board in a pane is where you started it.
    const sub = path.join(w.root, "sub"); fs.mkdirSync(sub);
    S.writeJson(path.join(S.dataDir(), "view-popup.json"), { draft: "more", cwd: w.root });
    assert.doesNotMatch(open(w, { ctx: { popup: true, cwd: sub } }).text(), /What you typed was for/);
    S.writeJson(path.join(S.dataDir(), "view.json"), { draft: "more", cwd: w.root });
    assert.equal(open(w, { ctx: { cwd: other } }).v.ctx.cwd, other);
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("herdr will not open the popup: the board opens in a tab and says why", async () => {
  const w = await world({ settings: { "board.open": "popup" } });
  try {
    space(w);
    w.patchState((s) => { s.busy = "ui_busy"; });
    const pane = P.show(undefined, { here: { pane: "w9:p1", tab: "w9:t1" } });
    assert.equal(w.state().boardPlacement, "tab"); assert.ok(pane); assert.equal(overlays(w).length, 0);
    // The line is for that board: another one leaves it, and it is said once.
    assert.equal(heard("w9:p2"), null);
    const s = open(w, { ctx: { ownPane: pane } });
    assert.match(s.text().replace(/\s+/g, " "), /herdr has another popup open, maybe hidden behind another tab, and shows one at a time\. Close that one for the board's popup\. Until then the board is here, in a tab\./);
    assert.equal(heard(pane), null);
    // That board runs now: the key goes to it and says it again, while herdr still refuses. It never goes "back".
    P.arrive(pane);
    assert.equal(P.show(undefined, { here: { pane, tab: "x" } }), pane);
    s.v.msg = ""; s.v.beat(); assert.match(s.text(), /herdr has another popup open/);
    // Any other refusal is said with herdr's own words.
    w.patchState((s) => { s.busy = "boom"; });
    P.show(undefined, { here: { pane: "w9:p1", tab: "w9:t1" } });
    s.v.msg = ""; s.v.beat(); assert.match(s.text(), /herdr did not open the popup \(herdr said no\)\. Until then/);
    // A line nobody took in time is dropped, not shown late.
    say(pane, "old news"); assert.equal(heard(pane, undefined, Date.now() + 60000), null); assert.equal(heard(pane), null);
    s.v.dispose();
  } finally { w.cleanup(); }
});

test("with the tab chosen, the key pressed on the board itself goes back to where you came from, and says so when there is nowhere to go", async () => {
  const w = await world();
  try {
    space(w);
    w.patchState((s) => { s.panes.push({ pane_id: "w9:board", workspace_id: "w9", tab_id: "w9:t3", terminal_id: "term_b", cwd: w.root, agent: null }); });
    // The board the key opened knows from herdr which pane you came from.
    P.arrive("w9:board", undefined, { HERDR_PLUGIN_ID: "herdr-superwork", HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_id: "w9:p1", tab_id: "w9:t1" }) });
    assert.equal(note("pane").from, "w9:p1");
    // Pressed on the board: herdr goes back to that pane's space and tab.
    w.patchState((s) => { s.focus = []; });
    assert.equal(P.show(undefined, { here: { pane: "w9:board", tab: "w9:t3" } }), "w9:board");
    assert.deepEqual(w.state().focus, ["workspace w9", "tab w9:t1"]);
    // Pressed from another pane: to the board, and that pane is where the next press on the board goes back to.
    P.show(undefined, { here: { pane: "w9:p2", tab: "w9:t2" } });
    assert.deepEqual(w.state().focus.slice(-2), ["workspace w9", "tab w9:t3"]); assert.equal(note("pane").from, "w9:p2");
    P.show(undefined, { here: { pane: "w9:board", tab: "w9:t3" } }); assert.deepEqual(w.state().focus.slice(-2), ["workspace w9", "tab w9:t2"]);
    // A board that loads its new version in the same pane keeps what was written down since.
    P.arrive("w9:board", undefined, { HERDR_PLUGIN_ID: "herdr-superwork", HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_id: "w9:p1" }) }); assert.equal(note("pane").from, "w9:p2");
    // A command that needs the board (approve) stays on it.
    const n = w.state().focus.length;
    P.show(undefined, { here: { pane: "w9:board", tab: "w9:t3" }, keep: true }); assert.deepEqual(w.state().focus.slice(n), ["workspace w9", "tab w9:t3"]);
    // The pane you came from is closed, or the board was started by hand: the board says that it is the board.
    w.patchState((s) => { s.panes = s.panes.filter((p) => p.pane_id !== "w9:p2"); s.focus = []; });
    P.show(undefined, { here: { pane: "w9:board", tab: "w9:t3" } });
    assert.deepEqual(w.state().focus, []);
    const s = open(w, { ctx: { ownPane: "w9:board" } });
    assert.match(s.text(), /This is the board already\. There is no pane to go back to\./); s.v.dispose();
    fs.rmSync(path.join(S.dataDir(), "board-pane-default.json")); P.arrive("w9:board", undefined, {}); assert.equal(note("pane").from, undefined);
    P.show(undefined, { here: { pane: "w9:board", tab: "w9:t3" } }); assert.ok(heard("w9:board"));
  } finally { w.cleanup(); }
});
