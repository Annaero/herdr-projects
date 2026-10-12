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

test("typing in the agent's own terminal re-arms the pipeline: approval revoked, review stale, then checked again", async () => {
  const w = await world();
  try {
    const id = await toApproval(w);
    let t = S.get(id);
    // the human types in the agent's terminal: herdr reports working, then done with a new closing note
    w.script({ worker: [{ files: { "f.txt": "v2\n" }, commit: "v2", note: null, status: "working" }] });
    herdr().agentPrompt(t.link.pane, "make it v2");
    onPane(w.socket, t.link.pane);
    t = S.get(id);
    assert.equal(t.stage, "working"); assert.equal(t.review.stale, true); assert.equal(t.requireApproval, true); assert.equal(t.turnOpen, true);
    assert.equal(stateOf(id).state, "working");
    const note = path.join(t.worktree, ".herdr-superwork", "closing-1.md");
    fs.writeFileSync(note, "Did v2."); const later = new Date(Date.now() + 50); fs.utimesSync(note, later, later);
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.summary, "Did v2."); assert.ok(!t.review.stale);
    assert.equal(t.reviewedHead, git(t.worktree, "rev-parse", "HEAD"));
  } finally { w.cleanup(); }
});

test("a `working` reading from the turn the finish line already handled does not re-arm it", async () => {
  const w = await world();
  try {
    // the agent is still in its turn: a status hook takes this reading, then waits its turn
    w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: null, status: "working" }] });
    const id = A.add(w.root, "Work").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "working");
    const api = herdr(), late = api.agentGet(t.link.pane);
    assert.equal(late.agent_status, "working");
    // meanwhile the turn ends and the finish line handles it
    const note = path.join(t.worktree, ".herdr-superwork", "closing-1.md");
    fs.mkdirSync(path.dirname(note), { recursive: true }); fs.writeFileSync(note, "Did v1."); const later = new Date(Date.now() + 50); fs.utimesSync(note, later, later);
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    const armedAt = t.armedAt;
    // the late reading is applied now, and so is one of the very state the turn was handled in (herdr still says
    // "working" while the agent's own turn-end hook runs)
    const same = () => { const t = S.get(id); assert.equal(t.stage, "approval"); assert.equal(t.turnOpen, false); assert.equal(t.armedAt, armedAt); assert.equal(t.requireApproval, false); };
    apply(id, late, api); same();
    apply(id, { ...late, state_change_seq: t.handled.seq }, api); same();
    // however late it arrives
    S.update(id, (t) => { t.handled = { ...t.handled, at: t.handled.at - 3600000 }; });
    apply(id, late, api); same();
    onPane(w.socket, t.link.pane); same();
    // herdr restarted: its counter started over and the pane has a new terminal. The same or a lower number is then
    // a new turn, the human typing: the approval is revoked and the review is stale
    t = S.get(id);
    w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).terminal_id = "term_after_restart"; });
    apply(id, { ...late, terminal_id: "term_after_restart", state_change_seq: t.handled.seq }, api);
    t = S.get(id);
    assert.equal(t.stage, "working"); assert.equal(t.turnOpen, true); assert.equal(t.requireApproval, true);
    if (t.review) assert.equal(t.review.stale, true);
  } finally { w.cleanup(); }
});

test("a `working` newer than the handled turn, or a lower one right after herdr restarted, is the human typing", async () => {
  const w = await world();
  try {
    const id = await toApproval(w);
    let t = S.get(id);
    const api = herdr(), now = api.agentGet(t.link.pane);
    assert.equal(t.handled.seq, now.state_change_seq); assert.equal(t.handled.term, now.terminal_id);
    // a terminal herdr does not have in that pane is no restart: the reading is dropped
    apply(id, { ...now, agent_status: "working", terminal_id: "term_nowhere", state_change_seq: 1 }, api);
    assert.equal(S.get(id).stage, "approval");
    w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).terminal_id = "term_after_restart"; });
    apply(id, { ...now, agent_status: "working", terminal_id: "term_after_restart", state_change_seq: 1 }, api);
    t = S.get(id);
    assert.equal(t.stage, "working"); assert.equal(t.turnOpen, true); assert.equal(t.requireApproval, true);
    // and in the same herdr run a higher number re-arms as before
    const id2 = await toApproval(w, "More");
    t = S.get(id2);
    const b = api.agentGet(t.link.pane);
    apply(id2, { ...b, agent_status: "working", state_change_seq: t.handled.seq + 1 }, api);
    t = S.get(id2);
    assert.equal(t.stage, "working"); assert.equal(t.turnOpen, true); assert.equal(t.requireApproval, true);
  } finally { w.cleanup(); }
});

test("a late `working` from the terminal herdr had before it restarted does not re-open work finished in the new one", async () => {
  const w = await world();
  try {
    const id = await toApproval(w);
    let t = S.get(id);
    const api = herdr(), old = { ...api.agentGet(t.link.pane), agent_status: "working" };
    // herdr restarts: the pane has a new terminal and the counter starts over. The human types there, and it finishes
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); p.terminal_id = "term_after_restart"; s.seq = 0; p.agent.seq = 0; delete p.agent.completion; });
    w.script({ worker: [{ files: { "f.txt": "v2\n" }, commit: "v2", note: null, status: "working" }] });
    api.agentPrompt(t.link.pane, "make it v2");
    onPane(w.socket, t.link.pane);
    assert.equal(S.get(id).stage, "working");
    // while it works there, a late "done" from the old terminal (the completion already handled) finishes nothing,
    // however long ago the task was armed
    process.env.HERDR_SUPERWORK_REOPEN_MS = "0";
    apply(id, { ...old, agent_status: "done" }, api);
    assert.equal(S.get(id).stage, "working"); assert.equal(S.get(id).last.term, "term_after_restart"); assert.equal(globalThis.__swJobs.length, 0);
    delete process.env.HERDR_SUPERWORK_REOPEN_MS;
    const note = path.join(t.worktree, ".herdr-superwork", "closing-1.md");
    fs.writeFileSync(note, "Did v2."); const later = new Date(Date.now() + 50); fs.utimesSync(note, later, later);
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(t.handled.term, "term_after_restart");
    assert.ok(old.state_change_seq > t.handled.seq);
    const fresh = S.currentReview(t);
    // the reading taken before the restart arrives now
    apply(id, old, api);
    t = S.get(id);
    assert.equal(t.stage, "approval"); assert.equal(t.turnOpen, false); assert.deepEqual(S.currentReview(t), fresh);
    // typing in the new terminal still re-arms
    apply(id, { ...api.agentGet(t.link.pane), agent_status: "working", state_change_seq: t.handled.seq + 1 }, api);
    assert.equal(S.get(id).stage, "working");
  } finally { delete process.env.HERDR_SUPERWORK_REOPEN_MS; w.cleanup(); }
});

