// Reports and research-only tasks: a report never goes into the repo, a research-only task that changed the repo is sent back and never pushed or merged, one that changed nothing ends as done with its report's link, and the row and the task panel say so. And research only as the setting `research.only`: looked up like every other, the short forms write that same setting, a change on a task under way counts from its next start or is refused with the reason, and what the old switch saved is read as the setting.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { world as baseWorld, settle, git, paneOf, ghLog, stateOf, until } from "./helpers.js";
import { open } from "./board-helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as R from "../src/research.js";
import { rules, turnedWords } from "../src/delegate.js";
import * as L from "../src/automations/list.js";
import { describe } from "../src/automations/show.js";
import { researchMoved } from "../src/store/old-research.js";
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

test("every agent is told that a report never goes into the repo; a research-only task's agent that it changes nothing; the Coordinator when to mark one: a flag on add and on delegate", async () => {
  const w = await world({ repoSettings: { "check.command": "npm test" } });
  try {
    const plain = A.add(w.root, "Fix the page"), research = A.add(w.root, "Look into the build", { research: true });
    assert.equal(R.isResearch(plain), false); assert.equal(R.isResearch(research), true);
    const tree = { worktree: "/tmp/x", branch: "work/1-x", repoFile: { "check.command": "npm test" } };
    const told = rules({ ...plain, ...tree }), toldResearch = rules({ ...research, ...tree });
    // Any task, in any repo: where a report goes, and never a commit of one.
    for (const text of [told, toldResearch]) { assert.match(text, /never goes into the repo: do not commit one, in no folder/); assert.match(text, /private link/); }
    assert.ok(told.includes(`Save it in ${path.join(w.base, "reports", "proj", "1")}/ (this task's own folder among the board's reports, outside every repo)`));
    assert.match(told, /Commit your work on this branch/); assert.match(told, /only counts as done when this passes: npm test/);
    assert.doesNotMatch(told, /research only/);
    // A research-only task: nothing changes, nothing is committed, there is no check to pass.
    assert.match(toldResearch, /This task is research only: change nothing in the repo\. Add, edit and delete no file, and commit nothing/);
    assert.match(toldResearch, /the work that should follow from it is a short list in that report \("Also noticed"\): nothing else is done with it, and you add no task for it/);
    assert.match(toldResearch, /Commit nothing on this branch/); assert.ok(toldResearch.includes(path.join(w.base, "reports", "proj", "2") + "/"));
    assert.doesNotMatch(toldResearch, /Commit your work on this branch/); assert.doesNotMatch(toldResearch, /only counts as done when this passes/);
    assert.match(coordinatorRules("board"), /add the task with --research/); assert.match(coordinatorRules("board"), /board delegate <id> --research \(--no-research turns it off again\)/);
    // The reviewer of one reviews the report, and a change to the repo is a finding.
    const brief = (t) => reviewBrief(t, { text: "Done.", change: null, toLand: false, ch: S.work(t) });
    assert.match(brief(S.get(research.id)), /research only: nothing in the repository may change/); assert.match(brief(S.get(research.id)), /any commit, as a critical finding/);
    assert.doesNotMatch(brief(S.get(plain.id)), /research only/);
    // Research only is a flag on add, and on delegate.
    await quietly(() => main(["add", "Compare", "the", "two", "parsers", "--research", "--repo", w.root]));
    const t = S.get("proj/3");
    // The short form writes the one setting on the task; there is no switch beside it.
    assert.equal(t.title, "Compare the two parsers"); assert.deepEqual(t.settings, { "research.only": true }); assert.equal(t.research, undefined); assert.ok(R.isResearch(t));
    assert.deepEqual(plain.settings, {});
    assert.match(coordinatorRules("board"), /Research only is a setting like every other, research\.only/); assert.match(coordinatorRules("board"), /board set research\.only true --repo <repo>/);
    // It can never be merged by a yes.
    S.update(research.id, (t) => { t.stage = "approval"; });
    assert.throws(() => A.approve(research.id), /research only: nothing of it is merged/);
  } finally { w.cleanup(); }
});

