// The limits (`limit.time`, `limit.tokens`): the two settings, the counting, the stop that keeps the work and merges
// nothing, and the ways on from it: continue, a higher limit, take the work as it is.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { world, settle, stateOf, paneOf, until } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import * as L from "../src/limits.js";
import * as AL from "../src/automations/list.js";
import { main } from "../src/cli.js";
import { onPane } from "../src/hook.js";
import { turnEnded } from "../src/turn.js";
import { AGENTS } from "../src/agents/kinds.js";
import { claudeTokens, codexTokens, piTokens } from "../src/agents/read-tokens.js";
import { green } from "../src/finish/auto-merge.js";
import { eventOf } from "../src/notify.js";
import { entryOf } from "../src/flow/sidebar-entry.js";
import { rules } from "../src/coordinator/rules.js";
import { housekeeping } from "../src/housekeeping.js";
import { parseSchedule } from "../src/automations/triggers.js";

const refused = (fn) => { try { fn(); } catch (e) { return e.message; } return ""; };
const said = async (argv) => { let text = ""; const out = process.stdout.write; process.stdout.write = (s) => { text += s; return true; }; try { await main(argv); } finally { process.stdout.write = out; } return text; };
const verdict = (findings = []) => ({ verdict: { meets: true, text: "Looked at it.", findings } });
const bad = { severity: "major", subject: "Wrong", where: "f.txt", proof: "ran it" };
const reviewers = (w) => w.state().panes.filter((p) => /-r(-\d+)?$/.test(p.agent?.name || "")).length;
// The agent's saved conversation as Claude Code writes it: a prompt, and a reply with the tokens it used.
const line = (file, o) => fs.appendFileSync(file, JSON.stringify(o) + "\n");
const prompt = (file, at) => line(file, { type: "user", uuid: `u${at}`, timestamp: new Date(at).toISOString(), message: { role: "user", content: "Go on." } });
const reply = (file, at, tokens, text = "Done.") => line(file, { type: "assistant", uuid: `a${at}`, timestamp: new Date(at).toISOString(), message: { id: `msg_${at}`, role: "assistant", stop_reason: "end_turn", usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: tokens - 40, output_tokens: 10 }, content: [{ type: "text", text }] } });
const pane = (w, id, status, complete = false) => { w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === S.get(id).link.pane); s.seq += 1; p.agent.status = status; p.agent.seq = s.seq; if (complete) p.agent.completion = s.seq; }); onPane(w.socket, S.get(id).link.pane); };
const reported = (id, file) => turnEnded({ id, role: "agent", token: "tok" }, [JSON.stringify({ session_id: "s1", transcript_path: file })]);
// A task whose agent is at work, with `settings` of its own.
async function atWork(w, settings = {}, script = {}) {
  w.script({ worker: Array.from({ length: 6 }, () => ({ status: "working" })), ...script });
  const id = A.add(w.root, "Long work").id;
  A.delegate(id, settings);
  const t = await settle(id);
  assert.equal(t.stage, "working");
  S.setToken(id, "agent", "tok", 0);
  return id;
}
// The agent's turn ends, having used `tokens` in it.
async function turnEnds(w, id, tokens, file = path.join(w.base, "conversation.jsonl")) {
  const at = Date.now();
  prompt(file, at - 1000); reply(file, at, tokens);
  pane(w, id, "done", true); reported(id, file);
  return settle(id, { max: 30 });
}
const tick = (w, now, carryOn = A.carryOn) => L.limitsTick(F.boardFor(w.socket), { now, carryOn });

