// The test command (test/check.js): which files it runs, what it remembers, how runs take turns, and its budget.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { reporter, joinLine, stayInLine, leaveLine, waitingBefore, LINE_GONE_MS } from "./check-report.js";
import { filesFor, importsOf, reach, touched, treeOf, changedSince, remembered, remember, takeSlot, stretch, overBudget, stepAside, BUDGET, SLOTS, NICE } from "./check.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sw-check-test-"));

test("an area name stands for every test file that starts with it; no name is all of them; a name with no file is said", () => {
  const all = ["board-keys.test.js", "board-panel.test.js", "store.test.js", "sync-merge.test.js", "sync-remote.test.js"];
  assert.deepEqual(filesFor([], all), { files: all, unknown: [] });
  assert.deepEqual(filesFor(["board"], all).files, ["board-keys.test.js", "board-panel.test.js"]);
  assert.deepEqual(filesFor(["sync-merge", "store"], all).files, ["store.test.js", "sync-merge.test.js"]);
  assert.deepEqual(filesFor(["test/board-panel.test.js", "store.test.js"], all).files, ["board-panel.test.js", "store.test.js"]); // a file's own path works too
  assert.deepEqual(filesFor(["store", "nope"], all), { files: ["store.test.js"], unknown: ["nope"] });
});

test("the tests a change touches: those that reach a changed file through their imports or name it; a page touches no other test; anything else unknown is all of them", () => {
  const repo = {
    "src/store.js": `import fs from "node:fs";\nexport * from "./store/tasks.js";`,
    "src/store/tasks.js": `export const x = 1;`,
    "src/gate.js": `import "./store.js";\nconst rules = fs.readFileSync("rules.json");`,
    "src/board/view.js": `import * as S from "../store.js";\nconst later = () => import("./theme.js");`,
    "src/board/theme.js": ``,
    "test/helpers.js": `import { x } from "../src/store.js";`,
    "test/store.test.js": `import { world } from "./helpers.js";`,
    "test/board.test.js": `import { View } from "../src/board/view.js";`,
    "test/gate.test.js": `import * as G from '../src/gate.js';`,
    "test/pages.test.js": `fs.readFileSync(path.join(here, "..", "docs", "keys.md")); const p = "package.json";`,
  };
  const read = (f) => repo[f] ?? null;
  const tests = Object.keys(repo).filter((f) => f.endsWith(".test.js"));
  assert.deepEqual(importsOf(repo["src/board/view.js"]), ["../store.js", "./theme.js"]); // not node's own, not a package
  assert.deepEqual([...reach("test/board.test.js", read)].sort(), ["src/board/theme.js", "src/board/view.js", "src/store.js", "src/store/tasks.js", "test/board.test.js"]);
  const hit = (...changed) => touched(changed, tests, read);
  assert.deepEqual(hit("src/board/theme.js"), { files: ["test/board.test.js"], all: null });
  assert.deepEqual(hit("src/gate.js", "test/board.test.js"), { files: ["test/board.test.js", "test/gate.test.js"], all: null });
  assert.deepEqual(hit("src/store/tasks.js").files, ["test/store.test.js", "test/board.test.js", "test/gate.test.js"]); // what everything is built on
  assert.deepEqual(hit("test/helpers.js").files, ["test/store.test.js"]);
  // a page: only the test that reads it; a page no test reads: nothing
  assert.deepEqual(hit("docs/keys.md", "README.md"), { files: ["test/pages.test.js"], all: null });
  assert.deepEqual(hit("docs/board.md"), { files: [], all: null });
  assert.deepEqual(hit("package.json").files, ["test/pages.test.js"]);
  // a file that source code reads touches every test that reaches that source file, not only a test that names it itself
  assert.deepEqual(hit("rules.json"), { files: ["test/gate.test.js"], all: null });
  // a file no test reaches or names, and not a page (a program a test starts, a recording): any test may depend on it
  assert.deepEqual(hit("docs/board.md", "test/bin/herdr"), { files: tests, all: "test/bin/herdr" });
  assert.deepEqual(hit(), { files: [], all: null });
  // a test that reads the whole repo (the guard) is touched by any change, and by none when nothing changed
  assert.deepEqual(touched(["docs/board.md"], [...tests, "test/guard.test.js"], read).files, ["test/guard.test.js"]);
  assert.deepEqual(touched([], [...tests, "test/guard.test.js"], read).files, []);
});

