import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, git, stateOf, paneOf, ghLog, toApproval } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { herdr } from "../src/herdr.js";
import { onPane, reconcile, apply } from "../src/hook.js";
import { housekeeping, pollPrs } from "../src/housekeeping.js";
import { drainJobs } from "../src/runner.js";
import { runJob } from "../src/jobs.js";


test("a clean-up put off because the space was in use is tried again by itself once it is free", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  const { housekeeping } = await import("../src/housekeeping.js");
  const { cleanupJob } = await import("../src/land.js");
  const open = (t) => w.state().workspaces.some((x) => x.workspace_id === t.link?.workspace);
  // one housekeeping pass, as the keeper or any hook runs it, and the retry it starts (if it starts one)
  const pass = async (id) => {
    fs.rmSync(path.join(process.env.HERDR_SUPERWORK_DATA_DIR, "stamps"), { recursive: true, force: true });
    globalThis.__swJobs = [];
    housekeeping(w.socket, { force: true });
    const jobs = globalThis.__swJobs.filter((j) => j[0] === "cleanup" && j[1] === id);
    globalThis.__swJobs = [];
    for (const [, , extra] of jobs) await cleanupJob(id, { deleteBranch: extra.includes("--merged") ? "merged" : "always" });
    return jobs.length;
  };
  const merged = async (n, before) => {
    w.script({ worker: [{ files: { [`h${n}.txt`]: "x\n" }, commit: `h${n}`, note: "Did it." }] });
    const id = A.add(w.root, `Task ${n}`).id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    before(t);
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.match(t.kept[0], /in use again/); assert.ok(open(t)); assert.ok(t.tidy);
    globalThis.__swJobs = [];
    return t;
  };
  try {
    // a command of yours in a split pane: nothing happens while it runs, and the task is cleaned up when it has ended
    let mine;
    let t = await merged(1, (t) => { mine = herdr().paneSplit(t.link.pane, { cwd: t.worktree }).pane_id; w.patchState((s) => { s.panes.find((p) => p.pane_id === mine).busy = true; }); });
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && S.get(t.id).tidy);
    w.patchState((s) => { s.panes.find((p) => p.pane_id === mine).busy = false; });
    S.setValue("workspace.cleanup", false); // `cleanup` turned off meanwhile: nothing pending is carried out
    assert.equal(await pass(t.id), 0); assert.equal(w.state().workspaces.length, 2);
    S.setValue("workspace.cleanup", true);
    assert.equal(await pass(t.id), 1);
    let c = S.get(t.id);
    assert.ok(c.cleaned && !c.tidy && !c.kept); assert.equal(c.msg, "Merged into main."); assert.ok(!fs.existsSync(t.worktree));
    assert.equal(w.state().workspaces.length, 0); assert.equal(git(w.root, "branch", "--list", "work/*"), "");
    assert.equal(await pass(t.id), 0); // and then it is over
    // herdr did not answer: cleaned up as soon as it does
    w.script({ worker: [{ files: { "u.txt": "x\n" }, commit: "u", note: "Did it." }] });
    const u = A.add(w.root, "Unanswered").id;
    A.delegate(u);
    assert.equal((await settle(u)).stage, "approval");
    S.update(u, (t) => { t.stage = "done"; });
    w.patchState((s) => { s.agentGetFails = true; });
    await cleanupJob(u, { deleteBranch: "merged" });
    assert.ok(open(S.get(u)) && S.get(u).tidy);
    w.patchState((s) => { s.agentGetFails = false; });
    assert.equal(await pass(u), 1);
    c = S.get(u);
    assert.ok(!c.tidy && !open(c)); assert.match(c.kept[0], /unmerged work/); assert.ok(fs.existsSync(c.worktree));
    await A.clear(u);
    // the agent is idle, but a command it started in the background still runs under it: nothing is closed until it ends
    t = await merged(6, (t) => w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).tool = true; }));
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && S.get(t.id).tidy && fs.existsSync(t.worktree));
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); p.tool = false; p.job = true; });
    assert.equal(await pass(t.id), 1); // nothing under the agent any more, but a background job of the pane's shell beside it
    assert.ok(open(S.get(t.id)) && S.get(t.id).tidy && fs.existsSync(t.worktree));
    w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).job = false; });
    assert.equal(await pass(t.id), 1);
    assert.ok(S.get(t.id).cleaned && !fs.existsSync(t.worktree)); assert.equal(w.state().workspaces.length, 0);
    // herdr cannot tell whether the agent works (status "unknown"): not closed; cleaned up as soon as herdr calls it idle
    const setStatus = (t, status) => w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = status; p.agent.seq = s.seq; });
    t = await merged(4, (t) => setStatus(t, "unknown"));
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && S.get(t.id).tidy && fs.existsSync(t.worktree));
    setStatus(t, "idle");
    assert.equal(await pass(t.id), 1);
    assert.ok(S.get(t.id).cleaned && !fs.existsSync(t.worktree)); assert.equal(w.state().workspaces.length, 0);
    // herdr never calls this agent idle (it does that to some after a reply), but its screen stands still: at rest
    const screen = (t, text) => w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).agent.screen = text; });
    // no waiting here: the moment its screen was first seen as it is gets moved into the past instead
    const longAgo = (t) => S.update(t.id, (c) => { c.tidy.still.at -= 3600000; });
    t = await merged(5, (t) => { setStatus(t, "unknown"); screen(t, "● working 2s\n"); });
    assert.ok(S.get(t.id).tidy.still); // what its screen showed is remembered
    screen(t, "● working 9s\n"); // it moves: an agent at work, however long ago the last look was
    longAgo(t);
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && fs.existsSync(t.worktree));
    assert.equal(await pass(t.id), 1); // the same screen now, but not for long enough yet
    assert.ok(open(S.get(t.id)) && fs.existsSync(t.worktree));
    // the same screen for long enough, but a tool it started is still running without a sign on the screen: at work
    w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).tool = true; });
    longAgo(t);
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && fs.existsSync(t.worktree));
    // its saved conversation ends in a finished turn, yet a command it started in the background still runs: at work
    const said = path.join(w.base, "said.jsonl");
    fs.writeFileSync(said, JSON.stringify({ type: "assistant", uuid: "u1", timestamp: new Date().toISOString(), message: { id: "m1", stop_reason: "end_turn", content: [{ type: "text", text: "All done." }] } }) + "\n");
    S.update(t.id, (c) => { c.transcript = said; });
    const { readTurnOf } = await import("../src/agents.js");
    assert.equal(readTurnOf("claude", { file: said }).finished, true);
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && fs.existsSync(t.worktree));
    // a conversation that does not end in a finished turn keeps it open by itself, with nothing running under the agent
    w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).tool = false; });
    fs.appendFileSync(said, JSON.stringify({ type: "user", uuid: "u2", timestamp: new Date().toISOString(), message: { content: "one more" } }) + "\n");
    assert.equal(await pass(t.id), 1);
    assert.ok(open(S.get(t.id)) && fs.existsSync(t.worktree));
    fs.appendFileSync(said, JSON.stringify({ type: "assistant", uuid: "u3", timestamp: new Date().toISOString(), message: { id: "m2", stop_reason: "end_turn", content: [{ type: "text", text: "Done again." }] } }) + "\n");
    assert.equal(await pass(t.id), 1); // a finished turn, a still screen, nothing running
    assert.ok(S.get(t.id).cleaned && !S.get(t.id).tidy); assert.equal(w.state().workspaces.length, 0);
    // a turn in the agent's own terminal: left alone until it has been quiet for a while; what it committed is kept
    t = await merged(3, (t) => w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "working"; p.agent.seq = s.seq; }));
    fs.writeFileSync(path.join(t.worktree, "more.txt"), "more\n"); git(t.worktree, "add", "-A"); git(t.worktree, "commit", "-qm", "more");
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
    assert.equal(await pass(t.id), 0); // not yet: you may still be talking to it
    process.env.HERDR_SUPERWORK_QUIET_MS = "0";
    assert.equal(await pass(t.id), 1); // the turn that ended is seen first, and the wait starts from there
    assert.ok(open(S.get(t.id)) && S.get(t.id).tidy);
    assert.equal(await pass(t.id), 1);
    c = S.get(t.id);
    assert.ok(!c.tidy); assert.match(c.kept[0], /new work arrived/); assert.ok(!open(c));
    assert.ok(fs.existsSync(path.join(t.worktree, "more.txt"))); assert.equal(git(w.root, "log", "-1", "--format=%s", t.branch), "more");
    assert.equal(await pass(t.id), 0);
  } finally { delete process.env.HERDR_SUPERWORK_QUIET_MS; w.cleanup(); }
});
