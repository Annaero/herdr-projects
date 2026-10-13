// Reports and research-only tasks: a report never goes into the repo, a research-only task that changed the repo is sent back and never pushed or merged, one that changed nothing ends as done with its report's link, and the row and the task panel say so.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world as baseWorld, settle, git, paneOf, ghLog } from "./helpers.js";
import { open } from "./board-helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as R from "../src/research.js";
import { rules } from "../src/delegate.js";
import { rules as coordinatorRules } from "../src/coordinator/rules.js";
import { reviewBrief } from "../src/finish/review-brief.js";
import { green } from "../src/finish/auto-merge.js";
import { main } from "../src/cli.js";

// The board's reports folder is the user's own (~/.herdr-superwork/reports): a test has one of its own.
const world = async (o) => { const w = await baseWorld(o); process.env.HERDR_SUPERWORK_REPORTS_DIR = path.join(w.base, "reports"); return w; };
const writeReport = (id, name, text) => { const dir = R.reportFolder({ id }); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), text); return dir; };
const page = "<!doctype html><title>Report</title><h1>What I found</h1>";
const prompts = (w, t) => paneOf(w, t).agent.prompts.join("\n---\n");
// The command prints its answer: kept off the test's own output.
const quietly = async (run) => { const write = process.stdout.write; process.stdout.write = () => true; try { return await run(); } finally { process.stdout.write = write; } };

test("every agent is told that a report never goes into the repo; a research-only task's agent that it changes nothing; the Coordinator when to mark one: a flag on add, a setting on the task", async () => {
  const w = await world({ repoSettings: { check: "npm test" } });
  try {
    const plain = A.add(w.root, "Fix the page"), research = A.add(w.root, "Look into the build", { research: true });
    assert.equal(R.isResearch(plain), false); assert.equal(R.isResearch(research), true);
    const tree = { worktree: "/tmp/x", branch: "work/1-x", repoCfg: { check: "npm test" } };
    const told = rules({ ...plain, ...tree }), toldResearch = rules({ ...research, ...tree });
    // Any task, in any repo: where a report goes, and never a commit of one.
    for (const text of [told, toldResearch]) { assert.match(text, /never goes into the repo: do not commit one, in no folder/); assert.match(text, /private link/); }
    assert.ok(told.includes(`Save it in ${path.join(w.base, "reports", "proj", "1")}/ (this task's own folder among the board's reports, outside every repo)`));
    assert.match(told, /Commit your work on this branch/); assert.match(told, /only counts as done when this passes: npm test/);
    assert.doesNotMatch(told, /research only/);
    // A research-only task: nothing changes, nothing is committed, there is no check to pass.
    assert.match(toldResearch, /This task is research only: change nothing in the repo\. Add, edit and delete no file, and commit nothing/);
    assert.match(toldResearch, /a suggestion on the task for each piece of work that should follow/);
    assert.match(toldResearch, /Commit nothing on this branch/); assert.ok(toldResearch.includes(path.join(w.base, "reports", "proj", "2") + "/"));
    assert.doesNotMatch(toldResearch, /Commit your work on this branch/); assert.doesNotMatch(toldResearch, /only counts as done when this passes/);
    assert.match(coordinatorRules("board"), /add the task with --research/); assert.match(coordinatorRules("board"), /board config research true --id <id>/);
    // The reviewer of one reviews the report, and a change to the repo is a finding.
    const brief = (t) => reviewBrief(t, { text: "Done.", change: null, toLand: false, ch: S.choices(t) });
    assert.match(brief(S.get(research.id)), /research only: nothing in the repository may change/); assert.match(brief(S.get(research.id)), /any commit, as a critical finding/);
    assert.doesNotMatch(brief(S.get(plain.id)), /research only/);
    // Research only is a flag on add and a setting on the task.
    await quietly(() => main(["add", "Compare", "the", "two", "parsers", "--research", "--repo", w.root]));
    const t = S.get("proj/3");
    assert.equal(t.title, "Compare the two parsers"); assert.equal(S.choices(t).research, true); assert.ok(R.isResearch(t));
    assert.equal(S.choices(plain).research, false);
    await quietly(() => main(["config", "research", "true", "--id", plain.id]));
    assert.ok(R.isResearch(S.get(plain.id)));
    await quietly(() => main(["config", "research", "false", "--id", plain.id]));
    assert.ok(!R.isResearch(S.get(plain.id)));
    // It can never be merged by a yes.
    S.update(research.id, (t) => { t.stage = "approval"; });
    assert.throws(() => A.approve(research.id), /research only: nothing of it is merged/);
    assert.throws(() => S.setConfig("research", true), /Unknown setting/); // one task's, never a default for all
  } finally { w.cleanup(); }
});

