// The merge.by setting: a green task merges by itself, the repo's own file can never switch that on, and a change counts
// for tasks already under way. Main moving under a task that may merge: a clean catch-up merges with nobody asked, a
// conflict goes to the agent and is reviewed, and several such tasks go one at a time.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, git, paneOf, ghLog, toApproval } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { main } from "../src/cli.js";
import { housekeeping } from "../src/housekeeping.js";
import { green } from "../src/finish/auto-merge.js";
import { inLine, waitingMsg } from "../src/finish/line.js";
import { reviewMessage } from "../src/gate.js";

const verdict = (findings = []) => ({ verdict: { meets: true, text: "Looked at it.", findings } });
const work = (n, file = "f.txt") => ({ files: { [file]: `${n}\n` }, commit: `v${n}`, note: `Did v${n}.` });
const merged = (w, file = "f.txt") => fs.existsSync(path.join(w.root, file));
const pass = () => housekeeping(undefined, { force: true });
const big = (first, last) => [first, ...Array.from({ length: 18 }, (_, i) => `line ${i + 2}`), last].join("\n") + "\n";
const mainMoves = (w, files) => { for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(w.root, f), text); git(w.root, "add", "-A"); git(w.root, "commit", "-qm", "main moves"); return git(w.root, "rev-parse", "HEAD"); };
// Every run of the check leaves a line outside the repo, so a test can count them.
const counted = { "check.command": 'echo run >> "$HERDR_SUPERWORK_REPO/../checks.log"' };
const checks = (w) => { try { return fs.readFileSync(path.join(w.root, "..", "checks.log"), "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };
const queued = (job) => globalThis.__swJobs.filter(([j]) => j === job).map(([, id]) => id);
const quiet = async (argv) => { const out = process.stdout.write; process.stdout.write = () => true; try { return await main(argv); } finally { process.stdout.write = out; } };

test("merge.by: yours for all tasks, your entry for a repo, one task's own; the repo's own file can never switch it on", async () => {
  const w = await world({ repoSettings: { merge: { by: "itself" }, land: "auto" } });
  try {
    const id = A.add(w.root, "One").id;
    const by = () => S.lookup("merge.by", { task: S.get(id) });
    assert.equal(S.setting("merge.by"), "you"); assert.equal(by().value, "you"); assert.equal(by().from, "built in"); // the repo's file says "itself": refused
    assert.equal(S.setValue("merge.by", "itself").value, "itself"); assert.deepEqual([by().value, by().from], ["itself", "you"]);
    assert.equal(S.setValue("merge.by", "you", { repo: "proj" }).value, "you"); assert.deepEqual([by().value, by().from], ["you", "your entry for proj"]);
    assert.equal(await quiet(["set", "merge.by", "itself", "--task", id]), 0); assert.deepEqual(S.get(id).settings, { "merge.by": "itself" }); assert.deepEqual([by().value, by().from], ["itself", "this task"]);
    assert.equal(S.unsetValue("merge.by", { task: S.get(id) }).value, "you"); assert.deepEqual(S.get(id).settings, {});
    S.unsetValue("merge.by", { repo: "proj" }); S.unsetValue("merge.by"); assert.equal(by().value, "you");
    // the option to delegate sets it for that one task, and the task says what its repo's file was refused
    S.setValue("merge.by", "itself");
    w.script({ worker: [work(1)], reviewer: [verdict()] });
    assert.equal(await quiet(["delegate", id, "--merge.by", "you"]), 0); assert.equal(S.get(id).settings["merge.by"], "you");
    const t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.ok(!merged(w)); // its own "you" beats your "itself"
    assert.deepEqual(t.repoFile, {}); assert.equal(t.repoRefused.length, 2); assert.match(t.repoRefused.join("\n"), /merge\.by[^\n]*may only hold research\.only, workspace\.setup, workspace\.include, workspace\.teardown, check\.command, check\.timeout/); assert.match(t.repoRefused.join("\n"), /unknown setting "land"/);
    assert.match(t.fallbacks.repoFile, /merge\.by/);
  } finally { w.cleanup(); }
});

test("autoMerge on: a task whose review passes merges by itself; one whose review fails still asks", async () => {
  const w = await world({ settings: { "merge.by": "itself", "review.rounds": 1 } });
  try {
    w.script({ worker: [work(1)], reviewer: [verdict([{ severity: "minor", subject: "A name", where: "f.txt", proof: "read it" }])] });
    const id = A.add(w.root, "Passes").id;
    A.delegate(id);
    let t = await settle(id, { max: 30 });
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.equal(fs.readFileSync(path.join(w.root, "f.txt"), "utf8"), "1\n");
    // a critical finding that outlasts its rounds is yours to decide: nothing merges, however often the board looks
    w.script({ worker: [work(1, "g.txt"), work(2, "g.txt")], reviewer: [1, 2].map(() => verdict([{ severity: "critical", subject: "Deletes the data", where: "g.txt", proof: "ran it" }])) });
    const bad = A.add(w.root, "Fails").id;
    A.delegate(bad);
    t = await settle(bad, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(t.review.pass, false); assert.equal(green(t), false);
    pass(); t = await settle(bad);
    assert.equal(t.stage, "approval"); assert.ok(!merged(w, "g.txt"));
  } finally { w.cleanup(); }
});

test("autoMerge turned on under way: a task that waits green merges at the reviewed commit; one you stepped into asks; main moving under a green one does not stop it", async () => {
  const w = await world({ repoSettings: counted });
  try {
    const id = await toApproval(w, "Waits", { reviewer: [verdict()] });
    const held = await toApproval(w, "Stepped in", { worker: [work(1, "h.txt")], reviewer: [verdict()] });
    S.update(held, (t) => { t.requireApproval = true; });
    pass(); assert.equal((await settle(id)).stage, "approval"); // off: it waits, as before
    S.setValue("merge.by", "itself");
    assert.equal(green(S.get(id)), true); assert.equal(green(S.get(held)), false);
    const reviewed = S.get(id).reviewedHead;
    pass();
    assert.deepEqual(S.get(id).mergeIntent && [S.get(id).stage, S.get(id).mergeIntent.verifiedHead, S.get(id).mergeIntent.auto], ["merging", reviewed, true]);
    const t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.ok(merged(w));
    assert.equal((await settle(held)).stage, "approval"); assert.ok(!merged(w, "h.txt"));
    // main moved under it when the first one merged: it is brought up to date, its review stands, and it still asks
    pass(); let h = await settle(held, { max: 30 });
    assert.equal(h.stage, "approval"); assert.match(h.msg, /^Approve to merge\? Review: Pass\. Re-merged with main, tests pass, review 1 still stands\./); assert.ok(!merged(w, "h.txt"));
    // "auto-merge this one", said for that very task, is the yes it waited for
    S.setValue("merge.by", "itself", { task: S.get(held) }); assert.equal(S.get(held).requireApproval, false);
    // Green, and main moves once more: it is not brought up to date with everything else that waits. It catches up
    // when it merges, is checked once on the result, and merges by itself: no new review, and nobody is asked.
    const main = mainMoves(w, { "other.txt": "main\n" }), ran = checks(w), seen = S.reviewHistory(h)[0].head;
    pass(); assert.deepEqual([queued("sync"), queued("land")], [[], [held]]);
    h = await settle(held, { max: 30 });
    assert.equal(h.stage, "done", JSON.stringify(h.failure)); assert.ok(merged(w, "h.txt")); assert.equal(git(w.root, "rev-parse", "HEAD~1"), main);
    assert.equal(checks(w), ran + 1);
    assert.deepEqual([h.reviewRound, S.reviewHistory(h).length, S.reviewHistory(h)[0].head, S.reviewHistory(h)[0].kept.length], [1, 1, seen, 2]);
    // A task an older version left owing you a yes for a review sent back (the board's own words, which then counted
    // as you stepping in) is told from a real hold by what its agent was told, and merges by itself: only where all
    // it was told since its task are its own reviews, letter for letter. Anything else and the hold stays.
    const brief = (id) => `Work board task ${id}, role: agent.\n\nDo it.`, blocked = "The workflow is blocked: Pull request has commits that were not reviewed\n\nReviewed here: abc\n\nNext step: Bring them in.";
    const leftHolding = (title, prompts) => {
      const id = A.add(w.root, title).id, file = path.join(w.base, `${title}.jsonl`), at = Date.now() - 60000;
      if (prompts) fs.writeFileSync(file, prompts(id).map((text, i) => JSON.stringify({ type: "user", timestamp: new Date(at + i * 20000).toISOString(), message: { role: "user", content: i ? [{ type: "text", text }] : `\n\n<pasted_content id="ab12">\n${text}\n</pasted_content id="ab12">` } })).join("\n") + "\n" + JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }) + "\n");
      S.update(id, (t) => { t.stage = "approval"; t.requireApproval = true; t.agent = "claude"; t.transcript = prompts ? file : null; t.link = { socket: w.socket, pane: "gone" }; t.reviewedHead = "x"; t.reviews = [{ round: 1, at: at + 10000, meets: true, findings: [finding], gate: "major", pass: true, text: "Fine.", head: "x" }]; t.review = { meets: true, findings: [], pass: true, text: "Fine.", keptAt: Date.now() }; });
      return id;
    };
    const finding = { id: "F1", severity: "minor", subject: "A name", where: "f.txt", proof: "read it" }, review = reviewMessage({ meets: true, findings: [finding], gate: "major", pass: true, text: "Fine." }, { all: true });
    const sentBack = leftHolding("Sent back", (id) => [brief(id), review, `${review}\n\n${review}`]);
    const replied = leftHolding("Replied to", (id) => [brief(id), review, "Also rename it."]);
    // words of yours that only begin as the board's do, or that follow them, are yours
    const began = leftHolding("Began like it", (id) => [brief(id), "A reviewer went through your change. Also rename it, then wait for my approval."]);
    const added = leftHolding("Added to it", (id) => [brief(id), `${review} Also rename it.`]);
    // a message in the shape of the board's other ones cannot be told from yours put in that shape: it asks
    const shaped = leftHolding("In its shape", (id) => [brief(id), "The check failed, so this is not done yet. Please rename it and wait for my approval. Fix it and finish again."]);
    const failed = leftHolding("A failure sent back", (id) => [brief(id), blocked]);
    // and a hold made after the board stopped counting a send-back is never one of the old kind
    const later = leftHolding("After the change", (id) => [brief(id), review]); S.update(later, (t) => { t.armedAt = Date.now() + 60000; });
    const again = leftHolding("Delegated again", (id) => [brief(id), review]); S.update(again, (t) => { t.reviews[0].at -= 30000; }); // reviewed before this conversation began
    const unread = leftHolding("Unreadable", null);
    pass(); pass();
    assert.deepEqual([sentBack, replied, began, added, shaped, failed, later, again, unread].map((id) => [S.get(id).stage, S.get(id).requireApproval]), [["merging", false], ...[1, 2, 3, 4, 5, 6, 7, 8].map(() => ["approval", true])]);
    assert.deepEqual(queued("land"), [sentBack]); globalThis.__swJobs.length = 0;
  } finally { w.cleanup(); }
});

test("autoMerge turned off while a task waits to merge by itself: it waits for your yes instead", async () => {
  const w = await world({ origin: true, settings: { "review.when": "never", "merge.by": "itself" } });
  try {
    // GitHub's checks still run: the merge the board started by itself is remembered
    const pending = { state: "OPEN", statusCheckRollup: [{ name: "build", state: "PENDING" }], comments: [], reviews: [], author: { login: "me" } };
    fs.writeFileSync(path.join(w.fake, "gh.json"), JSON.stringify({ mergeFail: "checks pending", view: pending }));
    w.script({ worker: [work(1)] });
    const id = A.add(w.root, "With a PR").id;
    A.delegate(id);
    let t = await settle(id, { max: 30 });
    assert.deepEqual([t.stage, t.autoMerge, t.mergeIntent?.auto], ["merging", true, true], JSON.stringify(t.failure));
    pass(); assert.equal(S.get(id).stage, "merging"); // still on: nothing changes
    S.setValue("merge.by", "you", { task: S.get(id) });
    pass();
    t = S.get(id);
    assert.deepEqual([t.stage, !!t.autoMerge, t.mergeIntent, !!t.requireApproval], ["approval", false, null, false]); assert.match(t.msg, /^Approve to merge\?/);
    assert.equal(ghLog(w).match(/^pr merge /gm).length, 1); // the one try that found the checks pending: none since
    assert.ok(!merged(w));
    // an approval the human gave is not the board's own: turning the setting off leaves it alone
    A.approve(id); t = await settle(id);
    assert.deepEqual([t.stage, t.autoMerge, !!t.mergeIntent.auto], ["merging", true, false]);
    pass(); assert.equal(S.get(id).stage, "merging"); assert.equal(ghLog(w).match(/^pr merge /gm).length, 2);
  } finally { w.cleanup(); }
});

test("autoMerge turned off after the board started a merge, before its runner ran: nothing merges, it asks again", async () => {
  const w = await world();
  try {
    const id = await toApproval(w, "Queued", { reviewer: [verdict()] });
    S.setValue("merge.by", "itself"); pass();
    assert.deepEqual([S.get(id).stage, S.get(id).mergeIntent?.auto], ["merging", true]); // its land runner is queued, not run
    S.setValue("merge.by", "you");
    let t = await settle(id);
    assert.deepEqual([t.stage, t.mergeIntent, !!t.failure, !!t.mergeFailed], ["approval", null, false, false]); assert.match(t.msg, /^Approve to merge\?/); assert.ok(!merged(w));
    pass(); assert.equal((await settle(id)).stage, "approval");
    // your own yes is not the board's: it merges with the setting off
    A.approve(id); t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure)); assert.ok(merged(w));
  } finally { w.cleanup(); }
});

