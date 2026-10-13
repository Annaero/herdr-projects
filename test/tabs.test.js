// A task's tabs in its herdr space: the agent's tab is named Agent, each reviewer has a tab of its own.
import test from "node:test";
import assert from "node:assert/strict";
import { world, settle, until, paneOf } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { closeReviewer } from "../src/finish/review.js";

const work = (n) => ({ files: { "f.txt": `v${n}\n` }, commit: `v${n}`, note: `Did v${n}.` });
const tabsOf = (w, t) => (w.state().tabs || []).filter((x) => x.workspace_id === t.link.workspace).map((x) => x.label);
const calls = (w, re) => w.state().calls.filter((c) => re.test(c));

test("the agent's tab is named Agent; each review opens a tab named after its round, unfocused, and closes it again", async () => {
  const w = await world();
  try {
    w.script({ worker: [work(1), work(2)], reviewer: [{ verdict: { meets: false, findings: [], text: "Not it." } }, { verdict: { meets: true, findings: [], text: "Fine." } }] });
    const id = A.add(w.root, "Fix it").id;
    A.delegate(id);
    const t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(S.reviewRound(t), 2);
    assert.deepEqual(calls(w, /^tab rename/), [`tab rename ${t.link.tab} Agent`]);
    // one tab per round, in the task's own space and folder, numbered as the row's R#n is
    const made = calls(w, /^tab create/);
    assert.equal(made.length, 2);
    for (const [i, c] of made.entries()) { assert.ok(c.startsWith(`tab create --workspace ${t.link.workspace} --cwd ${t.worktree} --label Reviewer #${i + 1} `), c); assert.ok(c.endsWith(" --no-focus"), c); assert.match(c, /--env HERDR_SUPERWORK_DATA_DIR=/); }
    // never a pane beside the agent's, and nothing was focused
    assert.deepEqual(calls(w, /^pane split/), []); assert.deepEqual(w.state().focus, []);
    // each one closed after its review: the space is the agent's tab alone again
    assert.equal(calls(w, /^tab close/).length >= 2, true); assert.deepEqual(tabsOf(w, t), ["Agent"]); assert.equal(t.link.reviewer, null);
    assert.deepEqual(w.state().panes.filter((p) => p.workspace_id === t.link.workspace).map((p) => p.pane_id), [t.link.pane]);
  } finally { w.cleanup(); }
});

test("a review under way: the reviewer sits in its own tab, the agent's tab keeps its one pane, and stop closes the tab", async () => {
  const w = await world();
  try {
    w.script({ worker: [work(1)], reviewer: [{ status: "working", screen: "● Reading the diff\n" }] }); // a reviewer that is still at it
    const id = A.add(w.root, "Long review").id;
    A.delegate(id);
    const run = settle(id);
    await until(() => { const p = S.get(id).link?.reviewer?.pane; return p && w.state().panes.find((x) => x.pane_id === p)?.agent?.prompts?.length; });
    const t = S.get(id), rv = t.link.reviewer;
    assert.equal(t.stage, "reviewing"); assert.deepEqual(tabsOf(w, t), ["Agent", "Reviewer #1"]);
    assert.notEqual(rv.tab, t.link.tab); assert.equal(w.state().panes.find((p) => p.pane_id === rv.pane).tab_id, rv.tab);
    assert.deepEqual(w.state().panes.filter((p) => p.tab_id === t.link.tab).map((p) => p.pane_id), [t.link.pane]); // the agent's tab: its pane alone, as before
    assert.deepEqual(w.state().focus, []);
    // what talks to the two still finds each: the agent by the task's pane, the reviewer by its own
    const api = F.h(t);
    assert.match(api.agentGet(rv.pane).name, /-r$/); assert.equal(api.agentGet(t.link.pane).name, t.link.agent);
    assert.equal(api.agentRead(rv.pane), "● Reading the diff\n");
    A.stop(id);
    await run;
    assert.equal(S.get(id).stage, "stopped"); assert.deepEqual(tabsOf(w, t), ["Agent"]); assert.ok(paneOf(w, t).agent); // the agent is still there
  } finally { w.cleanup(); }
});

test("a reviewer left over from before a restart is closed: its tab, or, from before reviewers had tabs, only its pane", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    w.script({ worker: [work(1)] });
    const id = A.add(w.root, "Left over").id;
    A.delegate(id);
    let t = await settle(id);
    const api = F.h(t);
    // the board went away mid-review: the task still names the reviewer's tab
    const made = F.openReviewerTab(api, t, 3, { cwd: t.worktree });
    assert.deepEqual(tabsOf(w, t), ["Agent", "Reviewer #3"]); assert.equal(api.paneGet(made.pane).tab_id, made.tab);
    S.update(id, (t) => { t.link = { ...t.link, reviewer: { ...made, agent: "x-r", kind: "claude" } }; });
    await closeReviewer(id);
    assert.deepEqual(tabsOf(w, t), ["Agent"]); assert.equal(S.get(id).link.reviewer, null); assert.equal(api.paneGet(made.pane), null);
    // an older board's reviewer: a split in the agent's tab. That pane goes, the agent's tab and pane stay
    const split = api.paneSplit(t.link.pane, { cwd: t.worktree });
    S.update(id, (t) => { t.link = { ...t.link, reviewer: { pane: split.pane_id, agent: "x-r", kind: "claude" } }; });
    await closeReviewer(id);
    assert.equal(api.paneGet(split.pane_id), null); assert.ok(api.paneGet(t.link.pane)); assert.deepEqual(tabsOf(w, t), ["Agent"]);
    // a space that is gone, or a herdr that opens no tab: said, not a pane somewhere else
    assert.throws(() => F.openReviewerTab(api, { link: { pane: "w9:p1" } }, 1), /space is gone/);
    w.patchState((s) => { s.tabFails = true; });
    assert.throws(() => F.openReviewerTab(api, t, 1), /timed out/); assert.deepEqual(tabsOf(w, t), ["Agent"]);
    // a herdr that will not rename a tab does not stop anything
    assert.doesNotThrow(() => F.nameAgentTab(api, "w9:t9"));
  } finally { w.cleanup(); }
});
