// The repo's own rules are part of the check: no source file past its size, no name used and never defined, no made
// table out of date (scripts/guard.js), and the map of which file holds what (scripts/docs.js --where).
import test from "node:test";
import assert from "node:assert/strict";
import { wherePage } from "../scripts/docs.js";
import { problems } from "../scripts/guard.js";

test("guard: every source file is within its size, every name a file uses is defined, and every page made from the code is up to date", () => {
  assert.deepEqual(problems(), []);
});

test("the map is made from each file's top comment, whole or for one folder, and is not a file in git", () => {
  const all = wherePage(), view = wherePage("src/board/view/");
  assert.match(all, /^# Where things live\n/); assert.match(all, /\n## `src\/`\n/); assert.match(all, /\n## `scripts\/`\n/); assert.match(all, /\n## The pages: `docs\/`\n/);
  assert.match(all, /\| `guard\.js` \| The repo's own rules, checked/);
  assert.doesNotMatch(all, /\.test\.js/); // the tests are `ls test`
  assert.deepEqual(view.match(/^## .+$/gm), ["## `src/board/view/`"]); assert.match(view, /\| `list\.js` \| The task list/);
  assert.match(wherePage("src/board"), /\n## `src\/board\/`\n[^]*\n## `src\/board\/view\/`\n/);
  assert.match(wherePage("no/such"), /No folder of source files is at or under `no\/such`/);
});