test("an approval saved by an older version is not re-opened by a late `working` either", async () => {
  const w = await world();
  try {
    const id = await toApproval(w);
    // as the older version saved it: no reading kept with the handled turn, no terminals, no mark on the turn
    const legacy = (t) => { const { seq, term, ...handled } = t.handled; t.handled = handled; const { term: _, ...last } = t.last; t.last = last; delete t.terms; delete t.turnBy; };
    S.update(id, legacy);
    let t = S.get(id);
    const api = herdr(), now = api.agentGet(t.link.pane), review = S.currentReview(t);
    assert.ok(review);
    // its turn was handled through the agent's own hook while herdr still said "working": the completion kept with
    // it is the turn before, and that very `working` (number S, above that completion) arrives again. First with
    // nothing applied since, then after herdr's "done" for the turn was applied
    const S0 = now.state_change_seq - 1, before = t.handled.comp - 5;
    for (const last of [{ status: "working", seq: S0, comp: before, at: t.handled.at - 50 }, { status: "done", seq: S0 + 1, comp: S0 + 1, at: t.handled.at + 50 }]) {
      S.update(id, (t) => { t.handled = { ...t.handled, comp: before }; t.last = last; });
      apply(id, { ...now, agent_status: "working", state_change_seq: S0, completion_seq: before }, api);
      t = S.get(id);
      assert.equal(t.stage, "approval", JSON.stringify(last)); assert.ok(!t.turnOpen); assert.deepEqual(S.currentReview(t), review);
    }
    S.update(id, (t) => { t.handled = { ...t.handled, comp: now.completion_seq }; t.last = { status: "done", seq: now.state_change_seq, comp: now.completion_seq, at: Date.now() }; });
    t = S.get(id);
    for (const seq of [t.handled.comp - 1, t.handled.comp]) apply(id, { ...now, agent_status: "working", state_change_seq: seq }, api);
    for (let i = 0; i < 3; i++) reconcile(S.get(id), api);
    t = S.get(id);
    assert.equal(t.stage, "approval"); assert.ok(!t.turnOpen); assert.ok(!t.turnBy); assert.deepEqual(S.currentReview(t), review); assert.equal(globalThis.__swJobs.length, 0);
    // the human typing is a later reading: that re-arms
    apply(id, { ...now, agent_status: "working", state_change_seq: t.handled.comp + 1 }, api);
    t = S.get(id);
    assert.equal(t.stage, "working"); assert.equal(t.turnBy, "typed"); assert.equal(t.review.stale, true);
  } finally { w.cleanup(); }
});

test("a task already stuck re-armed (working, turn open, no runner, completion handled) is handed to the human, never finished by itself", async () => {
  const w = await world();
  try {
    const id = await toApproval(w);
    // the state an earlier version left behind, without the fields this one writes
    S.update(id, (t) => { const { seq, term, ...handled } = t.handled; t.handled = handled; delete t.terms; delete t.last; delete t.turnBy; t.stage = "working"; t.turnOpen = true; t.armedAt = t.since = handled.at + 11; t.msg = ""; t.review = { ...t.review, stale: true }; t.requireApproval = true; });
    let t = S.get(id);
    assert.equal(stateOf(id).state, "working");
    // a `working` taken before that turn completed arrives late, more than once: it says nothing about this turn
    const stale = { ...herdr().agentGet(t.link.pane), agent_status: "working", state_change_seq: t.handled.comp - 1 };
    apply(id, stale, herdr()); apply(id, stale, herdr());
    assert.ok(!S.get(id).turnBy); assert.equal(S.get(id).armedAt, t.armedAt); assert.equal(S.get(id).stage, "working");
    // a reply sent from the board looks like this for a moment: nothing happens at once
    onPane(w.socket, t.link.pane);
    assert.equal(S.get(id).stage, "working"); assert.equal(globalThis.__swJobs.length, 0);
    process.env.HERDR_SUPERWORK_REOPEN_MS = "0";
    // the hook only suspects it; the runner asks herdr itself. While herdr says the agent works, a "done" that
    // arrives late (here: from a terminal nothing was ever read in, replaced since) finishes nothing
    const api = herdr(), real = api.agentGet(t.link.pane);
    fs.writeFileSync(path.join(t.worktree, "half.txt"), "not finished\n");
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); p.terminal_id = "term_c"; s.seq += 1; p.agent.status = "working"; p.agent.seq = s.seq; });
    apply(id, { ...real, terminal_id: "term_b" }, api);
    assert.equal(globalThis.__swJobs.length, 0); assert.equal(S.get(id).stage, "working"); assert.notEqual(S.get(id).terms?.at(-1), "term_b");
    // nor does a late "done" of the pane's own terminal: the runner sees the agent working and leaves
    S.update(id, (t) => { delete t.terms; delete t.last; t.handled = { ...t.handled, term: "term_c" }; });
    apply(id, { ...real, terminal_id: "term_c" }, api);
    assert.deepEqual(globalThis.__swJobs.map((j) => j[0]), ["recover"]);
    await drainJobs(runJob);
    t = S.get(id);
    assert.equal(t.stage, "working"); assert.equal(t.runner, null); assert.match(git(t.worktree, "status", "--porcelain"), /half\.txt/);
    assert.equal(t.turnBy, "typed"); // and herdr has now seen it work: a real turn, not a candidate any more
    // the stuck task as it was, its agent really at rest: now the finish line runs again
    S.update(id, (t) => { t.turnBy = null; });
    fs.rmSync(path.join(t.worktree, "half.txt"));
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; });
    reconcile(S.get(id), api);
    assert.deepEqual(globalThis.__swJobs.map((j) => j[0]), ["recover"]);
    // it is handed to the human and nothing is decided for them: unsaved work stays unsaved, nothing is committed,
    // checked or put up for approval (a reply an older version saved looks exactly like this state)
    fs.writeFileSync(path.join(t.worktree, "half.txt"), "not finished\n");
    const head = git(t.worktree, "rev-parse", "HEAD");
    t = await settle(id);
    assert.equal(t.stage, "nosummary"); assert.equal(t.turnOpen, false); assert.equal(t.runner, null); assert.equal(stateOf(id).state, "error");
    assert.equal(git(t.worktree, "rev-parse", "HEAD"), head); assert.match(git(t.worktree, "status", "--porcelain"), /half\.txt/);
    assert.equal(S.currentReview(t), null);
    fs.rmSync(path.join(t.worktree, "half.txt"));
    // "finish anyway" is the human saying it is done
    A.finishAnyway(id);
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(t.runner, null); assert.equal(S.currentReview(t).stale, undefined);
    // a real new turn is never taken for that, though the note and herdr's completion count are unchanged and herdr
    // calls the agent idle for a while: herdr saw it work (the human typed), or a reply was sent from the board
    const quiet = () => { w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "idle"; p.agent.seq = s.seq; }); onPane(w.socket, t.link.pane); return [S.get(id).stage, globalThis.__swJobs.length]; };
    fs.writeFileSync(path.join(t.worktree, "half.txt"), "not finished\n");
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "working"; p.agent.seq = s.seq; });
    onPane(w.socket, t.link.pane);
    assert.equal(S.get(id).turnBy, "typed"); assert.equal(S.get(id).stage, "working");
    S.update(id, (t) => { t.armedAt = t.handled.at + 11; });
    assert.deepEqual(quiet(), ["working", 0]);
    S.update(id, (t) => { t.stage = "approval"; t.turnOpen = false; t.turnBy = null; });
    w.script({ worker: [{ note: null, status: "working" }] });
    A.tell(id, "one more thing");
    assert.equal(S.get(id).turnBy, "reply");
    S.update(id, (t) => { t.armedAt = t.handled.at + 11; });
    assert.deepEqual(quiet(), ["working", 0]);
    assert.match(git(t.worktree, "status", "--porcelain"), /half\.txt/);
    fs.rmSync(path.join(t.worktree, "half.txt"));
    S.update(id, (t) => { t.turnBy = null; });
    // nor one armed long after the handled turn
    S.update(id, (t) => { t.armedAt = t.handled.at + 60000; });
    assert.deepEqual(quiet(), ["working", 0]);
    // a turn really in progress is left alone: the agent has written a newer note than the handled one
    S.update(id, (t) => { t.stage = "working"; t.turnOpen = true; t.armedAt = t.handled.at + 11; });
    const note = path.join(t.worktree, ".herdr-superwork", "closing-1.md");
    const later = new Date(Date.now() + 50); fs.utimesSync(note, later, later);
    onPane(w.socket, t.link.pane);
    assert.equal(S.get(id).stage, "working"); assert.equal(globalThis.__swJobs.length, 0);
  } finally { delete process.env.HERDR_SUPERWORK_REOPEN_MS; w.cleanup(); }
});

