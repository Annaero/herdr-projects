import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, git } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { herdr } from "../src/herdr.js";
import { onPane, reconcile, apply } from "../src/hook.js";
import { housekeeping, pollPrs } from "../src/housekeeping.js";
import { drainJobs } from "../src/runner.js";
import { runJob } from "../src/jobs.js";

const stateOf = (id) => F.board({ includeArchived: true }).find((t) => t.id === id);
const paneOf = (w, t) => w.state().panes.find((p) => p.pane_id === t.link.pane);
const ghLog = (w) => { try { return fs.readFileSync(path.join(w.fake, "gh.log"), "utf8"); } catch { return ""; } };
async function toApproval(w, title = "Work", extra = {}) {
  w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }], ...extra });
  const id = A.add(w.root, title).id;
  A.delegate(id);
  const t = await settle(id);
  assert.equal(t.stage, "approval", JSON.stringify(t.failure));
  return id;
}

test("clean-up never takes work that arrives while it runs: a reply waits, and a late commit keeps its worktree and branch", async () => {
  // the repo's teardown stands in for a turn typed in the agent's own terminal during clean-up: it commits a file
  const w = await world({ settings: { reviewer: "off" }, repoSettings: { teardown: "sleep 0.5; echo late > late.txt; git add -A; git commit -qm late" } });
  try {
    w.script({ worker: [{ note: "Looked. Nothing to change." }] });
    const id = A.add(w.root, "Look").id;
    A.delegate(id);
    const ended = settle(id);
    let refused = null;
    for (const until = Date.now() + 15000; Date.now() < until && !refused; await new Promise((r) => setTimeout(r, 20))) {
      const c = S.get(id);
      if (c.stage === "done" && c.runner) { try { A.tell(id, "one more thing"); refused = "sent"; } catch (e) { refused = e.message; } }
      else if (c.stage === "done") break;
    }
    assert.match(String(refused), /cleaning up after it finished/);
    const t = await ended;
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.match(t.kept[0], /new work arrived during clean-up/);
    assert.ok(fs.existsSync(path.join(t.worktree, "late.txt")));
    assert.equal(git(w.root, "log", "-1", "--format=%s", t.branch), "late");
    assert.ok(!w.state().workspaces.some((x) => x.workspace_id === t.link.workspace)); // its space still left the sidebar
    // the reply goes through afterwards and continues in that worktree
    w.script({ worker: [{ files: { "m.txt": "m\n" }, commit: "m", note: "Did m." }] });
    assert.match(A.tell(id, "one more thing").msg, /starting it again/);
    const again = await settle(id);
    assert.equal(again.stage, "approval", JSON.stringify(again.failure)); assert.ok(fs.existsSync(path.join(again.worktree, "late.txt")));
  } finally { w.cleanup(); }
});

test("a turn started in the agent's own terminal during clean-up keeps its terminal open and its worktree in place", async () => {
  // the teardown stands in for you typing in the agent's terminal while clean-up runs: herdr now says "working"
  const typed = `node -e 'const fs=require("fs"),f=process.env.HERDR_FAKE_DIR+"/state.json",s=JSON.parse(fs.readFileSync(f));for(const p of s.panes)if(p.agent){s.seq+=1;p.agent.status="working";p.agent.seq=s.seq}fs.writeFileSync(f,JSON.stringify(s))'`;
  const w = await world({ settings: { reviewer: "off" }, repoSettings: { teardown: typed } });
  try {
    w.script({ worker: [{ note: "Looked. Nothing to change." }] });
    const id = A.add(w.root, "Look").id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.match(t.kept[0], /its space is in use again/);
    assert.ok(fs.existsSync(t.worktree)); assert.ok(git(w.root, "branch", "--list", t.branch));
    assert.ok(w.state().workspaces.some((x) => x.workspace_id === t.link.workspace)); // not closed under its agent
    assert.ok(paneOf(w, t).agent);
  } finally { w.cleanup(); }
});

test("a terminal turn that starts before clean-up and ends during its first wait still keeps the terminal; a trailing status does not", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  const flip = (t, after) => setTimeout(() => { w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; }); after?.(); }, 300);
  const run = async (n, { hooked, event }) => {
    w.script({ worker: [{ files: { [`f${n}.txt`]: "x\n" }, commit: `f${n}`, note: "Did it." }] });
    const id = A.add(w.root, `Task ${n}`).id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    S.update(id, (t) => { t.hooked = hooked; });
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "working"; p.agent.seq = s.seq; });
    // the agent task is called done; herdr says its agent is working, and that ends while clean-up waits
    S.update(id, (t) => { t.stage = "done"; });
    flip(t, event ? () => S.update(id, (t) => { t.eventSeq = (t.eventSeq || 0) + 1; }) : null);
    const { cleanupJob } = await import("../src/land.js");
    await cleanupJob(id, { deleteBranch: "merged" });
    t = S.get(id);
    return { t, open: w.state().workspaces.some((x) => x.workspace_id === t.link.workspace) };
  };
  try {
    process.env.HERDR_SUPERWORK_SETTLE_MS = "3000";
    let r = await run(1, { hooked: false }); // no hook: a status that was "working" is a turn
    assert.match(r.t.kept[0], /its space is in use again/); assert.ok(r.open); assert.ok(fs.existsSync(r.t.worktree));
    r = await run(2, { hooked: true, event: true }); // the hook reported the turn's end
    assert.match(r.t.kept[0], /its space is in use again/); assert.ok(r.open); assert.ok(fs.existsSync(r.t.worktree));
    r = await run(3, { hooked: true }); // only herdr's status trailing the turn that ended the task
    assert.match(r.t.kept[0], /unmerged work/); assert.ok(!r.open); assert.ok(fs.existsSync(r.t.worktree));
  } finally { process.env.HERDR_SUPERWORK_SETTLE_MS = "0"; w.cleanup(); }
});
