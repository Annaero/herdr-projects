// The test runner (test/run.js): which files an area name stands for, and which files it calls slow.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { filesFor, slowOnes, SLOW_DEFAULT_S } from "./run.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("an area name stands for every test file that starts with it; no name is all of them; a name with no file is said", () => {
  const all = ["board-keys.test.js", "board-panel.test.js", "store.test.js", "sync-merge.test.js", "sync-remote.test.js"];
  assert.deepEqual(filesFor([], all), { files: all, unknown: [] });
  assert.deepEqual(filesFor(["board"], all).files, ["board-keys.test.js", "board-panel.test.js"]);
  assert.deepEqual(filesFor(["sync-merge", "store"], all).files, ["store.test.js", "sync-merge.test.js"]);
  assert.deepEqual(filesFor(["test/board-panel.test.js", "store.test.js"], all).files, ["board-panel.test.js", "store.test.js"]); // a file's own path works too
  assert.deepEqual(filesFor(["store", "nope"], all), { files: ["store.test.js"], unknown: ["nope"] });
});

test("a test file is called slow once it takes longer than the limit, slowest first", () => {
  assert.ok(SLOW_DEFAULT_S >= 20 && SLOW_DEFAULT_S <= 30);
  assert.deepEqual(slowOnes([["a", 3], ["b", 31.5], ["c", 25], ["d", 80]], 25), [["d", 80], ["b", 31.5]]);
  assert.deepEqual(slowOnes([["a", 3]], 25), []);
});

test("`npm test` goes through the runner, and every test file named in where-things-live.md exists", () => {
  assert.equal(JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")).scripts.test, "node test/run.js");
  const page = fs.readFileSync(path.join(here, "..", "docs", "where-things-live.md"), "utf8");
  for (const [, f] of page.matchAll(/`test\/([a-z-]+\.test\.js)`/g)) assert.ok(fs.existsSync(path.join(here, f)), f);
});
