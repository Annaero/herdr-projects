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

test("at most `max` agents work at once; tasks waiting for the human hold no slot; a freed slot is reused at once", async () => {
  const w = await world({ settings: { max: 1, reviewer: "off" } });
  try {
    w.script({ worker: [{ files: { "1.txt": "1\n" }, commit: "1", note: "One." }, { status: "working" }] });
    const a = A.add(w.root, "First").id, b = A.add(w.root, "Second").id;
    A.delegate(a); A.delegate(b);
    assert.deepEqual([S.get(a).stage, S.get(b).stage], ["starting", "queued"]);
    assert.equal(stateOf(b).note, "waiting for a free slot");
    await settle(a); // first reaches "waiting for approval": it holds no slot any more
    assert.equal(S.get(a).stage, "approval");
    housekeeping(w.socket, { force: true });
    const tb = await settle(b);
    assert.equal(tb.stage, "working");
  } finally { w.cleanup(); }
});

test("archive closes the task's herdr space and keeps the rest; restore starts nothing; a reply restarts the agent; clear keeps unsaved work", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w);
    let t = S.get(id);
    const tree = t.worktree;
    A.archive(id);
    assert.ok(S.get(id).archivedAt); assert.ok(fs.existsSync(tree));
    assert.ok(!w.state().workspaces.some((x) => x.workspace_id === t.link.workspace));
    assert.throws(() => A.tell(id, "hi"), /archived/);
    assert.equal(F.board().length, 0); assert.equal(F.board({ includeArchived: true }).length, 1);
    A.restore(id);
    t = S.get(id);
    assert.equal(t.stage, "approval"); assert.ok(!t.archivedAt);
    assert.equal(w.state().workspaces.filter((x) => x.worktree?.is_linked_worktree).length, 0); // nothing was started
    // the first action that needs the agent reopens the workspace from the worktree and starts it again
    w.script({ worker: [{ files: { "g.txt": "g\n" }, commit: "g", note: "Continued." }] });
    assert.match(A.tell(id, "one more thing").msg, /starting it again/);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.summary, "Continued.");
    const prompt = paneOf(w, t).agent.prompts[0];
    assert.match(prompt, /Continue from the state of this branch/); assert.match(prompt, /Did v1\./); assert.match(prompt, /one more thing/);
    // clear with unsaved work: kept, and told where
    fs.writeFileSync(path.join(t.worktree, "unsaved.txt"), "x\n");
    const out = await A.clear(id);
    assert.match(out.kept[0], /uncommitted changes/); assert.ok(fs.existsSync(t.worktree)); assert.equal(S.get(id), null);
  } finally { w.cleanup(); }
});

test("reconcile: a pane that is gone, an agent that exited, and a finished turn missed while herdr restarted", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Reconcile").id;
    A.delegate(id);
    let t = await settle(id);
    // the agent exits to its shell
    w.patchState((s) => { s.panes.find((p) => p.pane_id === t.link.pane).agent = null; });
    reconcile(S.get(id), herdr());
    assert.deepEqual([stateOf(id).state, stateOf(id).note], ["error", "the agent has exited"]);
    // the pane is closed
    w.patchState((s) => { s.panes = s.panes.filter((p) => p.pane_id !== t.link.pane); });
    reconcile(S.get(id), herdr());
    assert.deepEqual([stateOf(id).state, stateOf(id).note], ["error", "the agent's terminal is gone"]);
    // a pane move gave it a new id: relinked by agent name in the task's folder
    w.patchState((s) => { s.panes.push({ pane_id: "w9:p1", workspace_id: "w9", tab_id: "w9:t1", terminal_id: "term_new", cwd: t.worktree, agent: { kind: "claude", name: "sw-proj-1", status: "working", seq: ++s.seq } }); });
    reconcile(S.get(id), herdr());
    assert.equal(S.get(id).link.pane, "w9:p1");
    // it finished while no hook fired
    fs.mkdirSync(path.join(t.worktree, ".herdr-superwork"), { recursive: true });
    fs.writeFileSync(path.join(t.worktree, ".herdr-superwork", "closing-1.md"), "Finished unseen."); const later = new Date(Date.now() + 2000); fs.utimesSync(path.join(t.worktree, ".herdr-superwork", "closing-1.md"), later, later);
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === "w9:p1"); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
    housekeeping(w.socket, { force: true });
    t = await settle(id);
    assert.equal(t.stage, "done"); // nothing to land: simply done
    assert.equal(t.msg, "Finished unseen.");
  } finally { w.cleanup(); }
});

