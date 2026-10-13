// An agent that stopped to wait for the human is waiting, not finished: no check, no review, no merge follow.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, stateOf, paneOf, until } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as R from "../src/research.js";
import { onPane } from "../src/hook.js";
import { turnEnded } from "../src/turn.js";
import { rules } from "../src/delegate.js";
import { readClaude, readCodex, readPi } from "../src/agents/read-turn.js";

// The agent's saved conversation, written as Claude Code writes it: a prompt, and the message a turn ends on.
const line = (file, o) => fs.appendFileSync(file, JSON.stringify(o) + "\n");
const prompt = (file, at, text = "Go on.") => line(file, { type: "user", uuid: `u${at}`, timestamp: new Date(at).toISOString(), message: { role: "user", content: text } });
const says = (file, at, text) => line(file, { type: "assistant", uuid: `a${at}`, timestamp: new Date(at).toISOString(), message: { id: `msg_${at}`, role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text }] } });
// The two signals of a turn's end: herdr's reading of the pane, and the agent's own turn-end report.
const pane = (w, id, status, complete = false) => { w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === S.get(id).link.pane); s.seq += 1; p.agent.status = status; p.agent.seq = s.seq; if (complete) p.agent.completion = s.seq; }); onPane(w.socket, S.get(id).link.pane); };
const reported = (id, file) => turnEnded({ id, role: "agent", token: "tok" }, [JSON.stringify({ session_id: "s1", transcript_path: file })]);
const ask = (id, msg = "Question 2 of 13: who is it for?") => A.report(id, { state: "blocked", kind: "question", msg, asAgent: true });
const reviewers = (w) => w.state().panes.filter((p) => /-r(-\d+)?$/.test(p.agent?.name || "")).length;
const reviewed = (id) => (S.get(id).reviews || []).length + (S.get(id).reviewRound || 0);

// A task whose agent is at work on its first prompt, which its conversation holds from a minute ago.
async function atWork(w, { research = false, steps = 1, settings = null } = {}) {
  w.script({ worker: Array.from({ length: steps }, () => ({ status: "working" })) });
  const id = A.add(w.root, "Interview the human", { research }).id;
  if (settings) S.update(id, { settings });
  A.delegate(id);
  const t = await settle(id);
  assert.equal(t.stage, "working");
  S.setToken(id, "agent", "tok", 0);
  const file = path.join(w.base, "conversation.jsonl");
  prompt(file, Date.now() - 60000);
  return { id, file };
}
const waiting = (id, msg = "Question 2 of 13: who is it for?") => { const t = S.get(id); assert.deepEqual([t.stage, t.kind, t.msg, reviewed(id)], ["asks", "question", msg, 0]); assert.equal(stateOf(id).state, "blocked"); };

test("it said it waits, then stopped, and herdr saw the stop first: no review; nor when its conversation cannot be read", async () => {
  const w = await world();
  try {
    const { id, file } = await atWork(w, { steps: 2 });
    ask(id);
    says(file, S.get(id).blocked.at + 1, "Question 2: who is it for?");
    // What happened on open-crm/1: the pane was seen at rest a moment before the agent's own report was read.
    pane(w, id, "done", true); reported(id, file);
    await settle(id);
    waiting(id);
    assert.equal(reviewers(w), 0); // no reviewer was started
    assert.equal(paneOf(w, S.get(id)).agent.prompts.length, 1); // and nothing went back to the agent
    // The next question, and this time nothing can be read of the turn: the task goes on waiting.
    A.tell(id, "1");
    ask(id, "Question 3 of 13");
    pane(w, id, "done", true); reported(id, path.join(w.base, "no-such-file.jsonl"));
    await settle(id);
    waiting(id, "Question 3 of 13");
    assert.equal(reviewers(w), 0);
  } finally { w.cleanup(); }
});

