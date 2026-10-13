// A plan first (`plan.approve`, `plan.agent`): the two settings and where they may be said, what the plan's writer is told, the task waiting as "plan ready" with nothing in the repo changed, the yes and the reply, the reviewer's look at a plan, a planner in a tab of its own, and what the board shows of it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, git, paneOf, stateOf } from "./helpers.js";
import { open } from "./board-helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as P from "../src/plan.js";
import * as G from "../src/gate.js";
import { rules, firstPrompt, taskLine } from "../src/delegate.js";
import { rules as coordinatorRules } from "../src/coordinator/rules.js";
import { reviewBrief, parseVerdict } from "../src/finish/review-brief.js";
import { presented, SAVED } from "../src/plan/presented.js";
import { planBrief } from "../src/plan/review.js";
import { PATCH, changed, putBack } from "../src/plan/untouched.js";
import { isLocked, unlock } from "../src/plan/lock.js";
import { boxedCommand, startProgram } from "../src/plan/sandbox.js";
import { spawnSync } from "node:child_process";
import { WORDS } from "../src/status-words.js";
import { groupOf, standing, whoStands } from "../src/board/view/states.js";
import { eventOf } from "../src/notify.js";
import { startArgs } from "../src/agents.js";
import { AGENTS } from "../src/agents/kinds.js";
import { main } from "../src/cli.js";
import { WebView } from "../src/webui/web-view.js";
import { CALLS } from "../src/webui/worker.js";
import { add as addAutomation, setSetting } from "../src/automations/list.js";

const PLAN = "# Plan\n\n1. Add f.txt with one line.\n2. Run the check.\n";
const BUILD = { files: { "f.txt": "v1\n" }, commit: "v1", note: "Built as planned." };
// A build that is still going: the test ends with the builder at work, and no finish line is run for it.
const BUILDING = { status: "working" };
const prompts = (w, t) => paneOf(w, t).agent.prompts;
const tabs = (w, t) => w.state().tabs.filter((x) => x.workspace_id === t.link.workspace).map((x) => x.label);
const quietly = async (run) => { const write = process.stdout.write; let out = ""; process.stdout.write = (s) => { out += s; return true; }; try { await run(); return out; } finally { process.stdout.write = write; } };
// Runs the jobs that are waiting and no more: the build's start, without the finish line of the turn it starts.
const started = async (id) => { const { runJob } = await import("../src/jobs.js"), { drainJobs } = await import("../src/runner.js"); await drainJobs(runJob); return S.get(id); };
// A world whose agents are processes that can be ended (a program in its own plan mode is started again after the yes).
// A worktree whose plan still waits is read-only (src/plan/lock.js): it is made writable again before the world's folder is removed.
// Its plan writers start in a read-only mount (src/plan/sandbox.js), which the fake herdr stands in for; `sandbox: "none"` is a machine without one.
const planWorld = async (settings, { sandbox = "bwrap", ...o } = {}) => { const w = await world({ settings, ...o }); process.env.HERDR_SUPERWORK_SANDBOX = sandbox; w.patchState((s) => { s.pids = true; }); const gone = w.cleanup; w.cleanup = () => { spawnSync("chmod", ["-R", "u+w", w.base]); gone(); }; return w; };