test("a turn nobody saw start still counts: a new commit behind an approval is checked again before any merge", async () => {
  const w = await world();
  try {
    const id = await toApproval(w);
    let t = S.get(id);
    fs.writeFileSync(path.join(t.worktree, "f.txt"), "sneaky\n"); git(t.worktree, "commit", "-qam", "sneaky");
    const note = path.join(t.worktree, ".herdr-superwork", "closing-1.md");
    fs.writeFileSync(note, "Changed it again."); const later = new Date(Date.now() + 2000); fs.utimesSync(note, later, later);
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 2; p.agent.seq = s.seq; p.agent.completion = s.seq; p.agent.status = "done"; });
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.summary, "Changed it again.");
    assert.equal(t.reviewedHead, git(t.worktree, "rev-parse", "HEAD"));
  } finally { w.cleanup(); }
});

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
  const w = await world();
  try {
    process.env.HERDR_SUPERWORK_REVIEW_MS = "600";
    w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }], reviewer: [{ verdict: { score: 5, recommend: true, text: "Fine.", commit: "deadbeefdeadbeef" } }] });
    const id = A.add(w.root, "Wrong commit").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "failed"); assert.match(t.failure.detail, /review timed out/); assert.equal(t.review, null);
    assert.equal(stateOf(id).state, "error");
    process.env.HERDR_SUPERWORK_REVIEW_MS = "4000";
    // ctrl+r sends the error back; this time the reviewer answers properly but also touches the tree
    w.script({ worker: [{ note: "Nothing to change." }], reviewer: [{ dirtyTree: true, verdict: { score: 3, recommend: false, text: "Has a real problem.", problems: ["f.txt is wrong"] }, evidence: { "out.txt": "test output\n" } }] });
    A.sendError(id);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.review.score, 3); assert.equal(t.review.recommend, false);
    assert.equal(git(t.worktree, "status", "--porcelain"), ""); // what you approve is exactly what the agent committed
    assert.ok(!fs.existsSync(path.join(t.worktree, ".herdr-superwork", "review-1", "verdict.json")));
    assert.ok(fs.existsSync(path.join(S.artifactsDir(id), "verdict.json")));
    // ctrl+r now hands the findings to the agent
    w.script({ worker: [{ files: { "f.txt": "v2\n" }, commit: "v2", note: "Fixed it." }] });
    assert.match(A.sendReview(id).msg, /review sent/);
    assert.match(paneOf(w, S.get(id)).agent.prompts.at(-1), /rated it 3 out of 5[\s\S]*f\.txt is wrong/);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.review.score, 5);
  } finally { process.env.HERDR_SUPERWORK_REVIEW_MS = "4000"; w.cleanup(); }
});

test("reviewAuto sends anything below 5 straight back, as the plugin's own turn, up to `rounds` times", async () => {
  const w = await world({ settings: { reviewAuto: true, rounds: 2 } });
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "v1" }, { files: { "f.txt": "2\n" }, commit: "2", note: "v2" }, { files: { "f.txt": "3\n" }, commit: "3", note: "v3" }],
      reviewer: [{ verdict: { score: 2, recommend: false, text: "Bad." } }, { verdict: { score: 3, recommend: false, text: "Better." } }, { verdict: { score: 4, recommend: true, text: "Good enough." } }] });
    const id = A.add(w.root, "Loop").id;
    A.delegate(id);
    const t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval"); assert.equal(t.reviewRounds, 2); assert.equal(t.review.score, 4);
    assert.equal(paneOf(w, t).agent.prompts.length, 3);
    // three reviews ran: the task says which one it is on, to herdr's sidebar too
    assert.equal(S.reviewRound(t), 3); assert.equal(F.labelOf(t), "approve? 4/5"); // herdr's sidebar says what to do
    assert.equal(F.labelOf({ ...t, stage: "reviewing" }), "reviewing"); assert.equal(F.labelOf({ ...t, stage: "reviewing", reviewRound: 0 }), "reviewing");
    assert.equal(F.labelOf({ ...t, stage: "reviewneeds" }), "needs you"); assert.equal(F.labelOf({ ...t, stage: "reviewneeds", reviewRound: 0 }), "needs you");
    // Four labels in all: needs you, approve? n/5, reviewing, failed. The exact reason is on the board.
    const labels = new Set([{ stage: "approval" }, { stage: "approval", mergeFailed: true }, { stage: "approval", prFailure: {} }, { stage: "approval", syncBlocked: {} }, { stage: "asks" }, { stage: "asks", kind: "auth" }, { stage: "nosummary" }, { stage: "failed" }, { stage: "failed", failure: { auth: true } }, { stage: "failed", failure: { phase: "sync" } }, { stage: "merging" }, { stage: "merging", autoMerge: true }, { stage: "checking" }, { stage: "pushing" }, { stage: "working", expectedWake: { reason: "conflict" } }, { stage: "reviewing" }, { stage: "reviewneeds" }].map((x) => F.labelOf({ ...t, ...x }).replace(/ \d\/5$/, "")));
    assert.deepEqual([...labels].sort(), ["", "approve?", "failed", "needs you", "reviewing"]);
  } finally { w.cleanup(); }
});

