// The board's own check as a task shows it: a true count from the command, the wait for a turn, the minutes left
// from earlier runs, an answer known at once, a check that stands still, and a colour of its own.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { world } from "./helpers.js";
import { open } from "./board-helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { show } from "../src/state.js";
import { osc } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { statusColor } from "../src/board/view/states.js";
import { claim, guardFor } from "../src/runner.js";
import { readReport, startCheck, stepCheck, checkShown, ranFor, stillAfter, KNOWN_LINE } from "../src/check-progress.js";
import { follow, runCheck, progressFile, PROGRESS_ENV } from "../src/finish/check-run.js";

const MIN = 60000, T0 = 1_000_000_000_000;
// One world for the tests that need a board's folders: each makes its own task in it.
let w;
before(async () => { w = await world({ settings: { helper: "off" } }); });
after(() => w.cleanup());
// A check that has run for `spent`, with what it last reported.
const running = (report, { spent = 0, usual = 0, idle = 0 } = {}) => { const c = stepCheck(startCheck(T0, usual), { state: "running", ...report }, T0); return checkShown({ ...c, movedAt: T0 + spent - idle }, T0 + spent); };

test("what a check may write: a JSON line or plain words; anything else is not read as a count", () => {
  assert.deepEqual(readReport('{"done":31,"total":47,"unit":"tests"}'), { state: "running", done: 31, total: 47, before: 0, unit: "tests" });
  assert.deepEqual(readReport('{"done":31,"total":47,"before":40}'), { state: "running", done: 31, total: 47, before: 31, unit: "" }); // never more than are finished
  assert.deepEqual(readReport('{"state":"running","done":3,"total":10}\n'), { state: "running", done: 3, total: 10, before: 0, unit: "" });
  assert.deepEqual(readReport("31/47"), { state: "running", done: 31, total: 47, before: 0, unit: "" });
  assert.deepEqual(readReport("31 of 47 tests\n"), { state: "running", done: 31, total: 47, before: 0, unit: "tests" });
  assert.deepEqual(readReport('{"done":50,"total":47}'), { state: "running", done: 47, total: 47, before: 0, unit: "" }); // never past the end
  assert.deepEqual(readReport('{"state":"waiting","ahead":2}'), { state: "waiting", ahead: 2 });
  assert.deepEqual(readReport('{"state":"known"}'), { state: "known" });
  assert.deepEqual(readReport('{"state":"running"}'), { state: "running" });
  for (const junk of ["", "half", '{"done":3}', '{"done":3,"total":0}', '{"state":"odd","done":1,"total":2}', "[1,2]", '{"done":"x","total":4}', '{"done":1,"tot']) assert.equal(readReport(junk), null, junk);
});

test("while it runs: the bar and the percent are the true count, the minutes left are what full runs took here less the time spent", () => {
  assert.deepEqual(running({ done: 31, total: 47, unit: "tests" }, { spent: 2 * MIN, usual: 5 * MIN }), { msg: "Running the check · tests 31 of 47", progress: 65, eta: 3 });
  assert.deepEqual(running({ done: 0, total: 47, unit: "tests" }, { spent: 0, usual: 5 * MIN }), { msg: "Running the check · tests 0 of 47", progress: 0, eta: 5 });
  assert.deepEqual(running({ done: 3, total: 10, unit: "" }, { spent: 30000, usual: 40000 }), { msg: "Running the check · 3 of 10", progress: 30, eta: 1 }); // never under a minute while work is left
  // Not 100% before the last one is finished; finished, nothing is left.
  assert.equal(running({ done: 199, total: 200 }, { usual: MIN }).progress, 99);
  assert.deepEqual(running({ done: 47, total: 47, unit: "tests" }, { spent: MIN, usual: 5 * MIN }), { msg: "Running the check · tests 47 of 47", progress: 100, eta: 0 });
  // Past the time runs usually take, or with no run timed yet: at the pace of this run. Too little done to tell: no minutes.
  assert.equal(running({ done: 30, total: 40 }, { spent: 6 * MIN, usual: 5 * MIN }).eta, 2);
  assert.equal(running({ done: 10, total: 40 }, { spent: 2 * MIN }).eta, 6);
  assert.equal(running({ done: 1, total: 40 }, { spent: 2 * MIN }).eta, undefined);
  // A run that found most files passed already has only the rest to do: the bar starts where the count is, and the
  // minutes are that share of a full run.
  const c = stepCheck(startCheck(T0, 10 * MIN), { state: "running", done: 40, total: 50, before: 40, unit: "tests" }, T0);
  assert.equal(c.from, 40);
  assert.deepEqual(checkShown(stepCheck(c, { state: "running", done: 45, total: 50, before: 40, unit: "tests" }, T0 + MIN), T0 + MIN), { msg: "Running the check · tests 45 of 50", progress: 90, eta: 1 });
});

