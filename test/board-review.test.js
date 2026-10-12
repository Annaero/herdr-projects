// Reviews as the board shows them: on a row and in the task panel.
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";

test("the board: a row waiting for approval says the reviewer's advice in words, with the PR and its checks on the right", () => {
  const v = Object.create(View.prototype); v.theme = theme; v.scope = ""; v.screens = new Map(); v.repo = { root: "/nowhere", name: "proj" };
  const row = (r, width, list = [r]) => stripVTControlCharacters(v.row(r, width, v.rowLayout(list, width)));
  const page = (r, full = false) => stripVTControlCharacters(v.panel({ owner: "me", ...r }, 80, full).join("\n"));
  const base = { id: "proj/1", title: "Build a flying game", state: "blocked", kind: "permission", stage: "approval", agent: "claude", app: "claude", at: Date.now(), msg: "Approve to merge? Reviewed 3/5, says don't merge. Built **Skylark**: a little plane over endless sunny islands, with clouds." };
  const review = { score: 3, recommend: false, text: "Crashes." };
  const pr = { ...base, pr: "https://github.com/a/b/pull/12", prState: "passing", review }, plain = { ...base, review };
  const working = { id: "proj/2", title: "Other", state: "working", agent: "claude", stage: "work", progress: 50, msg: "A long sentence about what the other agent is doing right now, in detail.", at: Date.now() };
  // wide: the name, the score with the advice in words and, on the right, the PR with a mark for its checks. The row
  // does not repeat its heading ("approve to merge?" on every row), and there is no r1 marker.
  assert.match(row(pr, 120), /^ ✓ Build a flying game {2}3\/5 reviewer says no +PR#12 ✓ {2}0s ago$/);
  assert.match(row({ ...pr, prState: "" }, 120), / PR#12 {2}0s ago$/);
  // failed checks are not ready to approve: the row needs you, says why, and offers no "approve and merge"
  const redPr = { ...pr, prState: "failing", prFailure: { stage: "pr", title: "Pull request checks failed", detail: "test: failure", agentCanFix: true, next: "Fix the checks." } };
  assert.match(row(redPr, 120), /^ × Build a flying game {2}Pull request checks failed +PR#12 ✗ {2}0s ago$/);
  assert.match(row({ ...pr, prState: "failing" }, 120), /^ × Build a flying game {2}the pull request's checks fail +PR#12 ✗ {2}0s ago$/);
  assert.match(page(redPr), /× needs you · claude · 0s ago · proj\/1\n PR#12 ✗\n\n ▎ Pull request checks failed\n ▎ The agent can fix this: ctrl\+r sends it\.\n ▎ ?\n ▎ Next step\n ▎ Fix the checks\./); assert.doesNotMatch(page(redPr), /ready to approve/);
  v.reply = false; v.full = false; v.menu = null; v.ask = null; v.mode = "new"; v.chatOpen = true; v.input = { getText: () => "" }; v.jobs = []; v.sel = "";
  assert.deepEqual(v.hints(redPr).map(([k]) => k), ["ctrl+r", "ctrl+a", "space", "?"]); assert.ok(!v.hints(redPr).some(([, d]) => /approve/.test(d)));
  assert.equal(v.hints(pr)[0][1], "approve and merge");
  if (!process.env.NO_COLOR) assert.ok(v.row(redPr, 120).includes("\x1b[38;2;243;139;168m\x1b[1m×") || /243;139;168m[^m]*×/.test(v.row(redPr, 120)), "its mark is the needs-you red, not the ready green");
  assert.match(row(plain, 120), /^ ✓ Build a flying game {2}3\/5 reviewer says no +0s ago$/);
  assert.match(row({ ...pr, review: { ...review, recommend: true, score: 5 } }, 120), / {2}5\/5 reviewer says yes +PR#12 ✓ {2}0s ago$/);
  assert.match(row({ ...pr, review: { score: 3 } }, 120), /^ ✓ Build a flying game {2}3\/5 +PR#12/); // no advice given: the score alone
  // the PR number is always written the same way and left-aligned, so the "PR#" parts line up
  const short = { ...pr, id: "proj/7", pr: 9, prState: "merged" }, list = [pr, short];
  assert.equal(row(pr, 120, list).indexOf("PR#12 ✓"), row(short, 120, list).indexOf("PR#9")); assert.match(row(short, 120, list), / PR#9 {5}0s ago$/);
  if (!process.env.NO_COLOR) {
    const red = "\x1b[38;2;243;139;168m", green = "\x1b[38;2;166;227;161m", yellow = "\x1b[38;2;249;226;175m", mauve = "\x1b[38;2;203;166;247m";
    assert.ok(v.row(pr, 120).includes(`${red}3/5`)); assert.ok(v.row({ ...pr, review: { ...review, recommend: true } }, 120).includes(`${green}3/5`));
    assert.ok(v.row(pr, 120).includes(`${green}PR#12`) && v.row(pr, 120).includes(`${green}✓`)); // the colour only repeats the mark
    // whatever the state, the title is plain text
    for (const r of [pr, working, { ...working, state: "error", stage: "failed" }, { ...working, state: "done" }, { ...working, state: "idle" }]) assert.match(v.row(r, 120), /^ \S+ (\x1b\[1m)?[A-Z]/);
    // while the reviewer works, the mark, the bar and the percent are a colour no other state uses
    const reviewed = v.row({ ...working, stage: "reviewing", reviewRound: 1 }, 120);
    assert.ok(reviewed.includes(`${mauve}◐`) && reviewed.includes(`${mauve} 50%`) && reviewed.includes(`${mauve}█`) && !reviewed.includes(`${mauve}review`) && !reviewed.includes(yellow));
    const plainWork = v.row(working, 120);
    assert.ok(plainWork.includes(`${yellow}◐`) && !plainWork.includes(mauve));
  }
  assert.match(row(base, 120), /^ ✓ Build a flying game +0s ago$/); // no reviewer: the heading says the rest
  assert.match(row({ ...pr, review: { ...review, stale: true } }, 120), /^ ✓ Build a flying game {2}the work changed since its review +PR#12 ✓ {2}0s ago$/);
  // which review it is on: nothing on the first, in words from the second
  const second = { ...pr, reviewRound: 2 };
  assert.doesNotMatch(row({ ...pr, reviewRound: 1 }, 120), /review\b.*review|r1|1st/);
  assert.match(row(second, 120), /^ ✓ Build a flying game {2}3\/5 reviewer says no · 2nd review +PR#12 ✓ {2}0s ago$/);
  assert.match(row({ ...pr, reviewRound: 3 }, 120), /3\/5 reviewer says no · 3rd review/);
  // narrower, the verdict is never cut: first the round goes, then the words, the score last
  assert.match(row(second, 60), /^ ✓ Build a flying game {2}3\/5 reviewer says no +PR#12 ✓ {2}0s$/);
  assert.match(row(second, 44), /^ ✓ Build a flying game {2}3\/5 +PR#12 ✓ {2}0s ago$/);
  assert.match(row(second, 34), /^ ✓ Build a flying game {2}3\/5 +0s$/);
  assert.match(row(pr, 24), /^ ✓ Build a flying game *$/);
  // a failed merge needs you: it says why, and the panel still has the score and which review gave it
  const failedMerge = { ...second, mergeFailed: true, review: { ...review, recommend: true, score: 5 }, msg: "The merge failed: conflict in src/game.js" };
  assert.match(row(failedMerge, 120), /^ × Build a flying game {2}The merge failed: conflict in src\/game\.js +PR#12 ✓ {2}0s ago$/);
  assert.match(page(failedMerge), /× needs you · 2nd review · claude · 0s ago · proj\/1/); assert.match(page(failedMerge), /\n Review ─+\n ╭─ Review 2 ─+╮\n │ 5\/5, says merge +│\n │ Crashes\. +│\n ╰─+╯\n/);
  // behind main and not brought up to date yet: neither the row nor the panel say it is ready
  const behind = { ...pr, summary: "Did the work.", syncBlocked: { why: "main could not be fetched (network is down)" }, msg: "Behind main, and not up to date yet: main could not be fetched (network is down). The board keeps trying; it cannot be approved until then." };
  assert.match(row(behind, 120), /^ × Build a flying game {2}Behind main, and not up to date yet/);
  assert.match(page(behind), /Behind main, cannot be approved yet/); assert.match(page(behind), /main could not be fetched \(network is down\)/); assert.doesNotMatch(page(behind), /ready to approve/);
  // the panel, in the order you need it: where it stands and the change, the review in its box, what the agent said, the settings
  const ready = page({ ...second, summary: "Did the work.", said: "Built Skylark.", stat: " 4 files changed, 120 insertions(+), 31 deletions(-)" });
  assert.match(ready, /^\n Build a flying game\n ✓ ready to approve · 2nd review · claude · 0s ago · proj\/1\n 4 files, \+120 −31 · PR#12 ✓\n\n Review ─+\n ╭─ Review 2 ─+╮\n │ 3\/5, says don't merge +│\n │ Crashes\. +│\n ╰─+╯\n\n The agent said ─+\n Built Skylark\.\n\n Settings ─+\n Project /);
  assert.match(ready, /\n Permissions {2}[^\n]+$/); assert.doesNotMatch(ready, /https:|shows the whole task/); // every setting, tightly, at the end; the link is in the PR's number
  assert.match(page({ ...second, stat: " 4 files changed, 120 insertions(+), 31 deletions(-)" }, true), /\n 4 files, \+120 −31 · PR#12 ✓\n https:\/\/github\.com\/a\/b\/pull\/12\n/); // full screen it is printed too
  assert.doesNotMatch(ready, /Description|None\./);
  // Every review the task had: how many, how each went, and the latest in a box of its own, on both shapes of the panel.
  const spiral = { ...second, reviewRound: 3, review: { score: 4, recommend: true, text: "Fine now.", stale: false }, reviews: [
    { round: 1, at: Date.now() - 7200000, score: 2, recommend: false, text: "Crashes on start.", problems: ["game.js: null plane."], checks: ["Ran it."], limitations: [], head: "1111111aaaa" },
    { round: 2, at: Date.now() - 3600000, error: "the reviewer finished without a verdict" },
    { round: 3, at: Date.now() - 60000, score: 4, recommend: true, text: "Fine now.", problems: [], checks: ["Ran the tests: all pass."], limitations: ["Not tried on a phone."], head: "abcdef12345" }] };
  assert.match(page(spiral), /\n Reviews · 3 ─+\n 2\/5 no → no verdict → 4\/5 yes\n ╭─ Review 3 ─+ 1m ago ─╮\n │ 4\/5, says merge +│\n │ Fine now\. +│\n ╰─+╯\n/);
  assert.doesNotMatch(page(spiral), /Crashes on start|the newest first|Review [12] /); assert.match(page(spiral), /\n\n ctrl\+e shows the whole task$/); // beside the list: only the latest, and where the rest is
  const whole = page(spiral, true);
  assert.match(whole, /\n Reviews · 3, the newest first ─+\n 2\/5 no → no verdict → 4\/5 yes\n ╭─ Review 3 ─+ 1m ago · abcdef1 ─╮\n │ 4\/5, says merge +│\n │ Fine now\. +│\n │ +│\n │ Checked +│\n │ • Ran the tests: all pass\. +│\n │ +│\n │ Could not verify +│\n │ • Not tried on a phone\. +│\n ╰─+╯\n\n ╭─ Review 2 ─+ 1h ago ─╮\n │ No verdict +│\n │ the reviewer finished without a verdict +│\n ╰─+╯\n\n ╭─ Review 1 ─+ 2h ago · 1111111 ─╮\n │ 2\/5, says don't merge +│\n │ Crashes on start\. +│\n │ +│\n │ Problems +│\n │ • game\.js: null plane\. +│\n │ +│\n │ Checked +│\n │ • Ran it\. +│\n ╰─+╯\n/);
  assert.ok(whole.indexOf("\n ✓ ready to approve") < whole.indexOf("Reviews · 3, the newest first") && whole.indexOf("╭─ Review 1 ") < whole.indexOf("\n Settings ") && whole.indexOf("\n Settings ") < whole.indexOf("\n Permissions")); // where it stands, every review, then the settings
  // a narrow full screen drops nothing of a review: its age and commit move from the box's edge to its first line
  { const thin = stripVTControlCharacters(v.panel({ owner: "me", ...spiral }, 24, true).join("\n"));
    assert.match(thin, /\n ╭─ Review 3 ─+╮\n │ 1m ago · abcdef1 +│\n │ 4\/5, says merge +│\n/); assert.match(thin, /\n ╭─ Review 2 ─+╮\n │ 1h ago +│\n │ No verdict +│\n/); assert.match(thin, /\n ╭─ Review 1 ─+╮\n │ 2h ago · 1111111 +│\n/); }
  // a side panel too short for every setting still has the latest review, on one line, before any setting
  for (const fit of [12, 8, 4]) {
    const lines = v.panel({ owner: "me", ...spiral, worktree: "", description: "Long. ".repeat(200) }, 46, false, fit).map((l) => stripVTControlCharacters(l));
    assert.ok(lines.length <= fit); assert.equal(lines[0], " Build a flying game"); assert.equal(lines[1], " Review 3  4/5, says merge"); assert.match(lines[2], /^ Project /); assert.ok(!lines.some((l) => l.startsWith(" Branch ")), "the branch row goes before the review does");
  }
  // many reviews in a narrow panel: the trail keeps the newest and says that older ones are left out
  const many = { ...spiral, reviews: Array.from({ length: 12 }, (_, n) => ({ round: n + 1, score: 2, recommend: false, text: "Still broken." })) };
  assert.match(stripVTControlCharacters(v.panel({ owner: "me", ...many }, 44, false).join("\n")), /\n Reviews · 12 ─+\n … 2\/5 no → 2\/5 no → 2\/5 no → 2\/5 no\n ╭─ Review 12 ─/);
  // a short window never costs a setting: the long parts give way, and in the end the review is one line
  const busy = { ...spiral, title: "Build a flying game with a very long name that wraps onto two lines", state: "working", kind: undefined, stage: "working", progress: 40, eta: 12, msg: "Running the whole test suite again after the last fix", said: "Working on it.", description: "Long. ".repeat(200), usage: { in: 1000, out: 2000, context: 5000, window: 200000 }, link: { pane: "p1", workspace: "w1" } };
  for (const fit of [30, 20, 16, 14]) {
    const lines = v.panel({ owner: "me", ...busy }, 45, false, fit).map((l) => stripVTControlCharacters(l));
    assert.ok(lines.length <= fit, `fits in ${fit} lines`);
    for (const fact of ["Project", "Worktree", "Agent", "Reviewer", "Reviewed", "Send back", "Evidence", "Watcher", "Conflicts", "Permissions"]) assert.ok(lines.some((l) => l.startsWith(` ${fact} `)), `${fact} with room for ${fit} lines`);
    assert.ok(lines.some((l) => /^ (╭─ )?Review 3 /.test(l)), `the latest review with room for ${fit} lines`);
    assert.match(lines[lines.length - 1], /^ ctrl\+e shows the whole task$/);
  }
  assert.match(stripVTControlCharacters(v.panel({ owner: "me", ...busy }, 45, false, 30).join("\n")), /\n ▎ Now\n ▎ Running the whole test suite/); // with room, what it is doing is there, behind its bar
  if (!process.env.NO_COLOR) {
    // what a row says is greyed out, never in the title's colour
    const grey = "\x1b[38;2;108;112;134m";
    assert.ok(v.row(working, 120).includes(`${grey}A long sentence about what the other agent`), "a working row's status line is grey");
    assert.ok(v.row({ ...working, state: "blocked", kind: "question", stage: "asks", msg: "Which colour?" }, 120).includes(`${grey}Which colour?`), "and so is a row that needs you");
    assert.ok(!v.row(working, 120).includes(`${grey}Other`), "the title is not");
  }
  assert.match(row({ ...second, stage: "merging", state: "working", kind: undefined, msg: "merging" }, 120), /^ ◐ Build a flying game {2}merging +PR#12 ✓ {2}0s$/);
  assert.doesNotMatch(row({ ...second, state: "done", stage: "done" }, 120), /review|3\/5/);
  // while the reviewer works the row's sentence is only what the reviewer is doing
  const under = { ...working, stage: "reviewing", reviewRound: 3, msg: "Running the tests." };
  assert.match(row(under, 120), /^ ◐ Other {2}Running the tests\. +█+░+ +50% +0s$/); // no word "review", whichever review it is: the colour says it
  assert.match(row({ ...under, reviewRound: 1 }, 120), /^ ◐ Other {2}Running the tests\. /);
  assert.match(row({ ...under, reviewRound: 1, msg: "under review" }, 120), /^ ◐ Other +█/);
  assert.match(row(under, 30), /^ ◐ Other +50% +0s$/); // no room for the sentence: the row never falls back to a word
  assert.match(row({ ...under, stage: "reviewneeds", state: "blocked", progress: undefined, msg: "the reviewer shows a dialog" }, 120), /^ × Other {2}the reviewer shows a dialog +0s ago$/);
  assert.doesNotMatch(row({ ...working, reviewRound: 3 }, 120), /review/); // back with the agent: no review is running
  assert.match(page(under), /◐ reviewer is working · 3rd review · for 0s · proj\/2/);
  // another row's long sentence or progress does not take the verdict away
  assert.match(row(pr, 80, [pr, working]), /^ ✓ Build a flying game {2}3\/5 reviewer says no +PR#12 ✓ {2}0s ago$/);
  for (const width of [24, 30, 40, 60, 80, 120]) for (const r of [pr, plain, base]) {
    const line = row(r, width, [r, working]);
    assert.ok(line.length <= width, `fits ${width}`); assert.ok(!/Skylark|\*\*|Reviewed|approve to merge/.test(line)); assert.match(line, /^ \S Build a flying game/);
  }
  // a review judged by the gate: the result and a short tally in place of a score, in the row, the facts and the history
  const tagged = { meets: true, gate: "major", pass: true, text: "Works.", findings: [{ id: "F1", severity: "minor", subject: "A name is unclear", where: "game.js", proof: "" }, { id: "F2", severity: "minor", subject: "A comment is stale", where: "sky.js", proof: "" }] };
  const failing = { meets: false, gate: "major", pass: false, text: "No fix.", left: 1, findings: [{ id: "F1", severity: "critical", subject: "The plane never takes off", where: "game.js", proof: "ran it" }, { id: "F2", severity: "major", subject: "Crashes without a sky", where: "sky.js", proof: "ran it" }, { id: "F3", severity: "minor", subject: "A name is unclear", where: "game.js", proof: "" }, { id: "F4", severity: "major", subject: "The old menu flickers", where: "menu.js", proof: "", preexisting: true, task: "proj/7" }] };
  const gated = { ...pr, msg: "Approve to merge? Review: Pass · 2 minor. Built **Skylark**.", review: tagged };
  assert.match(row(gated, 120), /^ ✓ Build a flying game {2}Pass · 2 minor +PR#12 ✓ {2}0s ago$/);
  assert.match(row({ ...gated, review: failing }, 120), /^ ✓ Build a flying game {2}Fail · 1 critical, 1 major, 1 minor, 1 pre-existing +PR#12 ✓ {2}0s ago$/);
  assert.match(row({ ...gated, reviewRound: 2 }, 120), / {2}Pass · 2 minor · 2nd review +PR#12/); assert.match(row({ ...gated, review: { ...tagged, findings: [] } }, 120), / {2}Pass +PR#12/);
  assert.match(row({ ...gated, reviewRound: 2 }, 54), /^ ✓ Build a flying game {2}Pass · 2 minor +PR#12 ✓ {2}0s( ago)?$/); assert.match(row({ ...gated, reviewRound: 2 }, 34), /^ ✓ Build a flying game {2}Pass +0s$/); // never cut: shorter, then the one word
  { const paint = { ...theme, fg: (c, s) => `<${c}>${s}</>` }, cv = Object.create(View.prototype); Object.assign(cv, v, { theme: paint }); assert.ok(cv.row(gated, 120, cv.rowLayout([gated], 120)).includes("<green>Pass</>")); assert.ok(cv.row({ ...gated, review: failing }, 120, cv.rowLayout([gated], 120)).includes("<red>Fail</>")); }
  const loop = { ...gated, reviewRound: 3, reviews: [{ round: 1, at: Date.now() - 7200000, ...failing, head: "1111111aaaa" }, { round: 2, at: Date.now() - 3600000, score: 4, recommend: true, text: "An old one.", problems: ["game.js: old."] }, { round: 3, at: Date.now() - 60000, ...tagged, head: "abcdef12345" }] };
  assert.match(page(loop), /\n Reviews · 3 ─+\n fail → 4\/5 yes → pass\n ╭─ Review 3 ─+ 1m ago ─╮\n │ Pass · 2 minor +│\n │ Works\. +│\n ╰─+╯\n/); assert.doesNotMatch(page(loop), /Skylark[^\n]*Review:|Review: Pass/); // the board's own words about the review are not said twice
  assert.match(page(loop, true), /\n ╭─ Review 3 ─+ 1m ago · abcdef1 ─╮\n │ Pass · 2 minor +│\n │ Works\. +│\n │ +│\n │ Findings +│\n │ • \[minor\] A name is unclear \(game\.js\) · not required +│\n │ • \[minor\] A comment is stale \(sky\.js\) · not required +│\n ╰─+╯\n\n ╭─ Review 2 ─+ 1h ago ─╮\n │ 4\/5, says merge +│\n │ An old one\. +│\n │ +│\n │ Problems +│\n │ • game\.js: old\. +│\n ╰─+╯\n\n ╭─ Review 1 ─+ 2h ago · 1111111 ─╮\n │ Fail · 1 critical, 1 major, 1 minor, 1 pre-existing +│\n │ No fix\. +│\n │ +│\n │ Findings +│\n │ • \[critical\] The plane never takes off \(game\.js\) +│\n │ • \[major\] Crashes without a sky \(sky\.js\) +│\n │ • \[minor\] A name is unclear \(game\.js\) · not required +│\n │ • \[major\] The old menu flickers \(menu\.js\) · pre-existing, filed as proj\/7 +│\n │ • 1 smaller finding noticed late, left out +│\n ╰─+╯\n/);
  // what a row needs from you outranks its bar
  const stuck = { ...working, state: "blocked", kind: "question", stage: "asks", title: "Build a flying game", msg: "Which colour should the plane be?" };
  assert.match(row(stuck, 72), /^ × Build a flying game {2}Which colour should the plane be\? +50% +0s ago$/); assert.match(row(stuck, 120), /be\? +█+░+ +50% +0s ago$/);
  // rows that need you say what blocks them, after the name and without Markdown marks; with nothing said, in plain words
  const ask = "Which colour should the plane be, and should the **islands** have `palm` trees?";
  for (const r of [{ ...base, stage: "", kind: "question", msg: ask }, { ...base, mergeFailed: true, msg: ask }, { ...base, state: "error", kind: "", stage: "failed", msg: ask }])
    assert.match(row(r, 120), /^ \S Build a flying game {2}Which colour should the plane be, and should the islands have palm trees\? +0s ago$/);
  assert.match(row({ ...base, stage: "asks", kind: "question", msg: "" }, 120), / {2}has a question +0s ago$/);
  assert.match(row({ ...base, stage: "asks", kind: undefined, msg: "needs you" }, 120), /^ × Build a flying game +0s ago$/); // not the heading's own words again
});
