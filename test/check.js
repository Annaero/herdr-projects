#!/usr/bin/env node
// The one test command: `npm run check` (`npm test` is the same). Everything that runs tests goes through it: you, an
// agent, the reviewer and the board's own check. See docs/testing.md.
//
//   npm run check              the test files your change touches (changed since main, committed or not)
//   npm run check -- --all     the whole suite (the board's check, and you once at the end)
//   npm run check board sync   the files of the areas named: every test/<name>*.test.js
//   --fresh                    run even what already passed for this exact code
//
// Three things make it cheap to run often, on a machine many agents share:
// - It remembers which test files passed for this exact code (the git tree of the folder as it is now, uncommitted
//   changes included), in one place for every worktree. Asked again for code that passed, it answers at once.
// - Runs take turns, machine-wide: SLOTS at a time, the rest wait. A run steps aside for everything else (NICE).
// - Each test file has a budget (processor time, time by the clock, programs started) and so has the whole suite.
//   Over budget is a failed check that names the file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const num = (name, d) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : d);

// ---- the budget -----------------------------------------------------------------------------------------------------
// One test file: seconds of processor time (its own and its programs'), seconds by the clock, programs it starts.
// The whole suite: processor time added up over its files, and seconds by the clock for a run of all of it.
// Processor time and programs do not depend on how busy the machine is; time by the clock is stretched (see `stretch`).
export const BUDGET = { fileCpu: 6, fileWall: 6, fileLaunches: 1000, suiteCpu: 60, suiteWall: 15 };
// How many runs at a time on this machine. The tests use every core, so more runs at once only make each slower.
export const SLOTS = num("HERDR_SUPERWORK_CHECK_SLOTS", 1);
// Where passed results and the slots are kept: outside every worktree, so that they share it.
export const storeDir = () => process.env.HERDR_SUPERWORK_CHECK_DIR || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "herdr-superwork-check");

// ---- which files ----------------------------------------------------------------------------------------------------
// The test files an area name stands for: the files whose name starts with it. No names: every file.
export function filesFor(areas, all) {
  const name = (a) => path.basename(String(a)).replace(/(\.test)?\.js$/, "");
  const files = areas.length ? all.filter((f) => areas.some((a) => f.startsWith(name(a)))) : all;
  return { files, unknown: areas.filter((a) => !all.some((f) => f.startsWith(name(a)))) };
}
// The files a source file imports, as written: `from "./x.js"`, `import "./x.js"`, `import("./x.js")`. Only its own
// repo's files (a path that starts with a dot).
export const importsOf = (text) => [...String(text).matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
// Everything a file reaches through imports, itself included, as paths from the repo's root. `read(file)`: its text, or null.
export function reach(file, read, seen = new Set()) {
  if (seen.has(file)) return seen;
  const text = read(file);
  if (text === null) return seen;
  seen.add(file);
  for (const spec of importsOf(text)) reach(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)), read, seen);
  return seen;
}
// The test files a change touches. `tests`: paths from the root (test/x.test.js). `changed`: the same for the files that
// changed. A test is touched when a changed file is one it reaches through its imports, or one that it, or any file it
// reaches, names in its text (a page or a file that is read: `where-things-live.md`, `package.json`). A changed file no test reaches or names: a page
// (docs/, *.md) touches nothing more; anything else (a program a test starts, a recording it reads, the lock file)
// could matter to any test, so then it is all of them.
// `always`: test files that read the whole repo rather than import it (the guard), touched by any change.
export const ALWAYS = ["test/guard.test.js"];
export function touched(changed, tests, read, always = ALWAYS) {
  const reaches = new Map(tests.map((t) => [t, reach(t, read)]));
  // Named anywhere in what the test reaches, source files included: `src/store/files.js` reads `package.json`.
  const text = new Map();
  const says = (r, word) => { if (!text.has(r)) text.set(r, read(r) || ""); return text.get(r).includes(word); };
  const names = (t, f) => [...reaches.get(t)].some((r) => says(r, path.posix.basename(f)));
  const hit = new Set(changed.length ? tests.filter((t) => always.includes(t)) : []);
  let all = null;
  for (const f of changed) {
    const mine = tests.filter((t) => reaches.get(t).has(f) || names(t, f));
    for (const t of mine) hit.add(t);
    if (!mine.length && !/^docs\/|\.md$/.test(f)) all = all || f;
  }
  return all ? { files: tests, all } : { files: tests.filter((t) => hit.has(t)), all: null };
}