test("a merge conflict with your checkout is rolled back and saved; ctrl+r sends it to the agent; it lands after repair", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    w.script({ worker: [{ files: { "a.txt": "from the agent\n" }, commit: "agent", note: "Changed a.txt." }] });
    const id = A.add(w.root, "Conflict").id;
    S.setTaskConfig(id, "conflictAuto", false); // by hand for this task; by itself is the default (sync.test.js)
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval");
    fs.writeFileSync(path.join(w.root, "a.txt"), "from the human\n"); git(w.root, "commit", "-qam", "human");
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.mergeFailed, true);
    assert.equal(t.failure.title, "Merge conflict with main"); assert.match(t.failure.detail, /Conflicting files:\na\.txt/); assert.equal(t.failure.phase, "sync");
    assert.equal(git(w.root, "status", "--porcelain"), ""); assert.equal(git(t.worktree, "status", "--porcelain"), ""); // both rolled back
    assert.deepEqual([stateOf(id).state, stateOf(id).kind, stateOf(id).asReview], ["blocked", "permission", false]);
    assert.ok(t.mergeIntent, "the approval is kept for the retry");
    // ctrl+g: the agent resolves it in its own worktree; the approved merge is retried without asking again
    const target = git(w.root, "rev-parse", "HEAD");
    w.script({ worker: [{ note: "Resolved the conflict." }] });
    fs.writeFileSync(path.join(w.fake, "resolve.sh"), `cd ${t.worktree} && git merge -q ${target} || { printf 'merged\\n' > a.txt; git add -A; git commit -qm resolve; }`);
    const { execFileSync } = await import("node:child_process");
    execFileSync("sh", [path.join(w.fake, "resolve.sh")], { stdio: "ignore" });
    assert.match(A.sendFailure(id).msg, /sent to the agent to fix/);
    assert.match(paneOf(w, S.get(id)).agent.prompts.at(-1), /already approved this merge/);
    t = await settle(id, { max: 30 });
    assert.equal(t.stage, "done", JSON.stringify([t.stage, t.msg, t.failure?.title]));
    assert.equal(fs.readFileSync(path.join(w.root, "a.txt"), "utf8"), "merged\n");
  } finally { w.cleanup(); }
});

test("unsaved files in your checkout stop the merge and nothing is forced", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w);
    fs.writeFileSync(path.join(w.root, "mine.txt"), "unsaved\n");
    A.approve(id);
    const t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.failure.title, "Merge needs a clean checkout"); assert.equal(t.failure.agentCanFix, false);
    assert.throws(() => A.sendFailure(id), /Commit, stash or move/);
    assert.ok(fs.existsSync(path.join(w.root, "mine.txt")));
  } finally { w.cleanup(); }
});

test("pull requests: pushed as a draft, merged through gh on approval, remembered when checks are pending, watched", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w, "With a PR");
    let t = S.get(id);
    assert.equal(t.pr, "https://github.com/o/r/pull/7");
    assert.match(ghLog(w), /pr create --draft --head work\/1-with-a-pr --title With a PR/);
    assert.equal(git(w.root, "ls-remote", "--heads", "origin", t.branch).split("\t")[0], git(t.worktree, "rev-parse", "HEAD"));
    assert.match(t.msg, /Pull request: https:\/\/github\.com\/o\/r\/pull\/7/);
    // checks still running: the approval is remembered
    const pending = { state: "OPEN", headRefOid: t.prHead, statusCheckRollup: [{ name: "build", state: "PENDING" }], comments: [], reviews: [], author: { login: "me" } };
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ mergeFail: "checks pending", view: pending }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "merging"); assert.equal(t.autoMerge, true); assert.match(t.msg, /merges when GitHub's checks pass/);
    assert.ok(!/--auto|--delete-branch/.test(ghLog(w))); // remembered here, not handed to GitHub; gh never deletes local work
    assert.throws(() => A.archive(id), /still active/);
    await pollPrs();
    assert.equal(S.get(id).autoMerge, true); // still running
    // a task of an older version has GitHub's own auto-merge on: replying switches that off first, or sends nothing
    S.update(id, (c) => { c.autoMergeLocal = false; });
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ disableFail: true }));
    assert.throws(() => A.tell(id, "wait"), /Could not cancel the pending auto-merge; nothing was sent/);
    assert.equal(paneOf(w, t).agent.prompts.length, 1);
    S.update(id, (c) => { c.autoMergeLocal = true; });
    // merged elsewhere: the poll marks it done and cleans up
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ view: { state: "MERGED" } }));
    await pollPrs();
    t = S.get(id);
    assert.equal(t.stage, "done"); assert.equal(t.prMerged, true); assert.equal(t.msg, "Merged: https://github.com/o/r/pull/7");
    assert.ok(!fs.existsSync(path.join(w.fake, "worktrees", "proj", "work-1-with-a-pr")));
  } finally { w.cleanup(); }
});

test("pull requests: failed checks wake the agent (capped), and the blocker survives a passing local check", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off", rounds: 1 } });
  try {
    const id = await toApproval(w, "CI fails");
    let t = S.get(id);
    w.script({ worker: [{ files: { "f.txt": "fixed\n" }, commit: "fix", note: "Fixed CI." }] });
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ view: { state: "OPEN", headRefOid: t.prHead, statusCheckRollup: [{ name: "build", conclusion: "FAILURE" }], comments: [], reviews: [], author: { login: "me" } } }));
    await pollPrs();
    assert.match(paneOf(w, S.get(id)).agent.prompts.at(-1), /Checks failed on the pull request[\s\S]*build/);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.prFailure.title, "Pull request checks failed");
    assert.match(t.msg, /pull request still blocked/); // local success cannot clear failed CI
    // CI on the new head passes: normal approval wording returns
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ view: { state: "OPEN", headRefOid: S.get(id).prHead, statusCheckRollup: [{ name: "build", conclusion: "SUCCESS" }], comments: [], reviews: [], author: { login: "me" } } }));
    await pollPrs();
    t = S.get(id);
    assert.equal(t.prFailure, null); assert.match(t.msg, /^Approve to merge\?/); assert.equal(t.prState, "passing");
  } finally { w.cleanup(); }
});

test("at most `max` agents work at once; tasks waiting for the human hold no slot; a freed slot is reused at once", async () => {
  const w = await world({ settings: { max: 1, reviewer: "off" } });
  try {
    w.script({ worker: [{ files: { "1.txt": "1\n" }, commit: "1", note: "One." }, { status: "working" }] });
    const a = A.add(w.root, "First").id, b = A.add(w.root, "Second").id;
    A.delegate(a); A.delegate(b);
    assert.deepEqual([S.get(a).stage, S.get(b).stage], ["starting", "queued"]);
    assert.equal(stateOf(b).note, "waiting for a free slot");
    await settle(a); // first reaches "waiting for approval": it holds no slot any more
    assert.equal(S.get(a).stage, "approval");
    housekeeping(w.socket, { force: true });
    const tb = await settle(b);
    assert.equal(tb.stage, "working");
  } finally { w.cleanup(); }
});

test("archive closes the task's herdr space and keeps the rest; restore starts nothing; a reply restarts the agent; clear keeps unsaved work", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w);
    let t = S.get(id);
    const tree = t.worktree;
    A.archive(id);
    assert.ok(S.get(id).archivedAt); assert.ok(fs.existsSync(tree));
    assert.ok(!w.state().workspaces.some((x) => x.workspace_id === t.link.workspace));
    assert.throws(() => A.tell(id, "hi"), /archived/);
    assert.equal(F.board().length, 0); assert.equal(F.board({ includeArchived: true }).length, 1);
    A.restore(id);
    t = S.get(id);
    assert.equal(t.stage, "approval"); assert.ok(!t.archivedAt);
    assert.equal(w.state().workspaces.filter((x) => x.worktree?.is_linked_worktree).length, 0); // nothing was started
    // the first action that needs the agent reopens the workspace from the worktree and starts it again
    w.script({ worker: [{ files: { "g.txt": "g\n" }, commit: "g", note: "Continued." }] });
    assert.match(A.tell(id, "one more thing").msg, /starting it again/);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.summary, "Continued.");
    const prompt = paneOf(w, t).agent.prompts[0];
    assert.match(prompt, /Continue from the state of this branch/); assert.match(prompt, /Did v1\./); assert.match(prompt, /one more thing/);
    // clear with unsaved work: kept, and told where
    fs.writeFileSync(path.join(t.worktree, "unsaved.txt"), "x\n");
    const out = await A.clear(id);
    assert.match(out.kept[0], /uncommitted changes/); assert.ok(fs.existsSync(t.worktree)); assert.equal(S.get(id), null);
  } finally { w.cleanup(); }
});

