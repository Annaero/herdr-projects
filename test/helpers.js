// Shared test setup: a temporary board, a fake herdr and scripted fake agents. No model calls, no real board.
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { herdr } from "./fake-herdr.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// A fresh world. Call at the top of each test; returns handles and a cleanup function.
export async function world({ repo = true, settings = {}, repoSettings = null, origin = false, program = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sw-test-"));
  const fake = path.join(base, "fake"); fs.mkdirSync(fake);
  const socket = path.join(base, "herdr.sock");
  const server = net.createServer(); await new Promise((r) => server.listen(socket, r));
  Object.assign(process.env, {
    HERDR_SUPERWORK_DATA_DIR: path.join(base, "data"), HERDR_SUPERWORK_CONFIG_DIR: path.join(base, "config"), HERDR_FAKE_DIR: fake,
    HERDR_BIN_PATH: path.join(here, "bin", "herdr"), HERDR_SOCKET_PATH: socket, HERDR_SUPERWORK_INLINE: "1", HERDR_SUPERWORK_SETTLE_MS: "0",
    HERDR_SUPERWORK_POLL_MS: "20", HERDR_SUPERWORK_NO_KEEPER: "1", HERDR_SUPERWORK_NO_HOOK: "1", HERDR_SUPERWORK_READ_MS: "0", HERDR_SUPERWORK_REVIEW_MS: "4000", HERDR_SUPERWORK_NO_SERVER: "1",
    HERDR_SUPERWORK_CLAUDE_JSON: path.join(base, "claude.json"), HERDR_SUPERWORK_CODEX_TOML: path.join(base, "codex.toml"),
    PATH: `${path.join(here, "bin")}:${process.env.PATH}`,
    GIT_AUTHOR_NAME: "tester", GIT_AUTHOR_EMAIL: "t@test", GIT_COMMITTER_NAME: "tester", GIT_COMMITTER_EMAIL: "t@test",
  });
  for (const k of ["HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID", "HERDR_PLUGIN_ID", "HERDR_PLUGIN_CONTEXT_JSON", "HERDR_ENV", "HERDR_SESSION"]) delete process.env[k];
  globalThis.__swJobs = [];
  // The fake herdr answers in this process: launching it as a program for every call was most of the suite's time. A
  // program this test did not start itself (the command line, an agent's hook) still runs test/bin/herdr, and so does a
  // test that asks for it: `world({ program: true })`.
  globalThis.__swHerdr = program ? null : { bin: process.env.HERDR_BIN_PATH, run: herdr };
  fs.mkdirSync(process.env.HERDR_SUPERWORK_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.HERDR_SUPERWORK_CONFIG_DIR, "config.json"), JSON.stringify({ watcher: "off", coordinator: "off", serve: "local", ...settings }));
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
  const S = await import("../src/store.js");
  const { runJob } = await import("../src/jobs.js");
  const { onPane } = await import("../src/hook.js");
  const { drainJobs } = await import("../src/runner.js");
  for (let i = 0; i < max; i++) {
    await drainJobs(runJob);
    const t = S.get(id);
    const before = JSON.stringify([t?.stage, t?.handled, t?.armedAt, t?.last]);
    if (t?.link?.pane) onPane(process.env.HERDR_SOCKET_PATH, t.link.pane);
    if (!globalThis.__swJobs.length && JSON.stringify([S.get(id)?.stage, S.get(id)?.handled, S.get(id)?.armedAt, S.get(id)?.last]) === before) break;
  }
  return S.get(id);
}
