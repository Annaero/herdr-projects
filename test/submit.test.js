// Text handed to an agent is really submitted: nothing is typed before a slow-starting program has drawn its screen,
// an enter that was lost is pressed again (the text is never typed twice), and an agent that still does not start is
// shown as not started, with retry sending the same text again. For task agents, the reviewer and the Coordinator.
import test from "node:test";
import assert from "node:assert/strict";
import { world, settle, stateOf, paneOf } from "./helpers.js";
import { coordWorld } from "./coordinator-helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as C from "../src/coordinator.js";
import { housekeeping } from "../src/housekeeping.js";
import { spawnRunner } from "../src/runner.js";
import { drainJobs } from "../src/runner.js";
import { runJob } from "../src/jobs.js";
import { name as keyName } from "../src/board/keys.js";
import fs from "node:fs";
import path from "node:path";
import * as F from "../src/flow.js";
import { drawn, took, markOf, shown, tookAfterAll, TRIES, NOT_STARTED } from "../src/submit.js";

// The code's waits, for one test: how long a start is waited for, and how long an agent gets before enter is pressed again.
function waits(t, { ready, submit }) {
  const keys = { HERDR_SUPERWORK_READY_MS: ready, HERDR_SUPERWORK_SUBMIT_MS: submit }, before = { ...process.env };
  for (const [k, v] of Object.entries(keys)) { if (v === undefined) delete process.env[k]; else process.env[k] = String(v); }
  t.after(() => { for (const k of Object.keys(keys)) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } });
}
const calls = (w, re) => w.state().calls.filter((c) => re.test(c));
const pass = (w) => housekeeping(w.socket, { force: true });

test("what tells a program that has not drawn yet from one that has, and an agent that started from one that sits there", () => {
  const launch = `claude --session-id abc --settings /tmp/data/tasks/repo/1/hook-agent.json --append-system-prompt-file "/tmp/data/tasks/repo/1/rules.md"`;
  // The shell's echo of the command, wrapped by the terminal and quoted its own way: still only the command.
  assert.equal(drawn(`user@host:~/repo$ claude --session-id abc --settings /tmp/data/tasks/repo/1/hook-agen\nt.json --append-system-prompt-file '/tmp/data/tasks/repo/\n1/rules.md'\n\n`, launch), false);
  assert.equal(drawn(`user@host:~/repo$ ${launch}\n ▐▛███▜▌ Claude Code\n❯ \n`, launch), true);
  assert.equal(drawn("", launch), true); // nothing to compare: never held up
  const before = { agent_status: "idle", state_change_seq: 44, terminal_id: "t1" }, mark = markOf(before);
  assert.equal(took(mark, before), false); // exactly as before: the text sits in its box
  assert.equal(took(mark, { ...before, agent_status: "done" }), false);
  assert.equal(took(mark, { ...before, agent_status: "working" }), true);
  assert.equal(took(mark, { ...before, agent_status: "done", state_change_seq: 46, completion_seq: 46 }), true); // a turn too short to be seen working
  assert.equal(took(mark, before, true), true); // the words stand in its saved conversation
  assert.equal(took(mark, { ...before, agent_status: "unknown" }), false); // herdr cannot classify it: its counters still say it did not move
  assert.equal(took(markOf({ ...before, agent_status: "working" }), { ...before, agent_status: "working" }), null); // typed into a running turn: its working says nothing
  assert.equal(took(mark, { ...before, terminal_id: "t2" }), null);
  assert.equal(took(mark, null), null);
});

test("a slow-starting agent: nothing is typed until it has drawn its screen, so the first enter is not swallowed", async (t) => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    waits(t, { ready: 60000, submit: 3000 });
    w.patchState((st) => { st.slowStart = 4; }); // herdr says "ready" four looks before anything is on its screen
    const id = A.add(w.root, "Slow start").id;
    A.delegate(id);
    await settle(id);
    const order = calls(w, /^(pane read|agent prompt|agent send-keys)/).map((c) => c.split(" ").slice(0, 2).join(" "));
    assert.ok(order.indexOf("agent prompt") >= 5, `looked at its screen until it was drawn, then typed: ${order}`);
    assert.equal(calls(w, /^agent prompt/).length, 1);
    assert.equal(calls(w, /^agent send-keys/).length, 0); // no enter had to be pressed again
    assert.match(calls(w, /^agent prompt/)[0], /Slow start/);
    assert.ok(!S.get(id).sent && S.get(id).stage !== "failed");
  } finally { w.cleanup(); }
});

