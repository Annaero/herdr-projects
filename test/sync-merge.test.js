// Conflicts with main are caught before review, not after approval: the board brings every task's branch up to date
// by itself, and the agent hears about it only when there is a real conflict.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, git, stateOf, paneOf } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";

const holds = (dir, sha) => { try { git(dir, "merge-base", "--is-ancestor", sha, "HEAD"); return true; } catch { return false; } };
const mainMoves = (w, file, text) => { fs.writeFileSync(path.join(w.root, file), text); git(w.root, "add", "-A"); git(w.root, "commit", "-qm", `main: ${file}`); return git(w.root, "rev-parse", "HEAD"); };
// A task whose agent stopped to ask, so main can move before its work is finished.
async function asking(w, title) {
  const id = A.add(w.root, title).id;
  A.delegate(id);
  const t = await settle(id);
  assert.equal(t.stage, "asks");
  return id;
}
// The agent's turn ends by hand: a closing note, and herdr says done.
function endTurn(w, t, text) {
  const note = F.noteFile(t);
  fs.writeFileSync(note, text); const later = new Date(Date.now() + 2000); fs.utimesSync(note, later, later);
  w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
}

test("main is merged into the task's branch before the check and the review; the agent is told nothing", async () => {
  const w = await world({ repoSettings: { check: "test -f g.txt" } }); // the check passes only on the branch as it will land
  try {
    w.script({ worker: [{ note: "Which one?" }, { files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }] });
    const id = await asking(w, "Clean sync");
    const target = mainMoves(w, "g.txt", "from main\n");
    A.tell(id, "The first one.");
    let t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    assert.ok(holds(t.worktree, target), "the branch holds main");
    assert.equal(t.syncedTo, target);
    assert.equal(t.review.pass, true); assert.equal(t.reviewedHead, git(t.worktree, "rev-parse", "HEAD"));
    assert.match(t.stat, /^1 file changed/); // the change is what it adds to main: g.txt is not part of it
    assert.equal(paneOf(w, t).agent.prompts.length, 2); // its task and your answer: nothing about main
    assert.equal(git(w.root, "status", "--porcelain"), "");
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.equal(fs.readFileSync(path.join(w.root, "f.txt"), "utf8"), "v1\n");
  } finally { w.cleanup(); }
});

test("when another task merges, the waiting ones are brought up to date; a review is repeated only where the update touched the task's files", async () => {
  const w = await world();
  try {
    const big = (first, last) => [first, ...Array.from({ length: 18 }, (_, i) => `line ${i + 2}`), last].join("\n") + "\n";
    mainMoves(w, "big.txt", big("line 1", "line 20"));
    const start = async (title, files) => { w.script({ worker: [{ files, commit: title, note: `Did ${title}.` }] }); const id = A.add(w.root, title).id; A.delegate(id); assert.equal((await settle(id)).stage, "approval"); return id; };
    const first = await start("first", { "big.txt": big("FIRST", "line 20") });
    const apart = await start("apart", { "other.txt": "apart\n" });
    const near = await start("near", { "big.txt": big("line 1", "NEAR") });
    const clash = await start("clash", { "big.txt": big("CLASH", "line 20") });
    const before = S.get(apart);
    w.script({ worker: [{ note: null, status: "working" }] }); // the agent of `clash`, told about its conflict
    A.approve(first);
    assert.equal((await settle(first)).stage, "done");
    const main = git(w.root, "rev-parse", "HEAD");
    // another task's files: updated and checked, and the review stands
    let t = await settle(apart);
    assert.equal(t.stage, "approval"); assert.ok(holds(t.worktree, main)); assert.notEqual(t.reviewedHead, before.reviewedHead);
    assert.equal(t.reviewedHead, git(t.worktree, "rev-parse", "HEAD")); assert.equal(t.syncedTo, main);
    assert.equal(t.reviewRound, 1); assert.ok(t.review.keptAt); assert.match(t.msg, /^Approve to merge\?/);
    assert.equal(paneOf(w, t).agent.prompts.length, 1);
    // the same file, merged cleanly: reviewed again as it will land
    t = await settle(near);
    assert.equal(t.stage, "approval"); assert.ok(holds(t.worktree, main)); assert.equal(t.reviewRound, 2); assert.ok(!t.review.keptAt);
    assert.equal(paneOf(w, t).agent.prompts.length, 1);
    // a real conflict: it no longer looks ready to approve, and its agent is already on it
    t = await settle(clash);
    assert.equal(t.stage, "working"); assert.equal(t.failure.title, "Merge conflict with main"); assert.equal(t.review.stale, true);
    assert.match(paneOf(w, t).agent.prompts.at(-1), /Conflicting files:\n- big\.txt/);
    assert.equal(git(t.worktree, "status", "--porcelain"), ""); assert.ok(!holds(t.worktree, main));
    assert.equal(stateOf(clash).state, "working"); assert.throws(() => A.approve(clash), /not waiting for an approval/);
    // and the ones still waiting land without a second sync finding anything
    A.approve(apart);
    assert.equal((await settle(apart)).stage, "done");
    assert.equal(fs.readFileSync(path.join(w.root, "other.txt"), "utf8"), "apart\n");
  } finally { w.cleanup(); }
});

