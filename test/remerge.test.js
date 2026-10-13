// Work that passed its review and then only took main in is not reviewed again: the tests run on the merged result
// and the review stands. Anything beyond the merge is reviewed as ever.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { world, settle, git, paneOf } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as Y from "../src/sync.js";
import * as F from "../src/flow.js";

const holds = (dir, sha) => { try { git(dir, "merge-base", "--is-ancestor", sha, "HEAD"); return true; } catch { return false; } };
const big = (first, last) => [first, ...Array.from({ length: 18 }, (_, i) => `line ${i + 2}`), last].join("\n") + "\n";
const mainMoves = (w, files) => { for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(w.root, f), text); git(w.root, "add", "-A"); git(w.root, "commit", "-qm", "main moves"); return git(w.root, "rev-parse", "HEAD"); };
const resync = async (w, id, opts) => { const { housekeeping } = await import("../src/housekeeping.js"); housekeeping(w.socket, { force: true }); return settle(id, opts); };
// A world whose main has big.txt and a check, and one task that edited big.txt's first line and passed review 1.
async function passed(extra = {}) {
  const w = await world({ repoSettings: { "check.command": "! test -f broken.txt" }, ...extra });
  fs.writeFileSync(path.join(w.root, "big.txt"), big("line 1", "line 20")); git(w.root, "add", "-A"); git(w.root, "commit", "-qm", "big");
  w.script({ worker: [{ files: { "big.txt": big("TASK", "line 20") }, commit: "task", note: "Changed the first line." }] });
  const id = A.add(w.root, "Edit big").id;
  A.delegate(id);
  const t = await settle(id);
  assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(t.reviewRound, 1); assert.equal(t.review.pass, true);
  assert.equal(S.reviewHistory(t)[0].head, t.reviewedHead); // the commit the passing review looked at is on record
  return { w, id, reviewed: t.reviewedHead };
}

