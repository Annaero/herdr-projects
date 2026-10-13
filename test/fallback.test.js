// The fallback agent (`worker.fallback`, `reviewer.fallback`; docs/fallback.md): the next agent on the list takes a
// task over when the one on it cannot go on, in the same worktree, with what was done and what is open. Nobody extra
// runs until then, and with the list used up the task waits for you as before.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { world, fastClock, settle, stateOf, paneOf } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { housekeeping } from "../src/housekeeping.js";
import { main } from "../src/cli.js";
import { rules } from "../src/coordinator.js";
import { usable } from "../src/finish/hand-over.js";
import { reviewerNow, nextReviewer } from "../src/finish/review-fallback.js";
import { stripVTControlCharacters } from "node:util";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";

const ENV = ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "PI_CODING_AGENT_DIR", "HERDR_SUPERWORK_RETRY_MS", "HERDR_SUPERWORK_ENDED_MS", "HERDR_SUPERWORK_QUIET_MS"];
// A world whose agent programs keep their conversations inside it, and whose waits are short (as test/retry.test.js).
async function cutWorld(waits, settings = {}) {
  const w = await world({ settings });
  const before = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { CODEX_HOME: path.join(w.base, "codex"), CLAUDE_CONFIG_DIR: path.join(w.base, "claude"), PI_CODING_AGENT_DIR: path.join(w.base, "pi"), HERDR_SUPERWORK_RETRY_MS: waits, HERDR_SUPERWORK_ENDED_MS: "0", HERDR_SUPERWORK_QUIET_MS: "60" });
  w.patchState((s) => { s.pids = true; }); // an agent is a process of its own here, which the board can end
  const end = w.cleanup;
  w.cleanup = () => { for (const k of ENV) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } end(); };
  return w;
}
const WORK = { files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." };
const PASS = { verdict: { meets: true, findings: [], text: "Looks right." } };
const FAIL = { verdict: { meets: false, findings: [{ severity: "major", subject: "The file says v1, the task asked for v2", where: "f.txt:1", proof: "cat f.txt" }], text: "Not what was asked." } };
const starts = (w) => w.state().calls.filter((c) => c.startsWith("agent start") && !/^agent start \S+-r /.test(c)).map((c) => c.split(" ")[4]);
const reviewerStarts = (w) => w.state().calls.filter((c) => /^agent start \S+-r /.test(c)).map((c) => c.split(" ")[4]);

test("out of allowance: the next agent on the list takes the task over in the same worktree and pane, and is told what was done", async () => {
  const w = await cutWorld("30,30", { "worker.fallback": ["codex", "pi"] });
  try {
    w.script({ worker: [{ files: { "half.txt": "half\n" }, commit: "half the work", ends: "claude-usage-limit-made" }, { status: "working" }] });
    const id = A.add(w.root, "Runs out").id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "working", JSON.stringify(t.failure));
    assert.deepEqual(starts(w), ["claude", "codex"]);
    assert.deepEqual([t.agent, t.on, t.app], ["codex", "codex", "codex"]);
    assert.equal(S.handovers(t).length, 1);
    assert.equal(S.handoverLine(S.handovers(t)[0]), "codex took over from claude: out of allowance until 17:00");
    const told = paneOf(w, t).agent.prompts[0];
    assert.match(told, /^Work board task proj\/1, role: agent\.\n\nRuns out/);
    assert.match(told, /taking this task over from another agent \(claude\), which could not go on: out of allowance until 17:00\./);
    assert.match(told, /Its commits on this branch so far, newest first:\n- [0-9a-f]+ half the work/);
    // the same worktree, branch and pane: the first agent's commit is what the second one starts from
    assert.equal(w.state().calls.filter((c) => /^worktree create/.test(c)).length, 1);
    assert.equal(S.gitOut(t.worktree, ["log", "--format=%s", `${t.baseSha}..HEAD`]), "half the work"); assert.equal(paneOf(w, t).cwd, t.worktree);
    // the tab and herdr's sidebar name the agent that is on it now; `details` keeps who did what
    assert.ok(w.state().calls.includes(`tab rename ${t.link.tab} Agent (codex)`)); assert.match(F.entryNow(t).where, /^agent codex · /); assert.ok(w.state().calls.some((c) => c.includes("--display-agent agent codex · ")), w.state().calls.filter((c) => c.includes("--display-agent")).join(" | "));
    const d = A.details(id);
    assert.equal(d.agent, "codex"); assert.deepEqual(d.handovers.map((h) => [h.role, h.from, h.to, h.words]), [["worker", "claude", "codex", "codex took over from claude: out of allowance until 17:00"]]);
    // the task panel says it, whole, and names the list among its settings
    const v = new View({ terminal: { rows: 60, columns: 130 }, requestRender() {}, stop() {}, start() {} }, theme, () => {}, { cwd: w.root, canReload: true });
    clearInterval(v.timer);
    const panel = v.panel(stateOf(id), 100, true).map((l) => stripVTControlCharacters(l)).join("\n");
    assert.match(panel, / On it +codex\n Took over +codex took over from claude: out of allowance until 17:00 · \d+s ago\n/);
    assert.match(panel, / Agent +codex 9\.9\.9 · default model · default effort\n Takes over +codex, then pi · when the agent cannot go on\n/);
    // with nobody left the panel's note says who was passed over
    S.update(id, (t) => { t.fallbacks = { worker: S.nobodyLeft("worker.fallback", ["pi is not installed here"]) }; });
    assert.match(v.panel(stateOf(id), 100, true).map((l) => stripVTControlCharacters(l)).join("\n"), / Note +worker\.fallback: nobody left to take over \(pi is not installed here\)/);
  } finally { w.cleanup(); }
});