test("while it waits its turn: it says so with how many are ahead and minutes from the runs ahead; no bar", () => {
  let c = stepCheck(startCheck(T0, 2 * MIN), { state: "waiting", ahead: 2 }, T0 + 1000);
  assert.deepEqual(checkShown(c, T0 + 1000), { msg: "Waiting for its turn · 2 ahead", eta: 6 }); // two runs ahead and its own
  assert.equal(checkShown(c, T0 + 1000).progress, undefined);
  assert.equal(checkShown(c, T0 + 1000 + MIN).eta, 5); // the time since the line last moved comes off
  c = stepCheck(c, { state: "waiting", ahead: 1 }, T0 + 3 * MIN);
  assert.deepEqual(checkShown(c, T0 + 3 * MIN), { msg: "Waiting for its turn · 1 ahead", eta: 4 });
  assert.deepEqual(checkShown(stepCheck(startCheck(T0), { state: "waiting", ahead: 1 }, T0), T0), { msg: "Waiting for its turn · 1 ahead", eta: undefined }); // no run timed yet: no minutes
  // Its turn comes: the run's own time starts then, not when the check was started.
  c = stepCheck(c, { state: "running", done: 0, total: 10, unit: "tests" }, T0 + 4 * MIN);
  assert.equal(c.runAt, T0 + 4 * MIN);
  assert.deepEqual(checkShown(c, T0 + 5 * MIN), { msg: "Running the check · tests 0 of 10", progress: 0, eta: 1 });
  assert.equal(ranFor(stepCheck(c, { state: "running", done: 10, total: 10, unit: "tests" }, T0 + 6 * MIN), T0 + 6 * MIN), 2 * MIN); // the wait is not part of how long a run takes
});

test("an answer known at once has no bar; a check that reports no count shows the time it runs against last time, never a percent", () => {
  assert.deepEqual(checkShown(stepCheck(startCheck(T0, MIN), { state: "known" }, T0), T0), { msg: KNOWN_LINE });
  assert.equal(ranFor(stepCheck(startCheck(T0, MIN), { state: "known" }, T0), T0 + 5), null); // and is not timed as a run
  const plain = (spent, usual) => checkShown(startCheck(T0, usual), T0 + spent);
  assert.deepEqual(plain(20000, 0), { msg: "Running the check · under 1m" });
  assert.deepEqual(plain(7 * MIN + 5000, 0), { msg: "Running the check · 7m" });
  assert.deepEqual(plain(2 * MIN, 5 * MIN), { msg: "Running the check · 2m of about 5m", eta: 3 });
  assert.deepEqual(plain(6 * MIN, 5 * MIN), { msg: "Running the check · 6m, usually 5m" }); // past it: no minutes left are made up
  assert.equal(ranFor(startCheck(T0), T0 + 90000), 90000);
  // A run that had part of its work done already is not what a full run takes.
  assert.equal(ranFor(stepCheck(startCheck(T0), { state: "running", done: 5, total: 9, before: 4 }, T0), T0 + 1000), null);
  assert.equal(ranFor(stepCheck(startCheck(T0), { state: "running", done: 5, total: 9 }, T0), T0 + 1000), 1000); // a first report that comes late is still a full run
});

