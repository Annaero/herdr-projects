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
