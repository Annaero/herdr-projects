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
  const note = path.join(t.worktree, ".herdr-superwork", `closing-${t.n}.md`);
  fs.writeFileSync(note, text); const later = new Date(Date.now() + 2000); fs.utimesSync(note, later, later);
  w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
}

test("a conflict with main goes to the agent by itself, before any approval; the repair is checked and reviewed", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ note: "Which one?" }, { files: { "a.txt": "from the agent\n" }, commit: "agent", note: "Changed a.txt." }, { note: null, status: "working" }] });
    const id = await asking(w, "Conflict");
    const target = mainMoves(w, "a.txt", "from main\n");
    A.tell(id, "The first one.");
    let t = await settle(id);
    // rolled back, sent, and nothing to approve
    assert.equal(t.stage, "working"); assert.equal(t.expectedWake.reason, "conflict"); assert.equal(t.syncRepairs, 1);
    assert.equal(t.failure.title, "Merge conflict with main"); assert.equal(t.failure.phase, "sync"); assert.ok(t.failure.sentAt);
    assert.match(t.failure.detail, /Conflicting files:\na\.txt/);
    assert.equal(git(t.worktree, "status", "--porcelain"), ""); assert.equal(fs.readFileSync(path.join(t.worktree, "a.txt"), "utf8"), "from the agent\n");
    assert.ok(!holds(t.worktree, target)); assert.equal(git(w.root, "status", "--porcelain"), "");
    const said = paneOf(w, t).agent.prompts.at(-1);
    assert.match(said, /conflicts with main/); assert.match(said, /Conflicting files:\n- a\.txt/); assert.ok(said.includes(`Target commit: ${target}`));
    assert.match(said, /resolve the conflicts, commit, and finish again/); assert.doesNotMatch(said, /already approved/);
    assert.ok(!t.review && !t.mergeIntent);
    assert.deepEqual([stateOf(id).state, stateOf(id).note, F.labelOf(t)], ["working", "resolving a conflict with main", ""]); // what the board shows; herdr's sidebar keeps to its own "working"
    assert.throws(() => A.approve(id), /not waiting for an approval/);
    // the agent resolves it in its own worktree and finishes again
    try { git(t.worktree, "merge", "-q", target); } catch {}
    fs.writeFileSync(path.join(t.worktree, "a.txt"), "merged\n"); git(t.worktree, "add", "-A"); git(t.worktree, "commit", "-qm", "resolve");
    endTurn(w, t, "Resolved the conflict.");
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    assert.equal(t.failure, null); assert.equal(t.syncRepairs, 0); assert.equal(t.review.pass, true); assert.ok(holds(t.worktree, target));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.equal(fs.readFileSync(path.join(w.root, "a.txt"), "utf8"), "merged\n");
  } finally { w.cleanup(); }
});

test("conflict repairs are capped: after `rounds` tries in a row the human is asked, with the details kept", async () => {
  const w = await world({ settings: { rounds: 1 } });
  try {
    // the "repair" changes the file again without bringing main in
    w.script({ worker: [{ note: "Which one?" }, { files: { "a.txt": "from the agent\n" }, commit: "agent", note: "Changed a.txt." }, { files: { "a.txt": "still mine\n" }, commit: "again", note: "Resolved." }] });
    const id = await asking(w, "Capped");
    mainMoves(w, "a.txt", "from main\n");
    A.tell(id, "The first one.");
    const t = await settle(id, { max: 30 });
    assert.deepEqual([t.stage, t.kind], ["asks", "question"]);
    assert.match(t.msg, /could not resolve the conflict with main after 1 repairs/);
    assert.equal(t.failure.title, "Merge conflict with main"); assert.equal(t.failure.sentAt, null);
    assert.equal(paneOf(w, t).agent.prompts.length, 3); // its task, your answer, one repair: not a second one
    assert.equal(git(t.worktree, "status", "--porcelain"), ""); assert.equal(fs.readFileSync(path.join(t.worktree, "a.txt"), "utf8"), "still mine\n");
    assert.deepEqual([stateOf(id).state, stateOf(id).kind], ["blocked", "question"]);
    assert.throws(() => A.approve(id), /not waiting for an approval/);
  } finally { w.cleanup(); }
});

test("after an approval the sync is the last safety net: a conflict found there also goes to the agent, and the approved merge is retried", async () => {
  const w = await world({ settings: { reviewer: "off", cleanup: false } });
  try {
    w.script({ worker: [{ files: { "a.txt": "from the agent\n" }, commit: "agent", note: "Changed a.txt." }] });
    const id = A.add(w.root, "Late").id;
    A.delegate(id);
    assert.equal((await settle(id)).stage, "approval");
    const target = mainMoves(w, "a.txt", "from main\n"); // main moves and you approve before the board has looked
    w.script({ worker: [{ merge: target, files: { "a.txt": "merged\n" }, commit: "resolve", note: "Resolved." }] });
    A.approve(id);
    const t = await settle(id, { max: 30 });
    assert.equal(t.stage, "done", JSON.stringify([t.stage, t.msg, t.failure?.title]));
    assert.match(paneOf(w, t).agent.prompts.at(-1), /Conflicting files:\n- a\.txt[\s\S]*already approved this merge/);
    assert.equal(paneOf(w, t).agent.prompts.length, 2);
    assert.equal(fs.readFileSync(path.join(w.root, "a.txt"), "utf8"), "merged\n");
  } finally { w.cleanup(); }
});