// ---- this exact code ------------------------------------------------------------------------------------------------
const git = (root, args, env) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: env || process.env }).trim();
// The git tree of the folder as it stands: what is committed plus every change and new file not ignored. Two folders
// with the same files have the same tree, whatever their branch or commit. Empty outside a git repo. Every file is
// read anew, into an index of its own: the folder's own index may call a file unchanged that was edited within the
// second it was last written.
export function treeOf(root) {
  const index = path.join(os.tmpdir(), `sw-check-index-${process.pid}-${Date.now()}`);
  try {
    const env = { ...process.env, GIT_INDEX_FILE: index };
    git(root, ["add", "-A"], env);
    return git(root, ["write-tree"], env);
  } catch { return ""; } finally { fs.rmSync(index, { force: true }); fs.rmSync(`${index}.lock`, { force: true }); }
}
// The files that differ from where this branch left main, committed or not, and the new ones. null: no main to compare with.
export function changedSince(root) {
  for (const ref of [process.env.HERDR_SUPERWORK_CHECK_BASE, "main", "origin/main", "master", "origin/master"].filter(Boolean)) {
    try {
      const base = git(root, ["merge-base", "HEAD", ref]);
      const lines = (args) => git(root, args).split("\n").filter(Boolean);
      return [...new Set([...lines(["diff", "--name-only", base]), ...lines(["ls-files", "--others", "--exclude-standard"])])];
    } catch {}
  }
  return null;
}
// What passed for one tree: { "x.test.js": { wall, cpu, launches, tests } }. A result also depends on the node that ran it.
const passedFile = (store, tree) => path.join(store, "passed", `${tree}-node${process.versions.node.split(".")[0]}.json`);
export function remembered(store, tree) { try { return tree ? JSON.parse(fs.readFileSync(passedFile(store, tree), "utf8")) : {}; } catch { return {}; } }
export function remember(store, tree, results) {
  if (!tree || !Object.keys(results).length) return;
  const file = passedFile(store, tree);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify({ ...remembered(store, tree), ...results }));
  fs.renameSync(`${file}.${process.pid}.tmp`, file);
  // Old trees are never asked for again.
  try { for (const f of fs.readdirSync(path.dirname(file))) { const p = path.join(path.dirname(file), f); if (Date.now() - fs.statSync(p).mtimeMs > 14 * 86400000) fs.rmSync(p, { force: true }); } } catch {}
}

