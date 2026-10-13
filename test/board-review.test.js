// Reviews as the board shows them: on a row and in the task panel.
import test from "node:test";
import { ink, inkAt, keyed } from "./board-helpers.js";
import assert from "node:assert/strict";
import { groupOf, standing } from "../src/board/view/states.js";
import { stripVTControlCharacters } from "node:util";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";

test("the board: a row waiting for approval says the reviewer's advice in words, with the PR in the colour of its checks on the right", (tc) => {
  tc.mock.timers.enable({ apis: ["Date"], now: Date.now() }); // the clock stands still: "0s ago" stays true on a busy machine
  const v = Object.create(View.prototype); v.theme = theme; v.scope = ""; v.screens = new Map(); v.repo = { root: "/nowhere", name: "proj" };
  // A row that waits for you is two lines: the name and the columns, and under the name what it says.
  const row = (r, width, list = [r]) => stripVTControlCharacters(v.rowLines(r, width, v.rowLayout(list, width, undefined, 200)).join("\n"));
  const both = (r) => v.rowLines(r, 120).join("\n"), top = (...a) => row(...a).split("\n")[0];
  const page = (r, full = false) => stripVTControlCharacters(v.panel({ owner: "me", ...r }, 80, full).join("\n"));
  const base = { id: "proj/1", title: "Build a flying game", state: "blocked", kind: "permission", stage: "approval", agent: "claude", app: "claude", at: Date.now(), msg: "Approve to merge? Reviewed 3/5, says don't merge. Built **Skylark**: a little plane over endless sunny islands, with clouds." };
  const review = { score: 3, recommend: false, text: "Crashes." };
  const pr = { ...base, pr: "https://github.com/a/b/pull/12", prState: "passing", review }, plain = { ...base, review };
  const working = { id: "proj/2", title: "Other", state: "working", agent: "claude", stage: "work", progress: 50, msg: "A long sentence about what the other agent is doing right now, in detail.", at: Date.now() };
  // wide: the name, the score with the advice in words and, on the right, the PR in the colour of its checks. The row
  // does not repeat its heading ("approve to merge?" on every row), and which review it was is the R#1 tag left of the PR.
  assert.match(row(pr, 120), /^[ ▌]! #\d+ Build a flying game +R#1 PR#12 {2}0s ago\n[ ▌] {5}Review failed · 3\/5, reviewer says no$/);
  assert.match(row({ ...pr, prState: "" }, 120), / R#1 PR#12 {2}0s ago\n/);
  // failed checks are not ready to approve: the row needs you, says why, and offers no "approve and merge"
  const redPr = { ...pr, prState: "failing", prFailure: { stage: "pr", title: "Pull request checks failed", detail: "test: failure", agentCanFix: true, next: "Fix the checks." } };
  assert.match(row(redPr, 120), /^[ ▌]! #\d+ Build a flying game +R#1 PR#12 {2}0s ago\n[ ▌] {5}Pull request checks failed$/);
  assert.match(row({ ...pr, prState: "failing" }, 120), /^[ ▌]! #\d+ Build a flying game +R#1 PR#12 {2}0s ago\n[ ▌] {5}The pull request's checks fail$/);
  assert.match(page(redPr), keyed(/\n State {8}! needs you · 0s ago\n On it {8}claude\n Change {7}PR#12\n\n Went wrong ─+\n Pull request checks failed\n The agent can fix this: {sendBack} sends it\.\n Next step {4}Fix the checks\.\n Details {6}test: failure\n/)); assert.doesNotMatch(page(redPr), /ready to approve/);
  v.reply = false; v.full = false; v.menu = null; v.ask = null; v.mode = "new"; v.chatOpen = true; v.input = { getText: () => "" }; v.jobs = []; v.sel = "";
  assert.deepEqual(v.hints(redPr).map(([k]) => k), ["ctrl+r", "ctrl+l", "space", "?"]); assert.ok(!v.hints(redPr).some(([, d]) => /approve/.test(d)));
  // (This review says no: the work is not ready, and its yes is "merge anyway", after the key that sends the review back.)
  assert.deepEqual(v.hints(pr).slice(0, 2).map(([, d]) => d), ["send the review to this task's agent", "merge this task anyway"]);
  assert.equal(v.hints({ ...pr, review: { score: 5, recommend: true, text: "Fine." } })[0][1], "approve and merge this task");
  if (!process.env.NO_COLOR) assert.equal(inkAt(v.row(redPr, 120), "!"), ink("red"), "its mark is the needs-you red, not the ready green");
  assert.match(row(plain, 120), /^[ ▌]! #\d+ Build a flying game +R#1 {2}0s ago\n[ ▌] {5}Review failed · 3\/5, reviewer says no$/);
  assert.match(row({ ...pr, review: { ...review, recommend: true, score: 5 } }, 120), / R#1 PR#12 {2}0s ago\n[ ▌] {5}5\/5 reviewer says yes$/);
  assert.match(row({ ...pr, review: { score: 3 } }, 120), /^[ ▌]◆ #\d+ Build a flying game +R#1 PR#12 {2}0s ago\n[ ▌] {5}3\/5$/); // no advice given: the score alone, and nothing says it failed
  // the PR number is always written the same way and left-aligned, so the "PR#" parts line up
  const short = { ...pr, id: "proj/7", pr: 9, prState: "merged" }, list = [pr, short];
  assert.equal(row(pr, 120, list).indexOf("PR#12"), row(short, 120, list).indexOf("PR#9")); assert.match(row(short, 120, list), / PR#9 {3}0s ago\n/);
  if (!process.env.NO_COLOR) {
    const red = ink("red"), green = ink("green"), yellow = ink("yellow"), mauve = ink("mauve");
    assert.ok(both(pr).includes(`${red}Review failed`)); assert.ok(both({ ...pr, review: { ...review, recommend: true } }).includes(`${green}3/5`));
    // the PR's colour says how its checks went, and nothing else does: green they pass, red they fail, plain while there
    // is no result (running, or none), and quiet once it is merged; the same in the task panel
    const plainInk = ink("subtext0"), quietInk = ink("overlay0"), shown = (r) => [v.row(r, 120), v.panel({ owner: "me", ...r }, 80, false).join("\n")];
    for (const [state, tagInk] of [["passing", green], ["failing", red], ["waiting", plainInk], ["", plainInk], ["closed", plainInk], ["merged", quietInk]]) for (const out of shown({ ...pr, prState: state })) assert.match(out.replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, ""), new RegExp(`${tagInk.replace("[", "\\[")}PR#12`), `PR tag when ${state || "unknown"}`);
    for (const out of shown({ ...pr, state: "done", stage: "done", kind: undefined, prState: "passing", prMerged: true })) assert.ok(out.replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "").includes(`${quietInk}PR#12`), "merged and done: quiet, not green");
    // merged, the review tag goes quiet with the PR's: on the row, in the task panel and on the details page, in the
    // list and in the archive. One that failed and was merged anyway stays red. Not merged, nothing changes.
    const done = { ...pr, state: "done", stage: "done", kind: undefined, prMerged: true }, passed = { ...review, recommend: true }, views = (r) => [v.panel({ owner: "me", ...r }, 80, false).join("\n"), v.panel({ owner: "me", ...r }, 80, true).join("\n")];
    for (const r of [{ ...done, review: passed }, { ...done, review: passed, archivedAt: 1 }, { ...pr, prState: "merged", review: passed }]) {
      assert.ok(v.row(r, 120).includes(`${quietInk}R#1`) && !v.row(r, 120).includes(`${green}R#1`), "merged and passed: a quiet tag");
      for (const out of views(r)) assert.ok(out.includes(`${quietInk}3/5`) && !out.includes(`${green}3/5`), "merged and passed: a quiet verdict");
    }
    { // merged here with no pull request: no pull request flag is set, and it is quiet all the same; a failed one red
      const local = { ...base, state: "done", stage: "done", kind: undefined, msg: "Merged into main.", review: passed };
      assert.ok(v.row(local, 120).includes(`${quietInk}R#1`) && !v.row(local, 120).includes(green)); for (const out of views(local)) assert.ok(out.includes(`${quietInk}3/5`) && !out.includes(green), "merged locally: a quiet verdict");
      assert.ok(v.row({ ...local, review }, 120).includes(`${red}R#1`)); for (const out of views({ ...local, review })) assert.ok(out.includes(`${red}3/5`), "merged locally although it failed: red");
    }
    assert.ok(v.row(done, 120).includes(`${red}R#1`)); for (const out of views(done)) assert.ok(out.includes(`${red}3/5`), "merged although it failed: red");
    assert.ok(v.row({ ...done, reviewRound: 1, reviews: [{ error: "The reviewer gave no verdict.", round: 1 }] }, 120).includes(`${red}R#1`), "merged with no verdict: red");
    assert.ok(v.row({ ...done, review: { score: 3 } }, 120).includes(`${quietInk}R#1`), "merged with no advice: quiet");
    // a finished row's time is quiet the same way, so its whole right-hand side is: in a theme whose grey is the
    // terminal's text colour it is faint like the tags, where a row that is not done keeps the time as it was
    assert.ok(v.row(done, 120).includes(theme.muted(" 0s ago")) && v.row(pr, 120).includes(theme.fg("overlay0", " 0s ago")) && v.row(working, 120).includes(theme.fg("overlay0", " 0s")));
    { const t = Object.create(theme); t.muted = (x) => `<quiet>${x}</quiet>`; const w = Object.create(v); w.theme = t; const tail = (r) => stripVTControlCharacters(w.row(r, 120)).replace(/^.*?<quiet>#\d+<\/quiet>/, "").replace(/^.*?(?=<|$)/, ""); // right of the task's number, which is quiet on every row
      assert.equal(tail({ ...done, review: passed }), "<quiet>R#1</quiet> <quiet>PR#12</quiet> <quiet> 0s ago</quiet>"); assert.equal(tail({ ...done, pr: undefined, review: undefined, prMerged: false }), "<quiet> 0s ago</quiet>", "done with no pull request: its time is quiet too");
      for (const r of [pr, working, { ...working, stage: "reviewing", reviewRound: 1 }, { ...working, state: "idle" }, { ...working, state: "blocked", kind: "question" }]) assert.doesNotMatch(stripVTControlCharacters(w.row(r, 120)), /<quiet> *\d+s/, `not done (${r.state}): the time as it was`); }
    { // an earlier review that failed is quiet too: only the last one counts
      const at = Date.now(), twice = { ...done, reviewRound: 2, review: passed, reviews: [{ ...review, round: 1, at }, { ...passed, round: 2, at }] }, lost = { ...twice, review, reviews: [{ ...passed, round: 1, at }, { ...review, round: 2, at }] };
      assert.ok(v.row(twice, 120).includes(`${quietInk}R#2`)); for (const out of views(twice)) assert.ok(!out.includes(red) && !out.includes(green), "merged after a fail then a pass: all quiet");
      assert.ok(v.row(lost, 120).includes(`${red}R#2`)); for (const out of views(lost)) assert.ok(out.includes(`${red}3/5`) && !out.includes(green), "merged on a fail: the last one red, the pass before it quiet");
      for (const out of [v.row({ ...twice, state: pr.state, stage: pr.stage, kind: pr.kind, prMerged: false }, 120), ...views({ ...twice, state: pr.state, stage: pr.stage, kind: pr.kind, prMerged: false })]) assert.ok(out.includes(green), "not merged: its colours as they were");
    }
    // whatever the state, the title is plain text
    for (const r of [pr, working, { ...working, state: "error", stage: "failed" }, { ...working, state: "done" }, { ...working, state: "idle" }]) assert.match(v.row(r, 120), /^ \S+ \S+#\d+\S+ (\x1b\[1m)?[A-Z]/);
    // while the reviewer works, the mark, the bar, the percent, the minutes left and the R# tag are blue: never the
    // green of "ready to approve" and of a review that passed, never the agent's amber
    const blue = theme.fg("review", "\0").split("\0")[0], reviewed = v.row({ ...working, stage: "reviewing", reviewRound: 1, eta: 12 }, 120);
    assert.notEqual(blue, green); assert.notEqual(blue, yellow); assert.notEqual(blue, theme.fg("teal", "\0").split("\0")[0]); assert.notEqual(blue, theme.fg("subtext0", "\0").split("\0")[0]);
    assert.ok(reviewed.includes(`${blue}◑`) && !reviewed.includes("◐") && reviewed.includes(`${blue}50%`) && reviewed.includes(`${blue}12m`) && reviewed.includes(`${blue}█`) && reviewed.includes(`${blue}R#1`) && !reviewed.includes(green) && !reviewed.includes(yellow) && !reviewed.includes(mauve));
    // the review over: its tag is green when it passed and red when it failed, and stays red while the agent fixes it
    assert.ok(v.row({ ...pr, review: { ...review, recommend: true } }, 120).includes(`${green}R#1`) && v.row(pr, 120).includes(`${red}R#1`) && !v.row(pr, 120).includes(blue));
    { const fixing = v.row({ ...working, reviewRound: 1, review: { ...review, stale: true } }, 120); assert.ok(fixing.includes(`${red}R#1`) && fixing.includes(`${yellow}◐`) && !fixing.includes("◑") && !fixing.includes(blue)); }
    const plainWork = v.row(working, 120);
    assert.ok(plainWork.includes(`${yellow}◐`) && !plainWork.includes(green) && !plainWork.includes(mauve));
  }
  assert.match(row(base, 120), /^[ ▌]◆ #\d+ Build a flying game +0s ago\n[ ▌] {5}Not reviewed$/); // no reviewer: the second line says so, instead of standing empty
  assert.match(row({ ...pr, review: { ...review, stale: true } }, 120), /^[ ▌]◆ #\d+ Build a flying game +R#1 PR#12 {2}0s ago\n[ ▌] {5}The work changed since its review$/);
  // which review it is on: the R# tag, never in words
  const second = { ...pr, reviewRound: 2 };
  assert.doesNotMatch(row({ ...pr, reviewRound: 1 }, 120), /review\b.*review|r1|1st/); assert.match(row({ ...pr, reviewRound: 1 }, 120), / R#1 PR#12 /);
  assert.match(row(second, 120), /^[ ▌]! #\d+ Build a flying game +R#2 PR#12 {2}0s ago\n[ ▌] {5}Review failed · 3\/5, reviewer says no$/);
  assert.match(row({ ...pr, reviewRound: 3 }, 120), / R#3 PR#12 {2}0s ago\n[ ▌] {5}Review failed · 3\/5, reviewer says no$/);
  // narrower, the verdict has its own line, so it stays whole while the columns beside the name go; only a window
  // narrower than the verdict itself cuts it, at its end
  assert.match(row(second, 48), /^[ ▌]! #\d+ Build a flying game +R#2 PR#12 {2}0s ago\n[ ▌] {5}Review failed · 3\/5, reviewer says no$/);
  assert.match(row(second, 35), /^[ ▌]! #\d+ Build a flying game +0s ago\n[ ▌] {5}Review failed · 3\/5, reviewe…$/);
  assert.match(row(pr, 27), /^[ ▌]! #\d+ Build a flying game *\n[ ▌] {5}Review failed · 3\/5,…$/);
  assert.match(row(pr, 20), /^[ ▌]! Build a flying g…\n[ ▌] {2}Review failed · …$/); // too narrow for the task's number too: it went, and the name has its cells
  // a failed merge needs you: it says why, and the panel still has the score and which review gave it
  const failedMerge = { ...second, mergeFailed: true, review: { ...review, recommend: true, score: 5 }, msg: "The merge failed: conflict in src/game.js" };
  assert.match(row(failedMerge, 120), /^[ ▌]! #\d+ Build a flying game +R#2 PR#12 {2}0s ago\n[ ▌] {5}The merge failed: conflict in src\/game\.js$/);
  assert.match(page(failedMerge), /\n State {8}! needs you · 2nd review · 0s ago\n On it {8}claude\n/); assert.match(page(failedMerge), /\n Review ─+\n Review 2 {5}✓ 5\/5, says merge\n[ ▌] {13}Crashes\.\n/);
  // behind main and not brought up to date yet: neither the row nor the panel say it is ready
  const behind = { ...pr, summary: "Did the work.", syncBlocked: { why: "main could not be fetched (network is down)" }, msg: "Behind main, and not up to date yet: main could not be fetched (network is down). The board keeps trying; it cannot be approved until then." };
  assert.match(row(behind, 120), /^[ ▌]! #\d+ Build a flying game [^\n]*\n[ ▌] {5}Behind main, and not up to date yet/);
  assert.match(page(behind), /\n Behind main ─+\n Cannot be approved yet: main could not be fetched \(network is down\)\. The board\n keeps trying/); assert.doesNotMatch(page(behind), /ready to approve/);
  // the panel, in the order you need it: where it stands and the change, each a fact of its own, the review, what the agent said, the settings
  const ready = page({ ...second, summary: "Did the work.", said: "Built Skylark.", stat: " 4 files changed, 120 insertions(+), 31 deletions(-)" });
  // (Its review says no: it is not "ready", it says so under a headline of its own with what the two keys do, and its id is not a fact here.)
  assert.match(ready, keyed(/^\n #\d+ Build a flying game\n\n Status ─+\n State {8}! review failed · 2nd review · 0s ago\n On it {8}claude\n Change {7}PR#12 · 4 files, \+120 −31\n\n Review failed ─+\n It found 3\/5, reviewer says no\. {sendBack} sends the review to the agent to fix\.\n {yes} merges it anyway, and asks first\.\n\n Review ─+\n Review 2 {5}✗ 3\/5, says don't merge\n[ ▌] {13}Crashes\.\n\n The agent said ─+\n Built Skylark\.\n\n Settings ─+\n Project /));
  assert.match(ready, /\n Send back {4}major or worse · 3 rounds max\n Merge {8}after your yes\n Also {9}one attempt · not research only · no limits · no fallback$/); assert.doesNotMatch(ready, /as usual|https:|shows the whole task|ready to approve|proj\/1/); // beside the list every setting it runs with; the link is in the PR's number
  assert.match(page({ ...second, stat: " 4 files changed, 120 insertions(+), 31 deletions(-)" }, true), /\n Change {7}PR#12 · 4 files, \+120 −31\n[ ▌] {13}https:\/\/github\.com\/a\/b\/pull\/12\n/); // full screen it is printed too
  assert.doesNotMatch(ready, /Description|None\./);
  // Every review the task had: how many, how each went, and the latest under its own name, on both shapes of the panel.
  const spiral = { ...second, reviewRound: 3, review: { score: 4, recommend: true, text: "Fine now.", stale: false }, reviews: [
    { round: 1, at: Date.now() - 7200000, score: 2, recommend: false, text: "Crashes on start.", problems: ["game.js: null plane."], checks: ["Ran it."], limitations: [], head: "1111111aaaa" },
    { round: 2, at: Date.now() - 3600000, error: "the reviewer finished without a verdict" },
    { round: 3, at: Date.now() - 60000, score: 4, recommend: true, text: "Fine now.", problems: [], checks: ["Ran the tests: all pass."], limitations: ["Not tried on a phone."], head: "abcdef12345" }] };
  assert.match(page(spiral), /\n Reviews · 3 ─+\n History {6}2\/5 no → no verdict → 4\/5 yes\n Review 3 {5}✓ 4\/5, says merge · 1m ago\n[ ▌] {13}Fine now\.\n/);
  assert.doesNotMatch(page(spiral), /Crashes on start|the newest first|Review [12] /); assert.match(page(spiral), keyed(/\n\n {panel} shows the whole task$/)); // beside the list: only the latest, and where the rest is
  const whole = page(spiral, true);
  assert.match(whole, /\n Reviews · 3 ─+\n History {6}2\/5 no → no verdict → 4\/5 yes\n\n Review 3 {5}✓ 4\/5, says merge · 1m ago · at abcdef1\n[ ▌] {13}Fine now\.\n Checked {6}• Ran the tests: all pass\.\n Unverified {3}• Not tried on a phone\.\n\n Review 2 {5}– No verdict · 1h ago\n[ ▌] {13}the reviewer finished without a verdict\n\n Review 1 {5}✗ 2\/5, says don't merge · 2h ago · at 1111111\n[ ▌] {13}Crashes on start\.\n Problems {5}• game\.js: null plane\.\n Checked {6}• Ran it\.\n/);
  assert.ok(whole.indexOf("◆ ready to approve") < whole.indexOf("Reviews · 3 ") && whole.indexOf("\n Review 3 ") < whole.indexOf("\n Review 1 ") && whole.indexOf("\n Review 1 ") < whole.indexOf("\n Settings ") && whole.indexOf("\n Settings ") < whole.indexOf("\n Merge ")); // where it stands, every review, then the settings
  // a narrow full screen drops nothing of a review: a label is a line of its own there, and its value is under it
  { const thin = stripVTControlCharacters(v.panel({ owner: "me", ...spiral }, 24, true).join("\n"));
    assert.match(thin, /\n Review 3\n[ ▌] {2}✓ 4\/5, says merge\n[ ▌] {2}1m ago · at abcdef1\n[ ▌] {2}Fine now\.\n Checked\n[ ▌] {2}• Ran the tests: all\n[ ▌] {4}pass\.\n/); assert.match(thin, /\n Review 2\n[ ▌] {2}– No verdict\n[ ▌] {2}1h ago\n/); assert.match(thin, /\n Review 1\n[ ▌] {2}✗ 2\/5, says don't\n[ ▌] {2}merge\n[ ▌] {2}2h ago · at 1111111\n/);
    assert.ok(thin.split("\n").every((l) => l.length <= 24 && !l.endsWith("…")), "nothing runs over, nothing is cut"); }
  // a side panel too short for the settings still has where the task stands and the latest review, as its one row;
  // with no room for both, the change goes before the review's row
  { const at = (fit) => v.panel({ owner: "me", ...spiral, worktree: "", description: "Long. ".repeat(200) }, 46, false, fit).map((l) => stripVTControlCharacters(l));
    assert.deepEqual(at(12), [" #1 Build a flying game", "", " Status ─────────────────────────────────────", " State        ◆ ready to approve · 3rd review", "              0s ago", " On it        claude", " Change       PR#12", "", " Reviews · 3 ────────────────────────────────", " Review 3     ✓ 4/5, says merge · 1m ago", "              Fine now.", " alt+t shows the whole task"]);
    assert.deepEqual(at(8), [" #1 Build a flying game", " Status ─────────────────────────────────────", " State        ◆ ready to approve · 3rd review", "              0s ago", " Change       PR#12", " Review 3     ✓ 4/5, says merge", "", " alt+t shows the whole task"]);
    assert.deepEqual(at(4), [" #1 Build a flying game", " State        ◆ ready to approve · 3rd review", "              0s ago", " alt+t shows the whole task"]); }
  // many reviews in a narrow panel: the history is wrapped, and every one of them is there
  const many = { ...spiral, reviews: Array.from({ length: 12 }, (_, n) => ({ round: n + 1, score: 2, recommend: false, text: "Still broken." })) };
  assert.match(stripVTControlCharacters(v.panel({ owner: "me", ...many }, 44, false).join("\n")), /\n Reviews · 12 ─+\n History {6}2\/5 no → 2\/5 no → 2\/5 no\n[ ▌] {13}→ 2\/5 no → 2\/5 no → 2\/5 no\n[ ▌] {13}→ 2\/5 no → 2\/5 no → 2\/5 no\n[ ▌] {13}→ 2\/5 no → 2\/5 no → 2\/5 no\n Review 12 {4}✗ 2\/5, says don't merge\n/);
  const busy = { ...spiral, title: "Build a flying game with a very long name that wraps onto two lines", state: "working", kind: undefined, stage: "working", progress: 40, eta: 12, msg: "Running the whole test suite again after the last fix", said: "Working on it.", description: "Long. ".repeat(200), usage: { in: 1000, out: 2000, context: 5000, window: 200000 }, link: { pane: "p1", workspace: "w1" } };
  // a short window: the settings outlast every text. What the agent said and the review's summary give way first,
  // then the description (cut, then one line that says where to read it, then gone), and only then a setting: the
  // ones that say who works and who reviews stay longest, with a line that counts the rest. With no room for a
  // single setting the review has its summary again. Where the task stands and what it is doing now stay whole at
  // every height, wrapped and never cut
  const SETTINGS = ["Agent", "Plan first", "Reviewer", "Review when", "Send back", "Merge", "Also"];
  const STATE = " State        ◐ working · for 0s", PROGRESS = " Progress     ██████░░░░░░░░░ 40% · 12m left", NOW = [" Now          Running the whole test suite", "              again after the last fix"];
  for (const fit of [40, 30, 24, 20, 16, 12, 8, 6]) {
    const lines = v.panel({ owner: "me", ...busy }, 45, false, fit).map((l) => stripVTControlCharacters(l));
    assert.ok(lines.length <= fit, `fits in ${fit} lines`);
    const at = lines.indexOf(STATE);
    assert.deepEqual(lines.slice(at + 1, at + 4), [PROGRESS, ...NOW], `the status and what it is doing, whole, with room for ${fit} lines`);
    const kept = SETTINGS.filter((fact) => lines.some((l) => l.startsWith(` ${fact} `)));
    const more = lines.find((l) => /more settings? · ctrl\+e shows/.test(l));
    assert.deepEqual(kept, fit >= 30 ? SETTINGS : fit === 24 ? ["Agent", "Plan first", "Reviewer", "Review when", "Send back", "Merge"] : fit === 20 ? ["Agent", "Reviewer"] : [], `the settings with room for ${fit} lines`);
    assert.equal(more, fit === 24 ? " 7 more settings · ctrl+e shows them" : fit === 20 ? " 13 more settings · ctrl+e shows them" : undefined, `how many settings have no room, with room for ${fit} lines`);
    assert.equal(lines.includes(" Settings ──────────────────────────────────"), kept.length > 0, "the settings keep their headline while one of them is there");
    assert.equal(lines.includes(" Description ───────────────────────────────"), fit >= 40, `the description with room for ${fit} lines`);
    assert.equal(lines.includes(" Description · alt+t shows it"), fit === 30, `one line for the description with room for ${fit} lines`);
    assert.ok(!lines.some((l) => l.startsWith(" The agent said")), "what the agent said gives way before a setting does");
    assert.equal(lines.some((l) => l.startsWith(" Review 3     ✓ 4/5, says merge")), fit > 6, `the latest review with room for ${fit} lines`);
    assert.equal(lines.includes("              Fine now."), fit === 16, `the review's summary with room for ${fit} lines`);
    assert.equal(lines.includes(" Status ────────────────────────────────────"), fit >= 12, `the headline with room for ${fit} lines`);
    assert.equal(lines.some((l) => l.startsWith(" #1 Build a flying game")), fit >= 6, `the title with room for ${fit} lines`);
    assert.ok(!lines.some((l) => /^[ ▌] {13}/.test(l) && l.endsWith("…")) && !lines.some((l) => SETTINGS.some((k) => l.startsWith(` ${k} `)) && l.endsWith("…")), "no fact is cut with an ellipsis");
    assert.match(lines[lines.length - 1], keyed(/^ {panel} shows the whole task$/));
  }
  // shorter than the status and that text with the last line: the last line goes, not a word of the text; then the
  // progress, then the state; only a text longer than the panel is cut, and says so
  { const at = (fit) => v.panel({ owner: "me", ...busy }, 45, false, fit).map((l) => stripVTControlCharacters(l));
    assert.deepEqual(at(5), [STATE, PROGRESS, ...NOW, " alt+t shows the whole task"]); assert.deepEqual(at(4), [STATE, PROGRESS, ...NOW]);
    assert.deepEqual(at(3), [STATE, ...NOW]); assert.deepEqual(at(2), NOW);
    assert.deepEqual(at(1), [" Now          Running the whole test suite …"]); }
  // a long line of what it is doing is wrapped between words over as many lines as it takes, under itself beside its
  // label, in a narrow panel too (there the label is a line of its own); shorter than that, the title goes and the
  // state and that text are all there is
  { const long = { ...busy, msg: "Found cause: second device resizing board; now checking every caller of the resize handler for the same mistake" };
    for (const [width, fit] of [[45, 30], [30, 30], [30, 10], [20, 0]]) {
      const lines = v.panel({ owner: "me", ...long }, width, false, fit).map((l) => stripVTControlCharacters(l));
      const from = lines.findIndex((l) => l.startsWith(" Now")), next = lines.findIndex((l, n) => n > from && /^ \S/.test(l) || (n > from && l === "")), now = lines.slice(from, next < 0 ? lines.length : next);
      assert.ok(now.length > 2 && lines.every((l) => l.length <= width), `wrapped inside ${width} columns`);
      assert.equal(now.map((l) => l.replace(/^ Now/, "").trim()).filter(Boolean).join(" "), long.msg, `nothing cut at ${width} columns in ${fit} lines`);
      assert.ok(lines.some((l) => l.includes("◐ working")), `the state at ${width} columns in ${fit} lines`);
      if (fit === 10) assert.ok(lines.length <= fit && !lines.some((l) => l.startsWith(" Build") || l.startsWith(" Project")));
    } }
  assert.match(stripVTControlCharacters(v.panel({ owner: "me", ...busy }, 45, false, 30).join("\n")), /\n Status ─+\n State {8}◐ working · for 0s\n Progress {5}█+░+ 40% · 12m left\n Now {10}Running the whole test suite\n[ ▌] {13}again after the last fix\n/); // with room, what it is doing is there, a fact under Status
  if (!process.env.NO_COLOR) {
    // what a row says is greyed out, never bold like its title: in the brighter of the two greys, since it has to be
    // read; what a task asks of you is in the plain text colour
    const grey = ink("subtext0"), faint = ink("overlay0"), textInk = ink("text");
    assert.ok(v.rowLines(working, 120)[1].includes(`${grey}A long sentence about what the other agent`), "a working row's status line is the brighter grey");
    assert.ok(!v.rowLines(working, 120)[1].includes(faint), "not the faint one, which is for what may be missed");
    assert.ok(v.rowLines({ ...working, state: "blocked", kind: "question", stage: "asks", msg: "Which colour?" }, 120)[1].includes(`${textInk}Which colour?`), "a question to you is in the text colour");
    assert.ok(!v.row(working, 120).includes(`${grey}Other`), "the title is not");
  }
  assert.match(row({ ...second, stage: "merging", state: "working", kind: undefined, msg: "merging" }, 120), /^[ ▌]◒ #\d+ Build a flying game +R#2 PR#12 {2}0s\n[ ▌] {5}merging$/);
  // the board's own steps share one mark of their own, in the row and on the State line: neither the agent's nor the reviewer's
  for (const stage of ["starting", "setup", "checking", "pushing", "merging"]) { assert.match(row({ ...working, stage, msg: "x" }, 120), /^[ ▌]◒ #\d+ Other /, stage); assert.match(page({ ...working, stage, msg: "x" }), /\n State {8}◒ working /, stage); }
  // a task that only waits keeps the plain working mark: for a free slot, or the reviewer cut off and waiting to try again
  assert.match(row({ ...working, stage: "queued", msg: "x" }, 120), /^[ ▌]◐ #\d+ Other /); assert.match(page({ ...working, stage: "queued", msg: "x" }), /\n State {8}◐ working /);
  assert.match(row({ ...working, stage: "merging", lineAt: 1, msg: "Waiting to merge: proj/1 goes first" }, 120), /^[ ▌]◐ #\d+ Other /); // in the line to merge
  { const cut = { ...working, stage: "reviewing", reviewRound: 1, waiting: { who: "reviewer", reason: "model is at capacity", until: Date.now() + 120000, tries: 1 } }; assert.match(row(cut, 120), /^[ ▌]◐ #\d+ Other /); assert.match(page(cut), /\n State {8}◐ reviewer was cut off/); }
  assert.match(row({ ...working, stage: "merging", state: "error" }, 120), /^[ ▌]✗ #\d+ Other /); // a step that failed is no step at work
  assert.doesNotMatch(row({ ...second, state: "done", stage: "done" }, 120), /review|3\/5/);
  // while the reviewer works the row's sentence is only what the reviewer is doing
  const under = { ...working, stage: "reviewing", reviewRound: 3, msg: "Running the tests." };
  assert.match(row(under, 120), /^[ ▌]◑ #\d+ Other +█+░+ +50% {2}R#3 +0s\n[ ▌] {5}Running the tests\.$/); // no word "review", whichever review it is: the mark and the colour say it
  assert.match(row({ ...under, reviewRound: 1 }, 120), /^[ ▌]◑ #\d+ Other [^\n]*\n[ ▌] {5}Running the tests\.$/);
  assert.match(row({ ...under, reviewRound: 1, msg: "Under review", plain: true }, 120), /^[ ▌]◑ #\d+ Other +█[^\n]*\n[ ▌] {5}Under review$/); // only the plain word to say: it says that, never an empty line or a bare "…"
  assert.match(row(under, 30), /^[ ▌]◑ #\d+ Other +50% {2}R#3 +0s\n[ ▌] {5}Running the tests\.$/);
  assert.match(row({ ...under, stage: "reviewneeds", state: "blocked", progress: undefined, msg: "The reviewer shows a dialog" }, 120), /^[ ▌]! #\d+ Other +R#3 {2}0s ago\n[ ▌] {5}The reviewer shows a dialog$/);
  assert.doesNotMatch(row({ ...working, reviewRound: 3 }, 120), /review|◑/); assert.match(row({ ...working, reviewRound: 3 }, 120), /^[ ▌]◐ #\d+ Other /); // back with the agent: no review is running
  assert.match(page(under), /\n State {8}◑ reviewer is working · 3rd review · for 0s\n Progress {5}█+░+ 50%\n Now {10}Running the tests\.\n/);
  // the same blue everywhere the reviewer's work is drawn: the panel beside the list, the details page, the chat line
  {
    const paint = { ...theme, fg: (c, s) => `<${c}>${s}</>` }, cv = Object.create(View.prototype); Object.assign(cv, v, { theme: paint });
    for (const full of [false, true]) { const p = cv.panel({ owner: "me", ...under, progress: 50, eta: 12 }, 80, full).join("\n"); assert.match(p, /<review>◑<\/>/); assert.doesNotMatch(p, /◐/); assert.match(p, /<review>[^<]*reviewer is working/); assert.match(p, /<review>[^<]*3rd review/); assert.match(p, /<review>[█░]/); assert.doesNotMatch(p, /<(green|yellow)>/, "neither the green of passed nor the agent's amber"); }
    assert.match(cv.panel({ owner: "me", ...working }, 80, false).join("\n"), /<yellow>◐<\/>/); // the agent at work stays amber
    cv.reply = true; cv.replyId = under.id; assert.match(cv.chatLines(80, under).join("\n"), /<review>◑<\/>/); assert.doesNotMatch(cv.chatLines(80, under).join("\n"), /<(green|yellow)>/);
  }
  // another row's long sentence or progress does not take the verdict away
  assert.match(row(pr, 80, [pr, working]), /^[ ▌]! #\d+ Build a flying game +R#1 PR#12 {2}0s ago\n[ ▌] {5}Review failed · 3\/5, reviewer says no$/);
  for (const width of [27, 30, 40, 60, 80, 120]) for (const r of [pr, plain, base]) {
    const line = row(r, width, [r, working]);
    assert.ok(line.split("\n").every((l) => l.length <= width), `fits ${width}`); assert.ok(!/Skylark|\*\*|Reviewed|approve to merge/.test(line)); assert.match(line, /^ \S #\d+ Build a flying game/);
  }
  // a review judged by the gate: the result and a short tally in place of a score, in the row, the facts and the history
  const tagged = { meets: true, gate: "major", pass: true, text: "Works.", findings: [{ id: "F1", severity: "minor", subject: "A name is unclear", where: "game.js", proof: "" }, { id: "F2", severity: "minor", subject: "A comment is stale", where: "sky.js", proof: "" }] };
  const failing = { meets: false, gate: "major", pass: false, text: "No fix.", left: 1, findings: [{ id: "F1", severity: "critical", subject: "The plane never takes off", where: "game.js", proof: "ran it" }, { id: "F2", severity: "major", subject: "Crashes without a sky", where: "sky.js", proof: "ran it" }, { id: "F3", severity: "minor", subject: "A name is unclear", where: "game.js", proof: "" }, { id: "F4", severity: "major", subject: "The old menu flickers", where: "menu.js", proof: "", preexisting: true, task: "proj/7" }] };
  const gated = { ...pr, msg: "Approve to merge? Review: Pass · 2 minor. Built **Skylark**.", review: tagged };
  assert.match(row(gated, 120), /^[ ▌]◆ #\d+ Build a flying game +R#1 PR#12 {2}0s ago\n[ ▌] {5}Pass · 2 minor$/);
  assert.match(row({ ...gated, review: failing }, 120), /^[ ▌]! #\d+ Build a flying game +R#1 PR#12 {2}0s ago\n[ ▌] {5}Review failed · 1 critical, 1 major, 1 minor, 1 pre-existing$/); // not ready: it says so, with the "!" of your call
  assert.equal(groupOf({ ...gated, review: failing }), "needs you"); assert.equal(standing({ ...gated, review: failing }), "review failed"); assert.equal(groupOf(gated), "ready to approve");
  assert.match(row({ ...gated, reviewRound: 2 }, 120), / R#2 PR#12 [^\n]*\n[ ▌] {5}Pass · 2 minor$/); assert.match(row({ ...gated, review: { ...tagged, findings: [] } }, 120), / R#1 PR#12 [^\n]*\n[ ▌] {5}Pass$/);
  assert.match(row({ ...gated, reviewRound: 2 }, 50), /^[ ▌]◆ #\d+ Build a flying game +R#2 PR#12 {2}0s ago\n[ ▌] {5}Pass · 2 minor$/);
  assert.match(row({ ...gated, reviewRound: 2 }, 35), /^[ ▌]◆ #\d+ Build a flying game +0s ago\n[ ▌] {5}Pass · 2 minor$/); // whole on its own line, whatever the columns beside the name give up
  assert.match(row({ ...gated, review: failing }, 33), /\n[ ▌] {5}Review failed · 1 critical…$/); // longer than the window: cut at its end
  // the R# tag: its own column left of the PR's, on every row that has had a review, and its colour alone says how the review went: no mark beside it
  {
    const paint = { ...theme, fg: (c, s) => `<${c}>${s}</>` }, cv = Object.create(View.prototype); Object.assign(cv, v, { theme: paint });
    const tag = (r) => { const s = cv.row(r, 120, cv.rowLayout([r], 120)), m = /<(\w+)>(R#\d+)<\/>/.exec(s); assert.doesNotMatch(s, /(?<!P)R#\d+<\/> +<\w+>[✓✗×]/, "no mark beside the tag"); return m ? `${m[1]} ${m[2]}` : ""; };
    assert.equal(tag(gated), "green R#1"); assert.equal(tag({ ...gated, review: failing, reviewRound: 2 }), "red R#2");
    assert.equal(tag(pr), "red R#1"); assert.equal(tag({ ...pr, review: { ...review, recommend: true } }), "green R#1"); // before the gate: by its advice
    // back with the agent to fix what the review found: the verdict is stale, the tag stays red
    const fixing = { ...working, pr: 12, reviewRound: 2, review: { ...failing, stale: true } };
    assert.equal(tag(fixing), "red R#2"); assert.match(top(fixing, 120), /50% {2}R#2 PR#12 +0s$/);
    assert.equal(tag({ ...fixing, stage: "reviewing", reviewRound: 3 }), "review R#3"); // the next review runs: blue, whatever the last one said
    assert.equal(tag({ ...fixing, reviews: [{ round: 1, pass: true, meets: true, findings: [] }, { round: 2, error: "no verdict" }], review: undefined }), "red R#2"); // ended with no verdict: it failed
    assert.equal(tag({ ...gated, state: "done", stage: "done", reviewRound: 3 }), "overlay0 R#3"); // done rows keep it, quietly: merged, with or without a pull request
    // cut off by its provider and waiting to start again: still that review, the counter put back for the wait
    const cut = { who: "reviewer", reason: "capacity", error: "at capacity", until: Date.now() + 60000, tries: 1 };
    assert.equal(tag({ ...working, stage: "reviewing", reviewRound: 0, waiting: cut }), "review R#1"); assert.match(top({ ...working, stage: "reviewing", reviewRound: 0, waiting: cut }, 120), / R#1 +0s$/);
    assert.equal(tag({ ...fixing, stage: "reviewing", reviewRound: 2, waiting: cut }), "review R#3"); // after two reviews: the third, not the second again
    assert.equal(tag({ ...working, reviewRound: 0, waiting: { ...cut, who: "agent" } }), ""); // an agent cut off before any review: nothing
    assert.equal(tag(working), ""); assert.equal(tag(base), ""); assert.doesNotMatch(row(working, 120), /R#/); // never reviewed: nothing
    // the tags end under each other, where the pull request starts, and a row with none leaves the column blank
    const ten = { ...gated, id: "proj/8", reviewRound: 10 }, brief = { ...fixing, msg: "Fixing it." }, both = [gated, ten, brief, working];
    assert.equal(row(gated, 120, both).indexOf("R#1 "), row(ten, 120, both).indexOf("R#10") + 1); assert.equal(row(gated, 120, both).indexOf("PR#12"), row(ten, 120, both).indexOf("PR#12"));
    assert.equal(row(brief, 120, both).indexOf("R#2"), row(ten, 120, both).indexOf("R#10") + 1); assert.match(top({ ...working, msg: "Busy." }, 120, both), /50% {14}0s {4}$/);
    // the tag belongs to the pull request, not to the progress: one cell before the PR, whatever its colour,
    // and the wider gap left of it, after the minutes left
    const running = { ...brief, id: "proj/9", stage: "reviewing", reviewRound: 3, eta: 2 }, list = [...both, running];
    assert.match(top(running, 120, list), /50% 2m left {3}R#3 PR#12 {2}0s {4}$/); assert.match(top(ten, 120, list), / {2}R#10 PR#12 {2}0s ago$/);
    assert.match(top({ ...running, pr: undefined }, 120, list), /50% 2m left {3}R#3 {8}0s {4}$/); assert.match(top({ ...running, reviewRound: 0, stage: "working", review: undefined }, 120, list), /50% 2m left {7}PR#12 {2}0s {4}$/);
    assert.equal(row(running, 120, list).indexOf("PR#12"), row(ten, 120, list).indexOf("PR#12"));
    // narrow: the tag goes after the percent, together with the PR number, and the title stays whole
    const long = { ...fixing, title: "Fix login" };
    assert.match(top(long, 36), /^[ ▌]◐ #\d+ Fix login +50% {2}R#2 PR#12 +0s$/); assert.match(top(long, 35), /^[ ▌]◐ #\d+ Fix login +R#2 PR#12 +0s$/); assert.match(top(long, 30), /^[ ▌]◐ #\d+ Fix login +R#2 PR#12 +0s$/);
    assert.match(top(long, 29), /^[ ▌]◐ #\d+ Fix login +0s$/); assert.match(top(long, 23), /^[ ▌]◐ #\d+ Fix login +0s$/); // never a tag with no PR beside it, nor a PR that lost its tag
  }
  { const paint = { ...theme, fg: (c, s) => `<${c}>${s}</>` }, cv = Object.create(View.prototype); Object.assign(cv, v, { theme: paint }); assert.ok(cv.rowLines(gated, 160)[1].includes("<green>Pass</>")); assert.ok(cv.rowLines({ ...gated, review: failing }, 160)[1].includes("<red>Review failed</>")); } // 160: this paint's tags take cells
  const loop = { ...gated, reviewRound: 3, reviews: [{ round: 1, at: Date.now() - 7200000, ...failing, head: "1111111aaaa" }, { round: 2, at: Date.now() - 3600000, score: 4, recommend: true, text: "An old one.", problems: ["game.js: old."] }, { round: 3, at: Date.now() - 60000, ...tagged, head: "abcdef12345" }] };
  assert.match(page(loop), /\n Reviews · 3 ─+\n History {6}fail → 4\/5 yes → pass\n Review 3 {5}✓ Pass · 2 minor · 1m ago\n[ ▌] {13}Works\.\n/); assert.doesNotMatch(page(loop), /Skylark[^\n]*Review:|Review: Pass/); // the board's own words about the review are not said twice
  assert.match(page(loop, true), /\n Review 3 {5}✓ Pass · 2 minor · 1m ago · at abcdef1\n[ ▌] {13}Works\.\n Findings {5}minor {5}A name is unclear \(game\.js\) · not required\n[ ▌] {13}minor {5}A comment is stale \(sky\.js\) · not required\n\n Review 2 {5}✓ 4\/5, says merge · 1h ago\n[ ▌] {13}An old one\.\n Problems {5}• game\.js: old\.\n\n Review 1 {5}✗ Fail · 1 critical, 1 major, 1 minor, 1 pre-existing · 2h ago\n[ ▌] {13}at 1111111\n[ ▌] {13}No fix\.\n Findings {5}critical {2}The plane never takes off \(game\.js\)\n[ ▌] {13}major {5}Crashes without a sky \(sky\.js\)\n[ ▌] {13}minor {5}A name is unclear \(game\.js\) · not required\n[ ▌] {13}major {5}The old menu flickers \(menu\.js\) · pre-existing, task\n[ ▌] {23}proj\/7\n[ ▌] {13}1 smaller finding noticed late, left out\n/);
  // a review that still stood after main was merged in says so under its result, and the task is still on that review
  const stood = { ...loop, reviews: loop.reviews.map((e) => (e.round === 3 ? { ...e, kept: [{ at: Date.now() - 3600000, check: "npm test", resolved: [] }, { at: Date.now() - 30000, check: "npm test", resolved: ["game.js"] }] } : e)) };
  assert.match(page(stood), /\n Review 3 {5}✓ Pass · 2 minor · 1m ago\n[ ▌] {13}Re-merged with main \(conflicts resolved in 1 file\), tests pass,\n[ ▌] {13}review 3 still stands · 30s ago · 2 times\n[ ▌] {13}Works\.\n/);
  assert.match(row(stood, 120), / R#3 PR#12 [^\n]*\n[ ▌] {5}Pass · 2 minor$/);
  // what a row needs from you is under its name, whole: it never costs the row a column, and is cut only at the window's edge
  const stuck = { ...working, state: "blocked", kind: "question", stage: "asks", title: "Build a flying game", msg: "Which colour should the plane be?" };
  assert.match(row(stuck, 75), /^[ ▌]\? #\d+ Build a flying game +█+░+ +50% +0s ago\n[ ▌] {5}Which colour should the plane be\?$/); assert.match(row(stuck, 31), /\n[ ▌] {5}Which colour should the …$/); assert.match(row(stuck, 120), /█+░+ +50% +0s ago\n[^\n]*be\?$/);
  // rows that need you say what blocks them, under the name and without Markdown marks; with nothing said, in plain words
  const ask = "Which colour should the plane be, and should the **islands** have `palm` trees?";
  for (const r of [{ ...base, stage: "", kind: "question", msg: ask }, { ...base, mergeFailed: true, msg: ask }, { ...base, state: "error", kind: "", stage: "failed", msg: ask }])
    assert.match(row(r, 120), /^ \S #\d+ Build a flying game +0s ago\n[ ▌] {5}Which colour should the plane be, and should the islands have palm trees\?$/);
  assert.match(row({ ...base, stage: "asks", kind: "question", msg: "" }, 120), / +0s ago\n[ ▌] {5}Has a question$/);
  assert.match(row({ ...base, stage: "asks", kind: undefined, msg: "needs you" }, 120), /^[ ▌]! #\d+ Build a flying game +0s ago\n[ ▌] {5}Needs you$/); // nothing of its own to say: the plain words, never an empty line
});
