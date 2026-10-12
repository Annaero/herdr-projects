// The gate: tagged findings in, a fixed rule decides what goes back and what may merge.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, paneOf, ghLog } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import * as G from "../src/gate.js";
import { main } from "../src/cli.js";
import { parseVerdict, reviewBrief, knownFaults } from "../src/finish.js";
import { renderReviewPage } from "../src/review-page.js";

const finding = (severity, subject, extra = {}) => ({ severity, subject, where: "f.txt", proof: "ran it", ...extra });
const verdict = (findings, extra = {}) => ({ verdict: { meets: true, text: "Looked at it.", findings, ...extra } });
const work = (n) => ({ files: { "f.txt": `${n}\n` }, commit: `v${n}`, note: `Did v${n}.` });
const reviewOf = (meets, findings, gate, earlier = null) => G.stamp({ meets, text: "T.", ...G.settle(meets, G.readFindings(findings), earlier) }, gate);

test("the board's rules: what counts as critical, what a gate lets through, and how the result reads", () => {
  // each gate lets through what is below it; "off" is judged at the default, for the result shown and an automatic merge
  const mixed = [finding("minor", "A name is unclear"), finding("minor", "A comment is stale"), finding("trivial", "A note")];
  assert.deepEqual(["critical", "major", "minor", "trivial", "off"].map((g) => reviewOf(true, mixed, g).pass), [true, true, false, false, true]);
  assert.equal(G.result(reviewOf(true, mixed, "major")), "Pass · 2 minor, 1 trivial");
  assert.equal(G.result(reviewOf(true, [finding("critical", "Deletes the data"), finding("major", "Crashes on an empty file")], "major")), "Fail · 1 critical, 1 major");
  assert.equal(G.result(reviewOf(true, [], "major")), "Pass"); assert.equal(reviewOf(true, [], "off").gate, "major");
  // `meets: false` always counts as a critical finding, even with an empty list, and at every gate
  const unmet = reviewOf(false, [], "critical");
  assert.equal(unmet.pass, false); assert.deepEqual(unmet.findings.map((f) => [f.severity, f.board, f.subject]), [["critical", true, "The change does not do what the task asked."]]);
  assert.equal(G.result(unmet), "Fail · 1 critical");
  assert.equal(reviewOf(false, [finding("critical", "Does nothing")], "major").findings.length, 1); // already said: not said twice
  // a critical finding with an empty proof is treated as major
  const claim = reviewOf(true, [finding("critical", "Might lose data", { proof: "" })], "critical");
  assert.equal(claim.findings[0].severity, "major"); assert.equal(claim.pass, true); assert.equal(reviewOf(true, [finding("critical", "Might lose data", { proof: " " })], "major").pass, false);
  // a pre-existing finding never fails the gate, whatever its severity
  const old = reviewOf(true, [finding("critical", "The old importer drops rows", { preexisting: true })], "trivial");
  assert.equal(old.pass, true); assert.equal(G.result(old), "Pass · 1 pre-existing"); assert.equal(G.sendable(old), false);
  // a very long list loses its mildest findings, never a serious one, wherever that stands in it
  const long = reviewOf(true, [...Array.from({ length: 150 }, (_, n) => finding("trivial", `Note ${n}`)), finding("critical", "Deletes the data")], "major");
  assert.equal(long.findings.length, 100); assert.equal(long.findings.at(-1).severity, "critical"); assert.equal(long.pass, false); assert.equal(long.left, 51);
  // the cut comes after the rules: critical claims nobody showed and old faults go before a proven critical one does
  const buried = reviewOf(true, [...Array.from({ length: 80 }, (_, n) => finding("critical", `A claim ${n}`, { proof: "" })), ...Array.from({ length: 80 }, (_, n) => finding("critical", `An old fault ${n}`, { preexisting: true })), finding("critical", "Deletes the data"), finding("minor", "A nit")], "critical");
  assert.equal(buried.findings.length, 162); assert.equal(buried.pass, false); assert.ok(buried.findings.some((f) => f.subject === "Deletes the data")); assert.equal(buried.findings.filter((f) => f.severity === "major").length, 80);
  // what was there before the task is never cut, however long the list: each one is to be filed
  const olds = reviewOf(true, [...Array.from({ length: 130 }, (_, n) => finding("minor", `An old fault ${n}`, { preexisting: true })), ...Array.from({ length: 120 }, (_, n) => finding("trivial", `Note ${n}`)), finding("critical", "Deletes the data")], "major");
  assert.equal(olds.findings.filter((f) => f.preexisting).length, 130); assert.equal(olds.findings.filter((f) => !f.preexisting).length, 100); assert.equal(olds.left, 21); assert.equal(olds.pass, false); assert.equal(reviewOf(true, [...Array.from({ length: 20 }, (_, n) => finding("minor", `Nit ${n}`)), finding("critical", "Deletes the data")], "major").pass, false);
  // a severity the board does not know is read as major, a finding without a subject is no finding
  assert.deepEqual(G.readFindings([{ severity: "HIGH", subject: "x" }, { severity: "minor" }, "junk"]).map((f) => f.severity), ["major"]);
  // required and optional: what the agent is told, and what the pull request says
  const rv = reviewOf(true, [finding("major", "Crashes on an empty file"), finding("minor", "A name is unclear"), finding("major", "The old importer drops rows", { preexisting: true })], "major");
  rv.findings[2].task = "proj/9";
  const msg = G.reviewMessage(rv);
  assert.match(msg, /Result: Fail · 1 major, 1 minor, 1 pre-existing\.\n\nT\.\n\nRequired: fix each of these\.\n- \[major\] Crashes on an empty file \(f\.txt\)\n  Proof: ran it\n\nOptional: [^\n]*\n- \[minor\] A name is unclear \(f\.txt\)\n  Proof: ran it\n\nNot yours to fix: [^\n]*\n- \[major\] The old importer drops rows \(f\.txt\) → task proj\/9\n\nFix what is required/);
  assert.match(G.prComment(rv, 2), /^\*\*Review 2 · Fail · 1 major, 1 minor, 1 pre-existing\*\*[\s\S]*\*\*Required\*\*\n- \*\*major\*\*: Crashes[\s\S]*\*\*Not required \(below the gate\)\*\*\n- \*\*minor\*\*: A name is unclear[\s\S]*\*\*Not required \(there before this change\)\*\*\n- \*\*major\*\*: The old importer[\s\S]*Task proj\/9\./);
  // by hand, a review that passed still has something to send: then nothing in it is optional
  assert.match(G.reviewMessage(reviewOf(true, mixed, "major"), { all: true }), /Required: fix each of these\.\n- \[minor\] A name is unclear/);
  // a review from before the gate keeps its own words and its own rule (4 or 5, and not "don't merge")
  const before = [{ score: 4, recommend: true, text: "Fine." }, { score: 4, recommend: false, text: "No." }, { score: 3, recommend: true, text: "Hm." }, { score: 5, text: "Good." }];
  assert.deepEqual(before.map((r) => [G.passes(r), G.result(r), G.sentence(r)]), [[true, "4/5, says merge", "Reviewed 4/5, says merge."], [false, "4/5, says don't merge", "Reviewed 4/5, says don't merge."], [false, "3/5, says merge", "Reviewed 3/5, says merge."], [true, "5/5", "Reviewed 5/5."]]);
  assert.match(G.reviewMessage({ score: 3, text: "Hm.", problems: ["a.js: null"] }), /rated it 3 out of 5\.\n\nHm\.\n\nProblems it found:\n- a\.js: null/);
  for (const m of ["Approve to merge? Reviewed 4/5, says merge. Did it.", "Approve to merge? Review: Pass · 2 minor, 1 pre-existing. Did it.", "Approve to merge? Review: Fail · 1 critical. Did it.", "Approve to merge? Review: Pass. Did it."]) assert.equal(m.replace(G.SENTENCE, "$1"), "Approve to merge? Did it.");
});

