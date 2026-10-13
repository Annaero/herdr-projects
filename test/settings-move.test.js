// The one-time move from the old settings: your config.json, each task's own settings and what it took from its
// repo's file become the new names, once; the old file is kept beside the new one; tasks under way keep their choices.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { world, settle } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { main } from "../src/cli.js";

const file = () => path.join(process.env.HERDR_SUPERWORK_CONFIG_DIR, "config.json");
const kept = () => path.join(process.env.HERDR_SUPERWORK_CONFIG_DIR, "config.old.json");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const taskFile = (id) => path.join(S.dirOf(id), "task.json");
// This computer's settings on the day of the move, and its repo's own file.
const OLD = { max: 10, rounds: 5, gate: "critical", reviewerFast: true, autoMerge: true, coordinator: "claude" };
const OLD_REPO = { setup: "npm ci --no-audit --no-fund", check: "npm run check -- --all", land: "ask", teardown: "", include: [] };

test("the move, with exactly this computer's file: every old name becomes its new one, once, and the old file is kept", async () => {
  const w = await world();
  try {
    fs.writeFileSync(file(), JSON.stringify(OLD, null, 2));
    // tasks as the old version saved them: one under way with choices of its own, one untouched
    const a = A.add(w.root, "Under way").id, b = A.add(w.root, "Untouched").id, c = A.add(w.root, "Research").id;
    const old = (id, patch) => { const t = read(taskFile(id)); delete t.settings; fs.writeFileSync(taskFile(id), JSON.stringify({ ...t, own: {}, ...patch })); };
    old(a, { stage: "approval", startedOnce: true, agent: "claude", repoCfg: OLD_REPO, own: { reviewer: "claude", reviewerModel: "opus", model: "sonnet", effort: "high", gate: "minor", autoMerge: false, conflictAuto: true, watcher: "off" }, base: "head" });
    old(b, {}); old(c, { own: { research: true, reviewer: "off" }, worktreeMode: "none" });
    assert.equal(S.moveSettings(), true);
    assert.deepEqual(read(file()), { review: { mustFix: "critical", rounds: 5 }, reviewer: { fast: true }, coordinator: { agent: "claude" }, merge: { by: "itself" }, board: { agents: 10 } });
    assert.deepEqual(read(kept()), OLD); // a copy of the old file, beside the new one
    assert.deepEqual(S.settingProblems(), []);
    for (const [name, value] of [["board.agents", 10], ["review.rounds", 5], ["review.mustFix", "critical"], ["reviewer.fast", true], ["merge.by", "itself"], ["coordinator.agent", "claude"]]) assert.deepEqual([S.lookup(name).value, S.lookup(name).from], [value, "you"], name);
    // the task under way keeps the choices it had, in the new names; the old ones are gone from it
    const t = S.get(a);
    assert.deepEqual(t.settings, { "worker.agent": "claude/sonnet", "worker.effort": "high", "reviewer.agent": "claude/opus", "review.mustFix": "minor", "merge.by": "you", "workspace.from": "here" });
    assert.deepEqual(t.repoFile, { "workspace.setup": "npm ci --no-audit --no-fund", "check.command": "npm run check -- --all" });
    for (const k of ["own", "repoCfg", "base", "worktreeMode"]) assert.equal(k in t, false, k);
    assert.equal(S.setting("check.command", t), "npm run check -- --all"); assert.equal(S.setting("merge.by", t), "you"); assert.equal(S.setting("review.rounds", t), 5);
    assert.deepEqual(S.get(b).settings, {}); assert.equal("own" in S.get(b), false);
    assert.equal(S.get(c).research, true); assert.deepEqual(S.get(c).settings, { "review.when": "never" });
    // once: a second run changes nothing, also after you changed something since
    S.setValue("board.agents", 3);
    const now = fs.readFileSync(file(), "utf8"), task = fs.readFileSync(taskFile(a), "utf8");
    assert.equal(S.moveSettings(), false); assert.equal(fs.readFileSync(file(), "utf8"), now); assert.equal(fs.readFileSync(taskFile(a), "utf8"), task); assert.deepEqual(read(kept()), OLD);
  } finally { w.cleanup(); }
});

