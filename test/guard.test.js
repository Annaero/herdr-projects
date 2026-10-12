// The repo's own rules are part of the check: no source file past its size, no name used and never defined, no made page
// out of date (scripts/guard.js).
import test from "node:test";
import assert from "node:assert/strict";
import { problems } from "../scripts/guard.js";

test("guard: every source file is within its size, every name a file uses is defined, and every page made from the code is up to date", () => {
  assert.deepEqual(problems(), []);
});
