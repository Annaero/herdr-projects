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
    const pending = { state: "OPEN", headRefOid: t.prHead, statusCheckRollup: [{ name: "build", state: "PENDING" }], comments: [], reviews: [], author: { login: "me" } };
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ mergeFail: "checks pending", view: pending }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "merging"); assert.equal(t.autoMerge, true); assert.match(t.msg, /merges when GitHub's checks pass/);
    assert.ok(!/--auto|--delete-branch/.test(ghLog(w))); // remembered here, not handed to GitHub; gh never deletes local work
    assert.throws(() => A.archive(id), /still active/);
    await pollPrs();
    assert.equal(S.get(id).autoMerge, true); // still running
    // a task of an older version has GitHub's own auto-merge on: replying switches that off first, or sends nothing
    S.update(id, (c) => { c.autoMergeLocal = false; });
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ disableFail: true }));
    assert.throws(() => A.tell(id, "wait"), /Could not cancel the pending auto-merge; nothing was sent/);
    assert.equal(paneOf(w, t).agent.prompts.length, 1);
    S.update(id, (c) => { c.autoMergeLocal = true; });
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

test("a pull request merged elsewhere does not take a newer local commit with it", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w, "With a PR");
    let t = S.get(id);
    const pushed = t.prHead;
    assert.equal(pushed, git(t.worktree, "rev-parse", "HEAD"));
    // one more commit here that was never pushed; meanwhile the pull request is merged on GitHub at the pushed head
    fs.writeFileSync(path.join(t.worktree, "late.txt"), "late\n"); git(t.worktree, "add", "-A"); git(t.worktree, "commit", "-qm", "late");
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ view: { state: "MERGED", headRefOid: pushed } }));
    await pollPrs();
    t = S.get(id);
    assert.equal(t.stage, "done"); assert.equal(t.prMerged, true);
    assert.match(t.kept[0], /unmerged work on work\//); assert.match(t.msg, /Kept: /); assert.ok(!t.tidy && !t.cleaned);
    assert.ok(fs.existsSync(path.join(t.worktree, "late.txt"))); assert.equal(git(w.root, "log", "-1", "--format=%s", t.branch), "late");
    assert.ok(!w.state().workspaces.some((x) => x.workspace_id === t.link.workspace)); // it still leaves the sidebar
  } finally { w.cleanup(); }
});

test("a pull request only merges at the commit that was reviewed: a commit pushed from elsewhere stops it, also the auto-merge", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w, "With a PR");
    let t = S.get(id);
    const reviewed = git(t.worktree, "rev-parse", "HEAD"), other = "1".repeat(40);
    // GitHub says the pull request's head is another commit: said plainly, nothing merges
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ head: other, view: { state: "OPEN", headRefOid: other } }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.equal(t.mergeFailed, true); assert.ok(!t.autoMerge);
    assert.equal(t.failure.title, "Pull request has commits that were not reviewed"); assert.match(t.failure.detail, new RegExp(other));
    assert.ok(!/pr merge/.test(ghLog(w)));
    // it arrives between that look and the merge: GitHub itself refuses
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ head: other }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "approval"); assert.ok(!t.autoMerge); assert.equal(t.failure.title, "Pull request could not merge"); assert.match(t.failure.detail, /Head branch was modified/);
    assert.match(ghLog(w), new RegExp(`pr merge 7 --squash --match-head-commit ${reviewed}\\n`));
    assert.ok(!/--auto|--delete-branch/.test(ghLog(w)));
    assert.ok(fs.existsSync(t.worktree)); assert.ok(!t.tidy);
    // checks still running: remembered. Someone pushes to the pull request meanwhile: the approval is withdrawn
    const view = (head, state) => ({ state: "OPEN", headRefOid: head, statusCheckRollup: [{ name: "build", ...(state === "PENDING" ? { state } : { conclusion: state }) }], comments: [], reviews: [], author: { login: "me" } });
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ head: reviewed, mergeFail: "checks pending", view: view(reviewed, "PENDING") }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "merging"); assert.equal(t.autoMerge, true);
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ head: other, view: view(other, "SUCCESS") }));
    await pollPrs(); await settle(id);
    t = S.get(id);
    assert.equal(t.stage, "approval"); assert.ok(!t.autoMerge && !t.mergeIntent); assert.equal(t.failure.title, "Pull request has commits that were not reviewed");
    // remembered again, the checks pass on the reviewed commit: the board merges it itself, the remote branch goes, clean-up follows
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ head: reviewed, mergeFail: "checks pending", view: view(reviewed, "PENDING") }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "merging"); assert.equal(t.autoMerge, true);
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ head: reviewed, view: view(reviewed, "SUCCESS") }));
    await pollPrs();
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.ok(t.cleaned && !t.autoMerge);
    assert.equal(git(w.root, "ls-remote", "--heads", "origin", t.branch), ""); // deleted at the remote, by the lease on the merged commit
  } finally { w.cleanup(); }
});

test("a pull request that GitHub only queued is not taken for merged: nothing is cleaned up until GitHub says so", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w, "With a PR");
    let t = S.get(id);
    const head = t.prHead, view = (state) => ({ state, headRefOid: head, statusCheckRollup: [], comments: [], reviews: [], author: { login: "me" } });
    // a repo with a merge queue: gh pr merge answers fine, the pull request stays open
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ queue: true, view: view("OPEN") }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "merging"); assert.equal(t.autoMerge, true); assert.ok(!t.prMerged && !t.cleaned && !t.tidy);
    assert.match(t.msg, /GitHub merges it when/);
    assert.ok(fs.existsSync(t.worktree)); assert.ok(w.state().workspaces.some((x) => x.workspace_id === t.link.workspace));
    assert.equal(git(w.root, "ls-remote", "--heads", "origin", t.branch).split("\t")[0], head); // the remote branch is still there
    await pollPrs();
    assert.equal(S.get(id).stage, "merging"); // still watched, still waiting
    // (closed without merging instead: see the next test)
    // the queue merges it: now it is done and cleaned up
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ view: view("MERGED") }));
    await pollPrs();
    t = await settle(id);
    assert.equal(t.stage, "done"); assert.ok(t.prMerged && t.cleaned && !t.autoMerge);
    assert.equal(w.state().workspaces.length, 0); assert.equal(git(w.root, "ls-remote", "--heads", "origin", t.branch), "");
  } finally { w.cleanup(); }
});

test("a queued pull request that is closed without merging stops waiting and says so", async () => {
  const w = await world({ origin: true, settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w, "With a PR");
    let t = S.get(id);
    const view = (state) => ({ state, headRefOid: t.prHead, statusCheckRollup: [], comments: [], reviews: [], author: { login: "me" } });
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ queue: true, view: view("OPEN") }));
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "merging"); assert.equal(t.autoMerge, true);
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ view: view("CLOSED") }));
    await pollPrs();
    t = S.get(id);
    assert.equal(t.stage, "approval"); assert.ok(!t.autoMerge && !t.mergeIntent && !t.prMerged); assert.equal(t.mergeFailed, true);
    assert.equal(t.failure.title, "Pull request was closed without merging"); assert.equal(t.msg, t.failure.title);
    assert.equal(stateOf(id).state, "blocked");
    assert.ok(fs.existsSync(t.worktree)); assert.ok(w.state().workspaces.some((x) => x.workspace_id === t.link.workspace)); // nothing was cleaned up
    await pollPrs();
    assert.equal(S.get(id).stage, "approval");
  } finally { w.cleanup(); }
});
