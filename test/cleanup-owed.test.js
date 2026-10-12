import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, git } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { herdr } from "../src/herdr.js";
import { onPane, reconcile, apply } from "../src/hook.js";
import { housekeeping, pollPrs } from "../src/housekeeping.js";
import { drainJobs } from "../src/runner.js";
import { runJob } from "../src/jobs.js";

const stateOf = (id) => F.board({ includeArchived: true }).find((t) => t.id === id);
const paneOf = (w, t) => w.state().panes.find((p) => p.pane_id === t.link.pane);
const ghLog = (w) => { try { return fs.readFileSync(path.join(w.fake, "gh.log"), "utf8"); } catch { return ""; } };
async function toApproval(w, title = "Work", extra = {}) {
  w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }], ...extra });
  const id = A.add(w.root, title).id;
  A.delegate(id);
  const t = await settle(id);
  assert.equal(t.stage, "approval", JSON.stringify(t.failure));
  return id;
}

test("clean-up touches nothing while the task's herdr session cannot be reached, and a close herdr did not do is tried again", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  const { housekeeping } = await import("../src/housekeeping.js");
  const { cleanupJob } = await import("../src/land.js");
  const open = (t) => w.state().workspaces.some((x) => x.workspace_id === t.link?.workspace);
  const pass = async (id) => {
    fs.rmSync(path.join(process.env.HERDR_SUPERWORK_DATA_DIR, "stamps"), { recursive: true, force: true });
    globalThis.__swJobs = [];
    housekeeping(w.socket, { force: true });
    const jobs = globalThis.__swJobs.filter((j) => j[0] === "cleanup" && j[1] === id);
    globalThis.__swJobs = [];
    for (const [, , extra] of jobs) await cleanupJob(id, { deleteBranch: extra.includes("--merged") ? "merged" : "always" });
    return jobs.length;
  };
  const ready = async (n) => {
    w.script({ worker: [{ files: { [`k${n}.txt`]: "x\n" }, commit: `k${n}`, note: "Did it." }] });
    const id = A.add(w.root, `Task ${n}`).id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    return t;
  };
  try {
    // merged on GitHub, say, while the task's herdr session is down: its agent may be working there, so nothing goes
    let t = await ready(1);
    S.update(t.id, (c) => { c.stage = "done"; c.link = { ...c.link, socket: path.join(w.base, "gone.sock") }; });
    await cleanupJob(t.id, { deleteBranch: "always" });
    let c = S.get(t.id);
    assert.match(c.kept[0], /cannot be reached/); assert.ok(c.tidy && c.link.pane); assert.ok(fs.existsSync(t.worktree)); assert.ok(git(w.root, "branch", "--list", t.branch));
    assert.equal(await pass(t.id), 0); // not from this session
    S.update(t.id, (c) => { c.link = { ...c.link, socket: w.socket }; }); // it is back
    assert.equal(await pass(t.id), 1);
    c = S.get(t.id);
    assert.ok(c.cleaned && !c.tidy); assert.ok(!fs.existsSync(t.worktree)); assert.equal(w.state().workspaces.length, 0);
    // unsaved files are kept and the space is to be closed, but herdr times out: tried again until it is closed
    t = await ready(2);
    fs.writeFileSync(path.join(t.worktree, "unsaved.txt"), "x\n");
    w.patchState((s) => { s.closeFails = true; });
    A.report(t.id, { state: "done" });
    c = await settle(t.id);
    assert.match(c.kept[0], /uncommitted changes/); assert.ok(open(c) && c.tidy);
    w.patchState((s) => { s.closeFails = false; });
    assert.equal(await pass(t.id), 1);
    c = S.get(t.id);
    assert.match(c.kept[0], /uncommitted changes/); assert.ok(!c.tidy); assert.ok(fs.existsSync(path.join(t.worktree, "unsaved.txt")));
    assert.equal(w.state().workspaces.length, 0); // the task's space, and the repo space herdr had opened
    // herdr fails to remove the worktree, git does it, and then herdr does not say whether the space is still open
    t = await ready(3);
    w.patchState((s) => { s.removeFails = true; s.wsGetOk = 1; });
    S.update(t.id, (c) => { c.stage = "done"; });
    await cleanupJob(t.id, { deleteBranch: "always" });
    c = S.get(t.id);
    assert.ok(!fs.existsSync(t.worktree)); assert.ok(open(c)); assert.ok(c.tidy && c.link.workspace && !c.cleaned); assert.match(c.kept[0], /did not close its space/);
    w.patchState((s) => { s.removeFails = false; delete s.wsGetOk; });
    assert.equal(await pass(t.id), 1);
    c = S.get(t.id);
    assert.ok(c.cleaned && !c.tidy && !c.kept); assert.equal(w.state().workspaces.length, 0);
    // a reply while that clean-up is still pending starts a new round; the old space is not forgotten
    t = await ready(4);
    w.patchState((s) => { s.removeFails = true; s.wsGetOk = 1; });
    S.update(t.id, (c) => { c.stage = "done"; });
    await cleanupJob(t.id, { deleteBranch: "always" });
    const oldSpace = S.get(t.id).link.workspace;
    w.patchState((s) => { s.removeFails = false; delete s.wsGetOk; s.closeFails = true; });
    w.script({ worker: [{ files: { "again.txt": "x\n" }, commit: "again", note: "Did more." }] });
    assert.match(A.tell(t.id, "one more").msg, /new round/);
    c = await settle(t.id);
    assert.equal(c.stage, "approval", JSON.stringify(c.failure)); assert.notEqual(c.link.workspace, oldSpace); assert.ok(!c.tidy);
    assert.ok(w.state().workspaces.some((x) => x.workspace_id === oldSpace)); // herdr still does not close it
    w.patchState((s) => { s.closeFails = false; const p = s.panes.find((p) => p.workspace_id === oldSpace && p.agent); p.agent.status = "unknown"; });
    await pass(t.id);
    assert.ok(w.state().workspaces.some((x) => x.workspace_id === oldSpace)); // its agent may be at work: herdr cannot tell
    w.patchState((s) => { s.panes.find((p) => p.workspace_id === oldSpace && p.agent).agent.status = "idle"; });
    w.patchState((s) => { s.panes.find((p) => p.workspace_id === oldSpace && p.agent).tool = true; });
    await pass(t.id);
    assert.ok(w.state().workspaces.some((x) => x.workspace_id === oldSpace)); // idle, but something it started still runs
    w.patchState((s) => { s.panes.find((p) => p.workspace_id === oldSpace && p.agent).tool = false; });
    S.setConfig("cleanup", false); // turned off meanwhile: what was pending is left alone
    await pass(t.id);
    assert.ok(w.state().workspaces.some((x) => x.workspace_id === oldSpace));
    S.setConfig("cleanup", true);
    await pass(t.id);
    assert.ok(!w.state().workspaces.some((x) => x.workspace_id === oldSpace)); assert.ok(open(S.get(t.id)));
  } finally { w.cleanup(); }
});

