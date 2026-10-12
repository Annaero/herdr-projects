// The autoMerge setting: a green task merges by itself, your choice wins over the repo's "land", and a change counts
// for tasks already under way.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, ghLog, toApproval } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { main } from "../src/cli.js";
import { housekeeping } from "../src/housekeeping.js";
import { green } from "../src/finish/auto-merge.js";

const verdict = (findings = []) => ({ verdict: { meets: true, text: "Looked at it.", findings } });
const work = (n, file = "f.txt") => ({ files: { [file]: `${n}\n` }, commit: `v${n}`, note: `Did v${n}.` });
const merged = (w, file = "f.txt") => fs.existsSync(path.join(w.root, file));
const pass = () => housekeeping(undefined, { force: true });
const quiet = async (argv) => { const out = process.stdout.write; process.stdout.write = () => true; try { return await main(argv); } finally { process.stdout.write = out; } };

test("autoMerge: yours for all tasks, one task's own, and the repo's land only where you chose nothing", async () => {
  const w = await world({ repoSettings: { land: "auto" } });
  try {
    const id = A.add(w.root, "One").id;
    assert.equal(S.config().autoMerge, false); assert.ok(S.PER_TASK.includes("autoMerge"));
    assert.equal(S.choices(S.get(id)).autoMerge, true); // nothing chosen: the repo's file says
    assert.equal(S.setConfig("autoMerge", "false").autoMerge, false); assert.equal(S.choices(S.get(id)).autoMerge, false); // yours wins, also when it is "no"
    assert.equal(await quiet(["config", "autoMerge", "true", "--id", id]), 0); assert.equal(S.get(id).own.autoMerge, true); assert.equal(S.choices(S.get(id)).autoMerge, true);
    assert.equal(S.setTaskConfig(id, "autoMerge", "default").autoMerge, false); assert.deepEqual(S.get(id).own, {});
    S.setConfig("autoMerge", "default"); assert.equal(S.choices(S.get(id)).autoMerge, true); // handed back to the repo
    // a repo that says nothing asks, and the option to delegate sets it for that one task
    fs.rmSync(path.join(w.root, ".herdr-superwork.json")); assert.equal(S.choices(S.get(id)).autoMerge, false);
    w.script({ worker: [work(1)], reviewer: [verdict()] });
    assert.equal(await quiet(["delegate", id, "--autoMerge", "false"]), 0); assert.equal(S.get(id).own.autoMerge, false);
    const t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.ok(!merged(w)); // its own "no" beats the repo's "auto" it started with
    assert.equal(t.repoCfg.land, "auto");
  } finally { w.cleanup(); }
});