test("standing still far longer than it should is said plainly: nothing finished, a line that does not move, a run far past its usual time", () => {
  assert.equal(stillAfter(0), 10 * MIN); assert.equal(stillAfter(30000), 3 * MIN); assert.equal(stillAfter(4 * MIN), 12 * MIN);
  assert.deepEqual(running({ done: 31, total: 47, unit: "tests" }, { spent: 14 * MIN, usual: 4 * MIN, idle: 13 * MIN }), { msg: "The check stands still · nothing finished for 13m · tests 31 of 47", progress: 65 });
  // Every file finished and the command still runs long after: said too, with no "0m left" that never comes true.
  assert.deepEqual(running({ done: 47, total: 47, unit: "tests" }, { spent: 20 * MIN, usual: 5 * MIN, idle: 16 * MIN }), { msg: "The check has not ended · all finished 16m ago · tests 47 of 47", progress: 100 });
  assert.match(running({ done: 31, total: 47, unit: "tests" }, { spent: 14 * MIN, usual: 4 * MIN, idle: 11 * MIN }).msg, /^Running the check/); // slow is not still
  const c = stepCheck(startCheck(T0, MIN), { state: "waiting", ahead: 2 }, T0);
  assert.deepEqual(checkShown(c, T0 + 4 * MIN), { msg: "Waiting for its turn unusually long · nothing moved for 4m · 2 ahead" });
  assert.deepEqual(checkShown(stepCheck(c, { state: "waiting", ahead: 1 }, T0 + 4 * MIN), T0 + 4 * MIN), { msg: "Waiting for its turn · 1 ahead", eta: 2 }); // it moved
  assert.deepEqual(checkShown(startCheck(T0, 2 * MIN), T0 + 13 * MIN), { msg: "The check runs far longer than usual · 13m, usually 2m" });
});