test("main moving on while a sync runs is not marked as handled: only the commit that was merged counts as seen", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  const Y = await import("../src/sync.js");
  const { housekeeping } = await import("../src/housekeeping.js");
  try {
    w.script({ worker: [{ files: { "a.txt": "from the agent\n" }, commit: "agent", note: "Changed a.txt." }, { note: null, status: "working" }] });
    const id = A.add(w.root, "Race").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval");
    const first = mainMoves(w, "g.txt", "from main\n");
    const r = Y.syncMain(t, t.worktree);          // the sync merges this main...
    const second = mainMoves(w, "a.txt", "from main\n"); // ...and main moves again, with a conflict, before it is recorded
    assert.equal(r.status, "merged"); assert.equal(r.target, first);
    const patch = Y.seenPatch(t, r);
    assert.ok(patch.syncSeen.startsWith(first)); assert.notEqual(patch.syncSeen, Y.knownTarget(t));
    S.update(id, { ...patch, reviewedHead: r.head });
    globalThis.__swJobs = [];
    housekeeping(w.socket, { force: true });
    assert.equal(globalThis.__swJobs.filter(([job]) => job === "sync").length, 1); // so the board looks again
    t = await settle(id);
    assert.equal(t.stage, "working"); assert.equal(t.failure.title, "Merge conflict with main");
    assert.ok(paneOf(w, t).agent.prompts.at(-1).includes(`Target commit: ${second}`));
  } finally { w.cleanup(); }
});

test("a worktree that left the task's own branch is not checked, reviewed or put up for approval", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ note: "Which one?" }, { files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }, { note: "Back on my branch." }] });
    const id = await asking(w, "Strayed");
    let t = S.get(id);
    const target = mainMoves(w, "g.txt", "from main\n");
    git(t.worktree, "checkout", "-q", "-b", "strayed");
    A.tell(id, "The first one.");
    t = await settle(id);
    assert.equal(t.stage, "failed"); assert.equal(t.failure.title, "Task is on the wrong branch"); assert.ok(!t.review && !t.reviewedHead);
    assert.ok(!holds(t.worktree, target)); assert.equal(stateOf(id).state, "error");
    assert.throws(() => A.approve(id), /not waiting for an approval/);
    // back on its own branch with the work: synced, checked and reviewed as usual
    git(t.worktree, "checkout", "-q", t.branch); git(t.worktree, "merge", "-q", "strayed");
    A.sendFailure(id);
    assert.match(paneOf(w, S.get(id)).agent.prompts.at(-1), /Task is on the wrong branch/);
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.ok(holds(t.worktree, target)); assert.equal(t.review.pass, true);
  } finally { w.cleanup(); }
});

test("main renaming a file the task edited is an update to the task's own files: the review is repeated", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ files: { "a.txt": "one\nand more from the agent\n" }, commit: "agent", note: "Extended a.txt." }] });
    const id = A.add(w.root, "Renamed").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.reviewRound, 1);
    git(w.root, "mv", "a.txt", "b.txt"); git(w.root, "commit", "-qm", "main: rename");
    const target = git(w.root, "rev-parse", "HEAD");
    const { housekeeping } = await import("../src/housekeeping.js");
    housekeeping(w.socket, { force: true });
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.ok(holds(t.worktree, target));
    assert.equal(fs.readFileSync(path.join(t.worktree, "b.txt"), "utf8"), "one\nand more from the agent\n"); // the edit followed the rename
    assert.equal(t.reviewRound, 2); assert.ok(!t.review.keptAt); // what would land changed shape: reviewed again
  } finally { w.cleanup(); }
});
