// The Watcher's pace: how often it looks, what it skips, one call at a time, and giving way on a busy machine.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import * as H from "../src/helpers.js";
import * as P from "../src/watcher/pace.js";
import { readAnswer } from "../src/watcher/prompt.js";
import { AGENTS } from "../src/agents/kinds.js";

const SEC = 1000;
// A board with `n` agents at work, and a stand-in for the helper's program: every call is kept, and answered by hand.
async function watched(n, settings = {}) {
  const w = await world({ settings: { reviewer: "off", watcher: "on", max: 8, ...settings } });
  H.watcherReset();
  w.script({ worker: Array.from({ length: n }, () => ({ status: "working", screen: "● Reading the code\n" })) }); // one step for each agent's first prompt
  for (let i = 1; i <= n; i++) { A.add(w.root, `task ${i}`); A.delegate(`proj/${i}`); await settle(`proj/${i}`); }
  const calls = [];
  const run = (cmd, _opts, done) => { calls.push({ cmd, done, text: cmd.stdin || cmd.args.join(" ") }); return {}; };
  const t0 = Date.now();
  const tick = (sec, load = 0) => H.watchTick(F.board(), t0 + sec * SEC, { load, run });
  const answer = (call, list, code = 0, err = "") => call.done(code, typeof list === "string" ? list : JSON.stringify(list), err);
  const screen = (id, text) => w.patchState((st) => { st.panes.find((p) => p.pane_id === S.get(id).link.pane).agent.screen = text; });
  const status = (id, s) => w.patchState((st) => { st.panes.find((p) => p.pane_id === S.get(id).link.pane).agent.status = s; });
  return { w, calls, tick, answer, screen, status };
}
const all = (n, progress = 30) => Array.from({ length: n }, (_, i) => ({ n: i + 1, msg: `doing ${i + 1}`, progress }));

test("the watcher: one call covers every working agent, and only one runs at a time", async () => {
  const { w, calls, tick, answer, screen } = await watched(3);
  try {
    tick(0);
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /You are watching 3 agents at work/);
    assert.deepEqual([...calls[0].text.matchAll(/^Task: (.*)$/gm)].map((m) => m[1]).sort(), ["task 1", "task 2", "task 3"]);
    // Its answer has not come back: no second call, however long that takes.
    for (const id of ["proj/1", "proj/2", "proj/3"]) screen(id, "● Writing tests\n");
    tick(70); tick(200);
    assert.equal(calls.length, 1);
    answer(calls[0], all(3));
    assert.deepEqual(["proj/1", "proj/2", "proj/3"].map((id) => S.get(id).watch.msg).sort(), ["doing 1", "doing 2", "doing 3"]);
    // It is back and every look is overdue: the next call, again one for all three.
    tick(205); assert.equal(calls.length, 2);
    assert.match(calls[1].text, /You are watching 3 agents/); assert.match(calls[1].text, /Your previous guess was 30 percent/);
    answer(calls[1], all(3));
    // From then on a minute between looks, not less.
    for (const id of ["proj/1", "proj/2", "proj/3"]) screen(id, "● Writing docs\n");
    tick(240); assert.equal(calls.length, 2);
    tick(266); assert.equal(calls.length, 3);
  } finally { w.cleanup(); }
});

test("the watcher: a look only when something changed, and only at an agent that works", async () => {
  const { w, calls, tick, answer, screen, status } = await watched(2);
  try {
    screen("proj/1", "● Running the tests\n✻ Pondering… (12s · ↑ 1.2k tokens)\n");
    tick(0); answer(calls[0], all(2));
    // A minute on, the same words on both screens (only the spinner, its seconds and its token count moved): no call.
    screen("proj/1", "● Running the tests\n✽ Pondering… (1m 14s · ↑ 3.4k tokens)\n");
    tick(61); assert.equal(calls.length, 1);
    // One screen changes: a call for that agent alone.
    screen("proj/2", "● 3 tests failed\n");
    tick(122); assert.equal(calls.length, 2);
    assert.match(calls[1].text, /You are watching an agent at work/); assert.match(calls[1].text, /Task: task 2\n/); assert.doesNotMatch(calls[1].text, /Task: task 1\n/);
    answer(calls[1], '{"msg": "fixing three failing tests", "progress": 20}'); // one agent asked about: a bare object is its answer
    assert.deepEqual([S.get("proj/2").watch.msg, S.get("proj/2").watch.progress], ["fixing three failing tests", 20]);
    // An agent that stopped working (idle, waiting for you) is not looked at, whatever its screen says.
    status("proj/1", "blocked"); status("proj/2", "idle");
    screen("proj/1", "Do you want to proceed?\n"); screen("proj/2", "Done.\n");
    tick(300); assert.equal(calls.length, 2);
  } finally { w.cleanup(); }
});

