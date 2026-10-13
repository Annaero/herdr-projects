// The settings' one rule: the order of the places, the repo file's five facts, board settings refused on a task,
// instructions adding up, `none` against unset, what a value may be, a mistake made by hand, and a refused delegate.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, git } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { rules } from "../src/delegate.js";

const config = () => path.join(process.env.HERDR_SUPERWORK_CONFIG_DIR, "config.json");
const write = (c) => fs.writeFileSync(config(), JSON.stringify(c));
const saved = () => JSON.parse(fs.readFileSync(config(), "utf8"));
// A task as it stands after its worktree started: it took the repo's file from that commit.
const started = (w, id) => S.update(id, (t) => { const f = S.repoFile(w.root, "HEAD"); t.repoFile = f.facts; t.repoRefused = f.refused; });

test("one order for every work setting: this task, your entry for the repo, you, the repo's file, built in", async () => {
  const w = await world({ repoSettings: { check: { command: "from the file", timeout: "20m" } } });
  try {
    const id = A.add(w.root, "One").id;
    const at = (name = "check.command") => { const r = S.lookup(name, { task: S.get(id) }); return [r.value, r.from]; };
    started(w, id);
    assert.deepEqual(at("workspace.setup"), ["none", "built in"]);
    assert.deepEqual(at(), ["from the file", "the repo's file"]);
    S.setValue("check.command", "from you"); assert.deepEqual(at(), ["from you", "you"]);
    S.setValue("check.command", "from the entry", { repo: "proj" }); assert.deepEqual(at(), ["from the entry", "your entry for proj"]);
    S.setValue("check.command", "from the task", { task: S.get(id) }); assert.deepEqual(at(), ["from the task", "this task"]);
    // each `unset` hands it to the next place down, and works for every setting
    S.unsetValue("check.command", { task: S.get(id) }); assert.deepEqual(at(), ["from the entry", "your entry for proj"]);
    S.unsetValue("check.command", { repo: "proj" }); assert.deepEqual(at(), ["from you", "you"]);
    S.unsetValue("check.command"); assert.deepEqual(at(), ["from the file", "the repo's file"]);
    assert.deepEqual(saved(), { "watcher.agent": "none", "coordinator.agent": "none" }); // nothing of it is left in the file
    for (const name of S.NAMES) { const scope = S.entryOf(name).kind === "work" ? { task: S.get(id) } : {}; assert.equal(S.unsetValue(name, scope).name, name); }
    // the same one function answers for every setting: another repo's entry is not this task's
    S.setValue("review.rounds", "7", { repo: "proj" }); assert.deepEqual(at("review.rounds"), [7, "your entry for proj"]);
    const other = fs.mkdtempSync(path.join(w.base, "other-")); git(other, "init", "-q", "-b", "main");
    const far = A.add(other, "Elsewhere");
    assert.equal(S.setting("review.rounds", far), 3); assert.equal(S.setting("review.rounds"), 3);
    // the file is written nested, with real booleans and numbers
    S.setValue("merge.pr", "no"); assert.deepEqual(saved().merge, { pr: false }); assert.deepEqual(saved().repos, { proj: { review: { rounds: 7 } } });
    assert.match(S.showText({ task: S.get(id) }), /\n {2}review\.rounds +7 +your entry for proj\n/); assert.match(S.showText(), /\n\* merge\.pr +false +you\n/);
  } finally { w.cleanup(); }
});