test("a first enter swallowed by a starting agent is pressed again; the text is never typed twice", async (t) => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    waits(t, { ready: 0, submit: 3000 }); // the wait for its screen gave up: the text goes in while it still starts
    w.patchState((st) => { st.slowStart = 99; });
    const id = A.add(w.root, "Swallowed").id;
    A.delegate(id);
    await drainJobs(runJob);
    let p = paneOf(w, S.get(id));
    assert.match(p.agent.box, /Swallowed/); assert.equal(p.agent.prompts, undefined); assert.equal(p.agent.status, "idle"); // typed, not submitted
    // Moments after: too early to say, and the board does not call it work.
    pass(w);
    assert.equal(calls(w, /^agent send-keys/).length, 0);
    assert.deepEqual([stateOf(id).state, stateOf(id).note], ["working", "Starting"]);
    // A while later it still sits at its prompt: enter, and only enter.
    S.update(id, (c) => { c.sent.at -= 5000; });
    pass(w);
    assert.deepEqual(calls(w, /^agent send-keys/).map((c) => c.split(" ").pop()), ["enter"]);
    p = paneOf(w, S.get(id));
    assert.equal(p.agent.prompts.length, 1); assert.match(p.agent.prompts[0], /Swallowed/); assert.equal(p.agent.box, null);
    const done = await settle(id);
    pass(w);
    assert.equal(calls(w, /^agent prompt/).length, 1);
    assert.equal(calls(w, /^agent send-keys/).length, 1); // started: nothing is pressed again
    assert.ok(!S.get(id).sent); assert.notEqual(done.stage, "failed");
  } finally { w.cleanup(); }
});

test("an agent that never starts is shown as not started, not as working; retry starts its program again with the same text", async (t) => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    waits(t, { ready: 0, submit: 0 });
    w.patchState((st) => { st.slowStart = 99; st.deaf = 99; st.pids = true; }); // it keeps the text and takes no enter at all
    const id = A.add(w.root, "Never starts").id;
    A.delegate(id);
    await drainJobs(runJob);
    const typed = paneOf(w, S.get(id)).agent.box;
    assert.deepEqual([S.get(id).stage, stateOf(id).note], ["working", "Has not started yet: pressing enter again"]); // the job's own pass pressed once
    for (let i = 0; i < TRIES + 2; i++) pass(w);
    let c = S.get(id), row = stateOf(id);
    assert.equal(calls(w, /^agent send-keys .* enter$/).length, TRIES); // a few tries, then no more
    assert.equal(calls(w, /^agent prompt/).length, 1);
    assert.deepEqual([c.stage, row.state, row.note], ["failed", "error", NOT_STARTED]);
    assert.equal(c.failure.title, "The agent has not started on its instructions"); assert.ok(c.failure.next.startsWith(`Retry (${keyName("yes")}) starts the agent's program again`));
    assert.equal(c.failure.agentCanFix, false); assert.equal(c.unsent.text, typed);
    // Retry: the stuck program is ended (its box may still hold the text) and a new one gets the same words, once.
    w.patchState((st) => { st.slowStart = 0; st.deaf = 0; });
    assert.match(A.sendError(id).msg, /starting the agent again with the same text/); // `herdr-superwork retry` and the board's key
    await settle(id);
    c = S.get(id);
    const prompts = calls(w, /^agent prompt/);
    assert.equal(calls(w, /^agent start/).length, 2);
    assert.equal(prompts.length, 2); assert.equal(prompts[1], prompts[0]); // the same words into the same pane, once more
    assert.ok(!c.unsent && !c.sent && c.failure?.stage !== "send"); assert.notEqual(c.stage, "failed");
  } finally { w.cleanup(); }
});

