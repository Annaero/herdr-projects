// A turn cut off by the model's provider: recognised from the agent's own conversation file, retried by the board
// when the error is one that passes, and never taken for a finished turn or a review. The endings are recorded ones
// (test/fixtures/endings).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { world, fastClock, settle, stateOf, paneOf } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { readTurnOf, providerError } from "../src/agents.js";
import { housekeeping } from "../src/housekeeping.js";
import { stripVTControlCharacters } from "node:util";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";

const endings = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "endings");
const starts = (w, name) => w.state().calls.filter((c) => c.startsWith("agent start") && new RegExp(`${name}( |$)`).test(c.split(" ")[2])).length;
const reviewerStarts = (w) => w.state().calls.filter((c) => /^agent start \S+-r /.test(c)).length;
const ENV = ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "PI_CODING_AGENT_DIR", "HERDR_SUPERWORK_RETRY_MS", "HERDR_SUPERWORK_ENDED_MS", "HERDR_SUPERWORK_QUIET_MS"];
// A world whose agent programs keep their conversations inside it, and whose waits are short.
async function cutWorld(waits, settings = {}) {
  const w = await world({ settings });
  const before = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { CODEX_HOME: path.join(w.base, "codex"), CLAUDE_CONFIG_DIR: path.join(w.base, "claude"), PI_CODING_AGENT_DIR: path.join(w.base, "pi"), HERDR_SUPERWORK_RETRY_MS: waits, HERDR_SUPERWORK_ENDED_MS: "0", HERDR_SUPERWORK_QUIET_MS: "60" });
  const end = w.cleanup;
  w.cleanup = () => { for (const k of ENV) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } end(); };
  return w;
}
const WORK = { files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." };
const PASS = { verdict: { meets: true, findings: [], text: "Looks right." } };
// What the row said while the jobs ran.
async function watching(id, fn) {
  const said = new Set();
  const look = setInterval(() => { try { const r = stateOf(id); if (r) said.add(`${r.state}: ${r.note}`); } catch {} }, 15);
  try { return [await fn(), [...said]]; } finally { clearInterval(look); }
}
// The wait of a working agent is over: time is moved on, not slept through.
const elapse = (id) => S.update(id, (t) => { t.waiting = { ...t.waiting, until: Date.now() - 1 }; });

test("recorded endings: a provider error is read from the conversation file, and told apart as passing or not", () => {
  const read = (kind, name) => readTurnOf(kind, { file: path.join(endings, `${name}.jsonl`) });
  const passing = [["codex", "codex-at-capacity", /^Selected model is at capacity/, "model is at capacity"], ["pi", "pi-socket-closed", /socket connection was closed/, "connection dropped"],
    ["pi", "pi-overloaded", /currently overloaded/, "provider is overloaded"], ["pi", "pi-gateway-502", /API error \(502\)/, "provider had a server error"], ["pi", "pi-stream-ended", /stream ended/, "connection dropped"],
    ["claude", "claude-overloaded-made", /529/, "provider is overloaded"], ["claude", "claude-rate-limit-made", /429/, "model is rate limited"]];
  for (const [kind, name, error, reason] of passing) {
    const t = read(kind, name);
    assert.match(t.error, error, name); assert.equal(t.stop, "error", name);
    assert.deepEqual([t.passing, t.reason, t.auth, t.finished], [true, reason, false, false], name);
  }
  // the turn this was built for: it is an error, not a finished turn whose last message is the reviewer's opening one
  const cap = read("codex", "codex-at-capacity");
  assert.equal(cap.said, "Selected model is at capacity. Please try a different model."); assert.equal(cap.id, "01a13034-87eb-7913-81ef-e5142693d7bb");
  // errors that waiting cannot fix
  for (const [kind, name, error] of [["codex", "codex-model-not-supported", /not supported/], ["pi", "pi-unknown-provider", /Unknown provider/], ["pi", "pi-flagged", /flagged/], ["claude", "claude-model-not-found", /may not exist/]]) {
    const t = read(kind, name);
    assert.match(t.error, error, name); assert.deepEqual([t.passing, t.reason, t.auth], [false, "", false], name);
  }
  const login = read("codex", "codex-unauthorized");
  assert.match(login.error, /401 Unauthorized/); assert.deepEqual([login.passing, login.auth], [false, true]);
  // a finished turn is still a finished turn
  assert.deepEqual([read("codex", "codex-finished-made").finished, read("codex", "codex-finished-made").error], [true, ""]);
  // the program's own code decides where it has one; an error nobody recognises is not retried
  assert.deepEqual(providerError("boom", { code: "server_overloaded" }), { passing: true, reason: "provider is overloaded", auth: false });
  assert.equal(providerError("stream closed", { code: "usage_limit_exceeded" }).passing, false);
  assert.equal(providerError("You've hit your session limit · resets 3pm", { code: "rate_limit", status: 429 }).passing, false);
  assert.equal(providerError("something odd happened").passing, false);
  // a rate limit that says "reached" is still a rate limit, whichever program reports it; a usage limit is not
  for (const o of [{ code: "rate_limit", status: 429 }, { code: "other" }, {}]) assert.deepEqual(providerError("Rate limit reached. Please try again in 2 seconds.", o), { passing: true, reason: "model is rate limited", auth: false });
  assert.equal(providerError("Rate limit reached for gpt-6.1 on requests per min.", { status: 429 }).passing, true);
  assert.equal(providerError("Claude usage limit reached. Your limit will reset at 3pm.", { code: "rate_limit", status: 429 }).passing, false);
  assert.equal(providerError("Weekly limit reached", {}).passing, false);
  assert.equal(providerError("", { code: { http_connection_failed: { http_status_code: 502 } } }).passing, false); // the reader turns a table into its word first
});

test("the wait: growing, a few times; the row says why and when; only while the task stands where the wait was set", () => {
  assert.deepEqual(S.retryWaits(), [60000, 120000, 240000, 480000]);
  const now = 1000000;
  assert.equal(S.waitLine({ who: "reviewer", reason: "model is at capacity", until: now + 120000 }, now), "Reviewer's model is at capacity, trying again in 2m");
  assert.equal(S.waitLine({ who: "agent", reason: "connection dropped", until: now + 20000 }, now), "Agent's connection dropped, trying again in 20s");
  assert.equal(S.waitLine({ who: "agent", reason: "connection dropped", until: now - 5 }, now), "Agent's connection dropped, trying again now");
  assert.equal(S.gaveUp("reviewer", "model is at capacity", 5), "the reviewer's model is at capacity, still after 5 tries over 15m");
  const rv = { who: "reviewer", reason: "model is at capacity", until: Date.now() + 120000 };
  // a review waiting to start again is still the review the task is on: its row keeps the R# tag (the counter is put back for the wait)
  assert.equal(S.reviewNumber({ stage: "reviewing", reviewRound: 0, waiting: rv }), 1); assert.equal(S.reviewNumber({ stage: "reviewing", reviewRound: 2, waiting: rv }), 3); assert.equal(S.reviewNumber({ stage: "failed", reviewRound: 0, waiting: { ...rv, who: "agent" } }), 0);
  assert.equal(S.waitingOf({ stage: "reviewing", waiting: rv }), rv);
  assert.equal(S.waitingOf({ stage: "failed", waiting: rv }), null);
  const ag = { who: "agent", reason: "connection dropped", until: Date.now() + 60000, for: 7 };
  assert.equal(S.waitingOf({ stage: "failed", failure: { at: 7 }, waiting: ag }), ag);
  assert.equal(S.waitingOf({ stage: "failed", failure: { at: 8 }, waiting: ag }), null); // another failure since
  assert.equal(S.waitingOf({ stage: "working", failure: { at: 7 }, waiting: ag }), null); // a reply moved it on
});

test("a review cut off by a passing provider error is started again by itself, and is not a review round", async (tt) => {
  const clock = fastClock(tt); // the waits between tries pass at once
  const w = await cutWorld("600,600");
  try {
    // as it happened: Codex reports its turn ended, 15 seconds in, and its file ends in the error
    w.script({ worker: [WORK], reviewer: [{ ends: "codex-at-capacity", hook: true }, { ends: "codex-at-capacity", hook: true, status: "working" }, PASS] });
    const id = A.add(w.root, "Cut off twice").id;
    A.delegate(id);
    const [t, said] = await watching(id, () => clock(settle(id)));
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    assert.equal(reviewerStarts(w), 3);
    assert.ok(said.some((s) => /^working: Reviewer's model is at capacity, trying again (in \d+[sm]|now)$/.test(s)), said.join(" | "));
    assert.ok(!said.some((s) => /without a verdict|^error/.test(s)), said.join(" | "));
    // one review happened: the two that were cut off used up no number and are not on the list
    assert.equal(t.review.pass, true); assert.equal(S.reviewRound(t), 1); assert.equal(t.reviewRounds || 0, 0);
    assert.deepEqual(S.reviewHistory(t).map((e) => [e.round, e.error || "", e.pass]), [[1, "", true]]);
    assert.equal(S.waitingOf(t), null); assert.equal(t.failure, null);
  } finally { w.cleanup(); }
});

test("a review cut off again and again: the board gives up and names the real error; retry then reviews as the first round", async (tt) => {
  const clock = fastClock(tt); // the waits between tries pass at once
  const w = await cutWorld("30,30");
  try {
    const cut = { ends: "codex-at-capacity", hook: true };
    w.script({ worker: [WORK], reviewer: [cut, cut, cut] });
    const id = A.add(w.root, "Never gets through").id;
    A.delegate(id);
    let t = await clock(settle(id));
    assert.equal(t.stage, "failed"); assert.equal(reviewerStarts(w), 3);
    assert.equal(t.msg, "Review failed: the reviewer's model is at capacity, still after 3 tries over 1s. Its error: Selected model is at capacity. Please try a different model. Retry the task to review again");
    assert.doesNotMatch(`${t.msg}\n${t.failure.detail}`, /without a verdict|last message/);
    assert.equal(stateOf(id).state, "error"); assert.equal(S.waitingOf(t), null);
    assert.deepEqual(S.reviewHistory(t), []); assert.equal(S.reviewRound(t), 0);
    w.script({ reviewer: [PASS] });
    A.retry(id);
    t = await clock(settle(id));
    assert.equal(t.stage, "approval"); assert.equal(S.reviewRound(t), 1); assert.equal(S.reviewHistory(t).length, 1);
  } finally { w.cleanup(); }
});

test("the report of a try that was cut off does not end the next try: that one is judged by its own ending", async (tt) => {
  const clock = fastClock(tt); // the waits between tries pass at once
  const w = await cutWorld("30");
  try {
    process.env.HERDR_SUPERWORK_REVIEW_MS = "3000"; // long enough for the first try to get going on a busy machine
    process.env.HERDR_SUPERWORK_ENDED_MS = "60000"; // only reports count here: the file of the first try is seconds old, not a minute as in real waits
    // the second reviewer works on and never writes a verdict: it runs into the time limit, and that is a review
    w.script({ worker: [WORK], reviewer: [{ ends: "codex-at-capacity", hook: true }, { status: "working" }] });
    const id = A.add(w.root, "Second try is slow").id;
    A.delegate(id);
    const t = await clock(settle(id));
    assert.equal(t.stage, "failed"); assert.equal(reviewerStarts(w), 2);
    assert.match(t.failure.detail, /review timed out/);
    assert.deepEqual(S.reviewHistory(t).map((e) => [e.round, e.error]), [[1, "review timed out"]]);
  } finally { process.env.HERDR_SUPERWORK_REVIEW_MS = "120000"; w.cleanup(); }
});

test("an error that waiting cannot fix is not retried: a model that does not exist fails at once, a missing login asks for one", async () => {
  const w = await cutWorld("30,30");
  try {
    w.script({ worker: [WORK], reviewer: [{ ends: "codex-model-not-supported" }] });
    let id = A.add(w.root, "Wrong model").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "failed"); assert.equal(reviewerStarts(w), 1);
    assert.match(t.msg, /^Review failed: the reviewer stopped: .*model is not supported/); assert.equal(t.failure.auth, false);
    assert.deepEqual(S.reviewHistory(t), []); assert.equal(S.reviewRound(t), 0);
    w.script({ worker: [WORK], reviewer: [{ ends: "codex-unauthorized" }] });
    id = A.add(w.root, "Logged out").id;
    A.delegate(id);
    t = await settle(id);
    assert.equal(t.stage, "failed"); assert.equal(t.failure.title, "Needs a login"); assert.equal(stateOf(id).kind, "auth");
    assert.equal(reviewerStarts(w), 2);
  } finally { w.cleanup(); }
});

test("a reviewer that really finished without a verdict is still a failed review, on the list, with its last message", async () => {
  const w = await cutWorld("30,30");
  try {
    w.script({ worker: [WORK], reviewer: [{ ends: "codex-finished-made" }] });
    const id = A.add(w.root, "No verdict").id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "failed"); assert.equal(reviewerStarts(w), 1);
    assert.match(t.failure.detail, /the reviewer finished without a verdict\. Its last message: I looked at it and it seems fine\./);
    assert.equal(S.reviewRound(t), 1); assert.match(S.reviewHistory(t)[0].error, /finished without a verdict/);
  } finally { w.cleanup(); }
});

test("without the reviewer's own turn-end report: its conversation file ending in the error is enough", async (tt) => {
  const clock = fastClock(tt); // the waits between tries pass at once
  const w = await cutWorld("600", { "reviewer.agent": "claude" });
  try {
    w.script({ worker: [WORK], reviewer: [{ ends: "claude-overloaded-made" }, PASS] });
    const id = A.add(w.root, "Not reported").id;
    A.delegate(id);
    const [t, said] = await watching(id, () => clock(settle(id)));
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    assert.equal(reviewerStarts(w), 2);
    assert.ok(said.some((s) => /Reviewer's provider is overloaded, trying again/.test(s)), said.join(" | "));
    assert.deepEqual(S.reviewHistory(t).map((e) => e.round), [1]);
  } finally { w.cleanup(); }
});

test("the working agent: a turn cut off by a passing provider error is told to carry on by itself, not held as failed", async () => {
  const w = await cutWorld("120000,240000", { "worker.agent": "pi" });
  try {
    w.script({ worker: [{ ends: "pi-socket-closed" }, WORK], reviewer: [PASS] });
    const id = A.add(w.root, "Dropped").id;
    A.delegate(id);
    let t = await settle(id);
    // under the wait the failure is saved, so a reply or ctrl+r works; the row shows work going on, and why
    assert.equal(t.stage, "failed"); assert.equal(t.failure.title, "Agent cut off"); assert.match(t.failure.detail, /socket connection was closed/);
    assert.equal(S.waitingOf(t).tries, 1);
    let row = stateOf(id);
    assert.equal(row.state, "working"); assert.match(row.note, /^Agent's connection dropped, trying again in 2m$/);
    assert.equal(F.labelOf(t), "");
    // on the board: under "working", the row and the task panel say why and when, and nothing asks for you
    const v = new View({ terminal: { rows: 40, columns: 130 }, requestRender() {}, stop() {}, start() {} }, theme, () => {}, { cwd: w.root, canReload: true });
    clearInterval(v.timer); v.side = true;
    const screen = v.render(130).map((l) => stripVTControlCharacters(l)).join("\n");
    assert.match(screen, /\n working\s[^\n]*\n . Dropped [^\n]*\n {3}Agent's connection dropped, trying again in 2m /); assert.doesNotMatch(screen, /needs you|Agent cut off/);
    assert.match(screen, /Cut off ─+[\s\S]*Trying again by itself[\s\S]*Cut off by[\s\S]*The socket connection was closed/);
    housekeeping(w.socket, { force: true }); // too early: nothing is sent
    assert.equal(paneOf(w, t).agent.prompts.length, 1);
    elapse(id);
    // herdr does not answer the lookup just then: the wait stays, and the next pass sends
    w.patchState((s) => { s.agentGetFails = true; });
    assert.equal(F.resumeCut(id), false);
    assert.equal(S.waitingOf(S.get(id)).tries, 1); assert.equal(stateOf(id).state, "working");
    w.patchState((s) => { s.agentGetFails = false; });
    housekeeping(w.socket, { force: true });
    const prompts = paneOf(w, S.get(id)).agent.prompts;
    assert.equal(prompts.length, 2); assert.match(prompts[1], /cut off by an error at the model's provider[\s\S]*socket connection was closed[\s\S]*Continue the task where you left off\./);
    assert.equal(S.get(id).expectedWake.reason, "retry");
    housekeeping(w.socket, { force: true }); // and only once
    assert.equal(paneOf(w, S.get(id)).agent.prompts.length, 2);
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(t.failure, null); assert.equal(t.waiting, null);
  } finally { w.cleanup(); }
});

test("the working agent: after the last try the board gives up with the real error; other errors are held at once as before", async () => {
  const w = await cutWorld("60000", { "worker.agent": "pi" });
  try {
    w.script({ worker: [{ ends: "pi-overloaded" }, { ends: "pi-overloaded" }] });
    let id = A.add(w.root, "Overloaded").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(stateOf(id).state, "working");
    elapse(id);
    housekeeping(w.socket, { force: true });
    t = await settle(id);
    assert.equal(t.stage, "failed"); assert.equal(S.waitingOf(t), null); assert.equal(stateOf(id).state, "error");
    assert.equal(t.msg, "Agent stopped: the agent's provider is overloaded, still after 2 tries over 1m. Its error: Our servers are currently overloaded. Please try again later.");
    assert.equal(paneOf(w, t).agent.prompts.length, 2);
    // a reply is a new start: the count begins again
    w.script({ worker: [{ ends: "pi-overloaded" }] });
    A.tell(id, "try once more");
    t = await settle(id);
    assert.equal(S.waitingOf(t).tries, 1);
    // you reply while it waits: the wait is over, and the board sends nothing of its own on top
    w.script({ worker: [WORK] });
    const until = S.get(id).waiting.until;
    A.tell(id, "go on");
    assert.equal(S.get(id).waiting, null);
    S.update(id, (t) => { t.waiting = { who: "agent", reason: "provider is overloaded", error: "x", until: Date.now() - 1, tries: 1, for: until }; }); // even a wait left behind sends nothing: the task has moved on
    housekeeping(w.socket, { force: true });
    assert.equal(paneOf(w, S.get(id)).agent.prompts.length, 4);
    // an error that does not pass: held for you at once
    w.script({ worker: [{ ends: "pi-unknown-provider" }] });
    id = A.add(w.root, "No such provider").id;
    A.delegate(id);
    t = await settle(id);
    assert.equal(t.stage, "failed"); assert.equal(t.failure.title, "Agent stopped"); assert.match(t.msg, /^Agent stopped: Unknown provider/);
    assert.equal(S.waitingOf(t), null); assert.equal(stateOf(id).state, "error");
  } finally { w.cleanup(); }
});

test("the working agent: a program that exited with the error is started again and told to carry on, and the tries still count", async () => {
  const w = await cutWorld("60000", { "worker.agent": "pi" });
  try {
    w.script({ worker: [{ ends: "pi-socket-closed", hook: true, exit: true }, { ends: "pi-socket-closed", hook: true, exit: true }] });
    const id = A.add(w.root, "Crashed").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(S.waitingOf(t).tries, 1); assert.equal(paneOf(w, t).agent, null);
    elapse(id);
    assert.equal(F.resumeCut(id), true);
    t = await settle(id);
    // started again in the same conversation, with the words; it is cut off again, and that was the last try
    const startCalls = w.state().calls.filter((c) => c.startsWith("agent start") && !/-r /.test(c));
    assert.equal(startCalls.length, 2); assert.match(startCalls[1], new RegExp(`--session-id ${t.session}`));
    assert.equal(t.stage, "failed"); assert.equal(S.waitingOf(t), null);
    assert.match(t.msg, /^Agent stopped: the agent's connection dropped, still after 2 tries over 1m\./);
    // once more, and this time it finishes: the count starts again
    w.script({ worker: [WORK], reviewer: [PASS] });
    A.retry(id);
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(t.cutRetry ?? null, null);
  } finally { w.cleanup(); }
});

test("the working agent: no report, no closing note, and herdr cannot tell if it stopped: the error at the end of its file is enough", async () => {
  const w = await cutWorld("60000", { "worker.agent": "codex" });
  try {
    w.script({ worker: [{ ends: "codex-at-capacity", status: "unknown" }, { ...WORK, status: "unknown" }], reviewer: [PASS] });
    const id = A.add(w.root, "Nobody says it stopped").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "failed", t.stage); assert.equal(S.waitingOf(t).reason, "model is at capacity");
    assert.match(stateOf(id).note, /^Agent's model is at capacity, trying again in (1m|\d+s)$/);
    elapse(id);
    housekeeping(w.socket, { force: true });
    assert.equal(paneOf(w, S.get(id)).agent.prompts.length, 2);
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
  } finally { w.cleanup(); }
});

test("the working agent, with its own turn-end report: cut off, told to carry on, and the finished turn goes on to review", async () => {
  const w = await cutWorld("60000");
  try {
    w.script({ worker: [{ ends: "claude-overloaded-made", hook: true }, { ...WORK, note: null, ends: "claude-finished-made", hook: true }], reviewer: [PASS] });
    const id = A.add(w.root, "Reported cut").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "failed"); assert.equal(S.waitingOf(t).reason, "provider is overloaded");
    elapse(id);
    housekeeping(w.socket, { force: true });
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(t.summary, "Carried on and finished it.");
  } finally { w.cleanup(); }
});
