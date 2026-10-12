import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import { show, etaOf, began } from "../src/state.js";
import { parse } from "../src/cli.js";
import { agentName } from "../src/delegate.js";

test("tasks are filed per repo, numbered, and changed atomically under a lock", async (tt) => {
  const w = await world();
  tt.mock.timers.enable({ apis: ["Date"], now: Date.now() }); // the newest task is listed first: the clock moves when told to
  try {
    const a = S.create(w.root, "First task", { description: "do it" });
    tt.mock.timers.tick(1000);
    const b = S.create(w.root, "Second task");
    assert.equal(a.id, "proj/1"); assert.equal(b.id, "proj/2");
    assert.equal(a.stage, "todo"); assert.equal(a.owner, S.me());
    assert.deepEqual(S.list().map((t) => t.id), ["proj/2", "proj/1"]);
    const t = S.update(a.id, (t) => { t.stage = "progress"; });
    assert.equal(S.get(a.id).stage, "progress"); assert.ok(t.at >= a.at);
    assert.throws(() => S.update(a.id, { stage: "nonsense" }), /Unknown stage/);
    assert.equal(S.find("2").id, "proj/2");
    assert.throws(() => S.find("nope"), /No task/);
    assert.ok(!fs.readdirSync(S.dirOf(a.id)).some((f) => f.endsWith(".tmp")));
  } finally { w.cleanup(); }
});

test("[real programs] a lock that is held is busy for the next one, and free again once let go: the real lock (flock), and the one tests keep in their own process", async () => {
  for (const locks of [false, true]) {
    const w = await world({ repo: false, locks });
    try {
      const free = S.holdLock("x", { waitMs: 0 });
      assert.throws(() => S.withLock("x", () => 1, { waitMs: 0 }), (e) => e.code === "BUSY" && /x is busy with another action/.test(e.message));
      assert.equal(S.withLock("y", () => S.withLock("y", () => 2)), 2); // nested in one process: the same holder
      free();
      assert.equal(S.withLock("x", () => 3, { waitMs: 0 }), 3);
      assert.equal(fs.existsSync(path.join(process.env.HERDR_SUPERWORK_DATA_DIR, "locks")), !locks); // only the real one leaves lock files
    } finally { w.cleanup(); }
  }
});

test("a worktree's tasks belong to its primary repo", async () => {
  const w = await world();
  try {
    const wt = path.join(w.base, "wt");
    S.gitOut(w.root, ["worktree", "add", "-q", "-b", "x", wt]);
    assert.equal(S.repoOf(wt).root, w.root);
    assert.equal(S.create(wt, "From a worktree").repo, "proj");
  } finally { w.cleanup(); }
});

test("settings: defaults, your own, one task's own, and the repo file read from a commit", async () => {
  const w = await world({ repoSettings: { setup: "true", check: "npm test", land: "auto", include: [".env"] } });
  try {
    assert.equal(S.config().agent, "claude"); assert.equal(S.config().reviewer, "codex"); assert.equal(S.config().watcherModel, "claude-haiku-5-5");
    assert.equal(S.DEFAULTS.serve, "tailscale"); assert.equal(S.config().max, 4);
    S.setConfig("max", "2"); assert.equal(S.config().max, 2);
    assert.throws(() => S.setConfig("merge", "yolo"), /squash, merge or rebase/);
    assert.throws(() => S.setConfig("nope", 1), /Unknown setting/);
    const t = S.create(w.root, "T");
    assert.equal(S.setTaskConfig(t.id, "reviewer", "off").review, "none");
    assert.equal(S.setTaskConfig(t.id, "agent", "codex").agent, "codex");
    assert.equal(S.setTaskConfig(t.id, "agent", "default").agent, "claude");
    assert.throws(() => S.setTaskConfig(t.id, "max", 3), /Per task/);
    const rc = S.repoConfig(w.root, "HEAD");
    assert.deepEqual(rc, { setup: "true", check: "npm test", land: "auto", teardown: "", include: [".env"] });
    fs.writeFileSync(path.join(w.root, ".herdr-superwork.json"), "{\"check\":\"changed by a branch\"}");
    assert.equal(S.repoConfig(w.root, "HEAD").check, "npm test"); // the commit, not the working copy
  } finally { w.cleanup(); }
});

test("the inbox never drops text, and taken text can be put back", async () => {
  const w = await world();
  try {
    const t = S.create(w.root, "T");
    S.queueText(t.id, "one"); S.queueText(t.id, "two");
    assert.deepEqual(S.pendingText(t.id).map((m) => m.text), ["one", "two"]);
    assert.equal(S.takeText(t.id).length, 2); assert.equal(S.pendingText(t.id).length, 0);
    S.untakeText(t.id, 2); assert.equal(S.pendingText(t.id).length, 2);
  } finally { w.cleanup(); }
});

