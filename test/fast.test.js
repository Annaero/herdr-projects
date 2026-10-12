// Fast mode: the `fast` and `reviewerFast` settings, and what an agent or reviewer is started with.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
    // the setting is the one switch: off names the default tier last, so it wins over a tier in your own agentArgs
    // in any spelling (and over Codex's own config file); a caller that says nothing leaves Codex's setting alone
    assert.deepEqual(startArgs("codex", { fast: false }).slice(-2), SLOW);
    for (const spelt of [["-c", 'service_tier="fast"'], ["--config", 'service_tier="fast"'], ['--config=service_tier="fast"'], ['-cservice_tier="fast"']]) {
      S.setConfig("agentArgs", JSON.stringify({ codex: ["--no-daemon", ...spelt] }));
      assert.deepEqual(startArgs("codex", { fast: false }), ["--no-daemon", ...spelt, ...SLOW], spelt.join(" "));
      assert.deepEqual(startArgs("codex", { fast: true }), ["--no-daemon", ...spelt, ...FAST]);
      assert.deepEqual(startArgs("codex"), ["--no-daemon", ...spelt]);
    }
    S.setConfig("agentArgs", "{}");
    // a kind with no fast mode starts exactly as it does without the setting
    for (const kind of ["claude", "pi", "something-else"]) assert.deepEqual(startArgs(kind, { model: "m", fast: true }), startArgs(kind, { model: "m" }));
  } finally { w.cleanup(); }
});

test("fast mode: the reviewer's is on by default, the agent's is off, and either can be chosen for one task", async () => {
  const w = await world();
  try {
    assert.equal(S.config().reviewerFast, true); assert.equal(S.config().fast, false);
    const id = A.add(w.root, "Something").id;
    assert.deepEqual([S.choices(S.get(id)).fast, S.choices(S.get(id)).reviewerFast], [false, true]);
    assert.equal(S.setTaskConfig(id, "reviewerFast", "off").reviewerFast, false); assert.equal(S.setTaskConfig(id, "fast", "on").fast, true);
    assert.equal(S.setConfig("reviewerFast", "false").reviewerFast, false); assert.equal(S.setConfig("fast", "true").fast, true);
    assert.equal(S.setTaskConfig(id, "reviewerFast", "default").reviewerFast, false); assert.equal(S.setTaskConfig(id, "fast", "").fast, true); // back to yours
    assert.equal(S.setConfig("reviewerFast", "default").reviewerFast, true); assert.equal(S.setConfig("fast", "default").fast, false);
    assert.equal(S.choices(S.get(id)).reviewerFast, true);
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
    A.delegate(two, { reviewerFast: false }); assert.equal((await settle(two)).stage, "approval");
    assert.match(started("sw-proj-2-r"), /--kind codex .* -c service_tier="default"/); assert.doesNotMatch(started("sw-proj-2-r"), /service_tier="fast"/);
  } finally { w.cleanup(); }
});

test("fast mode: a Codex working agent is started in it when `fast` is on", async () => {
  const w = await world({ settings: { agent: "codex", fast: true, reviewer: "off" } });
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
    const sw = (...args) => execFileSync(process.execPath, [S.BIN, ...args], { encoding: "utf8", cwd: w.root });
    const id = A.add(w.root, "Something").id;
    assert.match(sw("config", "fast", "on"), /claude has no fast mode: fast does nothing while the agent is claude/);
    assert.equal(JSON.parse(sw("config", "fast", "on", "--json")).note, "claude has no fast mode: fast does nothing while the agent is claude");
    assert.doesNotMatch(sw("config", "reviewerFast", "on"), /no fast mode/); // the reviewer is Codex
    S.setTaskConfig(id, "reviewer", "claude");
    assert.match(sw("config", "reviewerFast", "on", "--id", "1"), /claude has no fast mode: reviewerFast does nothing while the reviewer is claude/);
    assert.doesNotMatch(sw("config", "fast", "off"), /no fast mode/);
    // the panel: "fast" where it is on, a note where it is on and does nothing, whether the task chose it or inherits it
    const s = open(w);
    const row = (t, label) => stripVTControlCharacters(s.v.panel({ owner: "me", ...S.get(t) }, 70, true).join("\n")).split("\n").find((l) => l.startsWith(` ${label} `));
    assert.match(row(id, "Reviewer"), /claude · default model, effort · no fast mode in claude \*$/);
    assert.match(row(id, "Agent"), /^ Agent +claude · default model, effort$/);
    const other = A.add(w.root, "Other").id;
    assert.match(row(other, "Reviewer"), /codex · default model, effort · fast$/);
    S.setTaskConfig(other, "reviewer", "pi"); assert.match(row(other, "Reviewer"), /pi · default model, effort · no fast mode in pi \*$/);
    S.setConfig("reviewerFast", "off"); assert.match(row(other, "Reviewer"), /pi · default model, effort \*$/); S.setConfig("reviewerFast", "default");
    S.setTaskConfig(other, "agent", "codex"); S.setTaskConfig(other, "fast", "on"); assert.match(row(other, "Agent"), /codex · default model, effort · fast \*$/);
  } finally { w.cleanup(); }
});