test("a later message whose enter is lost gets it again too; told not started, pressing enter yourself clears it", async (t) => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    waits(t, { ready: 60000, submit: 0 });
    w.script({ worker: [{ status: "idle", note: null }, { status: "working" }, { status: "working" }] });
    const id = A.add(w.root, "Later").id;
    A.delegate(id);
    await settle(id);
    w.patchState((st) => { st.swallow = 1; });
    A.tell(id, "one more thing");
    assert.match(paneOf(w, S.get(id)).agent.box, /one more thing/); assert.ok(S.get(id).sent);
    pass(w);
    let p = paneOf(w, S.get(id));
    assert.equal(p.agent.prompts.filter((x) => /one more thing/.test(x)).length, 1); assert.equal(p.agent.status, "working");
    pass(w);
    assert.equal(calls(w, /^agent send-keys .* enter$/).length, 1); assert.ok(!S.get(id).sent);
    // The same for a message nothing gets through: not started, until you press enter in its terminal yourself.
    w.patchState((st) => { st.swallow = 1; st.deaf = 99; st.panes.find((x) => x.agent).agent.status = "idle"; });
    A.tell(id, "and another");
    for (let i = 0; i <= TRIES + 1; i++) pass(w);
    assert.equal(S.get(id).stage, "failed"); assert.equal(stateOf(id).note, NOT_STARTED);
    w.patchState((st) => { st.deaf = 0; });
    herdrKeys(w, S.get(id).link.pane);
    await settle(id);
    p = paneOf(w, S.get(id));
    assert.equal(p.agent.prompts.filter((x) => /and another/.test(x)).length, 1);
    assert.deepEqual([S.get(id).stage, S.get(id).unsent, S.get(id).failure], ["working", null, null]);
  } finally { w.cleanup(); }
});
// You, pressing enter in the agent's own terminal.
function herdrKeys(w, pane) { globalThis.__swHerdr.run(["agent", "send-keys", pane, "enter"], process.env); }

test("the reviewer's brief and the Coordinator's messages are held to the same: enter again, never the words again", async (t) => {
  waits(t, { ready: 0, submit: 0 });
  const w = await world({ settings: { "reviewer.agent": "codex" } });
  try {
    w.patchState((st) => { st.slowStart = 99; }); // every program started here swallows its first enter
    w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }] });
    const id = A.add(w.root, "Reviewed").id;
    A.delegate(id);
    await drainJobs(runJob);
    pass(w); // the worker's own enter
    const done = await settle(id);
    assert.equal(done.stage, "approval", JSON.stringify(done.failure));
    const rpane = calls(w, /^agent start \S+-r /)[0].split(" ")[6];
    assert.equal(calls(w, /^agent prompt /).filter((c) => c.split(" ")[2] === rpane).length, 1);
    assert.deepEqual(calls(w, /^agent send-keys /).filter((c) => c.split(" ")[2] === rpane).map((c) => c.split(" ").pop()), ["enter"]);
  } finally { w.cleanup(); }
  const cw = await coordWorld();
  try {
    cw.patchState((st) => { st.slowStart = 99; });
    C.send(cw.root, "first"); await drainJobs(runJob);
    assert.deepEqual(cw.agents()[0].agent.prompts.map((p) => p.split("\n").pop()), ["first"]);
    assert.deepEqual(cw.agents()[0].agent.keys, ["enter"]); assert.ok(!C.get().error);
    // Words that stay in its box whatever is pressed: said so, taken off the list, and not typed again.
    cw.patchState((st) => { st.swallow = 1; st.deaf = 99; const a = st.panes.find((x) => x.agent).agent; a.status = "idle"; });
    C.send(cw.root, "second"); await drainJobs(runJob);
    assert.match(C.get().error, /sits unsent in its box/); assert.equal(C.get().queue.length, 0);
    assert.equal(calls(cw, /^agent prompt/).length, 2);
  } finally { cw.cleanup(); }
});