test("a research-only task that changed the repo is sent back, nothing is pushed or opened, and after the rounds it waits for you saying why; undone, it ends as done", async () => {
  const w = await world({ origin: true, settings: { "review.rounds": 1, "review.when": "never" }, repoSettings: { "check.command": "exit 1" } });
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
    assert.match(t.failure.next, /herdr-superwork set research\.only false --task proj\/1\) and delegates it again/);
    // It was told what changed and what to do.
    const said = prompts(w, t);
    assert.equal(said.match(/This task is research only, and you changed the repo/g).length, 1);
    assert.match(said, /you changed the repo \(2 changes in the repo\)[\s\S]*- docs\/report\.md\n- \(1 commit added\)/); assert.ok(said.includes(`save the report in ${path.join(w.base, "reports", "proj", "1")}/ (outside the repo)`));
    // Nothing left the machine and nothing was added by the board: no push, no pull request, no commit of leftovers.
    assert.equal(ghLog(w), ""); assert.ok(!t.pr);
    assert.equal(git(w.root, "ls-remote", "origin").split("\n").filter((l) => l.includes("work/")).length, 0);
    assert.ok(fs.existsSync(path.join(t.worktree, "notes.txt"))); // left as the agent left it
    // It cannot be merged, by you or by itself.
    const unreviewed = { ...t, settings: { ...t.settings, "review.when": "never" }, stage: "approval", reviewedHead: "abc", failure: null };
    assert.equal(green(unreviewed), false);
    assert.equal(green({ ...unreviewed, research: false }), true);
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
  const w = await world({ repoSettings: { "check.command": "exit 1" } });
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
    // In your own checkout (a task that worked there before every task got a worktree) a change is found too: what was changed there already is yours and is not
    // counted, what the agent changed is, and it is told never to reset your checkout.
    fs.writeFileSync(path.join(w.root, "mine.txt"), "yours\n");
    fs.writeFileSync(path.join(w.root, "my notes.txt"), "yours too\n"); // a name git would quote
    w.script({ worker: [{ files: { "a.txt": "edited\n" }, note: "Looked." }, { note: "Still looked." }] });
    const own = A.add(w.root, "Look at a.txt", { research: true }).id;
    S.update(own, { startedOnce: true });
    A.delegate(own, { "review.when": "never", "review.rounds": 1 });
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
    assert.match(text, /│ {2}Report ─+/); assert.match(text, /↗ Open report/); assert.doesNotMatch(text, /Research only/); s.press("alt+t"); s.v.panelTop = 1e9; assert.match(s.text(120), /\n Merge /); s.press("esc");
  } finally { w.cleanup(); }
});

// ---- research only as a setting ----------------------------------------------------------------------------------------
const NAME = "research.only";
// What the command prints, kept off the test's own output (the test runner's own lines, which are no text, pass).
const run = async (...args) => { const write = process.stdout.write; let out = ""; process.stdout.write = (s, ...more) => { if (typeof s !== "string") return write.call(process.stdout, s, ...more); out += s; return true; }; try { await main(args); } finally { process.stdout.write = write; } return out; };
const at = (id) => { const r = S.lookup(NAME, { task: S.get(id) }); return [r.value, r.from]; };
// A task whose agent is at work, started as the settings said then.
async function atWork(w, title, opts) {
  w.script({ worker: Array.from({ length: 4 }, () => ({ status: "working" })) });
  const id = A.add(w.root, title, opts).id;
  A.delegate(id);
  assert.equal((await settle(id)).stage, "working");
  return id;
}

