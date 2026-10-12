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

test("approve refuses to merge work that changed after its review: the finish line runs first", async () => {
  const w = await world();
  try {
    const id = await toApproval(w);
    let t = S.get(id);
    fs.writeFileSync(path.join(t.worktree, "extra.txt"), "late\n"); // dirty tree behind the approval, no herdr event
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.equal(fs.readFileSync(path.join(w.root, "extra.txt"), "utf8"), "late\n"); // committed, re-reviewed, then merged
  } finally { w.cleanup(); }
});

test("stop: the stage is set before esc is sent, and a late working event cannot undo it", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Long work").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "working");
    A.stop(id);
    t = S.get(id);
    assert.equal(t.stage, "stopped"); assert.deepEqual(paneOf(w, t).agent.keys, ["esc"]);
    assert.deepEqual([stateOf(id).state, stateOf(id).note], ["idle", "stopped"]);
    await settle(id);
    assert.equal(S.get(id).stage, "stopped"); // the idle that follows esc starts nothing
    // replying re-arms it
    w.script({ worker: [{ note: "Resumed and done." }] });
    A.tell(id, "carry on");
    t = await settle(id);
    assert.notEqual(t.stage, "stopped");
  } finally { w.cleanup(); }
});

test("an agent herdr cannot classify (unknown) finishes when its closing note appears", async () => {
  const w = await world({ settings: { agent: "codex", reviewer: "off" } });
  try {
    w.script({ worker: [{ files: { "u.txt": "u\n" }, commit: "u", note: "Codex is done.", status: "unknown" }] });
    const id = A.add(w.root, "Unknown status").id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "approval");
    assert.deepEqual(paneOf(w, t).agent.args.slice(0, 2), ["--dangerously-bypass-approvals-and-sandbox", "--no-daemon"]);
    assert.match(fs.readFileSync(process.env.HERDR_SUPERWORK_CODEX_TOML, "utf8"), /trust_level = "trusted"/);
  } finally { w.cleanup(); }
});

test("an agent that reports itself blocked gets the right kind, and stopping after that is not a finish", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Needs a token").id;
    A.delegate(id);
    let t = await settle(id);
    assert.throws(() => A.report(id, { state: "done", asAgent: true }), /Do not report done yourself/);
    A.report(id, { state: "blocked", kind: "auth", msg: "NPM_TOKEN is missing", asAgent: true });
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
    t = await settle(id);
    assert.deepEqual([t.stage, t.kind, t.msg], ["asks", "auth", "NPM_TOKEN is missing"]);
    assert.deepEqual([stateOf(id).state, stateOf(id).kind], ["blocked", "auth"]);
  } finally { w.cleanup(); }
});

test("review: a verdict for another commit is ignored, a missing verdict is a saved failure, reviewer edits are put back", async () => {
  const w = await world({ settings: { gate: "off" } });
  try {
    process.env.HERDR_SUPERWORK_REVIEW_MS = "600";
    w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }], reviewer: [{ verdict: { meets: true, findings: [], text: "Fine.", commit: "deadbeefdeadbeef" } }] });
    const id = A.add(w.root, "Wrong commit").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "failed"); assert.match(t.failure.detail, /review timed out/); assert.equal(t.review, null);
    assert.equal(stateOf(id).state, "error");
    process.env.HERDR_SUPERWORK_REVIEW_MS = "4000";
    // ctrl+r sends the error back; this time the reviewer answers properly but also touches the tree
    w.script({ worker: [{ note: "Nothing to change." }], reviewer: [{ dirtyTree: true, verdict: { meets: true, text: "Has a real problem.", findings: [{ severity: "major", subject: "f.txt is wrong", where: "f.txt", proof: "cat f.txt" }] }, evidence: { "out.txt": "test output\n" } }] });
    A.sendError(id);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.review.pass, false); assert.match(t.msg, /^Approve to merge\? Review: Fail · 1 major\./); // gate "off": a failed review waits for you
    assert.equal(git(t.worktree, "status", "--porcelain"), ""); // what you approve is exactly what the agent committed
    assert.ok(!fs.existsSync(path.join(t.worktree, ".herdr-superwork", "review-1", "verdict.json")));
    assert.ok(fs.existsSync(path.join(S.artifactsDir(id), "verdict.json")));
    // ctrl+r now hands the findings to the agent
    w.script({ worker: [{ files: { "f.txt": "v2\n" }, commit: "v2", note: "Fixed it." }] });
    assert.match(A.sendReview(id).msg, /review sent/);
    assert.match(paneOf(w, S.get(id)).agent.prompts.at(-1), /Result: Fail · 1 major\.[\s\S]*Required: fix each of these\.\n- \[major\] f\.txt is wrong \(f\.txt\)\n  Proof: cat f\.txt/);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.review.pass, true);
  } finally { process.env.HERDR_SUPERWORK_REVIEW_MS = "4000"; w.cleanup(); }
});