test("reconcile: a pane that is gone, an agent that exited, and a finished turn missed while herdr restarted", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Reconcile").id;
    A.delegate(id);
    let t = await settle(id);
    // the agent exits to its shell
    w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).agent = null; });
    reconcile(S.get(id), herdr());
    assert.deepEqual([stateOf(id).state, stateOf(id).note], ["error", "the agent has exited"]);
    // the pane is closed
    w.patchState((s) => { s.panes = s.panes.filter((p) => p.pane_id !== t.link.pane); });
    reconcile(S.get(id), herdr());
    assert.deepEqual([stateOf(id).state, stateOf(id).note], ["error", "the agent's terminal is gone"]);
    // a pane move gave it a new id: relinked by agent name in the task's folder
    w.patchState((s) => { s.panes.push({ pane_id: "w9:p1", workspace_id: "w9", tab_id: "w9:t1", terminal_id: "term_new", cwd: t.worktree, agent: { kind: "claude", name: "sw-proj-1", status: "working", seq: ++s.seq } }); });
    reconcile(S.get(id), herdr());
    assert.equal(S.get(id).link.pane, "w9:p1");
    // it finished while no hook fired
    fs.mkdirSync(path.join(t.worktree, ".herdr-superwork"), { recursive: true });
    fs.writeFileSync(path.join(t.worktree, ".herdr-superwork", "closing-1.md"), "Finished unseen."); const later = new Date(Date.now() + 2000); fs.utimesSync(path.join(t.worktree, ".herdr-superwork", "closing-1.md"), later, later);
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === "w9:p1"); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
    housekeeping(w.socket, { force: true });
    t = await settle(id);
    assert.equal(t.stage, "done"); // nothing to land: simply done
    assert.equal(t.msg, "Finished unseen.");
  } finally { w.cleanup(); }
});

test("tasks of another herdr session show their last known state and refuse live actions with the reason", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Elsewhere").id;
    A.delegate(id);
    await settle(id);
    S.update(id, (t) => { t.link = { ...t.link, socket: "/x/sessions/other/herdr.sock" }; });
    assert.deepEqual([stateOf(id).state, stateOf(id).note], ["working", "in session other"]);
    assert.throws(() => A.tell(id, "hi"), /lives in herdr session other/);
  } finally { w.cleanup(); }
});

test("a task outside git works in place in a plain herdr workspace and is simply done", async () => {
  const w = await world({ repo: false });
  try {
    w.script({ worker: [{ files: { "notes.md": "x\n" }, note: "Wrote the notes." }] });
    const id = A.add(w.root, "Plain folder").id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "done"); assert.equal(t.msg, "Wrote the notes."); assert.ok(!t.worktree);
    assert.equal(w.state().workspaces.length, 0); // done: its space left herdr's sidebar by itself
    assert.ok(t.cleaned); assert.ok(!t.link.workspace);
    assert.equal(fs.readFileSync(path.join(w.root, "notes.md"), "utf8"), "x\n");
    await A.clear(id);
    assert.equal(S.get(id), null);
  } finally { w.cleanup(); }
});

test("setup runs before the agent starts; a failed setup is a saved failure", async () => {
  const w = await world({ repoSettings: { setup: "echo boom >&2; exit 3", include: [".env"] } });
  try {
    fs.writeFileSync(path.join(w.root, ".gitignore"), ".env\n"); fs.writeFileSync(path.join(w.root, ".env"), "SECRET=1\n"); git(w.root, "add", ".gitignore"); git(w.root, "commit", "-qm", "ignore");
    const id = A.add(w.root, "Setup fails").id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "failed"); assert.equal(t.failure.title, "Setup failed"); assert.match(t.failure.detail, /boom/);
    assert.equal(fs.readFileSync(path.join(t.worktree, ".env"), "utf8"), "SECRET=1\n"); // ignored files named by include were copied
    assert.equal(paneOf(w, t).agent, null); // the agent never started
  } finally { w.cleanup(); }
});

test("delegating a landed task again starts a new round in a fresh worktree, never in your checkout", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w);
    A.approve(id);
    let t = await settle(id);
    assert.equal(t.stage, "done"); assert.ok(t.cleaned);
    w.script({ worker: [{ status: "working" }] });
    A.delegate(id);
    t = await settle(id);
    assert.equal(t.stage, "working"); assert.equal(t.branch, "work/1-work"); assert.ok(t.worktree && t.worktree !== w.root && fs.existsSync(t.worktree));
    assert.notEqual(paneOf(w, t).cwd, w.root);
    assert.match(paneOf(w, t).agent.prompts[0], /\n\nWork/);
  } finally { w.cleanup(); }
});

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

test("clean-up never takes work that arrives while it runs: a reply waits, and a late commit keeps its worktree and branch", async () => {
  // the repo's teardown stands in for a turn typed in the agent's own terminal during clean-up: it commits a file
  const w = await world({ settings: { reviewer: "off" }, repoSettings: { teardown: "sleep 0.5; echo late > late.txt; git add -A; git commit -qm late" } });
  try {
    w.script({ worker: [{ note: "Looked. Nothing to change." }] });
    const id = A.add(w.root, "Look").id;
    A.delegate(id);
    const ended = settle(id);
    let refused = null;
    for (const until = Date.now() + 15000; Date.now() < until && !refused; await new Promise((r) => setTimeout(r, 20))) {
      const c = S.get(id);
      if (c.stage === "done" && c.runner) { try { A.tell(id, "one more thing"); refused = "sent"; } catch (e) { refused = e.message; } }
      else if (c.stage === "done") break;
    }
    assert.match(String(refused), /cleaning up after it finished/);
    const t = await ended;
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.match(t.kept[0], /new work arrived during clean-up/);
    assert.ok(fs.existsSync(path.join(t.worktree, "late.txt")));
    assert.equal(git(w.root, "log", "-1", "--format=%s", t.branch), "late");
    assert.ok(!w.state().workspaces.some((x) => x.workspace_id === t.link.workspace)); // its space still left the sidebar
    // the reply goes through afterwards and continues in that worktree
    w.script({ worker: [{ files: { "m.txt": "m\n" }, commit: "m", note: "Did m." }] });
    assert.match(A.tell(id, "one more thing").msg, /starting it again/);
    const again = await settle(id);
    assert.equal(again.stage, "approval", JSON.stringify(again.failure)); assert.ok(fs.existsSync(path.join(again.worktree, "late.txt")));
  } finally { w.cleanup(); }
});