test("the task shows it everywhere a task's progress shows, in a colour of its own: the row, the panel, the chat line, OSC", async () => {
  {
    const s = open(w), now = Date.now();
    const check = { ...stepCheck(startCheck(now - 2 * MIN, 5 * MIN), { state: "running", done: 31, total: 47, unit: "tests" }, now - 2 * MIN), movedAt: now };
    const task = { id: "proj/1", title: "Add a greeting", stage: "checking", app: "claude", agent: "claude", owner: "you", msg: "Running the check", check, since: now - 9 * MIN, at: now };
    // The Watcher's guess for the agent, left on the task, is not the check's.
    const shown = show({ ...task, watch: { role: "agent", progress: 80, msg: "writing tests" } }, { status: "idle" }, now);
    assert.deepEqual([shown.state, shown.msg, shown.progress, shown.eta], ["working", "Running the check · tests 31 of 47", 65, 3]);
    assert.deepEqual(show({ ...task, check: null }, { status: "idle" }, now).progress, undefined); // before the check itself: no bar
    const row = (c, extra = {}) => { const sh = show({ ...task, check: c }, { status: "idle" }, now); return { ...task, check: c, state: sh.state, msg: sh.msg, note: sh.msg, progress: sh.progress, eta: sh.eta, at: task.since, ...extra }; };
    const r = row(check);
    assert.equal(statusColor(r), "check"); assert.equal(theme.fg("check", "x"), theme.fg("subtext0", "x")); if (!process.env.NO_COLOR) { assert.notEqual(theme.fg("check", "x"), theme.fg("yellow", "x")); assert.notEqual(theme.fg("check", "x"), theme.fg("overlay0", "x")); }
    assert.equal(statusColor({ ...r, stage: "working" }), "yellow"); assert.equal(statusColor({ ...r, stage: "reviewing" }), "review"); // the agent's and the reviewer's stay their own
    const f = s.v.rowFields(r, now), grey = (x) => theme.fg("check", x);
    assert.equal(f.bar, grey("█████░░░")); assert.equal(f.percent, grey(" 65%")); assert.equal(f.eta, grey("3m"));
    assert.ok(s.v.mark(r).startsWith(grey("x").split("x")[0]));
    const lines = (x) => s.v.rowLines(x, 120).map(stripVTControlCharacters); // a live row: its columns, then what it says under its name
    assert.match(lines(r)[0], /Add a greeting +█████░░░ +65% +3m  +9m *$/); assert.match(lines(r)[1], /^ +Running the check · tests 31 of 47 *$/);
    // Waiting for its turn: the minutes, and no bar that pretends to move. Known at once: only the words.
    const waiting = row(stepCheck(startCheck(now, 2 * MIN), { state: "waiting", ahead: 2 }, now));
    assert.deepEqual([s.v.rowFields(waiting, now).bar, s.v.rowFields(waiting, now).percent, s.v.rowFields(waiting, now).eta], ["", "", grey("6m")]);
    assert.match(lines(waiting)[0], /Add a greeting +6m  +9m *$/); assert.match(lines(waiting)[1], /^ +Waiting for its turn · 2 ahead *$/);
    const known = row(stepCheck(startCheck(now), { state: "known" }, now));
    assert.match(lines(known)[0], /Add a greeting  +9m *$/); assert.match(lines(known)[1], /^ +The check already passed for this exact code *$/);
    // The rows of a section still give the same things up together: the bar first, on every row.
    const beside = { id: "proj/2", title: "Another task that an agent works on", stage: "working", state: "working", msg: "editing", progress: 40, eta: 12, at: now - MIN };
    for (const width of [120, 70, 56, 44]) {
      const layout = s.v.rowLayout([r, beside], width, undefined, 200), lines = [r, beside].map((x) => stripVTControlCharacters(s.v.row(x, width, layout)));
      assert.equal(/[█░]/.test(lines[0]), /[█░]/.test(lines[1]), `bars at ${width}`); assert.equal(/\d%/.test(lines[0]), /\d%/.test(lines[1]), `percents at ${width}`);
    }
    // The side panel and the details page: the same bar, percent and minutes under Status, and the line under "Now".
    const panel = (full) => s.v.panel(r, 60, 30, full).map(stripVTControlCharacters).join("\n");
    for (const full of [false, true]) { assert.match(panel(full), /Progress +█+░+ 65% · 3m left/); assert.match(panel(full), /Running the check · tests 31 of 47/); }
    // The chat line, when you talk to its agent: the same words, then the same bar, percent and minutes, in the same colour.
    const head = (x, width) => s.v.chatHead({ mark: s.v.mark(x), name: x.title, status: theme.muted(x.msg), progress: chatProgress(x) }, width)[0];
    const chatProgress = (x) => { s.v.reply = true; s.v.hasAgent = () => true; s.v.previewOf = () => null; s.v.sentTo = () => ""; s.v.turnMark = () => ""; return s.v.chatOf(x).progress; };
    assert.deepEqual(chatProgress(r), [`${grey("█████░░░")} ${grey(" 65%")} ${grey("3m")}`, `${grey(" 65%")} ${grey("3m")}`]);
    assert.match(stripVTControlCharacters(head(r, 120)), /^ ◐ Add a greeting {2}Running the check · tests 31 of 47 {2}█████░░░ {2}65% 3m$/);
    assert.match(stripVTControlCharacters(head(r, 60)), /^ ◐ Add a greeting {2}Running the check · te… {2}█████░░░ {2}65% 3m$/); // the words are cut, the numbers never
    assert.match(stripVTControlCharacters(head(r, 52)), /^ ◐ Add a greeting {2}Running the check · tes… {3}65% 3m$/); // too narrow for the bar
    assert.match(stripVTControlCharacters(head(r, 30)), /^ ◐ Add a greeting {2}Running th…$/);
    assert.deepEqual(chatProgress(waiting), [grey("6m")]); assert.deepEqual(chatProgress(known), []);
    assert.match(stripVTControlCharacters(head(waiting, 120)), /^ ◐ Add a greeting {2}Waiting for its turn · 2 ahead {2}6m$/);
    assert.match(osc(r), /:progress=65:eta=3:/);
  }
});

