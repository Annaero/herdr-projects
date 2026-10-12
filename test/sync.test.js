// Conflicts with main are caught before review, not after approval: the board brings every task's branch up to date
// by itself, and the agent hears about it only when there is a real conflict.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, git } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";

const stateOf = (id) => F.board({ includeArchived: true }).find((t) => t.id === id);
const paneOf = (w, t) => w.state().panes.find((p) => p.pane_id === t.link.pane);
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
    assert.equal(t.review.score, 5); assert.equal(t.reviewedHead, git(t.worktree, "rev-parse", "HEAD"));
    assert.match(t.stat, /^1 file changed/); // the change is what it adds to main: g.txt is not part of it
    assert.equal(paneOf(w, t).agent.prompts.length, 2); // its task and your answer: nothing about main
    assert.equal(git(w.root, "status", "--porcelain"), "");
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.equal(fs.readFileSync(path.join(w.root, "f.txt"), "utf8"), "v1\n");
  } finally { w.cleanup(); }
});

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
    assert.equal(t.failure, null); assert.equal(t.syncRepairs, 0); assert.equal(t.review.score, 5); assert.ok(holds(t.worktree, target));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.equal(fs.readFileSync(path.join(w.root, "a.txt"), "utf8"), "merged\n");
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
    A.seen(apart);
    const before = S.get(apart);
    w.script({ worker: [{ note: null, status: "working" }] }); // the agent of `clash`, told about its conflict
    A.approve(first);
    assert.equal((await settle(first)).stage, "done");
    const main = git(w.root, "rev-parse", "HEAD");
    // another task's files: updated and checked, the review stands, and it does not ask for your eyes again
    let t = await settle(apart);
    assert.equal(t.stage, "approval"); assert.ok(holds(t.worktree, main)); assert.notEqual(t.reviewedHead, before.reviewedHead);
    assert.equal(t.reviewedHead, git(t.worktree, "rev-parse", "HEAD")); assert.equal(t.syncedTo, main);
    assert.equal(t.reviewRound, 1); assert.ok(t.review.keptAt); assert.equal(t.seen, true); assert.match(t.msg, /^Approve to merge\?/);
    assert.equal(paneOf(w, t).agent.prompts.length, 1);
    // the same file, merged cleanly: reviewed again as it will land
    t = await settle(near);
    assert.equal(t.stage, "approval"); assert.ok(holds(t.worktree, main)); assert.equal(t.reviewRound, 2); assert.ok(!t.review.keptAt); assert.equal(t.seen, false);
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

test("with a remote: main moving there (not through the board) is noticed by the periodic fetch, and the updated branch is pushed", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off" } });
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
  const w = await world({ origin: true, settings: { reviewer: "off" } });
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
    assert.match(t.syncBlocked.why, /not on its own branch/); assert.match(t.msg, /^Behind main/); assert.equal(t.seen, false);
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
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.ok(holds(t.worktree, target)); assert.equal(t.review.score, 5);
  } finally { w.cleanup(); }
});

test("with a remote but pull requests off, tasks land in your local branch: that branch is the main they are kept up to date with", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off", pr: false } });
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
  const w = await world({ origin: true, settings: { reviewer: "off" } });
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