// ---- taking turns ---------------------------------------------------------------------------------------------------
// One of the machine's slots: a kernel lock (flock) this process keeps until it ends, however it ends. Waits for one.
// Returns what lets it go, or null where there is no flock program (then nothing takes turns).
export function takeSlot(store, slots = SLOTS, waiting = () => {}) {
  const dir = path.join(store, "slots");
  fs.mkdirSync(dir, { recursive: true });
  for (let n = 0; ; n++) {
    for (let i = 0; i < slots; i++) {
      const fd = fs.openSync(path.join(dir, `${i}.lock`), "a");
      const r = spawnSync("flock", ["--exclusive", "--nonblock", "3"], { stdio: ["ignore", "ignore", "ignore", fd] });
      if (r.status === 0) return () => { try { fs.closeSync(fd); } catch {} };
      fs.closeSync(fd);
      if (r.error) return null;
    }
    if (n === 0) waiting();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
}

// ---- stepping aside ------------------------------------------------------------------------------------------------
// How far a test run steps aside for everything else on the machine (the board, the agents, what you type): its
// niceness, 0 for none. 5 is a third of the share of a core that a program at normal priority gets when both want
// it: measured on 8 cores with 8 other programs busy all the time, the suite took 34 to 40 s at 5 (22 s at 0), 75 s
// at 10, and had not ended after 5 minutes at 19. The numbers: docs/testing.md.
export const NICE = /^\d+$/.test(process.env.HERDR_SUPERWORK_CHECK_NICE || "") ? Math.min(19, Number(process.env.HERDR_SUPERWORK_CHECK_NICE)) : 5;
// Lowers the priority of this process, and so of every program it starts from here on (they inherit it). Never
// raises it: a run started at a lower priority stays there. Where the system cannot do it, nothing changes and
// nothing fails. Returns the priority the run has now, null when it cannot be read.
export function stepAside(level = NICE, sys = os) {
  try { if (level > sys.getPriority()) sys.setPriority(level); } catch {}
  try { return sys.getPriority(); } catch { return null; }
}

// ---- over budget ----------------------------------------------------------------------------------------------------
// How much longer things take by the clock here than on a quiet machine with eight cores. Three things stretch it: the
// load beside this run, the share of the machine other programs used while it ran (`others`, 0 to 1: known at once,
// where the load is an average that lags), and fewer cores. Never under 1.
export const stretch = (load, cores, others = 0) => Math.max(1, load / cores, 1 / Math.max(0.1, 1 - others)) * Math.max(1, 8 / cores);
// Seconds of processor time all programs on this machine have used so far, on all cores. null where it cannot be read.
const machineCpu = () => { try { const n = fs.readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number); return (n[0] + n[1] + n[2] + n[5] + n[6] + n[7]) / 100; } catch { return null; } };
// What is over budget, as lines to print. `costs`: { "x.test.js": { wall, cpu, launches } } for the files of this
// selection (those run now, and those that passed before). `whole`: this is the whole suite; `wall`: seconds by the
// clock when all of it ran just now, else null.
export function overBudget(costs, { whole = false, wall = null, by = 1, budget = BUDGET } = {}) {
  const out = [], s = (n) => `${n.toFixed(1)} s`;
  for (const [f, c] of Object.entries(costs)) {
    if (c.cpu > budget.fileCpu) out.push(`test/${f}: ${s(c.cpu)} of processor time (budget ${budget.fileCpu} s)`);
    if (c.ran && c.wall > budget.fileWall * by) out.push(`test/${f}: ${s(c.wall)} by the clock (budget ${s(budget.fileWall * by)}${by > 1 ? ", stretched: the machine is busy" : ""})`);
    if (c.launches > budget.fileLaunches) out.push(`test/${f}: starts ${c.launches} programs (budget ${budget.fileLaunches})`);
  }
  if (whole) {
    const cpu = Object.values(costs).reduce((a, c) => a + c.cpu, 0);
    if (cpu > budget.suiteCpu) out.push(`the whole suite: ${s(cpu)} of processor time (budget ${budget.suiteCpu} s)`);
    if (wall !== null && wall > budget.suiteWall * by) out.push(`the whole suite: ${s(wall)} by the clock (budget ${s(budget.suiteWall * by)}${by > 1 ? ", stretched: the machine is busy" : ""})`);
  }
  return out;
}