test("the move: the other old names, a repo that merged by itself, and a new install with nothing to move", async () => {
  const w = await world();
  try {
    assert.deepEqual(S.movedConfig({ agent: "codex", model: "gpt-5.5", effort: "high", fast: "on", reviewer: "off", coordinator: "off", coordinatorModel: "x", helper: "codex", helperModel: "mini", watcherEvery: 120, review: "all", gate: "off", rounds: 2,
      artifacts: false, worktree: "none", base: "head", pr: false, merge: "rebase", cleanup: false, machines: "vm-a, me@vm-b", remoteUser: "exedev", theme: "dark", ownTerminal: false, serve: "local", remerge: "review", skill: false, trust: false, agentArgs: {}, bell: true }),
    { worker: { agent: "codex/gpt-5.5", effort: "high", fast: true }, review: { when: "never", rounds: 0, evidence: false }, coordinator: { agent: "none" }, watcher: { agent: "codex/mini", every: "120s" },
      workspace: { from: "here", cleanup: false }, merge: { pr: false, method: "rebase" }, board: { machines: "exedev@vm-a, me@vm-b", theme: "dark" } });
    assert.deepEqual(S.movedConfig({ reviewAuto: false, watcher: "off", autoMerge: false, machines: "off" }), { watcher: { agent: "none" }, review: { rounds: 0 }, merge: { by: "you" }, board: { machines: "none" } });
    assert.equal(S.movedConfig({ review: { rounds: 5 }, board: { agents: 2 } }), null); assert.equal(S.movedConfig({}), null); assert.equal(S.movedConfig(null), null); // already new, or nothing
    // a repo whose old file said "land": "auto" merged by itself where you had chosen nothing: a task that ran on that keeps it
    const ran = S.movedTask({ id: "p/1", startedOnce: true, own: {}, repoCfg: { check: "t", land: "auto" } }, {});
    assert.deepEqual(ran.settings, { "merge.by": "itself" }); assert.deepEqual(ran.repoFile, { "check.command": "t" });
    assert.deepEqual(S.movedTask({ id: "p/2", startedOnce: true, own: {}, repoCfg: { land: "auto" } }, { autoMerge: false }).settings, {}); // you had said no
    assert.deepEqual(S.movedTask({ id: "p/3", own: {}, repoCfg: { land: "auto" } }, {}).settings, {}); // never started: nothing ran on it
    assert.equal(S.movedTask({ id: "p/4", settings: {} }), null);
    // a new install: nothing to move, no copy made, nothing written anywhere
    const before = fs.readFileSync(file(), "utf8");
    assert.equal(S.moveSettings(), false); assert.equal(fs.existsSync(kept()), false); assert.equal(fs.readFileSync(file(), "utf8"), before); assert.equal(fs.existsSync(path.join(S.dataDir(), "settings-moved")), false);
    // a task an older version saves after the move reads in the new names, and is saved so at its next change
    const id = A.add(w.root, "Late").id, f = taskFile(id), raw = read(f); delete raw.settings;
    fs.writeFileSync(f, JSON.stringify({ ...raw, own: { rounds: 2 }, repoCfg: { check: "npm test" } }));
    assert.deepEqual(S.get(id).settings, { "review.rounds": 2 }); assert.equal(S.setting("check.command", S.get(id)), "npm test"); assert.equal("own" in read(f), true);
    S.update(id, { msg: "x" }); assert.equal("own" in read(f), false); assert.deepEqual(read(f).repoFile, { "check.command": "npm test" });
    // asking for help converts nothing
    fs.writeFileSync(file(), JSON.stringify(OLD)); const out = process.stdout.write; process.stdout.write = () => true;
    try { await main(["help"]); await main(["--skill"]); } finally { process.stdout.write = out; }
    assert.deepEqual(read(file()), OLD); assert.equal(fs.existsSync(kept()), false);
  } finally { w.cleanup(); }
});

test("a task under way when the move happens keeps working: its check, its review bar and its merge are what they were", async () => {
  const w = await world({ repoSettings: { "check.command": "test -f f.txt" } });
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "v1", note: "Did it." }], reviewer: [{ verdict: { meets: true, text: "Fine.", findings: [{ severity: "minor", subject: "A name", where: "f.txt", proof: "read it" }] } }] });
    const id = A.add(w.root, "Under way").id;
    A.delegate(id);
    // the old version's shape, while its agent works: your old file, and the task as it was saved
    fs.writeFileSync(file(), JSON.stringify({ ...OLD, autoMerge: false, watcher: "off", coordinator: "off" }));
    const t = read(taskFile(id)); delete t.settings; delete t.repoFile; delete t.repoRefused;
    fs.writeFileSync(taskFile(id), JSON.stringify({ ...t, own: { gate: "trivial", rounds: 0 }, repoCfg: { setup: "", check: "test -f f.txt", land: "ask", teardown: "", include: [] } }));
    assert.equal(S.moveSettings(), true);
    const done = await settle(id, { max: 30 });
    assert.equal(done.stage, "approval", JSON.stringify(done.failure)); assert.equal(done.review.gate, "trivial"); assert.equal(done.review.pass, false); // its own bar, and nothing sent back by itself
    assert.equal(done.reviewRounds || 0, 0); assert.deepEqual(done.settings, { "review.rounds": 0, "review.mustFix": "trivial" });
  } finally { w.cleanup(); }
});

test("a test run has a home folder of its own: nothing here reads or converts your real one", () => {
  // test/check.js gives the whole run an empty home folder, so a test with no board of its own (and a program one
  // starts) can never reach ~/.herdr-superwork.
  const real = path.join(os.homedir(), ".herdr-superwork");
  assert.ok(process.env.HERDR_SUPERWORK_HOME, "the run names its own home folder");
  for (const dir of [S.homeDir(), S.dataDir(), S.configDir(), S.reportsDir()]) assert.ok(path.resolve(dir) !== real && !path.resolve(dir).startsWith(real + path.sep), dir);
});
