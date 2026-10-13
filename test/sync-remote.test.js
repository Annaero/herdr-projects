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

test("with a remote: main moving there (not through the board) is noticed by the periodic fetch, and the updated branch is pushed", async () => {
  const w = await world({ origin: true, settings: { "review.when": "never" } });
  try {
    w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }] });
    const id = A.add(w.root, "Remote").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.syncSeen, git(w.root, "rev-parse", "origin/main"));
    // someone else pushes to main
    const other = path.join(w.base, "other");
    git(w.base, "clone", "-q", path.join(w.base, "origin.git"), other);
    fs.writeFileSync(path.join(other, "g.txt"), "theirs\n"); git(other, "add", "-A"); git(other, "commit", "-qm", "theirs"); git(other, "push", "-q", "origin", "main");
    const target = git(other, "rev-parse", "HEAD");
    const { housekeeping, pollPrs } = await import("../src/housekeeping.js");
    housekeeping(w.socket, { force: true });
    assert.equal(globalThis.__swJobs.filter(([job]) => job === "sync").length, 0); // nothing known locally yet
    globalThis.__swJobs = [];
    await pollPrs();
    housekeeping(w.socket, { force: true });
    assert.equal(globalThis.__swJobs.filter(([job]) => job === "sync").length, 1);
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    assert.ok(holds(t.worktree, target)); assert.equal(t.syncedTo, target); assert.equal(t.syncSeen, target);
    assert.equal(git(w.root, "ls-remote", "--heads", "origin", t.branch).split("\t")[0], git(t.worktree, "rev-parse", "HEAD"));
    assert.equal(paneOf(w, t).agent.prompts.length, 1);
    housekeeping(w.socket, { force: true });
    assert.equal(globalThis.__swJobs.filter(([job]) => job === "sync").length, 0); // and it is not asked again
  } finally { w.cleanup(); }
});

test("a fetch that fails is not a sync: a finished turn is held with the error, and a waiting task is tried again once the remote answers", async () => {
  const w = await world({ origin: true, settings: { "review.when": "never" } });
  const { housekeeping, pollPrs } = await import("../src/housekeeping.js");
  const syncJobs = () => globalThis.__swJobs.filter(([job]) => job === "sync").length;
  const bare = path.join(w.base, "origin.git");
  try {
    process.env.HERDR_SUPERWORK_SYNC_RETRY_MS = "60000";
    // before review: no review and no approval for work that could not be brought up to date
    w.script({ worker: [{ note: "Which one?" }, { files: { "a.txt": "from the agent\n" }, commit: "agent", note: "Changed a.txt." }, { note: "Nothing to change." }] });
    const id = await asking(w, "Offline");
    git(w.root, "remote", "set-url", "origin", path.join(w.base, "gone.git"));
    A.tell(id, "The first one.");
    let t = await settle(id);
    assert.equal(t.stage, "failed"); assert.equal(t.failure.title, "Could not synchronize main"); assert.ok(!t.reviewedHead);
    assert.equal(stateOf(id).state, "error"); assert.throws(() => A.approve(id), /not waiting for an approval/);
    git(w.root, "remote", "set-url", "origin", bare);
    A.sendError(id);
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    // waiting for approval: main moves at the remote, with a conflict, and is known here; then the remote goes away
    const other = path.join(w.base, "other");
    git(w.base, "clone", "-q", bare, other);
    fs.writeFileSync(path.join(other, "a.txt"), "theirs\n"); git(other, "commit", "-qam", "theirs"); git(other, "push", "-q", "origin", "main");
    const target = git(other, "rev-parse", "HEAD");
    await pollPrs();
    const seen = S.get(id).syncSeen;
    git(w.root, "remote", "set-url", "origin", path.join(w.base, "gone.git"));
    globalThis.__swJobs = [];
    housekeeping(w.socket, { force: true });
    assert.equal(syncJobs(), 1);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.syncSeen, seen, "the failed attempt is not marked as seen"); assert.ok(t.syncRetryAt > Date.now());
    // and it does not look ready: the row says why, and an approval is refused
    assert.match(t.syncBlocked.why, /main could not be fetched/); assert.match(t.msg, /^Behind main/);
    assert.deepEqual([stateOf(id).asReview, F.labelOf(t)], [false, "needs you"]);
    assert.throws(() => A.approve(id), /behind main and cannot be approved yet/);
    housekeeping(w.socket, { force: true });
    assert.equal(syncJobs(), 0); // not hammered: it waits for the pause
    // the remote is back, and main has not moved again: the retry still comes, and finds the conflict
    git(w.root, "remote", "set-url", "origin", bare);
    S.update(id, { syncRetryAt: Date.now() - 1 });
    w.script({ worker: [{ note: null, status: "working" }] });
    housekeeping(w.socket, { force: true });
    assert.equal(syncJobs(), 1);
    t = await settle(id);
    assert.equal(t.stage, "working"); assert.equal(t.failure.title, "Merge conflict with main"); assert.equal(t.syncBlocked, null);
    assert.ok(paneOf(w, t).agent.prompts.at(-1).includes(`Target commit: ${target}`));
  } finally { delete process.env.HERDR_SUPERWORK_SYNC_RETRY_MS; w.cleanup(); }
});

