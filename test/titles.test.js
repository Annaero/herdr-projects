// A title's length limit: one number, the same for a task typed, renamed, suggested, or made from a reviewer's
// finding. A longer title is shortened at a word and its full text is kept in the description.
import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { main } from "../src/cli.js";
import { rules as agentRules } from "../src/delegate.js";
import { suggestFaults, reviewBrief } from "../src/finish.js";
import { knownFaults } from "../src/finish/faults.js";
import * as G from "../src/gate.js";

const LONG = "After the startup dialog handoff, finish jobs wrongly mark the untouched task as stopped without a summary.";
const SHORT = "After the startup dialog handoff, finish jobs wrongly mark…";
const len = (s) => Array.from(s).length;

test("a title that fits is kept; a longer one is cut at a word and ends in an ellipsis", () => {
  assert.equal(S.TITLE_MAX, 60);
  assert.equal(S.shortTitle("Add a column"), "Add a column");
  const exact = "x".repeat(60); assert.equal(S.shortTitle(exact), exact);
  assert.equal(S.shortTitle(LONG), SHORT); assert.ok(len(SHORT) <= 60);
  // Only the full stop was too much: it goes, and nothing is marked as cut.
  assert.equal(S.shortTitle("x".repeat(60) + "."), exact); assert.equal(S.titled("x".repeat(60) + ".").cut, false);
  // One very long word has no word boundary to cut at: it is cut where the room ends.
  assert.equal(S.shortTitle("y".repeat(90)), "y".repeat(59) + "…");
  // The cut never leaves a comma or a dash hanging, and characters are counted, not bytes.
  assert.equal(S.shortTitle(`${"ab ".repeat(18)}cd, - efgh ijkl`), `${"ab ".repeat(18)}cd…`);
  assert.equal(len(S.shortTitle("é".repeat(80))), 60);
  // Room on the screen is what is limited: a wide character takes two cells, so 30 of them fill a title, and the
  // store counts cells as the board's rows do.
  assert.equal(S.shortTitle("界".repeat(30)), "界".repeat(30)); assert.equal(S.shortTitle("界".repeat(60)), "界".repeat(29) + "…"); assert.equal(S.shortTitle("😀".repeat(80)), "😀".repeat(29) + "…");
  for (const x of ["Add a column", "界".repeat(60), "😀".repeat(80), "☀️".repeat(60), "©️".repeat(60), "↔️".repeat(60), "⌚".repeat(60), "⚡".repeat(60), "🈀".repeat(60), "👨‍👩‍👧".repeat(40), "🇸🇪".repeat(40), "한국어 제목 ".repeat(20), "e\u0301".repeat(80), "ｆｕｌｌ ｗｉｄｔｈ ".repeat(9), "日本語のタイトル and English words mixed ".repeat(4)]) {
    assert.equal(S.titleWidth(x), visibleWidth(x), x); assert.ok(visibleWidth(S.shortTitle(x)) <= 60, x);
  }
  assert.equal(S.shortTitle("two\nlines"), "two lines");
  for (const n of [61, 75, 120, 300]) assert.ok(len(S.shortTitle("word ".repeat(n).slice(0, n))) <= 60, String(n));
});