test("the budget: a file over its processor time, its time by the clock or its programs is named; so is the whole suite; a busy machine stretches only the clock", () => {
  const b = { fileCpu: 5, fileWall: 4, fileLaunches: 100, suiteCpu: 12, suiteWall: 10 };
  const ok = { wall: 1, cpu: 2, launches: 10, ran: true };
  assert.deepEqual(overBudget({ "a.test.js": ok, "b.test.js": ok }, { whole: true, wall: 3, budget: b }), []);
  assert.deepEqual(overBudget({ "a.test.js": { ...ok, cpu: 5.5 }, "b.test.js": { ...ok, wall: 4.2 }, "c.test.js": { ...ok, launches: 101 } }, { budget: b }),
    ["test/a.test.js: 5.5 s of processor time (budget 5 s)", "test/b.test.js: 4.2 s by the clock (budget 4.0 s)", "test/c.test.js: starts 101 programs (budget 100)"]);
  // the machine is twice as busy as it has cores: the clock's budget doubles, the others stay
  assert.deepEqual(overBudget({ "a.test.js": { ...ok, cpu: 5.5, wall: 7 }, "b.test.js": { ...ok, wall: 9 } }, { by: 2, budget: b }),
    ["test/a.test.js: 5.5 s of processor time (budget 5 s)", "test/b.test.js: 9.0 s by the clock (budget 8.0 s, stretched: the machine is busy)"]);
  // a result remembered from an earlier run is not held to this run's clock, but still counts into the suite's processor time
  assert.deepEqual(overBudget({ "a.test.js": { wall: 9, cpu: 5, launches: 1 }, "b.test.js": { ...ok, cpu: 4 }, "c.test.js": { ...ok, cpu: 4 } }, { whole: true, wall: null, budget: b }), ["the whole suite: 13.0 s of processor time (budget 12 s)"]);
  assert.deepEqual(overBudget({ "a.test.js": ok }, { whole: true, wall: 10.5, budget: b }), ["the whole suite: 10.5 s by the clock (budget 10.0 s)"]);
  assert.deepEqual(overBudget({ "a.test.js": ok }, { whole: false, wall: 10.5, budget: b }), []); // a part of the suite has no suite budget
  assert.equal(stretch(4, 8), 1); assert.equal(stretch(16, 8), 2); assert.equal(stretch(1, 4), 2); assert.equal(stretch(8, 4), 4);
  assert.equal(stretch(1, 8, 0.75), 4); assert.equal(stretch(24, 8, 0.5), 3); assert.equal(stretch(1, 8, 1), 10); // other programs had three quarters of the machine while it ran: four times as long
  // the budget itself: a few seconds a file, the suite well under a minute of processor time, a small fixed number of runs at once
  assert.ok(BUDGET.fileCpu <= 6 && BUDGET.fileWall <= 6 && BUDGET.fileLaunches <= 1000 && BUDGET.suiteWall <= 15 && BUDGET.suiteCpu <= 60);
  assert.ok(SLOTS >= 1 && SLOTS <= 4);
});

test("a run steps aside: its priority is lowered somewhat, never raised, and a system that cannot do it changes nothing and fails nothing", () => {
  const sys = (now, can = true) => ({ now, set: [], getPriority() { return this.now; }, setPriority(n) { if (!can) throw new Error("EACCES"); this.set.push(n); this.now = n; } });
  let s = sys(0);
  assert.equal(stepAside(5, s), 5); assert.deepEqual(s.set, [5]);
  s = sys(10); assert.equal(stepAside(5, s), 10); assert.deepEqual(s.set, []); // started lower already (a reviewer under `nice`): left there
  s = sys(5); assert.equal(stepAside(5, s), 5); assert.deepEqual(s.set, []);
  s = sys(0); assert.equal(stepAside(0, s), 0); assert.deepEqual(s.set, []); // 0: as before
  assert.equal(stepAside(5, sys(0, false)), 0); // not allowed: runs as it was
  assert.equal(stepAside(5, { getPriority() { throw new Error("no such thing here"); }, setPriority() { throw new Error("nor this"); } }), null);
  // somewhat lower, far from the lowest (19): the tests keep a decent share of a machine that is busy all the time
  assert.ok(NICE >= 1 && NICE <= 7 || process.env.HERDR_SUPERWORK_CHECK_NICE !== undefined);
});