test("the runner follows a check: what its command writes is kept on the task as it changes, and how long a full run took is remembered", async () => {
  {
    const t = { id: A.add(w.root, "Followed").id }, sets = [];
    const g = { set: (p) => { sets.push(p); return Object.assign(t, p); } };
    let now = T0;
    S.noteCheckRun(w.root, "the check", 4 * MIN);
    const f = follow(g, t, { cmd: "the check", root: w.root, now: () => now });
    assert.equal(f.file, progressFile(t.id));
    assert.deepEqual(t.check, { at: T0, runAt: T0, movedAt: T0, usual: 4 * MIN }); assert.equal(t.msg, "Running the check");
    f.look(); assert.equal(sets.length, 1); // nothing written yet: nothing changes
    fs.writeFileSync(f.file, '{"state":"waiting","ahead":1}'); now += 1000; f.look();
    assert.equal(show({ ...t, stage: "checking" }, undefined, now).msg, "Waiting for its turn · 1 ahead");
    fs.writeFileSync(f.file, '{"state":"running","done":0,"total":4,"unit":"tests"}'); now += 5000; f.look();
    assert.equal(t.check.runAt, now);
    f.look(); f.look(); assert.equal(sets.length, 3); // the same words again are not written to the task again
    fs.writeFileSync(f.file, "half a li"); f.look(); assert.equal(sets.length, 3); // something unreadable changes nothing
    fs.writeFileSync(f.file, '{"state":"running","done":2,"total":4,"unit":"tests"}'); now += 2 * MIN; f.look();
    assert.deepEqual([t.check.done, t.check.movedAt], [2, now]);
    assert.deepEqual(show({ ...t, stage: "checking" }, undefined, now), { state: "working", app: undefined, msg: "Running the check · tests 2 of 4", progress: 50, eta: 2, reviewing: false });
    // It passed: how long the run itself took is remembered, for the minutes left of the next one.
    fs.writeFileSync(f.file, '{"state":"running","done":4,"total":4,"unit":"tests"}'); now += MIN;
    assert.equal(f.end(true).known, false);
    assert.equal(fs.existsSync(f.file), false);
    assert.equal(S.usualCheck(w.root, "the check"), 3 * MIN + 0); // the middle of 4m and this run's 3m: the lower of two
    assert.equal(S.usualCheck(w.root, "another check"), 0); assert.equal(S.usualCheck(path.join(w.root, "elsewhere"), "the check"), 0);
    // A run that failed is not what a run takes.
    const g2 = follow(g, t, { cmd: "the check", root: w.root, now: () => now }); now += 9 * MIN; g2.end(false);
    assert.equal(S.usualCheck(w.root, "the check"), 3 * MIN);
    for (const ms of [MIN, MIN, MIN, MIN, MIN, MIN]) S.noteCheckRun(w.root, "the check", ms);
    assert.equal(S.usualCheck(w.root, "the check"), MIN); // only the last few count
  }
});

test("the board's check, run: the command gets the file's name, an answer known at once is said and not timed, a check that says nothing still works", async () => {
  {
    const id = A.add(w.root, "Checked").id;
    claim(id, "pipeline", { stage: "checking" });
    const g = guardFor(id); g.expect(S.get(id));
    const run = (cmd) => runCheck(g, S.get(id), { cmd, folder: w.root, env: {}, alive: () => true, root: w.root });
    const known = `printf '{"state":"known"}' > "$${PROGRESS_ENV}"`;
    let r = await run(known);
    assert.equal(r.ok, true); assert.equal(r.known, true);
    assert.equal(S.get(id).msg, KNOWN_LINE); assert.equal(S.get(id).check, null); assert.equal(S.usualCheck(w.root, known), 0);
    const counted = `printf '3/3 tests' > "$${PROGRESS_ENV}"; sleep 0.01`;
    r = await run(counted);
    assert.equal(r.ok, true); assert.equal(r.known, false); assert.equal(S.get(id).msg, "Running the check"); assert.ok(S.usualCheck(w.root, counted) > 0);
    r = await run("sleep 0.01; false"); // no report, and it fails: the failure is the check's own, as before
    assert.equal(r.ok, false); assert.equal(S.get(id).check, null); assert.equal(S.usualCheck(w.root, "sleep 0.01; false"), 0);
    assert.equal(fs.existsSync(progressFile(id)), false);
  }
});