// ---- the command ----------------------------------------------------------------------------------------------------
// `budget`: only a test of this command gives another one.
export async function main(argv, { budget = BUDGET } = {}) {
  const root = path.dirname(here), store = storeDir();
  const flags = new Set(argv.filter((a) => a.startsWith("--"))), areas = argv.filter((a) => !a.startsWith("--"));
  const odd = [...flags].filter((f) => !["--all", "--fresh"].includes(f));
  if (odd.length) { console.error(`check: unknown ${odd.join(", ")}. Usage: npm run check [-- --all] [-- --fresh] [areas]`); return 2; }
  // A worktree that was never set up: every test would fail on its first import.
  const missing = Object.keys(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).dependencies || {}).filter((d) => !fs.existsSync(path.join(root, "node_modules", d)));
  if (missing.length) { console.error(`check: ${missing.join(", ")} is not installed in this folder. Run \`npm ci\` first.`); return 2; }
  const all = fs.readdirSync(here).filter((f) => f.endsWith(".test.js")).sort();
  let files = all, what = "the whole suite";
  if (areas.length) {
    const named = filesFor(areas, all);
    if (named.unknown.length) { console.error(`No test file starts with: ${named.unknown.join(", ")}\nThe areas: ${all.map((f) => f.replace(".test.js", "")).join(" ")}`); return 2; }
    files = named.files; what = `named: ${areas.join(" ")}`;
  } else if (!flags.has("--all")) {
    const changed = changedSince(root);
    if (changed) {
      const read = (f) => { try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return null; } };
      const hit = touched(changed, all.map((f) => `test/${f}`), read);
      files = hit.files.map((f) => path.basename(f));
      what = hit.all ? `the whole suite: ${hit.all} changed, which any test may depend on` : `the tests your change touches: ${changed.length} file${changed.length === 1 ? "" : "s"} changed since main`;
      if (!files.length) { console.log(`check: nothing to run (${changed.length ? "no test file is touched by what changed since main" : "nothing changed since main"}). The whole suite: npm run check -- --all`); return 0; }
    }
  }
  const whole = files.length === all.length;
  const tree = treeOf(root);
  const known = () => (flags.has("--fresh") ? {} : remembered(store, tree));
  const say = (need, before) => `check: ${files.length} test file${files.length === 1 ? "" : "s"} (${what})${before ? ` · ${before} already passed for this exact code` : ""}${need ? ` · ${need} to run` : ""}`;
  let before = known(), need = files.filter((f) => !before[f]);
  const done = () => {
    const over = overBudget(Object.fromEntries(files.map((f) => [f, before[f]])), { whole, budget });
    if (over.length) { console.log(`${say(0, files.length)}\n\n✖ over budget (see docs/testing.md):\n${over.map((l) => `  ${l}`).join("\n")}`); return 1; }
    console.log(`${say(0, files.length)}: nothing to run again. ✔`); return 0;
  };
  if (!need.length) return done();
  const free = takeSlot(store, SLOTS, () => console.log(`check: waiting for a turn (${SLOTS} test run${SLOTS === 1 ? "" : "s"} at a time on this machine)…`));
  try {
    before = known(); need = files.filter((f) => !before[f]); // another run may have passed this code while this one waited
    if (!need.length) return done();
    console.log(say(need.length, files.length - need.length));
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), "sw-check-"));
    Object.assign(process.env, { HERDR_SUPERWORK_CHECK_PROBE: probe, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${JSON.stringify(path.join(here, "check-probe.cjs"))}`.trim() });
    const cores = os.availableParallelism(), loadBefore = os.loadavg()[0], usedBefore = machineCpu(), began = Date.now();
    const failed = new Set();
    let tests = 0;
    stepAside();
    const stream = run({ files: need.map((f) => path.join(here, f)), concurrency: cores, timeout: 120000 });
    stream.on("test:pass", (d) => { if (d.file && d.nesting === 0 && path.resolve(d.name) !== d.file) tests += 1; });
    stream.on("test:fail", (d) => { if (d.file) failed.add(path.basename(d.file)); });
    stream.compose(spec).pipe(process.stdout);
    await new Promise((r) => stream.on("end", r));
    const wall = (Date.now() - began) / 1000, used = machineCpu();
    const costs = {};
    for (const f of fs.readdirSync(probe)) { try { const c = JSON.parse(fs.readFileSync(path.join(probe, f), "utf8")); costs[c.file] = { wall: c.wall, cpu: c.cpu, launches: c.launches, ran: true }; } catch {} }
    fs.rmSync(probe, { recursive: true, force: true });
    for (const f of need) if (!costs[f]) failed.add(f); // it never got to its end
    const cpu = Object.values(costs).reduce((a, c) => a + c.cpu, 0), launches = Object.values(costs).reduce((a, c) => a + c.launches, 0);
    const others = used === null || usedBefore === null ? 0 : Math.max(0, used - usedBefore - cpu) / (cores * Math.max(wall, 0.1));
    const by = stretch(Math.max(loadBefore, os.loadavg()[0]), cores, others);
    const over = overBudget({ ...Object.fromEntries(files.filter((f) => before[f]).map((f) => [f, before[f]])), ...costs }, { whole, wall: need.length === all.length ? wall : null, by, budget });
    // Remembered: what passed, within its own budget. A file over it runs again next time: the machine may have been busy.
    // When the suite as a whole is over, nothing of this run is remembered: asked again, it is all run and measured again.
    const slow = new Set(over.map((l) => (/^test\/(\S+):/.exec(l) || [])[1]).filter(Boolean));
    const suiteOver = over.some((l) => l.startsWith("the whole suite"));
    if (!suiteOver) remember(store, tree, Object.fromEntries(need.filter((f) => !failed.has(f) && !slow.has(f)).map((f) => [f, { wall: costs[f].wall, cpu: costs[f].cpu, launches: costs[f].launches }])));
    console.log(`\ncheck: ${need.length} test file${need.length === 1 ? "" : "s"} run · ${tests} tests passed · ${wall.toFixed(1)} s by the clock, ${cpu.toFixed(1)} s of processor time · ${launches} programs started`);
    if (failed.size) console.log(`\n✖ failed: ${[...failed].sort().map((f) => `test/${f}`).join(", ")}`);
    if (over.length) console.log(`\n✖ over budget (make the tests lighter or split the file, see docs/testing.md):\n${over.map((l) => `  ${l}`).join("\n")}`);
    return failed.size || over.length ? 1 : 0;
  } finally { free?.(); }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