test("a review that fails the gate goes straight back, as the plugin's own turn, up to `rounds` times; an old reviewAuto: true is gate major", async () => {
  const w = await world({ settings: { reviewAuto: true, rounds: 2 } });
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "v1" }, { files: { "f.txt": "2\n" }, commit: "2", note: "v2" }, { files: { "f.txt": "3\n" }, commit: "3", note: "v3" }],
      reviewer: [{ verdict: { meets: true, text: "Bad.", findings: [{ severity: "major", subject: "f.txt holds the wrong number", where: "f.txt", proof: "cat f.txt" }] } }, { verdict: { meets: true, text: "Better.", findings: [{ id: "F1", severity: "major", subject: "f.txt still holds the wrong number", where: "f.txt", proof: "cat f.txt" }] } }, { verdict: { meets: true, text: "Still not it.", findings: [{ id: "F1", severity: "major", subject: "f.txt still holds the wrong number", where: "f.txt", proof: "cat f.txt" }] } }] });
    assert.equal(S.config().gate, "major"); assert.equal(S.config().reviewAuto, undefined);
    const id = A.add(w.root, "Loop").id;
    A.delegate(id);
    const t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval"); assert.equal(t.reviewRounds, 2); assert.equal(t.review.pass, false); // the cap is reached with the gate still failing: it waits for you
    assert.match(t.msg, /^Approve to merge\? Review: Fail · 1 major\./);
    assert.equal(paneOf(w, t).agent.prompts.length, 3);
    // three reviews ran: the task says which one it is on, to herdr's sidebar too
    assert.equal(S.reviewRound(t), 3); assert.equal(F.labelOf(t), "approve? fail"); assert.equal(F.labelOf({ ...t, review: { score: 4, recommend: true, text: "Old." } }), "approve? 4/5"); // herdr's sidebar says what to do
    assert.equal(F.labelOf({ ...t, stage: "reviewing" }), "reviewing"); assert.equal(F.labelOf({ ...t, stage: "reviewing", reviewRound: 0 }), "reviewing");
    assert.equal(F.labelOf({ ...t, stage: "reviewneeds" }), "needs you"); assert.equal(F.labelOf({ ...t, stage: "reviewneeds", reviewRound: 0 }), "needs you");
    // Four labels in all: needs you, approve? pass or fail, reviewing, failed. The exact reason is on the board.
    const labels = new Set([{ stage: "approval" }, { stage: "approval", mergeFailed: true }, { stage: "approval", prFailure: {} }, { stage: "approval", syncBlocked: {} }, { stage: "asks" }, { stage: "asks", kind: "auth" }, { stage: "nosummary" }, { stage: "failed" }, { stage: "failed", failure: { auth: true } }, { stage: "failed", failure: { phase: "sync" } }, { stage: "merging" }, { stage: "merging", autoMerge: true }, { stage: "checking" }, { stage: "pushing" }, { stage: "working", expectedWake: { reason: "conflict" } }, { stage: "reviewing" }, { stage: "reviewneeds" }].map((x) => F.labelOf({ ...t, ...x }).replace(/ (?:pass|fail)$/, "")));
    assert.deepEqual([...labels].sort(), ["", "approve?", "failed", "needs you", "reviewing"]);
  } finally { w.cleanup(); }
});
