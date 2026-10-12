// Suggested tasks: nothing files a task by itself. What an agent or a reviewer comes across is a suggestion on its
// task; the human makes it a task or dismisses it; the same work is never suggested twice.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { main } from "../src/cli.js";
import { rules as agentRules } from "../src/delegate.js";
import { open } from "./board-helpers.js";
import { suggestFaults, owedFaults, reviewBrief } from "../src/finish.js";
import { housekeeping } from "../src/housekeeping.js";
import * as G from "../src/gate.js";

const ASK = "\x0e", WHOLE = "\x1bt"; // ctrl+n asks about a suggestion; alt+t is the whole task

test("the same work in other words is recognised; different work is not", () => {
  const same = (a, b) => S.sameWork(typeof a === "string" ? { title: a } : a, typeof b === "string" ? { title: b } : b);
  // The reviewers' own words for one flaky test, from five reviews of five tasks.
  const flaky = [["The cleanup retry test fails in both the full suite and an isolated run.", "test/cleanup-retry.test.js:27"], ["The cleanup retry test fails both in the full suite and when run separately.", "test/cleanup-retry.test.js:52, called from line 106"],
    ["The pre-existing cleanup retry test fails intermittently in the full suite.", "test/cleanup-retry.test.js:52, called at line 106"], ["The existing cleanup retry test can fail while setting up its busy-space scenario.", "test/cleanup-retry.test.js:52,106"], ["The existing clean-up test fails intermittently in the full suite.", "test/cleanup-retry.test.js:52,106"]].map(([title, where]) => ({ title, where }));
  for (const f of flaky.slice(1)) assert.ok(same(flaky[0], f) || flaky.some((g) => g !== f && same(g, f)), f.title);
  // And agents' words for it, with no place given.
  assert.ok(same("Flaky under load: cleanup-retry test 'a clean-up put off because the space was in use'", "Flaky test under load: cleanup-retry 'tried again by itself once it is free'"));
  assert.ok(same("Clean-up retry test fails on a busy machine", flaky[0])); assert.ok(same("Tests that expect '0s ago' fail on a busy machine", "Fix the two tests that fail on a busy machine"));
  assert.ok(same("The importer drops the last row", "the importer drops the last row!"));
  // Other work: another fault in the same file, another test that is flaky, tasks that only share everyday words.
  assert.ok(!same({ title: "The importer drops the last row", where: "import.js" }, { title: "Dates are parsed as text", where: "import.js:40" }));
  assert.ok(!same("Flaky under load: cleanup-retry test 'a clean-up put off because the space was in use'", "Tests that expect '0s ago' fail on a busy machine"));
  assert.ok(!same("Show which review round a task is on", "Show reviewer in task details")); assert.ok(!same("Match herdr's colors and icons", "Match herdr's real colors on the board"));
  // The very same sentence about two files is two bugs; about one file (or with no place said on one side) it is one.
  const row = "The importer drops the last row";
  assert.ok(!same({ title: row, where: "src/import-csv.js:20" }, { title: row, where: "src/import-json.js:90" })); assert.ok(same({ title: row, where: "src/import-csv.js:20" }, { title: row, where: "import-csv.js:44" })); assert.ok(same({ title: row, where: "src/import-csv.js:20" }, { title: row }));
  // An agent says where in its description (it has no `where`): two files there are two bugs as well.
  assert.ok(!same({ title: row, description: "Seen in src/export-csv.js." }, { title: row, description: "Seen in src/export-json.js." })); assert.ok(same({ title: row, description: "Seen in src/export-csv.js." }, { title: row, description: "export-csv.js again" }));
  assert.ok(!same({ title: row, description: "Seen in src/export-csv.js." }, { title: row, where: "src/export-json.js:9", description: "Unlike export-csv.js." }));
  // Other words for the same thing are one; the opposite word makes two.
  assert.ok(same({ title: row, where: "import.js:12" }, { title: "Importing loses the final row of the file", description: "import.js" })); assert.ok(same(row, "Importing loses the final row of the file")); assert.ok(same("The export omits its last rows", "Exporter skips the final row"));
  assert.ok(!same({ title: row, where: "import.js:12" }, { title: "The importer drops the first row", where: "import.js:40" })); assert.ok(!same("The importer drops the last row", "The exporter drops the last row")); assert.ok(!same("Reading the config fails on empty input", "Writing the config fails on empty input"));
  assert.ok(!same("Fix the login page", "Fix the signup page")); assert.ok(!same("", "")); assert.ok(!same("Stop reviewers auto-creating tasks", "Show reviewer in task details"));
});