test("the order: a cut-off turn is tried again by the board first; the fallback comes when that has not helped", async () => {
  const w = await cutWorld("60000", { "worker.agent": "pi", "worker.fallback": "codex" });
  try {
    w.script({ worker: [{ ends: "pi-overloaded" }, { ends: "pi-overloaded" }, { status: "working" }] });
    const id = A.add(w.root, "Overloaded").id;
    A.delegate(id);
    let t = await settle(id);
    // first the board's own wait: nobody took over yet
    assert.equal(S.waitingOf(t).tries, 1); assert.deepEqual(starts(w), ["pi"]); assert.deepEqual(S.handovers(t), []);
    S.update(id, (t) => { t.waiting = { ...t.waiting, until: Date.now() - 1 }; });
    housekeeping(w.socket, { force: true });
    t = await settle(id);
    assert.equal(t.stage, "working", JSON.stringify(t.failure));
    assert.deepEqual(starts(w), ["pi", "codex"]);
    assert.equal(S.handoverLine(S.handovers(t)[0]), "codex took over from pi: its provider is overloaded, still after 2 tries");
  } finally { w.cleanup(); }
});

test("logged out: the next one takes over; the list is gone through in order, and used up the task waits for you as before", async () => {
  const w = await cutWorld("30", { "worker.fallback": "claude, codex, pi" });
  try {
    w.script({ worker: [{ ends: "claude-model-not-found" }, { ends: "codex-unauthorized" }, { ends: "pi-unknown-provider" }] });
    const id = A.add(w.root, "Nobody can").id;
    A.delegate(id);
    let t = await settle(id);
    assert.deepEqual(starts(w), ["claude", "codex", "pi"]); // claude itself is on the list: it is not handed to itself
    assert.deepEqual(S.handovers(t).map((h) => S.handoverLine(h)), ["codex took over from claude: its model is not available", "pi took over from codex: logged out"]);
    assert.equal(t.stage, "failed"); assert.match(t.msg, /^Agent stopped: /); assert.equal(stateOf(id).state, "error");
    assert.equal(t.fallbacks.worker, "worker.fallback: nobody left to take over (claude was on it already; codex was on it already; pi was on it already)");
    // you step in: the one that is on it carries on, and the list may be gone through again, from its start
    assert.deepEqual(t.tried, ["claude", "codex", "pi"]);
    w.script({ worker: [{ status: "working" }] });
    A.tell(id, "try again");
    t = S.get(id);
    assert.deepEqual([t.agent, t.on, t.tried, t.fallbacks.worker], ["pi", "pi", [], undefined]);
    assert.equal(S.nextFallback(S.setting("worker.fallback", t), { on: S.onNow(t), tried: t.tried }).agent, "claude");
  } finally { w.cleanup(); }
});