test("two messages left in the same box are both handed over again on retry", async (t) => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    waits(t, { ready: 60000, submit: 0 });
    w.script({ worker: [{ status: "idle", note: null }, { status: "working" }] });
    const id = A.add(w.root, "Two unsent").id;
    A.delegate(id);
    await settle(id);
    w.patchState((st) => { st.swallow = 2; st.deaf = 99; st.pids = true; });
    A.tell(id, "FIRST UNSENT MESSAGE");
    A.tell(id, "SECOND UNSENT MESSAGE"); // typed on top of the first: one box, one message now
    assert.match(S.get(id).sent.text, /FIRST UNSENT MESSAGE[^]*SECOND UNSENT MESSAGE/);
    for (let i = 0; i <= TRIES + 1; i++) pass(w);
    assert.equal(S.get(id).stage, "failed");
    assert.match(S.get(id).unsent.text, /FIRST UNSENT MESSAGE[^]*SECOND UNSENT MESSAGE/);
    // Told not started, you say a third thing: it joins the two in the box, and none is forgotten.
    w.patchState((st) => { st.swallow = 1; });
    A.tell(id, "THIRD");
    for (let i = 0; i <= TRIES + 1; i++) pass(w);
    assert.match(S.get(id).unsent.text, /FIRST UNSENT MESSAGE[^]*SECOND UNSENT MESSAGE[^]*THIRD/);
    w.patchState((st) => { st.deaf = 0; });
    A.retry(id);
    await settle(id);
    const again = paneOf(w, S.get(id)).agent.prompts;
    assert.equal(again.length, 1); assert.match(again[0], /FIRST UNSENT MESSAGE[^]*SECOND UNSENT MESSAGE[^]*THIRD/);
  } finally { w.cleanup(); }
});

test("a message typed into a running turn is not taken for sent because the agent works: once it rests with the text unsent, enter", async (t) => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    waits(t, { ready: 60000, submit: 0 });
    w.script({ worker: [{ status: "working" }, { status: "working" }, { status: "working" }] });
    const id = A.add(w.root, "Busy").id;
    A.delegate(id);
    await settle(id);
    assert.equal(paneOf(w, S.get(id)).agent.status, "working");
    w.patchState((st) => { st.swallow = 1; });
    A.tell(id, "while you work");
    for (let i = 0; i < 3; i++) pass(w);
    assert.ok(S.get(id).sent?.busy, "its working says nothing about the new text"); assert.equal(calls(w, /^agent send-keys .* enter$/).length, 0);
    // Its turn really ends (herdr counts it) and it sits at its prompt, the text still in its box: the finish line
    // does not take that turn for the answer and drop the look; enter is pressed.
    const rests = () => w.patchState((st) => { const a = st.panes.find((x) => x.agent).agent; st.seq += 1; a.status = "idle"; a.seq = st.seq; a.completion = st.seq; });
    rests();
    for (let i = 0; i < 4; i++) { pass(w); await settle(id); }
    let p = paneOf(w, S.get(id));
    assert.equal(calls(w, /^agent send-keys .* enter$/).length, 1);
    assert.equal(p.agent.box, null); assert.equal(p.agent.prompts.filter((x) => /while you work/.test(x)).length, 1);
    assert.deepEqual([S.get(id).stage, S.get(id).sent, p.agent.status], ["working", null, "working"]);
    // The same with every enter refused: once the old turn has ended, that turn is not finished in the message's
    // place. The task says not started and stays so, and retry hands the message over.
    w.patchState((st) => { st.swallow = 1; st.deaf = 99; st.pids = true; });
    A.tell(id, "REFUSED WHILE BUSY");
    rests();
    for (let i = 0; i < TRIES + 3; i++) { pass(w); await settle(id); }
    assert.deepEqual([S.get(id).stage, stateOf(id).note, S.get(id).sent], ["failed", NOT_STARTED, null]);
    assert.match(S.get(id).unsent.text, /REFUSED WHILE BUSY/); assert.match(paneOf(w, S.get(id)).agent.box, /REFUSED WHILE BUSY/);
    w.patchState((st) => { st.deaf = 0; });
    A.retry(id);
    await settle(id);
    assert.equal(calls(w, /^agent start/).length, 2);
    assert.equal(paneOf(w, S.get(id)).agent.prompts.filter((x) => /REFUSED WHILE BUSY/.test(x)).length, 1); // handed to the new program, once
    assert.ok(!S.get(id).unsent && S.get(id).failure?.stage !== "send");
  } finally { w.cleanup(); }
});

