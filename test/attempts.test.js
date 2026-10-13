// Several attempts at one task and one kept (`attempts.by`, `attempts.pick`; docs/attempts.md): the two settings as
// settings like every other; each attempt in its own worktree, branch and tab; the check filters and the picker
// chooses (none, one or several passing; you or the reviewer); only the chosen one is reviewed, pushed and merged;
// what the board shows (the row's tag and marks, "pick one", the panel's Attempts part, the keys, herdr's sidebar);
// research-only tasks; and, last, the same on the web board.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, git, stateOf } from "./helpers.js";
import { open } from "./board-helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import * as L from "../src/automations/list.js";
import * as R from "../src/research.js";
import { fire } from "../src/automations/fire.js";
import { parseSchedule } from "../src/automations/triggers.js";
import { rules } from "../src/coordinator/rules.js";
import { attemptsFor, compareBrief, markOf, marksLine, standingOf, attemptsShown, settle } from "../src/attempts.js";
import { sizeOf } from "../src/board/view/panel-attempts.js";
import { standing, groupOf } from "../src/board/view/states.js";

const step = (n) => ({ files: { "f.txt": `v${n}\n` }, commit: `v${n}`, note: `Did v${n}.` });
const report = (id, text) => { const dir = R.reportFolder({ id }); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "report.md"), text); return dir; };
// Like `settle` in helpers.js, for a task done several times at once: every attempt's pane is looked at too, and the
// housekeeping pass (which starts queued attempts and settles finished ones) runs between the rounds.
async function settleAll(id, { max = 30 } = {}) {
  const { runJob } = await import("../src/jobs.js");
  const { onPane } = await import("../src/hook.js");
  const { drainJobs } = await import("../src/runner.js");
  const { housekeeping } = await import("../src/housekeeping.js");
  const all = () => [S.get(id), ...S.attemptsOf(S.get(id))].filter(Boolean);
  const seen = () => JSON.stringify(all().map((t) => [t.stage, { ...t.handled, at: 0 }, t.armedAt, { ...t.last, at: 0 }, t.link?.pane]));
  for (let i = 0; i < max; i++) {
    await drainJobs(runJob);
    const before = seen();
    for (const t of all()) if (t.link?.pane) onPane(process.env.HERDR_SOCKET_PATH, t.link.pane);
    housekeeping(process.env.HERDR_SOCKET_PATH, { force: true });
    if (!globalThis.__swJobs.length && seen() === before) break;
  }
  return S.get(id);
}
const kids = (id) => S.attemptsOf(S.get(id));
const kid = (id, letter) => kids(id).find((c) => c.letter === letter);