test("login failures are recognised from diagnostics, not from test names or assertions", () => {
  assert.ok(S.isAuthFailure("fatal: could not read Username for 'https://github.com': terminal prompts disabled"));
  assert.ok(S.isAuthFailure("error: authentication failed"));
  assert.ok(!S.isAuthFailure("ok 3 - missing token returns 401"));
  assert.ok(!S.isAuthFailure("AssertionError: expected 401 received 200"));
  assert.ok(!S.isAuthFailure("test/credentials.test.ts:12:3"));
});

test("minutes left come from the percent and the time spent, and move as time passes", () => {
  const min = 60000, t0 = 1e12;
  assert.equal(etaOf(80, t0, t0 + 40 * min), 10); // the example: 40 minutes in at 80% is 10 left
  assert.equal(etaOf(50, t0, t0 + 7.4 * min), 7); // whole minutes
  for (const p of [0, 4, undefined, null, "x"]) assert.equal(etaOf(p, t0, t0 + 40 * min), undefined, `no guess at ${p}`); // too little to go on: none, not a huge number
  assert.equal(etaOf(5, t0, t0 + 40 * min), 760);
  assert.equal(etaOf(80, undefined, t0), undefined); // no start known
  assert.equal(etaOf(80, t0, t0 - 5 * min), 1); // a clock that went back: never negative
  assert.deepEqual([etaOf(99, t0, t0 + 2 * min), etaOf(42, t0, t0), etaOf(100, t0, t0 + 40 * min)], [1, 1, 0]); // never under a minute while work is left
  assert.equal(etaOf(5, t0, t0 + 1e9 * min), 99999);
  // On the board: the agent's guess counts from when its work began, the reviewer's from the start of this round.
  const task = { id: "p/1", owner: "me", app: "claude", link: { pane: "w1:p1" }, stage: "working", since: t0 - 30 * min, workAt: t0, reviewAt: t0 + 60 * min };
  const at = (t, mins) => show(t, { status: "working" }, t0 + mins * min).eta;
  assert.equal(began({ ...task, watch: { progress: 80, role: "agent" } }), t0); // not the time it waited in the queue
  assert.equal(began({ ...task, since: t0 + min, watch: { progress: 80, role: "agent" } }), t0 + min); // a reply starts the count again
  assert.deepEqual([40, 60, 80].map((m) => at({ ...task, watch: { progress: 80, role: "agent" } }, m)), [10, 15, 20]); // same guess, later: more left
  assert.equal(at({ ...task, watch: { progress: 2, role: "agent" } }, 40), undefined);
  assert.equal(at({ ...task, watch: null }, 40), undefined);
  assert.equal(at({ ...task, stage: "reviewing", watch: { progress: 50, role: "reviewer" } }, 66), 6);
  // The stage decides whose clock runs. A reviewer's guess kept on a task whose agent works again (a stopped review,
  // delegated again) is not shown as the agent's: no 80% and 10m beside an assignment that is a second old.
  const again = show({ ...task, since: t0 + 100 * min, workAt: 0, reviewAt: t0 + 60 * min, watch: { msg: "reading the diff", progress: 80, role: "reviewer" } }, { status: "working" }, t0 + 100 * min + 1000);
  assert.deepEqual([again.progress, again.eta, again.msg], [0, undefined, "working"]);
  assert.equal(began({ ...task, watch: { progress: 80, role: "reviewer" } }), t0); // stage working: the agent's start, whatever the old guess says
  assert.equal(at({ ...task, stage: "reviewing", watch: { progress: 50, role: "agent" } }, 66), undefined);
  assert.equal(at({ ...task, stage: "merging", watch: { progress: 50, role: "reviewer" } }, 66), undefined); // no one is watched in a runner stage
  // Your own task keeps the minutes you reported, as given.
  assert.deepEqual([show({ ...task, stage: "progress", watch: { progress: 50, eta: 12 } }).eta, show({ ...task, stage: "progress", watch: { eta: 3 } }).eta], [12, 3]);
});

