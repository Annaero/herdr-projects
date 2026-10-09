import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, git } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { herdr } from "../src/herdr.js";
import { onPane, reconcile } from "../src/hook.js";
import { housekeeping, pollPrs } from "../src/housekeeping.js";

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

test("typing in the agent's own terminal re-arms the pipeline: approval revoked, review stale, then checked again", async () => {
  const w = await world();
  try {
    const id = await toApproval(w);
    let t = S.get(id);
    // the human types in the agent's terminal: herdr reports working, then done with a new closing note
    w.script({ worker: [{ files: { "f.txt": "v2\n" }, commit: "v2", note: null, status: "working" }] });
    herdr().agentPrompt(t.link.pane, "make it v2");
    onPane(w.socket, t.link.pane);
    t = S.get(id);
    assert.equal(t.stage, "working"); assert.equal(t.review.stale, true); assert.equal(t.requireApproval, true); assert.equal(t.turnOpen, true);
    assert.equal(stateOf(id).state, "working");
    const note = path.join(t.worktree, ".herdr-superwork", "closing-1.md");
    fs.writeFileSync(note, "Did v2."); const later = new Date(Date.now() + 50); fs.utimesSync(note, later, later);
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.summary, "Did v2."); assert.ok(!t.review.stale);
    assert.equal(t.reviewedHead, git(t.worktree, "rev-parse", "HEAD"));
  } finally { w.cleanup(); }
});

test("a turn nobody saw start still counts: a new commit behind an approval is checked again before any merge", async () => {
  const w = await world();
  try {
    const id = await toApproval(w);
    let t = S.get(id);
    fs.writeFileSync(path.join(t.worktree, "f.txt"), "sneaky\n"); git(t.worktree, "commit", "-qam", "sneaky");
    const note = path.join(t.worktree, ".herdr-superwork", "closing-1.md");
    fs.writeFileSync(note, "Changed it again."); const later = new Date(Date.now() + 2000); fs.utimesSync(note, later, later);
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 2; p.agent.seq = s.seq; p.agent.completion = s.seq; p.agent.status = "done"; });
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.summary, "Changed it again.");
    assert.equal(t.reviewedHead, git(t.worktree, "rev-parse", "HEAD"));
  } finally { w.cleanup(); }
});

test("approve refuses to merge work that changed after its review: the finish line runs first", async () => {
  const w = await world();
  try {
    const id = await toApproval(w);
    let t = S.get(id);
    fs.writeFileSync(path.join(t.worktree, "extra.txt"), "late\n"); // dirty tree behind the approval, no herdr event
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.equal(fs.readFileSync(path.join(w.root, "extra.txt"), "utf8"), "late\n"); // committed, re-reviewed, then merged
  } finally { w.cleanup(); }
});

test("stop: the stage is set before esc is sent, and a late working event cannot undo it", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Long work").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "working");
    A.stop(id);
    t = S.get(id);
    assert.equal(t.stage, "stopped"); assert.deepEqual(paneOf(w, t).agent.keys, ["esc"]);
    assert.deepEqual([stateOf(id).state, stateOf(id).note], ["idle", "stopped"]);
    await settle(id);
    assert.equal(S.get(id).stage, "stopped"); // the idle that follows esc starts nothing
    // replying re-arms it
    w.script({ worker: [{ note: "Resumed and done." }] });
    A.tell(id, "carry on");
    t = await settle(id);
    assert.notEqual(t.stage, "stopped");
  } finally { w.cleanup(); }
});

test("an agent herdr cannot classify (unknown) finishes when its closing note appears", async () => {
  const w = await world({ settings: { agent: "codex", reviewer: "off" } });
  try {
    w.script({ worker: [{ files: { "u.txt": "u\n" }, commit: "u", note: "Codex is done.", status: "unknown" }] });
    const id = A.add(w.root, "Unknown status").id;
    A.delegate(id);
    const t = await settle(id);
    assert.equal(t.stage, "approval");
    assert.deepEqual(paneOf(w, t).agent.args.slice(0, 2), ["--dangerously-bypass-approvals-and-sandbox", "--no-daemon"]);
    assert.match(fs.readFileSync(process.env.HERDR_SUPERWORK_CODEX_TOML, "utf8"), /trust_level = "trusted"/);
  } finally { w.cleanup(); }
});