test("the repo's own file holds five facts and no more, read from the commit the worktree started from", async () => {
  const w = await world({ repoSettings: { workspace: { setup: "true", include: [".env"], teardown: "down" }, check: { command: "npm test", timeout: "5m" }, merge: { by: "itself" }, review: { when: "never" }, worker: { access: "full" }, setup: "old name" } });
  try {
    const f = S.repoFile(w.root, "HEAD");
    assert.deepEqual(f.facts, { "workspace.setup": "true", "workspace.include": [".env"], "workspace.teardown": "down", "check.command": "npm test", "check.timeout": "5m" });
    assert.deepEqual(S.REPO_FACTS, ["workspace.setup", "workspace.include", "workspace.teardown", "check.command", "check.timeout"]);
    assert.equal(f.refused.length, 4);
    for (const name of ["merge.by", "review.when", "worker.access"]) assert.ok(f.refused.some((r) => r.startsWith(`.herdr-superwork.json: ${name} is refused: the repo's file may only hold`)), name);
    assert.ok(f.refused.includes('.herdr-superwork.json: unknown setting "setup" (did you mean workspace.setup?)'));
    // so code written by agents cannot loosen a guard: the task still waits for you and is still reviewed
    const id = A.add(w.root, "One").id; started(w, id);
    assert.equal(S.setting("merge.by", S.get(id)), "you"); assert.equal(S.setting("review.when", S.get(id)), "repos");
    assert.deepEqual(S.settingProblems(S.get(id)), f.refused); // and the task says what was refused
    // a branch that changes the file changes nothing for a task already started
    fs.writeFileSync(path.join(w.root, ".herdr-superwork.json"), JSON.stringify({ check: { command: "true" } }));
    assert.equal(S.repoFile(w.root, "HEAD").facts["check.command"], "npm test"); assert.equal(S.setting("check.command", S.get(id)), "npm test");
    assert.deepEqual(S.repoFile(w.root).facts, { "check.command": "true" });
    fs.writeFileSync(path.join(w.root, ".herdr-superwork.json"), "{ not json");
    assert.deepEqual(S.repoFile(w.root), { facts: {}, refused: [".herdr-superwork.json is not valid JSON: nothing in it counts"] });
  } finally { w.cleanup(); }
});

test("board settings are yours only: refused on a task and for a repo, with how to set them", async () => {
  const w = await world();
  try {
    const id = A.add(w.root, "One").id;
    for (const name of S.BOARD) {
      assert.match(name, /^(board|coordinator|watcher)\./);
      assert.throws(() => S.setValue(name, "x", { task: S.get(id) }), new RegExp(`${name.replace(".", "\\.")} is a board setting: it is yours only and cannot be set on a task\\. Set it for yourself: herdr-superwork set ${name.replace(".", "\\.")} <value>`));
      assert.throws(() => S.setValue(name, "x", { repo: "proj" }), /is a board setting: it is yours only and cannot be set for a repo/);
      assert.throws(() => S.unsetValue(name, { task: S.get(id) }), /is a board setting/);
    }
    for (const name of S.WORK) assert.doesNotMatch(name, /^(board|coordinator|watcher)\./);
    assert.throws(() => A.delegate(id, { "board.agents": 9 }), /board\.agents is a board setting/); assert.equal(S.get(id).stage, "todo");
    assert.equal(S.setValue("board.agents", "9").value, 9); assert.equal(S.setting("board.agents"), 9);
    // said by hand inside a repo's entry: reported, and not counted
    write({ repos: { proj: { board: { agents: 2 }, review: { rounds: 1 } } } });
    assert.equal(S.setting("board.agents"), 4); assert.equal(S.setting("review.rounds", S.get(id)), 1);
    assert.deepEqual(S.settingProblems(), ['your entry for proj: board.agents is a board setting, yours only: say it outside "repos"']);
    assert.throws(() => S.setValue("merge.by", "itself", { repo: "prej" }), /No repo "prej" on the board\. Did you mean proj\?/);
  } finally { w.cleanup(); }
});

test("instructions add up across the places, broadest first; every other setting is replaced by the nearest answer", async () => {
  const w = await world();
  try {
    const id = A.add(w.root, "One").id;
    const words = () => S.lookup("worker.instructions", { task: S.get(id) });
    assert.equal(words().value, "none"); assert.doesNotMatch(rules(S.get(id)), /own instructions/);
    S.setValue("worker.instructions", "Write British English.");
    S.setValue("worker.instructions", "Use tabs here.", { repo: "proj" });
    S.setValue("worker.instructions", "For this one, use spaces.", { task: S.get(id) });
    assert.equal(words().value, "Write British English.\n\nUse tabs here.\n\nFor this one, use spaces."); assert.equal(words().from, "you + your entry for proj + this task");
    // the agent gets them after the board's own fixed rules, and is told later ones win
    const told = rules(S.get(id));
    assert.match(told, /^Rules for this task[\s\S]*\n\nThe human's own instructions for you follow\. The board's rules above stay as they are; where two of these disagree, the later one wins\.\n\nWrite British English\.\n\nUse tabs here\.\n\nFor this one, use spaces\.$/);
    // `none` in a place drops what the broader places said
    S.setValue("worker.instructions", "none", { repo: "proj" }); assert.equal(words().value, "For this one, use spaces.");
    S.setValue("worker.instructions", "none", { task: S.get(id) }); assert.equal(words().value, "none"); assert.doesNotMatch(rules(S.get(id)), /own instructions/);
    // a list is replaced, not added to
    S.setValue("workspace.include", ".env, .npmrc"); S.setValue("workspace.include", "secrets.json", { task: S.get(id) });
    assert.deepEqual(S.setting("workspace.include", S.get(id)), ["secrets.json"]); assert.deepEqual(S.setting("workspace.include"), [".env", ".npmrc"]);
  } finally { w.cleanup(); }
});