test("the watcher: agents that start at different moments end up in one call", async () => {
  const { w, calls, tick, answer, screen } = await watched(2);
  try {
    S.setConfig("watcher", "off"); S.setTaskConfig("proj/1", "watcher", "on");
    tick(0); assert.match(calls[0].text, /Task: task 1\n/); assert.doesNotMatch(calls[0].text, /task 2/);
    answer(calls[0], all(1));
    // The second agent starts being watched 25 seconds later: its first look is due at once.
    S.setConfig("watcher", "on");
    tick(25); assert.match(calls[1].text, /Task: task 2\n/); assert.doesNotMatch(calls[1].text, /task 1/);
    answer(calls[1], all(1));
    // The first one's minute is up, the second is more than half-way to its own: the call holds off for it.
    screen("proj/1", "● Writing tests\n"); screen("proj/2", "● Writing docs\n");
    tick(61); assert.equal(calls.length, 2);
    // The second one's minute is up too: one call for both, nobody looked at before its minute. From here on they share.
    tick(86); assert.equal(calls.length, 3);
    assert.match(calls[2].text, /You are watching 2 agents/);
    assert.ok(calls[2].text.indexOf("Task: task 1") < calls[2].text.indexOf("Task: task 2")); // the longest wait first
  } finally { w.cleanup(); }
});

test("the watcher: one call at a time on the whole machine, and a reviewer only while it works", async () => {
  const { w, calls, tick, answer, status } = await watched(2);
  try {
    // Another process (a keeper beside an open board) has a call under way: this one waits its turn.
    const turn = path.join(S.dataDir(), "watcher-call.json");
    S.writeJson(turn, { pid: 1, at: Date.now() });
    tick(0); tick(20); assert.equal(calls.length, 0);
    S.writeJson(turn, { pid: 1, at: Date.now() - 60000 }); // a turn never given back, by a process that died: free again within a minute
    tick(40); assert.equal(calls.length, 1);
    assert.equal(S.readJson(turn).pid, process.pid);
    answer(calls[0], all(2)); assert.equal(fs.existsSync(turn), false);
    // Task 1 goes under review; the reviewer sits in a pane of its own (here: the second agent's).
    S.setTaskConfig("proj/2", "watcher", "off");
    S.update("proj/1", (t) => { t.stage = "reviewing"; t.reviewAt = Date.now(); t.link.reviewer = { pane: S.get("proj/2").link.pane }; });
    status("proj/2", "idle"); // a reviewer that is idle, waits for you or has finished is not looked at
    tick(60); tick(200); assert.equal(calls.length, 1);
    status("proj/2", "working");
    tick(210); assert.equal(calls.length, 2);
    assert.match(calls[1].text, /adversarial reviewer/); assert.match(calls[1].text, /This is your first look at it\./);
  } finally { w.cleanup(); }
});

test("the watcher: gives way on a busy machine, and after a call that failed", async () => {
  const { w, calls, tick, answer, screen } = await watched(1);
  try {
    tick(0); answer(calls[0], all(1));
    // Twice what the machine can do: five times less often.
    screen("proj/1", "● Writing tests\n");
    tick(120, 2); tick(290, 2); assert.equal(calls.length, 1);
    tick(301, 2); assert.equal(calls.length, 2);
    // No answer worth the name: the wait doubles with every failure in a row.
    answer(calls[1], "overloaded", 1);
    screen("proj/1", "● Writing docs\n");
    tick(400); assert.equal(calls.length, 2);
    tick(425); assert.equal(calls.length, 3);
    answer(calls[2], "", 1);
    tick(600); assert.equal(calls.length, 3);
    tick(670); assert.equal(calls.length, 4);
    answer(calls[3], all(1)); // an answer: the pace is the usual one again
    screen("proj/1", "● Committing\n");
    tick(731); assert.equal(calls.length, 5);
    assert.deepEqual([P.slowdown(0.2), P.slowdown(0.75), P.slowdown(1), P.slowdown(1.5), P.slowdown(4)], [1, 1, 2, 4, 5]);
    assert.deepEqual([0, 1, 2, 3, 9].map(P.afterFailures), [1, 2, 4, 8, 8]);
  } finally { w.cleanup(); }
});