test("the two settings: built in none, looked up nearest first, set for you, a repo or a task, passed to delegate, held by an automation, listed by show; a wrong value is refused with the nearest right one; never from a repo's own file", async () => {
  const w = await world({ repoSettings: { plan: { approve: "you", agent: "codex" }, check: { command: "true" } } });
  try {
    const t = A.add(w.root, "Work");
    assert.equal(S.entryOf("plan.approve").builtin, "none"); assert.equal(S.entryOf("plan.agent").builtin, "none");
    assert.deepEqual(S.entryOf("plan.approve").values, ["none", "you", "reviewer"]);
    assert.equal(S.setting("plan.approve", t), "none"); assert.equal(P.wanted(t), "");
    // Code an agent writes cannot switch it on or off: the repo's file may not hold it, and says so.
    const f = S.repoFile(w.root, "HEAD");
    assert.deepEqual(f.facts, { "check.command": "true" });
    for (const name of ["plan.approve", "plan.agent"]) assert.ok(f.refused.some((r) => r.includes(`${name} is refused: the repo's file may only hold`)), name);
    assert.ok(!S.REPO_FACTS.some((n) => n.startsWith("plan.")));
    // You, then your entry for the repo, then the task: the nearest answer wins, and show says where it came from.
    S.setValue("plan.approve", "reviewer");
    assert.equal(S.lookup("plan.approve", { task: t }).from, "you");
    S.setValue("plan.approve", "you", { repo: "proj" });
    assert.match(S.lookup("plan.approve", { task: t }).from, /proj/); assert.equal(P.wanted(t), "you");
    S.setValue("plan.approve", "none", { task: t });
    assert.equal(P.wanted(S.get(t.id)), ""); assert.equal(S.lookup("plan.approve", { task: S.get(t.id) }).from, "this task");
    S.unsetValue("plan.approve", { task: S.get(t.id) }); assert.equal(P.wanted(S.get(t.id)), "you");
    assert.equal(S.setValue("plan.agent", "Claude/claude-opus-5-5").value, "claude/claude-opus-5-5");
    assert.equal(S.setValue("plan.agent", "NONE").value, "none");
    // A refused value changes nothing and names the nearest right one.
    assert.throws(() => S.setValue("plan.approve", "reviewr"), /plan\.approve must be none, you, reviewer, not "reviewr"\. Did you mean reviewer\?/);
    assert.throws(() => S.setValue("plan.agent", "cluade"), /no agent program "cluade".*Did you mean claude\?/);
    assert.throws(() => S.setValue("plan.aprove", "you"), /Unknown setting "plan\.aprove"\. Did you mean plan\.approve\?/);
    assert.equal(S.setting("plan.approve"), "reviewer");
    assert.throws(() => A.delegate(t.id, { "plan.approve": "me" }), /plan\.approve must be/); assert.equal(S.get(t.id).stage, "todo");
    // On the command line: delegate takes it, show lists it with its place, for you and for a task.
    await quietly(() => main(["delegate", t.id, "--plan.approve", "reviewer", "--plan.agent", "codex/gpt-5.5"]));
    assert.deepEqual(S.get(t.id).settings, { "plan.approve": "reviewer", "plan.agent": "codex/gpt-5.5" });
    const shown = await quietly(() => main(["show", t.id]));
    assert.match(shown, /plan\.approve\s+reviewer\s+.*this task/); assert.match(shown, /plan\.agent\s+codex\/gpt-5\.5/);
    assert.match(await quietly(() => main(["show"])), /plan\.approve\s+reviewer/);
    // An automation holds it like any setting: its tasks start with a plan.
    const a = addAutomation({ name: "Nightly", prompt: "Tidy", repo: "proj", folder: w.root, trigger: "daily 09:00" });
    setSetting(a.id, "plan.approve", "you");
    assert.equal(S.automation(a.id).settings["plan.approve"], "you");
    // The Coordinator's standing rules say it in plain words.
    const said = coordinatorRules("board");
    assert.match(said, /"show me the plan first"/); assert.match(said, /board delegate <id> --plan\.approve you/); assert.match(said, /--plan\.agent claude\/claude-opus-5-5/);
  } finally { w.cleanup(); }
});

