// Where the Coordinator lives: a tab named Coordinator in the home space, found or started again, and moved over
// from the space of its own it had before.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import * as C from "../src/coordinator.js";
import { herdr } from "../src/herdr.js";
import { runJob } from "../src/jobs.js";
import { drainJobs } from "../src/runner.js";
import { coordWorld } from "./coordinator-helpers.js";

const tell = async (w, text) => { C.send(w.root, text); await drainJobs(runJob); };
const labels = (w) => w.state().workspaces.map((x) => x.label);
const tabs = (w) => (w.state().tabs || []).map((x) => `${x.workspace_id} ${x.label}`);
const calls = (w, re) => w.state().calls.filter((c) => re.test(c));
const resumed = (w) => { const a = w.agents()[0].agent.args; return a[a.indexOf("--resume") + 1]; };
// As a board from before left it: the running Coordinator in a space of its own, named "Coordinator".
const oldLayout = (w) => oldLayoutIn(w, "");
// `there`: the old space is still open (it holds panes of the human's): the Coordinator is put back into it.
function oldLayoutIn(w, there) {
  const was = C.get();
  w.patchState((st) => {
    if (!there) st.workspaces.push({ workspace_id: "w9", label: "Coordinator", cwd: C.home() });
    st.tabs = st.tabs.filter((t) => t.tab_id !== was.tab); st.tabs.push({ tab_id: "w9:t1", workspace_id: "w9", label: "1" });
    Object.assign(st.panes.find((p) => p.pane_id === was.pane), { pane_id: "w9:p1", workspace_id: "w9", tab_id: "w9:t1" });
  });
  C.change(process.env.HERDR_SOCKET_PATH, (c) => { Object.assign(c, { workspace: "w9", tab: "w9:t1", pane: "w9:p1" }); delete c.space; });
}

test("the Coordinator is a tab named Coordinator in the home space: found there, started again there, never a space of its own", async () => {
  const w = await coordWorld();
  try {
    const api = herdr();
    const mine = api.workspaceCreate({ cwd: os.homedir() }).root_pane; // the human's home space, with their own tab
    w.script({ coordinator: [{ said: "One." }, { said: "Two." }, { said: "Three." }, { said: "Four." }] });
    await tell(w, "one");
    const first = C.get();
    // in the home space that was there: no space was made for it, its tab is beside the human's, in its own folder
    assert.deepEqual(labels(w), ["~"]); assert.deepEqual(tabs(w), ["w1 1", "w1 Coordinator"]);
    assert.equal(calls(w, /^workspace create/).length, 1); // the human's own
    assert.ok(calls(w, /^tab create/)[0].startsWith(`tab create --workspace w1 --cwd ${C.home()} --label Coordinator `)); assert.ok(calls(w, /^tab create/)[0].endsWith(" --no-focus"));
    assert.equal(first.workspace, null); assert.equal(first.space, "w1"); assert.equal(api.paneGet(first.pane).tab_id, first.tab);
    // nothing was focused, no pane of anyone's was split, and the human's tab is as it was
    assert.deepEqual(w.state().focus, []); assert.deepEqual(calls(w, /^pane split/), []);
    assert.deepEqual(w.state().panes.filter((p) => p.tab_id === mine.tab_id).map((p) => p.pane_id), [mine.pane_id]);
    // running: the next message goes to that one
    await tell(w, "two");
    assert.equal(calls(w, /^agent start/).length, 1); assert.equal(calls(w, /^tab create/).length, 1); assert.equal(w.agents().length, 1);
    assert.deepEqual(w.agents()[0].agent.prompts, ["one", "two"]);
    // its tab was closed: the next message starts it again in the same conversation, in a Coordinator tab of the home space
    api.tabClose(first.tab);
    assert.equal(C.look().state, "exited");
    await tell(w, "three");
    assert.deepEqual(labels(w), ["~"]); assert.deepEqual(tabs(w), ["w1 1", "w1 Coordinator"]); assert.equal(w.agents().length, 1);
    assert.equal(resumed(w), first.session); assert.notEqual(C.get().tab, first.tab);
    // the whole home space was closed: it is made again (at the home folder, unfocused), then the tab
    api.workspaceClose("w1");
    await tell(w, "four");
    assert.deepEqual(labels(w), ["~"]); assert.deepEqual(tabs(w), ["w2 1", "w2 Coordinator"]); assert.equal(w.agents().length, 1); assert.equal(resumed(w), first.session);
    assert.equal(calls(w, /^workspace create/).at(-1), `workspace create --cwd ${os.homedir()} --no-focus`);
    assert.deepEqual(w.state().focus, []);
    // stop closes its tab, never the home space around it
    C.stop(); await drainJobs(runJob);
    assert.deepEqual(tabs(w), ["w2 1"]); assert.equal(w.agents().length, 0);
  } finally { w.cleanup(); }
});