test("one setting, looked up like every other: the short form and the setting write the same thing, a default for a repo or for you makes new tasks research only, and show names the place", async () => {
  const w = await world();
  try {
    assert.deepEqual([S.entryOf(NAME).kind, S.entryOf(NAME).type, S.entryOf(NAME).builtin, S.entryOf(NAME).label], ["work", "switch", false, "Research only"]);
    const plain = A.add(w.root, "Fix the page").id;
    assert.deepEqual(at(plain), [false, "built in"]); assert.equal(stateOf(plain).research, false);
    // The short form, and the setting by its name, on add: one source of truth, on the task.
    assert.equal(await run("add", "Compare", "the", "parsers", "--research", "--repo", w.root), "proj/2: added as research only\n");
    assert.equal(await run("add", "Audit", "the", "build", "--research.only", "true", "--repo", w.root), "proj/3: added as research only\n");
    for (const id of ["proj/2", "proj/3"]) { assert.deepEqual(S.get(id).settings, { [NAME]: true }); assert.equal(S.get(id).research, undefined); assert.deepEqual(at(id), [true, "this task"]); assert.ok(stateOf(id).research); }
    // set, unset and show with --task: the place is named each time.
    assert.equal(await run("set", NAME, "yes", "--task", plain), `${NAME} for proj/1: true  (this task)\n`);
    assert.match(await run("show", plain), /\n\* research\.only +true +this task\n/);
    assert.equal(JSON.parse(await run("show", plain, "--json")).settings.find((r) => r.name === NAME).from, "this task");
    assert.equal(await run("unset", NAME, "--task", plain), `${NAME} for proj/1: false  (built in)\n`);
    assert.match(await run("show", plain), /\n {2}research\.only +false +built in\n/);
    // A default for the repo: every new task there is research only unless the task says otherwise, and the row says so.
    assert.equal(await run("set", NAME, "true", "--repo", "proj"), `${NAME} for proj: true  (your entry for proj)\n`);
    assert.match(await run("show", "--repo", "proj"), /\n\* research\.only +true +your entry for proj\n/);
    assert.equal(await run("add", "Look", "into", "the", "logs", "--repo", w.root), "proj/4: added as research only\n");
    assert.equal(await run("add", "Fix", "the", "logs", "--no-research", "--repo", w.root), "proj/5: added\n");
    assert.deepEqual(at("proj/4"), [true, "your entry for proj"]); assert.deepEqual(S.get("proj/4").settings, {});
    assert.deepEqual(at("proj/5"), [false, "this task"]);
    assert.deepEqual(at(plain), [true, "your entry for proj"]); // not started yet: it follows the default too
    const s = open(w, { rows: 40 });
    const text = s.text(120);
    assert.match(text, /Look into the logs \[research\]/); assert.match(text, /Fix the page \[research\]/); assert.doesNotMatch(text, /Fix the logs \[research\]/);
    assert.match(rules({ ...S.get("proj/4"), worktree: "/tmp/x", branch: "work/4-x" }), /This task is research only: change nothing in the repo/);
    assert.doesNotMatch(rules({ ...S.get("proj/5"), worktree: "/tmp/x", branch: "work/5-x" }), /research only/);
    // For you, with no repo named; then nobody says it and it is built in again.
    await run("unset", NAME, "--repo", "proj");
    assert.equal(await run("set", NAME, "on"), `${NAME}: true  (you)\n`); assert.deepEqual(at("proj/4"), [true, "you"]);
    assert.match(await run("show"), /\n\* research\.only +true +you\n/);
    assert.equal(await run("unset", NAME), `${NAME}: false  (built in)\n`); assert.deepEqual(at("proj/4"), [false, "built in"]);
    // A value that is refused adds no task.
    const before = S.list().length;
    assert.throws(() => A.add(w.root, "Wrong", { settings: { [NAME]: "maybe" } }), /research\.only is a switch: true or false/);
    assert.equal(S.list().length, before);
    // On delegate, by its name and by the short form.
    A.delegate(plain, { [NAME]: "true" });
    assert.equal(S.get(plain).settings[NAME], true); assert.ok(R.isResearch(S.get(plain)));
    A.delegate("proj/2", { research: false });
    assert.equal(S.get("proj/2").settings[NAME], false); assert.ok(!R.isResearch(S.get("proj/2")));
  } finally { w.cleanup(); }
});