test("a turn started in the agent's own terminal during clean-up keeps its terminal open and its worktree in place", async () => {
  // the teardown stands in for you typing in the agent's terminal while clean-up runs: herdr now says "working"
  const typed = `node -e 'const fs=require("fs"),f=process.env.HERDR_FAKE_DIR+"/state.json",s=JSON.parse(fs.readFileSync(f));for(const p of s.panes)if(p.agent){s.seq+=1;p.agent.status="working";p.agent.seq=s.seq}fs.writeFileSync(f,JSON.stringify(s))'`;
  const w = await world({ settings: { reviewer: "off" }, repoSettings: { teardown: typed } });
  try {
    w.script({ worker: [{ note: "Looked. Nothing to change." }] });
    const id = A.add(w.root, "Look").id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.match(t.kept[0], /its space is in use again/);
    assert.ok(fs.existsSync(t.worktree)); assert.ok(git(w.root, "branch", "--list", t.branch));
    assert.ok(w.state().workspaces.some((x) => x.workspace_id === t.link.workspace)); // not closed under its agent
    assert.ok(paneOf(w, t).agent);
  } finally { w.cleanup(); }
});

test("a terminal turn that starts before clean-up and ends during its first wait still keeps the terminal; a trailing status does not", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  const flip = (t, after) => setTimeout(() => { w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; }); after?.(); }, 300);
  const run = async (n, { hooked, event }) => {
    w.script({ worker: [{ files: { [`f${n}.txt`]: "x\n" }, commit: `f${n}`, note: "Did it." }] });
    const id = A.add(w.root, `Task ${n}`).id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    S.update(id, (t) => { t.hooked = hooked; });
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "working"; p.agent.seq = s.seq; });
    // the agent task is called done; herdr says its agent is working, and that ends while clean-up waits
    S.update(id, (t) => { t.stage = "done"; t.seen = true; });
    flip(t, event ? () => S.update(id, (t) => { t.eventSeq = (t.eventSeq || 0) + 1; }) : null);
    const { cleanupJob } = await import("../src/land.js");
    await cleanupJob(id, { deleteBranch: "merged" });
    t = S.get(id);
    return { t, open: w.state().workspaces.some((x) => x.workspace_id === t.link.workspace) };
  };
  try {
    process.env.HERDR_SUPERWORK_SETTLE_MS = "3000";
    let r = await run(1, { hooked: false }); // no hook: a status that was "working" is a turn
    assert.match(r.t.kept[0], /its space is in use again/); assert.ok(r.open); assert.ok(fs.existsSync(r.t.worktree));
    r = await run(2, { hooked: true, event: true }); // the hook reported the turn's end
    assert.match(r.t.kept[0], /its space is in use again/); assert.ok(r.open); assert.ok(fs.existsSync(r.t.worktree));
    r = await run(3, { hooked: true }); // only herdr's status trailing the turn that ended the task
    assert.match(r.t.kept[0], /unmerged work/); assert.ok(!r.open); assert.ok(fs.existsSync(r.t.worktree));
  } finally { process.env.HERDR_SUPERWORK_SETTLE_MS = "0"; w.cleanup(); }
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
    S.update(t.id, (t) => { t.stage = "done"; t.seen = true; });
    w.patchState((s) => { s.agentGetFails = true; });
    const { cleanupJob } = await import("../src/land.js");
    await cleanupJob(t.id, { deleteBranch: "merged" });
    w.patchState((s) => { s.agentGetFails = false; });
    t = S.get(t.id);
    assert.match(t.kept[0], /in use again/); assert.ok(open(t)); assert.ok(fs.existsSync(t.worktree));
  } finally { w.cleanup(); }
});