test("an agent's add or suggest is a suggestion on its own task, never a task; the human accepts or dismisses it", async () => {
  const w = await world({ settings: { helper: "off" } });
  const write = process.stdout.write; let said = "";
  const board = async (...args) => { said = ""; process.stdout.write = (x, ...more) => { if (typeof x !== "string") return write.call(process.stdout, x, ...more); said += x; return true; }; try { await main(args); } finally { process.stdout.write = write; } return said; };
  try {
    const one = A.add(w.root, "Add a column"), two = A.add(w.root, "Speed up the export");
    S.update(one.id, (t) => { t.link = { socket: w.socket, pane: "w1:p1" }; t.stage = "working"; t.agent = "claude"; });
    S.update(two.id, (t) => { t.link = { socket: w.socket, pane: "w2:p1", reviewer: { pane: "w2:p2" } }; t.stage = "reviewing"; t.agent = "claude"; });
    // The rules an agent starts with name the command, and say it is the human's to decide.
    assert.match(agentRules(S.get(one.id)), /do not do it and do not file it: suggest it to the human with \S+ suggest "<short title>" --desc "[^"]*" --from proj\/1 and carry on\. It becomes a task only if they accept it\./);
    // From an agent's pane: "add" files nothing (an old habit), and so does "suggest".
    process.env.HERDR_PANE_ID = "w1:p1";
    assert.match(await board("add", "The importer drops the last row", "--desc", "In import.js. Seen on main too.", "--repo", w.root, "--delegate"), /^S1 on proj\/1: suggested to the human\. It becomes a task only if they accept it\. Carry on with your own task\.\n$/);
    assert.match(await board("suggest", "Dates are parsed as text", "--from", one.id), /^S2 on proj\/1: suggested/);
    assert.equal(S.list().length, 2);
    assert.match(await board("suggest", "the importer drops the last row!"), /^Already suggested \(S1 on proj\/1\)\. Nothing was added\. Carry on/);
    assert.match(await board("suggestions"), /^proj\/1 S1 {2}The importer drops the last row {2}· from the agent\nproj\/1 S2 {2}Dates are parsed as text {2}· from the agent\n$/);
    // An agent decides nothing itself, and a reviewer's only way is its verdict.
    await assert.rejects(board("accept", one.id, "S1"), /Refused: as the agent of proj\/1 you may only run suggest, suggestions, list, details/);
    await assert.rejects(board("dismiss", one.id, "S1"), /Refused/);
    process.env.HERDR_PANE_ID = "w2:p2";
    await assert.rejects(board("suggest", "Something", "--from", two.id), /Refused: as the reviewer of proj\/2 you may only run list and details/);
    // Another task's agent comes across the same thing, in its own words: recognised, on whichever task it is.
    process.env.HERDR_PANE_ID = "w2:p1";
    assert.match(await board("suggest", "The importer drops the last row of the file", "--desc", "import.js"), /^Already suggested \(S1 on proj\/1\)\. Nothing was added\./);
    assert.match(await board("suggest", "The exporter writes no header"), /^S1 on proj\/2: suggested/);
    assert.match(await board("suggest", "Speed up the exporting"), /^Already a task: proj\/2\. Nothing was added\./);
    // With no pane to tell who is asking, suggest needs the task; add is then the human's own and files.
    delete process.env.HERDR_PANE_ID;
    await assert.rejects(board("suggest", "No task named"), /suggest needs --from/);
    assert.match(await board("suggest", "The README names a file that is gone", "--from", "2"), /^S2 on proj\/2: suggested/);
    assert.equal(S.list().length, 2);
    // The human's yes makes it a task, started by nobody; their no keeps it from coming back.
    await assert.rejects(board("accept", one.id), /proj\/1 has 2 open suggestions: say which \(S1, S2\)/);
    assert.match(await board("accept", one.id, "s1"), /^proj\/3: filed from the suggestion\n$/);
    const made = S.get("proj/3");
    assert.deepEqual([made.title, made.stage, !!made.link], ["The importer drops the last row", "todo", false]);
    assert.equal(made.description, "In import.js. Seen on main too.\n\nSuggested by the agent of proj/1 (Add a column).");
    assert.match(await board("dismiss", one.id), /^S2 on proj\/1: dismissed\n$/); // the one left open needs no name
    await assert.rejects(board("accept", one.id, "S1"), /S1 on proj\/1 was made a task already: proj\/3/); await assert.rejects(board("dismiss", one.id, "S2"), /dismissed already/); await assert.rejects(board("accept", one.id, "S9"), /no suggestion S9/);
    assert.deepEqual(S.get(one.id).suggestions.map((s) => [s.id, s.state, s.task || ""]), [["S1", "accepted", "proj/3"], ["S2", "dismissed", ""]]);
    assert.match(A.suggest(two.id, "Dates get parsed as text").msg, /Already suggested, and the human said no \(S2 on proj\/1\)/);
    assert.match(A.suggest(two.id, "The importer drops the last row").msg, /Already a task: proj\/3/);
    // Once that task is done (or archived) the same thing found again is news.
    S.update("proj/3", { stage: "done" });
    assert.match(A.suggest(two.id, "The importer drops the last row").msg, /^S3 on proj\/2: suggested/);
    assert.deepEqual(A.details(two.id).suggestions.map((s) => s.id), ["S1", "S2", "S3"]);
  } finally { process.stdout.write = write; delete process.env.HERDR_PANE_ID; w.cleanup(); }
});