test("a task that could not be brought up to date is held as behind main: no approval until the sync really happened", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  const { housekeeping } = await import("../src/housekeeping.js");
  const { drainJobs } = await import("../src/runner.js");
  const { runJob } = await import("../src/jobs.js");
  const syncJobs = () => globalThis.__swJobs.filter(([job]) => job === "sync").length;
  try {
    w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }] });
    const id = A.add(w.root, "Behind").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(stateOf(id).asReview, true);
    const seen = t.syncSeen, head = git(t.worktree, "rev-parse", "HEAD");
    const target = mainMoves(w, "g.txt", "from main\n");
    git(t.worktree, "checkout", "-q", "-b", "elsewhere"); // not at rest on its own branch: nothing is merged here
    globalThis.__swJobs = [];
    housekeeping(w.socket, { force: true });
    assert.equal(syncJobs(), 1);
    await drainJobs(runJob);
    t = S.get(id);
    assert.equal(t.stage, "approval"); assert.equal(t.syncSeen, seen, "the skipped attempt is not marked as seen"); assert.ok(t.syncRetryAt > Date.now());
    assert.equal(git(t.worktree, "rev-parse", "HEAD"), head);
    assert.match(t.syncBlocked.why, /not on its own branch/); assert.match(t.msg, /^Behind main/);
    assert.deepEqual([stateOf(id).asReview, F.labelOf(t)], [false, "needs you"]);
    assert.throws(() => A.approve(id), /behind main and cannot be approved yet/);
    assert.equal(S.get(id).stage, "approval");
    // back on its branch, and main has not moved since: the retry comes, and only then can it be approved
    git(t.worktree, "checkout", "-q", t.branch);
    S.update(id, { syncRetryAt: Date.now() - 1 });
    globalThis.__swJobs = [];
    housekeeping(w.socket, { force: true });
    assert.equal(syncJobs(), 1);
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(t.syncBlocked, null); assert.match(t.msg, /^Approve to merge\?/);
    assert.ok(holds(t.worktree, target)); assert.equal(stateOf(id).asReview, true);
    A.approve(id);
    assert.equal((await settle(id)).stage, "done");
  } finally { w.cleanup(); }
});

test("your checkout on another branch: nothing is merged into a waiting task, and it cannot be approved until you are back", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  const { housekeeping } = await import("../src/housekeeping.js");
  const kick = async (id) => { S.update(id, { syncRetryAt: 0 }); globalThis.__swJobs = []; housekeeping(w.socket, { force: true }); return settle(id); };
  try {
    w.script({ worker: [{ files: { "a.txt": "from the agent\n" }, commit: "agent", note: "Changed a.txt." }, { files: { "f.txt": "more\n" }, commit: "more", note: "Added f.txt." }] });
    const id = A.add(w.root, "Elsewhere").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.syncBranch, "main");
    const head = git(t.worktree, "rev-parse", "HEAD");
    // you check out a side branch that conflicts with the task
    git(w.root, "checkout", "-q", "-b", "side");
    const side = mainMoves(w, "a.txt", "from the side branch\n");
    t = await kick(id);
    assert.equal(t.stage, "approval"); assert.equal(git(t.worktree, "rev-parse", "HEAD"), head); assert.ok(!holds(t.worktree, side));
    assert.match(t.syncBlocked.why, /your checkout is on side, not on main/); assert.match(t.msg, /^Behind main/);
    assert.deepEqual([stateOf(id).asReview, F.labelOf(t)], [false, "needs you"]);
    assert.throws(() => A.approve(id), /behind main and cannot be approved yet/);
    // a new turn of the agent does not make it approvable either: it was not checked against where it would land
    A.tell(id, "Add f.txt too.");
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.ok(t.syncBlocked); assert.ok(!holds(t.worktree, side));
    assert.throws(() => A.approve(id), /behind main and cannot be approved yet/);
    // back on main, which has not moved: the hold is lifted and it lands
    git(w.root, "checkout", "-q", "main");
    t = await kick(id);
    assert.equal(t.stage, "approval"); assert.equal(t.syncBlocked, null); assert.match(t.msg, /^Approve to merge\?/); assert.equal(stateOf(id).asReview, true);
    // another branch at the very same commit is still another place to land: held as soon as the board looks
    git(w.root, "checkout", "-q", "-b", "twin");
    t = await kick(id);
    assert.match(t.syncBlocked.why, /your checkout is on twin, not on main/);
    assert.throws(() => A.approve(id), /behind main and cannot be approved yet/);
    // and an approval given before the board has looked merges nothing there
    S.update(id, { syncBlocked: null });
    const twin = git(w.root, "rev-parse", "HEAD");
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.mergeFailed, true); assert.equal(t.failure.title, "Your checkout is on another branch"); assert.equal(t.mergeIntent, null);
    assert.equal(git(w.root, "rev-parse", "HEAD"), twin); assert.equal(git(w.root, "status", "--porcelain"), "");
    assert.throws(() => A.sendFailure(id), /Switch your checkout back to main/);
    // back on main: approve again, and it lands there
    git(w.root, "checkout", "-q", "main");
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.equal(git(w.root, "symbolic-ref", "--short", "HEAD"), "main");
    assert.equal(fs.readFileSync(path.join(w.root, "a.txt"), "utf8"), "from the agent\n");
  } finally { w.cleanup(); }
});