test("an agent that reports itself blocked gets the right kind, and stopping after that is not a finish", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Needs a token").id;
    A.delegate(id);
    let t = await settle(id);
    assert.throws(() => A.report(id, { state: "done", asAgent: true }), /Do not report done yourself/);
    A.report(id, { state: "blocked", kind: "auth", msg: "NPM_TOKEN is missing", asAgent: true });
    w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
    t = await settle(id);
    assert.deepEqual([t.stage, t.kind, t.msg], ["asks", "auth", "NPM_TOKEN is missing"]);
    assert.deepEqual([stateOf(id).state, stateOf(id).kind], ["blocked", "auth"]);
  } finally { w.cleanup(); }
});

test("review: a verdict for another commit is ignored, a missing verdict is a saved failure, reviewer edits are put back", async () => {
  const w = await world();
  try {
    process.env.HERDR_SUPERWORK_REVIEW_MS = "600";
    w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }], reviewer: [{ verdict: { score: 5, recommend: true, text: "Fine.", commit: "deadbeefdeadbeef" } }] });
    const id = A.add(w.root, "Wrong commit").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "failed"); assert.match(t.failure.detail, /review timed out/); assert.equal(t.review, null);
    assert.equal(stateOf(id).state, "error");
    process.env.HERDR_SUPERWORK_REVIEW_MS = "4000";
    // ctrl+r sends the error back; this time the reviewer answers properly but also touches the tree
    w.script({ worker: [{ note: "Nothing to change." }], reviewer: [{ dirtyTree: true, verdict: { score: 3, recommend: false, text: "Has a real problem.", problems: ["f.txt is wrong"] }, evidence: { "out.txt": "test output\n" } }] });
    A.sendError(id);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.review.score, 3); assert.equal(t.review.recommend, false);
    assert.equal(git(t.worktree, "status", "--porcelain"), ""); // what you approve is exactly what the agent committed
    assert.ok(!fs.existsSync(path.join(t.worktree, ".herdr-superwork", "review-1", "verdict.json")));
    assert.ok(fs.existsSync(path.join(S.artifactsDir(id), "verdict.json")));
    // ctrl+r now hands the findings to the agent
    w.script({ worker: [{ files: { "f.txt": "v2\n" }, commit: "v2", note: "Fixed it." }] });
    assert.match(A.sendReview(id).msg, /review sent/);
    assert.match(paneOf(w, S.get(id)).agent.prompts.at(-1), /rated it 3 out of 5[\s\S]*f\.txt is wrong/);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.review.score, 5);
  } finally { process.env.HERDR_SUPERWORK_REVIEW_MS = "4000"; w.cleanup(); }
});

test("reviewAuto sends anything below 5 straight back, as the plugin's own turn, up to `rounds` times", async () => {
  const w = await world({ settings: { reviewAuto: true, rounds: 2 } });
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "v1" }, { files: { "f.txt": "2\n" }, commit: "2", note: "v2" }, { files: { "f.txt": "3\n" }, commit: "3", note: "v3" }],
      reviewer: [{ verdict: { score: 2, recommend: false, text: "Bad." } }, { verdict: { score: 3, recommend: false, text: "Better." } }, { verdict: { score: 4, recommend: true, text: "Good enough." } }] });
    const id = A.add(w.root, "Loop").id;
    A.delegate(id);
    const t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval"); assert.equal(t.reviewRounds, 2); assert.equal(t.review.score, 4);
    assert.equal(paneOf(w, t).agent.prompts.length, 3);
  } finally { w.cleanup(); }
});

test("a merge conflict with your checkout is rolled back and saved; ctrl+g sends it to the agent; it lands after repair", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    w.script({ worker: [{ files: { "a.txt": "from the agent\n" }, commit: "agent", note: "Changed a.txt." }] });
    const id = A.add(w.root, "Conflict").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval");
    fs.writeFileSync(path.join(w.root, "a.txt"), "from the human\n"); git(w.root, "commit", "-qam", "human");
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.mergeFailed, true);
    assert.equal(t.failure.title, "Merge conflict with main"); assert.match(t.failure.detail, /Conflicting files:\na\.txt/); assert.equal(t.failure.phase, "sync");
    assert.equal(git(w.root, "status", "--porcelain"), ""); assert.equal(git(t.worktree, "status", "--porcelain"), ""); // both rolled back
    assert.deepEqual([stateOf(id).state, stateOf(id).kind, stateOf(id).asReview], ["blocked", "permission", false]);
    assert.ok(t.mergeIntent, "the approval is kept for the retry");
    // ctrl+g: the agent resolves it in its own worktree; the approved merge is retried without asking again
    const target = git(w.root, "rev-parse", "HEAD");
    w.script({ worker: [{ note: "Resolved the conflict." }] });
    fs.writeFileSync(path.join(w.fake, "resolve.sh"), `cd ${t.worktree} && git merge -q ${target} || { printf 'merged\\n' > a.txt; git add -A; git commit -qm resolve; }`);
    const { execFileSync } = await import("node:child_process");
    execFileSync("sh", [path.join(w.fake, "resolve.sh")], { stdio: "ignore" });
    assert.match(A.sendFailure(id).msg, /failure details sent/);
    assert.match(paneOf(w, S.get(id)).agent.prompts.at(-1), /already approved this merge/);
    t = await settle(id, { max: 30 });
    assert.equal(t.stage, "done", JSON.stringify([t.stage, t.msg, t.failure?.title]));
    assert.equal(fs.readFileSync(path.join(w.root, "a.txt"), "utf8"), "merged\n");
  } finally { w.cleanup(); }
});