test("the board shows a task's suggestions in its panel and asks about them only on their key", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const plain = A.add(w.root, "Nothing to see"), one = A.add(w.root, "Add a column");
    const why = "The importer drops the last row\n\nWhere: import.js:12\nSeverity: major\nWhat the reviewer saw: a file of three rows came back with two.\n\nIt was there before proj/2 (Add a column), so it was not fixed there.";
    S.suggest(one.id, { title: "The importer drops the last row", where: "import.js:12", by: "reviewer", severity: "major", round: 1, description: why });
    S.suggest(one.id, { title: "Dates are parsed as text", by: "agent" });
    const s = open(w, { rows: 44 });
    s.v.sel = plain.id; s.v.load();
    // Quietly there: a count in the header line, nothing asked, the text box as ever.
    let text = s.text(140);
    assert.match(text.split("\n")[0], /herdr-superwork {2}proj · \S+ · 2 suggested tasks \(ctrl\+n\)/); assert.doesNotMatch(text, /Make it a task\?|Suggested tasks ·/); assert.equal(s.v.ask, null);
    // The key goes to the task that has them and asks about the first. Its panel lists them.
    s.press(ASK);
    assert.equal(s.v.sel, one.id);
    text = s.text(140);
    assert.match(text, /│ {2}Suggested tasks · 2 ─+ *\n[^\n]*│ {2}• The importer drops the last row *\n[^\n]*│ {4}from the reviewer · \d+[smh] ago *\n[^\n]*│ {4}Where: import\.js:12 *\n[^\n]*│ {4}Severity: major *\n[^\n]*│ {4}What the reviewer saw: a file of three rows came ?… *\n[^\n]*│ {2}• Dates are parsed as text *\n[^\n]*│ {4}from the agent · \d+[smh] ago *\n[^\n]*│ {2}ctrl\+n makes one a task, or dismisses it *\n/);
    s.press("esc"); assert.match(s.text(140).split("\n").at(-1), /^ {2}tab put an agent on it · space reply · ctrl\+n suggested task · \? more *$/); s.press(ASK); // the hint line names the key too
    // The question shows what it is about, not only its title: what you decide on is in front of you.
    assert.match(text, /\n \? Suggested by the reviewer \(1 of 2\): "The importer drops the last row"\. Make it a task\? *\n {3}Where: import\.js:12 *\n {3}Severity: major *\n {3}What the reviewer saw: a file of three rows came back with two\. *\n *\n {3}It was there before proj\/2 \(Add a column\), so it was not fixed there\. *\n {3}y = make it a task · n = dismiss · esc = later *\n/);
    assert.match(text, /│ {2}alt\+t shows the whole task/); // the panel beside the list cut the details short, and says where the rest is
    { s.press("esc", WHOLE); const whole = s.text(140); assert.match(whole, /• The importer drops the last row *\n *from the reviewer · \d+[smh] ago *\n *Where: import\.js:12 *\n *Severity: major *\n *What the reviewer saw: a file of three rows came back with two\. *\n *\n *It was there before proj\/2/); s.press("esc", ASK); }
    // esc: later. Nothing changed, and nothing asks again by itself.
    s.press("esc"); s.v.load();
    assert.equal(s.v.ask, null); assert.equal(S.openSuggestions(S.get(one.id)).length, 2); assert.equal(S.list().length, 2);
    // y: it is a task, started by nobody. The next one is asked; n dismisses it.
    s.press(ASK, "y");
    assert.deepEqual(S.list().map((t) => [t.id, t.title, t.stage]).find(([id]) => id === "proj/3"), ["proj/3", "The importer drops the last row", "todo"]);
    assert.match(s.text(140), /\n \? Suggested by the agent: "Dates are parsed as text"\. Make it a task\? {2}y = make it a task · n = dismiss · esc = later *\n/); // nothing more was said about this one
    s.press("n");
    assert.equal(s.v.ask, null); assert.equal(S.list().length, 3);
    assert.deepEqual(S.get(one.id).suggestions.map((x) => [x.state, x.task || ""]), [["accepted", "proj/3"], ["dismissed", ""]]);
    text = s.text(140);
    assert.doesNotMatch(text, /suggested task|Suggested tasks/); assert.match(text, /Dismissed\. It will not be suggested again\./);
    // The whole task keeps what was decided, quietly. With nothing open the key only says so, and the menu has no line.
    s.v.sel = one.id; s.v.load(); s.press(WHOLE);
    assert.match(s.text(140), /Suggested tasks ─+ *\n *• The importer drops the last row *\n *made a task: proj\/3 *\n *• Dates are parsed as text *\n *dismissed *\n/);
    s.press("esc", ASK);
    assert.match(s.text(140), /No suggested tasks\./); assert.equal(s.v.ask, null);
    assert.ok(s.v.menuItems().some((i) => i.label === "suggested tasks: none wait"));
    S.suggest(plain.id, { title: "A third thing entirely", by: "agent" }); s.v.load();
    assert.ok(s.v.menuItems().some((i) => i.label === "suggested tasks (1): make one a task, or dismiss it" && i.key === "ctrl+n"));
    // While you type, the key is the text box's: no question appears over a draft.
    s.type("half a thought"); s.press(ASK);
    assert.equal(s.v.ask, null);
  } finally { w.cleanup(); }
});