test("`none` is a real answer, distinct from unset: a task can cancel its repo's setup", async () => {
  const w = await world({ repoSettings: { workspace: { setup: "npm ci", include: [".env"] } } });
  try {
    const id = A.add(w.root, "One").id; started(w, id);
    const setup = () => { const r = S.lookup("workspace.setup", { task: S.get(id) }); return [r.value, r.from, S.commandOf(r.value)]; };
    assert.deepEqual(setup(), ["npm ci", "the repo's file", "npm ci"]);
    S.setValue("workspace.setup", "none", { task: S.get(id) }); assert.deepEqual(setup(), ["none", "this task", ""]); assert.deepEqual(S.get(id).settings, { "workspace.setup": "none" });
    S.unsetValue("workspace.setup", { task: S.get(id) }); assert.deepEqual(setup(), ["npm ci", "the repo's file", "npm ci"]); assert.deepEqual(S.get(id).settings, {});
    S.setValue("workspace.include", "none", { task: S.get(id) }); assert.deepEqual(S.listOf(S.setting("workspace.include", S.get(id))), []);
    assert.equal(S.setValue("coordinator.agent", "none").value, "none"); assert.equal(S.setValue("watcher.agent", "none").value, "none");
    assert.throws(() => S.setValue("worker.agent", "none"), /worker\.agent must be claude, codex, pi, with an optional model after a slash/);
  } finally { w.cleanup(); }
});

test("values: a switch, a choice, a time with its unit, an agent with its model, and the nearest right one as a hint", async () => {
  const w = await world();
  try {
    A.add(w.root, "One");
    for (const [typed, kept] of [["yes", true], ["on", true], ["true", true], [true, true], ["no", false], ["off", false], ["FALSE", false]]) assert.equal(S.setValue("merge.pr", typed).value, kept);
    assert.throws(() => S.setValue("merge.pr", "maybe"), /merge\.pr is a switch: true or false \(yes, no, on and off work too\), not "maybe"/); assert.equal(S.setting("merge.pr"), false);
    assert.throws(() => S.setValue("merge.method", "squish"), /merge\.method must be squash, merge, rebase, not "squish"\. Did you mean squash\?/);
    assert.equal(S.setValue("check.timeout", "20m").value, "20m"); assert.equal(S.ms("20m"), 1200000); assert.equal(S.ms("60s"), 60000); assert.equal(S.ms("2h"), 7200000);
    assert.throws(() => S.setValue("check.timeout", "20"), /check\.timeout is a time with a unit, such as 15m \(s, m or h\), not "20"\. Did you mean 20m\?/);
    assert.throws(() => S.setValue("watcher.every", "soon"), /a time with a unit, such as 60s/);
    assert.throws(() => S.setValue("mergeby", "itself"), /Unknown setting "mergeby"\. Did you mean merge\.by\?/);
    assert.throws(() => S.setValue("gate", "minor"), /Unknown setting "gate"/); assert.throws(() => S.setValue("rounds", "2"), /Did you mean review\.rounds\?/);
    // an agent: the model travels with the program, and effort and access are checked against it
    assert.equal(S.setValue("worker.agent", "Codex/gpt-5.5").value, "codex/gpt-5.5"); assert.deepEqual(S.agentOf("codex/gpt-5.5"), { kind: "codex", model: "gpt-5.5" });
    assert.throws(() => S.setValue("worker.agent", "gpt"), /no agent program "gpt"\. It must be claude, codex, pi\./);
    assert.throws(() => S.setValue("worker.effort", "max"), /worker\.effort: codex has no effort "max": it takes minimal, low, medium, high, xhigh/);
    assert.equal(S.setValue("worker.effort", "xhigh").value, "xhigh"); assert.equal(S.setValue("worker.access", "ask").value, "ask");
    assert.throws(() => S.setValue("worker.agent", "pi"), /worker\.agent: pi cannot do "ask": it never asks before it acts/);
    assert.equal(S.setValue("reviewer.access", "ask", { repo: "proj" }).value, "ask"); // codex can ask
  } finally { w.cleanup(); }
});