test("a later round checks the earlier findings: it cannot grow the list with new minor or major ones", () => {
  const first = reviewOf(true, [finding("major", "Crashes on an empty file"), finding("minor", "A name is unclear")], "major");
  assert.deepEqual(first.findings.map((f) => f.id), ["F1", "F2"]);
  const raw = JSON.stringify({ commit: "abcdef1234", meets: true, text: "Mostly fixed.", findings: [
    { id: "F2", severity: "major", subject: "The name is still unclear", where: "f.txt", proof: "read it" }, // an earlier one, still open: it may not grow
    finding("minor", "A new nit"), finding("major", "A new worry"), finding("critical", "A new claim nobody showed", { proof: "" }),
    finding("critical", "The fix deletes the file", { proof: "ran it: the file is gone" }), finding("major", "The old exporter was always slow", { preexisting: true })] });
  const rv = parseVerdict(raw, "abcdef1234567", { earlier: first.findings, used: ["F1", "F2"] });
  assert.deepEqual(rv.findings.map((f) => [f.id, f.severity, f.subject]), [["F2", "minor", "The name is still unclear"], ["F3", "critical", "The fix deletes the file"], ["F4", "major", "The old exporter was always slow"]]);
  assert.equal(rv.left, 3); assert.equal(rv.findings[2].preexisting, true); // a fault that was there before is kept to be filed: it holds nothing back
  // the same answer on a first review keeps everything (the unproven critical one as major)
  assert.deepEqual(parseVerdict(raw, "abcdef1234567").findings.map((f) => f.severity), ["major", "minor", "major", "major", "critical", "major"]);
  // with only smaller things noticed late, the round passes: nothing was added
  const quiet = parseVerdict(JSON.stringify({ commit: "abcdef1234", meets: true, text: "Fixed.", findings: [finding("major", "Something else entirely"), finding("minor", "And a nit")] }), "abcdef1234567", { earlier: first.findings, used: ["F1", "F2"] });
  assert.deepEqual(quiet.findings, []); assert.equal(quiet.left, 2); assert.equal(G.stamp(quiet, "major").pass, true);
  // `meets: false` still counts in a later round
  assert.equal(G.stamp(parseVerdict(JSON.stringify({ commit: "abcdef1234", meets: false, text: "Still not it.", findings: [] }), "abcdef1234567", { earlier: first.findings }), "major").pass, false);
  // a verdict needs `meets` and a text; the old shape (a score) is no verdict any more; another commit's is ignored
  assert.throws(() => parseVerdict(JSON.stringify({ commit: "abcdef1234", score: 5, recommend: true, text: "Fine." }), "abcdef1234567"), /no valid verdict/);
  assert.throws(() => parseVerdict(JSON.stringify({ commit: "abcdef1234", meets: true, text: " " }), "abcdef1234567"), /no valid verdict/);
  assert.equal(parseVerdict(JSON.stringify({ commit: "deadbeef00", meets: true, text: "Fine." }), "abcdef1234567"), null);

  // what the reviewer is told: the fixed question and the four words always; the earlier findings from round two on
  const t = { n: 1, title: "Do it", description: "" }, opts = { text: "Did it.", change: { head: "abcdef1234567", range: "a..b", stat: "" }, toLand: true, ch: { artifacts: false, serve: "local" } };
  const one = reviewBrief(t, opts);
  assert.match(one, /Does the change do what the task asked\?/); assert.match(one, /- critical: [^\n]*\n- major: [^\n]*\n- minor: [^\n]*\n- trivial: /); assert.match(one, /Do not invent findings/);
  assert.match(one, /"meets": <true or false>/); assert.doesNotMatch(one, /"score"|recommend|later round|"id"|1 to 5/i);
  const filed = [...first.findings, { id: "F9", severity: "major", subject: "The old importer drops rows", where: "import.js", proof: "", preexisting: true, task: "proj/9" }, { id: "meets", severity: "critical", subject: "The change does not do what the task asked.", where: "", proof: "", preexisting: false, board: true }];
  const two = reviewBrief(t, { ...opts, earlier: filed });
  assert.match(two, /This is a later round[^\n]*You may add a new finding \(with no id\) only if it is critical\.[^\n]*\nEarlier findings:\n- F1 \[major\] Crashes on an empty file \(f\.txt\)\n- F2 \[minor\] A name is unclear \(f\.txt\)\nAlready known to the human[^\n]*\n- \[major\] The old importer drops rows \(import\.js\)\n/);
  assert.match(two, /"id": "<the earlier finding's id/); assert.doesNotMatch(two, /- meets /);
});

test("the gate setting: major by default, yours or one task's; an old reviewAuto still means what it did", async () => {
  const w = await world();
  const file = path.join(process.env.HERDR_SUPERWORK_CONFIG_DIR, "config.json");
  const write = (c) => fs.writeFileSync(file, JSON.stringify(c));
  try {
    assert.equal(S.DEFAULTS.gate, "major"); assert.equal(S.DEFAULTS.rounds, 3); assert.equal("reviewAuto" in S.DEFAULTS, false);
    assert.equal(S.config().gate, "major"); assert.ok(S.PER_TASK.includes("gate")); assert.ok(!S.PER_TASK.includes("reviewAuto"));
    // a config from before the gate behaves as it did; a `gate` beside it wins
    write({ reviewAuto: true }); assert.equal(S.config().gate, "major");
    write({ reviewAuto: false }); assert.equal(S.config().gate, "off"); assert.equal("reviewAuto" in S.config(), false);
    write({ reviewAuto: false, gate: "minor" }); assert.equal(S.config().gate, "minor");
    write({ gate: "nonsense" }); assert.equal(S.config().gate, "major");
    write({ reviewAuto: false });
    for (const g of G.GATES) assert.equal(S.setConfig("gate", g).gate, g);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { gate: "off" }); // the old key goes once the gate is set
    assert.equal(S.setConfig("gate", "Critical").gate, "critical"); assert.equal(S.setConfig("gate", "false").gate, "off"); assert.equal(S.setConfig("gate", "default").gate, "major");
    assert.throws(() => S.setConfig("gate", "blocker"), /gate must be critical, major, minor, trivial or off/);
    assert.equal(S.setConfig("reviewAuto", "false").gate, "off"); assert.equal(S.setConfig("reviewAuto", "true").gate, "major"); // the old name still works
    // per task: its own gate wins over yours, by `config --id` and by `--gate` on delegate
    const id = A.add(w.root, "One task").id;
    assert.equal(S.choices(S.get(id)).gate, "major");
    assert.equal(S.setTaskConfig(id, "gate", "trivial").gate, "trivial"); assert.equal(S.setConfig("gate", "critical").gate, "critical"); assert.equal(S.choices(S.get(id)).gate, "trivial");
    assert.equal(S.setTaskConfig(id, "gate", "default").gate, "critical");
    S.update(id, (t) => { t.own = { reviewAuto: false }; }); assert.equal(S.choices(S.get(id)).gate, "off"); // a task's own choice from before the gate
    S.update(id, (t) => { t.own = { reviewAuto: true }; }); assert.equal(S.choices(S.get(id)).gate, "major");
    assert.equal(S.setTaskConfig(id, "gate", "minor").gate, "minor"); assert.deepEqual(S.get(id).own, { gate: "minor" });
    const out = process.stdout.write; process.stdout.write = () => true;
    try {
      assert.equal(await main(["config", "gate", "off", "--id", id]), 0); assert.equal(S.choices(S.get(id)).gate, "off");
      const other = A.add(w.root, "Another").id;
      assert.equal(await main(["delegate", other, "--gate", "critical"]), 0); assert.equal(S.get(other).own.gate, "critical");
    } finally { process.stdout.write = out; }
  } finally { w.cleanup(); }
});