// What Claude Code writes when it takes, in the middle of a turn, a message that was typed while it worked: not a
// user entry but an attachment (seen on claude 2.1.296, task 175). Then more than a megabyte of the turn's own work follows (3.5 MB on that task).
function tookMidTurn(w, id, text, { after = 1200 * 1024 } = {}) {
  const file = path.join(w.base, `conversation-${S.get(id).n}.jsonl`), at = () => new Date().toISOString();
  const work = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "x".repeat(64 * 1024) }] }, timestamp: at() });
  fs.writeFileSync(file, [
    JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: at(), content: text }),
    JSON.stringify({ type: "queue-operation", operation: "remove", timestamp: at(), content: text }),
    JSON.stringify({ type: "attachment", attachment: { type: "queued_command", prompt: text }, timestamp: at() }),
    ...Array.from({ length: Math.ceil(after / work.length) }, () => work),
    JSON.stringify({ type: "assistant", message: { id: "msg_done", role: "assistant", content: [{ type: "text", text: "All of it is done." }], stop_reason: "end_turn" }, timestamp: at() }),
  ].join("\n") + "\n");
  S.update(id, (t) => { t.transcript = file; });
  w.patchState((st) => { st.panes.find((x) => x.agent).agent.box = null; }); // the program took it out of its box
}

test("a message the agent took in the middle of a long turn is delivered: more than a megabyte of work later the task is not 'not started', and no enter is pressed", async (t) => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    waits(t, { ready: 60000, submit: 0 });
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Long turn").id;
    A.delegate(id);
    await settle(id);
    w.patchState((st) => { st.swallow = 1; }); // herdr's counters do not move for a message a busy program queues
    A.tell(id, "ONE MORE THING while you are at it");
    pass(w);
    assert.ok(S.get(id).sent?.busy);
    tookMidTurn(w, id, S.get(id).sent.text);
    // Counted as delivered the moment the agent takes it, while it still works.
    for (let i = 0; i < 2; i++) pass(w);
    assert.deepEqual([S.get(id).stage, S.get(id).sent], ["working", null]);
    // Its turn ends, far later in its conversation than the board reads for an ending: that turn is the answer.
    fs.mkdirSync(path.dirname(F.noteFile(S.get(id))), { recursive: true }); fs.writeFileSync(F.noteFile(S.get(id)), "All of it is done.");
    w.patchState((st) => { const a = st.panes.find((x) => x.agent).agent; st.seq += 1; a.status = "idle"; a.seq = st.seq; a.completion = st.seq; });
    for (let i = 0; i < TRIES + 3; i++) { pass(w); await settle(id); }
    const c = S.get(id);
    assert.notEqual(stateOf(id).note, NOT_STARTED); assert.ok(!c.unsent && c.failure?.stage !== "send", JSON.stringify(c.failure));
    assert.equal(calls(w, /^agent send-keys .* enter$/).length, 0); assert.equal(calls(w, /^agent start/).length, 1);
    assert.equal(c.stage, "done", c.msg);
  } finally { w.cleanup(); }
});

test("a message taken mid-turn and found only when the agent rests (the board was closed meanwhile) is still delivered; one that is only queued is not", async (t) => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    waits(t, { ready: 60000, submit: 0 });
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Long turn, board closed").id;
    A.delegate(id);
    await settle(id);
    w.patchState((st) => { st.swallow = 1; });
    A.tell(id, "SAID WITH NOBODY LOOKING");
    const text = S.get(id).sent.text, file = path.join(w.base, "queued.jsonl");
    // Only queued so far: the program has the words, but has not read them. That is not delivered.
    fs.writeFileSync(file, JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: new Date().toISOString(), content: text }) + "\n");
    assert.equal(shown("claude", { file }, S.get(id).sent, text), false);
    tookMidTurn(w, id, text);
    assert.equal(shown("claude", { file: S.get(id).transcript }, S.get(id).sent, text), true); // more than a megabyte back from the end, past what one look at an ending reads
    fs.mkdirSync(path.dirname(F.noteFile(S.get(id))), { recursive: true }); fs.writeFileSync(F.noteFile(S.get(id)), "Done, with the addition.");
    w.patchState((st) => { const a = st.panes.find((x) => x.agent).agent; st.seq += 1; a.status = "idle"; a.seq = st.seq; a.completion = st.seq; });
    for (let i = 0; i < TRIES + 3; i++) { pass(w); await settle(id); }
    assert.equal(S.get(id).stage, "done", S.get(id).msg); assert.equal(calls(w, /^agent send-keys .* enter$/).length, 0);
  } finally { w.cleanup(); }
});