test("an agent that is not installed here, or cannot ask where the access says ask, is passed over", async () => {
  const w = await world();
  try {
    assert.deepEqual([usable("codex"), usable("pi", "ask"), usable("claude", "ask")], ["", 'pi cannot ask before it acts, and the access is "ask"', ""]);
    S.writeJson(path.join(S.dataDir(), "versions.json"), { ...S.readJson(path.join(S.dataDir(), "versions.json")), codex: { v: "", at: Date.now(), found: false } });
    assert.equal(usable("codex/gpt-5.5"), "codex is not installed here");
    const next = S.nextFallback(["pi", "codex", "claude/claude-opus-5-5"], { on: "claude", usable: (a) => usable(a, "ask") });
    assert.deepEqual(next, { agent: "claude/claude-opus-5-5", skipped: ['pi cannot ask before it acts, and the access is "ask"', "codex is not installed here"] });
    assert.equal(S.nobodyLeft("worker.fallback", next.skipped), 'worker.fallback: nobody left to take over (pi cannot ask before it acts, and the access is "ask"; codex is not installed here)');
    // the reviewer whose program is not installed here is stood in for by the first on its list that is; without a list nothing changes
    const ch = { "reviewer.agent": "codex", "reviewer.fallback": ["codex/gpt-5.5", "pi"], "reviewer.access": "full" };
    assert.deepEqual(reviewerNow({}, ch), { agent: "pi", standIn: "codex" }); assert.deepEqual(reviewerNow({}, { ...ch, "reviewer.fallback": "none" }), { agent: "codex", standIn: "" });
    assert.deepEqual(reviewerNow({ reviewerOn: "claude" }, ch), { agent: "claude", standIn: "" }); // one that took over earlier on this task reviews
  } finally { w.cleanup(); }
});