test("a clean-up put off because the space was in use is tried again by itself once it is free", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  const { housekeeping } = await import("../src/housekeeping.js");
  const { cleanupJob } = await import("../src/land.js");
  const open = (t) => w.state().workspaces.some((x) => x.workspace_id === t.link?.workspace);
  // one housekeeping pass, as the keeper or any hook runs it, and the retry it starts (if it starts one)
  const pass = async (id) => {
    fs.rmSync(path.join(process.env.HERDR_SUPERWORK_DATA_DIR, "stamps"), { recursive: true, force: true });
    globalThis.__swJobs = [];
    housekeeping(w.socket, { force: true });
    const jobs = globalThis.__swJobs.filter((j) => j[0] === "cleanup" && j[1] === id);
    globalThis.__swJobs = [];
    for (const [, , extra] of jobs) await cleanupJob(id, { deleteBranch: extra.includes("--merged") ? "merged" : "always" });
    return jobs.length;
  };
  const merged = async (n, before) => {
    w.script({ worker: [{ files: { [`h${n}.txt`]: "x\n" }, commit: `h${n}`, note: "Did it." }] });
    const id = A.add(w.root, `Task ${n}`).id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    before(t);
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.match(t.kept[0], /in use again/); assert.ok(open(t)); assert.ok(t.tidy);
    globalThis.__swJobs = [];
    return t;
  };
  try {
    // a command of yours in a split pane: nothing happens while it runs, and the task is cleaned up when it has ended
    let mine;
    let t = await merged(1, (t) => { mine = herdr().paneSplit(t.link.pane, { cwd: t.worktree }).pane_id; w.patchState((s) => { s.panes.find((p) => p.pane_id === mine).busy = true; }); });
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && S.get(t.id).tidy);
    w.patchState((s) => { s.panes.find((p) => p.pane_id === mine).busy = false; });
    S.setConfig("cleanup", false); // `cleanup` turned off meanwhile: nothing pending is carried out
    assert.equal(await pass(t.id), 0); assert.equal(w.state().workspaces.length, 2);
    S.setConfig("cleanup", true);
    assert.equal(await pass(t.id), 1);
    let c = S.get(t.id);
    assert.ok(c.cleaned && !c.tidy && !c.kept); assert.equal(c.msg, "Merged into main."); assert.ok(!fs.existsSync(t.worktree));
    assert.equal(w.state().workspaces.length, 0); assert.equal(git(w.root, "branch", "--list", "work/*"), "");
    assert.equal(await pass(t.id), 0); // and then it is over
    // herdr did not answer: cleaned up as soon as it does
    w.script({ worker: [{ files: { "u.txt": "x\n" }, commit: "u", note: "Did it." }] });
    const u = A.add(w.root, "Unanswered").id;
    A.delegate(u);
    assert.equal((await settle(u)).stage, "approval");
    S.update(u, (t) => { t.stage = "done"; t.seen = true; });
    w.patchState((s) => { s.agentGetFails = true; });
    await cleanupJob(u, { deleteBranch: "merged" });
    assert.ok(open(S.get(u)) && S.get(u).tidy);
    w.patchState((s) => { s.agentGetFails = false; });
    assert.equal(await pass(u), 1);
    c = S.get(u);
    assert.ok(!c.tidy && !open(c)); assert.match(c.kept[0], /unmerged work/); assert.ok(fs.existsSync(c.worktree));
    await A.clear(u);
    // the agent is idle, but a command it started in the background still runs under it: nothing is closed until it ends
    t = await merged(6, (t) => w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).tool = true; }));
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && S.get(t.id).tidy && fs.existsSync(t.worktree));
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); p.tool = false; p.job = true; });
    assert.equal(await pass(t.id), 1); // nothing under the agent any more, but a background job of the pane's shell beside it
    assert.ok(open(S.get(t.id)) && S.get(t.id).tidy && fs.existsSync(t.worktree));
    w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).job = false; });
    assert.equal(await pass(t.id), 1);
    assert.ok(S.get(t.id).cleaned && !fs.existsSync(t.worktree)); assert.equal(w.state().workspaces.length, 0);
    // herdr cannot tell whether the agent works (status "unknown"): not closed; cleaned up as soon as herdr calls it idle
    const setStatus = (t, status) => w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = status; p.agent.seq = s.seq; });
    t = await merged(4, (t) => setStatus(t, "unknown"));
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && S.get(t.id).tidy && fs.existsSync(t.worktree));
    setStatus(t, "idle");
    assert.equal(await pass(t.id), 1);
    assert.ok(S.get(t.id).cleaned && !fs.existsSync(t.worktree)); assert.equal(w.state().workspaces.length, 0);
    // herdr never calls this agent idle (it does that to some after a reply), but its screen stands still: at rest
    const screen = (t, text) => w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).agent.screen = text; });
    process.env.HERDR_SUPERWORK_STILL_MS = "800";
    t = await merged(5, (t) => { setStatus(t, "unknown"); screen(t, "● working 2s\n"); });
    assert.ok(S.get(t.id).tidy.still); // what its screen showed is remembered
    screen(t, "● working 9s\n"); // it moves: an agent at work, however long ago the last look was
    await new Promise((r) => setTimeout(r, 900));
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && fs.existsSync(t.worktree));
    assert.equal(await pass(t.id), 1); // the same screen now, but not for long enough yet
    assert.ok(open(S.get(t.id)) && fs.existsSync(t.worktree));
    // the same screen for long enough, but a tool it started is still running without a sign on the screen: at work
    w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).tool = true; });
    await new Promise((r) => setTimeout(r, 900));
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && fs.existsSync(t.worktree));
    // its saved conversation ends in a finished turn, yet a command it started in the background still runs: at work
    const said = path.join(w.base, "said.jsonl");
    fs.writeFileSync(said, JSON.stringify({ type: "assistant", uuid: "u1", timestamp: new Date().toISOString(), message: { id: "m1", stop_reason: "end_turn", content: [{ type: "text", text: "All done." }] } }) + "\n");
    S.update(t.id, (c) => { c.transcript = said; });
    const { readTurnOf } = await import("../src/agents.js");
    assert.equal(readTurnOf("claude", { file: said }).finished, true);
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && fs.existsSync(t.worktree));
    // a conversation that does not end in a finished turn keeps it open by itself, with nothing running under the agent
    w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).tool = false; });
    fs.appendFileSync(said, JSON.stringify({ type: "user", uuid: "u2", timestamp: new Date().toISOString(), message: { content: "one more" } }) + "\n");
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && fs.existsSync(t.worktree));
    fs.appendFileSync(said, JSON.stringify({ type: "assistant", uuid: "u3", timestamp: new Date().toISOString(), message: { id: "m2", stop_reason: "end_turn", content: [{ type: "text", text: "Done again." }] } }) + "\n");
    assert.equal(await pass(t.id), 1); // a finished turn, a still screen, nothing running
    assert.ok(S.get(t.id).cleaned && !S.get(t.id).tidy); assert.equal(w.state().workspaces.length, 0);
    // a turn in the agent's own terminal: left alone until it has been quiet for a while; what it committed is kept
    t = await merged(3, (t) => w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "working"; p.agent.seq = s.seq; }));
    fs.writeFileSync(path.join(t.worktree, "more.txt"), "more\n"); git(t.worktree, "add", "-A"); git(t.worktree, "commit", "-qm", "more");
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
    assert.equal(await pass(t.id), 0); // not yet: you may still be talking to it
    process.env.HERDR_SUPERWORK_QUIET_MS = "0";
    assert.equal(await pass(t.id), 1); // the turn that ended is seen first, and the wait starts from there
    assert.ok(open(S.get(t.id)) && S.get(t.id).tidy);
    assert.equal(await pass(t.id), 1);
    c = S.get(t.id);
    assert.ok(!c.tidy); assert.match(c.kept[0], /new work arrived/); assert.ok(!open(c));
    assert.ok(fs.existsSync(path.join(t.worktree, "more.txt"))); assert.equal(git(w.root, "log", "-1", "--format=%s", t.branch), "more");
    assert.equal(await pass(t.id), 0);
  } finally { delete process.env.HERDR_SUPERWORK_QUIET_MS; delete process.env.HERDR_SUPERWORK_STILL_MS; w.cleanup(); }
});

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

test("no notifications: a task that needs you raises nothing, and the pop-up block an older version wrote is taken out", async () => {
  const w = await world();
  try {
    const id = await toApproval(w);
    const { tickOnce } = await import("../src/keeper.js");
    tickOnce(w.socket);
    assert.equal(S.get(id).announced, undefined);
    assert.ok(!("bell" in S.config()));
    assert.deepEqual(w.state().notifications, []);
    assert.ok(!w.state().calls.some((c) => JSON.stringify(c).includes("notification")));
    const X = await import("../src/extras.js");
    const file = path.join(w.fake, "config.toml");
    const mine = `[keys]\nx = "prefix+x"\n\n${X.blockText("sidebar")}\n`;
    fs.writeFileSync(file, `${mine}\n# >>> herdr-superwork popups (added by the herdr-superwork plugin; \`herdr-superwork remove-extras\` removes it)\n[ui.toast]\ndelivery = "herdr"\n# <<< herdr-superwork popups\n`);
    process.env.HERDR_CONFIG_PATH = file;
    assert.equal(X.offers().popups, undefined);
    assert.equal(X.removePopups(), true);
    assert.equal(fs.readFileSync(file, "utf8").trim(), mine.trim()); // only that block went
    assert.equal(X.removePopups(), false);
    const real = path.join(w.fake, "managed.toml"), before = `${mine}\n${X.blockText("sidebar").replaceAll("sidebar", "popups")}\n`;
    fs.writeFileSync(real, before); fs.rmSync(file); fs.symlinkSync(real, file);
    assert.equal(X.removePopups(), false); // a linked config is someone else's file: left as it is
    assert.equal(fs.readFileSync(real, "utf8"), before);
  } finally { delete process.env.HERDR_CONFIG_PATH; w.cleanup(); }
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

test("a pull request merged elsewhere does not take a newer local commit with it", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w, "With a PR");
    let t = S.get(id);
    const pushed = t.prHead;
    assert.equal(pushed, git(t.worktree, "rev-parse", "HEAD"));
    // one more commit here that was never pushed; meanwhile the pull request is merged on GitHub at the pushed head
    fs.writeFileSync(path.join(t.worktree, "late.txt"), "late\n"); git(t.worktree, "add", "-A"); git(t.worktree, "commit", "-qm", "late");
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ view: { state: "MERGED", headRefOid: pushed } }));
    await pollPrs();
    t = S.get(id);
    assert.equal(t.stage, "done"); assert.equal(t.prMerged, true);
    assert.match(t.kept[0], /unmerged work on work\//); assert.match(t.msg, /Kept: /); assert.ok(!t.tidy && !t.cleaned);
    assert.ok(fs.existsSync(path.join(t.worktree, "late.txt"))); assert.equal(git(w.root, "log", "-1", "--format=%s", t.branch), "late");
    assert.ok(!w.state().workspaces.some((x) => x.workspace_id === t.link.workspace)); // it still leaves the sidebar
  } finally { w.cleanup(); }
});