test("retry on 'not started' never restarts a session that is alive and took the text: the error goes, the same program stays", async (t) => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    waits(t, { ready: 60000, submit: 0 });
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Wrongly not started").id;
    A.delegate(id);
    await settle(id);
    // As an older board left it: the text was taken, the turn's work is done and saved, and the task says not started.
    w.patchState((st) => { st.swallow = 1; });
    A.tell(id, "TAKEN ALL ALONG");
    const text = S.get(id).sent.text;
    tookMidTurn(w, id, text);
    fs.mkdirSync(path.dirname(F.noteFile(S.get(id))), { recursive: true }); fs.writeFileSync(F.noteFile(S.get(id)), "Done long ago.");
    w.patchState((st) => { const a = st.panes.find((x) => x.agent).agent; st.seq += 1; a.status = "idle"; a.seq = st.seq; a.completion = st.seq; });
    // The record is an older board's: it holds the moment the agent came to rest, a minute after it took the words.
    S.update(id, (c) => { c.unsent = { text, first: false, at: Date.now() + 60000 }; c.sent = null; c.stage = "failed"; c.msg = NOT_STARTED; Object.assign(c, S.failurePatch({ stage: "send", title: "The agent has not started on its instructions", detail: "", next: "" })); });
    const pid = paneOf(w, S.get(id)).agent.pid, quits = calls(w, /^pane quit/).length;
    assert.match(A.retry(id).msg, /its agent had taken the text/);
    assert.deepEqual([S.get(id).stage, S.get(id).unsent, S.get(id).failure], ["working", null, null]);
    assert.equal(globalThis.__swJobs.length, 0, "no restart was asked for");
    assert.equal(paneOf(w, S.get(id)).agent.pid, pid); assert.equal(calls(w, /^pane quit/).length, quits);
    await settle(id);
    assert.equal(calls(w, /^agent start/).length, 1); // the one program, start to end
    assert.equal(S.get(id).stage, "done", S.get(id).msg);
    // What this board writes down is when the text was typed: only words standing since then count, and words the
    // program never took still get it started again.
    assert.equal(tookAfterAll({ agent: "claude", transcript: S.get(id).transcript, unsent: { text, at: Date.now() + 60000, typed: true } }), false);
    assert.equal(tookAfterAll({ agent: "claude", transcript: S.get(id).transcript, unsent: { text, at: Date.now() - 60000, typed: true } }), true);
    assert.equal(tookAfterAll({ agent: "claude", transcript: S.get(id).transcript, startedAgentAt: 1, unsent: { text: "NEVER SAID TO IT AT ALL", at: Date.now() } }), false);
  } finally { w.cleanup(); }
});

test("the Coordinator: words typed into a turn it was in the middle of get their enter once it rests", async (t) => {
  waits(t, { ready: 60000, submit: 0 });
  const w = await coordWorld();
  try {
    w.script({ coordinator: [{ status: "working" }, { status: "working" }] });
    C.send(w.root, "first"); await drainJobs(runJob);
    assert.equal(w.agents()[0].agent.status, "working");
    w.patchState((st) => { st.swallow = 1; });
    C.send(w.root, "BUSY MESSAGE"); await drainJobs(runJob);
    assert.match(w.agents()[0].agent.box, /BUSY MESSAGE/); assert.ok(C.get().typed?.busy);
    for (let i = 0; i < 3; i++) C.tick();
    assert.equal(w.agents()[0].agent.keys, undefined); // it works: nothing says yet whether the words went in
    w.patchState((st) => { const a = st.panes.find((x) => x.agent).agent; st.seq += 1; a.status = "idle"; a.seq = st.seq; a.completion = st.seq; });
    for (let i = 0; i < 4; i++) C.tick();
    const a = w.agents()[0].agent;
    assert.deepEqual(a.keys, ["enter"]); assert.equal(a.box, null); assert.deepEqual(a.prompts.map((p) => p.split("\n").pop()), ["first", "BUSY MESSAGE"]);
    assert.ok(!C.get().typed && !C.get().error);
  } finally { w.cleanup(); }
});