test("a fallback that cannot be started changes nothing: the agent, its failure and the rounds it used are as they were", async () => {
  const w = await cutWorld("30", { "worker.fallback": "codex" });
  const own = globalThis.__swHerdr, run = own.run;
  try {
    // herdr cannot start codex here
    own.run = (args, env) => (args[0] === "agent" && args[1] === "start" && args.includes("codex") ? { status: 1, stdout: JSON.stringify({ id: "fake", error: { code: "spawn_failed", message: "program will not start" } }), stderr: "" } : run(args, env));
    w.script({ worker: [{ ends: "claude-usage-limit-made" }] });
    const id = A.add(w.root, "Cannot start").id;
    A.delegate(id);
    S.update(id, (t) => { t.reviewRounds = 2; t.checkFails = 1; });
    const t = await settle(id);
    assert.equal(t.stage, "failed"); assert.match(t.msg, /^Agent stopped: You've hit your session limit/);
    assert.deepEqual([t.agent, t.on ?? null, S.handovers(t), t.reviewRounds, t.checkFails], ["claude", null, [], 2, 1]);
    assert.match(t.fallbacks.worker, /^worker\.fallback: nobody left to take over \(codex could not be started \(/);
  } finally { own.run = run; w.cleanup(); }
});

test("work that still fails its review after `review.rounds` rounds goes to the next agent, with the open findings and its own rounds", async () => {
  const w = await cutWorld("30", { "worker.fallback": "codex", "review.rounds": 1 });
  try {
    w.script({ worker: [WORK, { note: "Tried." }, { status: "working" }], reviewer: [FAIL, FAIL] });
    const id = A.add(w.root, "Stuck").id;
    A.delegate(id);
    const t = await settle(id, { max: 40 });
    assert.equal(t.stage, "working", JSON.stringify(t.failure));
    assert.deepEqual(starts(w), ["claude", "codex"]);
    assert.equal(S.handoverLine(S.handovers(t)[0]), "codex took over from claude: its work still failed review after 1 round");
    const told = paneOf(w, t).agent.prompts[0];
    assert.match(told, /The last review of this work failed \(Fail · 1 critical\), and what it found is still open:\n\nNot what was asked\.\n\nRequired: fix each of these\.\n- \[critical\] The change does not do what the task asked\./);
    assert.match(told, /Its last message was:\nTried\./);
    // every review is on the list, and the new agent's rounds were its own
    assert.deepEqual(S.reviewHistory(t).map((e) => [e.round, e.by, e.pass]), [[1, "codex", false], [2, "codex", false]]); assert.equal(t.reviewRounds, 0); assert.equal(t.review.stale, true);
  } finally { w.cleanup(); }
});

test("`review.rounds 0` hands nothing over for a failed review, and a check that still fails after its rounds does", async () => {
  const w = await cutWorld("30", { "worker.fallback": "codex", "reviewer.fallback": "claude", "review.rounds": 0 });
  try {
    w.script({ worker: [WORK], reviewer: [FAIL] });
    const id = A.add(w.root, "Waits for you").id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "approval"); assert.deepEqual(S.handovers(t), []); assert.equal(t.on ?? null, null);
    assert.deepEqual([starts(w), reviewerStarts(w)], [["claude"], ["codex"]]); // and nobody extra ran: one agent, one reviewer
    // reviewed again with codex not installed here: the first on the list that is reviews, which is a hand-over like any other
    S.writeJson(path.join(S.dataDir(), "versions.json"), { ...S.readJson(path.join(S.dataDir(), "versions.json")), codex: { v: "", at: Date.now(), found: false } });
    w.script({ worker: [{ note: "Fixed." }], reviewer: [PASS] });
    A.tell(id, "fix it");
    const again = await settle(id);
    assert.equal(again.stage, "approval", JSON.stringify(again.failure)); assert.equal(reviewerStarts(w).at(-1), "claude");
    assert.deepEqual([again.reviewerOn, S.handovers(again).map((h) => S.handoverLine(h)), S.reviewHistory(again).at(-1).by], ["claude", ["claude took over the review from codex: codex is not installed here"], "claude"]);
    S.writeJson(path.join(S.dataDir(), "versions.json"), { ...S.readJson(path.join(S.dataDir(), "versions.json")), codex: { v: "9.9.9", at: Date.now(), found: true } });
    // the repo's check: it went back once (this task's own `review.rounds 1`), and still fails
    w.script({ worker: [{ note: "Done 2." }, { status: "working" }] });
    const id2 = A.add(w.root, "Check fails").id;
    A.delegate(id2, { "check.command": "test -f good.txt", "review.rounds": 1, "review.when": "never" });
    S.update(id2, (t) => { t.checkFails = 1; }); // as after its one round: the check failed once and went back
    const t2 = await settle(id2, { max: 30 });
    assert.equal(t2.stage, "working", JSON.stringify(t2.failure)); assert.equal(t2.checkFails, 0);
    assert.deepEqual(starts(w), ["claude", "claude", "codex"]);
    assert.equal(S.handoverLine(S.handovers(t2)[0]), "codex took over from claude: the check still failed after 2 tries");
    assert.match(paneOf(w, t2).agent.prompts[0], /The check still fails, so this is not done yet\.[\s\S]*Command: test -f good\.txt/);
  } finally { w.cleanup(); }
});

test("it is read when the hand-over happens: set on a task that is under way, it counts, and the row says it; the agent that took over stays on it when it is started again", async () => {
  const w = await cutWorld("30");
  try {
    w.script({ worker: [{ note: null, screen: "half way\n> " }] }); // its first turn stops without a summary: no review yet
    const id = A.add(w.root, "Under way").id;
    A.delegate(id);
    await settle(id);
    S.setValue("worker.fallback", "codex/gpt-5.5", { task: S.get(id) });
    // its next turn ends in the provider's error
    w.script({ worker: [{ ends: "claude-usage-limit-made" }, { status: "working" }] });
    A.tell(id, "one more thing");
    let t = await settle(id);
    assert.deepEqual([t.agent, t.on, t.stage], ["codex", "codex/gpt-5.5", "working"]);
    // the row says it while the new agent gets going, and names the program that is on it now
    const row = stateOf(id);
    assert.deepEqual([row.state, row.note, row.app], ["working", "codex took over from claude: out of allowance until 17:00", "codex"]);
    assert.match(w.state().calls.findLast((c) => c.startsWith("agent start")), /--kind codex .*gpt-5\.5/);
    // its program exits; a reply starts codex again, on its model, not `worker.agent`
    w.patchState((s) => { for (const p of s.panes) p.agent = null; });
    w.script({ worker: [{ status: "working" }] });
    A.tell(id, "carry on");
    t = await settle(id);
    assert.equal(t.agent, "codex"); assert.match(w.state().calls.findLast((c) => c.startsWith("agent start")), /--kind codex .*gpt-5\.5/);
    // a new start from the board is `worker.agent` again
    A.stop(id);
    w.patchState((s) => { for (const p of s.panes) p.agent = null; });
    A.delegate(id);
    assert.equal(S.get(id).on, null); assert.equal(S.get(id).agent, "claude");
  } finally { w.cleanup(); }
});

test("the reviewer: the board's own tries first, then the next on `reviewer.fallback` reviews, as the same review; with nobody left nothing is handed over", async (tt) => {
  const clock = fastClock(tt);
  const w = await cutWorld("600", { "reviewer.fallback": "claude, pi" });
  try {
    // codex is cut off by an error that passes, twice: tried again first, then claude reviews. Claude's model is not
    // there: pi at once, and pi reviews.
    w.script({ worker: [WORK], reviewer: [{ ends: "codex-at-capacity", hook: true }, { ends: "codex-at-capacity", hook: true }, { ends: "claude-model-not-found" }, PASS] });
    const id = A.add(w.root, "Reviewer is down").id;
    A.delegate(id);
    const t = await clock(settle(id, { max: 40 }));
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    assert.deepEqual(reviewerStarts(w), ["codex", "codex", "claude", "pi"]);
    assert.deepEqual(S.handovers(t).map((h) => [h.role, S.handoverLine(h)]), [["reviewer", "claude took over the review from codex: its model is at capacity, still after 2 tries"], ["reviewer", "pi took over the review from claude: its model is not available"]]);
    assert.ok(w.state().calls.some((c) => /^tab create .*Reviewer #1 \(claude\)/.test(c)), w.state().calls.filter((c) => c.startsWith("tab create")).join(" | "));
    // the three that were cut off reviewed nothing: the one that took over last made review 1, and the history says who
    assert.deepEqual(S.reviewHistory(t).map((e) => [e.round, e.by, e.pass]), [[1, "pi", true]]);
    assert.equal(t.reviewerOn, "pi"); // and it reviews the later rounds of this task too (reviewerNow)
    // nobody left on the list: nothing is handed over, the task says who was passed over, and the review fails as before
    const held = { ...t }, g = { set: (fn) => fn(held) };
    assert.equal(nextReviewer(g, S.work(t), { from: "pi", cut: { error: "401 Unauthorized", passing: false }, auth: true, tried: ["codex", "claude"] }), "");
    assert.equal(held.fallbacks.reviewerLeft, "reviewer.fallback: nobody left to take over (claude was on it already; pi was on it already)"); assert.equal(S.handovers(held).length, 2);
  } finally { w.cleanup(); }
});

test("a real setting: the one lookup, set and unset in every place, refused values, never the repo's own file, add, delegate and automations", async () => {
  const w = await world({ repoSettings: { worker: { fallback: ["codex"] }, reviewer: { fallback: "claude" }, check: { command: "true" } } });
  const run = async (...args) => { let out = ""; const write = process.stdout.write; process.stdout.write = (x, ...r) => (typeof x === "string" ? ((out += x), true) : write.call(process.stdout, x, ...r)); try { await main(args); } finally { process.stdout.write = write; } return out; };
  const fails = async (...args) => { try { await run(...args); } catch (e) { return e.message; } return ""; };
  try {
    for (const name of ["worker.fallback", "reviewer.fallback"]) { const e = S.entryOf(name); assert.deepEqual([e.kind, e.type, e.builtin, !!e.repo], ["work", "agents", "none", false], name); }
    // the repo's own file may not say it: code an agent writes cannot switch it on or off
    const file = S.repoFile(w.root, "HEAD");
    assert.deepEqual(file.facts, { "check.command": "true" });
    for (const name of ["worker.fallback", "reviewer.fallback"]) assert.ok(file.refused.some((r) => r.startsWith(`.herdr-superwork.json: ${name} is refused: the repo's file may only hold`)), name);
    const id = A.add(w.root, "One").id;
    assert.deepEqual([S.lookup("worker.fallback", { task: S.get(id) }).value, S.lookup("worker.fallback", { task: S.get(id) }).from], ["none", "built in"]);
    // you -> your entry for the repo -> the task: the nearest answer wins, and each can be taken away again
    assert.equal(await run("set", "worker.fallback", "codex,", "claude/claude-opus-5-5"), "worker.fallback: codex, claude/claude-opus-5-5  (you)\n");
    assert.deepEqual(S.setting("worker.fallback", S.get(id)), ["codex", "claude/claude-opus-5-5"]);
    assert.equal(await run("set", "worker.fallback", "pi", "--repo", "proj"), "worker.fallback for proj: pi  (your entry for proj)\n");
    assert.deepEqual(S.setting("worker.fallback", S.get(id)), ["pi"]);
    assert.equal(await run("set", "worker.fallback", "none", "--task", id), `worker.fallback for ${id}: none  (this task)\n`);
    assert.equal(S.setting("worker.fallback", S.get(id)), "none"); assert.deepEqual(S.listOf(S.setting("worker.fallback", S.get(id))), []);
    assert.match(await run("show", id), /\n\* worker\.fallback +none +this task\n/);
    assert.equal(await run("unset", "worker.fallback", "--task", id), `worker.fallback for ${id}: pi  (your entry for proj)\n`);
    assert.match(await run("show", id), /\n {2}worker\.fallback +pi +your entry for proj\n[\s\S]*\n {2}reviewer\.fallback +none +built in\n/);
    assert.equal(await run("unset", "worker.fallback", "--repo", "proj"), "worker.fallback for proj: codex, claude/claude-opus-5-5  (you)\n");
    assert.match(await run("show"), /\n\* worker\.fallback +codex, claude\/claude-opus-5-5 +you\n/);
    // a refused value changes nothing and names the nearest right one
    assert.match(await fails("set", "worker.fallback", "codx"), /worker\.fallback: no agent program "codx"\. It must be claude, codex, pi\. Did you mean codex\?/);
    assert.match(await fails("set", "worker.fallback", "codex, none"), /none stands alone/);
    assert.match(await fails("set", "worker.fallbak", "codex"), /Unknown setting "worker\.fallbak"\. Did you mean worker\.fallback\?/);
    assert.match(await fails("set", "reviewer.fallback", "claude/bad model"), /reviewer\.fallback/);
    assert.deepEqual(S.setting("worker.fallback"), ["codex", "claude/claude-opus-5-5"]); assert.equal(S.setting("reviewer.fallback"), "none");
    // a list that only names the agent that is on it anyway says that it does nothing
    assert.equal(await run("set", "worker.fallback", "claude", "--task", id), `worker.fallback for ${id}: claude  (this task)\ndoes nothing: claude is the agent already\n`);
    // passed to add and delegate, and held by an automation
    await run("add", "Two", "--repo", w.root, "--delegate", "--worker.fallback", "pi, codex", "--reviewer.fallback", "claude");
    assert.deepEqual(S.list().find((t) => t.title === "Two").settings, { "worker.fallback": ["pi", "codex"], "reviewer.fallback": ["claude"] });
    assert.match(await fails("delegate", id, "--worker.fallback", "nobody"), /no agent program "nobody"/); assert.equal(S.get(id).stage, "todo");
    await run("delegate", id, "--worker.fallback", "codex");
    assert.deepEqual(S.get(id).settings["worker.fallback"], ["codex"]);
    await run("automations", "add", "Nightly", "--prompt", "Do it.", "--schedule", "daily 02:00", "--worker.fallback", "codex, pi");
    assert.deepEqual(S.automation("nightly").settings, { "worker.fallback": ["codex", "pi"] });
    assert.equal(await run("set", "reviewer.fallback", "claude", "--automation", "Nightly"), 'reviewer.fallback for "Nightly": claude  (this automation)\nIt applies from its next firing.\n');
    // a hand-written file: a wrong list is said with its setting's name, and that one setting is not counted
    S.writeJson(S.configFile(), { "worker.fallback": ["codex", 7], "reviewer.fallback": "pi claude" });
    assert.equal(S.setting("worker.fallback"), "none"); assert.deepEqual(S.setting("reviewer.fallback"), ["pi", "claude"]);
    assert.ok(S.settingProblems().some((x) => /^your settings: worker\.fallback is a list of agents/.test(x)), S.settingProblems().join(" | "));
  } finally { w.cleanup(); }
});

test("the settings page and the Coordinator's rules say it in plain words; the words for why an agent could not go on", async () => {
  const w = await world();
  try {
    const id = A.add(w.root, "Page").id;
    const v = new View({ terminal: { rows: 60, columns: 140 }, requestRender() {}, stop() {}, start() {} }, theme, () => {}, { cwd: w.root, canReload: true });
    clearInterval(v.timer);
    v.editing = { id, at: 0, typing: "" };
    const rows = v.editRows(stateOf(id)), at = rows.findIndex((x) => x.name === "worker.fallback");
    assert.ok(at > 0 && rows.some((x) => x.name === "reviewer.fallback"));
    v.editing.at = at;
    const page = v.settingsPage(stateOf(id), 140).map((l) => stripVTControlCharacters(l)).join("\n");
    assert.match(page.replace(/\n */g, " "), /Agent's fallback: programs \(claude, codex or pi\), each with a model after a slash if you like, in the order they are tried, with commas between them; none for none/);
    assert.match(page, /› {3}Agent's fallback +none +built in +worker\.fallback *\n/); assert.match(page, /Reviewer's fallback +none +built in +reviewer\.fallback\n/);
    v.editSave(stateOf(id), "worker.fallback", "codex, pi");
    assert.deepEqual(S.get(id).settings["worker.fallback"], ["codex", "pi"]);
    assert.throws(() => v.editSave(stateOf(id), "worker.fallback", "codex, nobody"), /no agent program "nobody"/);
    const told = rules("board");
    assert.match(told, /worker\.fallback and reviewer\.fallback: a list of agents tried in order/);
    assert.match(told, /"if Claude runs out, let Codex finish it": board set worker\.fallback codex/);
  } finally { w.cleanup(); }
  const at = new Date(2026, 9, 13, 14, 0).getTime();
  for (const [error, why] of [["You've hit your session limit · resets 5pm", "out of allowance until 17:00"], ["Claude usage limit reached. Your limit will reset at 3:30pm.", "out of allowance until 15:30"],
    ["You've hit your usage limit. Try again in 2 hours 15 minutes.", "out of allowance until 16:15"], ["usage limit reached, resets at 09:05", "out of allowance until 09:05"], ["Your credit balance is too low", "out of allowance"],
    ["The model gpt-9 does not exist or you do not have access to it.", "its model is not available"], ["Something odd.", "it stopped (Something odd)"]]) assert.equal(S.whyOf({ error }, at), why, error);
  assert.equal(S.whyOf({ error: "401 Unauthorized", auth: true }), "logged out");
  assert.equal(S.whyOf({ error: "x", passing: true, reason: "connection dropped", tries: 5 }), "its connection dropped, still after 5 tries");
  assert.equal(S.handoverLine({ role: "worker", from: "claude/claude-sonnet-5-5", to: "claude/claude-opus-5-5", why: "out of allowance" }), "claude/claude-opus-5-5 took over from claude/claude-sonnet-5-5: out of allowance");
  // the next on the list: never the one that is on it, never one that was on it since you stepped in
  assert.deepEqual(S.nextFallback(["claude", "codex", "pi"], { on: "claude", tried: ["codex"] }), { agent: "pi", skipped: ["claude was on it already", "codex was on it already"] });
  assert.equal(S.nextFallback("none", { on: "claude" }).agent, "");
});
