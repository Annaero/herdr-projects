// Suggested tasks are gone: what old tasks still carry of them is saved once and taken off, the old commands say so
// in a plain sentence, and a task that still carries some reads as any other.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { main } from "../src/cli.js";
import { housekeeping } from "../src/housekeeping.js";
import { open } from "./board-helpers.js";

test("a task saved with suggestions loads and shows as any other; the open ones are written to one page among the reports, once, and taken off the tasks", async () => {
  const w = await world();
  try {
    const one = A.add(w.root, "Add a column"), two = A.add(w.root, "Old work"), three = A.add(w.root, "Nothing open");
    S.update(one.id, (t) => { t.suggestions = [
      { id: "S1", title: "The cleanup retry test fails under load", description: "Where: test/cleanup-retry.test.js:52\nWhat the reviewer saw: 2 of 5 runs failed.", by: "reviewer", state: "open", at: Date.UTC(2026, 9, 1) },
      { id: "S2", title: "Dismissed long ago", by: "agent", state: "dismissed" },
      { id: "S3", title: "Dates are parsed as text", where: "src/dates.js", by: "agent", state: "open" }]; });
    S.update(two.id, (t) => { t.suggestions = [{ id: "S1", title: "Speed up the export", description: "It takes a minute.", by: "agent", state: "open" }]; t.archivedAt = Date.now(); });
    S.update(three.id, (t) => { t.suggestions = [{ id: "S1", title: "Made a task", by: "agent", state: "accepted", task: "proj/9" }]; });
    // Before anything is taken off: the board, the panel and the commands read such a task, and say nothing of them.
    const s = open(w, { rows: 40 }); s.v.sel = one.id; s.v.load();
    const text = s.text(120); assert.match(text, /Add a column/); assert.doesNotMatch(text, /[Ss]uggest/);
    s.press("\x0e"); assert.equal(s.v.ask, null); assert.doesNotMatch(s.text(120), /[Ss]uggest/); // ctrl+n is no key of the board
    assert.equal(A.details(one.id).suggestions, undefined);
    // The pass writes the open ones down, each with its task, its title, what it said and who made it.
    const file = S.oldSuggestionsFile();
    assert.equal(file, `${S.reportsDir()}/old-suggestions.md`); assert.equal(fs.existsSync(file), false);
    housekeeping(undefined, { force: true });
    const page = fs.readFileSync(file, "utf8");
    assert.match(page, /^# Suggested tasks that were still open\n/);
    assert.match(page, /\n## The cleanup retry test fails under load\n\nOn proj\/1 \(Add a column\) · from the reviewer · 2026-10-01\n\nWhere: test\/cleanup-retry\.test\.js:52\nWhat the reviewer saw: 2 of 5 runs failed\.\n/);
    assert.match(page, /\n## Dates are parsed as text\n\nOn proj\/1 \(Add a column\) · from the agent\n\nWhere: src\/dates\.js\n/);
    assert.match(page, /\n## Speed up the export\n\nOn proj\/2 \(Old work\) · from the agent\n\nIt takes a minute\.\n/); // an archived task's too
    assert.doesNotMatch(page, /Dismissed long ago|Made a task/); assert.equal(page.match(/^## /gm).length, 3);
    for (const t of S.list({ includeArchived: true })) assert.equal("suggestions" in t, false, t.id);
    // Once: a later pass writes nothing again, and reads no task for it.
    S.update(one.id, (t) => { t.suggestions = [{ id: "S9", title: "Sent by an older version", by: "agent", state: "open" }]; });
    housekeeping(undefined, { force: true });
    assert.equal(fs.readFileSync(file, "utf8"), page); assert.equal(S.saveOldSuggestions(), 0);
  } finally { w.cleanup(); }
});

test("the commands that are gone fail with a plain sentence that says so, and the help names none of them", async () => {
  const w = await world();
  try {
    const t = A.add(w.root, "Add a column");
    for (const args of [["suggest", "Fix the flaky test", "--from", t.id], ["suggestions"], ["accept", t.id, "S1"], ["dismiss", t.id]])
      await assert.rejects(main(args), (e) => e.message === `There is no "${args[0]}" command any more: suggested tasks were removed from the board. Mention work you came across outside your task in a short "Also noticed" list in your closing note or your report, and carry on with your own task.`);
    assert.deepEqual(S.list().map((x) => x.id), [t.id]);
    let said = ""; const write = process.stdout.write; process.stdout.write = (x) => ((said += x), true);
    try { await main(["help"]); } finally { process.stdout.write = write; }
    assert.doesNotMatch(said, /suggest|accept <id>|dismiss/);
  } finally { w.cleanup(); }
});

test("agents, reviewers and the Coordinator are told the same plain thing: work found outside the task is mentioned, never a task", async () => {
  const w = await world();
  try {
    const { rules } = await import("../src/delegate.js"), { rules: coordinator } = await import("../src/coordinator/rules.js"), { skillText } = await import("../src/extras.js");
    const { reviewBrief } = await import("../src/finish.js"), G = await import("../src/gate.js");
    const t = A.add(w.root, "Add a column"), told = rules(S.get(t.id));
    assert.match(told, /Work you merely come across is a line in your closing note or report, never a task\./);
    assert.doesNotMatch(told, /herdr-superwork suggest|accept|dismiss/);
    const brief = reviewBrief(S.get(t.id), { text: "done", change: { head: "abc" }, toLand: true, ch: {} });
    assert.match(brief, /such a finding is a note for the human, it never sends the work back and nothing else is done with it/);
    assert.match(brief, /one that was there before this change is marked `preexisting`: it is a note for the human in your review/);
    assert.doesNotMatch(brief, /suggest|becomes a task/);
    assert.match(coordinator(), /they mention it in a short "Also noticed" list in their closing note or report \(a reviewer: as a note in the review\)/);
    assert.match(skillText("herdr-superwork"), /mention it in a short "Also noticed" list/);
    for (const words of [coordinator(), skillText("herdr-superwork")]) assert.doesNotMatch(words, /suggest|accept <id>|dismiss/);
    // A reviewer on an older version's brief may still write a `title`: it is read past.
    assert.deepEqual(Object.keys(G.readFindings([{ severity: "minor", subject: "x", title: "y" }])[0]).sort(), ["id", "preexisting", "proof", "severity", "subject", "where"]);
  } finally { w.cleanup(); }
});
