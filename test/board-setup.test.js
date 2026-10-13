// The first run, and the board loading its new version.
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { world } from "./helpers.js";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { KEY, open } from "./board-helpers.js";

test("the first run is one screen: both choices, answered with single keys", async () => {
  const w = await world();
  try {
    const added = [];
    const offers = () => ({ asked: false, file: "/home/u/.config/herdr/config.toml", key: { suggest: "prefix+a" }, sidebar: {} });
    const checkKey = (k) => (k === "prefix+w" ? { ok: false, msg: "herdr itself uses prefix+w (workspace picker): the board would switch that off. Choose another." } : { ok: true });
    const addBlock = (what, arg) => { if (what === "key" && arg === "prefix+q") return { ok: false, msg: "herdr itself uses prefix+q. Choose another." }; added.push([what, arg]); return { ok: true, msg: "Added." }; };
    const start = (opts = {}) => {
      const tui = { terminal: { rows: 30, columns: 100 }, requestRender() {}, stop() {}, start() {} };
      const v = new View(tui, theme, () => {}, { cwd: w.root, offers: opts.offers || offers, addBlock, checkKey }); clearInterval(v.timer);
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
    // a key herdr uses is refused as it is typed, with what it does today: it never becomes the choice
    s.press("k"); for (const ch of "prefix+w") s.press(ch); s.press("enter");
    assert.match(s.text().replace(/\s+/g, " "), /herdr itself uses prefix\+w \(workspace picker\): the board would switch that off/);
    assert.equal(s.v.setup.typing, true); assert.match(s.text(), /Open this board with prefix\+a/); assert.deepEqual(added, []);
    for (const ch of "prefix+q") s.press(ch); s.press("enter");
    assert.match(s.text(), /Open this board with prefix\+q/); assert.doesNotMatch(s.text(), /herdr itself uses/);
    s.press("enter"); // herdr refuses that key: the screen stays and says why
    assert.ok(s.v.setup); assert.match(s.text(), /herdr itself uses prefix\+q/); assert.deepEqual(added, []);
    s.press("k"); for (const ch of "prefix+y") s.press(ch); s.press("enter", "2", "enter");
    assert.equal(s.v.setup, null); assert.deepEqual(added, [["key", "prefix+y"], ["sidebar", undefined]]);
    assert.match(s.text().replace(/\s+/g, " "), /Added to .*config\.toml: prefix\+y opens the board; herdr's sidebar shows each task's stage/);
    // prefix+a taken in the user's config: the next free key is offered, and the screen says why
    added.length = 0;
    s = start({ offers: () => ({ asked: false, file: "/home/u/.config/herdr/config.toml", key: { suggest: "prefix+y", note: "prefix+a is already bound in your config (lazygit), so this is the next free key." }, sidebar: null }) });
    assert.match(s.text().replace(/\s+/g, " "), /Open this board with prefix\+y, from anywhere in herdr prefix\+a is already bound in your config \(lazygit\), so this is the next free key\./);
    s.press("enter"); assert.deepEqual(added, [["key", "prefix+y"]]);
    // esc changes nothing and asks again next time
    added.length = 0; s = start(); s.press("esc");
    assert.equal(s.v.setup, null); assert.deepEqual(added, []); assert.match(s.text(), /Asked again next time\. Nothing was changed\./);
  } finally { w.cleanup(); }
});

test("after a plugin update the board loads the new version by itself, once nothing is half typed", async () => {
  const w = await world();
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