test("research only is decided when the agent starts: a change while the task waits for a slot counts, and the repo's file is the one of the commit its worktree starts from", async () => {
  const w = await world({ repoSettings: { research: { only: true } }, settings: { "board.agents": 1 } });
  // The rules the program was started with (its standing rules, in a file).
  const started = (w, t) => fs.readFileSync(path.join(S.dirOf(t.id), "rules.md"), "utf8");
  try {
    // The checkout's own copy of the file says nothing (not committed): main still says research only.
    fs.writeFileSync(path.join(w.root, ".herdr-superwork.json"), "{}");
    w.script({ worker: Array.from({ length: 3 }, () => ({ status: "working" })) });
    const first = A.add(w.root, "From the commit").id, second = A.add(w.root, "Changed while it waits", { research: false }).id;
    assert.deepEqual(at(first), [false, "built in"]); // before it has a worktree, the file as it stands in the folder
    A.delegate(first); A.delegate(second);
    assert.equal(S.get(second).stage, "queued"); assert.ok(!stateOf(second).research);
    // Waiting for a slot: the change is taken, the label follows at once, and nothing says "from its next start".
    assert.equal(await run("set", NAME, "true", "--task", second), `${NAME} for ${second}: true  (this task)\n`);
    assert.ok(stateOf(second).research); assert.equal(S.get(second).researchRun, undefined);
    let t = await settle(first);
    assert.deepEqual([t.stage, t.researchRun, at(first)], ["working", true, [true, "the repo's file"]]);
    assert.ok(stateOf(first).research); assert.match(started(w, t), /This task is research only: change nothing in the repo/);
    // The slot is free: the second starts as what its setting says now.
    A.stop(first); A.startQueued();
    t = await settle(second);
    assert.deepEqual([t.stage, t.researchRun, t.researchOpen], ["working", true, undefined]);
    assert.match(started(w, t), /This task is research only: change nothing in the repo/);
  } finally { w.cleanup(); }
});

test("a change while the repo's setup still runs counts for the agent that starts after it", async () => {
  const w = await world();
  try {
    // A setup that waits until it is let go: it reads one line from a pipe.
    const pipe = path.join(w.base, "go"); execFileSync("mkfifo", [pipe]);
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Set up, then look", { settings: { "workspace.setup": `read line < ${pipe}` } }).id;
    A.delegate(id);
    const going = settle(id);
    await until(() => S.get(id).stage === "setup");
    assert.equal(S.get(id).startedAgentAt, undefined); assert.ok(!stateOf(id).research);
    S.setValue(NAME, true, { task: S.get(id) });
    assert.ok(stateOf(id).research); // the row follows at once
    fs.writeFileSync(pipe, "go\n");
    const t = await going;
    assert.deepEqual([t.stage, t.researchRun, t.researchOpen], ["working", true, undefined]);
    assert.match(fs.readFileSync(path.join(S.dirOf(id), "rules.md"), "utf8"), /This task is research only: change nothing in the repo/);
  } finally { w.cleanup(); }
});

