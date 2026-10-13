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
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { stripVTControlCharacters } from "node:util";

import fs from "node:fs";
import os from "node:os";
// Whether there is a Watcher is your setting (`watcher.agent`, or `none`): a test with no board of its own says which.
const own = fs.mkdtempSync(path.join(os.tmpdir(), "sw-status-"));
const watcher = (agent) => { process.env.HERDR_SUPERWORK_CONFIG_DIR = own; fs.writeFileSync(path.join(own, "config.json"), JSON.stringify({ "watcher.agent": agent })); };
const off = (fn) => { watcher("none"); try { return fn(); } finally { watcher("claude"); } };
const min = 60000, t0 = 1e12;
const task = { id: "p/1", owner: "me", app: "claude", link: { pane: "w1:p1" }, stage: "working", since: t0, workAt: t0 };
const said = (t, mins, live = { status: "working" }) => show(t, live, t0 + mins * min).msg;

test("first run: a task whose agent has just started says so until the Watcher's first sentence, and then says that", () => {
  watcher("claude");
  assert.equal(said(task, 0), "Just started"); assert.equal(said(task, 1), "Just started");
  assert.equal(said({ ...task, watch: { msg: "Reading the code", progress: 10, role: "agent", at: t0 + min } }, 2), "Reading the code");
  // Still no sentence long after it began (the Watcher's calls fail): no longer "just", and still words.
  assert.equal(said(task, JUST_MS / min), "No status yet");
  // With the Watcher off none will come: the plain word, which a row leaves out since its heading says it.
  assert.equal(off(() => said(task, 0)), "Working");
  assert.equal(off(() => show(task, { status: "working" }, t0).plain), true);
  // The reviewer is a new agent every round: its round says it has just started, never the round before's words.
  const review = { ...task, stage: "reviewing", msg: "Under review", reviewAt: t0, lastLine: { msg: "Running the check", at: t0 - min } };
  assert.equal(said(review, 0), "Review just started"); assert.equal(said({ ...review, watch: { msg: "Reading the diff", progress: 5, role: "reviewer" } }, 0), "Reading the diff");
});

test("working again: the last sentence stays, said with its age, until a new one arrives", () => {
  watcher("claude");
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
  assert.equal(said({ ...again, msg: "Resolving a conflict with main" }, 0), "Resolving a conflict with main");
});

test("no bare … as a status line: the list, the panel, the whole-task page and herdr's sidebar say the words", async () => {
  const w = await world({ settings: { "review.when": "never", "watcher.agent": "claude" } });
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
    assert.equal(row().msg, "Just started"); assert.ok(d.side.some((l) => l.startsWith("      Just started")), "the list");
    for (const k of ["side", "page"]) { assert.ok(d[k].some((l) => /Now\s+Just started/.test(l)), k); assert.ok(!bare(d[k]), k); }
    // The Watcher's first look: until its answer herdr's sidebar gets the same words, and no percent.
    look();
    assert.ok(w.state().metadata.some((m) => m.args.join(" ").includes("summary=Just started") && m.args.join(" ").includes("--clear-token progress")));
    assert.ok(drawn().side.some((l) => l.startsWith("      editing the greeting file")));
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
    assert.ok(d.side.some((l) => l.startsWith("      5m ago: editing the greeting file")), "the list");
    for (const k of ["side", "page"]) { assert.ok(d[k].some((l) => /Now\s+5m ago: editing/.test(l)), k); assert.ok(!bare(d[k]), k); }
    look();
    assert.ok(w.state().metadata.some((m) => m.args.join(" ").includes("summary=5m ago: editing the greeting file")));
    assert.ok(S.get("proj/1").watch); // the new sentence takes its place
    assert.ok(drawn().side.some((l) => l.startsWith("      editing the greeting file")));
  } finally { delete process.env.HERDR_SUPERWORK_HELPER_CMD; w.cleanup(); }
});

test("what the Watcher or an agent wrote is on the row exactly as written, whatever it says; only the board's own plain word is left out", () => {
  watcher("claude");
  const v = Object.create(View.prototype); v.theme = theme; v.scope = ""; v.screens = new Map(); v.repo = { root: "/nowhere", name: "proj" };
  const rowOf = (t, live) => { const sh = show(t, live, t0); return stripVTControlCharacters(v.rowLines({ ...t, state: sh.state, kind: sh.kind, msg: sh.msg, plain: sh.plain, at: t0 }, 120).join("\n")); };
  for (const msg of ["Working", "WORKING", "Under review", "Needs you", "Idle"]) {
    assert.match(rowOf({ ...task, watch: { msg, progress: 10, role: "agent", at: t0 } }, { status: "working" }), new RegExp(`\\n {3}${msg} *$`), msg);
    assert.match(rowOf({ ...task, msg }, { status: "working" }), new RegExp(`\\n {3}${msg} *$`), `${msg}, reported`);
  }
  assert.match(rowOf({ ...task, stage: "reviewing", reviewAt: t0, watch: { msg: "Under review", progress: 10, role: "reviewer", at: t0 } }, { status: "working" }), /\n {3}Under review *$/);
  // The board's own plain words: said by the heading already, so the row leaves them out.
  assert.doesNotMatch(off(() => rowOf(task, { status: "working" })), /Working/);
  assert.doesNotMatch(off(() => rowOf({ ...task, stage: "reviewing", msg: "Under review", reviewAt: t0 }, { status: "working" })), /Under review/);
  assert.doesNotMatch(rowOf(task, { status: "blocked" }), /Needs you/);
});