test("a mistake in a file edited by hand is reported with its setting; the next place down is used and the board keeps running", async () => {
  const w = await world();
  try {
    const id = A.add(w.root, "One").id;
    write({ review: { rounds: "many", mustFix: "minor" }, merge: { pr: "maybe" }, "board.agents": 6, gate: "minor", repos: { proj: { review: { mustFix: "blocker" } } } });
    assert.equal(S.setting("review.rounds", S.get(id)), 3); assert.equal(S.setting("merge.pr", S.get(id)), true); // built in, for those two only
    assert.equal(S.setting("review.mustFix", S.get(id)), "minor"); assert.equal(S.setting("board.agents"), 6); // the entry's is wrong: yours counts; a dotted name is read too
    const bad = S.settingProblems();
    assert.equal(bad.length, 4);
    assert.match(bad.join("\n"), /your settings: review\.rounds must be a whole number, 0 or more, not "many"\./); assert.match(bad.join("\n"), /your settings: merge\.pr is a switch/);
    assert.match(bad.join("\n"), /your settings: unknown setting "gate"/); assert.match(bad.join("\n"), /your entry for proj: review\.mustFix must be critical, major, minor, trivial, not "blocker"\./);
    assert.match(S.showText(), /Not counted \(the next place down is used for each\):\n {2}your settings: /);
    assert.equal(A.delegate(id).stage === "todo", false); // the board keeps running
    fs.writeFileSync(config(), "{ broken"); assert.equal(S.setting("board.agents"), 4); assert.deepEqual(S.settingProblems(), ["your settings: it is not valid JSON, so nothing in it counts"]);
  } finally { w.cleanup(); }
});

test("a refused delegate changes nothing on the task; a task in no repo skips the repo places", async () => {
  const w = await world();
  try {
    const id = A.add(w.root, "One").id;
    assert.throws(() => A.delegate(id, { "reviewer.agent": "claude", "merge.by": "sometimes" }), /merge\.by must be you, itself, not "sometimes"/);
    assert.deepEqual(S.get(id).settings, {}); assert.equal(S.get(id).stage, "todo"); // not even the option that was right
    assert.throws(() => A.delegate(id, { "worker.agent": "pi", "worker.access": "ask" }), /pi cannot do "ask"/); assert.deepEqual(S.get(id).settings, {});
    assert.throws(() => A.delegate(id, { agent: "codex" }), /Unknown setting "agent"\. Did you mean worker\.agent\?/);
    A.delegate(id, { "reviewer.agent": "claude", "merge.by": "itself", "worker.agent": "codex/gpt-5.5", "worker.effort": "high" });
    assert.deepEqual(S.get(id).settings, { "reviewer.agent": "claude", "merge.by": "itself", "worker.agent": "codex/gpt-5.5", "worker.effort": "high" }); assert.equal(S.get(id).agent, "codex");
    // no repo: where it works, how it is checked and how it lands do not apply, and `show` says so
    const plain = fs.mkdtempSync(path.join(w.base, "plain-"));
    fs.writeFileSync(path.join(plain, ".herdr-superwork.json"), JSON.stringify({ check: { command: "npm test" } }));
    const t = A.add(plain, "Outside a repo");
    S.setValue("check.command", "mine"); S.setValue("review.rounds", 5);
    assert.equal(S.inRepo(t), false); assert.deepEqual(S.lookup("check.command", { task: t }), { name: "check.command", value: "none", place: "builtin", from: "built in", applies: false });
    assert.equal(S.setting("review.rounds", t), 5);
    assert.match(S.showText({ task: t }), /check\.command +none +does not apply: this task is in no repo/); assert.match(S.showText({ task: t }), /merge\.by +you +does not apply/);
    assert.throws(() => S.setValue("merge.by", "itself", { task: t }), /merge\.by does not apply to plain-[^:]+: it is in no repo\./);
  } finally { w.cleanup(); }
});