test("a research-only task that changed the repo is sent back, nothing is pushed or opened, and after the rounds it waits for you saying why; undone, it ends as done", async () => {
  const w = await world({ origin: true, settings: { rounds: 1, reviewer: "off" }, repoSettings: { check: "exit 1" } });
  try {
    // First a commit, then a file that is not committed as well: each is a change.
    w.script({ worker: [{ files: { "docs/report.md": "found\n" }, commit: "the report", note: "Wrote the report." }, { files: { "notes.txt": "more\n" }, note: "Looked again." }] });
    const id = A.add(w.root, "Research the options", { research: true }).id;
    A.delegate(id);
    let t = await settle(id, { max: 30 });
    assert.equal(t.stage, "failed", t.msg);
    assert.match(t.msg, /^Research only, but its agent changed the repo again after 1 round \(3 changes in the repo\): nothing was pushed, opened or merged$/);
    assert.equal(t.failure.stage, "research"); assert.equal(t.failure.agentCanFix, true);
    assert.match(t.failure.detail, /- docs\/report\.md/); assert.match(t.failure.detail, /- notes\.txt/); assert.match(t.failure.detail, /- \(1 commit added\)/);
    assert.match(t.failure.next, /config research false --id proj\/1/);
    // It was told what changed and what to do.
    const said = prompts(w, t);
    assert.equal(said.match(/This task is research only, and you changed the repo/g).length, 1);
    assert.match(said, /you changed the repo \(2 changes in the repo\)[\s\S]*- docs\/report\.md\n- \(1 commit added\)/); assert.ok(said.includes(`save the report in ${path.join(w.base, "reports", "proj", "1")}/ (outside the repo)`));
    // Nothing left the machine and nothing was added by the board: no push, no pull request, no commit of leftovers.
    assert.equal(ghLog(w), ""); assert.ok(!t.pr);
    assert.equal(git(w.root, "ls-remote", "origin").split("\n").filter((l) => l.includes("work/")).length, 0);
    assert.ok(fs.existsSync(path.join(t.worktree, "notes.txt"))); // left as the agent left it
    // It cannot be merged, by you or by itself.
    assert.equal(green({ ...t, stage: "approval", reviewedHead: "abc", failure: null }, { review: "none" }), false);
    assert.equal(green({ ...t, own: {}, stage: "approval", reviewedHead: "abc", failure: null }, { review: "none" }), true);
    // A commit that changes no file is a change as well.
    git(t.worktree, "reset", "-q", "--hard", t.baseSha); fs.rmSync(path.join(t.worktree, "notes.txt"));
    git(t.worktree, "commit", "-q", "--allow-empty", "-m", "nothing");
    assert.deepEqual(R.changesOf(t, t.worktree), ["(1 commit added)"]);
    // So is a merge that changes no file: every commit on the branch counts.
    git(t.worktree, "reset", "-q", "--hard", t.baseSha);
    git(t.worktree, "reset", "-q", "--hard", git(t.worktree, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-p", "HEAD", "-m", "empty merge"));
    assert.deepEqual(R.changesOf(t, t.worktree), ["(1 commit added)"]);
    // Every change undone, the step is tried again: done, with nothing to merge. No report was written, and the line says so.
    git(t.worktree, "reset", "-q", "--hard", t.baseSha);
    assert.deepEqual(R.changesOf(t, t.worktree), []);
    A.retry(id);
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.match(t.msg, /Looked again\. No report was found\./); assert.ok(!t.report);
  } finally { w.cleanup(); }
});

test("a research-only task that changed nothing ends as done with nothing to merge and its report kept; the reviewer reviews the report; a change in your own checkout is found too", async () => {
  // The repo's check would fail: it is not run, there is no change to check.
  const w = await world({ repoSettings: { check: "exit 1" } });
  try {
    const dir = writeReport("proj/1", "index.html", page); // what the agent leaves in the task's folder among the reports
    w.script({ worker: [{ note: "The build is slow because of X." }], reviewer: [{ verdict: { meets: true, text: "The report answers it.", findings: [] }, evidence: { "out.txt": "ran it\n" } }] });
    const id = A.add(w.root, "Why is the build slow", { research: true }).id;
    A.delegate(id);
    const t = await settle(id, { max: 30 });
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.match(t.msg, /The build is slow because of X\./); assert.doesNotMatch(t.msg, /No report/);
    // The report stays where it was written; the task has its link, and the page server finds it beside the review's evidence.
    assert.equal(t.report.file, "index.html");
    assert.equal(t.report.link, path.join(dir, "index.html")); // no page server in a test: the file itself
    assert.equal(fs.readFileSync(path.join(S.artifactsDir(id), "report", "index.html"), "utf8"), page);
    assert.ok(fs.existsSync(path.join(S.artifactsDir(id), "out.txt"))); // the evidence, beside it
    assert.deepEqual(A.details(id).report, t.report); assert.equal(A.details(id).research, true);
    // Reviewed as a report; nothing checked, pushed, opened or merged.
    assert.equal(S.reviewHistory(t).length, 1); assert.ok(t.review);
    assert.equal(ghLog(w), ""); assert.ok(!t.pr);
    // In your own checkout (no worktree) a change is found too: what was changed there already is yours and is not
    // counted, what the agent changed is, and it is told never to reset your checkout.
    fs.writeFileSync(path.join(w.root, "mine.txt"), "yours\n");
    fs.writeFileSync(path.join(w.root, "my notes.txt"), "yours too\n"); // a name git would quote
    w.script({ worker: [{ files: { "a.txt": "edited\n" }, note: "Looked." }, { note: "Still looked." }] });
    const own = A.add(w.root, "Look at a.txt", { research: true }).id;
    A.delegate(own, { worktree: false, reviewer: "off", rounds: 1 });
    const o = await settle(own, { max: 30 });
    assert.equal(o.stage, "failed", o.msg); assert.ok(!o.worktree);
    assert.match(o.msg, /changed the repo again after 1 round \(1 change in the repo\)/);
    assert.match(o.failure.detail, /- a\.txt/); assert.doesNotMatch(o.failure.detail, /mine\.txt/);
    assert.match(o.failure.next, /never reset or clean the checkout/); assert.match(prompts(w, o), /undo only what you changed yourself/);
    // Put back as it was, it is no change any more.
    fs.writeFileSync(path.join(w.root, "a.txt"), "one\n");
    assert.deepEqual(R.changesOf(S.get(own), w.root), []);
    // What is staged counts by itself: the agent's content staged, the file put back as you had it.
    fs.writeFileSync(path.join(w.root, "mine.txt"), "the agent's\n"); git(w.root, "add", "mine.txt"); fs.writeFileSync(path.join(w.root, "mine.txt"), "yours\n");
    assert.deepEqual(R.changesOf(S.get(own), w.root), ["mine.txt"]);
    // So does the executable flag, set in what is staged alone: the same content, the working file untouched.
    git(w.root, "reset", "-q", "--", "mine.txt"); git(w.root, "add", "mine.txt");
    const staged = { startMark: R.startMark(w.root) };
    git(w.root, "update-index", "--chmod=+x", "mine.txt");
    assert.deepEqual(R.changesOf(staged, w.root), ["mine.txt"]);
    // And a file git was told not to look at: edited, it is in no status, and is found all the same.
    git(w.root, "update-index", "--assume-unchanged", "a.txt"); fs.writeFileSync(path.join(w.root, "a.txt"), "hidden edit\n");
    assert.ok(R.changesOf(staged, w.root).includes("a.txt"));
    fs.writeFileSync(path.join(w.root, "a.txt"), "one\n"); git(w.root, "update-index", "--no-assume-unchanged", "a.txt");
    git(w.root, "reset", "-q", "--", "mine.txt");
    // A file of yours that was changed already, edited again, under a name with a blank in it.
    fs.writeFileSync(path.join(w.root, "my notes.txt"), "the agent's\n");
    assert.deepEqual(R.changesOf(S.get(own), w.root), ["my notes.txt"]);
  } finally { w.cleanup(); }
});

test("any task may write a report: the first page of its folder among the board's reports gets the link", async () => {
  const w = await world({ repo: false });
  try {
    const t = A.add(w.root, "Fix it and say why");
    assert.equal(R.keepReport(t), null); // none written
    writeReport(t.id, "notes.md", "n"); writeReport(t.id, "report.md", "# Why");
    const kept = R.keepReport(t, () => "https://box.ts.net:8750/proj/1");
    assert.equal(kept.file, "report.md"); assert.equal(kept.link, "https://box.ts.net:8750/proj/1/report/report.md");
    assert.equal(fs.readFileSync(path.join(S.artifactsDir(t.id), "report", "report.md"), "utf8"), "# Why");
    writeReport(t.id, "index.html", page);
    assert.equal(R.keepReport(t).file, "index.html");
  } finally { w.cleanup(); }
});

test("the row and the task panel say that a task is research only, and the panel shows the report's link", async () => {
  const w = await world({ repo: false });
  try {
    const plain = A.add(w.root, "Fix the page"), id = A.add(w.root, "Look into the build", { research: true }).id;
    const s = open(w, { rows: 50 });
    s.v.sel = id; s.v.load();
    let text = s.text(120);
    assert.match(text, /Look into the build \[research\]/); assert.doesNotMatch(text, /Fix the page \[research\]/);
    assert.match(text, /│ {2}Research only ─+/); assert.match(text, /│ {2}Changes nothing in the repo\. No report yet\./);
    assert.match(text, /│ {2}Research {5}only · no change to the repo *\n/); assert.doesNotMatch(text, /│ {2}Merge /);
    S.update(id, (t) => { t.report = { file: "index.html", link: "https://box.tail.ts.net:8750/proj/2/report/index.html", at: Date.now() }; });
    s.v.load();
    text = s.text(120);
    assert.match(text, /│ {2}↗ Open report/); assert.doesNotMatch(text, /No report yet/);
    s.press("alt+t"); // the details page: the link printed in full
    text = s.text(120);
    assert.match(text, /Research only ─+/); assert.match(text, /↗ Open report/); assert.match(text, /https:\/\/box\.tail\.ts\.net:8750\/proj\/2\/report\/index\.html/);
    // An ordinary task with a report has the link too, and is not called research.
    S.update(plain.id, (t) => { t.report = { file: "report.md", link: "https://box.tail.ts.net:8750/proj/1/report/report.md", at: Date.now() }; });
    s.press("esc"); s.v.sel = plain.id; s.v.load();
    text = s.text(120);
    assert.match(text, /│ {2}Report ─+/); assert.match(text, /↗ Open report/); assert.doesNotMatch(text, /Research only/); assert.match(text, /│ {2}Merge /);
  } finally { w.cleanup(); }
});