test("a long turn, its prompt far back in the saved conversation: its end is still known for the turn it waits in", async () => {
  const w = await world();
  try {
    const { id, file } = await atWork(w);
    const big = Date.now() - 30000;
    line(file, { type: "assistant", uuid: "a-tool", timestamp: new Date(big).toISOString(), message: { id: "msg_tool", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } });
    line(file, { type: "user", uuid: "u-tool", timestamp: new Date(big + 1).toISOString(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(900000) }] } });
    fs.writeFileSync(path.join(S.get(id).worktree, "draft.txt"), "half done\n"); // unfinished work that a finish would commit and review
    A.report(id, { state: "blocked", kind: "permission", msg: "Need your OK to delete the test data", asAgent: true });
    says(file, S.get(id).blocked.at + 1, "Waiting for your OK.");
    assert.equal(readClaude(file).began, 0); // the end of the file holds no prompt
    pane(w, id, "done", true); reported(id, file);
    await settle(id);
    const t = S.get(id);
    assert.deepEqual([t.stage, t.kind, t.msg, reviewed(id), reviewers(w)], ["asks", "permission", "Need your OK to delete the test data", 0, 0]);
  } finally { w.cleanup(); }
});

test("herdr takes the waiting agent for a new turn (a flap of its status): its end is still not a finish", async () => {
  const w = await world();
  try {
    const { id, file } = await atWork(w);
    ask(id, "Need your OK to delete the test data");
    pane(w, id, "idle"); // at rest for a moment, in the middle of the turn
    pane(w, id, "working");
    assert.equal(S.get(id).stage, "working"); // herdr's guess: somebody typed
    says(file, S.get(id).blocked.at + 1, "Waiting for your OK.");
    reported(id, file);
    pane(w, id, "done", true);
    await settle(id);
    waiting(id, "Need your OK to delete the test data");
    // The same seen through herdr alone, with no turn-end report of the agent's own.
    A.tell(id, "Yes, delete it.");
    prompt(file, Date.now() - 1000);
    ask(id, "And the backups?");
    pane(w, id, "idle"); pane(w, id, "working");
    says(file, Date.now() + 5, "And the backups?"); // its last words come after the flap
    S.update(id, { transcript: file });
    pane(w, id, "done", true);
    await settle(id);
    waiting(id, "And the backups?");
  } finally { w.cleanup(); }
});

test("it asks again and again, each answer a new turn: never reviewed while it waits, reviewed when it finishes", async () => {
  const w = await world();
  try {
    const { id, file } = await atWork(w, { steps: 3 });
    for (let n = 2; n <= 4; n++) {
      ask(id, `Question ${n} of 13`);
      says(file, S.get(id).blocked.at + 1, `Question ${n}?`);
      if (n % 2) { pane(w, id, "done", true); reported(id, file); } else { reported(id, file); await settle(id); pane(w, id, "done", true); } // either signal first
      await settle(id);
      waiting(id, `Question ${n} of 13`);
      if (n === 4) break;
      A.tell(id, "1");
      assert.equal(S.get(id).blocked, null); // the answer ends the wait
      prompt(file, Date.now() - 1000, "1");
    }
    // The last answer, and this time it does the work and stops without saying that it waits: that is a finish.
    w.script({ worker: [{ files: { "plan.txt": "the plan\n" }, commit: "plan", status: "working" }] });
    A.tell(id, "2");
    const at = Date.now();
    prompt(file, at, "2"); says(file, at + 1, "Wrote the plan.");
    reported(id, file); pane(w, id, "done", true);
    const t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    assert.equal(t.reviews.length, 1); assert.equal(t.review.pass, true);
  } finally { w.cleanup(); }
});

test("an answer typed in the agent's own terminal starts a new turn: its end is a finish, the old mark does not hide it", async () => {
  const w = await world();
  try {
    const { id, file } = await atWork(w);
    ask(id);
    const asked = S.get(id).blocked.at;
    says(file, asked + 1, "Question 2?");
    reported(id, file); pane(w, id, "done", true);
    await settle(id);
    waiting(id);
    // Nobody saw this turn start: only its end arrives, in a task that still says "asks".
    fs.writeFileSync(path.join(S.get(id).worktree, "plan.txt"), "the plan\n");
    prompt(file, asked + 10, "1"); says(file, asked + 20, "Wrote the plan.");
    reported(id, file); pane(w, id, "done", true);
    const t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    assert.equal(t.reviews.length, 1); // it cannot dodge its review by having asked once
  } finally { w.cleanup(); }
});