test("the one mapping function: stage and herdr status to board state", () => {
  const base = { id: "p/1", owner: "me", app: "claude", link: { pane: "w1:p1" } };
  const s = (stage, live, extra = {}) => show({ ...base, stage, ...extra }, live);
  assert.equal(s("todo").state, "idle");
  assert.deepEqual([s("progress", undefined, { app: "me" }).state, s("progress", undefined, { app: "me" }).app], ["working", "me"]);
  for (const st of ["setup", "checking", "pushing", "reviewing", "merging", "starting", "queued"]) assert.equal(s(st).state, "working", st);
  assert.equal(s("queued").msg, "waiting for a free slot");
  assert.equal(s("working", { status: "working" }).state, "working");
  assert.deepEqual([s("working", { status: "blocked" }).state, s("working", { status: "blocked" }).kind, s("working", { status: "blocked" }).msg], ["blocked", undefined, "needs you"]);
  // An idle agent is wrapping up only if it has worked: herdr saw it work since the turn was armed, or counts a
  // finished turn the finish line has not handled. A freshly started one is idle too, and is "starting".
  assert.equal(s("working", { status: "done" }, { armedAt: 100, startedAgentAt: 100, turnBy: "start" }).msg, "starting");
  assert.equal(s("working", { status: "idle" }, { armedAt: 100, startedAgentAt: 100 }).msg, "starting");
  assert.equal(s("working", { status: "idle" }, { armedAt: 100, startedAgentAt: 100, workedAt: 150 }).msg, "finishing");
  const lost = { armedAt: 100, startedAgentAt: 100, last: { status: "done", comp: 7, at: 200 } };
  assert.equal(s("working", { status: "done", agent: { completion_seq: 7 } }, lost).msg, "finishing"); // the "working" reading was lost: a turn that ended after the turn was armed says so
  // herdr's count alone is no proof: answering a start-up dialog raises it before the first prompt is sent
  assert.equal(s("working", { status: "done", agent: { completion_seq: 7 } }, { armedAt: 100, startedAgentAt: 100 }).msg, "starting");
  assert.equal(s("working", { status: "done", agent: { completion_seq: 7 } }, { ...lost, pendingText: true }).msg, "starting"); // the prompt still waits to be sent
  assert.equal(s("working", { status: "done", agent: { completion_seq: 7 } }, { ...lost, armedAt: 300 }).msg, "starting"); // counted before the prompt went out
  assert.equal(s("working", { status: "done", agent: { completion_seq: 7 } }, { ...lost, armedAt: 300, last: { status: "done", comp: 7, at: 400, compAt: 200 } }).msg, "starting"); // read again since, and still the old count
  assert.equal(s("working", { status: "idle", agent: { completion_seq: 7 } }, { armedAt: 300, startedAgentAt: 100, workedAt: 150, handled: { comp: 7 } }).msg, "about to continue"); // a reply it has not picked up yet
  assert.equal(s("working", { status: "idle", agent: { completion_seq: 7 } }, { armedAt: 300, startedAgentAt: 300, workedAt: 150, handled: { comp: 7 } }).msg, "starting"); // started again after it exited
  assert.equal(s("working", { status: "idle", agent: { completion_seq: 7 } }, { armedAt: 300, startedAgentAt: 100, workedAt: 350, handled: { comp: 7 } }).msg, "finishing");
  assert.equal(s("working", { status: "idle" }).state, "working");
  assert.deepEqual([s("working", { status: null }).state, s("working", { status: null }).msg], ["error", "the agent has exited"]);
  assert.deepEqual([s("working", { gone: true }).state, s("working", { gone: true }).msg], ["error", "the agent's terminal is gone"]);
  assert.equal(s("working", { status: "unknown" }).msg, "herdr can't tell if it stopped");
  assert.equal(s("working", { away: "other" }).msg, "in session other");
  assert.equal(s("working", { down: true }).msg, "herdr is not running");
  assert.deepEqual([s("asks").state, s("asks").kind], ["blocked", "question"]);
  assert.equal(s("asks", undefined, { kind: "auth" }).kind, "auth");
  assert.equal(s("nosummary").state, "error");
  assert.equal(s("reviewneeds").state, "blocked");
  assert.deepEqual([s("approval").state, s("approval").kind, s("approval").review], ["blocked", "permission", true]);
  assert.equal(s("approval", undefined, { mergeFailed: true }).review, false);
  assert.equal(s("failed").state, "error");
  assert.deepEqual([s("failed", undefined, { failure: { auth: true } }).state, s("failed", undefined, { failure: { auth: true } }).kind], ["blocked", "auth"]);
  assert.equal(s("done").state, "done");
  assert.deepEqual([s("stopped").state, s("stopped").msg], ["idle", "stopped"]);
});

test("command line parsing and agent names", () => {
  assert.deepEqual(parse(["add", "Fix", "it", "--desc", "more", "--delegate", "--no-worktree"]), { pos: ["add", "Fix", "it"], flags: { desc: "more", delegate: true, worktree: false } });
  const t = { repo: "My.Repo_With-A-Long-Name", n: 12, id: "x/12", root: "/r" };
  assert.equal(agentName(t), "sw-my-repo-with-a-l-12");
  assert.match(agentName(t, ["sw-my-repo-with-a-l-12"]), /^sw-my-repo-with-a-l-12-[0-9a-f]{4}$/);
  assert.match(agentName(t, ["sw-my-repo-with-a-l-12"]), /^[a-z][a-z0-9_-]{0,31}$/);
});

