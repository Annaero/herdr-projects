// The board's own tab: named herdr-superwork while the board is open in a pane, its old name back when it closes.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers.js";
import { herdr } from "../src/herdr.js";
import { boardPane, nameBoardTab, restoreBoardTab, BOARD_TAB } from "../src/board/tab.js";

const labels = (w) => w.state().tabs.map((t) => t.label);
const renames = (w) => w.state().calls.filter((c) => /^tab rename/.test(c));

test("only a board full screen in a pane of herdr has a tab to name: not the popup, not outside herdr", () => {
  assert.equal(boardPane({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" }), "w1:p1");
  assert.equal(boardPane({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_PLUGIN_ID: "herdr-superwork" }), ""); // the plugin's own tab, which the board key names `board`
  assert.equal(boardPane({ HERDR_ENV: "1", HERDR_PLUGIN_ID: "herdr-superwork" }), ""); // the popup: no pane
  assert.equal(boardPane({ HERDR_PANE_ID: "w1:p1" }), ""); assert.equal(boardPane({}), ""); // outside herdr
  assert.equal(boardPane({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", TMUX: "/tmp/tmux" }), "");
});

test("the board's tab is named herdr-superwork while it is open, and has its old name again when it closes", async () => {
  const w = await world();
  try {
    const api = herdr();
    const a = api.workspaceCreate({ cwd: w.root }).root_pane, b = api.tabCreate({ workspace: a.workspace_id, label: "notes" }).root_pane;
    assert.equal(BOARD_TAB, "herdr-superwork");
    // only the tab the board runs in, and nothing is focused
    const named = nameBoardTab(b.pane_id);
    assert.deepEqual(labels(w), ["1", "herdr-superwork"]); assert.deepEqual(named.tab, b.tab_id); assert.deepEqual(w.state().focus, []);
    restoreBoardTab(named);
    assert.deepEqual(labels(w), ["1", "notes"]);
    // a tab never named gets its number back
    restoreBoardTab(nameBoardTab(a.pane_id)); assert.deepEqual(labels(w), ["1", "notes"]); assert.equal(renames(w).length, 4);
    // no pane (the popup, outside herdr), or a pane herdr does not know: nothing is renamed
    assert.equal(nameBoardTab(""), null); assert.equal(nameBoardTab("w9:p9"), null); restoreBoardTab(null); assert.equal(renames(w).length, 4);
    // a board that was killed left the name: the next one in that tab still puts the first name back
    nameBoardTab(b.pane_id);
    restoreBoardTab(nameBoardTab(b.pane_id)); assert.deepEqual(labels(w), ["1", "notes"]);
    // a name you gave the tab while the board was open is yours: it stays
    const again = nameBoardTab(b.pane_id);
    api.tabRename(b.tab_id, "mine"); restoreBoardTab(again); assert.deepEqual(labels(w), ["1", "mine"]);
    // a herdr that does not answer never stops the board
    w.patchState((st) => { st.tabs = []; }); assert.equal(nameBoardTab(b.pane_id), null);
  } finally { w.cleanup(); }
});
