// The keys list is the one place a key is defined: moving a key there moves it in the handler, the ? menu, the hints
// and the messages, with no other file changed.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { KEY } from "../src/board/keys.js";
import { pages } from "../scripts/docs.js";
import { open } from "./board-helpers.js";

test("the keys list: a key moved in its entry is moved everywhere, and its old chord does nothing", async () => {
  const w = await world({ settings: { helper: "off", reviewer: "off" } });
  const was = {};
  const move = (id, keys) => { was[id] = { keys: KEY[id].keys, show: KEY[id].show }; KEY[id].keys = keys; delete KEY[id].show; };
  try {
    const s = open(w);
    s.type("First"); s.press("enter"); s.type("Second"); s.press("enter");
    move("enter", ["alt+e"]); move("down", ["alt+j"]); move("up", ["alt+k"]); move("yes", ["alt+q"]); move("delegate", ["alt+d"]); move("back", ["alt+b"]); move("menu", ["alt+m"]); KEY.menu.raw = undefined;
    // typing and sending: the old enter is typed text's business now, the new one sends
    s.type("Third"); assert.match(s.text(), /alt\+e add a task · alt\+d add it and start an agent · alt\+b put away/);
    s.press("\x1be"); assert.equal(S.list().length, 3); assert.equal(s.v.value(), "");
    // moving in the list
    const at = s.v.sel; s.press("down", "up"); assert.equal(s.v.sel, at, "the old chords no longer move");
    s.press("\x1bj"); const lower = s.v.sel; s.press("\x1bk", "\x1bk"); assert.notEqual(s.v.sel, lower, "the new ones do");
    // the menu: opened, moved in and picked from with the moved keys
    s.press("?"); assert.equal(s.v.menu, null); s.v.setValue("");
    s.press("\x1bm"); assert.ok(s.v.menu); assert.match(s.text(), /alt\+k alt\+j  move between tasks/); assert.match(s.text(), /alt\+k alt\+j pick · alt\+e do it · alt\+b close/);
    s.press("down"); assert.equal(s.v.menu.at, 0); s.press("\x1bj"); assert.equal(s.v.menu.at, 1);
    s.press("enter"); assert.ok(s.v.menu, "the old enter picks nothing"); s.press("\x1bb"); assert.equal(s.v.menu, null);
    // a message written outside the view names the moved key too
    const id = s.v.sel; S.update(id, (t) => { t.stage = "nosummary"; t.link = { pane: "p1" }; });
    assert.match(A.failureOf(S.get(id)).next, /ctrl\+r tells the agent to continue; alt\+q takes the work as it is/);
    // and the page made from the list
    assert.match(pages()["docs/keys.md"], /\| `Alt\+Q` \| yes, to whatever the task waits for/);
  } finally { for (const [id, o] of Object.entries(was)) { KEY[id].keys = o.keys; if (o.show !== undefined) KEY[id].show = o.show; } KEY.menu.raw = ["?"]; w.cleanup(); }
});