test("the two settings: what a value may be, the nearest right one for a refused one, the lookup, and never the repo's own file", async () => {
  const w = await world({ repoSettings: { limit: { time: "1m", tokens: "1k" }, check: { timeout: "5m" } } });
  try {
    const id = A.add(w.root, "One").id, at = (name) => { const r = S.lookup(name, { task: S.get(id) }); return [r.value, r.from]; };
    // built in: none. The repo's own file says both: refused, so code an agent writes cannot set or lift a limit.
    assert.deepEqual([at("limit.time"), at("limit.tokens")], [["none", "built in"], ["none", "built in"]]);
    assert.match(S.repoFile(w.root).refused.join("\n"), /limit\.time is refused: the repo's file may only hold/);
    assert.ok(!S.REPO_FACTS.some((n) => n.startsWith("limit.")));
    // what it may be, and how it is kept
    for (const [name, typed, kept] of [["limit.time", "2h", "2h"], ["limit.time", " 45M ", "45m"], ["limit.time", "None", "none"], ["limit.tokens", "2m", "2m"], ["limit.tokens", "500K", "500k"], ["limit.tokens", "2000000", "2m"], ["limit.tokens", "1.5m", "1.5m"], ["limit.tokens", "none", "none"]]) assert.equal(S.check(name, typed), kept, `${name} ${typed}`);
    assert.deepEqual([S.ms("2h"), S.ms("none"), S.tokensOf("2m"), S.tokensOf("500k"), S.tokensOf("none"), S.tokensSay(1234567), S.tokensSay(950)], [7200000, 0, 2000000, 500000, 0, "1.23m", "950"]);
    // a refused value changes nothing and names the nearest right one
    assert.match(refused(() => S.setValue("limit.time", "2 hours")), /limit\.time is a time with a unit, such as 2h \(s, m or h\), or none, not "2 hours"\. Did you mean 2h\?/);
    assert.match(refused(() => S.setValue("limit.time", "90")), /Did you mean 90m\?/);
    assert.match(refused(() => S.setValue("limit.tokens", "2 million")), /limit\.tokens is a count of tokens, such as 500k or 2m, or none, not "2 million"\. Did you mean 2m\?/);
    assert.match(refused(() => S.setValue("limit.tokens", "0")), /Did you mean none\?/);
    assert.match(refused(() => S.setValue("limit.token", "2m")), /Unknown setting "limit\.token"\. Did you mean limit\.tokens\?/);
    assert.equal(S.setting("limit.time"), "none"); assert.equal(S.setting("limit.tokens"), "none");
    // nearest answer first: you, your entry for the repo, the task
    S.setValue("limit.time", "4h"); assert.deepEqual(at("limit.time"), ["4h", "you"]);
    S.setValue("limit.time", "3h", { repo: "proj" }); assert.deepEqual(at("limit.time"), ["3h", "your entry for proj"]);
    assert.match(await said(["set", "limit.time", "2h", "--task", id]), /limit\.time for proj\/1: 2h {2}\(this task\)/); assert.deepEqual(at("limit.time"), ["2h", "this task"]);
    assert.match(await said(["show", id]), /\n\* limit\.time +2h +this task\n {2}limit\.tokens +none +built in\n/);
    assert.match(await said(["unset", "limit.time", "--task", id]), /3h {2}\(your entry for proj\)/);
    // an option of delegate, for that one task; a refused one changes nothing on it
    w.script({ worker: [{ status: "working" }] });
    assert.match(refused(() => A.delegate(id, { "limit.tokens": "lots", "limit.time": "1h" })), /limit\.tokens is a count of tokens/); assert.deepEqual(S.get(id).settings || {}, {});
    await said(["delegate", id, "--limit.time", "1h", "--limit.tokens", "500k"]); assert.deepEqual(S.get(id).settings, { "limit.time": "1h", "limit.tokens": "500k" });
    // and of add, with or without --delegate
    await said(["add", "With limits", "--repo", w.root, "--limit.time", "45m", "--limit.tokens", "500k"]); assert.deepEqual(S.get("proj/2").settings, { "limit.time": "45m", "limit.tokens": "500k" });
    assert.match(refused(() => S.checked({ "limit.time": "soon" }, {})), /limit\.time is a time/); await assert.rejects(main(["add", "Refused", "--repo", w.root, "--limit.time", "soon"])); assert.equal(S.list().length, 2);
    // held by an automation, for every task it makes
    const a = AL.add({ name: "Nightly", prompt: "Look.", trigger: parseSchedule("daily 09:00"), folder: w.root });
    assert.match(await said(["set", "limit.tokens", "2m", "--automation", "Nightly"]), /limit\.tokens for "Nightly": 2m {2}\(this automation\)/);
    assert.equal(AL.find(a.id).settings["limit.tokens"], "2m");
    // a program whose tokens cannot be counted: `show <id>` says the limit does nothing for it
    const { tokens } = AGENTS.claude;
    try { delete AGENTS.claude.tokens; assert.match(await said(["show", id]), /limit\.tokens +500k +does nothing for claude: its tokens cannot be counted\n/); } finally { AGENTS.claude.tokens = tokens; }
    assert.match(await said(["show", id]), /limit\.tokens +500k +this task\n/);
    // A task done several times at once is one task to its limit: an attempt reads its task's limit, and the
    // attempts' tokens count together, whichever of them is asked.
    { const top = A.add(w.root, "Thrice").id; S.setValue("limit.tokens", "500k", { task: S.get(top) });
      const a1 = S.createAttempt(S.get(top), "A", "claude"), a2 = S.createAttempt(S.get(top), "B", "codex");
      S.update(top, (t) => { t.attempts = [{ id: a1.id, letter: "A" }, { id: a2.id, letter: "B" }]; });
      S.update(a1.id, (t) => { t.spent = { total: 300000 }; }); S.update(a2.id, (t) => { t.spent = { total: 250000 }; });
      assert.ok(L.limitSaid(S.get(a1.id))); assert.equal(L.usedOf(S.get(a1.id)), 550000); assert.equal(L.usedOf(S.get(top)), 550000);
      assert.deepEqual(L.overNow(S.get(a2.id)), { limit: "500k", used: 550000 });
      // The chosen attempt's conversation is the task's from then on: read onto the task as well, it still counts once.
      const conv = { "/c/a.jsonl": { at: 9, n: 300000 } };
      S.update(a1.id, (t) => { t.spent = { files: conv, total: 300000 }; }); S.update(top, (t) => { t.spent = { files: { "/c/a.jsonl": { at: 12, n: 310000 }, "/c/review.jsonl": { at: 5, n: 40000 } }, total: 350000 }; });
      assert.equal(L.usedOf(S.get(top)), 310000 + 40000 + 250000); assert.equal(L.usedOf(S.get(a1.id)), 600000); }
    // the Coordinator is told in plain words
    assert.match(rules("board"), /limit\.time[^\n]*limit\.tokens/); assert.match(rules("board"), /"never more than two hours on this one" is board set limit\.time 2h --task <id>/);
  } finally { w.cleanup(); }
});

test("tokens are counted from where the last count stopped, each program its own way; what is read again from the cache counts too", async () => {
  const w = { base: fs.mkdtempSync(path.join(os.tmpdir(), "sw-limits-")) };
  try {
    const f = path.join(w.base, "c.jsonl"), u = (id, o) => line(f, { type: "assistant", message: { id, usage: { input_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: o } } });
    // Claude Code: one line per part of a reply, each with the whole reply's use; a reply counts once
    u("m1", 10); u("m1", 10); u("m1", 40);
    let s = claudeTokens(f); assert.equal(s.n, 1145);
    assert.deepEqual(claudeTokens(f, s), s); // nothing new: the same answer
    u("m1", 60); u("m2", 20); fs.appendFileSync(f, '{"type":"assistant","message":{"id":"m3","usage":{"input_tokens":9'); // a line still being written waits
    s = claudeTokens(f, s); assert.equal(s.n, 1145 + 20 + 1125);
    fs.appendFileSync(f, ',"output_tokens":1}}}\n'); s = claudeTokens(f, s); assert.equal(s.n, 2300);
    fs.writeFileSync(f, ""); u("n1", 1); assert.equal(claudeTokens(f, s).n, 1106); // a shorter file is another file
    // Codex: the conversation's running total, what came from the cache included; a total that began again is added
    const c = path.join(w.base, "x.jsonl"), total = (i, cached, o) => line(c, { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: i, cached_input_tokens: cached, output_tokens: o } } } });
    total(1000, 400, 50); total(3000, 2000, 150);
    let x = codexTokens(c); assert.equal(x.n, 3150);
    total(500, 0, 10); x = codexTokens(c, x); assert.equal(x.n, 3660);
    // pi: each reply once
    const p = path.join(w.base, "p.jsonl");
    line(p, { type: "message", message: { role: "assistant", usage: { input: 100, output: 7, cacheRead: 9000, cacheWrite: 20 } } }); line(p, { type: "message", message: { role: "user" } });
    assert.equal(piTokens(p).n, 9127);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test("limit.time: a run that took its time is stopped once, its work kept and nothing merged; continue, a higher limit and \"as it is\" carry on", async () => {
  const w = await world({ settings: { "merge.by": "itself" } });
  try {
    const id = await atWork(w, { "limit.time": "2h" }, { reviewer: [verdict()] });
    fs.writeFileSync(path.join(S.get(id).worktree, "half.txt"), "half done\n");
    const t0 = L.runBegan(S.get(id));
    // while it runs: the panel's row, and the row says so from near the limit on
    assert.equal(stateOf(id).limits.near, undefined);
    assert.deepEqual(L.limitsOf(S.get(id), t0 + 30 * 60000), { time: { limit: "2h", used: 30 * 60000 } });
    assert.equal(L.limitsOf(S.get(id), t0 + 100 * 60000).near, "1h40m of its 2h");
    tick(w, t0 + 119 * 60000); assert.equal(S.get(id).stage, "working");
    // an agent that shows a dialog waits for you: that wait is not stopped
    pane(w, id, "blocked"); tick(w, t0 + 130 * 60000); assert.equal(S.get(id).stage, "working"); pane(w, id, "working");
    // reached: stopped, with the plain line, under "needs you"
    tick(w, t0 + 140 * 60000);
    let r = stateOf(id);
    assert.deepEqual([r.stage, r.state, r.note, r.limitStop.what, r.limitStop.limit, r.limitStop.role], ["stopped", "blocked", "stopped at its 2h limit", "time", "2h", "agent"]);
    assert.ok(paneOf(w, r).agent.keys.length > 0); // its turn was interrupted
    assert.equal(fs.readFileSync(path.join(r.worktree, "half.txt"), "utf8"), "half done\n"); // the work is kept as it is
    assert.equal(eventOf(r), "needs you"); { const e = entryOf(r); assert.match(e.stands, /needs you/); assert.equal(e.line, "stopped at its 2h limit"); } // herdr's sidebar says the row
    assert.equal(A.details(id).limits.stopped.line, "stopped at its 2h limit");
    // it never fires again by itself, and nothing is checked, reviewed or merged meanwhile
    const prompts = paneOf(w, r).agent.prompts.length;
    for (const m of [141, 200, 900]) tick(w, t0 + m * 60000);
    await settle(id); housekeeping(undefined, { force: true });
    r = stateOf(id); assert.deepEqual([r.stage, r.limitStop.at, paneOf(w, r).agent.prompts.length, reviewers(w)], ["stopped", S.get(id).limitStop.at, prompts, 0]);
    // a higher limit carries on by itself, from the time the run had taken
    S.setValue("limit.time", "3h", { task: S.get(id) });
    tick(w, Date.now() + 5000);
    r = stateOf(id); assert.deepEqual([r.stage, r.limitStop ?? null, paneOf(w, r).agent.prompts.length], ["working", null, prompts + 1]);
    assert.match(paneOf(w, r).agent.prompts.at(-1), /reached its limit \(2h for one run\)[^\n]*The limit was raised: continue the task where you left off\./);
    const t1 = L.runBegan(S.get(id)); assert.equal(L.ranFor(S.get(id), t1 + 60000), 141 * 60000);
    tick(w, t1 + 30 * 60000); assert.equal(S.get(id).stage, "working"); // 2h50m of 3h
    tick(w, t1 + 45 * 60000); assert.equal(S.get(id).limitStop.limit, "3h");
    // "continue" (the key, `retry`, or a reply): the run has its limit once more
    assert.match(A.retry(id).msg, /told the agent to continue/); // the action behind yes on another machine's board
    tick(w, L.runBegan(S.get(id)) + 4 * 3600000); assert.equal(S.get(id).stage, "stopped");
    assert.match(await said(["retry", id]), /told the agent to continue/);
    r = stateOf(id); assert.equal(r.stage, "working"); assert.match(paneOf(w, r).agent.prompts.at(-1), /The human said to carry on/);
    assert.equal(L.ranFor(S.get(id), L.runBegan(S.get(id)) + 1000), 1000);
    tick(w, L.runBegan(S.get(id)) + 5 * 3600000); assert.equal(S.get(id).stage, "stopped");
    A.tell(id, "Carry on, but only the first part."); assert.deepEqual([S.get(id).stage, S.get(id).limitStop], ["working", null]);
    // "take it as it is": through the check and the review like any finished turn
    tick(w, L.runBegan(S.get(id)) + 6 * 3600000); assert.equal(S.get(id).stage, "stopped");
    assert.match(await said(["finish", id]), /taking the work as it is \(after 6h\)/);
    r = S.get(id); assert.deepEqual([r.stage, r.limitStop, globalThis.__swJobs.map(([job]) => job)], ["checking", null, ["pipeline"]]); // the half-done work goes on from here like any finished turn
    assert.equal(fs.readFileSync(path.join(r.worktree, "half.txt"), "utf8"), "half done\n");
    globalThis.__swJobs = [];
  } finally { w.cleanup(); }
});

test("limit.tokens: counted when a turn ends; at the limit the task stops before anything more is spent, and your word gives it the limit once more; limit.time stops a review too", async () => {
  const w = await world();
  try {
    const id = await atWork(w, { "limit.tokens": "500k" }, { reviewer: [verdict()] });
    fs.writeFileSync(path.join(S.get(id).worktree, "f.txt"), "v1\n");
    // while it runs the count is kept for the panel, and the row says it from near the limit on
    const file = path.join(w.base, "conversation.jsonl");
    prompt(file, Date.now() - 5000); reply(file, Date.now() - 4000, 410000, "Half way.");
    S.update(id, { transcript: file });
    tick(w, Date.now() + 60000, null);
    let r = stateOf(id);
    assert.deepEqual([r.spent.total, r.limits.tokens, r.limits.near], [410000, { limit: "500k", used: 410000, kind: "claude" }, "410k of 500k tokens"]);
    // the turn ends over the limit (one turn can pass it): stopped, nothing checked or reviewed
    r = await turnEnds(w, id, 200000);
    assert.deepEqual([r.stage, r.msg, r.limitStop.what, r.limitStop.used, reviewers(w), r.reviewRound || 0], ["stopped", "stopped at 500k tokens", "tokens", 610000, 0, 0]);
    assert.equal(stateOf(id).state, "blocked");
    assert.equal(fs.readFileSync(path.join(r.worktree, "f.txt"), "utf8"), "v1\n");
    tick(w, Date.now() + 120000); await settle(id); assert.equal(S.get(id).stage, "stopped"); // not again by itself
    // "continue": the count starts from where it stopped, so the next turn is not stopped at once
    A.carryOn(id);
    r = S.get(id); assert.deepEqual([r.stage, r.limitStop, r.spent.base, L.usedOf(r)], ["working", null, 610000, 0]);
    const at = Date.now(); prompt(file, at - 1000); reply(file, at, 100000);
    assert.equal(L.tokensOver(id, "agent"), null); assert.equal(L.usedOf(S.get(id)), 100000); assert.equal(A.details(id).limits.tokens.total, 710000);
    reply(file, at + 1, 400000); assert.deepEqual(L.tokensOver(id, "agent"), { limit: "500k", used: 500000 }); // and at the limit again, it would stop again
    // A time limit is read when a run starts: set while one is under way, it is the next run's, not this one's.
    { const id3 = id; // (the same task: it has no time limit yet)
      // (Also in a run's first seconds, before anything looked at it: the change itself keeps what the run started with.)
      S.update(id3, (t) => { delete t.runLimit; });
      S.setValue("limit.time", "1s", { task: S.get(id3) }); assert.deepEqual(S.get(id3).runLimit, { from: L.runBegan(S.get(id3)), time: "none" });
      tick(w, L.runBegan(S.get(id3)) + 2000); assert.equal(S.get(id3).stage, "working");
      S.setValue("limit.time", "60s", { task: S.get(id3) });
      tick(w, L.runBegan(S.get(id3)) + 3600000); assert.deepEqual([S.get(id3).stage, L.runTime(S.get(id3)), stateOf(id3).limits?.time], ["working", "none", undefined]);
      A.tell(id3, "And one more thing."); assert.equal(L.runTime(S.get(id3)), "60s"); // a new run: now it holds
      tick(w, L.runBegan(S.get(id3)) + 61000); assert.equal(S.get(id3).msg, "stopped at its 60s limit");
      // A limit set after a review ended still counts that review: its conversation was written down, and is read now.
      const home = process.env.CLAUDE_CONFIG_DIR; process.env.CLAUDE_CONFIG_DIR = path.join(w.base, "claude");
      try {
        const dir = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", "x"); fs.mkdirSync(dir, { recursive: true });
        const id4 = await atWork(w);
        S.update(id4, (t) => { t.reviewSession = "rev-1"; t.link = { ...t.link, reviewer: { kind: "claude" } }; });
        reply(path.join(dir, "rev-1.jsonl"), Date.now(), 300000);
        assert.deepEqual(L.count(id4, "reviewer").spent, { owed: [{ kind: "claude", session: "rev-1", file: "", cwd: S.cwdOf(S.get(id4)) }] });
        S.update(id4, (t) => { t.reviewSession = null; t.link = { ...t.link, reviewer: null }; });
        S.setValue("limit.tokens", "200k", { task: S.get(id4) });
        assert.deepEqual(L.tokensOver(id4, "agent"), { limit: "200k", used: 300000 }); assert.equal(S.get(id4).spent.owed, undefined);
        // A turn the provider cut off, on a task at its limit: it is not tried again by itself. It stops.
        const cut = path.join(w.base, "cut.jsonl"), at = Date.now();
        prompt(cut, at - 1000); reply(cut, at - 500, 50000, "Working on it.");
        line(cut, { type: "assistant", uuid: `e${at}`, timestamp: new Date(at).toISOString(), isApiErrorMessage: true, error: "overloaded_error", apiErrorStatus: 529, message: { id: `err_${at}`, role: "assistant", content: [{ type: "text", text: "API Error: 529 Overloaded" }] } });
        pane(w, id4, "done", true); reported(id4, cut);
        r = await settle(id4);
        assert.deepEqual([r.stage, r.msg, r.waiting ?? null, r.limitStop.used], ["stopped", "stopped at 200k tokens", null, 350000]);
      } finally { if (home === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = home; }
    }
    // limit.time holds for the reviewer too: a review that took its time is stopped, and carrying on reviews again
    const id2 = id; A.tell(id2, "Go on.");
    S.update(id2, (t) => { t.stage = "reviewing"; t.reviewAt = Date.now(); }); // its review is under way
    assert.equal(L.limitsOf(S.get(id2), S.get(id2).reviewAt + 60000).time.used, 60000);
    tick(w, S.get(id2).reviewAt + 31 * 60000);
    r = stateOf(id2);
    assert.deepEqual([r.stage, r.state, r.note, r.limitStop.role, reviewers(w)], ["stopped", "blocked", "stopped at its 60s limit", "reviewer", 0]);
    // carry on: checked and reviewed again, a fresh run (the pipeline is started for it)
    assert.match(A.carryOn(id2).msg, /it is reviewed again/);
    r = S.get(id2); assert.deepEqual([r.stage, r.limitStop, globalThis.__swJobs.map(([job]) => job)], ["checking", null, ["pipeline"]]);
    globalThis.__swJobs = [];
  } finally { w.cleanup(); }
});

// A reviewer that is at work (its script step is `{ status: "working" }`) ends its review: its conversation says
// what it used, and its verdict is written where the board reads it. The reviewer here is Claude Code, whose
// conversation file is named by the session the board chose for it.
async function reviewEnds(w, id, tokens, findings = []) {
  assert.ok(await until(() => S.get(id).stage === "reviewing" && !!S.get(id).reviewSession && !!S.get(id).link.reviewer?.pane));
  const t = S.get(id), dir = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", "x");
  fs.mkdirSync(dir, { recursive: true });
  reply(path.join(dir, `${t.reviewSession}.jsonl`), Date.now(), tokens, "Reviewed.");
  fs.writeFileSync(path.join(F.reviewDir(t), "verdict.json"), JSON.stringify({ meets: true, text: "Looked at it.", findings, commit: F.headOf(t.worktree) }));
}

test("limit.tokens and what the board does by itself: findings do not go back, and ready work does not merge, until the limit is higher", async () => {
  const w = await world({ settings: { "merge.by": "itself", "reviewer.agent": "claude" } });
  const home = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(w.base, "claude");
  try {
    const working = { status: "working" }, id = await atWork(w, { "limit.tokens": "350k" }, { reviewer: [working, working, working] });
    const file = path.join(w.base, "conversation.jsonl");
    const ends = (tokens, text) => { fs.writeFileSync(path.join(S.get(id).worktree, "f.txt"), text); const at = Date.now(); prompt(file, at - 1000); reply(file, at, tokens); pane(w, id, "done", true); reported(id, file); return settle(id, { max: 40 }); };
    // The agent's turn ends under the limit, so its work is checked and reviewed. The reviewer's tokens are the
    // task's too, and take it over: the findings wait with the task instead of going back by themselves.
    let job = ends(300000, "v1\n");
    await reviewEnds(w, id, 60000, [bad]);
    let r = await job;
    assert.deepEqual([r.stage, r.msg, r.limitStop?.role, r.limitStop?.review, r.limitStop?.used, r.spent.total], ["stopped", "stopped at 350k tokens", "reviewer", true, 360000, 360000], JSON.stringify(r.failure));
    assert.equal(r.review.pass, false); assert.equal(stateOf(id).state, "blocked");
    const prompts = paneOf(w, r).agent.prompts.length;
    tick(w, Date.now() + 5000); await settle(id); assert.deepEqual([S.get(id).stage, paneOf(w, r).agent.prompts.length], ["stopped", prompts]);
    // a higher limit carries on by itself: the review goes to the agent, and the count goes on as it was
    S.setValue("limit.tokens", "500k", { task: S.get(id) });
    tick(w, Date.now() + 10000);
    r = S.get(id); assert.deepEqual([r.stage, r.limitStop, paneOf(w, r).agent.prompts.length, L.usedOf(r)], ["working", null, prompts + 1, 360000]); assert.match(paneOf(w, r).agent.prompts.at(-1), /Wrong/);
    // Its repair passes the review, and that review takes the task over its limit again. Also with a merge the board
    // was already on its way to: nothing merges, and the task is not ordinary approval either. It is stopped, under
    // "needs you", with what was reviewed kept.
    job = ends(100000, "v2\n");
    S.update(id, (t) => { t.mergeIntent = { approvedAt: Date.now(), repairs: 1, verifiedHead: null, auto: true }; });
    await reviewEnds(w, id, 60000);
    r = await job;
    assert.deepEqual([r.stage, r.msg, r.limitStop?.ready, r.mergeIntent, r.spent.total, r.review.pass], ["stopped", "stopped at 500k tokens", true, null, 520000, true], JSON.stringify([r.failure, r.msg]));
    assert.equal(eventOf(r), "needs you"); assert.equal(stateOf(id).state, "blocked");
    housekeeping(undefined, { force: true }); await settle(id); assert.equal(S.get(id).stage, "stopped"); assert.ok(!fs.existsSync(path.join(w.root, "f.txt")));
    // a higher limit carries on by itself: the work is put up as it was reviewed, and now it may merge by itself
    S.setValue("limit.tokens", "none", { task: S.get(id) });
    tick(w, Date.now() + 20000);
    r = S.get(id); assert.deepEqual([r.stage, r.limitStop, /^Approve to merge\? Review: Pass/.test(r.msg)], ["approval", null, true]); assert.ok(green(r));
    // Reviewed work with nothing to land (review.when always, no change in the repo) stops at the limit as well,
    // instead of ending as done; carrying on is what ends it.
    const plain = await atWork(w, { "limit.tokens": "1k", "review.when": "always" }, { reviewer: [{ status: "working" }] });
    const said2 = path.join(w.base, "plain.jsonl"), now = Date.now();
    prompt(said2, now - 1000); reply(said2, now, 500); pane(w, plain, "done", true); reported(plain, said2);
    job = settle(plain, { max: 40 });
    await reviewEnds(w, plain, 1510);
    r = await job;
    assert.deepEqual([r.stage, r.msg, r.limitStop?.ready, r.spent.total, eventOf(r)], ["stopped", "stopped at 1k tokens", true, 2010, "needs you"], JSON.stringify([r.failure, r.msg]));
    assert.match(A.carryOn(plain).msg, /it is done/); r = S.get(plain); assert.deepEqual([r.stage, r.limitStop, /Pass/.test(r.msg)], ["done", null, true]);
    globalThis.__swJobs = [];
  } finally { if (home === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = home; w.cleanup(); }
});