test("autoMerge on: a catch-up that conflicts goes to the agent, and what the agent made of it is reviewed before it merges", async () => {
  const w = await world({ settings: { "workspace.cleanup": false }, repoSettings: counted });
  try {
    fs.writeFileSync(path.join(w.root, "big.txt"), big("line 1", "line 20")); git(w.root, "add", "-A"); git(w.root, "commit", "-qm", "big");
    const id = await toApproval(w, "Conflicts", { worker: [{ files: { "big.txt": big("TASK", "line 20") }, commit: "task", note: "Changed the first line." }], reviewer: [verdict()] });
    const main = mainMoves(w, { "big.txt": big("MAIN", "line 20") });
    w.script({ worker: [{ merge: main, files: { "big.txt": big("TASK and MAIN", "line 20") }, commit: "resolve", note: "Resolved." }], reviewer: [verdict()] });
    S.setValue("merge.by", "itself");
    pass();
    const t = await settle(id, { max: 40 });
    assert.equal(t.stage, "done", JSON.stringify([t.stage, t.msg, t.failure?.title]));
    assert.equal(fs.readFileSync(path.join(w.root, "big.txt"), "utf8"), big("TASK and MAIN", "line 20"));
    const prompts = paneOf(w, t).agent.prompts;
    assert.equal(prompts.length, 2); assert.match(prompts[1], /conflicts with main[\s\S]*Conflicting files:\n- big\.txt/);
    assert.doesNotMatch(prompts[1], /reruns the tests instead of reviewing/); // nobody else looks before it merges
    assert.equal(t.reviewRound, 2); assert.equal(S.reviewHistory(t).length, 2); assert.ok(!t.review.keptAt); // the repair was reviewed
  } finally { w.cleanup(); }
});