test("research only: the rules say how to wait and how to finish; an interim report and a closing note, then a question, end nothing; the report gets its link", async () => {
  const w = await world();
  try {
    const { id, file } = await atWork(w, { research: true });
    const said = rules(S.get(id));
    assert.match(said, /report proj\/1 --state blocked/);
    assert.match(said, /only way to say that you are waiting, and it holds for one stop: run it every time you stop for the human's answer/);
    assert.match(said, /A stop without it means you are finished, whatever your last message, your report or your closing note says/);
    assert.match(said, /Never run it to put off the review of finished work/);
    assert.match(said, /Saving the report finishes nothing: you may save it early/);
    const dir = R.reportFolder(S.get(id));
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "report.md"), "# Interim\n\nAnswered 1 to 12.\n");
    fs.writeFileSync(path.join(S.dirOf(id), "closing-note.md"), "NOT FINISHED: waiting for the human.\n");
    ask(id, "Question 13 of 15");
    says(file, S.get(id).blocked.at + 1, "Question 13?");
    pane(w, id, "done", true); reported(id, file);
    let t = await settle(id);
    waiting(id, "Question 13 of 15");
    assert.equal(t.report.file, "report.md"); assert.equal(reviewers(w), 0);
    // Finished, with the same report: now it is reviewed and done.
    w.script({ worker: [{ status: "working" }] });
    A.tell(id, "1");
    const at = Date.now();
    prompt(file, at, "1"); says(file, at + 1, "The plan is in the report.");
    reported(id, file); pane(w, id, "done", true);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.equal(t.reviews.length, 1);
  } finally { w.cleanup(); }
});

test("a review that is running when the agent says it waits is stopped, and sends nothing back", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }], reviewer: [{ status: "working" }] });
    const id = A.add(w.root, "Work").id;
    A.delegate(id);
    const run = settle(id);
    assert.ok(await until(() => S.get(id).stage === "reviewing" && !!S.get(id).link.reviewer?.pane));
    ask(id, "Should the old file go?");
    await run;
    const t = await settle(id);
    assert.deepEqual([t.stage, t.kind, t.msg], ["asks", "question", "Should the old file go?"]);
    assert.equal(t.link.reviewer, null); assert.equal((t.reviews || []).length, 0); assert.equal(t.reviewRounds || 0, 0);
    assert.equal(paneOf(w, t).agent.prompts.length, 1); // no failed round went to the agent
  } finally { w.cleanup(); }
});

test("a saved conversation says when its last turn began, for every agent program", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "sw-began-"));
  try {
    const ts = (n) => new Date(1000000 + n).toISOString(), f = (name) => path.join(dir, name);
    const write = (name, rows) => { fs.writeFileSync(f(name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); return f(name); };
    const claude = readClaude(write("c.jsonl", [
      { type: "user", timestamp: ts(1), message: { role: "user", content: "first" } },
      { type: "user", timestamp: ts(2), message: { role: "user", content: [{ type: "text", text: "second" }] } },
      { type: "assistant", timestamp: ts(3), message: { id: "m1", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } },
      { type: "user", timestamp: ts(4), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }, // a tool's result is no prompt
      { type: "user", timestamp: ts(5), isMeta: true, message: { role: "user", content: "a note of the program's own" } },
      { type: "assistant", timestamp: ts(6), message: { id: "m2", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] } },
    ]));
    assert.deepEqual([claude.finished, claude.began, claude.pos], [true, 1000002, 1000006]);
    const codex = readCodex(write("x.jsonl", [
      { timestamp: ts(1), type: "event_msg", payload: { type: "task_started" } },
      { timestamp: ts(2), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] } },
      { timestamp: ts(3), type: "response_item", payload: { type: "function_call", name: "shell" } },
      { timestamp: ts(4), type: "event_msg", payload: { type: "task_complete", turn_id: "t1", last_agent_message: "Done." } },
    ]));
    assert.deepEqual([codex.finished, codex.began], [true, 1000002]);
    const pi = readPi(write("p.jsonl", [
      { type: "message", id: "u1", timestamp: ts(1), message: { role: "user", content: [{ type: "text", text: "go" }] } },
      { type: "message", id: "r1", timestamp: ts(2), message: { role: "toolResult", content: [] } },
      { type: "message", id: "a1", timestamp: ts(3), message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Done." }] } },
    ]));
    assert.deepEqual([pi.finished, pi.began], [true, 1000001]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
