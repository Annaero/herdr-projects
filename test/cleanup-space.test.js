import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, git, stateOf, paneOf, ghLog, toApproval } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { herdr } from "../src/herdr.js";
import { onPane, reconcile, apply } from "../src/hook.js";
import { housekeeping, pollPrs } from "../src/housekeeping.js";
import { drainJobs } from "../src/runner.js";
import { runJob } from "../src/jobs.js";


test("a finished task leaves herdr's sidebar: the repo space herdr opened goes with the last task, yours stays, unsaved files stay on disk", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    // herdr opens the repo itself next to the first worktree; it is closed with the last task space, not before
    const a = await toApproval(w);
    w.script({ worker: [{ files: { "w.txt": "w\n" }, commit: "w", note: "Did w." }] });
    const b = A.add(w.root, "Second").id;
    A.delegate(b);
    assert.equal((await settle(b)).stage, "approval");
    assert.equal(w.state().workspaces.length, 3);
    A.approve(a);
    assert.equal((await settle(a)).stage, "done");
    assert.deepEqual(w.state().workspaces.map((x) => x.cwd).sort(), [w.root, S.get(b).worktree].sort());
    A.approve(b);
    let t = await settle(b);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.equal(w.state().workspaces.length, 0);
    // a repo space that was open before the task is yours and stays; calling a task done cleans up like a merge
    w.patchState((s) => { s.workspaces.push({ workspace_id: "mine", label: "proj", cwd: w.root, worktree: { checkout_path: w.root, repo_root: w.root, is_linked_worktree: false } }); s.panes.push({ pane_id: "mine:p1", workspace_id: "mine", tab_id: "mine:t1", terminal_id: "term_1", cwd: w.root, agent: null }); });
    w.script({ worker: [{ files: { "c.txt": "c\n" }, commit: "c", note: "Did c." }] });
    const c = A.add(w.root, "Third").id;
    A.delegate(c);
    assert.equal((await settle(c)).stage, "approval");
    fs.writeFileSync(path.join(S.get(c).worktree, "unsaved.txt"), "x\n");
    A.report(c, { state: "done" });
    t = await settle(c);
    assert.match(t.kept[0], /uncommitted changes/); assert.ok(fs.existsSync(t.worktree));
    assert.deepEqual(w.state().workspaces.map((x) => x.workspace_id), ["mine"]);
    await A.clear(c);
    // clean work that landed nowhere, called done: the space goes, the worktree and branch stay, and a reply continues there
    w.script({ worker: [{ files: { "d.txt": "d\n" }, commit: "d", note: "Did d." }] });
    const d = A.add(w.root, "Fourth").id;
    A.delegate(d);
    assert.equal((await settle(d)).stage, "approval");
    A.report(d, { state: "done" });
    t = await settle(d);
    assert.match(t.kept[0], /unmerged work on work\//); assert.ok(fs.existsSync(t.worktree)); assert.ok(!t.cleaned);
    assert.deepEqual(w.state().workspaces.map((x) => x.workspace_id), ["mine"]);
    w.script({ worker: [{ files: { "d2.txt": "d\n" }, commit: "d2", note: "Did more." }] });
    assert.match(A.tell(d, "go on").msg, /starting it again/);
    t = await settle(d);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.ok(fs.existsSync(path.join(t.worktree, "d.txt"))); assert.notEqual(S.cwdOf(t), w.root);
  } finally { w.cleanup(); }
});

test("the repo space is left alone while a command of yours runs in it; a reply to cleaned-up work starts a new round", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    // nothing to merge: done, cleaned up, and a reply starts a new round in a fresh worktree
    w.script({ worker: [{ note: "Looked. Nothing to change." }] });
    const id = A.add(w.root, "Look").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.ok(t.cleaned);
    assert.equal(w.state().workspaces.length, 0); assert.equal(git(w.root, "branch", "--list", "work/*"), "");
    w.script({ worker: [{ files: { "n.txt": "n\n" }, commit: "n", note: "Did n." }] });
    assert.match(A.tell(id, "then add n").msg, /new round/);
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.ok(fs.existsSync(t.worktree) && t.worktree !== w.root);
    assert.ok(paneOf(w, t).agent.prompts.some((x) => /then add n/.test(x)));
    // you started something in the repo space herdr opened: it stays
    w.patchState((s) => { s.panes.find((p) => p.cwd === w.root).busy = true; });
    A.approve(id);
    assert.equal((await settle(id)).stage, "done");
    assert.deepEqual(w.state().workspaces.map((x) => x.cwd), [w.root]);
  } finally { w.cleanup(); }
});

test("clean-up closes no space with something of yours running in it, nor one herdr cannot answer for", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  const ready = async (n) => {
    w.script({ worker: [{ files: { [`g${n}.txt`]: "x\n" }, commit: `g${n}`, note: "Did it." }] });
    const id = A.add(w.root, `Task ${n}`).id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    return t;
  };
  const open = (t) => w.state().workspaces.some((x) => x.workspace_id === t.link.workspace);
  try {
    // a pane you split off in the task's space runs a command: marking the task done leaves the whole space open
    let t = await ready(1);
    const mine = herdr().paneSplit(t.link.pane, { cwd: t.worktree });
    w.patchState((s) => { s.panes.find((p) => p.pane_id === mine.pane_id).busy = true; });
    A.report(t.id, { state: "done" });
    t = await settle(t.id);
    assert.match(t.kept[0], /in use again/); assert.ok(open(t)); assert.ok(fs.existsSync(t.worktree));
    assert.ok(w.state().panes.some((p) => p.pane_id === mine.pane_id));
    // the same after a merge: the worktree is not pulled from under your command
    t = await ready(2);
    const mine2 = herdr().paneSplit(t.link.pane, { cwd: t.worktree });
    w.patchState((s) => { s.panes.find((p) => p.pane_id === mine2.pane_id).busy = true; });
    A.approve(t.id);
    t = await settle(t.id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.match(t.kept[0], /in use again/); assert.ok(open(t)); assert.ok(fs.existsSync(t.worktree));
    // herdr does not answer whether the agent works: unknown is not "nobody there"
    t = await ready(3);
    S.update(t.id, (t) => { t.stage = "done"; });
    w.patchState((s) => { s.agentGetFails = true; });
    const { cleanupJob } = await import("../src/land.js");
    await cleanupJob(t.id, { deleteBranch: "merged" });
    w.patchState((s) => { s.agentGetFails = false; });
    t = S.get(t.id);
    assert.match(t.kept[0], /in use again/); assert.ok(open(t)); assert.ok(fs.existsSync(t.worktree));
  } finally { w.cleanup(); }
});
