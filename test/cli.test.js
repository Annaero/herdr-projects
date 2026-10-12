// The command line.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import { execFileSync } from "node:child_process";

test("the command: add, list, report, config, and the hook entry does nothing when there are no tasks", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const sw = (...args) => execFileSync(process.execPath, [S.BIN, ...args], { encoding: "utf8", cwd: w.root });
    assert.equal(sw("hook"), "");
    assert.ok(!fs.existsSync(path.join(S.dataDir(), "tasks")));
    const out = [sw("add", "From", "the", "shell", "--desc", "d", "--json"), sw("report", "1", "--state", "working", "--msg", "on it"), sw("list", "--json"), sw("config", "max", "2"), sw("config", "reviewer", "off", "--id", "1"), sw("--skill")];
    assert.equal(JSON.parse(out[0]).id, "proj/1");
    const listed = JSON.parse(out[2]); assert.deepEqual([listed[0].state, listed[0].app, listed[0].msg], ["working", S.me(), "on it"]);
    assert.equal(S.config().max, 2); assert.equal(S.choices(S.get("proj/1")).review, "none");
    assert.match(out.at(-1), /report <your id> --state blocked/);
    assert.throws(() => sw("frobnicate"), /Unknown command/);
  } finally { w.cleanup(); }
});
