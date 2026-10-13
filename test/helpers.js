// Shared test setup: a temporary board, a fake herdr and scripted fake agents. No model calls, no real board.
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { herdr } from "./fake-herdr.js";
import assert from "node:assert/strict";
import { turnEnded } from "../src/turn.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { run as ghRun } from "./fake-gh.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// A fresh world. Call at the top of each test; returns handles and a cleanup function.
export async function world({ repo = true, settings = {}, repoSettings = null, origin = false, program = false, locks = !program } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sw-test-"));
  const fake = path.join(base, "fake"); fs.mkdirSync(fake);
  const socket = path.join(base, "herdr.sock");
  const server = net.createServer(); await new Promise((r) => server.listen(socket, r));
  Object.assign(process.env, {
    HERDR_SUPERWORK_DATA_DIR: path.join(base, "data"), HERDR_SUPERWORK_CONFIG_DIR: path.join(base, "config"), HERDR_FAKE_DIR: fake,
    HERDR_BIN_PATH: path.join(here, "bin", "herdr"), HERDR_SOCKET_PATH: socket, HERDR_SUPERWORK_INLINE: "1", HERDR_SUPERWORK_SETTLE_MS: "0", HERDR_SUPERWORK_PR_LAG_MS: "0", HERDR_SUPERWORK_READY_STEP_MS: "0",
    HERDR_SUPERWORK_POLL_MS: "20", HERDR_SUPERWORK_NO_KEEPER: "1", HERDR_SUPERWORK_NO_HOOK: "1", HERDR_SUPERWORK_READ_MS: "0", HERDR_SUPERWORK_REVIEW_MS: "120000", HERDR_SUPERWORK_NO_SERVER: "1", HERDR_SUPERWORK_LINKS: "local",
    HERDR_SUPERWORK_CLAUDE_JSON: path.join(base, "claude.json"), HERDR_SUPERWORK_CODEX_TOML: path.join(base, "codex.toml"),
    PATH: `${path.join(here, "bin")}:${process.env.PATH}`,
    GIT_AUTHOR_NAME: "tester", GIT_AUTHOR_EMAIL: "t@test", GIT_COMMITTER_NAME: "tester", GIT_COMMITTER_EMAIL: "t@test",
    // git as it comes, whatever this machine's own settings are; and nothing is written to disk more carefully than a
    // folder that is deleted a second later needs.
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_COUNT: "3", GIT_CONFIG_KEY_0: "core.fsync", GIT_CONFIG_VALUE_0: "none", GIT_CONFIG_KEY_1: "gc.auto", GIT_CONFIG_VALUE_1: "0", GIT_CONFIG_KEY_2: "maintenance.auto", GIT_CONFIG_VALUE_2: "false",
  });
  for (const k of ["HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID", "HERDR_PLUGIN_ID", "HERDR_PLUGIN_CONTEXT_JSON", "HERDR_ENV", "HERDR_SESSION"]) delete process.env[k];
  globalThis.__swJobs = [];
  // The fake herdr answers in this process: launching it as a program for every call was most of the suite's time. A
  // program this test did not start itself (the command line, an agent's hook) still runs test/bin/herdr, and so does a
  // test that asks for it: `world({ program: true })`.
  globalThis.__swHerdr = program ? null : { bin: process.env.HERDR_BIN_PATH, run: herdr, turnEnded, kids: (pid) => (pid === 1 ? [2] : []),
    kill: (pid) => patchState((s) => { for (const p of s.panes) if (p.agent?.pid === pid) p.agent = null; }) }; // ending a fake agent's process: its pane is at its shell again // the fake's pids: only 1 has children
  globalThis.__swGh = program ? null : (args) => ghRun(args); // gh too: see fake-gh.js
  // Locks are kept in this process too (no flock started for every change to a task). `locks: false` takes the real
  // ones, and so does `program: true`.
  globalThis.__swLocks = locks ? new Set() : null;
  fs.mkdirSync(process.env.HERDR_SUPERWORK_CONFIG_DIR, { recursive: true });
  // The agent programs count as installed, without being run for their version. A test about a missing or old program writes its own.
  fs.mkdirSync(process.env.HERDR_SUPERWORK_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.HERDR_SUPERWORK_DATA_DIR, "versions.json"), JSON.stringify(Object.fromEntries(["claude", "codex", "pi"].map((k) => [k, { v: "9.9.9", at: Date.now(), found: true }]))));
  fs.writeFileSync(path.join(process.env.HERDR_SUPERWORK_CONFIG_DIR, "config.json"), JSON.stringify({ "watcher.agent": "none", "coordinator.agent": "none", ...settings }));
  let root = path.join(base, "proj");
  fs.mkdirSync(root);
  if (repo) {
    git(root, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(root, "a.txt"), "one\n");
    if (repoSettings) fs.writeFileSync(path.join(root, ".herdr-superwork.json"), JSON.stringify(repoSettings));
    git(root, "add", "-A"); git(root, "commit", "-qm", "init");
    if (origin) { const bare = path.join(base, "origin.git"); git(base, "init", "-q", "--bare", "-b", "main", bare); git(root, "remote", "add", "origin", bare); git(root, "push", "-q", "-u", "origin", "main"); }
  }
  root = fs.realpathSync(root);
  const state = () => JSON.parse(fs.readFileSync(path.join(fake, "state.json"), "utf8"));
  const patchState = (fn) => { const f = path.join(fake, "state.json"); let s; try { s = JSON.parse(fs.readFileSync(f, "utf8")); } catch { s = { seq: 0, nextW: 1, nextP: 100, workspaces: [], panes: [], notifications: [], metadata: [], focus: [], calls: [], dialogs: {} }; } fn(s); fs.writeFileSync(f, JSON.stringify(s)); };
  const script = (s) => fs.writeFileSync(path.join(fake, "script.json"), JSON.stringify(s));
  const cleanup = () => { server.close(); fs.rmSync(base, { recursive: true, force: true }); };
  return { base, root, fake, socket, state, patchState, script, cleanup };
}
// Run the jobs that would have been detached runners, then let the hook see the worker pane, until nothing moves.
export async function settle(id, { max = 12 } = {}) {
  const { runJob } = await import("../src/jobs.js");
  const { onPane } = await import("../src/hook.js");
  const { drainJobs } = await import("../src/runner.js");
  // What "moved" means: the task's stage and what it has seen of its agent. Not the moment of the last look (`at`),
  // which is new at every look and would keep this going to `max` each time.
  const seen = () => { const t = S.get(id); return JSON.stringify([t?.stage, { ...t?.handled, at: 0 }, t?.armedAt, { ...t?.last, at: 0 }]); };
  for (let i = 0; i < max; i++) {
    await drainJobs(runJob);
    const t = S.get(id), before = seen();
    if (t?.link?.pane) onPane(process.env.HERDR_SOCKET_PATH, t.link.pane);
    if (!globalThis.__swJobs.length && seen() === before) break;
  }
  return S.get(id);
}
// What many tests ask of a world: a task's row on the board, its agent's pane in the fake herdr, what gh was asked.
export const stateOf = (id) => F.board({ includeArchived: true }).find((t) => t.id === id);
export const paneOf = (w, t) => w.state().panes.find((p) => p.pane_id === t.link.pane);
export const ghLog = (w) => { try { return fs.readFileSync(path.join(w.fake, "gh.log"), "utf8"); } catch { return ""; } };
// The scene most tests of the finish line start from: a task whose agent made one commit, checked and reviewed,
// waiting for approval. Returns its id.
export async function toApproval(w, title = "Work", extra = {}) {
  w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }], ...extra });
  const id = A.add(w.root, title).id;
  A.delegate(id);
  const t = await settle(id);
  assert.equal(t.stage, "approval", JSON.stringify(t.failure));
  return id;
}
// Waits for something another program or a job of its own does, for as long as that takes (half a minute at most):
// it looks again every few milliseconds and goes on the moment it is so. Never a sleep of a guessed length.
export async function until(so, { ms = 30000 } = {}) {
  for (const end = Date.now() + ms; !so() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 5));
  return so();
}
// A clock that stands still until it is moved, for code that waits: no test sleeps for real or depends on how fast the
// machine is. `const clock = fastClock(t)` at the top of a test; then `await clock(somethingThatWaits())` moves time
// on, a step at a time, until that is done (its timers fire in order, at once), and `clock.tick(ms)` moves it by hand.
export function fastClock(t, { step = 100 } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.now() });
  const clock = async (work) => {
    let done = false;
    const end = () => { done = true; };
    Promise.resolve(work).then(end, end);
    while (!done) { t.mock.timers.tick(step); await new Promise(setImmediate); }
    return work;
  };
  clock.tick = (ms) => t.mock.timers.tick(ms);
  return clock;
}