test("two settings like every other: what a value may be and what a refusal names, the places, never the repo's file, delegate, an automation, the Coordinator, the settings page", async () => {
  const w = await world();
  try {
    assert.equal(S.setting("attempts.by"), 1);
    assert.equal(S.setting("attempts.pick"), "you");
    assert.equal(S.check("attempts.by", "3"), 3);
    assert.equal(S.check("attempts.by", "Claude,codex/gpt-5.5  pi"), "claude, codex/gpt-5.5, pi");
    assert.equal(S.check("attempts.by", "claude, claude"), "claude, claude");
    assert.throws(() => S.check("attempts.by", "8"), /attempts\.by takes at most 5: every attempt is a whole agent with its own worktree, holds one of board\.agents' slots and costs what the task costs when it is done once\. Not 8: did you mean 5\?/);
    assert.throws(() => S.check("attempts.by", "claude, codex, pi, claude, codex, pi"), /at most 5.*Not 6: did you mean 5\?/);
    assert.throws(() => S.check("attempts.by", "0"), /must be 1 or more, not 0\. Did you mean 1\?/);
    assert.throws(() => S.check("attempts.by", "codex"), /one agent is one attempt\. For that, set worker\.agent codex; for several attempts name each one \(codex, codex\) or give a count \(2\)/);
    assert.throws(() => S.check("attempts.by", "claude, codx"), /no agent program "codx".*Did you mean codex\?/);
    assert.throws(() => S.check("attempts.pick", "reviewr"), /attempts\.pick must be you, reviewer, not "reviewr"\. Did you mean reviewer\?/);
    // a refused value changes nothing
    S.setValue("attempts.by", "2");
    assert.throws(() => S.setValue("attempts.by", "9"), /at most 5/);
    assert.equal(S.setting("attempts.by"), 2);
    // who makes each attempt: a count is that many of worker.agent; 1 is the task done once
    assert.deepEqual(S.attemptAgents(3, "codex/gpt-5.5"), ["codex/gpt-5.5", "codex/gpt-5.5", "codex/gpt-5.5"]);
    assert.deepEqual(S.attemptAgents("claude, pi", "codex"), ["claude", "pi"]);
    assert.deepEqual(S.attemptAgents(1, "codex"), []);
    // an agent that cannot ask is refused in a list while the worker's access says ask
    assert.throws(() => S.setMany({ "attempts.by": "claude, pi", "worker.access": "ask" }, {}), /attempts\.by: pi cannot do "ask"/);
    S.unsetValue("attempts.by");
    {
      fs.writeFileSync(path.join(w.root, ".herdr-superwork.json"), JSON.stringify({ attempts: { by: 5, pick: "reviewer" }, check: { command: "true" } }));
      const id = A.add(w.root, "T").id, at = () => S.setting("attempts.by", S.get(id));
      // the repo's own committed file cannot switch it on: code an agent writes may not ask for five attempts
      const file = S.repoFile(w.root);
      assert.deepEqual(file.facts, { "check.command": "true" });
      assert.ok(file.refused.some((r) => r.startsWith(".herdr-superwork.json: attempts.by is refused: the repo's file may only hold")));
      assert.ok(file.refused.some((r) => r.includes("attempts.pick is refused")));
      assert.equal(at(), 1);
      S.setValue("attempts.by", "2");
      assert.equal(at(), 2);
      S.setValue("attempts.by", "claude, codex", { repo: "proj" });
      assert.equal(at(), "claude, codex");
      S.setValue("attempts.by", "3", { task: S.get(id) });
      assert.equal(at(), 3);
      const row = () => S.settingRows({ task: S.get(id) }).find((r) => r.name === "attempts.by");
      assert.deepEqual([row().value, row().from, row().own], [3, "this task", true]);
      S.unsetValue("attempts.by", { task: S.get(id) });
      assert.deepEqual([row().value, row().from], ["claude, codex", "your entry for proj"]);
      assert.match(S.showText({ task: S.get(id) }), /attempts\.by +claude, codex +your entry for proj/);
      assert.match(S.showText(), /\* attempts\.by +2 +you/);
      // a task in no repo is always done once: it has no worktree to give each attempt
      assert.equal(S.needsRepo("attempts.by") && S.needsRepo("attempts.pick"), true);
      assert.deepEqual(attemptsFor({ id: "nowhere/1", stage: "queued" }), []);
      S.unsetValue("attempts.by"); S.unsetValue("attempts.by", { repo: "proj" }); fs.rmSync(path.join(w.root, ".herdr-superwork.json"));
    }
    {
      // a refused option changes nothing on the task
      const id = A.add(w.root, "T").id;
      assert.throws(() => A.delegate(id, { "attempts.by": "7", "attempts.pick": "reviewer" }), /at most 5/);
      assert.deepEqual(S.get(id).settings, {});
      assert.equal(S.get(id).stage, "todo");
      const t = A.delegate(id, { "attempts.by": "2", "attempts.pick": "reviewer" });
      assert.deepEqual([t.settings["attempts.by"], t.settings["attempts.pick"], t.stage, t.attempts.length], [2, "reviewer", "attempts", 2]);
      assert.match(S.showText({ task: S.get(id) }), /Attempts: A claude · B claude/);
      // attempts.pick is read when the attempts are through: changed under way, it counts
      S.setValue("attempts.pick", "you", { task: S.get(id) });
      assert.equal(S.setting("attempts.pick", S.get(id)), "you");
      // an attempt has its task's settings as they read now, and its own program
      S.setValue("check.command", "npm test", { task: S.get(id) });
      const [a] = S.attemptsOf(S.get(id));
      assert.equal(S.setting("check.command", a), "npm test");
      assert.equal(S.setting("worker.agent", a), "claude");
      // an automation holds it like any setting: a nightly task can be a best-of-2
      const auto = L.add({ name: "Nightly", prompt: "Look", folder: w.root, trigger: parseSchedule("daily 03:00") });
      L.setSetting(auto.id, "attempts.by", "claude, codex");
      const made = fire(auto.id, { kind: "run" });
      assert.equal(S.get(made.task).settings["attempts.by"], "claude, codex");
      // the Coordinator's standing rules say it in plain words
      assert.match(rules("board"), /"do this one three times and let me choose"/);
      assert.match(rules("board"), /board delegate <id> --attempts\.by 3/);
      assert.match(rules("board"), /board pick <id> <letter>/);
    }
    {
      const id = A.add(w.root, "T").id;
      const b = open(w);
      b.v.sel = id; b.v.load();
      b.press("ctrl+e");
      const rows = b.v.editRows(b.v.current()), n = rows.findIndex((r) => r.name === "attempts.by");
      b.v.editing.at = n;
      let text = b.text();
      assert.match(text, /Attempts by: a count from 1 to 5, or programs with commas between them \(claude, codex, pi\)/);
      assert.match(text, /Attempts by +1 +built in +attempts\.by/);
      b.v.editing.at = n + 1; // the row under it: the page keeps the selected row on screen, and it has more rows than the window now
      assert.match(b.text(), /Attempt picked by +you +built in +attempts\.pick/);
      b.v.editing.at = n;
      b.press("enter"); b.type("claude, pi"); b.press("enter");
      assert.equal(S.get(id).settings["attempts.by"], "claude, pi");
      b.v.editing.at = n + 1;
      assert.match(b.text(), /Attempt picked by: \[you\] · reviewer/);
      b.press("enter");
      assert.equal(S.get(id).settings["attempts.pick"], "reviewer");
    }
  } finally { w.cleanup(); }
});

test("the check filters: one attempt left is the winner and nobody is asked; none left, the task failed with all kept", async () => {
  const w = await world({ settings: { "review.when": "never", "review.rounds": 0, "check.command": "grep -q good f.txt", "board.agents": 2 } });
  try {
    w.script({ worker: [{ files: { "f.txt": "bad\n" }, commit: "a", note: "A." }, { files: { "f.txt": "good\n" }, commit: "b", note: "B." }] });
    const id = A.add(w.root, "One passes").id;
    A.delegate(id, { "attempts.by": 2 });
    const t = await settleAll(id);
    assert.deepEqual([t.picked?.letter, t.picked?.by, t.stage], ["B", "check", "approval"], JSON.stringify(t.failure));
    assert.equal(kid(id, "A").failure.stage, "check");
    assert.ok(fs.existsSync(kid(id, "A").worktree) && !kid(id, "A").link.pane, "the other's tab closes, its worktree stays");
    assert.equal(t.checkedWith, "grep -q good f.txt"); // its check is not run twice: for this command, on this commit
    // removing the task never takes unsaved work with it: an attempt's worktree with files nobody committed stays
    fs.writeFileSync(path.join(kid(id, "A").worktree, "unsaved.txt"), "mine\n");
    const dirA = kid(id, "A").worktree, gone = await A.clear(id);
    // ...and so does one whose only such file is ignored, which a plain `git status` does not name, whatever its date
    {
      const { discard } = await import("../src/attempts.js");
      const dir = path.join(w.base, "loser"); git(w.root, "worktree", "add", "-q", "-b", "work/9a-x", dir);
      fs.writeFileSync(path.join(w.root, ".git", "info", "exclude"), "draft.txt\n");
      const c = { id: "proj/9a", letter: "A", worktree: dir, branch: "work/9a-x", triedAt: Date.now() };
      fs.writeFileSync(path.join(dir, "draft.txt"), "a draft\n"); fs.utimesSync(path.join(dir, "draft.txt"), new Date(Date.now() - 3600000), new Date(Date.now() - 3600000));
      assert.equal(git(dir, "status", "--porcelain"), "");
      assert.match(discard({ id: "proj/9" }, c), /attempt A: files that were never committed/);
      assert.equal(fs.readFileSync(path.join(dir, "draft.txt"), "utf8"), "a draft\n");
      assert.ok(git(w.root, "branch", "--list", "work/9a-x"));
      // with nothing but what was committed in it, the attempt goes, whole
      fs.rmSync(path.join(dir, "draft.txt"));
      assert.equal(discard({ id: "proj/9" }, c), "");
      assert.ok(!fs.existsSync(dir) && !git(w.root, "branch", "--list", "work/9a-x"));
    }
    assert.ok(gone.kept.some((k) => /attempt A: files that were never committed/.test(k)), gone.kept.join(" | "));
    assert.equal(fs.readFileSync(path.join(dirA, "unsaved.txt"), "utf8"), "mine\n");
    assert.match(git(w.root, "branch", "--list", "work/1a-*"), /work\/1a-one-passes/);
    // none passes (the attempts as they would be saved: no agent runs here)
    const id2 = A.add(w.root, "None passes").id;
    A.delegate(id2, { "attempts.by": 2 });
    for (const [c, patch] of [[kid(id2, "A"), { stage: "failed", failure: { stage: "check", title: "Check failed" } }], [kid(id2, "B"), { stage: "nosummary" }]]) S.update(c.id, patch);
    const f = settle(id2);
    assert.deepEqual([f.stage, f.failure.title, f.msg], ["failed", "No attempt passed", "No attempt passed: A claude: check (Check failed) · B claude: no summary"]);
    assert.equal(kids(id2).length, 2, "all attempts kept to look at");
    assert.equal(stateOf(id2).state, "error");
    // trying again starts over with fresh attempts
    assert.equal(A.retry(id2).msg, "proj/2: starting over with fresh attempts");
    assert.deepEqual([S.get(id2).stage, kids(id2).map((c) => c.stage)], ["attempts", ["starting", "starting"]]);
  } finally { w.cleanup(); }
});

test("a council: a list of agents, the reviewer compares and picks, and the task runs through to its merge", async () => {
  const w = await world({ settings: { "merge.by": "itself", "merge.pr": false } });
  try {
    w.script({ worker: [step(1), step(2)], picker: [{ comparison: { pick: "b", why: "B is the smallest change.", attempts: [{ letter: "A", note: "Works, but large." }, { letter: "B", note: "Small and right." }] } }] });
    const id = A.add(w.root, "Council").id;
    const d = A.delegate(id, { "attempts.by": "codex/gpt-5.5, pi", "attempts.pick": "reviewer" });
    assert.deepEqual(d.attempts.map((a) => a.agent), ["codex/gpt-5.5", "pi"]);
    assert.deepEqual(kids(id).map((c) => c.agent), ["codex", "pi"]);
    const t = await settleAll(id);
    assert.equal(t.picked?.letter, "B", JSON.stringify([t.stage, t.comparison, t.failure]));
    assert.equal(t.picked.by, "reviewer");
    assert.equal(t.comparison.why, "B is the smallest change.");
    assert.equal(t.comparison.notes.A, "Works, but large.");
    assert.equal(t.agent, "pi");
    assert.equal(t.settings["worker.agent"], "pi");
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.equal(git(w.root, "show", "HEAD:f.txt"), "v2");
    assert.equal(S.reviewHistory(t).length, 1, "only the chosen attempt was reviewed in full");
    // done and tidied: the losers' worktrees, branches and folders went with it
    assert.equal(kids(id).length, 0);
    assert.equal(git(w.root, "branch", "--list", "work/*"), "");
  } finally { w.cleanup(); }
});

test("an attempt that another agent took over (worker.fallback) is chosen: the task keeps that agent, its model and the hand-overs", async () => {
  const w = await world({ settings: { "review.when": "never", "worker.fallback": "codex/gpt-5.5" } });
  try {
    w.script({ worker: [step(1), step(2)] });
    const id = A.add(w.root, "Greet").id;
    A.delegate(id, { "attempts.by": 2 });
    await settleAll(id);
    assert.equal(S.get(id).stage, "pick");
    // attempt A changed hands on the way (finish/hand-over.js writes exactly this on it)
    const a = kids(id)[0], over = { at: Date.now(), role: "worker", from: "claude", to: "codex/gpt-5.5", why: "out of allowance" };
    S.update(a.id, (c) => { c.agent = "codex"; c.app = "codex"; c.on = "codex/gpt-5.5"; c.tried = ["claude", "codex/gpt-5.5"]; c.handovers = [over]; });
    A.pick(id, "A");
    const t = S.get(id);
    assert.deepEqual([t.agent, t.on, t.tried, t.handovers, t.settings["worker.agent"]], ["codex", "codex/gpt-5.5", ["claude", "codex/gpt-5.5"], [over], "codex/gpt-5.5"]);
    assert.equal(S.onNow(t, S.setting("worker.agent", t)), "codex/gpt-5.5"); // a restart starts the one that did the work, on its model
    assert.equal(S.nextFallback(S.setting("worker.fallback", t), { on: S.onNow(t), tried: t.tried }).agent, ""); // and it is not handed to itself
  } finally { w.cleanup(); }
});

test("a mark per attempt: passed, at work with its percent, out with why, waiting for a slot, asking you", () => {
  const at = Date.now(), c = (letter, agent, more) => ({ letter, agent, settings: { "worker.agent": agent }, ...more });
  const tries = [c("A", "claude", { stage: "tried" }), c("B", "codex", { stage: "working", state: "working", progress: 60 }), c("C", "pi", { stage: "failed", failure: { stage: "check" } })];
  assert.equal(marksLine(tries, at), "A claude ✓ · B codex working 60% · C pi ✗ check");
  assert.equal(markOf(c("D", "claude", { stage: "queued" }), at), "D claude waits for a slot");
  assert.equal(markOf(c("E", "claude", { stage: "asks" }), at), "E claude ? asks you");
  assert.equal(markOf(c("A", "claude", { stage: "checking" }), at), "A claude checking");
  assert.equal(markOf(c("A", "claude", { stage: "nosummary" }), at), "A claude ✗ no summary");
  assert.deepEqual(["tried", "failed", "asks", "queued", "working", "stopped"].map((stage) => standingOf({ stage })), ["passed", "out", "needs", "waits", "works", "out"]);
  // an agent whose terminal is gone is out; one cut off by its provider that the board tries again is still in it
  assert.equal(standingOf({ stage: "working", last: { gone: true } }), "out");
  assert.equal(standingOf({ stage: "failed", waiting: { who: "agent", until: at + 60000, for: 1 }, failure: { at: 1 } }, at), "works");
  // the task's own bar is the attempts' average, and one that asks makes the task need you
  assert.deepEqual([attemptsShown(tries, at).state, attemptsShown(tries, at).progress], ["working", 87]);
  assert.equal(attemptsShown([...tries, c("D", "pi", { stage: "asks" })], at).state, "blocked");
  assert.equal(sizeOf("3 files changed, 10 insertions(+), 2 deletions(-)"), "3 files · +10 −2");
  assert.equal(sizeOf("1 file changed, 1 insertion(+)"), "1 file · +1 −0");
});

test("a count above the free slots waits its turn; a reply goes to every attempt still in it; stop stops them all; show names each agent", async () => {
  const w = await world({ settings: { "review.when": "never", "board.agents": 2 } });
  try {
    w.script({ worker: [{ ...step(1), status: "working" }, { ...step(2), status: "working" }] });
    const id = A.add(w.root, "Talk").id;
    A.delegate(id, { "attempts.by": "claude, codex, pi" });
    const { runJob } = await import("../src/jobs.js");
    const { drainJobs } = await import("../src/runner.js");
    await drainJobs(runJob);
    assert.deepEqual(kids(id).map((c) => c.stage), ["working", "working", "queued"]);
    assert.deepEqual([stateOf(id).note, stateOf(id).state], ["A claude working · B codex working · C pi waits for a slot", "working"]);
    assert.equal(A.tell(id, "Use tabs.").msg, "Sent to 2 attempts (A, B)");
    const prompts = w.state().panes.filter((p) => p.agent).map((p) => p.agent.prompts.at(-1));
    assert.ok(prompts.every((p) => p.includes("Use tabs.")));
    // from the board too: the chat talks to the task's attempts
    const b = open(w); b.v.sel = id; b.v.load(); b.press("space"); b.type("And spaces."); b.press("enter");
    assert.ok(w.state().panes.filter((p) => p.agent).every((p) => p.agent.prompts.at(-1).includes("And spaces.")), b.v.msg);
    assert.match(S.showText({ task: S.get(id) }), /Attempts: A claude · B codex · C pi/);
    assert.deepEqual(A.details(id).attempts.map((a) => [a.letter, a.agent, a.standing]), [["A", "claude", "works"], ["B", "codex", "works"], ["C", "pi", "waits"]]);
    assert.throws(() => A.archive(id), /still active/);
    A.stop(id);
    assert.equal(S.get(id).stage, "stopped");
    assert.deepEqual(kids(id).map((c) => c.stage), ["stopped", "stopped", "todo"]);
  } finally { w.cleanup(); }
});

test("research only: several reports; the reviewer reads them, is asked for one report from all, and the chosen attempt's report is the task's", async () => {
  const w = await world({ settings: { "review.when": "repos" } });
  try {
    w.script({ worker: [{ note: "Report A written." }, { note: "Report B written." }], picker: [{ comparison: { pick: "A", why: "A is better sourced." } }] });
    const id = A.add(w.root, "Look into it", { research: true }).id;
    A.delegate(id, { "attempts.by": "claude, codex", "attempts.pick": "reviewer" });
    assert.ok(kids(id).every((c) => R.isResearch(c)), "an attempt is research only as its task is");
    report("proj/1a", "# A\n"); report("proj/1b", "# B\n");
    const t = await settleAll(id);
    assert.equal(t.picked?.letter, "A", JSON.stringify([t.stage, t.comparison, t.failure, kids(id).map((c) => [c.stage, c.failure?.title])]));
    assert.equal(t.comparison.wrote, true);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.equal(fs.readFileSync(path.join(R.reportFolder(t), t.report.file), "utf8"), "# A\n"); // (it wrote none here: the chosen attempt's report is the task's)
    assert.equal(S.gitOut(w.root, ["branch", "--list", "work/*"]), "", "nothing of it stays in the repo");
    // what it was told
    const said = compareBrief({ ...t, comparing: { pick: "reviewer" } }, [{ letter: "A", agent: "claude", id: "proj/1a", summary: "Report A written." }, { letter: "B", agent: "codex", id: "proj/1b" }], { writes: true });
    assert.match(said, /This task is research only: each attempt's whole result is a report/);
    assert.match(said, new RegExp(`its report: ${R.reportFolder({ id: "proj/1a" })}/`));
    assert.match(said, new RegExp(`Then write one report from all of them.*Save it in ${R.reportFolder({ id })}/`));
    assert.match(said, /"pick": "<the letter of the attempt to keep: A or B>"/);
  } finally { w.cleanup(); }
});

test("one row with ×3, pick one under needs you, the panel's attempts, the approve key keeps the selected one, and the same on the web board", async () => {
  const w = await world({ settings: { "merge.pr": false, "merge.by": "itself", "check.command": "true" } });
  try {
    w.script({ worker: [step(1), step(2), step(3)], picker: [{ comparison: { pick: "B", why: "B handles the empty case.", attempts: [{ letter: "A", note: "Misses the empty case." }, { letter: "B", note: "Complete." }] } }] });
    const id = A.add(w.root, "Greet").id;
    A.delegate(id, { "attempts.by": 3 });
    // while they start: one row, tagged, no row for an attempt
    const b = open(w, { rows: 50 });
    assert.match(b.text(), /Greet ×3/);
    assert.equal(b.v.items.length, 1);
    await settleAll(id);
    b.v.load();
    const r = b.v.current();
    assert.equal(r.stage, "pick"); // `merge.by itself` still stops for the choice
    assert.deepEqual([groupOf(r), standing(r)], ["needs you", "pick one"]);
    // each attempt on its own: a worktree, a branch and a tab, in the task's one space; no row of its own
    const cs = kids(id);
    assert.deepEqual(cs.map((c) => c.branch), ["work/1a-greet", "work/1b-greet", "work/1c-greet"]);
    assert.deepEqual(cs.map((c) => fs.readFileSync(path.join(c.worktree, "f.txt"), "utf8")), ["v1\n", "v2\n", "v3\n"]);
    assert.equal(new Set(cs.map((c) => c.link.workspace)).size, 1);
    assert.deepEqual(F.h(cs[0]).tabs(cs[0].link.workspace).map((x) => x.label), ["Agent A", "Agent B", "Agent C"]); // (the Picker's tab closed)
    assert.equal(S.list().length, 1);
    assert.throws(() => A.approve(id), /waits for you to pick one of its attempts/);
    assert.throws(() => A.pick(id, "E"), /has no attempt E\. Those that passed: A, B, C/);
    let text = b.text();
    assert.match(text, /needs you/);
    assert.match(text, /Pick one of 3 · the reviewer recommends B/);
    // the panel: the comparison on top, each attempt with its agent, check result and size, and a link to its diff
    assert.match(text, /Pick one of 3 ─/);
    assert.doesNotMatch(text, /Asks for your OK/);
    assert.match(text, /Reviewer +recommends B: B handles the/);
    assert.match(text, /  A +claude · ✓ passed the check/);
    assert.match(text, /  C +claude/);
    assert.match(text, /1 file · \+1 −0/);
    assert.match(text, /Misses the empty case\./);
    assert.match(text, /  B › +claude · ✓ passed the check/);
    assert.match(text, /Open its diff/);
    assert.ok(kid(id, "A").diff.file.endsWith("/1a/artifacts/diff.txt"));
    // herdr's sidebar says it too: on the space, and on each attempt that passed
    F.syncSidebar(F.board());
    const meta = w.state().metadata.map((m) => m.args.join(" "));
    assert.ok(meta.some((m) => m.includes("summary=Pick one of 3 · the reviewer recommends B")), meta.join("\n"));
    assert.ok(meta.some((m) => /--display-agent pick one/.test(m)), meta.join("\n"));
    // the hint line names the keys; ctrl+n moves on, and the approve key keeps the selected one after a yes
    assert.match(b.screen().at(-1), /ctrl\+l keep attempt B · ctrl\+n the next attempt · enter open attempt B's agent/);
    // the web board: the same row, the same part, and the keys as buttons. (Loaded here, in the file's last test:
    // from then on a key is named as its button is.)
    {
      const { WebView } = await import("../src/webui/web-view.js"), { snapshot } = await import("../src/webui/worker.js");
      const v = new WebView({ cwd: w.root }); v.sel = id; v.load();
      const s = snapshot(v), row = s.list.groups.flatMap((g) => g.rows).find((x) => x.id === id);
      assert.deepEqual([s.list.groups[0].name, row.title, row.says.map((p) => p.t).join("")], ["needs you", "Greet ×3", "Pick one of 3 · the reviewer recommends B"]);
      assert.deepEqual(s.actions.map((x) => [x.id, x.label]).slice(0, 2), [["yes", "keep attempt B"], ["nextAttempt", "the next attempt"]]);
      v.full = true;
      assert.deepEqual(snapshot(v).panel.parts.find((x) => x.head === "Pick one of 3").items.filter((x) => x.k === "fact").map((x) => x.label.trim()), ["Reviewer", "A", "B ›", "C"]);
      v.full = false;
      v.press("nextAttempt"); v.press("yes");
      assert.match(snapshot(v).ask.q, /Keep attempt C \(claude\)/);
      v.press("sayNo");
      assert.equal(S.get(id).stage, "pick");
    }
    b.press("\x0e");
    assert.equal(b.v.attemptSel(b.v.current()), "C");
    assert.match(b.text(), /  C › +claude/);
    assert.match(b.text(), /  B ★ +claude/); // the reviewer's choice keeps its mark
    b.press("ctrl+l");
    assert.match(b.text(), /Keep attempt C \(claude\) of #1 "Greet"\?/);
    b.press("n");
    assert.equal(S.get(id).stage, "pick");
    // the check was changed while it waited: the chosen attempt is checked again, with the new command
    S.setValue("check.command", "touch \"$HERDR_SUPERWORK_REPO/.git/checked-again\"", { task: S.get(id) });
    b.press("ctrl+l", "y");
    assert.equal(S.get(id).picked.letter, "C");
    assert.ok(fs.existsSync(kid(id, "A").worktree) && !kid(id, "A").link.pane, "the others' tabs close, their worktrees stay");
    S.setValue("merge.by", "you", { task: S.get(id) });
    const done = await settleAll(id);
    assert.equal(done.stage, "approval", JSON.stringify(done.failure));
    assert.deepEqual([done.branch, done.agent, S.reviewHistory(done).length], ["work/1c-greet", "claude", 1]);
    assert.ok(fs.existsSync(path.join(w.root, ".git", "checked-again")), "the new check ran");
    b.v.load();
    text = b.text();
    assert.match(text, /Status ─/); // beside the list the part is short: nothing else gives way to it
    assert.match(text, /Chosen +C · by you/);
    assert.doesNotMatch(text, /Misses the empty case/);
    assert.match(text, /Attempts +A claude, B claude, C claude/);
    assert.match(text, /C was chosen/);
    assert.match(text, /  C ★ +claude/);
    assert.equal(stateOf(id).tries.length, 3);
  } finally { w.cleanup(); }
});