test("a review with only minor findings merges at the default gate without another round", async () => {
  const w = await world({ repoSettings: { land: "auto" } });
  try {
    w.script({ worker: [work(1)], reviewer: [verdict([finding("minor", "The name could be clearer"), finding("trivial", "A note")])] });
    const id = A.add(w.root, "Only nits").id;
    A.delegate(id);
    const t = await settle(id, { max: 30 });
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.equal(fs.readFileSync(path.join(w.root, "f.txt"), "utf8"), "1\n"); // merged
    assert.equal(S.reviewRound(t), 1); assert.equal(t.reviewRounds || 0, 0); assert.equal(paneOf(w, t)?.agent?.prompts?.length ?? 1, 1);
    assert.deepEqual([t.review.pass, t.review.gate, G.result(t.review)], [true, "major", "Pass · 1 minor, 1 trivial"]);
  } finally { w.cleanup(); }
});

test("a review where `meets` is false goes back even if the reviewer listed nothing else", async () => {
  const w = await world();
  try {
    w.script({ worker: [work(1), work(2)], reviewer: [verdict([], { meets: false, text: "Only a test was added, no fix." }), verdict([])] });
    const id = A.add(w.root, "Fix it").id;
    A.delegate(id);
    const t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(S.reviewRound(t), 2); assert.equal(t.reviewRounds, 1);
    const prompts = paneOf(w, t).agent.prompts;
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /Result: Fail · 1 critical\.\n\nOnly a test was added, no fix\.\n\nRequired: fix each of these\.\n- \[critical\] The change does not do what the task asked\./);
    assert.deepEqual(S.reviewHistory(t).map((e) => [e.round, e.meets, e.pass, e.findings.length]), [[1, false, false, 1], [2, true, true, 0]]);
    assert.match(t.msg, /^Approve to merge\? Review: Pass\. Did v2\./);
  } finally { w.cleanup(); }
});