test("what the plan's writer is told: change nothing until the board says the plan is approved, where the plan goes, and, for a program with its own plan mode, to present it there; a planner is told that it builds nothing", async () => {
  const w = await world();
  try {
    const t = { ...A.add(w.root, "Work"), worktree: "/tmp/x", branch: "work/1-x", repoFile: { "check.command": "npm test" }, agent: "codex" };
    assert.doesNotMatch(rules(t), /starts with a plan/); assert.doesNotMatch(firstPrompt(t), /plan/);
    const planning = { ...t, plan: { asked: 1, by: "you" } };
    const told = rules(planning);
    assert.match(told, /This task starts with a plan, and nothing is changed before the plan is approved/);
    assert.match(told, /Until a message from the board says that your plan is approved: change nothing in this folder: add, edit and delete no file, commit nothing/);
    assert.ok(told.includes(`Save it as ${P.planFile(t)} (the board's own folder for this task, not the folder you work in)`));
    assert.match(told, /Stopping with the plan written is right in this step/); assert.match(told, /puts back whatever changed/);
    assert.match(told, /Commit your work on this branch/); // the rules of the work still stand, for after the yes
    assert.match(firstPrompt(planning), /This task starts with a plan \(your rules say how\): write the plan and stop\. Change nothing yet\./);
    // Claude Code has a plan mode of its own: the plan is presented there, and its launch flags say so.
    const claude = { ...planning, agent: "claude" };
    assert.match(rules(claude), /started in its own plan mode: write the plan as that mode has you do it and present it for approval/); assert.doesNotMatch(rules(claude), /Save it as/);
    assert.deepEqual(P.planArgs(claude), ["--permission-mode", "plan"]); assert.equal(P.planArgs(planning), null); assert.equal(P.planArgs({ ...claude, plan: { ...claude.plan, approvedAt: 5 } }), null);
    assert.deepEqual(startArgs("claude", { access: "full", plan: P.planArgs(claude) }), ["--permission-mode", "plan"]); // in place of its access flags: nothing is changed unasked
    assert.deepEqual(startArgs("claude", { access: "full" }), ["--dangerously-skip-permissions"]);
    // A planner of its own.
    const planner = { ...planning, plan: { asked: 1, by: "you", home: { tab: "t1", pane: "p1" }, writer: { kind: "codex", model: "gpt-5.5" } } };
    const toPlanner = rules(planner);
    assert.match(toPlanner, /You are the planner of this task: you write the plan, and another agent builds from it/); assert.match(toPlanner, /You build nothing/);
    assert.doesNotMatch(toPlanner, /Commit your work on this branch/); assert.doesNotMatch(toPlanner, /Do not stop until the work is finished/); assert.doesNotMatch(toPlanner, /only counts as done when this passes/);
    assert.match(toPlanner, /report proj\/1 --state blocked/); // it can still say that it waits for you
    assert.equal(taskLine(planner), "Work board task proj/1, role: planner."); assert.equal(taskLine(planning), "Work board task proj/1, role: agent.");
    // After the yes: the builder is told to build exactly that plan, and the reviewer of the work to check against it.
    const done = { ...t, plan: { asked: 1, by: "you", at: 2, approvedAt: 3, approvedBy: "you" } };
    assert.match(P.goWords(done), /Your plan is approved\. Build it now, exactly that plan/); assert.match(P.buildWords(done), /read .*plan\.md first, and build exactly that plan/);
    assert.match(P.backWords(planning, "Smaller."), /^Your plan is not approved\. The human read it and sent it back with these words:\n\nSmaller\./);
    const brief = (x) => reviewBrief(x, { text: "Done.", change: null, toLand: false, ch: S.work(x) });
    assert.doesNotMatch(brief(done), /built from a plan/); // no plan on disk: nothing to check against
    P.writePlan(done, PLAN);
    assert.match(brief(done), /built from a plan that was approved before the work began/); assert.match(brief(done), /Say where the build left the plan, one sentence each, in `offPlan`/); assert.match(brief(done), /"offPlan": \[/);
    assert.doesNotMatch(brief(planning), /built from a plan/);
    assert.deepEqual(parseVerdict(JSON.stringify({ meets: true, text: "Fine.", findings: [], offPlan: ["It added g.txt, which the plan did not name."] }), null).offPlan, ["It added g.txt, which the plan did not name."]);
    assert.match(planBrief(done, "/tmp/review"), /adversarial reviewer of a plan/); assert.match(planBrief(done, "/tmp/review"), /\/tmp\/review\/verdict\.json/);
  } finally { w.cleanup(); }
});

test("plan.approve you: the agent writes its plan and the task waits as plan ready; what it tries to change too early is refused by the read-only worktree; a reply sends the plan back; the yes starts the build, and the work is reviewed against the plan", async () => {
  const w = await planWorld({ "plan.approve": "you", "worker.agent": "codex" });
  try {
    w.script({ worker: [{ plan: PLAN, files: { "early.txt": "too early\n", "a.txt": "changed\n" }, commit: "early", refused: true, note: "The plan is written." }, { plan: "# Plan, smaller\n\n1. Add f.txt.\n", note: "Written again." }, BUILDING] });
    const id = A.add(w.root, "Work").id;
    A.delegate(id);
    let t = await settle(id);
    // Plan ready: it waits for you, nothing was checked, pushed or reviewed, and the repo is as it was.
    assert.equal(t.stage, "plan", JSON.stringify(t.failure)); assert.equal(t.plan.by, "you"); assert.equal(t.plan.words, "Plan"); assert.ok(!t.plan.approvedAt);
    assert.equal(P.readPlan(t), PLAN.trim()); assert.equal(t.plan.link, P.planFile(t));
    assert.equal(git(t.worktree, "rev-parse", "HEAD"), t.baseSha); assert.equal(git(t.worktree, "status", "--porcelain"), ""); assert.ok(!fs.existsSync(path.join(t.worktree, "early.txt")));
    assert.equal(fs.readFileSync(path.join(t.worktree, "a.txt"), "utf8"), "one\n"); assert.ok(!t.plan.undone, "nothing got in, so nothing had to be put back");
    assert.equal(t.plan.locked, true); assert.ok(isLocked(t));
    // Its program runs in a mount of its own where the worktree is a read-only file system: started by the board's own command, not by `agent start`.
    assert.equal(paneOf(w, t).agent.boxed, true); assert.equal(paneOf(w, t).agent.kind, "codex"); assert.equal(t.plan.mode, true);
    const ran = w.state().calls.find((c) => c.startsWith("pane run"));
    assert.ok(ran.includes(`env HERDR_SUPERWORK_AGENT=sw-proj-1 bwrap --dev-bind / / --ro-bind ${t.worktree} ${t.worktree} --ro-bind `), ran);
    assert.ok(boxedCommand(t, "x", "codex", ["-c", "a b"]).endsWith("--die-with-parent -- codex -c 'a b'"));
    assert.ok(!t.review && !t.reviewRound && !t.pr);
    // The row, the State line, herdr's sidebar and the notification all say it, and it stands with what waits for you.
    const row = stateOf(id);
    assert.equal(row.state, "blocked"); assert.equal(row.kind, "permission"); assert.equal(groupOf(row), "needs you"); assert.equal(standing(row), "plan ready"); assert.equal(WORDS.plan, "plan ready");
    assert.deepEqual(whoStands(row), { who: "", stand: "plan ready" }); assert.equal(eventOf(t), "needs you");
    assert.ok(JSON.stringify(w.state().metadata).includes("plan ready"), "herdr's sidebar is told");
    const b = open(w, { rows: 90 });
    assert.match(b.text(), /Plan ready · Plan/); assert.match(b.text(), /approve this task's plan/);
    b.press("alt+t"); // the whole task
    const whole = b.text();
    assert.match(whole, /plan ready/); assert.match(whole, /Stands\s+waits for your yes/); assert.match(whole, /Written by\s+the working agent/); assert.match(whole, /1\. Add f\.txt with one line\./); assert.match(whole, /Open plan/);
    assert.match(whole, /Plan first\s+you approve it \((this task|you)\) · written by the agent/);
    assert.match(JSON.stringify(A.details(id).plan), /Add f\.txt with one line/);
    // The web Board is the same board: the plan's part with its words, and the yes as a button.
    const web = CALLS.pick.run(new WebView({ cwd: w.root }), { id, open: true });
    const part = web.panel.parts.find((x) => x.head === "Plan"), said = JSON.stringify(part.items);
    assert.ok(web.panel.parts.map((x) => x.head).indexOf("Plan") > 0); assert.match(said, /waits for your yes/); assert.match(said, /1\. Add f\.txt with one line\./); assert.match(said, /Open plan/); assert.match(said, /Yes approves this plan and the build starts/);
    assert.deepEqual(web.actions.map((x) => [x.id, x.label]).slice(0, 2), [["yes", "approve this task's plan"], ["talk", "send the plan back with your words"]]);
    assert.equal(web.list.groups[0].name, "needs you"); assert.equal(web.list.groups[0].rows[0].says.map((x) => x.t).join(""), "Plan ready · Plan");
    // A reply sends the plan back with those words, and it is written again.
    const out = A.tell(id, "Make it smaller.");
    assert.equal(out.msg, "The plan went back to its writer with your words");
    assert.match(prompts(w, S.get(id)).at(-1), /^Your plan is not approved\. The human read it and sent it back with these words:\n\nMake it smaller\./);
    t = await settle(id);
    assert.equal(t.stage, "plan"); assert.equal(t.plan.words, "Plan, smaller"); assert.equal(t.plan.backs, 1); assert.equal(git(t.worktree, "rev-parse", "HEAD"), t.baseSha);
    // The approve key (and the command) is the yes: the program is ended and started again outside the mount, and builds.
    b.v.load(); b.press("esc", "ctrl+l");
    assert.equal(S.get(id).stage, "starting"); assert.equal(S.get(id).plan.approvedBy, "you");
    t = await settle(id);
    assert.equal(t.stage, "working", JSON.stringify(t.failure)); assert.ok(t.plan.built); assert.equal(paneOf(w, t).agent.kind, "codex"); assert.equal(t.plan.locked, false); assert.ok(!isLocked(t));
    assert.ok(!paneOf(w, t).agent.boxed); assert.match(prompts(w, t).at(-1), /This task has an approved plan.*build exactly that plan/); // (in the same conversation where its program still has it; the fake keeps none)
    fs.writeFileSync(path.join(t.worktree, "f.txt"), "v1\n"); // the builder can write now
    // The review of the work is told of the plan, and says where the build left it: kept with the review, and shown.
    assert.match(reviewBrief(t, { text: "Done.", change: null, toLand: false, ch: S.work(t) }), /built from a plan that was approved before the work began/);
    const verdict = G.stamp(parseVerdict(JSON.stringify({ meets: true, text: "As planned.", findings: [], offPlan: ["The check was not run by hand."] }), null), "major");
    t = S.update(id, (t) => { t.reviewRound = 1; S.logReview(t, verdict); t.review = verdict; });
    assert.deepEqual(S.reviewHistory(t).at(-1).offPlan, ["The check was not run by hand."]);
    b.v.load(); b.press("alt+t");
    assert.match(b.text(), /Stands\s+approved by you/); assert.match(b.text(), /Left the plan/);
    assert.throws(() => A.approvePlan(id), /no plan that waits for a yes/);
  } finally { w.cleanup(); }
});

test("a program with its own plan mode is started in it, its plan is taken by the board's hook, and after the yes it is started again in the same conversation with its usual access", async () => {
  const w = await planWorld({ "plan.approve": "you", "review.when": "never" });
  try {
    w.script({ worker: [{ note: "A first draft, said and not presented." }, { plan: PLAN, note: "Presented." }, BUILDING] });
    const id = A.add(w.root, "Work").id;
    A.delegate(id);
    let t = await settle(id);
    // With nothing presented and no file, what the agent said last is the plan.
    assert.equal(t.stage, "plan"); assert.equal(P.readPlan(t), "A first draft, said and not presented.");
    const args = paneOf(w, t).agent.args;
    assert.ok(args.join(" ").includes("--permission-mode plan")); assert.ok(!args.includes("--dangerously-skip-permissions")); assert.equal(t.plan.mode, true);
    // Its launch settings carry the hook that takes the plan (a test world starts agents without their hooks: asked for here).
    const token = JSON.parse(fs.readFileSync(path.join(S.dirOf(id), "tokens.json"), "utf8")).agent;
    const hookFile = (plan) => { const a = AGENTS.claude.hookArgs({ shim: "/bin/board", id, role: "agent", round: 0, token, dir: w.base, plan }); return JSON.parse(fs.readFileSync(a[a.indexOf("--settings") + 1], "utf8")).hooks; };
    const hooks = hookFile(true);
    assert.equal(hooks.PreToolUse[0].matcher, "ExitPlanMode"); assert.equal(hooks.PreToolUse[0].hooks[0].command, `'/bin/board' 'plan-written' '--id' 'proj/1' '--token' '${token}'`); assert.ok(!hooks.PreToolUse[0].hooks[0].async);
    assert.ok(!hookFile(false).PreToolUse, "only while the plan step is open");
    // The hook: a wrong token or no plan lets the tool through; the plan is saved, the agent is told to stop, the tool is refused.
    const err = process.stderr.write; let said = ""; process.stderr.write = (s) => { said += s; return true; };
    try {
      assert.equal(presented({ id, token: "wrong" }, { tool_input: { plan: PLAN } }), 0); assert.equal(presented({ id, token }, { tool_input: {} }), 0); assert.equal(P.readPlan(t), "A first draft, said and not presented.");
      assert.equal(presented({ id, token }, { tool_input: { plan: "# As the hook took it" } }), 2);
    } finally { process.stderr.write = err; }
    assert.equal(said.trim(), SAVED); assert.equal(P.readPlan(t), "# As the hook took it");
    A.tell(id, "Present it properly."); // its next turn presents a new plan, which is on file when the turn ends
    t = await settle(id);
    assert.equal(t.stage, "plan"); assert.equal(t.plan.words, "Plan");
    A.approve(id);
    t = await started(id);
    assert.equal(t.stage, "working", JSON.stringify(t.failure)); assert.ok(t.plan.built);
    const now = paneOf(w, t).agent.args;
    // Started again, out of plan mode (in the same conversation where its program still has it; the fake keeps none).
    assert.ok(now.includes("--dangerously-skip-permissions")); assert.ok(!now.join(" ").includes("--permission-mode plan")); assert.notDeepEqual(now, args);
    assert.match(prompts(w, t).at(-1), /This task has an approved plan.*build exactly that plan/); assert.equal(presented({ id, token }, { tool_input: { plan: "late" } }), 0);
  } finally { w.cleanup(); }
});

test("plan.approve reviewer: the reviewer checks the plan against the task; a plan that fails goes back to its writer with the points, one that passes is built with nobody asked; still failing after its rounds, it is yours to judge", async () => {
  const w = await planWorld({ "plan.approve": "reviewer", "worker.agent": "codex", "review.rounds": 1, "review.when": "never" });
  const bad = (subject) => ({ verdict: { meets: true, findings: [{ severity: "major", subject, where: "step 1", proof: "read the plan" }], text: "Not yet." } });
  try {
    w.script({ worker: [{ plan: PLAN, note: "Written." }, { plan: PLAN, note: "The same." }, { plan: "# Plan with tests\n", note: "Again." }, BUILDING],
      reviewer: [bad("Leaves out the tests."), bad("Still leaves out the tests."), { verdict: { meets: true, findings: [], text: "A good plan." } }] });
    const id = A.add(w.root, "Work").id;
    A.delegate(id);
    let t = await settle(id, { max: 30 });
    // It failed, went back to its writer with the points by itself (review.rounds: once), and failed again: plan
    // ready, with what the reviewer found, and the yes is yours.
    assert.equal(t.stage, "plan", JSON.stringify(t.failure)); assert.match(t.msg, /The reviewer did not pass the plan \(1 major\): yours to judge/); assert.equal(t.plan.rounds, 1);
    assert.match(prompts(w, t)[1], /^Your plan is not approved\. The reviewer checked it against the task and found:\n\nFail · 1 major/); assert.match(prompts(w, t)[1], /Leaves out the tests\./);
    const b = open(w, { rows: 90 }); b.press("alt+t");
    assert.match(b.text(), /Reviewer\s+Fail · 1 major/); assert.match(b.text(), /Still leaves out the tests\./);
    // Sent back by you, written again, and this one passes: it is built, and nobody is asked.
    A.tell(id, "Add the tests.");
    t = await settle(id, { max: 30 });
    assert.equal(t.stage, "working", JSON.stringify(t.failure)); assert.ok(t.plan.built);
    assert.equal(t.plan.approvedBy, "reviewer"); assert.equal(t.plan.review.pass, true); assert.equal(t.plan.words, "Plan with tests");
    assert.match(prompts(w, t).at(-1), /This task has an approved plan/); assert.match(P.goWords(t), /^Your plan is approved \(the reviewer checked it against the task\)/);
    assert.equal(w.state().calls.filter((c) => c.startsWith("pane run") && c.includes("bwrap")).length, 4, "the writer, and each reviewer of the plan, started in the read-only mount");
    // The look at a plan is no round of the task's reviews (the work itself is not reviewed here: review.when never).
    assert.ok(!t.reviewRound); assert.equal(S.reviewHistory(t).length, 0); assert.ok(!t.review);
    const made = w.state().calls.filter((c) => c.startsWith("tab create")).map((c) => /--label (.+?) --env/.exec(c)[1]);
    assert.deepEqual(made, ["Plan review", "Plan review", "Plan review"]);
    assert.ok(w.state().calls.some((c) => c.startsWith("agent prompt") && c.includes("role: reviewer.") && c.includes("adversarial reviewer of a plan")));
  } finally { w.cleanup(); }
});

test("plan.agent: a planner writes the plan in a tab of its own, on its own program and model; after the yes its tab closes, its time is kept on the task, and the working agent builds from the plan in its own tab", async () => {
  const w = await planWorld({ "plan.approve": "you", "plan.agent": "codex/gpt-5.5", "worker.agent": "claude", "review.when": "never" });
  try {
    w.script({ worker: [{ plan: PLAN, note: "Planned." }, BUILDING] });
    const id = A.add(w.root, "Work").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "plan", JSON.stringify(t.failure));
    assert.deepEqual(tabs(w, t), ["Agent", "Planner"]); // the working agent's tab waits beside the planner's
    const planner = paneOf(w, t);
    assert.equal(planner.agent.kind, "codex"); assert.ok(planner.agent.args.join(" ").includes("-m gpt-5.5")); assert.equal(t.agent, "codex"); assert.deepEqual(t.plan.writer, { kind: "codex", model: "gpt-5.5" });
    assert.match(planner.agent.prompts[0], /^Work board task proj\/1, role: planner\./);
    assert.match(planner.agent.args.join(" "), /You are the planner of this task/);
    assert.equal(w.state().panes.find((p) => p.pane_id === t.plan.home.pane).agent, null, "the working agent has not started");
    const b = open(w, { rows: 90 }); b.press("alt+t");
    assert.match(b.text(), /Written by\s+codex · gpt-5\.5/); assert.match(b.text(), /Plan first\s+you approve it \((this task|you)\) · written by codex · gpt-5\.5 \((this task|you)\)/);
    const home = t.plan.home.pane, plannerPane = t.link.pane;
    A.approve(id);
    t = await started(id);
    assert.equal(t.stage, "working", JSON.stringify(t.failure)); assert.ok(t.plan.built);
    assert.equal(t.link.pane, home); assert.equal(t.agent, "claude"); assert.equal(t.plan.home, null); assert.ok(t.plan.took >= 0);
    assert.ok(!w.state().panes.some((p) => p.pane_id === plannerPane), "the planner's tab is closed"); assert.deepEqual(tabs(w, t), ["Agent"]);
    const worker = paneOf(w, t);
    assert.equal(worker.agent.kind, "claude"); assert.ok(worker.agent.args.includes("--dangerously-skip-permissions"));
    assert.match(worker.agent.prompts[0], /^Work board task proj\/1, role: agent\./); assert.match(worker.agent.prompts[0], /This task has an approved plan, written by a planner: read .*plan\.md first/);
    assert.doesNotMatch(fs.readFileSync(path.join(S.dirOf(id), "rules.md"), "utf8"), /planner|starts with a plan/); // the worker's rules are the work's
    b.v.load();
    assert.match(b.text(), /Planner used/);
  } finally { w.cleanup(); }
});

test("the settings are read when their step starts: set on a task under way they do not start a plan, taken off while the plan is written the build goes on; a stop with no plan is a failure the agent can fix", async () => {
  const w = await planWorld({ "worker.agent": "codex", "review.when": "never" });
  try {
    // Asked for at the start, taken off while the plan is being written: nobody is asked, and it builds.
    w.script({ worker: [{ plan: PLAN, note: "Written." }, { plan: PLAN, note: "Written again." }, BUILDING] });
    const two = A.add(w.root, "More").id;
    A.delegate(two, { "plan.approve": "you" });
    let t = await settle(two);
    assert.equal(t.plan.by, "you"); assert.equal(t.stage, "plan");
    S.setValue("plan.approve", "none", { task: t });
    A.tell(two, "One more thought.");
    t = await settle(two);
    assert.equal(t.plan.approvedBy, "nobody"); assert.ok(t.plan.built); assert.match(prompts(w, t).at(-1), /This task has an approved plan/); assert.equal(t.stage, "working", JSON.stringify(t.failure));
    // Set on a task whose agent already builds: nothing about this run changes, and no second plan is asked for.
    const built = t.plan.built;
    S.setValue("plan.approve", "you", { task: t });
    A.tell(two, "One more file.");
    t = await started(two);
    assert.equal(t.plan.built, built); assert.equal(t.stage, "working"); assert.equal(prompts(w, t).at(-1), "One more file."); assert.ok(!isLocked(t));
    // No plan in the file and nothing said: that is a failure the agent can fix, not a plan.
    w.script({ worker: [{ note: "" }] });
    const three = A.add(w.root, "Third").id;
    A.delegate(three, { "plan.approve": "you" });
    t = await settle(three);
    assert.equal(t.stage, "failed"); assert.equal(t.failure.title, "No plan was written"); assert.equal(t.failure.agentCanFix, true);
    // Removed while its plan step is open: the read-only worktree is made writable first, and goes.
    assert.ok(isLocked(t)); const tree = t.worktree;
    await A.clear(three);
    assert.ok(!fs.existsSync(tree)); assert.equal(S.get(three), null);
  } finally { w.cleanup(); }
});

test("nothing is changed before the yes: while the plan is written and while it waits the worktree is read-only, also for files git ignores; a change that gets in all the same is put back and kept as a patch; a change the board may not undo holds the build", async () => {
  const w = await planWorld({ "plan.approve": "you", "worker.agent": "codex", "review.when": "never" });
  try {
    fs.writeFileSync(path.join(w.root, ".gitignore"), "ignored.txt\nkept.log\n"); git(w.root, "add", "-A"); git(w.root, "commit", "-qm", "ignore");
    // An agent with full access that writes while it plans: nothing it does gets in, during its turn or after.
    w.script({ worker: [{ files: { "a.txt": "changed before yes\n", "ignored.txt": "early\n", "new.txt": "x\n" }, commit: "early", refused: true, plan: PLAN, note: "Written." }, { plan: PLAN, note: "Written." }, BUILDING] });
    const id = A.add(w.root, "Work").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "plan"); assert.ok(!t.plan.approvedAt); assert.ok(!t.plan.undone, "nothing had to be put back: nothing got in"); assert.ok(paneOf(w, t).agent.args.includes("--dangerously-bypass-approvals-and-sandbox"));
    const at = (rel) => path.join(t.worktree, rel), read = (rel) => { try { return fs.readFileSync(at(rel), "utf8"); } catch { return null; } };
    assert.equal(read("a.txt"), "one\n"); assert.equal(read("ignored.txt"), null); assert.equal(read("new.txt"), null); assert.equal(git(t.worktree, "rev-parse", "HEAD"), t.baseSha);
    assert.ok(isLocked(t)); assert.throws(() => fs.writeFileSync(at("a.txt"), "x"), /EACCES|EPERM/); assert.throws(() => git(t.worktree, "commit", "--allow-empty", "-qm", "x")); // reading still works: the board's own look just did
    // Somebody takes the lock off and changes things: a tracked file, a new one, a commit, and files git ignores.
    unlock(t);
    fs.writeFileSync(at("a.txt"), "changed\n"); git(t.worktree, "add", "-A"); git(t.worktree, "commit", "-qm", "early");
    fs.writeFileSync(at("new.txt"), "x\n"); fs.writeFileSync(at("ignored.txt"), "early content\n");
    assert.deepEqual(changed(S.get(id)).sort(), ["(1 commit added)", "a.txt", "ignored.txt (ignored by git, added)", "new.txt"]);
    A.tell(id, "Once more."); // the plan's next turn ends
    t = await settle(id);
    assert.equal(t.stage, "plan", JSON.stringify(t.failure)); assert.equal(t.plan.undone.n, 4);
    assert.match(t.msg, /4 changes in the repo made before the plan was approved were put back/);
    assert.equal(read("a.txt"), "one\n"); assert.equal(read("new.txt"), null); assert.equal(read("ignored.txt"), null); assert.equal(git(t.worktree, "rev-parse", "HEAD"), t.baseSha);
    assert.match(fs.readFileSync(path.join(P.planFolder(t), PATCH), "utf8"), /\+changed/); // what was thrown away is kept beside the plan
    assert.ok(isLocked(t), "and it is read-only again");
    const b = open(w, { rows: 90 }); b.press("alt+t");
    assert.match(b.text(), /Put back\s+4 changes made in the repo before the yes/);
    // While it waits, the same: put back right before the build starts, which then goes on in a writable worktree.
    unlock(t); fs.writeFileSync(at("kept.log"), "late\n");
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "working", JSON.stringify(t.failure)); assert.ok(t.plan.built); assert.equal(read("kept.log"), null); assert.ok(!isLocked(t)); fs.writeFileSync(at("f.txt"), "built\n");
    // A task in your own checkout: the board undoes nothing there, and nothing is built on a change.
    w.script({ worker: [{ plan: PLAN, note: "Written." }, BUILDING] });
    const own = A.add(w.root, "In the checkout").id;
    S.update(own, { startedOnce: true }); // (how a task comes to work in your checkout)
    A.delegate(own);
    let u = await settle(own);
    assert.equal(u.stage, "plan", JSON.stringify(u.failure)); assert.ok(!u.worktree); assert.equal(u.plan.locked, false); assert.ok(!isLocked({ worktree: w.root }));
    // Its writer runs in the mount too, your checkout read-only inside it; your own files keep their permissions.
    assert.equal(w.state().panes.find((p) => p.pane_id === u.link.pane).agent.boxed, true); assert.ok(boxedCommand(u, "x", "codex", []).includes(`--ro-bind ${w.root} ${w.root} --die-with-parent -- codex`));
    fs.writeFileSync(path.join(w.root, "a.txt"), "changed while waiting\n");
    assert.equal(putBack(u), null);
    A.approve(own);
    u = await settle(own);
    assert.equal(u.stage, "failed"); assert.ok(!u.plan.built); assert.equal(u.failure.title, "The repo was changed before the plan was approved"); assert.match(u.failure.detail, /- a\.txt/);
    assert.equal(prompts(w, u).length, 1, "the builder was told nothing"); assert.equal(fs.readFileSync(path.join(w.root, "a.txt"), "utf8"), "changed while waiting\n");
    fs.writeFileSync(path.join(w.root, "a.txt"), "one\n"); // undone: the start is tried again, and the yes still stands
    A.retry(own);
    u = await settle(own);
    assert.equal(u.stage, "working", JSON.stringify(u.failure)); assert.ok(u.plan.built); assert.equal(u.plan.approvedBy, "you");
  } finally { w.cleanup(); }
});

