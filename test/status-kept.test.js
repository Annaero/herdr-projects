// A working task's line before the Watcher's first look of a run: the last sentence kept with its age, or "Just started", never a bare "…".
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { world, settle } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import * as H from "../src/helpers.js";
import { show } from "../src/state.js";
import { quietLine, JUST_MS } from "../src/status-kept.js";
import { asRow } from "../src/board/view/states.js";
import { here, open } from "./board-helpers.js";

const min = 60000, t0 = 1e12;
const task = { id: "p/1", owner: "me", app: "claude", link: { pane: "w1:p1" }, stage: "working", since: t0, workAt: t0 };
const said = (t, mins, live = { status: "working" }) => show(t, live, t0 + mins * min).msg;

test("first run: a task whose agent has just started says so until the Watcher's first sentence, and then says that", () => {
  assert.equal(said(task, 0), "Just started"); assert.equal(said(task, 1), "Just started");
  assert.equal(said({ ...task, watch: { msg: "Reading the code", progress: 10, role: "agent", at: t0 + min } }, 2), "Reading the code");
  // Still no sentence long after it began (the Watcher's calls fail): no longer "just", and still words.
  assert.equal(said(task, JUST_MS / min), "No status yet");
  // With the Watcher off none will come: the plain word, which a row leaves out since its heading says it.
  assert.equal(said({ ...task, own: { watcher: "off" } }, 0), "working");
  // The reviewer is a new agent every round: its round says it has just started, never the round before's words.
  const review = { ...task, stage: "reviewing", msg: "under review", reviewAt: t0, lastLine: { msg: "Running the check", at: t0 - min } };
  assert.equal(said(review, 0), "Review just started"); assert.equal(said({ ...review, watch: { msg: "Reading the diff", progress: 5, role: "reviewer" } }, 0), "Reading the diff");
});

test("working again: the last sentence stays, said with its age, until a new one arrives", () => {
  const kept = { lastLine: { msg: "Running the check", at: t0 - 12 * min } };
  // A new turn, sent back after a review, a conflict, a retry: each drops the guess (`watch`), none the kept sentence.
  const again = { ...task, watch: null, lastLine: kept.lastLine };
  assert.equal(said(again, 0), "12m ago: Running the check");
  // Its age is in the words, and grows: a kept sentence is never read as a fresh one.
  assert.equal(said(again, 5), "17m ago: Running the check"); assert.equal(quietLine(again, "agent", t0, t0 + 60 * min), "1h ago: Running the check");
  const next = show({ ...again, watch: { msg: "Fixing the review's findings", progress: 30, role: "agent", at: t0 + min } }, { status: "working" }, t0 + min);
  assert.deepEqual([next.msg, next.progress], ["Fixing the review's findings", 30]);
  // A guess left by the reviewer is not the agent's: the agent's own last sentence shows, with no percent of the reviewer's.
  const after = show({ ...again, watch: { msg: "Reading the diff", progress: 80, role: "reviewer" } }, { status: "working" }, t0);
  assert.deepEqual([after.msg, after.progress], ["12m ago: Running the check", 0]);
  // What the board itself has to say about the run comes first.
  assert.equal(said({ ...again, msg: "resolving a conflict with main" }, 0), "resolving a conflict with main");
});

test("no bare … as a status line: the list, the panel, the whole-task page and herdr's sidebar say the words", async () => {
  const w = await world({ settings: { reviewer: "off", watcher: "on" } });
  try {
    process.env.HERDR_SUPERWORK_HELPER_CMD = JSON.stringify(["node", path.join(here, "fake-helper.js")]);
    A.add(w.root, "build a login page");
    w.script({ worker: [{ status: "working", screen: "● Writing greet.sh\n" }] });
    A.delegate("proj/1"); await settle("proj/1");
    // The Watcher's model call, answered here: no program is started for it.
    const look = () => { H.watcherReset(); H.watchTick(F.board(), Date.now(), { load: 0, run: (cmd, o, done) => done(0, JSON.stringify([{ n: 1, msg: "editing the greeting file", progress: 42 }]), "") }); };
    const row = () => asRow(F.board().find((t) => t.id === "proj/1"));
    const s = open(w); s.v.sel = "proj/1";
    // The list with the panel beside it, then the whole-task page.
    const drawn = () => { s.v.full = false; s.v.load(); const side = s.screen(); s.v.full = true; const page = s.screen(); s.v.full = false; return { side, page }; };
    const bare = (lines) => lines.some((l) => /(^|[│\s]{2})…\s*($|│)/.test(l) || /Now\s+…\s*$/.test(l));
    // First run.
    let d = drawn();
    assert.equal(row().msg, "Just started"); assert.ok(d.side.some((l) => l.startsWith("   Just started")), "the list");
    for (const k of ["side", "page"]) { assert.ok(d[k].some((l) => /Now\s+Just started/.test(l)), k); assert.ok(!bare(d[k]), k); }
    // The Watcher's first look: until its answer herdr's sidebar gets the same words, and no percent.
    look();
    assert.ok(w.state().metadata.some((m) => m.args.join(" ").includes("summary=Just started") && m.args.join(" ").includes("--clear-token progress")));
    assert.ok(drawn().side.some((l) => l.startsWith("   editing the greeting file")));
    // Told to go on (a new turn): the guess goes, the sentence stays, with how old it is.
    // The task as an older version saved it: the guess only, no kept sentence. It is kept all the same.
    S.update("proj/1", (t) => { t.watch = { ...t.watch, at: Date.now() - 5 * min }; delete t.lastLine; });
    assert.equal(S.get("proj/1").lastLine, undefined);
    w.script({ worker: [{ status: "working", screen: "● Carrying on\n" }] });
    A.tell("proj/1", "also add a logout button"); await settle("proj/1");
    assert.equal(S.get("proj/1").watch, null); assert.equal(S.get("proj/1").lastLine.msg, "editing the greeting file");
    // A reviewer's guess is not the agent's sentence: it is never kept as one.
    S.update("proj/1", (t) => { t.watch = { msg: "Reading the diff", progress: 5, role: "reviewer", at: Date.now() }; }); S.update("proj/1", (t) => { t.watch = null; });
    assert.equal(S.get("proj/1").lastLine.msg, "editing the greeting file");
    d = drawn();
    assert.ok(d.side.some((l) => l.startsWith("   5m ago: editing the greeting file")), "the list");
    for (const k of ["side", "page"]) { assert.ok(d[k].some((l) => /Now\s+5m ago: editing/.test(l)), k); assert.ok(!bare(d[k]), k); }
    look();
    assert.ok(w.state().metadata.some((m) => m.args.join(" ").includes("summary=5m ago: editing the greeting file")));
    assert.ok(S.get("proj/1").watch); // the new sentence takes its place
    assert.ok(drawn().side.some((l) => l.startsWith("   editing the greeting file")));
  } finally { delete process.env.HERDR_SUPERWORK_HELPER_CMD; w.cleanup(); }
});
