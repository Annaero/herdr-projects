// The task details of a reviewed task with evidence, and what the board shows when a part of it fails to draw.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { open, keyed } from "./board-helpers.js";
import { undefinedNames } from "../scripts/names.js";

// A task that had several reviews, the newest one with evidence: what herdr-superwork/85 was when its page failed.
function reviewed(w) {
  const id = A.add(w.root, "Build a flying game", { description: "A small game." }).id;
  S.update(id, (t) => {
    t.reviews = [
      { round: 1, at: Date.now() - 7200000, score: 2, recommend: false, text: "Crashes on start.", problems: ["game.js: null plane."], checks: ["Ran it."] },
      { round: 2, at: Date.now() - 3600000, error: "the reviewer finished without a verdict" },
      { round: 3, at: Date.now() - 60000, score: 4, recommend: true, text: "Fine now.", checks: ["Ran the tests: all pass."] }];
    t.reviewRound = 3;
    t.review = { score: 4, recommend: true, text: "Fine now.", artifacts: [
      { file: "takeoff.png", caption: "The plane takes off", detail: "A screenshot of the first level.", link: "https://example.test/proj/1/takeoff.png" },
      { file: "tests.txt", caption: "The test run", link: "https://example.test/proj/1/tests.txt" }] };
  });
  return id;
}

test("the task details of a task with reviews and evidence show every review and every piece of evidence", async () => {
  const w = await world();
  try {
    const id = reviewed(w);
    const s = open(w, { rows: 80 });
    s.v.sel = id; s.v.load();
    // Beside the list: the latest review, the first piece of evidence, and where the rest is.
    let text = s.text(120);
    assert.match(text, /Reviews · 3 ─/); assert.match(text, /↗ The plane takes off/); assert.match(text, keyed(/… 1 more: {panel}/));
    s.press("alt+t");
    text = s.text(120);
    assert.doesNotMatch(text, /view error|could not be shown|is not defined/);
    assert.match(text, /^ Task details {2}#1 "Build a flying game"/);
    assert.match(text, /\n Reviews · 3 ─+ *\n History {6}2\/5 no → no verdict → 4\/5 yes *\n/);
    for (const n of [1, 2, 3]) assert.match(text, new RegExp(`\\n Review ${n} {5}[✓✗–] `));
    // Each piece of evidence: its name, what it is, and its link printed in full.
    assert.match(text, /\n Evidence ─+ *\n ↗ The plane takes off *\n[ ▌] {2}A screenshot of the first level\. *\n[ ▌] {2}https:\/\/example\.test\/proj\/1\/takeoff\.png *\n *\n ↗ The test run *\n[ ▌] {2}https:\/\/example\.test\/proj\/1\/tests\.txt *\n/);
    assert.ok(text.indexOf("\n Evidence ") < text.indexOf("\n Settings "));
    s.press("esc"); assert.equal(s.v.full, false);
  } finally { w.cleanup(); }
});

test("a part of the board that fails to draw says so in its place: the rest of the page, the list and the text box stay", async (tc) => {
  const w = await world();
  try {
    const id = reviewed(w);
    const s = open(w, { rows: 60 });
    s.v.sel = id; s.v.load();
    // One part of the panel fails: its headline and one line say so, every other part is there, and keys still work.
    const boom = tc.mock.method(s.v, "panelReviews", () => { throw new Error("artifactLines is not defined"); });
    for (const full of [false, true]) {
      if (full) s.press("alt+t");
      const text = s.text(120);
      assert.doesNotMatch(text, /view error/);
      // (Beside the list the line wraps: read it without the panel's edge and its line breaks.)
      assert.match(text, /Reviews ─+/); assert.match(text.replace(/[\s│]+/g, " "), /✗ This part could not be shown: artifactLines is not defined/);
      assert.match(text, /Build a flying game/); assert.match(text, /Description ─/); assert.match(text, /A small game\./); assert.match(text, /Settings ─/); assert.match(text, full ? /Merge / : keyed(/all as usual · {settings} shows them/)); // beside the list only the settings that are this task's own
      assert.doesNotMatch(text, /Review 3/);
    }
    s.press("esc"); assert.equal(s.v.full, false);
    boom.mock.restore();
    // The whole panel fails: beside the list the list stays; full screen the text box and its hints stay under it.
    tc.mock.method(s.v, "panel", () => { throw new Error("nope"); });
    let text = s.text(120);
    assert.doesNotMatch(text, /view error/);
    assert.match(text, /Build a flying game[^\n]*│/); assert.match(text.replace(/[\s│]+/g, " "), /✗ The task panel could not be shown: nope/);
    s.press("alt+t");
    text = s.text(120);
    assert.match(text, /✗ The task details could not be shown: nope/);
    assert.match(text, /\n❯ Add a task *\n─+\n[ ▌] {1}tab put an agent on this task · [^\n]*esc back to the list *$/);
    s.press("esc"); assert.equal(s.v.full, false);
    tc.mock.restoreAll();
    // Any one section of the screen fails (the chat among them): never the error screen, and the others are there.
    const marks = { list: /○ #1 Build a flying game/, panel: /Settings ─/, box: /❯ Add a task/, hints: /tab put an agent on this task/ };
    for (const [method, gone] of [["chatOf", ["hints"]], ["chatLines", []], ["chatUp", []], ["boxLines", ["box"]], ["hints", ["hints"]], ["listLines", ["list"]], ["headLines", ["list"]], ["heldLines", []]]) {
      const m = tc.mock.method(s.v, method, () => { throw new Error("nope"); });
      const page = s.text(120);
      assert.ok(m.mock.callCount() > 0 || method === "chatUp" || method === "heldLines", `${method} is drawn`);
      assert.doesNotMatch(page, /view error/, method);
      for (const [k, re] of Object.entries(marks)) if (!gone.includes(k)) assert.match(page, re, `${k} stays when ${method} fails`);
      if (gone.length || method === "chatLines") assert.match(page, /could not be shown/, method);
      m.mock.restore();
    }
  } finally { w.cleanup(); }
});

test("names: a name a file uses and neither defines nor imports is found, with the file and the line", () => {
  const file = "src/x.js";
  assert.deepEqual(undefinedNames('import { one } from "./one.js";\nexport const f = () => one(two(process.env, new Map()));\n', file), [`${file}:2 uses two, which it neither defines nor imports`]);
  assert.deepEqual(undefinedNames('#!/usr/bin/env node\nimport fs from "node:fs";\nexport class A { m(x) { const { y } = x; return fs.readFileSync(y, "utf8") + setTimeout.name + (typeof nope); } }\n', file), []);
  assert.deepEqual(undefinedNames('const fs = require("node:fs");\nmodule.exports = fs;\n', "test/x.cjs"), []);
  assert.match(undefinedNames("export const f = ( => 1;\n", file)[0], /^src\/x\.js:1 cannot be read as code: /);
});