test("the home space under another label is still found: the one the tab was last in; a tab that is there is taken up, not doubled", async () => {
  const w = await coordWorld();
  try {
    const api = herdr();
    api.workspaceCreate({ cwd: os.homedir() });
    w.script({ coordinator: [{ said: "One." }] });
    await tell(w, "one");
    const first = C.get();
    // herdr labels a space after its first tab's folder: the human went somewhere else in it
    w.patchState((st) => { st.workspaces[0].label = "tmp"; st.panes.find((p) => p.agent).agent = null; });
    C.restart(); await drainJobs(runJob);
    assert.deepEqual(labels(w), ["tmp"]); assert.deepEqual(tabs(w), ["w1 1", "w1 Coordinator"]); assert.equal(C.get().space, "w1");
    // the state file lost where it is: its tab is found by its name and folder, with the program still running in it
    const now = C.get();
    C.change(process.env.HERDR_SOCKET_PATH, (c) => { Object.assign(c, { tab: null, pane: null }); });
    await tell(w, "two");
    assert.equal(C.get().pane, now.pane); assert.equal(calls(w, /^agent start/).length, 2); assert.equal(w.agents().length, 1); assert.deepEqual(tabs(w), ["w1 1", "w1 Coordinator"]);
    assert.notEqual(now.tab, first.tab);
    // the whole state file is lost, and the home space is not labelled ~: the running one is still found, by its folder.
    // No second Coordinator, no new space, and its conversation is known again
    const starts = calls(w, /^agent start/).length, made = calls(w, /^(tab|workspace) create/).length;
    C.change(process.env.HERDR_SOCKET_PATH, (c) => { for (const k of Object.keys(c)) delete c[k]; c.queue = []; });
    await tell(w, "again");
    assert.equal(w.agents().length, 1); assert.equal(calls(w, /^agent start/).length, starts); assert.equal(calls(w, /^(tab|workspace) create/).length, made);
    assert.deepEqual(labels(w), ["tmp"]); assert.equal(C.get().pane, now.pane); assert.equal(C.get().space, "w1"); assert.equal(C.get().workspace, null);
    assert.equal(C.get().run.kind, "claude"); assert.equal(C.active(process.env.HERDR_SOCKET_PATH, C.get()), first.session);
    assert.deepEqual(w.agents()[0].agent.prompts.slice(-2), ["two", "again"]);
    // a tab of that name in another folder is the human's: left alone, and the Coordinator gets its own
    C.stop(); await drainJobs(runJob);
    const theirs = api.tabCreate({ workspace: "w1", cwd: w.root, label: C.COORDINATOR_TAB }).root_pane;
    await tell(w, "three");
    assert.notEqual(C.get().pane, theirs.pane_id); assert.equal(api.paneGet(theirs.pane_id).agent, null); assert.equal(w.agents().length, 1);
    assert.deepEqual(tabs(w), ["w1 1", "w1 Coordinator", "w1 Coordinator"]);
    // lost while it still ran in the old space of its own: found there, not doubled, and moved over like any other
    oldLayout(w); w.patchState((st) => { st.workspaces[0].label = "~"; });
    C.change(process.env.HERDR_SOCKET_PATH, (c) => { for (const k of Object.keys(c)) delete c[k]; c.queue = []; });
    const before = calls(w, /^agent start/).length;
    await tell(w, "four");
    assert.equal(w.agents().length, 1); assert.equal(calls(w, /^agent start/).length, before); assert.equal(C.get().workspace, "w9");
    C.tick();
    assert.equal(C.get().workspace, null); assert.ok(!labels(w).includes("Coordinator")); assert.equal(w.agents().length, 1); assert.equal(C.get().space, "w1");
  } finally { w.cleanup(); }
});