test("with a remote but pull requests off, tasks land in your local branch: that branch is the main they are kept up to date with", async () => {
  const w = await world({ origin: true, settings: { "review.when": "never", "merge.pr": false } });
  const { housekeeping } = await import("../src/housekeeping.js");
  try {
    const start = async (title, files) => { w.script({ worker: [{ files, commit: title, note: `Did ${title}.` }] }); const id = A.add(w.root, title).id; A.delegate(id); assert.equal((await settle(id)).stage, "approval"); return id; };
    const first = await start("first", { "a.txt": "first\n" });
    const second = await start("second", { "a.txt": "second\n" });
    assert.ok(!S.get(first).pr); assert.equal(S.get(second).syncBranch, "main");
    w.script({ worker: [{ note: null, status: "working" }] }); // the agent of `second`, told about its conflict
    A.approve(first);
    assert.equal((await settle(first)).stage, "done");
    const local = git(w.root, "rev-parse", "HEAD");
    assert.notEqual(local, git(w.root, "rev-parse", "origin/main")); // landed here, not at the remote
    housekeeping(w.socket, { force: true });
    const t = await settle(second);
    assert.equal(t.stage, "working"); assert.equal(t.failure.title, "Merge conflict with main");
    assert.ok(paneOf(w, t).agent.prompts.at(-1).includes(`Target commit: ${local} (main)`));
    assert.throws(() => A.approve(second), /not waiting for an approval/);
  } finally { w.cleanup(); }
});

test("when the periodic fetch fails, nothing is known about main: waiting tasks are held as behind main until a fetch works", async () => {
  const w = await world({ origin: true, settings: { "review.when": "never" } });
  const { housekeeping, pollPrs } = await import("../src/housekeeping.js");
  const bare = path.join(w.base, "origin.git");
  try {
    w.script({ worker: [{ files: { "a.txt": "from the agent\n" }, commit: "agent", note: "Changed a.txt." }, { note: null, status: "working" }] });
    const id = A.add(w.root, "Unknown").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval");
    // main moves at the remote with a conflict, and the remote cannot be reached: the local ref still says "nothing new"
    const other = path.join(w.base, "other");
    git(w.base, "clone", "-q", bare, other);
    fs.writeFileSync(path.join(other, "a.txt"), "theirs\n"); git(other, "commit", "-qam", "theirs"); git(other, "push", "-q", "origin", "main");
    const target = git(other, "rev-parse", "HEAD");
    git(w.root, "remote", "set-url", "origin", path.join(w.base, "gone.git"));
    globalThis.__swJobs = [];
    await pollPrs();
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.match(t.syncBlocked.why, /main could not be fetched/);
    assert.deepEqual([stateOf(id).asReview, F.labelOf(t)], [false, "needs you"]);
    assert.throws(() => A.approve(id), /behind main and cannot be approved yet/);
    // the remote is back: the retry finds the conflict
    git(w.root, "remote", "set-url", "origin", bare);
    S.update(id, { syncRetryAt: 0 });
    housekeeping(w.socket, { force: true });
    t = await settle(id);
    assert.equal(t.stage, "working"); assert.equal(t.failure.title, "Merge conflict with main");
    assert.ok(paneOf(w, t).agent.prompts.at(-1).includes(`Target commit: ${target}`));
  } finally { w.cleanup(); }
});
