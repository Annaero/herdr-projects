// The command line.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import { execFileSync } from "node:child_process";
import { main } from "../src/cli.js";

test("[real programs] the command: add, list, report, set, unset, show, and the hook entry does nothing when there are no tasks", async () => {
  const w = await world();
  try {
    const sw = (...args) => execFileSync(process.execPath, [S.BIN, ...args], { encoding: "utf8", cwd: w.root });
    assert.equal(sw("hook"), "");
    assert.ok(!fs.existsSync(path.join(S.dataDir(), "tasks")));
    const out = [sw("add", "From", "the", "shell", "--desc", "d", "--json"), sw("report", "1", "--state", "working", "--msg", "on it"), sw("list", "--json"), sw("set", "board.agents", "2"), sw("--skill")];
    assert.equal(JSON.parse(out[0]).id, "proj/1");
    const listed = JSON.parse(out[2]); assert.deepEqual([listed[0].state, listed[0].app, listed[0].msg], ["working", S.me(), "on it"]);
    assert.equal(out[3], "board.agents: 2  (you)\n");
    assert.equal(S.setting("board.agents"), 2);
    // show: yours with the changed ones marked; one task's with the place each value came from; unset puts it back
    // the rest in this process: the same command, without starting the program for every line
    const run = async (...args) => { let out = ""; const write = process.stdout.write; process.stdout.write = (x, ...r) => (typeof x === "string" ? ((out += x), true) : write.call(process.stdout, x, ...r)); /* the test runner writes its own records there too */ try { await main(args); } finally { process.stdout.write = write; } return out; };
    assert.equal(await run("set", "review.when", "never", "--task", "1"), "review.when for proj/1: never  (this task)\n");
    assert.equal(S.setting("review.when", S.get("proj/1")), "never");
    assert.match(await run("show"), /^Your settings \(\* = changed by you\)\n[\s\S]*\n {2}merge\.by +you +built in\n[\s\S]*\n\* board\.agents +2 +you\n/);
    assert.match(await run("show", "1"), /^proj\/1: every setting, and the place it came from[\s\S]*\n\* review\.when +never +this task\n[\s\S]*\n {2}board\.agents +2 +you\n/);
    assert.deepEqual(JSON.parse(await run("show", "1", "--json")).settings.find((r) => r.name === "review.when"), { name: "review.when", kind: "work", value: "never", from: "this task", place: "task", own: true, note: "" });
    await run("set", "merge.by", "itself", "--repo", "proj"); assert.match(await run("show", "1"), /\n {2}merge\.by +itself +your entry for proj\n/); assert.match(await run("show", "--repo", "proj"), /\n\* merge\.by +itself +your entry for proj\n/);
    assert.equal(await run("unset", "review.when", "--task", "1"), "review.when for proj/1: repos  (built in)\n"); assert.equal(await run("unset", "board.agents"), "board.agents: 4  (built in)\n");
    // refused, with the nearest right one; a board setting is yours only; the old command is gone
    const said = async (...args) => { try { await run(...args); return ""; } catch (e) { return e.message; } };
    assert.match(await said("set", "merge.pr", "maybe"), /merge\.pr is a switch: true or false/); assert.match(await said("set", "review.round", "2"), /Unknown setting "review\.round"\. Did you mean review\.rounds\?/);
    assert.match(await said("set", "board.agents", "2", "--task", "1"), /board\.agents is a board setting: it is yours only and cannot be set on a task/);
    assert.match(await said("delegate", "1", "--merge.by", "sometimes", "--reviewer.agent", "claude"), /merge\.by must be you, itself/); assert.deepEqual(S.get("proj/1").settings, {});
    assert.match(await said("config", "max", "2"), /Unknown command "config"/);
    assert.match(out.at(-1), /report <your id> --state blocked/);
    assert.throws(() => sw("frobnicate"), /Unknown command/);
  } finally { w.cleanup(); }
});