test("unsaved files in your checkout stop the merge and nothing is forced", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w);
    fs.writeFileSync(path.join(w.root, "mine.txt"), "unsaved\n");
    A.approve(id);
    const t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.failure.title, "Merge needs a clean checkout"); assert.equal(t.failure.agentCanFix, false);
    assert.throws(() => A.sendFailure(id), /Commit, stash or move/);
    assert.ok(fs.existsSync(path.join(w.root, "mine.txt")));
  } finally { w.cleanup(); }
});

test("pull requests: pushed as a draft, merged through gh on approval, remembered when checks are pending, watched", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w, "With a PR");
    let t = S.get(id);
    assert.equal(t.pr, "https://github.com/o/r/pull/7");
    assert.match(ghLog(w), /pr create --draft --head work\/1-with-a-pr --title With a PR/);
    assert.equal(git(w.root, "ls-remote", "--heads", "origin", t.branch).split("\t")[0], git(t.worktree, "rev-parse", "HEAD"));
    assert.match(t.msg, /Pull request: https:\/\/github\.com\/o\/r\/pull\/7/);
    // checks still running: the approval is remembered
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ mergeFail: "checks pending", autoOk: true }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "merging"); assert.equal(t.autoMerge, true); assert.match(t.msg, /merges when GitHub's checks pass/);
    assert.throws(() => A.archive(id), /still active/);
    // replying cancels the pending auto-merge first; a failed cancellation sends nothing
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ disableFail: true }));
    assert.throws(() => A.tell(id, "wait"), /Could not cancel the pending auto-merge; nothing was sent/);
    assert.equal(paneOf(w, t).agent.prompts.length, 1);
    // merged elsewhere: the poll marks it done and cleans up
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ view: { state: "MERGED" } }));
    await pollPrs();
    t = S.get(id);
    assert.equal(t.stage, "done"); assert.equal(t.prMerged, true); assert.equal(t.msg, "Merged: https://github.com/o/r/pull/7");
    assert.ok(!fs.existsSync(path.join(w.fake, "worktrees", "proj", "work-1-with-a-pr")));
  } finally { w.cleanup(); }
});

test("pull requests: failed checks wake the agent (capped), and the blocker survives a passing local check", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off", rounds: 1 } });
  try {
    const id = await toApproval(w, "CI fails");
    let t = S.get(id);
    w.script({ worker: [{ files: { "f.txt": "fixed\n" }, commit: "fix", note: "Fixed CI." }] });
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ view: { state: "OPEN", headRefOid: t.prHead, statusCheckRollup: [{ name: "build", conclusion: "FAILURE" }], comments: [], reviews: [], author: { login: "me" } } }));
    await pollPrs();
    assert.match(paneOf(w, S.get(id)).agent.prompts.at(-1), /Checks failed on the pull request[\s\S]*build/);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.prFailure.title, "Pull request checks failed");
    assert.match(t.msg, /pull request still blocked/); // local success cannot clear failed CI
    // CI on the new head passes: normal approval wording returns
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ view: { state: "OPEN", headRefOid: S.get(id).prHead, statusCheckRollup: [{ name: "build", conclusion: "SUCCESS" }], comments: [], reviews: [], author: { login: "me" } } }));
    await pollPrs();
    t = S.get(id);
    assert.equal(t.prFailure, null); assert.match(t.msg, /^Approve to merge\?/); assert.equal(t.prState, "passing");
  } finally { w.cleanup(); }
});

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
    assert.equal(w.state().workspaces[0].cwd, w.root);
    assert.ok(w.state().workspaces.some((x) => x.workspace_id === t.link.workspace)); // kept until cleared
    await A.clear(id);
    assert.equal(w.state().workspaces.length, 0); // only the workspace the plugin created is closed
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