test("a yes is one step under the repo's suggestion lock: two at the same moment make one task", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const one = A.add(w.root, "Add a column");
    S.suggest(one.id, { title: "The importer drops the last row", by: "reviewer" });
    // Somebody else (another board, say) is in the middle of its own yes: this one makes nothing, and says so.
    const free = S.holdLock("suggest:proj");
    assert.throws(() => A.acceptSuggestion(one.id, "S1"), /busy with another action/); assert.throws(() => A.dismissSuggestion(one.id, "S1"), /busy/);
    assert.equal(S.list().length, 1); assert.equal(S.get(one.id).suggestions[0].state, "open");
    free();
    // The raising task itself is busy (its agent's turn is being written down): no task is made that could not be
    // written down as this suggestion's, so trying again makes one, not two.
    const busy = S.holdLock("task:proj/1");
    assert.throws(() => A.acceptSuggestion(one.id, "S1"), /busy with another action/);
    assert.equal(S.list().length, 1); assert.equal(S.get(one.id).suggestions[0].state, "open");
    busy();
    // Once the first is through, the second finds it answered and makes no second task.
    assert.equal(A.acceptSuggestion(one.id, "S1").task.id, "proj/2");
    assert.throws(() => A.acceptSuggestion(one.id, "S1"), /S1 on proj\/1 was made a task already: proj\/2\./);
    assert.deepEqual(S.list().map((t) => t.id).sort(), ["proj/1", "proj/2"]);
    assert.deepEqual(S.get(one.id).suggestions.map((s) => [s.state, s.task]), [["accepted", "proj/2"]]);
  } finally { w.cleanup(); }
});