test("what passed is remembered per tree, added to by later runs, and kept apart from other trees", () => {
  const store = tmp();
  try {
    assert.deepEqual(remembered(store, "aaa"), {});
    remember(store, "aaa", { "a.test.js": { wall: 1, cpu: 1, launches: 0 } });
    remember(store, "aaa", { "b.test.js": { wall: 2, cpu: 2, launches: 3 } });
    remember(store, "aaa", {}); remember(store, "", { "c.test.js": {} }); // nothing passed, or no tree: nothing kept
    assert.deepEqual(remembered(store, "aaa"), { "a.test.js": { wall: 1, cpu: 1, launches: 0 }, "b.test.js": { wall: 2, cpu: 2, launches: 3 } });
    assert.deepEqual(remembered(store, "bbb"), {}); assert.deepEqual(remembered(store, ""), {});
    assert.deepEqual(fs.readdirSync(path.join(store, "passed")).length, 1); // no half-written file left
  } finally { fs.rmSync(store, { recursive: true, force: true }); }
});

test("the command reports to the file it was given and takes its name out of the environment; with no file it reports nothing", () => {
  const dir = tmp();
  try {
    const env = { HERDR_SUPERWORK_PROGRESS: path.join(dir, "p"), OTHER: "1" };
    const report = reporter(env);
    assert.deepEqual(env, { OTHER: "1" }); // the tests it starts never see it
    report({ state: "waiting", ahead: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "p"), "utf8")), { state: "waiting", ahead: 2 });
    report({ state: "running", done: 3, total: 9, unit: "tests" });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "p"), "utf8")), { state: "running", done: 3, total: 9, unit: "tests" });
    assert.deepEqual(fs.readdirSync(dir), ["p"]); // written whole, nothing half-written left
    reporter({})({ state: "known" });
    assert.deepEqual(fs.readdirSync(dir), ["p"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- from here on: real programs, because the command itself, git and the kernel's lock are what is tested ----------
test("[real programs] runs take turns: a slot that is held makes the next one wait, and is free again once let go", () => {
  const store = tmp();
  try {
    const first = takeSlot(store, 1);
    let waited = 0;
    assert.throws(() => takeSlot(store, 1, () => { waited += 1; throw new Error("would wait"); }), /would wait/);
    const second = takeSlot(store, 2, () => { throw new Error("would wait"); }); // with two slots there is room beside it
    assert.equal(waited, 1);
    first(); second();
    takeSlot(store, 1, () => { throw new Error("would wait"); })();
    // Turns go in order. A run that waits is told how many are ahead: the one that holds the slot, and those that
    // came to wait before it. It does not try for a free slot while another run still waits before it.
    const now = Date.now(), ahead = [];
    const held = takeSlot(store, 1), earlier = joinLine(store, now - 1000, 1);
    assert.throws(() => takeSlot(store, 1, (n) => { ahead.push(n); throw new Error("would wait"); }), /would wait/);
    assert.deepEqual(ahead, [2]);
    held();
    assert.throws(() => takeSlot(store, 1, (n) => { ahead.push(n); throw new Error("would wait"); }), /would wait/); // the slot is free, but not its turn
    assert.deepEqual(ahead, [2, 2]);
    assert.deepEqual(fs.readdirSync(path.join(store, "queue")), [path.basename(earlier)]); // a run that gave up left the line
    // A run that went away without leaving the line (its file is no longer touched) holds nobody up.
    stayInLine(earlier, now - LINE_GONE_MS - 1000);
    takeSlot(store, 1, () => { throw new Error("would wait"); })();
    assert.deepEqual(fs.readdirSync(path.join(store, "queue")), []);
    const mine = joinLine(store, now, 7), late = joinLine(store, now + 5, 8);
    assert.equal(waitingBefore(store, mine), 0); assert.equal(waitingBefore(store, late), 1); assert.equal(waitingBefore(store), 2);
    leaveLine(mine); assert.equal(waitingBefore(store, late), 0);
  } finally { fs.rmSync(store, { recursive: true, force: true }); }
});

test("[real programs] the command: runs what the change touches, answers at once for code that passed, in any worktree; fails over budget and on a failed test", () => {
  const base = tmp(), root = path.join(base, "repo"), store = path.join(base, "store");
  const priority = path.join(base, "priority"), mine = os.getPriority();
  const env = { ...process.env, HERDR_SUPERWORK_CHECK_DIR: store, HERDR_SUPERWORK_CHECK_NICE: "7", HERDR_SUPERWORK_PROGRESS: path.join(base, "progress"), PRIORITY_SEEN: priority, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  for (const k of ["NODE_TEST_CONTEXT", "NODE_OPTIONS", "HERDR_SUPERWORK_CHECK_PROBE", "HERDR_SUPERWORK_CHECK_BASE"]) delete env[k];
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (dir, files) => { for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); } };
  const check = (dir, ...args) => { const r = spawnSync(process.execPath, [path.join(dir, "test", args[0] === "tight" ? "tight.js" : "check.js"), ...args.filter((a) => a !== "tight")], { cwd: dir, env, encoding: "utf8" }); return { status: r.status, out: r.stdout + r.stderr }; };
  const unit = (name) => `import test from "node:test";\nimport fs from "node:fs";\nimport os from "node:os";\nimport { ${name} } from "../src/${name}.js";\nfs.writeFileSync(process.env.PRIORITY_SEEN, String(os.getPriority()));\ntest("${name} is ${name}", () => { if (${name} !== "${name}") throw new Error("no"); if (process.env.HERDR_SUPERWORK_PROGRESS) throw new Error("a test must not see the board's progress file"); });\n`;
  const told = () => JSON.parse(fs.readFileSync(path.join(base, "progress"), "utf8"));
  try {
    write(root, {
      "test/check.js": fs.readFileSync(path.join(here, "check.js"), "utf8"), "test/check-probe.cjs": fs.readFileSync(path.join(here, "check-probe.cjs"), "utf8"), "test/check-report.js": fs.readFileSync(path.join(here, "check-report.js"), "utf8"),
      // the same command with a budget of two programs a file
      "test/tight.js": `import { main, BUDGET } from "./check.js";\nprocess.exit(await main(process.argv.slice(2), { budget: { ...BUDGET, fileLaunches: 2 } }));\n`,
      "src/a.js": `export const a = "a";\n`, "src/b.js": `export const b = "b";\n`, "test/a.test.js": unit("a"), "test/b.test.js": unit("b"), "docs/x.md": "x\n", "package.json": `{ "type": "module" }\n`,
    });
    git(root, "init", "-q", "-b", "main"); git(root, "add", "-A"); git(root, "commit", "-qm", "init"); git(root, "checkout", "-qb", "work");
    assert.deepEqual(changedSince(root), []);
    let r = check(root);
    assert.equal(r.status, 0); assert.match(r.out, /check: nothing to run \(nothing changed since main\)\. The whole suite: npm run check -- --all/);
    // a change to one source file, not committed, and a page: only the test that reaches the source file runs
    write(root, { "src/a.js": `export const a = "a"; // changed\n`, "docs/x.md": "y\n", "docs/new.md": "new\n" });
    assert.deepEqual(changedSince(root).sort(), ["docs/new.md", "docs/x.md", "src/a.js"]);
    r = check(root);
    assert.equal(r.status, 0, r.out); assert.match(r.out, /check: 1 test file \(the tests your change touches: 3 files changed since main\) · 1 to run\n/);
    assert.match(r.out, /✔ a is a /); assert.doesNotMatch(r.out, /b is b/); assert.match(r.out, /\ncheck: 1 test file run · 1 tests passed · [\d.]+ s by the clock, [\d.]+ s of processor time · 0 programs started\n/);
    // the test file ran at the lower priority the command took (or the still lower one this run already had)
    if (process.platform !== "win32") assert.equal(fs.readFileSync(priority, "utf8"), String(Math.max(7, mine)));
    // whoever gave it a progress file (the board) was told the true count: test files finished out of all of them
    assert.deepEqual(told(), { state: "running", done: 1, total: 1, before: 0, unit: "tests" });
    // asked again for the same code: answered at once, nothing run, and the board is told that
    r = check(root);
    assert.deepEqual(told(), { state: "known" });
    assert.equal(r.status, 0); assert.match(r.out, /check: 1 test file \(the tests your change touches: 3 files changed since main\) · 1 already passed for this exact code: nothing to run again\. ✔/); assert.doesNotMatch(r.out, /a is a/);
    // the whole suite runs only what has not passed yet; --fresh runs it all the same
    r = check(root, "--all");
    assert.equal(r.status, 0, r.out); assert.match(r.out, /check: 2 test files \(the whole suite\) · 1 already passed for this exact code · 1 to run\n/); assert.match(r.out, /b is b/); assert.doesNotMatch(r.out, /a is a/);
    assert.deepEqual(told(), { state: "running", done: 2, total: 2, before: 1, unit: "tests" }); // the file that passed before counts as finished
    assert.match(check(root, "--all").out, /2 already passed for this exact code: nothing to run again/);
    r = check(root, "--all", "--fresh"); assert.match(r.out, /a is a/); assert.match(r.out, /b is b/); assert.match(r.out, /2 test files run · 2 tests passed/);
    // the same code in another worktree, on another branch and commit there (a reviewer's, the board's): it has passed already
    git(root, "add", "-A"); git(root, "commit", "-qm", "work");
    assert.match(check(root, "--all").out, /2 already passed for this exact code: nothing to run again/); // committing changes no file
    const other = path.join(base, "other");
    git(root, "worktree", "add", "-q", "-b", "review", other, "work");
    assert.equal(treeOf(other), treeOf(root)); assert.match(treeOf(root), /^[0-9a-f]{40}$/);
    r = check(other, "--all"); assert.equal(r.status, 0); assert.match(r.out, /2 already passed for this exact code: nothing to run again/);
    // named areas, and a name no file has
    assert.match(check(root, "b").out, /check: 1 test file \(named: b\) · 1 already passed/);
    r = check(root, "nope"); assert.equal(r.status, 2); assert.match(r.out, /No test file starts with: nope\nThe areas: a b/);
    assert.equal(check(root, "--everything").status, 2);
    // a test file that starts more programs than its budget allows fails the check, by name, and is not remembered as passed
    write(root, { "test/b.test.js": `${unit("b")}import { spawnSync } from "node:child_process";\ntest("starts three programs", () => { for (let i = 0; i < 3; i++) spawnSync("true"); });\n` });
    assert.notEqual(treeOf(root), treeOf(other));
    r = check(root, "tight");
    assert.equal(r.status, 1); assert.match(r.out, /✔ starts three programs/); assert.match(r.out, /· 3 programs started\n/); assert.match(r.out, /\n✖ over budget \(make the tests lighter or split the file, see docs\/testing\.md\):\n {2}test\/b\.test\.js: starts 3 programs \(budget 2\)\n/);
    r = check(root, "tight"); assert.equal(r.status, 1); assert.match(r.out, /· 1 to run\n/);
    r = check(root); assert.equal(r.status, 0, r.out); // within the real budget
    // the whole suite over its time by the clock: a failed check, and nothing of that run is remembered as passed
    write(root, { "test/slowsuite.js": `import { main, BUDGET } from "./check.js";\nprocess.exit(await main(process.argv.slice(2), { budget: { ...BUDGET, suiteWall: 0.000001 } }));\n`, "src/b.js": `export const b = "b"; // again\n` });
    for (const n of [1, 2]) {
      const again = spawnSync(process.execPath, [path.join(root, "test", "slowsuite.js"), "--all"], { cwd: root, env, encoding: "utf8" });
      assert.equal(again.status, 1, `run ${n}`); assert.match(again.stdout, /2 to run\n/); assert.match(again.stdout, /\n {2}the whole suite: [\d.]+ s by the clock \(budget /);
    }
    assert.equal(check(root, "--all").status, 0); // within the real budget: run, and remembered from here on
    assert.match(check(root, "--all").out, /nothing to run again/);
    // a failed test fails the check and is run again the next time
    write(root, { "src/a.js": `export const a = "not a";\n` });
    r = check(root);
    assert.equal(r.status, 1); assert.match(r.out, /\n✖ failed: test\/a\.test\.js\n/);
    r = check(root); assert.equal(r.status, 1); assert.match(r.out, /✖ a is a/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("`npm test` and `npm run check` are this command, the repo's own check is the whole suite through it, and every test file named in where-things-live.md exists", () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")).scripts;
  assert.deepEqual([scripts.test, scripts.check], ["node test/check.js", "node test/check.js"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(here, "..", ".herdr-superwork.json"), "utf8")).check, "npm run check -- --all");
  const page = fs.readFileSync(path.join(here, "..", "docs", "where-things-live.md"), "utf8");
  for (const [, f] of page.matchAll(/`test\/([a-z-]+\.test\.js)`/g)) assert.ok(fs.existsSync(path.join(here, f)), f);
});
