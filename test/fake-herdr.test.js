// The fake herdr itself: tests call it in their own process, programs they start run it as a program. Both must answer alike.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { world, settle } from "./helpers.js";
import { herdr as fake } from "./fake-herdr.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { herdr, HerdrError } from "../src/herdr.js";

test("the fake herdr answers the same called in the test's process as run as a program: output, exit status, saved state", async () => {
  const w = await world();
  try {
    const dirs = ["called", "program"].map((n) => { const d = path.join(w.base, n); fs.mkdirSync(d); fs.writeFileSync(path.join(d, "script.json"), JSON.stringify({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did it.", screen: "the screen" }] })); return d; });
    const env = (dir) => ({ ...process.env, HERDR_FAKE_DIR: dir });
    const called = (args) => { const r = fake(args, env(dirs[0])); return { status: r.status, stdout: r.stdout, stderr: r.stderr }; };
    const program = (args) => { const r = spawnSync(process.env.HERDR_BIN_PATH, args, { encoding: "utf8", env: env(dirs[1]) }); return { status: r.status, stdout: r.stdout, stderr: r.stderr }; };
    const steps = [["workspace", "create", "--cwd", w.root, "--label", "proj", "--env", "A=b=c"], ["workspace", "list"], ["pane", "split", "w1:p1", "--cwd", w.root], ["pane", "layout", "--pane", "w1:p2"],
      ["agent", "start", "sw-proj-1", "--pane", "w1:p1", "--kind", "claude", "--", "--session-id", "abc"], ["agent", "start", "again", "--pane", "w1:p1", "--kind", "claude"], // a busy pane: an error, exit 1
      ["agent", "get", "sw-proj-1"], ["agent", "prompt", "sw-proj-1", "Do the work"], ["agent", "read", "sw-proj-1"], ["agent", "get", "sw-proj-1"], ["agent", "prompt", "sw-proj-1", "Once more"],
      ["agent", "get", "nobody"], ["pane", "close", "w1:p2"], ["notification", "show", "Hello", "--body", "there"], ["machine", "list"], ["workspace", "close", "w9"], ["frobnicate"]];
    const tidy = (commit) => { S.gitOut(w.root, ["reset", "-q", "--hard", commit]); S.gitOut(w.root, ["clean", "-fdq"]); };
    const got = {};
    for (const args of steps) {
      const a = called(args);
      if (args[3] === "Do the work") tidy("HEAD~1"); // the same repo for both: the program's turn starts where this one did
      assert.deepEqual(program(args), a, args.join(" "));
      got[args.join(" ")] = a;
    }
    assert.equal(got["agent read sw-proj-1"].stdout, "the screen"); assert.equal(got["agent get nobody"].status, 1); assert.match(got.frobnicate.stderr, /unknown_command/);
    const [a, b] = dirs.map((d) => fs.readFileSync(path.join(d, "state.json"), "utf8"));
    assert.equal(a, b); assert.equal(JSON.parse(a).calls.length, steps.length);
    // an error of the fake's own (here: nothing to commit) ends it as a program that died: exit 1, the error on stderr, nothing saved
    for (const d of dirs) fs.writeFileSync(path.join(d, "script.json"), JSON.stringify({ worker: [{ commit: "nothing changed" }] }));
    const died = [called, program].map((run) => { tidy("HEAD"); return run(["agent", "prompt", "sw-proj-1", "Commit nothing"]); });
    assert.deepEqual(died.map((r) => [r.status, r.stdout]), [[1, ""], [1, ""]]); for (const r of died) assert.match(r.stderr, /Command failed: git .*commit/);
    assert.deepEqual(dirs.map((d) => fs.readFileSync(path.join(d, "state.json"), "utf8")), [a, a]);
  } finally { w.cleanup(); }
});

test("the board's own calls reach herdr either way: in the test's process by default, as a real program when the test asks", async () => {
  for (const program of [false, true]) {
    const w = await world({ program, settings: { reviewer: "off" } });
    try {
      assert.equal(Boolean(globalThis.__swHerdr), !program);
      const h = herdr(w.socket);
      assert.throws(() => h.call(["frobnicate"]), (e) => e instanceof HerdrError && e.code === "unknown_command" && /fake herdr does not know: frobnicate/.test(e.message));
      assert.equal(h.workspaceGet("w9"), null); assert.equal(h.alive(), true);
      w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }] });
      const id = A.add(w.root, "Work").id;
      A.delegate(id);
      assert.equal((await settle(id)).stage, "approval");
      assert.ok(w.state().calls.some((c) => c.startsWith("agent prompt ")));
      // another program path is always started for real, whatever the test's world answers for
      const real = process.env.HERDR_BIN_PATH, own = path.join(w.base, "herdr-own");
      fs.writeFileSync(own, '#!/bin/sh\necho \'{"id":"own","result":{"workspaces":[{"workspace_id":"mine"}]}}\'\n', { mode: 0o755 });
      process.env.HERDR_BIN_PATH = own;
      try { assert.deepEqual(h.workspaces(), [{ workspace_id: "mine" }]); } finally { process.env.HERDR_BIN_PATH = real; }
    } finally { w.cleanup(); }
  }
});