test("a reviewer's old fault the board could not save is not lost: the review says so, and the board saves it by itself later", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const one = A.add(w.root, "Add a column");
    const review = { findings: [{ id: "F1", severity: "minor", subject: "Dates are parsed as text", where: "dates.js:4", proof: "ran it", preexisting: true }] };
    const free = S.holdLock("suggest:proj");
    suggestFaults(one.id, review);
    const [f] = review.findings;
    assert.equal(S.suggestionsOf(S.get(one.id)).length, 0); assert.match(f.unsuggested, /busy/); assert.equal(G.wentTo(f), "not suggested: the board could not save it");
    assert.match(G.prComment({ ...review, meets: true, gate: "major" }, 1), /Not suggested: the board could not save it\./);
    // The review is saved with that on it. The next reviewer is told it is known and so does not name it again:
    // the board saves it by itself, on its regular pass, and the saved reviews then say where it went.
    S.update(one.id, (t) => { t.reviewRound = 1; const rv = { ...review, meets: true, gate: "major", pass: true }; S.logReview(t, rv); t.review = rv; });
    assert.match(reviewBrief(S.get(one.id), { text: "done", change: { head: "abc" }, toLand: true, ch: { serve: "local" }, earlier: review.findings }), /do not report these again[^\n]*\n- \[minor\] Dates are parsed as text/);
    housekeeping(w.socket, { force: true }); // still busy: still owed, nothing lost
    assert.equal(owedFaults(S.get(one.id)).length, 2); assert.equal(S.suggestionsOf(S.get(one.id)).length, 0);
    free();
    housekeeping(w.socket, { force: true });
    const now = S.get(one.id);
    assert.deepEqual(now.suggestions.map((s) => [s.id, s.title, s.by, s.round, s.state]), [["S1", "Dates are parsed as text", "reviewer", 1, "open"]]);
    assert.deepEqual([now.review, now.reviews[0]].map((rv) => [rv.findings[0].suggested, rv.findings[0].unsuggested]), [[{ on: "proj/1", id: "S1" }, undefined], [{ on: "proj/1", id: "S1" }, undefined]]);
    assert.equal(owedFaults(now).length, 0);
    // A later round that does name it again finds it suggested; an empty one (as it was told) changes nothing.
    suggestFaults(one.id, { findings: [] }); suggestFaults(one.id, review);
    assert.equal(S.suggestionsOf(S.get(one.id)).length, 1);
    assert.deepEqual([f.suggested, f.unsuggested, G.wentTo(f)], [{ on: "proj/1", id: "S1" }, undefined, "suggested as a task"]);
    assert.equal(S.openSuggestions(S.get(one.id))[0].title, "Dates are parsed as text");
    // An agent's two findings with one title, each naming its own file in the description, are two suggestions.
    assert.match(A.suggest(one.id, "The exporter drops the last row", { description: "In src/export-csv.js." }).msg, /^S2 on/);
    assert.match(A.suggest(one.id, "The exporter drops the last row", { description: "In src/export-json.js." }).msg, /^S3 on/);
    assert.match(A.suggest(one.id, "The exporter drops the last row", { description: "src/export-json.js, line 4" }).msg, /^Already suggested \(S3 on proj\/1\)/);
  } finally { w.cleanup(); }
});

