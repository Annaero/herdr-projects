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


test("a merge conflict with your checkout is rolled back and saved; ctrl+r sends it to the agent; it lands after repair", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    w.script({ worker: [{ files: { "a.txt": "from the agent\n" }, commit: "agent", note: "Changed a.txt." }] });
    const id = A.add(w.root, "Conflict").id;
    S.setTaskConfig(id, "conflictAuto", false); // by hand for this task; by itself is the default (sync-conflict.test.js)
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
    assert.match(A.sendFailure(id).msg, /sent to the agent to fix/);
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

test("a commit that reaches the branch while it is being merged is neither merged unseen nor deleted as merged", async () => {
  const w = await world({ settings: { reviewer: "off" } });
  try {
    const id = await toApproval(w);
    let t = S.get(id);
    const reviewed = git(t.worktree, "rev-parse", "HEAD");
    // your checkout's pre-commit hook stands in for the agent: it commits to the task's branch in the middle of the merge
    const hook = path.join(w.root, ".git", "hooks", "pre-commit");
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, `#!/bin/sh\n[ -n "$SW_LATE" ] && exit 0\n(unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX; cd "${t.worktree}" && echo late > late.txt && SW_LATE=1 git add -A && SW_LATE=1 git commit -qm late)\n`, { mode: 0o755 });
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.match(t.msg, /^Merged into main\. Kept: .*new work arrived during clean-up/);
    assert.equal(fs.readFileSync(path.join(w.root, "f.txt"), "utf8"), "v1\n"); assert.ok(!fs.existsSync(path.join(w.root, "late.txt"))); // what was reviewed landed, nothing else
    assert.ok(fs.existsSync(path.join(t.worktree, "late.txt")));
    assert.equal(git(w.root, "log", "-1", "--format=%s", t.branch), "late"); assert.equal(git(w.root, "rev-parse", `${t.branch}~1`), reviewed);
    assert.ok(!w.state().workspaces.some((x) => x.workspace_id === t.link.workspace));
  } finally { w.cleanup(); }
});