test("moving over: a Coordinator in the old space of its own is moved into the tab as it runs, and the old space is gone", async () => {
  const w = await coordWorld();
  try {
    w.script({ coordinator: [{ said: "One." }, { status: "working" }] });
    await tell(w, "one");
    const first = C.get(), pid = w.agents()[0].agent.pid;
    oldLayout(w);
    assert.deepEqual(labels(w), ["~", "Coordinator"]);
    // whoever ticks (the keeper, an open board) moves it: the same program, not started again, nothing focused
    C.tick();
    assert.deepEqual(labels(w), ["~"]); assert.deepEqual(tabs(w), ["w1 1", "w1 Coordinator"]);
    assert.ok(calls(w, /^pane move/)[0].startsWith("pane move w9:p1 --new-tab --workspace w1 --label Coordinator --no-focus"));
    assert.equal(calls(w, /^agent start/).length, 1); assert.equal(w.agents()[0].agent.pid, pid); assert.deepEqual(w.state().focus, []);
    const now = C.get();
    assert.equal(now.workspace, null); assert.equal(now.space, "w1"); assert.equal(now.paneWas, "w9:p1"); assert.equal(now.session, first.session);
    assert.equal(herdr().paneGet(now.pane).tab_id, now.tab); assert.equal(C.look().state, "idle");
    // and the next message goes to that one. Its program still names the pane it was started in: a task it files in
    // the turn of a tab message is known to come from it under either id
    process.env.HERDR_SUPERWORK_HANDLED_MS = "0"; // at rest means dealt with
    C.send(w.root, "two", { delegate: true }); await drainJobs(runJob);
    assert.equal(calls(w, /^agent start/).length, 1); assert.deepEqual(w.agents()[0].agent.prompts.map((p) => p.split("\n")[0]), ["one", "two"]);
    assert.equal(C.tabTurn("w9:p1"), true); assert.equal(C.tabTurn(now.pane), true); assert.equal(C.tabTurn("w1:p1"), false);
  } finally { delete process.env.HERDR_SUPERWORK_HANDLED_MS; w.cleanup(); }
});

test("moving over with no home space, on a message, and on a herdr that will not move a pane: restarted in the tab, same conversation", async () => {
  const w = await coordWorld();
  try {
    w.script({ coordinator: [{ said: "One." }, { said: "Two." }, { said: "Three." }, { said: "Four." }] });
    await tell(w, "one");
    const first = C.get();
    // no home space on this machine: the message that finds the old one makes it, then moves the Coordinator in
    oldLayout(w);
    w.patchState((st) => { st.workspaces = st.workspaces.filter((x) => x.label !== "~"); st.panes = st.panes.filter((p) => p.workspace_id !== "w1"); st.tabs = st.tabs.filter((t) => t.workspace_id !== "w1"); });
    await tell(w, "two");
    assert.deepEqual(labels(w), ["~"]); assert.deepEqual(tabs(w).map((x) => x.split(" ")[1]), ["1", "Coordinator"]);
    assert.equal(calls(w, /^agent start/).length, 1); assert.deepEqual(w.agents()[0].agent.prompts, ["one", "two"]);
    // herdr refuses the move: the old space is closed and it starts again in its tab, where it left off
    oldLayout(w);
    w.patchState((st) => { st.moveFails = true; });
    C.tick(); assert.deepEqual(labels(w), ["~", "Coordinator"]); // the tick only moves; it never ends a running program
    await tell(w, "three");
    assert.deepEqual(labels(w), ["~"]); assert.deepEqual(tabs(w).map((x) => x.split(" ")[1]), ["1", "Coordinator"]);
    assert.equal(w.agents().length, 1); assert.equal(resumed(w), first.session); assert.equal(C.get().workspace, null);
    assert.deepEqual(w.agents()[0].agent.prompts, ["three"]); assert.deepEqual(w.state().focus, []);
    // the same with panes of the human's in the old space, a split beside it and a tab: only the Coordinator's pane is
    // closed, theirs and the space they are in stay
    oldLayout(w);
    const api = herdr(), beside = api.paneSplit("w9:p1", { cwd: w.root }), tab = api.tabCreate({ workspace: "w9", cwd: w.root }).root_pane;
    await tell(w, "four");
    assert.ok(api.paneGet(beside.pane_id)); assert.ok(api.paneGet(tab.pane_id)); assert.equal(api.paneGet("w9:p1"), null);
    assert.deepEqual(labels(w), ["~", "Coordinator"]); assert.deepEqual(calls(w, /^workspace close/), []);
    assert.equal(w.agents().length, 1); assert.equal(resumed(w), first.session); assert.equal(C.get().workspace, null); assert.equal(herdr().paneGet(C.get().pane).workspace_id, C.get().space);
    // stop and restart from the old layout close its pane alone too
    w.patchState((st) => { st.moveFails = false; });
    oldLayoutIn(w, "w9"); C.restart(); await drainJobs(runJob);
    assert.ok(api.paneGet(beside.pane_id)); assert.ok(api.paneGet(tab.pane_id)); assert.deepEqual(calls(w, /^workspace close/), []); assert.equal(w.agents().length, 1);
  } finally { w.cleanup(); }
});