test("the watcher: the pace is a setting, and herdr's sidebar keeps the minutes left between looks", async () => {
  const { w, calls, tick, answer, screen } = await watched(1, { watcherEvery: 120 });
  try {
    S.update("proj/1", (t) => { t.since = Date.now() - 30 * 60000; t.workAt = 0; });
    tick(0); answer(calls[0], all(1, 50));
    const told = () => w.state().metadata.filter((m) => m.args.join(" ").includes("summary=doing 1")).map((m) => /eta=(\d+)m/.exec(m.args.join(" "))?.[1]);
    assert.deepEqual(told(), ["30"]);
    screen("proj/1", "● Writing tests\n");
    tick(61); tick(119); assert.equal(calls.length, 1); // two minutes between looks, as set
    // No look, yet the sidebar is told again once a minute, with the minutes worked out afresh: 31 spent at 50%.
    assert.deepEqual(told(), ["30", "31"]);
    assert.equal(F.board().find((t) => t.id === "proj/1").eta, 30); // the board's own row counts by itself
    tick(125); assert.equal(calls.length, 2);
    assert.equal(S.config().watcherEvery, 120); assert.equal(S.DEFAULTS.watcherEvery, 60);
  } finally { w.cleanup(); }
});

test("the watcher: a light start of its program, and the plain one when the program is too old for it", async () => {
  const { w, calls, tick, answer } = await watched(1, { watcherModel: "small" });
  try {
    tick(0);
    assert.deepEqual(calls[0].cmd.args.filter((a) => ["--safe-mode", "--strict-mcp-config", "--disable-slash-commands", "--system-prompt"].includes(a)).length, 4);
    answer(calls[0], "", 1, "error: unknown option '--safe-mode'");
    tick(16); // not counted as a failure: tried again the plain way after the usual gap
    assert.equal(calls.length, 2);
    assert.ok(!calls[1].cmd.args.includes("--safe-mode")); assert.ok(calls[1].cmd.args.includes("--append-system-prompt"));
    assert.deepEqual(AGENTS.claude.oneShot({ model: "m", prompt: "p" }).args, ["-p", "--model", "m", "--no-session-persistence", "--tools", ""]);
  } finally { w.cleanup(); }
});

test("the watcher: which screens are the same, who rides in a call, and reading an answer", () => {
  assert.equal(P.wordsOf("✻ Pondering… (12s · ↑ 1.2k tokens)\n3 passed"), P.wordsOf("✽ Pondering… (1m 14s · ↑ 3.4k tokens)\n17 passed"));
  assert.notEqual(P.wordsOf("3 passed"), P.wordsOf("3 failed"));
  assert.equal(P.lastLines(Array.from({ length: 50 }, (_, i) => `line ${i}  `).join("\n\n")).split("\n").length, 30);
  const ids = (rows) => rows.map((r) => r.id);
  const at = (id, wait) => ({ id, at: 1000 - wait }), who = (...rows) => ids(P.riders(rows, 1000, 60));
  assert.deepEqual(who(at("a", 59), at("b", 40)), []); // nobody's minute is up
  assert.deepEqual(who(at("a", 70), at("b", 65), at("c", 10)), ["a", "b"]); // only those whose minute is up, the longest wait first
  assert.deepEqual(who(at("a", 60), at("b", 35)), []); // b is more than half-way: a waits for it
  assert.deepEqual(who(at("a", 90), at("b", 35)), ["a"]); // but not more than half as long again
  assert.deepEqual(ids(P.riders([{ id: "new", at: 0 }, at("b", 35)], 1000, 60)), ["new"]); // a first look does not wait
  assert.deepEqual([...readAnswer('Here: [{"n": 2, "msg": "b", "progress": 150}, {"n": 1, "msg": "a", "progress": "7"}, {"n": 9, "msg": "x"}, {"n": 2, "msg": "again"}]', 2)], [[2, { msg: "b", progress: 99 }], [1, { msg: "a", progress: 7 }]]);
  assert.equal(readAnswer("no json here", 2).size, 0); assert.equal(readAnswer('{"msg": "a", "progress": 1}', 2).size, 0);
});