test("the repo's own file may say it, and an automation holds it as one of its settings", async () => {
  const w = await world({ repoSettings: { research: { only: true } } });
  try {
    const id = A.add(w.root, "Look around").id;
    assert.deepEqual(at(id), [true, "the repo's file"]); assert.ok(R.isResearch(S.get(id)));
    assert.match(S.showText({ task: S.get(id) }), /\n {2}research\.only +true +the repo's file\n/);
    const off = A.add(w.root, "Change it", { research: false }).id;
    assert.deepEqual(at(off), [false, "this task"]); assert.ok(!R.isResearch(S.get(off)));
    // An automation: its next task as the repo says, until the automation says otherwise.
    const a = L.add({ name: "Nightly", prompt: "Look.", trigger: { kind: "event", event: "merged" }, folder: w.root });
    assert.deepEqual(a.settings, {}); assert.ok(L.researchOnly(a)); assert.equal(L.settingRows(a).find((r) => r.name === NAME).from, "the repo's file");
    assert.equal(L.setSetting(a.id, NAME, "false").from, "this automation"); assert.ok(!L.researchOnly(L.find(a.id))); assert.equal(describe(L.find(a.id)).research, false);
    L.change(a.id, { research: true }); assert.deepEqual(L.find(a.id).settings, { [NAME]: true });
    L.unsetSetting(a.id, NAME); assert.deepEqual(L.find(a.id).settings, {}); assert.ok(L.researchOnly(L.find(a.id)));
  } finally { w.cleanup(); }
});

test("changed before the task starts it counts at once; on a task under way it counts from the next start, and turning it on is refused once the repo was changed or a pull request is open", async () => {
  const w = await world();
  try {
    // Not started: at once, and the label follows.
    const todo = A.add(w.root, "Not started").id;
    S.setValue(NAME, true, { task: S.get(todo) }); assert.ok(stateOf(todo).research);
    S.setValue(NAME, false, { task: S.get(todo) }); assert.ok(!stateOf(todo).research);
    // Under way as an ordinary task, nothing changed yet: saved, and it counts from the next start.
    const id = await atWork(w, "Under way");
    assert.equal(S.get(id).researchRun, false);
    assert.equal(await run("set", NAME, "true", "--task", id), `${NAME} for ${id}: true  (this task)\nIt counts from its next start: this run is not research only.\n`);
    assert.deepEqual(at(id), [true, "this task"]); assert.ok(!R.isResearch(S.get(id))); assert.ok(!stateOf(id).research);
    assert.match(await run("show", id), /\n\* research\.only +true +this task · counts from its next start: this run is not research only\n/);
    assert.doesNotMatch(prompts(w, S.get(id)), /research only/);
    // The next start: it is research only, the row says so, and its agent is told the rules as they are now.
    A.stop(id); A.delegate(id);
    let t = await settle(id);
    assert.equal(t.researchRun, true); assert.ok(stateOf(id).research); assert.ok(!t.researchTurned);
    assert.match(prompts(w, t), /This task is research only from now on\. These rules replace the ones you were given\.[\s\S]*This task is research only: change nothing in the repo/);
    assert.doesNotMatch(S.showText({ task: t }), /counts from its next start/);
    // Turning it off is never refused, and counts from the next start as well.
    assert.equal(S.setValue(NAME, false, { task: S.get(id) }).value, false);
    assert.equal(S.settingRows({ task: S.get(id) }).find((r) => r.name === NAME).later, "counts from its next start: this run is research only");
    assert.ok(R.isResearch(S.get(id)));
    A.stop(id); A.delegate(id);
    assert.ok(!R.isResearch(S.get(id))); assert.ok(!stateOf(id).research); // waiting to start, it follows the setting already
    t = S.get(id); R.startsAs(t); // what the job that starts its agent does (delegate.js), without running one more agent here
    assert.deepEqual([t.researchRun, t.researchOpen], [false, undefined]); assert.match(turnedWords(t), /^This task is no longer research only: its result is a change to the repo/);
    // A task that was started as an ordinary one, in a checkout written down as it stood then (no agent is run for
    // this). Its agent has changed the repo: turning it on cannot be honoured, and nothing is saved.
    const own = A.add(w.root, "Started before").id;
    S.update(own, { startedOnce: true, researchRun: false, startMark: R.startMark(w.root), settings: { [NAME]: false } });
    fs.writeFileSync(path.join(w.root, "new.txt"), "work\n");
    const refused = /research\.only cannot be turned on for proj\/3: its agent has already changed the repo \(1 change in the repo: new\.txt\), and a research-only task changes nothing in it\. Leave proj\/3 as it is and add a new task as research only, or undo the changes first\./;
    assert.throws(() => S.setValue(NAME, true, { task: S.get(own) }), refused);
    assert.equal(S.get(own).settings[NAME], false);
    // Taking its own "false" away would turn it on by a default: refused the same way, and so is a start.
    S.setValue(NAME, true, { repo: "proj" });
    assert.ok(!R.isResearch(S.get(own))); assert.ok(!stateOf(own).research); // a default never changes a task that was started
    assert.throws(() => S.unsetValue(NAME, { task: S.get(own) }), refused);
    S.update(own, (x) => { delete x.settings[NAME]; });
    assert.throws(() => A.delegate(own), /already changed the repo[\s\S]*To start it as it was: herdr-superwork set research\.only false --task proj\/3/);
    assert.throws(() => A.delegate(own, { research: true }), refused);
    assert.equal(S.get(own).stage, "todo"); // a refused start changes nothing
    // A pull request that is open.
    fs.rmSync(path.join(w.root, "new.txt"));
    S.update(own, { pr: "https://github.com/o/r/pull/7" });
    assert.throws(() => S.setValue(NAME, true, { task: S.get(own) }), /cannot be turned on for proj\/3: its pull request is open \(https:\/\/github\.com\/o\/r\/pull\/7\), and a research-only task opens none/);
    S.update(own, { prMerged: true });
    assert.equal(S.setValue(NAME, true, { task: S.get(own) }).value, true);
  } finally { w.cleanup(); }
});

test("a task and an automation saved with the old switch are research only afterwards: read as the setting, once, and a started task keeps what it was started as", async () => {
  const w = await world();
  try {
    const file = (id) => path.join(S.dirOf(id), "task.json"), old = (id, more) => fs.writeFileSync(file(id), JSON.stringify({ ...JSON.parse(fs.readFileSync(file(id), "utf8")), ...more }));
    const a = A.add(w.root, "Old research").id, b = A.add(w.root, "Old research, started").id, c = A.add(w.root, "Old ordinary, started").id, d = A.add(w.root, "Turned off since").id;
    old(a, { research: true }); old(b, { research: true, startedOnce: true }); old(c, { startedOnce: true }); old(d, { research: true, settings: { [NAME]: false } });
    assert.deepEqual([S.get(a).settings, S.get(a).research, S.get(a).researchRun], [{ [NAME]: true }, undefined, undefined]);
    assert.deepEqual([S.get(b).settings, S.get(b).research, S.get(b).researchRun], [{ [NAME]: true }, undefined, true]);
    assert.deepEqual([S.get(c).settings, S.get(c).researchRun], [{}, false]);
    assert.deepEqual(S.get(d).settings, { [NAME]: false }); // its own answer since then stands
    for (const id of [a, b]) { assert.ok(R.isResearch(S.get(id))); assert.ok(stateOf(id).research); assert.deepEqual(at(id), [true, "this task"]); }
    assert.ok(!R.isResearch(S.get(c))); assert.ok(!R.isResearch(S.get(d)));
    // Converting again changes nothing, and the next change to the task writes it down.
    const once = S.get(b); assert.equal(researchMoved(once), once);
    S.update(b, { msg: "" });
    const saved = JSON.parse(fs.readFileSync(file(b), "utf8")); assert.ok(!("research" in saved)); assert.deepEqual([saved.settings, saved.researchRun], [{ [NAME]: true }, true]);
    // A default that comes later changes no task that was started.
    S.setValue(NAME, true, { repo: "proj" }); assert.ok(!R.isResearch(S.get(c))); assert.ok(R.isResearch(S.get(d)) === false);
    // An automation.
    const made = L.add({ name: "Nightly", prompt: "Look.", trigger: { kind: "event", event: "merged" }, folder: w.root });
    S.changeAutomation(made.id, (x) => { x.research = true; });
    const read = S.automation(made.id);
    assert.deepEqual([read.settings, "research" in read], [{ [NAME]: true }, false]); assert.ok(L.researchOnly(read));
  } finally { w.cleanup(); }
});

test("the settings page has it with its plain label and what it means, and a row from another machine is labelled as that machine said", async () => {
  const w = await world();
  try {
    const id = A.add(w.root, "Fix the page").id;
    const s = open(w, { rows: 50 });
    s.v.sel = id; s.v.load();
    s.v.editSettings(s.v.current());
    s.v.editing.at = s.v.editRows(s.v.current()).findIndex((r) => r.name === NAME);
    let text = s.text(120);
    assert.match(text, /Research only: on · \[off\]\. On: its agent changes nothing in the repo; the result is a report, and/);
    assert.match(text, /› {3}Research only +off +built in +research\.only/);
    s.press("enter");
    assert.deepEqual(S.get(id).settings, { [NAME]: true });
    text = s.text(120);
    assert.match(text, /› \* Research only +on +this task +research\.only/);
    s.v.leaveSettings(); s.v.full = false; s.v.load();
    assert.match(s.text(120), /Fix the page \[research\]/);
    // Another machine's task: its own machine worked it out, and nothing here is asked.
    S.setValue(NAME, true);
    assert.equal(s.v.rowTitle({ id: "far/1", host: "vm-a", title: "Their change", research: false }), "Their change");
    S.unsetValue(NAME);
    assert.equal(s.v.rowTitle({ id: "far/2", host: "vm-a", title: "Their research", research: true }), "Their research [research]");
  } finally { w.cleanup(); }
});