test("other machines: a task's work settings travel with it, and board settings stay", async () => {
  const w = await world();
  try {
    A.add(w.root, "First");
    S.setValue("review.rounds", 5); S.setValue("board.agents", 9); S.setValue("worker.instructions", "Mine."); S.setValue("worker.instructions", "For proj.", { repo: "proj" }); S.setValue("merge.by", "itself", { repo: "proj" });
    const sent = S.toSend("proj");
    assert.deepEqual(sent, { "worker.instructions": "Mine.\n\nFor proj.", "review.rounds": 5, "merge.by": "itself" }); // no board setting among them
    assert.deepEqual(S.toSend("elsewhere"), { "worker.instructions": "Mine.", "review.rounds": 5 });
    // on the machine that owns the task they stand where its own "you" and repo entry would
    S.unsetValue("review.rounds"); S.setValue("review.rounds", 1); S.unsetValue("merge.by", { repo: "proj" });
    const id = A.add(w.root, "Sent").id;
    S.update(id, (t) => { t.carried = { from: "laptop", settings: sent }; });
    assert.deepEqual([S.lookup("review.rounds", { task: S.get(id) }).value, S.lookup("review.rounds", { task: S.get(id) }).from], [5, "sent from laptop"]);
    assert.equal(S.setting("merge.by", S.get(id)), "itself"); assert.equal(S.setting("board.agents"), 9);
    S.setValue("review.rounds", 2, { task: S.get(id) }); assert.equal(S.setting("review.rounds", S.get(id)), 2); // its own still wins
  } finally { w.cleanup(); }
});

test("what a task holds is checked too: a wrong value, a board setting or an effort its program does not take is said and not counted", async () => {
  const w = await world();
  try {
    const id = A.add(w.root, "One").id;
    S.setValue("review.rounds", 7);
    // written by hand (or by an older version) into the task itself
    S.update(id, (t) => { t.settings = { "merge.pr": "maybe", "review.rounds": "banana", "board.agents": 9, "review.mustFix": "minor" }; });
    const t = S.get(id);
    assert.deepEqual([S.lookup("merge.pr", { task: t }).value, S.lookup("merge.pr", { task: t }).from], [true, "built in"]);
    assert.deepEqual([S.lookup("review.rounds", { task: t }).value, S.lookup("review.rounds", { task: t }).from], [7, "you"]); // the next place down
    assert.equal(S.setting("review.mustFix", t), "minor"); assert.equal(S.setting("board.agents"), 4);
    const bad = S.settingProblems(t).join("\n");
    assert.match(bad, /this task: merge\.pr is a switch/); assert.match(bad, /this task: review\.rounds must be a whole number/); assert.match(bad, /this task: board\.agents is a board setting, yours only/);
    assert.match(S.showText({ task: t }), /Not counted[\s\S]*this task: merge\.pr is a switch/);
    // names every object has are not values: not for a switch, not for a program
    for (const word of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      assert.throws(() => S.check("merge.pr", word), /merge\.pr is a switch/, word); assert.throws(() => S.check("worker.agent", word), /no agent program/, word);
      assert.throws(() => S.setValue("merge.pr", word), /is a switch/); assert.throws(() => S.setValue("worker.access", word), /must be full or ask/);
    }
    assert.equal(S.setting("merge.pr"), true);
    // an effort or an access written by hand for a program that does not take it: said, and the next place down is used
    fs.writeFileSync(config(), JSON.stringify({ worker: { agent: "codex", effort: "banana" }, reviewer: { agent: "pi", access: "ask" }, coordinator: { agent: "none" }, watcher: { agent: "none" } }));
    assert.deepEqual([S.lookup("worker.effort").value, S.lookup("worker.effort").from], ["default", "built in"]);
    assert.deepEqual([S.lookup("reviewer.access").value, S.lookup("reviewer.access").from], ["full", "built in"]);
    const said = S.settingProblems().join("\n");
    assert.match(said, /your settings: worker\.effort: codex has no effort "banana"/); assert.match(said, /your settings: reviewer\.access: pi cannot do "ask"/);
    S.setValue("worker.effort", "high", { task: S.get(id) }); assert.equal(S.setting("worker.effort", S.get(id)), "high"); // one that fits counts
    S.update(id, (t) => { t.settings = { "worker.agent": "claude", "worker.effort": "minimal" }; }); // claude takes no "minimal"
    assert.equal(S.setting("worker.effort", S.get(id)), "default"); assert.match(S.settingProblems(S.get(id)).join("\n"), /this task: worker\.effort: claude has no effort "minimal"/);
  } finally { w.cleanup(); }
});