test("one review's findings are each a suggestion; a reworded one from elsewhere is not; a yes never makes a task that is there", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const one = A.add(w.root, "Add a column"), two = A.add(w.root, "Speed up the export");
    // Two faults in one file, one word apart, each with its own proof: both are kept, with their own details.
    const review = { findings: [{ id: "F1", severity: "minor", subject: "The importer drops the last row", where: "import.js:12", proof: "three rows in, two out", preexisting: true }, { id: "F2", severity: "minor", subject: "The importer drops the first row", where: "import.js:40", proof: "the header is taken for data", preexisting: true },
      { id: "F3", severity: "minor", subject: "The importer trims the last row badly", where: "import.js:12", proof: "spaces are left", preexisting: true }] };
    suggestFaults(one.id, review);
    assert.deepEqual(review.findings.map((f) => f.suggested.id), ["S1", "S2", "S3"]);
    assert.deepEqual(S.suggestionsOf(S.get(one.id)).map((s) => /saw: (.*)\n/.exec(s.description)[1]), ["three rows in, two out", "the header is taken for data", "spaces are left"]);
    // The same review read again (a later round names them all once more) adds nothing.
    const again = { findings: review.findings.map(({ suggested, ...f }) => f) };
    suggestFaults(one.id, again);
    assert.equal(S.suggestionsOf(S.get(one.id)).length, 3); assert.deepEqual(again.findings.map((f) => f.suggested.id), ["S1", "S2", "S3"]);
    // Another task's review names the first of them, and two more in the same file that read much like it. The known
    // one is recognised, whatever the order; the other two are new, each with its own proof, and none shares a place.
    const other = { findings: [{ id: "F1", severity: "minor", subject: "The importer pads the last row badly", where: "import.js:12", proof: "tabs are added", preexisting: true }, { id: "F2", severity: "minor", subject: "The importer drops the last row", where: "import.js:12", proof: "seen again", preexisting: true },
      { id: "F3", severity: "minor", subject: "The importer quotes the last row badly", where: "import.js:12", proof: "quotes are doubled", preexisting: true }] };
    S.update(one.id, (t) => { t.suggestions = t.suggestions.filter((x) => x.id === "S1"); }); // only the dropped row is known
    suggestFaults(two.id, other);
    assert.deepEqual(other.findings.map((f) => `${f.suggested.on} ${f.suggested.id}`), ["proj/2 S1", "proj/1 S1", "proj/2 S2"]);
    assert.deepEqual(S.suggestionsOf(S.get(two.id)).map((s) => /saw: (.*)\n/.exec(s.description)[1]), ["tabs are added", "quotes are doubled"]);
    S.update(two.id, (t) => { t.suggestions = []; });
    // The same again with the board busy when the review came in: the known one is recognised at once (that only
    // reads), the two new ones wait. Saved later, they still get places of their own, not the known one's.
    const late = { findings: other.findings.map(({ suggested, ...f }) => f) };
    const held = S.holdLock("suggest:proj");
    suggestFaults(two.id, late);
    assert.deepEqual(late.findings.map((f) => (f.suggested ? `${f.suggested.on} ${f.suggested.id}` : "owed")), ["owed", "proj/1 S1", "owed"]);
    S.update(two.id, (t) => { t.reviewRound = 1; S.logReview(t, { ...late, meets: true, gate: "major", pass: true }); });
    held();
    housekeeping(w.socket, { force: true });
    assert.deepEqual(S.get(two.id).reviews[0].findings.map((f) => `${f.suggested.on} ${f.suggested.id}`), ["proj/2 S1", "proj/1 S1", "proj/2 S2"]);
    assert.deepEqual(S.suggestionsOf(S.get(two.id)).map((s) => /saw: (.*)\n/.exec(s.description)[1]), ["tabs are added", "quotes are doubled"]);
    S.update(two.id, (t) => { t.suggestions = []; t.reviews = []; });
    // Another task's agent reports the first of them in its own words: recognised.
    assert.match(A.suggest(two.id, "Importing loses the final row of the file", { description: "import.js" }).msg, /^Already suggested \(S1 on proj\/1\)\. Nothing was added\./);
    assert.equal(S.suggestionsOf(S.get(two.id)).length, 0);
    // The human files the work themselves after it was suggested: yes to the suggestion makes no second task.
    S.suggest(two.id, { title: "CSV export writes no header", by: "agent" });
    const own = A.add(w.root, "CSV export writes no header");
    const s = open(w); s.v.sel = two.id; s.v.load(); s.press(ASK, "y");
    assert.match(s.text(140), new RegExp(`Already a task: ${own.id.replace("/", "\\/")}\\. No second one was made\\.`));
    assert.deepEqual(S.list().map((t) => t.title).filter((x) => /CSV/.test(x)), ["CSV export writes no header"]);
    assert.deepEqual(S.get(two.id).suggestions.map((x) => [x.state, x.task]), [["accepted", own.id]]);
  } finally { w.cleanup(); }
});