test("without a read-only mount no plan is written in a repo: the task does not start and says what is missing; a plan that went back and comes back only as its writer's last message is the new plan, never the old file", async () => {
  const w = await planWorld({ "plan.approve": "you", "worker.agent": "codex", "review.when": "never" }, { sandbox: "none" });
  try {
    // A machine where the mount cannot be made: nothing is started, in the task's worktree or in your checkout.
    const none = A.add(w.root, "No mount").id;
    A.delegate(none);
    let t = await settle(none);
    assert.equal(t.stage, "failed"); assert.ok(!t.plan); assert.equal(t.failure.title, "Could not start the agent"); assert.match(t.failure.detail, /needs bubblewrap/); assert.match(t.failure.detail, /set plan\.approve none --task proj\/1/);
    assert.ok(!w.state().panes.some((p) => p.agent), "no program was started"); assert.ok(!isLocked(t));
    assert.throws(() => startProgram(null, { ...t, plan: { asked: 1, by: "you" } }, "x", "codex", "p", []), /needs bubblewrap/); // nor an open plan step's writer, started again later
    // With the plan taken off it starts as any task does.
    A.delegate(none, { "plan.approve": "none" });
    w.script({ worker: [BUILDING] });
    t = await settle(none);
    assert.equal(t.stage, "working", JSON.stringify(t.failure)); assert.ok(!t.plan);
    // With the mount: a revised plan said, not saved.
    process.env.HERDR_SUPERWORK_SANDBOX = "bwrap";
    w.script({ worker: [{ note: "# First plan\nAdd two files." }, { note: "# Revised plan\nAdd only one file." }, { note: "" }] });
    const id = A.add(w.root, "Work").id;
    A.delegate(id);
    t = await settle(id);
    assert.equal(t.stage, "plan", JSON.stringify(t.failure)); assert.equal(P.readPlan(t), "# First plan\nAdd two files."); assert.equal(paneOf(w, t).agent.boxed, true); assert.ok(!t.fallbacks?.sandbox);
    A.tell(id, "Only one file please.");
    t = await settle(id);
    assert.equal(t.stage, "plan"); assert.equal(t.plan.words, "Revised plan"); assert.equal(P.readPlan(t), "# Revised plan\nAdd only one file."); assert.ok(!t.plan.was);
    // Sent back once more, and nothing comes back: the old file is not a new plan.
    A.tell(id, "And name the file.");
    t = await settle(id);
    assert.equal(t.stage, "failed"); assert.equal(t.failure.title, "No plan was written"); assert.match(t.failure.detail, /no new plan/);
  } finally { w.cleanup(); }
});