test("a pre-existing fault is suggested, never filed: no new task, no extra round, and one suggestion across rounds", async () => {
  const w = await world();
  try {
    const old = finding("critical", "The importer drops the last row", { where: "import.js", proof: "ran it on main too", preexisting: true });
    w.script({ worker: [work(1)], reviewer: [verdict([old])] });
    const id = A.add(w.root, "Add a column").id;
    A.delegate(id);
    let t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(S.reviewRound(t), 1); assert.equal(paneOf(w, t).agent.prompts.length, 1); // no extra round
    assert.deepEqual([t.review.pass, G.result(t.review)], [true, "Pass · 1 pre-existing"]);
    assert.deepEqual(S.list().map((x) => x.id), [id]); // nothing was filed
    assert.deepEqual(t.suggestions.map((s) => [s.id, s.title, s.where, s.by, s.severity, s.round, s.state]), [["S1", "The importer drops the last row", "import.js", "reviewer", "critical", 1, "open"]]);
    assert.match(t.suggestions[0].description, /Where: import\.js\nSeverity: critical\nWhat the reviewer saw: ran it on main too\n\nIt was there before proj\/1 \(Add a column\)/);
    assert.deepEqual(t.review.findings[0].suggested, { on: id, id: "S1" });
    assert.throws(() => A.sendReview(id), /nothing for the agent to fix/);
    // later rounds name it again, under its id, in the same words and in other words about the same place: still one
    w.script({ worker: [work(2), work(3)], reviewer: [verdict([finding("major", "f.txt holds the wrong number"), { ...old, subject: "The importer drops the last row." }]), verdict([{ ...old, id: "F1" }, { ...old, proof: "ran it again" }, { ...old, subject: "The last row is dropped by the importer", severity: "major" }, finding("minor", "The old exporter is slow", { where: "export.js", preexisting: true })])] });
    A.tell(id, "Change the number.");
    t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(S.reviewRound(t), 3); assert.equal(t.review.pass, true);
    // a fault from before the task that is first seen in a later round is suggested too, and still holds nothing back
    assert.deepEqual(S.list().map((x) => x.id), [id]);
    assert.deepEqual(t.suggestions.map((s) => [s.id, s.title, s.round]), [["S1", "The importer drops the last row", 1], ["S2", "The old exporter is slow", 3]]);
    assert.deepEqual(t.review.findings.map((f) => f.suggested.id), ["S1", "S1", "S1", "S2"]);
    // word for word the same finding is one that says the same thing about the same place, whatever its proof
    assert.ok(!G.sameFault(old, { ...old, subject: "The importer drops the first row" })); assert.ok(G.sameFault(old, { ...old, subject: "the importer drops the last row!", proof: "other" }));
    assert.ok(!G.sameFault(old, { ...old, where: "import-json.js" })); assert.ok(!G.sameFault(old, { ...old, where: "" })); assert.ok(!G.sameFault(old, { ...old, where: "Import.js" })); assert.ok(G.sameFault(old, { ...old, where: " import.js " })); assert.ok(G.sameFault(old, { ...old, proof: "" }));
    // the agent is told it is not theirs, and where it went; the next reviewer is told what is known already
    assert.match(paneOf(w, t).agent.prompts.at(-1), /Required: fix each of these\.\n- \[major\] f\.txt holds the wrong number[\s\S]*Not yours to fix:[^\n]*The human is asked[^\n]*\n- \[critical\] The importer drops the last row\. \(import\.js\) → suggested as a task/);
    assert.match(reviewBrief(t, { text: "", change: { head: "abc", range: "a..b" }, toLand: true, ch: {}, filed: knownFaults(t) }), /\nAlready known to the human \(they were there before this change\): do not report these again, in these words or in others\.\n- \[minor\] The old exporter is slow \(export\.js\)\n- \[critical\] The importer drops the last row \(import\.js\)\n/);
    // the human says no to one and yes to the other: a dismissed one is never raised again, an accepted one is a task
    A.dismissSuggestion(id, "S2");
    const made = A.acceptSuggestion(id, "S1").task;
    assert.deepEqual([made.id, made.title, made.stage, !!made.link], ["proj/2", "The importer drops the last row", "todo", false]); // started by nobody
    assert.match(made.description, /Where: import\.js\n[\s\S]*Suggested by the reviewer of proj\/1 \(Add a column\)\.$/);
    w.script({ worker: [work(4)], reviewer: [verdict([{ ...old, subject: "The importer still drops the last row" }, finding("minor", "The exporter is slow, as of old", { where: "export.js:12", preexisting: true })])] });
    A.tell(id, "And once more.");
    t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    assert.deepEqual(S.list().map((x) => x.id).sort(), [id, made.id]); assert.equal(t.suggestions.length, 2);
    assert.deepEqual(t.review.findings.map((f) => [f.task || "", f.suggested?.id || ""]), [[made.id, ""], ["", "S2"]]);
    assert.match(G.findingsText(t.review), /→ task proj\/2\n- [^\n]* → suggested as a task$/);
  } finally { w.cleanup(); }
});