test("tasks of another herdr session show their last known state and refuse live actions with the reason", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Elsewhere").id;
    A.delegate(id);
    await settle(id);
    S.update(id, (t) => { t.link = { ...t.link, socket: "/x/sessions/other/herdr.sock" }; });
    assert.deepEqual([stateOf(id).state, stateOf(id).note], ["working", "in session other"]);
    assert.throws(() => A.tell(id, "hi"), /lives in herdr session other/);
  } finally { w.cleanup(); }
});

test("a task outside git works in place in a plain herdr workspace and is simply done", async () => {
  const w = await world({ repo: false });
  try {
    w.script({ worker: [{ files: { "notes.md": "x\n" }, note: "Wrote the notes." }] });
    const id = A.add(w.root, "Plain folder").id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "done"); assert.equal(t.msg, "Wrote the notes."); assert.ok(!t.worktree);
    assert.equal(w.state().workspaces.length, 0); // done: its space left herdr's sidebar by itself
    assert.ok(t.cleaned); assert.ok(!t.link.workspace);
    assert.equal(fs.readFileSync(path.join(w.root, "notes.md"), "utf8"), "x\n");
    await A.clear(id);
    assert.equal(S.get(id), null);
  } finally { w.cleanup(); }
});

test("setup runs before the agent starts; a failed setup is a saved failure", async () => {
  const w = await world({ repoSettings: { setup: "echo boom >&2; exit 3", include: [".env"] } });
  try {
    fs.writeFileSync(path.join(w.root, ".gitignore"), ".env\n"); fs.writeFileSync(path.join(w.root, ".env"), "SECRET=1\n"); git(w.root, "add", ".gitignore"); git(w.root, "commit", "-qm", "ignore");
    const id = A.add(w.root, "Setup fails").id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "failed"); assert.equal(t.failure.title, "Setup failed"); assert.match(t.failure.detail, /boom/);
    assert.equal(fs.readFileSync(path.join(t.worktree, ".env"), "utf8"), "SECRET=1\n"); // ignored files named by include were copied
    assert.equal(paneOf(w, t).agent, null); // the agent never started
  } finally { w.cleanup(); }
});

test("delegating a landed task again starts a new round in a fresh worktree, never in your checkout", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w);
    A.approve(id);
    let t = await settle(id);
    assert.equal(t.stage, "done"); assert.ok(t.cleaned);
    w.script({ worker: [{ status: "working" }] });
    A.delegate(id);
    t = await settle(id);
    assert.equal(t.stage, "working"); assert.equal(t.branch, "work/1-work"); assert.ok(t.worktree && t.worktree !== w.root && fs.existsSync(t.worktree));
    assert.notEqual(paneOf(w, t).cwd, w.root);
    assert.match(paneOf(w, t).agent.prompts[0], /\n\nWork/);
  } finally { w.cleanup(); }
});

test("no notifications: a task that needs you raises nothing, and the pop-up block an older version wrote is taken out", async () => {
  const w = await world();
  try {
    const id = await toApproval(w);
    const { tickOnce } = await import("../src/keeper.js");
    tickOnce(w.socket);
    assert.equal(S.get(id).announced, undefined);
    assert.ok(!("bell" in S.config()));
    assert.deepEqual(w.state().notifications, []);
    assert.ok(!w.state().calls.some((c) => JSON.stringify(c).includes("notification")));
    const X = await import("../src/extras.js");
    const file = path.join(w.fake, "config.toml");
    const mine = `[keys]\nx = "prefix+x"\n\n${X.blockText("sidebar")}\n`;
    fs.writeFileSync(file, `${mine}\n# >>> herdr-superwork popups (added by the herdr-superwork plugin; \`herdr-superwork remove-extras\` removes it)\n[ui.toast]\ndelivery = "herdr"\n# <<< herdr-superwork popups\n`);
    process.env.HERDR_CONFIG_PATH = file;
    assert.equal(X.offers().popups, undefined);
    assert.equal(X.removePopups(), true);
    assert.equal(fs.readFileSync(file, "utf8").trim(), mine.trim()); // only that block went
    assert.equal(X.removePopups(), false);
    const real = path.join(w.fake, "managed.toml"), before = `${mine}\n${X.blockText("sidebar").replaceAll("sidebar", "popups")}\n`;
    fs.writeFileSync(real, before); fs.rmSync(file); fs.symlinkSync(real, file);
    assert.equal(X.removePopups(), false); // a linked config is someone else's file: left as it is
    assert.equal(fs.readFileSync(real, "utf8"), before);
  } finally { delete process.env.HERDR_CONFIG_PATH; w.cleanup(); }
});