test("an agent herdr cannot classify (status unknown) is checked like any other: enter again, then not started with the text kept", async (t) => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    waits(t, { ready: 60000, submit: 0 });
    w.script({ worker: [{ status: "unknown", note: null }, { status: "working" }] });
    const id = A.add(w.root, "Unknown").id;
    A.delegate(id);
    await settle(id);
    assert.equal(paneOf(w, S.get(id)).agent.status, "unknown");
    w.patchState((st) => { st.swallow = 1; });
    A.tell(id, "FOLLOW UP");
    assert.ok(S.get(id).sent);
    for (let i = 0; i < 2; i++) { pass(w); await settle(id); }
    let p = paneOf(w, S.get(id));
    assert.equal(calls(w, /^agent send-keys .* enter$/).length, 1);
    assert.equal(p.agent.prompts.filter((x) => /FOLLOW UP/.test(x)).length, 1); assert.equal(p.agent.box, null); assert.ok(!S.get(id).sent);
    // And when no enter gets through: not started, with the text for retry.
    w.patchState((st) => { st.swallow = 1; st.deaf = 99; const a = st.panes.find((x) => x.agent).agent; a.status = "unknown"; });
    A.tell(id, "NEVER TAKEN");
    for (let i = 0; i < TRIES + 3; i++) { pass(w); await settle(id); }
    assert.deepEqual([S.get(id).stage, stateOf(id).note], ["failed", NOT_STARTED]); assert.match(S.get(id).unsent.text, /NEVER TAKEN/);
  } finally { w.cleanup(); }
});

test("an agent that exits with typed text not taken: not started with the text kept, and a late report of its old turn finishes nothing", async (t) => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    waits(t, { ready: 60000, submit: 0 });
    w.script({ worker: [{ status: "working" }, { status: "working" }, { status: "working" }] });
    const id = A.add(w.root, "Exits").id;
    A.delegate(id);
    await settle(id);
    // Its own report that a turn ended, as its hook leaves it: arriving late, after everything below.
    const report = async () => { S.update(id, (c) => { c.eventSeq = (c.eventSeq || 0) + 1; c.events = [...S.pendingEvents(c), { at: Date.now(), role: "agent", round: 0, session: c.session || "", file: "", error: "", side: false, n: c.eventSeq }]; }); spawnRunner("finish", id); await drainJobs(runJob); };
    const exits = () => w.patchState((st) => { for (const p of st.panes) p.agent = null; });
    // Told not started (every enter refused), then its program exits, then the old turn's report comes in.
    w.patchState((st) => { st.swallow = 1; st.deaf = 99; });
    A.tell(id, "LEFT IN THE BOX");
    w.patchState((st) => { const a = st.panes.find((x) => x.agent).agent; st.seq += 1; a.status = "idle"; a.seq = st.seq; a.completion = st.seq; });
    for (let i = 0; i < TRIES + 3; i++) { pass(w); await settle(id); }
    assert.equal(S.get(id).stage, "failed");
    exits();
    await report();
    for (let i = 0; i < 3; i++) { pass(w); await settle(id); }
    assert.deepEqual([S.get(id).stage, stateOf(id).note], ["failed", NOT_STARTED]); assert.match(S.get(id).unsent.text, /LEFT IN THE BOX/);
    // Retry starts a program again and hands it the text; a message typed into that one, which then exits before
    // taking it, ends the same way without a single enter having been refused.
    w.patchState((st) => { st.deaf = 0; });
    A.retry(id);
    await settle(id);
    assert.equal(paneOf(w, S.get(id)).agent.prompts.filter((x) => /LEFT IN THE BOX/.test(x)).length, 1);
    w.patchState((st) => { st.swallow = 1; });
    A.tell(id, "GONE WITH IT");
    exits();
    await report();
    for (let i = 0; i < 3; i++) { pass(w); await settle(id); }
    assert.deepEqual([S.get(id).stage, stateOf(id).note], ["failed", NOT_STARTED]); assert.match(S.get(id).unsent.text, /GONE WITH IT/);
    assert.match(S.get(id).failure.detail, /program ended before it started on it/);
    A.retry(id);
    await settle(id);
    assert.equal(paneOf(w, S.get(id)).agent.prompts.filter((x) => /GONE WITH IT/.test(x)).length, 1);
  } finally { w.cleanup(); }
});