test("autoMerge on: a task whose review passes merges by itself; one whose review fails still asks", async () => {
  const w = await world({ settings: { autoMerge: true, rounds: 1 } });
  try {
    w.script({ worker: [work(1)], reviewer: [verdict([{ severity: "minor", subject: "A name", where: "f.txt", proof: "read it" }])] });
    const id = A.add(w.root, "Passes").id;
    A.delegate(id);
    let t = await settle(id, { max: 30 });
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.equal(fs.readFileSync(path.join(w.root, "f.txt"), "utf8"), "1\n");
    // a critical finding that outlasts its rounds is yours to decide: nothing merges, however often the board looks
    w.script({ worker: [work(1, "g.txt"), work(2, "g.txt")], reviewer: [1, 2].map(() => verdict([{ severity: "critical", subject: "Deletes the data", where: "g.txt", proof: "ran it" }])) });
    const bad = A.add(w.root, "Fails").id;
    A.delegate(bad);
    t = await settle(bad, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(t.review.pass, false); assert.equal(green(t), false);
    pass(); t = await settle(bad);
    assert.equal(t.stage, "approval"); assert.ok(!merged(w, "g.txt"));
  } finally { w.cleanup(); }
});

test("autoMerge turned on under way: a task that waits green merges at the reviewed commit; one you stepped into asks", async () => {
  const w = await world();
  try {
    const id = await toApproval(w, "Waits", { reviewer: [verdict()] });
    const held = await toApproval(w, "Stepped in", { worker: [work(1, "h.txt")], reviewer: [verdict()] });
    S.update(held, (t) => { t.requireApproval = true; });
    pass(); assert.equal((await settle(id)).stage, "approval"); // off: it waits, as before
    S.setConfig("autoMerge", "true");
    assert.equal(green(S.get(id)), true); assert.equal(green(S.get(held)), false);
    const reviewed = S.get(id).reviewedHead;
    pass();
    assert.deepEqual(S.get(id).mergeIntent && [S.get(id).stage, S.get(id).mergeIntent.verifiedHead, S.get(id).mergeIntent.auto], ["merging", reviewed, true]);
    const t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.ok(merged(w));
    assert.equal((await settle(held)).stage, "approval"); assert.ok(!merged(w, "h.txt"));
    // "auto-merge this one", said for that very task, is the yes it waited for
    S.setTaskConfig(held, "autoMerge", "true"); assert.equal(S.get(held).requireApproval, false);
    pass(); await settle(held); pass(); // main moved under it when the first one merged: brought up to date, then merged
    assert.equal((await settle(held, { max: 30 })).stage, "done", JSON.stringify(S.get(held).failure)); assert.ok(merged(w, "h.txt"));
  } finally { w.cleanup(); }
});

test("autoMerge turned off while a task waits to merge by itself: it waits for your yes instead", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off", autoMerge: true } });
  try {
    // GitHub's checks still run: the merge the board started by itself is remembered
    const pending = { state: "OPEN", statusCheckRollup: [{ name: "build", state: "PENDING" }], comments: [], reviews: [], author: { login: "me" } };
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ mergeFail: "checks pending", view: pending }));
    w.script({ worker: [work(1)] });
    const id = A.add(w.root, "With a PR").id;
    A.delegate(id);
    let t = await settle(id, { max: 30 });
    assert.deepEqual([t.stage, t.autoMerge, t.mergeIntent?.auto], ["merging", true, true], JSON.stringify(t.failure));
    pass(); assert.equal(S.get(id).stage, "merging"); // still on: nothing changes
    S.setTaskConfig(id, "autoMerge", "false");
    pass();
    t = S.get(id);
    assert.deepEqual([t.stage, !!t.autoMerge, t.mergeIntent, !!t.requireApproval], ["approval", false, null, false]); assert.match(t.msg, /^Approve to merge\?/);
    assert.equal(ghLog(w).match(/^pr merge /gm).length, 1); // the one try that found the checks pending: none since
    assert.ok(!merged(w));
    // an approval the human gave is not the board's own: turning the setting off leaves it alone
    A.approve(id); t = await settle(id);
    assert.deepEqual([t.stage, t.autoMerge, !!t.mergeIntent.auto], ["merging", true, false]);
    pass(); assert.equal(S.get(id).stage, "merging"); assert.equal(ghLog(w).match(/^pr merge /gm).length, 2);
  } finally { w.cleanup(); }
});

test("autoMerge turned off after the board started a merge, before its runner ran: nothing merges, it asks again", async () => {
  const w = await world();
  try {
    const id = await toApproval(w, "Queued", { reviewer: [verdict()] });
    S.setConfig("autoMerge", "true"); pass();
    assert.deepEqual([S.get(id).stage, S.get(id).mergeIntent?.auto], ["merging", true]); // its land runner is queued, not run
    S.setConfig("autoMerge", "false");
    let t = await settle(id);
    assert.deepEqual([t.stage, t.mergeIntent, !!t.failure, !!t.mergeFailed], ["approval", null, false, false]); assert.match(t.msg, /^Approve to merge\?/); assert.ok(!merged(w));
    pass(); assert.equal((await settle(id)).stage, "approval");
    // your own yes is not the board's: it merges with the setting off
    A.approve(id); t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.ok(merged(w));
  } finally { w.cleanup(); }
});