test("a clean-up that was killed half-way, or never started, is owed from the moment the task is done and is carried out later", async () => {
  // the teardown copies the task as it stands while clean-up runs: the note that it is owed must already be there
  const w = await world({ settings: { reviewer: "off" }, repoSettings: { teardown: 'cp "$HERDR_SUPERWORK_DATA_DIR/tasks/proj/1/task.json" "$HERDR_SUPERWORK_DATA_DIR/during.json"' } });
  const { housekeeping } = await import("../src/housekeeping.js");
  const { cleanupJob } = await import("../src/land.js");
  try {
    const id = await toApproval(w);
    A.approve(id);
    let t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.ok(t.cleaned && !t.tidy);
    const during = JSON.parse(fs.readFileSync(path.join(process.env.HERDR_SUPERWORK_DATA_DIR, "during.json"), "utf8"));
    assert.equal(during.stage, "done"); assert.equal(during.tidy.deleteBranch, "always"); assert.ok(during.tidy.tip);
    // the merge worker dies during teardown: the task is done, its space is open, its runner marker is a dead process
    w.script({ worker: [{ files: { "z.txt": "z\n" }, commit: "z", note: "Did z." }] });
    const z = A.add(w.root, "Killed").id;
    A.delegate(z);
    t = await settle(z);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    S.update(z, (c) => { c.stage = "done"; c.tidy = F.tidyMark(c, "always"); c.runner = { pid: 2 ** 22 + 77, started: Date.now(), job: "land" }; });
    globalThis.__swJobs = [];
    fs.rmSync(path.join(process.env.HERDR_SUPERWORK_DATA_DIR, "stamps"), { recursive: true, force: true });
    housekeeping(w.socket, { force: true });
    const jobs = globalThis.__swJobs.filter((j) => j[0] === "cleanup" && j[1] === z);
    globalThis.__swJobs = [];
    assert.equal(jobs.length, 1); assert.deepEqual(jobs[0][2], []);
    await cleanupJob(z, { deleteBranch: "always" });
    const c = S.get(z);
    assert.ok(c.cleaned && !c.tidy); assert.ok(!fs.existsSync(t.worktree)); assert.equal(w.state().workspaces.length, 0);
  } finally { w.cleanup(); }
});
