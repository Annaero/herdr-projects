// Fast mode: the `fast` and `reviewerFast` settings, and what an agent or reviewer is started with.
import test from "node:test";
import assert from "node:assert/strict";
import { main } from "../src/cli.js";
import { stripVTControlCharacters } from "node:util";
import { world, settle } from "./helpers.js";
import { open } from "./board-helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { startArgs, hasFast } from "../src/agents.js";

const FAST = ["-c", 'service_tier="fast"'];
const SLOW = ["-c", 'service_tier="default"'];
const hasPair = (args) => args.some((a, i) => a === FAST[0] && args[i + 1] === FAST[1]);

test("fast mode: only Codex has one, and its argument comes after the model and effort", async () => {
  const w = await world();
  try {
    assert.equal(hasFast("codex"), true); assert.equal(hasFast("claude"), false); assert.equal(hasFast("pi"), false); assert.equal(hasFast("something-else"), false);
    assert.deepEqual(startArgs("codex", { model: "gpt-x", effort: "high", fast: true }).slice(-6), ["-m", "gpt-x", "-c", 'model_reasoning_effort="high"', ...FAST]);
    assert.ok(!hasPair(startArgs("codex", { fast: false }))); assert.ok(!startArgs("codex").join(" ").includes("service_tier"));
    assert.deepEqual(startArgs("codex", { resume: "abc", fast: true }).slice(0, 2), ["resume", "abc"]); // a resumed session is fast too
    assert.ok(hasPair(startArgs("codex", { resume: "abc", fast: true })));
    // the setting is the one switch: off names the default tier last, so it wins over a tier in Codex's own config
    // file; a caller that says nothing leaves Codex's setting alone
    assert.deepEqual(startArgs("codex", { fast: false }).slice(-2), SLOW);
    // access: full access by default; `ask` leaves the permission flags out; a program that cannot ask is refused
    assert.deepEqual(startArgs("codex"), ["--dangerously-bypass-approvals-and-sandbox", "--no-daemon"]); assert.deepEqual(startArgs("codex", { access: "ask" }), ["--no-daemon"]);
    assert.deepEqual(startArgs("claude"), ["--dangerously-skip-permissions"]); assert.deepEqual(startArgs("claude", { access: "ask" }), []);
    assert.throws(() => startArgs("pi", { access: "ask" }), /pi cannot be started with access "ask": it never asks before it acts/);
    // effort: `default` and a level the program does not take are not passed on
    assert.deepEqual(startArgs("claude", { effort: "default", access: "ask" }), []); assert.deepEqual(startArgs("claude", { effort: "minimal", access: "ask" }), []); assert.deepEqual(startArgs("claude", { effort: "max", access: "ask" }), ["--effort", "max"]);
    // a kind with no fast mode starts exactly as it does without the setting
    for (const kind of ["claude", "pi", "something-else"]) assert.deepEqual(startArgs(kind, { model: "m", fast: true }), startArgs(kind, { model: "m" }));
  } finally { w.cleanup(); }
});

test("fast mode: the reviewer's is on by default, the agent's is off, and either can be chosen for one task", async () => {
  const w = await world();
  try {
    assert.equal(S.setting("reviewer.fast"), true); assert.equal(S.setting("worker.fast"), false);
    const id = A.add(w.root, "Something").id;
    const mine = () => [S.setting("worker.fast", S.get(id)), S.setting("reviewer.fast", S.get(id))];
    assert.deepEqual(mine(), [false, true]);
    assert.equal(S.setValue("reviewer.fast", "off", { task: S.get(id) }).value, false); assert.equal(S.setValue("worker.fast", "on", { task: S.get(id) }).value, true);
    assert.equal(S.setValue("reviewer.fast", "false").value, false); assert.equal(S.setValue("worker.fast", "true").value, true);
    assert.equal(S.unsetValue("reviewer.fast", { task: S.get(id) }).value, false); assert.equal(S.unsetValue("worker.fast", { task: S.get(id) }).value, true); // back to yours
    assert.equal(S.unsetValue("reviewer.fast").value, true); assert.equal(S.unsetValue("worker.fast").value, false);
    assert.deepEqual(mine(), [false, true]);
    assert.throws(() => S.setValue("worker.fast", "maybe"), /worker\.fast is a switch: true or false \(yes, no, on and off work too\), not "maybe"/); // never silently false
  } finally { w.cleanup(); }
});