test("a commit that reaches the branch while it is being merged is neither merged unseen nor deleted as merged", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w);
    let t = S.get(id);
    const reviewed = git(t.worktree, "rev-parse", "HEAD");
    // your checkout's pre-commit hook stands in for the agent: it commits to the task's branch in the middle of the merge
    const hook = path.join(w.root, ".git", "hooks", "pre-commit");
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, `#!/bin/sh\n[ -n "$SW_LATE" ] && exit 0\n(unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX; cd "${t.worktree}" && echo late > late.txt && SW_LATE=1 git add -A && SW_LATE=1 git commit -qm late)\n`, { mode: 0o755 });
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.match(t.msg, /^Merged into main\. Kept: .*new work arrived during clean-up/);
    assert.equal(fs.readFileSync(path.join(w.root, "f.txt"), "utf8"), "v1\n"); assert.ok(!fs.existsSync(path.join(w.root, "late.txt"))); // what was reviewed landed, nothing else
    assert.ok(fs.existsSync(path.join(t.worktree, "late.txt")));
    assert.equal(git(w.root, "log", "-1", "--format=%s", t.branch), "late"); assert.equal(git(w.root, "rev-parse", `${t.branch}~1`), reviewed);
    assert.ok(!w.state().workspaces.some((x) => x.workspace_id === t.link.workspace));
  } finally { w.cleanup(); }
});

test("a pull request only merges at the commit that was reviewed: a commit pushed from elsewhere stops it, also the auto-merge", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w, "With a PR");
    let t = S.get(id);
    const reviewed = git(t.worktree, "rev-parse", "HEAD"), other = "1".repeat(40);
    // GitHub says the pull request's head is another commit: said plainly, nothing merges
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ head: other, view: { state: "OPEN", headRefOid: other } }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.mergeFailed, true); assert.ok(!t.autoMerge);
    assert.equal(t.failure.title, "Pull request has commits that were not reviewed"); assert.match(t.failure.detail, new RegExp(other));
    assert.ok(!/pr merge/.test(ghLog(w)));
    // it arrives between that look and the merge: GitHub itself refuses
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ head: other }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.ok(!t.autoMerge); assert.equal(t.failure.title, "Pull request could not merge"); assert.match(t.failure.detail, /Head branch was modified/);
    assert.match(ghLog(w), new RegExp(`pr merge 7 --squash --match-head-commit ${reviewed}\\n`));
    assert.ok(!/--auto|--delete-branch/.test(ghLog(w)));
    assert.ok(fs.existsSync(t.worktree)); assert.ok(!t.tidy);
    // checks still running: remembered. Someone pushes to the pull request meanwhile: the approval is withdrawn
    const view = (head, state) => ({ state: "OPEN", headRefOid: head, statusCheckRollup: [{ name: "build", ...(state === "PENDING" ? { state } : { conclusion: state }) }], comments: [], reviews: [], author: { login: "me" } });
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ head: reviewed, mergeFail: "checks pending", view: view(reviewed, "PENDING") }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "merging"); assert.equal(t.autoMerge, true);
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ head: other, view: view(other, "SUCCESS") }));
    await pollPrs(); await settle(id);
    t = S.get(id);
    assert.equal(t.stage, "approval"); assert.ok(!t.autoMerge && !t.mergeIntent); assert.equal(t.failure.title, "Pull request has commits that were not reviewed");
    // remembered again, the checks pass on the reviewed commit: the board merges it itself, the remote branch goes, clean-up follows
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ head: reviewed, mergeFail: "checks pending", view: view(reviewed, "PENDING") }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "merging"); assert.equal(t.autoMerge, true);
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ head: reviewed, view: view(reviewed, "SUCCESS") }));
    await pollPrs();
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.ok(t.cleaned && !t.autoMerge);
    assert.equal(git(w.root, "ls-remote", "--heads", "origin", t.branch), ""); // deleted at the remote, by the lease on the merged commit
  } finally { w.cleanup(); }
});

test("a pull request that GitHub only queued is not taken for merged: nothing is cleaned up until GitHub says so", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w, "With a PR");
    let t = S.get(id);
    const head = t.prHead, view = (state) => ({ state, headRefOid: head, statusCheckRollup: [], comments: [], reviews: [], author: { login: "me" } });
    // a repo with a merge queue: gh pr merge answers fine, the pull request stays open
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ queue: true, view: view("OPEN") }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "merging"); assert.equal(t.autoMerge, true); assert.ok(!t.prMerged && !t.cleaned && !t.tidy);
    assert.match(t.msg, /GitHub merges it when/);
    assert.ok(fs.existsSync(t.worktree)); assert.ok(w.state().workspaces.some((x) => x.workspace_id === t.link.workspace));
    assert.equal(git(w.root, "ls-remote", "--heads", "origin", t.branch).split("\t")[0], head); // the remote branch is still there
    await pollPrs();
    assert.equal(S.get(id).stage, "merging"); // still watched, still waiting
    // (closed without merging instead: see the next test)
    // the queue merges it: now it is done and cleaned up
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ view: view("MERGED") }));
    await pollPrs();
    t = await settle(id);
    assert.equal(t.stage, "done"); assert.ok(t.prMerged && t.cleaned && !t.autoMerge);
    assert.equal(w.state().workspaces.length, 0); assert.equal(git(w.root, "ls-remote", "--heads", "origin", t.branch), "");
  } finally { w.cleanup(); }
});

test("a queued pull request that is closed without merging stops waiting and says so", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w, "With a PR");
    let t = S.get(id);
    const view = (state) => ({ state, headRefOid: t.prHead, statusCheckRollup: [], comments: [], reviews: [], author: { login: "me" } });
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ queue: true, view: view("OPEN") }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "merging"); assert.equal(t.autoMerge, true);
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ view: view("CLOSED") }));
    await pollPrs();
    t = S.get(id);
    assert.equal(t.stage, "approval"); assert.ok(!t.autoMerge && !t.mergeIntent && !t.prMerged); assert.equal(t.mergeFailed, true);
    assert.equal(t.failure.title, "Pull request was closed without merging"); assert.equal(t.msg, t.failure.title);
    assert.equal(stateOf(id).state, "blocked");
    assert.ok(fs.existsSync(t.worktree)); assert.ok(w.state().workspaces.some((x) => x.workspace_id === t.link.workspace)); // nothing was cleaned up
    await pollPrs();
    assert.equal(S.get(id).stage, "approval");
  } finally { w.cleanup(); }
});