test("where the board's measure cannot be loaded, the count used is never too low: the title still fits the row", () => {
  // Every character below U+2800 (all the narrow alphabets, and the symbols that become emoji) and a spread of the
  // rest, alone, shown as an emoji, and after a letter: never counted as less than the row counts it.
  const low = [];
  for (let cp = 0x20; cp < 0x3ffff; cp += cp < 0x2800 ? 1 : 37) {
    if ((cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0x7f && cp < 0xa0)) continue;
    const c = String.fromCodePoint(cp);
    for (const x of [c, `${c}\ufe0f`, `a${c}`]) if (S.roughWidth(x) < visibleWidth(x)) low.push(cp.toString(16));
  }
  assert.deepEqual(low, []);
  // Titles shortened by that count alone fit 60 cells as the row measures them.
  for (const x of ["☀️".repeat(60), "©️".repeat(60), "↔️".repeat(60), "⌚".repeat(60), "⚡".repeat(60), "🈀".repeat(60), "界".repeat(60), "😀".repeat(80), "👨‍👩‍👧".repeat(40), "🇸🇪".repeat(40), "e\u0301".repeat(80), "Ünïcödé wörds ánd ☀️ sün ".repeat(5)]) {
    const short = S.shortTitle(x, 60, S.roughWidth);
    assert.ok(S.roughWidth(x) >= visibleWidth(x), x); assert.ok(visibleWidth(short) <= 60, x); assert.ok(short.endsWith("…"), x);
  }
  // Plain and accented letters are counted exactly: such a title is not cut sooner than with the board's measure.
  for (const x of ["Add a column", "é".repeat(80), "Ünïcödé wörds ".repeat(8), "Заголовок задачи ".repeat(6)]) assert.equal(S.shortTitle(x, 60, S.roughWidth), S.shortTitle(x), x);
});

test("add, rename and report --title follow the limit, and the full text stays in the description", async () => {
  const w = await world();
  const write = process.stdout.write; let said = "";
  const board = async (...args) => { said = ""; process.stdout.write = (x, ...more) => { if (typeof x !== "string") return write.call(process.stdout, x, ...more); said += x; return true; }; try { await main(args); } finally { process.stdout.write = write; } return said; };
  try {
    const one = A.add(w.root, LONG, { description: "It happens on a slow machine." });
    assert.deepEqual([one.title, one.description], [SHORT, `${LONG}\n\nIt happens on a slow machine.`]);
    // A description that already says it is not given it twice; a title that fits changes nothing.
    assert.equal(A.add(w.root, LONG, { description: `Seen today:\n${LONG}` }).description, `Seen today:\n${LONG}`);
    assert.deepEqual([A.add(w.root, LONG).description, A.add(w.root, "Add a column", { description: "why" }).description], [LONG, "why"]);
    // Renamed: the same rule, and what the task already said is kept under the new full text.
    const plain = A.add(w.root, "Old name", { description: "Details." });
    assert.deepEqual([A.rename(plain.id, "New name").title, S.get(plain.id).description], ["New name", "Details."]);
    const again = A.rename(plain.id, LONG);
    assert.deepEqual([again.title, again.description], [SHORT, `${LONG}\n\nDetails.`]);
    assert.equal(A.rename(plain.id, "  ").title, SHORT); // an empty title changes nothing
    const told = A.report(plain.id, { title: `${"Renamed while it is marked as blocked ".repeat(3)}`, state: "blocked", msg: "why" });
    assert.ok(len(told.title) <= 60); assert.match(told.title, /^Renamed while it is marked as blocked Renamed while it is…$/); assert.match(told.description, /^Renamed while it is marked as blocked Renamed .*\n\n/);
    // The command line says so, with the number, to whoever gave the long title; a title that fits says nothing.
    assert.match(await board("add", LONG, "--repo", w.root), /added The title was over 60 characters, so it was shortened to "After the startup dialog handoff, finish jobs wrongly mark…" and the full text was kept in the description\./);
    assert.doesNotMatch(await board("add", "A short one", "--repo", w.root), /60 characters/);
    assert.match(await board("report", plain.id, "--title", LONG), /updated \(title\) The title was over 60 characters/);
    assert.match(await board("report", "--title", LONG, "--repo", w.root), /added The title was over 60 characters/);
    assert.ok(S.list().every((t) => len(t.title) <= 60));
    // A cut title keeps its whole sentence as the task's subject; a new title that fits takes it away again.
    assert.equal(one.subject, LONG); assert.equal(S.get(plain.id).subject.length > 60, true);
    assert.equal(A.rename(plain.id, "Short again").subject, undefined);
    assert.match(await board("help"), /a title is at most 60 characters/);
  } finally { w.cleanup(); }
});