test("a task keeps every review it had: which one, the score, the advice, the summary; a failed one with why", () => {
  const t = { reviewRound: 1 };
  S.logReview(t, { score: 2, recommend: false, text: "Crashes.", problems: ["a.js: null"], checks: ["ran it"], limitations: [], head: "abc1234", artifacts: [{ file: "x.png" }] });
  t.reviewRound = 2; S.logReview(t, { error: "the reviewer\nfinished without a verdict" });
  t.reviewRound = 3; S.logReview(t, { score: 5, recommend: true, text: "Good." });
  assert.deepEqual(S.reviewHistory(t).map((e) => [e.round, e.score ?? "failed", e.recommend ?? null, e.text || e.error]), [[1, 2, false, "Crashes."], [2, "failed", null, "the reviewer finished without a verdict"], [3, 5, true, "Good."]]);
  assert.ok(S.reviewHistory(t).every((e) => e.at > 0)); assert.equal(S.reviewHistory(t)[0].artifacts, undefined); assert.equal(S.reviewHistory(t)[0].head, "abc1234");
  for (let n = 0; n < 60; n++) S.logReview(t, { score: 3, text: "Again." });
  assert.equal(t.reviews.length, 63); assert.equal(S.reviewHistory(t)[0].text, "Crashes."); // every one of them, however long the spiral
  // a task reviewed before the list existed keeps that review when it is reviewed again
  const old = { reviewRound: 3, review: { score: 2, recommend: false, text: "Old one.", at: 5, stale: true } };
  S.logReview(old, { score: 4, recommend: true, text: "New one." });
  assert.deepEqual(S.reviewHistory(old).map((e) => [e.round, e.score, e.text]), [[2, 2, "Old one."], [3, 4, "New one."]]); assert.equal(old.reviews[0].at, 5);
  // its number is fixed before the next review starts, so a review stopped half way cannot shift it
  const stopped = { reviewRound: 1, review: { score: 2, recommend: false, text: "First.", at: 5 } };
  S.keepSavedReview(stopped); stopped.reviewRound = 2; // the second review starts, and is stopped with no verdict
  assert.deepEqual(S.reviewHistory(stopped).map((e) => [e.round, e.text]), [[1, "First."]]);
  S.keepSavedReview(stopped); stopped.reviewRound = 3; S.logReview(stopped, { score: 4, recommend: true, text: "Third." });
  assert.deepEqual(S.reviewHistory(stopped).map((e) => [e.round, e.text]), [[1, "First."], [3, "Third."]]);
  const none = { reviewRound: 0 }; S.keepSavedReview(none); assert.equal(none.reviews, undefined);
  const failed = { reviewRound: 2, review: { score: 3, text: "Before." } }; S.logReview(failed, { error: "timed out" });
  assert.deepEqual(S.reviewHistory(failed).map((e) => [e.round, e.score ?? e.error]), [[1, 3], [2, "timed out"]]);
  // a task reviewed before the list existed: its one saved review, numbered by the review it was
  assert.deepEqual(S.reviewHistory({ reviewRound: 2, review: { score: 4, recommend: true, text: "Fine.", stale: true } }).map((e) => [e.round, e.score, e.text]), [[2, 4, "Fine."]]);
  // a review judged by the gate is kept with what it found and how it came out; one from before keeps its score
  const mixed = { reviewRound: 1, review: { score: 4, recommend: true, text: "Old.", at: 5, stale: true } };
  S.keepSavedReview(mixed); mixed.reviewRound = 2;
  S.logReview(mixed, { meets: true, gate: "major", pass: true, left: 1, text: "New.", findings: [{ id: "F1", severity: "minor", subject: "A nit", where: "a.js", proof: "", preexisting: false }], checks: ["ran it"], limitations: [], head: "abc1234", artifacts: [{ file: "x.png" }] });
  assert.deepEqual(S.reviewHistory(mixed).map((e) => [e.round, e.score ?? null, e.pass ?? null, e.gate ?? null, e.left ?? null, (e.findings || e.problems).length, e.text]), [[1, 4, null, null, null, 0, "Old."], [2, null, true, "major", 1, 1, "New."]]);
  assert.equal("artifacts" in S.reviewHistory(mixed)[1], false); assert.equal("score" in S.reviewHistory(mixed)[1], false);
  assert.deepEqual(S.reviewHistory({ reviewRound: 1, review: { meets: false, gate: "major", pass: false, text: "No.", findings: [] } }).map((e) => [e.round, e.pass, e.text]), [[1, false, "No."]]);
  assert.deepEqual(S.reviewHistory({}), []); assert.deepEqual(S.reviewHistory(null), []);
});