test("round two cannot grow the list: new minor and major findings are left out, an open one comes back", async () => {
  const w = await world();
  try {
    w.script({ worker: [work(1), work(2), work(3)], reviewer: [
      verdict([finding("major", "Crashes on an empty file"), finding("minor", "A name is unclear")]),
      verdict([{ ...finding("major", "Still crashes on an empty file"), id: "F1" }, finding("major", "A brand new worry"), finding("minor", "A brand new nit")]),
      verdict([finding("major", "Yet another new worry"), finding("minor", "Yet another nit")])] });
    const id = A.add(w.root, "Handle files").id;
    A.delegate(id);
    const t = await settle(id, { max: 40 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(S.reviewRound(t), 3); assert.equal(t.reviewRounds, 2);
    assert.deepEqual(S.reviewHistory(t).map((e) => [e.pass, e.findings.map((f) => `${f.id} ${f.severity}`), e.left]), [[false, ["F1 major", "F2 minor"], 0], [false, ["F1 major"], 2], [true, [], 2]]);
    const prompts = paneOf(w, t).agent.prompts;
    assert.match(prompts[1], /Required: fix each of these\.\n- \[major\] Crashes on an empty file \(f\.txt\)\n  Proof: ran it\n\nOptional: [^\n]*\n- \[minor\] A name is unclear/);
    assert.match(prompts[2], /Result: Fail · 1 major\.[\s\S]*- \[major\] Still crashes on an empty file/); assert.doesNotMatch(prompts[2], /brand new|Optional/);
    assert.equal(G.result(t.review), "Pass");
    // a reply from you starts over: the next review is a full one again, and its findings take new numbers
    w.script({ worker: [work(4)], reviewer: [verdict([finding("minor", "A late nit")])] });
    A.tell(id, "One more thing.");
    const again = await settle(id, { max: 30 });
    assert.deepEqual(again.review.findings.map((f) => [f.id, f.severity]), [["F3", "minor"]]); assert.equal(again.review.pass, true); assert.equal(again.review.left, 0);
  } finally { w.cleanup(); }
});

test("gate off behaves like the manual mode: nothing goes back by itself; one task's own gate sends even a minor finding back", async () => {
  const w = await world({ settings: { gate: "off" }, repoSettings: { land: "auto" } });
  try {
    w.script({ worker: [work(1), work(2)], reviewer: [verdict([finding("critical", "Deletes the data")]), verdict([])] });
    const id = A.add(w.root, "Manual").id;
    A.delegate(id);
    let t = await settle(id, { max: 30 });
    // it waits for you, a repo that lands by itself included: a failed review is never merged by itself
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(S.reviewRound(t), 1); assert.equal(paneOf(w, t).agent.prompts.length, 1); assert.equal(t.review.pass, false);
    assert.match(t.msg, /^Approve to merge\? Review: Fail · 1 critical\./); assert.equal(F.labelOf(t), "approve? fail");
    assert.match(A.sendReview(id).msg, /review sent/); // by hand, as before
    t = await settle(id, { max: 30 });
    assert.equal(S.reviewRound(t), 2); assert.equal(t.review?.pass ?? S.reviewHistory(t).at(-1).pass, true);

    // one task with a stricter gate of its own: a minor finding goes back by itself
    w.script({ worker: [{ files: { "g.txt": "1\n" }, commit: "g1", note: "Did g1." }, { files: { "g.txt": "2\n" }, commit: "g2", note: "Did g2." }], reviewer: [verdict([finding("minor", "A name is unclear", { where: "g.txt" })]), verdict([])] });
    const strict = A.add(w.root, "Strict").id;
    A.delegate(strict, { gate: "minor" });
    const s = await settle(strict, { max: 30 });
    assert.deepEqual(S.reviewHistory(s).map((e) => [e.gate, e.pass]), [["minor", false], ["minor", true]]); assert.equal(s.reviewRounds, 1);
  } finally { w.cleanup(); }
});

test("the pull request and the review page show every finding, those below the gate marked as not required", async () => {
  const w = await world({ origin: true });
  try {
    w.script({ worker: [work(1)], reviewer: [verdict([finding("minor", "The name could be clearer")])] });
    const id = A.add(w.root, "With a pull request").id;
    A.delegate(id);
    const t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    assert.match(ghLog(w), /pr comment 7 --body \*\*Review 1 · Pass · 1 minor\*\*[\s\S]*\*\*Not required \(below the gate\)\*\*\n- \*\*minor\*\*: The name could be clearer \(`f\.txt`\)/);
    const rv = reviewOf(false, [finding("major", "Crashes on <empty> files"), finding("minor", "A name is unclear"), finding("major", "The old importer drops rows", { preexisting: true })], "major");
    rv.findings.find((f) => f.preexisting).task = "proj/9"; rv.at = Date.now(); rv.left = 2;
    const page = renderReviewPage({ id, round: 2, title: "T", summary: "Did it.", review: rv, evidence: [], dir: w.base });
    assert.match(page, /<div class="score warning">Fail<\/div><p class="decision">1 critical, 1 major, 1 minor, 1 pre-existing<\/p><p>Does the change do what the task asked\? <strong>No<\/strong>/);
    assert.match(page, /<h4>Required<\/h4><ul class="findings"><li><span class="sev critical">critical<\/span> The change does not do what the task asked\.<\/li><li><span class="sev major">major<\/span> Crashes on &lt;empty&gt; files <code>f\.txt<\/code><div class="proof">Proof: ran it<\/div><\/li><\/ul>/);
    assert.match(page, /<h4>Not required: below the gate<\/h4><ul class="findings"><li><span class="sev minor">minor<\/span> A name is unclear <code>f\.txt<\/code> <span class="tag">not required<\/span>/);
    assert.match(page, /<h4>Not required: there before this change<\/h4>[^\n]*<span class="tag">not required · task proj\/9<\/span>/); assert.match(page, /2 smaller findings noticed only in this later round were left out\./);
    assert.match(renderReviewPage({ id, title: "T", summary: "Did it.", review: { ...reviewOf(true, [], "major"), at: Date.now() }, evidence: [], dir: w.base }), /No findings reported by the reviewer\.[\s\S]*<div class="score success">Pass<\/div><p class="decision">Nothing found<\/p>/);
  } finally { w.cleanup(); }
});