test("a suggestion's title follows the limit: the reviewer's own short one, or the finding's sentence shortened", async () => {
  const w = await world();
  try {
    const one = A.add(w.root, "Add a column");
    // An agent's long title: shortened, whole in the description, and still known by all of its words.
    const out = A.suggest(one.id, LONG, { description: "Seen in src/finish/recover-job.js." });
    assert.deepEqual([out.suggestion.title, out.suggestion.subject, out.suggestion.description], [SHORT, LONG, `${LONG}\n\nSeen in src/finish/recover-job.js.`]);
    assert.ok(A.suggest(one.id, LONG, { description: "src/finish/recover-job.js again" }).known);
    assert.equal(A.suggest(one.id, "Dates are parsed as text").suggestion.subject, undefined);
    // Two sentences that only differ after the cut are two things, as a task and a suggestion and as two suggestions:
    // the board knows each by its whole sentence. The very same sentence again is still known.
    const runner = "The background task runner incorrectly changes the status of untouched tasks";
    const filed = A.add(w.root, `${runner} before the user responds.`);
    assert.equal(filed.title, S.shortTitle(`${runner} after the user responds.`));
    const other = A.suggest(one.id, `${runner} after the user responds.`);
    assert.equal(other.known, undefined); assert.equal(other.suggestion.title, filed.title);
    assert.equal(A.suggest(one.id, `${runner} before the user responds.`).known.task, filed.id);
    assert.deepEqual(A.suggest(one.id, `${runner} after the user responds.`).known, { on: one.id, id: other.suggestion.id, state: "open" });
    // However long the sentences are: ones that only part ways after 200 or after 3000 bytes are still two.
    for (const n of [8, 120]) {
      const lead = `The nightly report builder ${"keeps reading stale cached totals and ".repeat(n)}prints them`;
      const first = A.suggest(one.id, `${lead} before the export.`), second = A.suggest(one.id, `${lead} after the export.`);
      assert.ok(Buffer.byteLength(lead) > (n === 8 ? 192 : 2048)); assert.ok(first.suggestion && second.suggestion, String(n)); assert.equal(second.suggestion.subject, `${lead} after the export.`);
      const t1 = A.acceptSuggestion(one.id, first.suggestion.id).task;
      assert.equal(A.suggest(one.id, `${lead} before the export.`).known.task, t1.id);
      S.update(one.id, (t) => { t.suggestions = t.suggestions.filter((s) => ![first.suggestion.id, second.suggestion.id].includes(s.id)); });
      const third = A.suggest(one.id, `${lead} after the export.`); assert.ok(third.suggestion, `after accepting, ${n}`);
      S.update(one.id, (t) => { t.suggestions = t.suggestions.filter((s) => s.id !== third.suggestion.id); }); S.update(t1.id, (t) => { t.stage = "done"; });
    }
    // The same for a reviewer's findings: a sentence is kept whole (it is 400 characters at most), not cut at 120.
    const tail = "x".repeat(150), pair = { findings: G.readFindings(["first", "last"].map((w) => ({ severity: "minor", subject: `The table view ${tail} sorts the ${w} column wrongly`, title: `Table sorts the ${w} column wrongly`, where: "table.js", preexisting: true }))) };
    suggestFaults(one.id, pair);
    assert.deepEqual(S.suggestionsOf(S.get(one.id)).filter((s) => /^Table sorts/.test(s.title)).map((s) => s.subject.length), [196, 195]);
    S.update(one.id, (t) => { t.suggestions = t.suggestions.filter((s) => !/^Table sorts/.test(s.title)); });
    // Accepted, the task carries the sentence on: the same suggestion raised again is that task, the other one is not.
    const taken = A.acceptSuggestion(one.id, other.suggestion.id);
    assert.deepEqual([taken.existing, taken.task.subject], [false, `${runner} after the user responds.`]);
    S.update(one.id, (t) => { t.suggestions = t.suggestions.filter((s) => s.id !== other.suggestion.id); });
    assert.equal(A.suggest(one.id, `${runner} after the user responds.`).known.task, taken.task.id);
    S.update(filed.id, (t) => { t.stage = "done"; }); S.update(taken.task.id, (t) => { t.stage = "done"; });
    // A reviewer's finding: its `title` is the suggestion's title, its sentence the first thing the suggestion says.
    const sentence = "The importer silently drops the last row of every file that does not end in a newline character.";
    const review = { findings: G.readFindings([
      { severity: "major", subject: sentence, title: "Importer drops the last row", where: "import.js:12", proof: "ran it", preexisting: true },
      { severity: "minor", subject: "The nightly export job writes its header line twice whenever the target file already exists on disk.", where: "export.js:4", preexisting: true },
      { severity: "minor", subject: "Typo in the help text", title: "t".repeat(90), where: "cli.js:3", preexisting: true }]) };
    suggestFaults(one.id, review);
    const made = S.suggestionsOf(S.get(one.id)).filter((s) => s.by === "reviewer");
    assert.deepEqual(made.map((s) => s.title), ["Importer drops the last row", "The nightly export job writes its header line twice…", "t".repeat(59) + "…"]);
    assert.equal(made[0].subject, sentence); assert.ok(made[0].description.startsWith(`${sentence}\n\nWhere: import.js:12`));
    assert.equal(S.detailOf(made[0]).split("\n")[0], sentence);
    // The next round names the same fault under another short title: it is the same sentence, so nothing is added.
    const next = { findings: G.readFindings([{ severity: "major", subject: sentence, title: "Last row is lost on import", where: "import.js:12", preexisting: true }]) };
    suggestFaults(one.id, next);
    assert.equal(S.suggestionsOf(S.get(one.id)).filter((s) => s.by === "reviewer").length, 3); assert.deepEqual(next.findings[0].suggested, { on: one.id, id: made[0].id });
    // The next reviewer is told what is known by the whole sentence, not by the short title.
    assert.match(reviewBrief(S.get(one.id), { text: "done", change: { head: "abc" }, toLand: true, ch: { serve: "local" }, filed: knownFaults(S.get(one.id)) }), new RegExp(`do not report these again[^]*${sentence.slice(0, 40)}`));
    // Accepted: the task has the short title and the whole sentence in its description.
    const task = A.acceptSuggestion(one.id, made[0].id).task;
    assert.equal(task.title, "Importer drops the last row"); assert.ok(task.description.startsWith(sentence));
    // A suggestion saved before the limit, with its long sentence as its title, becomes a task that follows it.
    S.update(one.id, (t) => { t.suggestions.push({ id: "S9", title: LONG, description: `${LONG}\n\nWhere: a.js`, by: "reviewer", state: "open", at: 1 }); });
    const old = A.acceptSuggestion(one.id, "S9").task;
    assert.equal(old.title, SHORT); assert.ok(old.description.startsWith(`${LONG}\n\nWhere: a.js`)); assert.equal(old.description.split(LONG).length, 2);
  } finally { w.cleanup(); }
});

test("the Coordinator, the agents and the reviewer are told the limit", async () => {
  const w = await world();
  try {
    const one = A.add(w.root, "Add a column");
    const { rules: rulesText } = await import("../src/coordinator/rules.js");
    assert.match(rulesText(), /board add "<short title: a few words, at most 60 characters, no trailing period>"/);
    assert.match(rulesText(), /--title "<new title>" \(at most 60 characters too/);
    assert.match(agentRules(S.get(one.id)), /suggest "<short title: a few words, at most 60 characters>"/);
    const brief = reviewBrief(S.get(one.id), { text: "done", change: { head: "abc" }, toLand: true, ch: { serve: "local" } });
    assert.match(brief, /a `title` \(the same in a few words, at most 60 characters/); assert.match(brief, /"title": "<a few words, at most 60 characters>"/);
  } finally { w.cleanup(); }
});