test("main merged cleanly into the task's own file after a passing review: the tests run, no new review", async () => {
  const { w, id, reviewed } = await passed();
  try {
    const main = mainMoves(w, { "big.txt": big("line 1", "MAIN") });
    const t = await resync(w, id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.ok(holds(t.worktree, main));
    assert.equal(t.reviewRound, 1); assert.equal(S.reviewHistory(t).length, 1); // the tag keeps showing the review that passed
    assert.ok(t.review.keptAt); assert.equal(t.review.pass, true); assert.equal(t.reviewedHead, git(t.worktree, "rev-parse", "HEAD"));
    assert.deepEqual([t.review.kept.from, t.review.kept.head, t.review.kept.merges, t.review.kept.resolved, t.review.kept.check], [reviewed, t.reviewedHead, 1, [], "! test -f broken.txt"]);
    assert.match(t.msg, /^Approve to merge\? Review: Pass\. Re-merged with main, tests pass, review 1 still stands\. /);
    const e = S.reviewHistory(t)[0];
    assert.equal(e.head, reviewed); assert.equal(e.kept.length, 1); assert.equal(e.kept[0].head, t.reviewedHead); assert.ok(e.kept[0].at > 0);
    assert.equal(A.details(id).reviews[0].kept.length, 1);
    assert.equal(paneOf(w, t).agent.prompts.length, 1); // the agent heard nothing
    // main moves again: still measured from the commit the reviewer really saw, and written down again
    mainMoves(w, { "big.txt": big("line 1", "MAIN AGAIN") });
    const u = await resync(w, id);
    assert.equal(u.stage, "approval"); assert.equal(u.reviewRound, 1); assert.equal(u.review.kept.merges, 2); assert.equal(u.review.kept.from, reviewed);
    assert.equal(S.reviewHistory(u)[0].kept.length, 2);
    A.approve(id);
    assert.equal((await settle(id)).stage, "done");
    assert.equal(fs.readFileSync(path.join(w.root, "big.txt"), "utf8"), big("TASK", "MAIN AGAIN"));
  } finally { w.cleanup(); }
});

test("a conflict the agent resolved in the merge, and nothing more: the tests run, the review stands", async () => {
  const { w, id, reviewed } = await passed();
  try {
    const main = mainMoves(w, { "big.txt": big("MAIN", "line 20") });
    w.script({ worker: [{ merge: main, files: { "big.txt": big("TASK and MAIN", "line 20") }, commit: "resolve", note: "Resolved." }] });
    const t = await resync(w, id, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.ok(holds(t.worktree, main));
    assert.match(paneOf(w, t).agent.prompts.at(-1), /already passed its review: change only the conflicting files/);
    assert.equal(t.reviewRound, 1); assert.equal(S.reviewHistory(t).length, 1); assert.ok(t.review.keptAt); assert.ok(!t.review.stale);
    assert.deepEqual([t.review.kept.from, t.review.kept.resolved], [reviewed, ["big.txt"]]);
    assert.match(t.msg, /Re-merged with main \(conflicts resolved in 1 file\), tests pass, review 1 still stands\./);
  } finally { w.cleanup(); }
});

test("more than the merge needed is reviewed again: a file that did not conflict, or a commit on top", async () => {
  for (const repair of [
    (main) => [{ merge: main, files: { "big.txt": big("TASK and MAIN", "line 20"), "extra.txt": "new work\n" }, commit: "resolve", note: "Resolved." }],
    (main) => [{ merge: main, files: { "big.txt": big("TASK and MAIN", "line 20") }, commit: "resolve" , note: null, status: "working" }],
  ]) {
    const { w, id } = await passed();
    try {
      const main = mainMoves(w, { "big.txt": big("MAIN", "line 20") });
      w.script({ worker: repair(main) });
      let t = await resync(w, id, { max: 30 });
      if (t.stage === "working") { // the second case: the merge, then new work in a commit of its own
        fs.writeFileSync(path.join(t.worktree, "extra.txt"), "new work\n"); git(t.worktree, "add", "-A"); git(t.worktree, "commit", "-qm", "more");
        const note = F.noteFile(t);
        fs.writeFileSync(note, "Resolved, and more."); const later = new Date(Date.now() + 2000); fs.utimesSync(note, later, later);
        w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
        t = await settle(id, { max: 30 });
      }
      assert.equal(t.stage, "approval", JSON.stringify(t.failure));
      assert.equal(t.reviewRound, 2); assert.ok(!t.review.keptAt); assert.equal(S.reviewHistory(t).length, 2); assert.ok(!S.reviewHistory(t)[0].kept);
    } finally { w.cleanup(); }
  }
});

test("tests that fail on the re-merged branch go back to the agent, as a failed check does; its fix is reviewed", async () => {
  const { w, id } = await passed();
  try {
    mainMoves(w, { "big.txt": big("line 1", "MAIN"), "broken.txt": "breaks the check\n" });
    w.script({ worker: [{ note: null, status: "working" }] });
    let t = await resync(w, id);
    assert.equal(t.stage, "working"); assert.equal(t.failure.title, "Check failed"); assert.equal(t.reviewRound, 1);
    assert.match(paneOf(w, t).agent.prompts.at(-1), /^The check failed, so this is not done yet\. The branch was only re-merged with main since its review passed/);
    assert.ok(!S.reviewHistory(t)[0].kept); // nothing stood: the tests did not pass
  } finally { w.cleanup(); }
});

test("a review that did not pass is never the one that stands", async () => {
  const w = await world({ repoSettings: { "check.command": "true" }, settings: { "review.rounds": 0 } });
  try {
    fs.writeFileSync(path.join(w.root, "big.txt"), big("line 1", "line 20")); git(w.root, "add", "-A"); git(w.root, "commit", "-qm", "big");
    w.script({ worker: [{ files: { "big.txt": big("TASK", "line 20") }, commit: "task", note: "Done." }], reviewer: [{ verdict: { meets: false, findings: [], text: "Not what was asked." } }] });
    const id = A.add(w.root, "Failing").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.review.pass, false); assert.equal(S.passedReview(t), null);
    mainMoves(w, { "big.txt": big("line 1", "MAIN") });
    t = await resync(w, id);
    assert.equal(t.stage, "approval"); assert.equal(t.reviewRound, 2); assert.ok(!t.review.keptAt);
  } finally { w.cleanup(); }
});

test("with no check there are no tests to prove a merge into the task's own files: reviewed again; other files only, the review stands and says so", async () => {
  const w = await world();
  try {
    fs.writeFileSync(path.join(w.root, "big.txt"), big("line 1", "line 20")); git(w.root, "add", "-A"); git(w.root, "commit", "-qm", "big");
    w.script({ worker: [{ files: { "big.txt": big("TASK", "line 20") }, commit: "task", note: "Done." }] });
    const id = A.add(w.root, "No check").id;
    A.delegate(id);
    assert.equal((await settle(id)).stage, "approval");
    mainMoves(w, { "other.txt": "x\n" });
    let t = await resync(w, id);
    assert.equal(t.reviewRound, 1); assert.equal(t.review.kept.check, ""); assert.match(t.msg, /Re-merged with main, no check is set, review 1 still stands\./);
    mainMoves(w, { "big.txt": big("line 1", "MAIN") });
    t = await resync(w, id);
    assert.equal(t.stage, "approval"); assert.equal(t.reviewRound, 2); assert.ok(!t.review.keptAt);
  } finally { w.cleanup(); }
});

test("what the task says when its review stood", async () => {
  const w = await world({ repo: false });
  try {
    assert.equal(S.keptWords({ check: "npm test", resolved: [] }, 2), "re-merged with main, tests pass, review 2 still stands");
  } finally { w.cleanup(); }
});

// The rule itself, on plain git: what counts as "only the merge of main".
test("mergeOnly: merges of main and their conflict resolutions pass; anything else does not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-merge-"));
  Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@test" });
  const write = (f, text) => fs.writeFileSync(path.join(dir, f), text);
  const commit = (msg) => { git(dir, "add", "-A"); git(dir, "commit", "-qm", msg); return git(dir, "rev-parse", "HEAD"); };
  try {
    git(dir, "init", "-q", "-b", "main");
    write("a.txt", "one\n"); write("b.txt", "one\n"); write("c.txt", "one\n"); commit("init");
    git(dir, "checkout", "-q", "-b", "task"); write("a.txt", "task\n");
    const reviewed = commit("task");
    git(dir, "checkout", "-q", "main"); write("a.txt", "main\n"); write("b.txt", "main\n");
    const main = commit("main");
    const fresh = (name) => { git(dir, "checkout", "-q", "-B", name, reviewed); };
    const merge = (resolve) => { try { git(dir, "merge", "-q", "--no-edit", main); } catch {} resolve?.(); return commit("merge"); };

    assert.equal(Y.mergeOnly(dir, reviewed, main).ok, false); // nothing merged yet
    assert.match(Y.mergeOnly(dir, "", main).why, /not known/);

    fresh("resolved"); merge(() => write("a.txt", "both\n"));
    let m = Y.mergeOnly(dir, reviewed, main);
    assert.deepEqual([m.ok, m.merges, m.resolved], [true, 1, ["a.txt"]]);

    fresh("evil"); merge(() => { write("a.txt", "both\n"); write("c.txt", "sneaked in\n"); });
    m = Y.mergeOnly(dir, reviewed, main);
    assert.equal(m.ok, false); assert.match(m.why, /changes more than its conflicts needed \(c\.txt\)/);

    fresh("ontop"); merge(() => write("a.txt", "both\n")); write("c.txt", "more\n"); commit("more");
    assert.match(Y.mergeOnly(dir, reviewed, main).why, /is new work, not a merge of main/);

    // another branch merged in is not main
    git(dir, "checkout", "-q", "-B", "side", reviewed); write("c.txt", "side\n"); const side = commit("side");
    fresh("other"); git(dir, "merge", "-q", "--no-ff", "--no-edit", side);
    assert.match(Y.mergeOnly(dir, reviewed, main).why, /merges something that is not main/);

    // rebuilt on main: the reviewed commit is gone from the branch
    fresh("rebased"); try { git(dir, "rebase", "-q", main); } catch { write("a.txt", "both\n"); git(dir, "add", "-A"); git(dir, "-c", "core.editor=true", "rebase", "--continue"); }
    assert.match(Y.mergeOnly(dir, reviewed, main).why, /no longer holds the reviewed commit/);

    // merged the other way round (main first): not the branch's own line
    git(dir, "checkout", "-q", "-B", "backwards", main); try { git(dir, "merge", "-q", "--no-edit", reviewed); } catch {} write("a.txt", "both\n"); commit("merge");
    assert.equal(Y.mergeOnly(dir, reviewed, main).ok, false);

    // a clean merge with nothing to resolve
    git(dir, "checkout", "-q", "-B", "task2", `${main}~1`); write("c.txt", "task2\n"); const r2 = commit("task2");
    git(dir, "merge", "-q", "--no-edit", main);
    m = Y.mergeOnly(dir, r2, main);
    assert.deepEqual([m.ok, m.merges, m.resolved], [true, 1, []]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