test("fast mode: a Codex reviewer is started in it, and not when it is turned off for the task", async () => {
  const w = await world();
  try {
    const review = { verdict: { meets: true, text: "Fine.", findings: [] } };
    const started = (name) => w.state().calls.filter((c) => c.startsWith(`agent start ${name} `)).at(-1);
    w.script({ worker: [{ files: { "a.txt": "a\n" }, note: "Done." }, { files: { "b.txt": "b\n" }, note: "Done." }], reviewer: [review, review] });
    const one = A.add(w.root, "First").id;
    A.delegate(one); assert.equal((await settle(one)).stage, "approval");
    assert.match(started("sw-proj-1-r"), /--kind codex .* -c service_tier="fast"/);
    assert.doesNotMatch(started("sw-proj-1"), /service_tier/); // the working agent is Claude Code, and `fast` is off anyway
    const two = A.add(w.root, "Second").id;
    A.delegate(two, { "reviewer.fast": false }); assert.equal((await settle(two)).stage, "approval");
    assert.match(started("sw-proj-2-r"), /--kind codex .* -c service_tier="default"/); assert.doesNotMatch(started("sw-proj-2-r"), /service_tier="fast"/);
  } finally { w.cleanup(); }
});

test("fast mode: a Codex working agent is started in it when `fast` is on", async () => {
  const w = await world({ settings: { "worker.agent": "codex", "worker.fast": true, "review.when": "never" } });
  try {
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Work fast").id;
    A.delegate(id); const t = await settle(id);
    assert.ok(hasPair(w.state().panes.find((p) => p.pane_id === t.link.pane).agent.args));
  } finally { w.cleanup(); }
});

test("fast mode: the command and the task panel say where it does nothing", async () => {
  const w = await world();
  try {
    const sw = async (...args) => { let out = ""; const write = process.stdout.write; process.stdout.write = (x, ...r) => (typeof x === "string" ? ((out += x), true) : write.call(process.stdout, x, ...r)); /* the test runner writes its own records there too */ try { await main(args); } finally { process.stdout.write = write; } return out; };
    const id = A.add(w.root, "Something").id;
    assert.match(await sw("set", "worker.fast", "on"), /worker\.fast: true {2}\(you\)\ndoes nothing: claude has no fast mode/);
    assert.equal(JSON.parse(await sw("set", "worker.fast", "on", "--json")).note, "does nothing: claude has no fast mode");
    assert.doesNotMatch(await sw("set", "reviewer.fast", "on"), /no fast mode/); // the reviewer is Codex
    S.setValue("reviewer.agent", "claude", { task: S.get(id) });
    assert.match(await sw("set", "reviewer.fast", "on", "--task", "1"), /reviewer\.fast for proj\/1: true {2}\(this task\)\ndoes nothing: claude has no fast mode/);
    assert.match(await sw("show", "1"), /\* reviewer\.fast +true +does nothing: claude has no fast mode/);
    assert.doesNotMatch(await sw("set", "worker.fast", "off"), /no fast mode/);
    // the panel: "fast" where it is on, a note where it is on and does nothing, whether the task chose it or inherits it
    const s = open(w);
    const row = (t, label) => stripVTControlCharacters(s.v.panel({ owner: "me", ...S.get(t) }, 80, true).join("\n")).split("\n").find((l) => l.startsWith(` ${label} `));
    assert.match(row(id, "Reviewer"), /claude · default model · default effort · no fast mode in claude( \*)?$/);
    assert.match(row(id, "Agent"), /^ Agent +claude · default model · default effort$/);
    const other = A.add(w.root, "Other").id;
    assert.match(row(other, "Reviewer"), /codex · default model · default effort · fast$/);
    S.setValue("reviewer.agent", "pi", { task: S.get(other) }); assert.match(row(other, "Reviewer"), /pi · default model · default effort · no fast mode in pi \*$/);
    S.setValue("reviewer.fast", "off"); assert.match(row(other, "Reviewer"), /pi · default model · default effort \*$/); S.unsetValue("reviewer.fast");
    S.setValue("worker.agent", "codex", { task: S.get(other) }); S.setValue("worker.fast", "on", { task: S.get(other) }); assert.match(row(other, "Agent"), /codex · default model · default effort · fast \*$/);
  } finally { w.cleanup(); }
});