test("a plan and several attempts: the plan is made and approved once, then the task is split, and every attempt is handed that plan; the place the plan was written in is attempt A's", async () => {
  const w = await planWorld({ "plan.approve": "you", "attempts.by": "codex, claude", "review.when": "never" });
  try {
    w.script({ worker: [{ plan: PLAN, note: "Written." }, BUILDING, BUILDING] });
    const id = A.add(w.root, "Work").id;
    A.delegate(id);
    let t = await settle(id);
    // One writer, one plan, no attempts yet: who builds is not asked before the yes.
    assert.equal(t.stage, "plan", JSON.stringify(t.failure)); assert.ok(!t.attempts?.length); assert.ok(!t.fallbacks?.attempts); assert.equal(S.attemptsOf(t).length, 0);
    const tree = t.worktree, pane = t.link.pane, space = t.link.workspace;
    A.approve(id);
    t = await settle(id);
    assert.equal(t.stage, "attempts", JSON.stringify(t.failure)); assert.ok(t.plan.built); assert.equal(t.plan.approvedBy, "you"); assert.ok(!t.worktree && !t.link.pane); assert.equal(t.link.workspace, space);
    const [a, b] = S.attemptsOf(t);
    assert.deepEqual(t.attempts.map((x) => [x.letter, x.agent]), [["A", "codex"], ["B", "claude"]]);
    assert.equal(a.worktree, tree); assert.equal(a.link.pane, pane); assert.ok(b.worktree && b.worktree !== tree && fs.existsSync(b.worktree)); assert.equal(b.link.workspace, space);
    assert.ok(!isLocked(a)); assert.ok(!a.plan && !b.plan, "an attempt has no plan step of its own");
    assert.deepEqual(tabs(w, t).sort(), ["Agent A", "Agent B"]);
    for (const c of [a, b]) {
      const p = w.state().panes.find((x) => x.pane_id === c.link.pane);
      assert.ok(!p.agent.boxed); assert.equal(p.agent.kind, c.letter === "A" ? "codex" : "claude");
      assert.match(p.agent.prompts[0], new RegExp(`^Work board task ${c.id}, role: agent\\.`)); assert.ok(p.agent.prompts[0].includes(`read ${P.planFile(t)} first, and build exactly that plan`));
      assert.match(reviewBrief(c, { text: "Done.", change: null, toLand: false, ch: S.work(c) }), /built from a plan that was approved before the work began/);
    }
  } finally { w.cleanup(); }
});