test("several tasks may merge at once: they go one at a time, each catches up once, and none waits for you", async () => {
  const w = await world({ settings: { "review.when": "never", "workspace.cleanup": false }, repoSettings: counted });
  try {
    const [b, c] = [await toApproval(w, "B", { worker: [work(1, "b1.txt")] }), await toApproval(w, "C", { worker: [work(1, "c1.txt")] })];
    const ran = checks(w), heads = [b, c].map((id) => git(S.get(id).worktree, "rev-parse", "HEAD"));
    // A is on its way to merge: its runner is at work and the turn is its own
    const a = A.add(w.root, "A").id;
    S.update(a, (t) => { t.stage = "merging"; t.runner = S.marker({ job: "land" }); t.lineTurn = t.runner.started; });
    S.setValue("merge.by", "itself");
    mainMoves(w, { "other.txt": "main\n" });
    pass(); await settle(b); await settle(c);
    // B and C wait behind it: nothing was merged into them and no check ran, however often the board looks
    assert.deepEqual([b, c].map((id) => [S.get(id).stage, inLine(S.get(id)), S.get(id).msg]), [["merging", true, waitingMsg(a)], ["merging", true, waitingMsg(a)]]);
    const [first, second] = [b, c].sort((x, y) => S.get(x).lineAt - S.get(y).lineAt || (x < y ? -1 : 1)); // whoever joined the line first
    pass(); await settle(b); await settle(c);
    assert.deepEqual([b, c].map((id) => [S.get(id).stage, git(S.get(id).worktree, "rev-parse", "HEAD")]), [["merging", heads[0]], ["merging", heads[1]]]); assert.equal(checks(w), ran);
    // A is through: the line moves, one task at a time, the longest wait first, with nobody asked in between
    S.update(a, (t) => { t.stage = "done"; t.runner = null; });
    pass(); assert.deepEqual(queued("land"), [first]); // never two of the line at once
    for (const id of [first, second, first, second]) { await settle(id, { max: 30 }); pass(); }
    assert.deepEqual([first, second].map((id) => S.get(id).stage), ["done", "done"], JSON.stringify([b, c].map((id) => [S.get(id).msg, S.get(id).failure?.title])));
    for (const f of ["b1.txt", "c1.txt", "other.txt"]) assert.ok(merged(w, f), f);
    assert.deepEqual(git(w.root, "log", "--format=%s", "-2").split("\n").reverse(), [first, second].map((id) => S.get(id).title));
    // each took main in once, behind the merge ahead of it, and was checked once: two checks, not a chase
    assert.equal(checks(w), ran + 2);
    for (const id of [b, c]) assert.equal(paneOf(w, S.get(id)).agent.prompts.length, 1);
  } finally { w.cleanup(); }
});
