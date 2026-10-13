// The task panel: beside the list and full screen.
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { open } from "./board-helpers.js";

test("the task panel beside the list cuts a long description short and says where the rest is; the whole panel shows all of it", async () => {
  const w = await world();
  try {
    const long = Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of a very long description.`).join("\n");
    A.add(w.root, "Short one", { description: "Brief." });
    const big = A.add(w.root, "Long one", { description: long });
    const s = open(w, { rows: 44 });
    s.v.sel = big.id; s.v.load();
    let text = s.text(120);
    assert.match(text, /│ {2}Long one/); assert.match(text, /Line 1 of a very long/);
    // Beside the list the description is short: a few lines, then where the rest is.
    assert.match(text, /Line 8 of a very long description\. … *\n/); assert.match(text, /│ {2}alt\+t shows the whole task/);
    assert.doesNotMatch(text, /Line 9 of/); assert.doesNotMatch(text, /Line 80 of/);
    // The title by itself, the status under its headline as facts (a label, then its value, every value in one column), then the description, then the settings: each part under its own headline, an empty line between.
    assert.match(text, /│ {2}Long one *\n[^\n]*│ *\n[^\n]*│ {2}Status ─+ *\n[^\n]*│ {2}State {8}○ to do · \ds ago *\n[^\n]*│ {2}Task {9}proj\/2 *\n[^\n]*│ *\n[^\n]*│ {2}Description ─+ *\n/);
    assert.match(text, /│ {2}Settings ─+ *\n[^\n]*│ {2}Project {6}\S+ *\n[^\n]*│ {2}Worktree {5}on *\n[^\n]*│ {2}Branch {7}main *\n[^\n]*│ {2}Agent /);
    // Every setting shows beside the list, also one that is only your default.
    const SETTINGS = ["Project", "Worktree", "Agent", "Reviewer", "Reviewed", "Send back", "Evidence", "Merge"];
    for (const fact of SETTINGS) assert.match(text, new RegExp(`│  ${fact} `), fact);
    assert.match(text, /│ {2}Reviewed {5}work in a repo *\n[^\n]*│ {2}Send back {4}major or worse · 3 rounds max *\n[^\n]*│ {2}Evidence {5}on *\n/);
    // A short window keeps the parts apart: the long parts give way first, then the settings from the last, each one
    // whole. No line is cut in the middle, and the last line says where the rest is.
    { const low = open(w, { rows: 21 }); low.v.sel = big.id; low.v.load(); const t24 = low.text(120), side = low.screen(120).map((l) => (l.split("│")[1] || "").trimEnd());
      const kept = SETTINGS.filter((fact) => new RegExp(`│  ${fact} `).test(t24));
      assert.ok(kept.length >= 3 && kept.length < SETTINGS.length, "some settings fit a 21-row window"); assert.deepEqual(kept, SETTINGS.slice(0, kept.length), "and they go from the last");
      assert.match(t24, /│ {2}Status ─+ *\n[^\n]*│ {2}State {8}○ to do · \ds ago *\n[^\n]*│ *\n[^\n]*│ {2}Settings ─+ *\n/); // the headlines and the empty line between the parts stay
      assert.ok(!side.some((l) => l.endsWith("…")), "nothing is cut with an ellipsis");
      assert.match(t24, /│ {2}alt\+t shows the whole task/); assert.doesNotMatch(t24, /Line 1 of/); }
    S.setValue("worker.agent", "claude/opus", { task: S.get(big.id) }); s.v.load();
    text = s.text(120);
    assert.match(text, /│ {2}Agent {8}\S+ · opus · default effort/); assert.match(text, /│ {2}Reviewer {5}codex · default model/);
    // A long text with no line breaks is cut between words after a few hundred characters.
    const prose = A.add(w.root, "Prose", { description: "word ".repeat(400).trim() });
    s.v.sel = prose.id; s.v.load();
    const shown = s.screen(160).map((l) => l.split("│")[1] || "").join(" ").match(/Description ─+\s+((?:word\s+)+)…/);
    assert.ok(shown && shown[1].replace(/\s+/g, " ").length <= 400 && shown[1].replace(/\s+/g, " ").length >= 280, "a description beside the list keeps to 280 to 400 characters");
    s.v.sel = big.id; s.v.load();
    if (!process.env.NO_COLOR) {
      // A headline is bold and a label is greyed out. A setting chosen for this task is in the text colour; one that
      // is only your default is quieter.
      const raw = s.v.render(120).join("\n"), grey = "\x1b[38;2;108;112;134m", ink = "\x1b[38;2;205;214;244m", quiet = "\x1b[38;2;166;173;200m";
      assert.ok(raw.includes("\x1b[1mDescription\x1b[22m") && raw.includes(`${grey}Agent        \x1b[39m${ink}`) && raw.includes(`${ink}  Line 1 of a very long`), "headlines are bold, labels grey, the text is neither");
      assert.ok(raw.includes(`${grey}Reviewer     \x1b[39m${ink}${quiet}codex`), "a default setting is quieter");
    }
    // The task details: the same parts full screen, scrolled, with every setting.
    s.press("alt+t");
    assert.equal(s.v.full, true);
    assert.match(s.text(120), /^ Task details {2}proj\/2 +lines 1–\d+ of \d+/);
    s.v.panelTop = 1e9; text = s.text(120);
    assert.match(text, /Line 80 of/);
    for (const fact of SETTINGS) assert.match(text, new RegExp(`\\n ${fact} `), fact);
    // A choice made for this task alone shows in both, and is starred on the full screen.
    for (const [k, v] of [["review.when", "always"], ["review.mustFix", "minor"], ["review.rounds", "5"], ["review.evidence", "false"]]) S.setValue(k, v, { task: S.get(big.id) });
    s.v.load(); s.v.panelTop = 1e9; text = s.text(120);
    assert.match(text, /\n Reviewed {5}all work \*/); assert.match(text, /\n Send back {4}minor or worse · 5 rounds max \*/); assert.match(text, /\n Evidence {5}off \*/);
    assert.match(text, /opus · default effort \*/); assert.match(text, /\* this task's own, not what it would be otherwise/);
    s.press("up"); assert.ok(s.v.panelTop < s.v.panelLength); assert.equal(s.v.sel, big.id); // the arrows scroll the panel, they do not move the selection
    s.press("esc"); assert.equal(s.v.full, false);
    s.v.sel = "proj/1"; s.v.load();
    text = s.text(120);
    assert.match(text, /Brief\./);
    assert.doesNotMatch(text, /shows the whole task|…/); // a short one is left alone
    assert.doesNotMatch(text, /None\./); // and nothing is an empty box
  } finally { w.cleanup(); }
});

test("the task panel never opens full screen by itself: something going wrong only changes the hint line", async () => {
  const w = await world();
  try {
    const id = A.add(w.root, "Match the colors").id;
    S.update(id, (t) => { t.stage = "failed"; t.failure = { stage: "merge", phase: "sync", title: "Merge conflict with main", detail: "Conflicting files:\nsrc/board/view.js", agentCanFix: true, next: "Resolve the conflict." }; });
    const s = open(w, { rows: 36 });
    s.v.load();
    assert.equal(s.v.sel, id); assert.equal(s.v.full, false); assert.equal(s.v.reply, false);
    let text = s.text(80);
    assert.match(text, /\n needs you *\n ✗ Match the colors [^\n]*\n {3}Merge conflict with main/);
    assert.doesNotMatch(text, /Conflicting files/);
    // The hint line: what matters now, the main thing first, never more than four.
    assert.match(s.text(120), /\n {2}ctrl\+r tell this task's agent to fix it · ctrl\+l retry as it is · space talk about this task · \? all keys *$/);
    assert.match(text, /\n {2}ctrl\+r tell this task's agent to fix it · ctrl\+l retry as it is · \? all keys *$/); assert.match(s.text(60), /\n {2}ctrl\+r tell this task's agent to fix it · \? all keys *$/); assert.match(s.text(50), /\n {2}ctrl\+r tell this task's agent to fix it *$/); // and it never runs off a narrow screen: the main thing is the last to go
    // Wide, the panel beside the list already says it, in order: where it stands, then what it needs from you.
    text = s.text(120);
    assert.match(text, /│ {2}State {8}✗ needs you · \ds ago *\n[^\n]*│ {2}Task {9}proj\/1 *\n[^\n]*│ *\n[^\n]*│ {2}Went wrong ─+ *\n[^\n]*│ {2}Merge conflict with main *\n[^\n]*│ {2}The agent can fix this: ctrl\+r sends it\. *\n[^\n]*│ {2}Next step {4}Resolve the conflict\. *\n[^\n]*│ {2}Details {6}Conflicting files: *\n[^\n]*│ {15}src\/board\/view\.js/);
    // Narrow, space does what it does at every width: the chat names the task, and the list stays. alt+t opens the
    // same panel full screen; esc leaves it, and the chat stays the task's.
    s.screen(80); s.press("space");
    assert.equal(s.v.full, false); assert.equal(s.v.reply, true); assert.match(s.text(80), /^ herdr-superwork/); assert.match(s.text(80), /\n *\n . Match the colors {2}/);
    s.press("alt+t"); text = s.text(80);
    assert.equal(s.v.full, true); assert.equal(s.v.reply, true);
    assert.match(text, /^ Task details {2}proj\/1/); assert.match(text, /Merge conflict with main/); assert.match(text, /\n Details {6}Conflicting files: *\n {14}src\/board\/view\.js/);
    assert.match(text, /\n *\n . Match the colors {2}[^\n]*\n(?:[^\n]*\n)*?─+\n❯/);
    s.press("esc");
    assert.equal(s.v.full, false); assert.equal(s.v.reply, true); assert.doesNotMatch(s.text(80), /Conflicting files/); assert.match(s.text(80), /\n *\n . Match the colors {2}/);
    // Nor does coming back from the archive bring it up, and an open panel is not remembered when the board reopens.
    s.press("alt+t"); assert.equal(s.v.full, true);
    s.press("esc", "alt+a"); assert.equal(s.v.archiveView, true);
    s.press("alt+a"); assert.equal(s.v.archiveView, false); assert.equal(s.v.sel, id); assert.equal(s.v.full, false);
    s.press("alt+t"); s.v.savePrefs();
    const again = open(w);
    again.v.load();
    assert.equal(again.v.sel, id); assert.equal(again.v.full, false); assert.equal(again.v.reply, false);
    assert.doesNotMatch(again.text(80), /Conflicting files/);
  } finally { w.cleanup(); }
});

test("the task panel has one form for every part, in every state and at every width: a headline on its rule, facts in one column, nothing boxed and nothing cut", async () => {
  const w = await world();
  try {
    const id = A.add(w.root, "Max length for task titles", { description: "A task title should have a maximum length. A longer one is cut between words." }).id;
    const s = open(w), now = Date.now();
    const finding = (severity, subject, more = {}) => ({ id: "F1", severity, subject, where: "src/store/titles.js:14", proof: "", ...more });
    const reviews = [
      { round: 1, at: now - 7200000, meets: false, gate: "major", pass: false, text: "A title is cut in the middle of a word.", findings: [finding("critical", "A title is cut in the middle of a word"), finding("minor", "The limit is written in two places"), finding("major", "The old menu flickers", { preexisting: true, task: "proj/7" })], checks: ["Ran the check."], limitations: ["Not tried on another machine."], head: "1111111aaaa" },
      { round: 2, at: now - 3600000, error: "the reviewer finished without a verdict" },
      { round: 3, at: now - 60000, meets: true, gate: "major", pass: true, text: "The change meets the task. A title at the limit is kept whole, and a longer one is cut between words with the rest moved into the description.", findings: [], checks: ["Ran the whole check."], limitations: [], head: "abcdef12345", artifacts: [{ caption: "Open review", link: "https://example.test/review/1/" }] }];
    const base = { owner: "me", ...S.get(id), agent: "claude", app: "claude", at: now - 60000, stat: " 19 files changed, 340 insertions(+), 27 deletions(-)", pr: "https://github.com/a/b/pull/60", reviewRound: 3, reviews, review: reviews[2], said: "Titles longer than 80 characters are cut between words." };
    const STATES = {
      "to do": { owner: "me", ...S.get(id), state: "idle", at: now },
      working: { ...base, state: "working", stage: "working", progress: 60, eta: 11, msg: "Found the cause; now checking every caller of the resize handler for the same mistake", reviews: [], review: undefined, reviewRound: 0 },
      reviewing: { ...base, state: "working", stage: "reviewing", progress: 35, eta: 6, msg: "Filing tasks with titles at the limit." },
      "waiting for approval": { ...base, state: "blocked", kind: "permission", stage: "approval", prState: "passing", msg: "Approve to merge? Review: Pass. Done." },
      failed: { ...base, state: "error", stage: "failed", prState: "failing", failure: { stage: "merge", phase: "sync", title: "Conflict with main", detail: "Conflicting files:\nsrc/board/view/row.js", agentCanFix: true, next: "Resolve the conflict." } },
      done: { ...base, state: "done", stage: "done", prState: "merged", prMerged: true },
    };
    const LABELS = ["State", "Progress", "Now", "On it", "Change", "Task", "Next step", "Details", "History", "Review 1", "Review 2", "Review 3", "Evidence", "Findings", "Checked", "Unverified", "Project", "Worktree", "Branch", "Agent", "Reviewer", "Reviewed", "Send back", "Merge"];
    for (const [name, r] of Object.entries(STATES)) for (const [width, full] of [[38, false], [46, false], [58, false], [70, false], [44, true], [80, true], [100, true]]) {
      const lines = s.v.panel(r, width, full).map((l) => stripVTControlCharacters(l)), at = `${name}, ${width} columns${full ? ", full screen" : ""}`;
      assert.ok(lines.every((l) => l.length <= width), `${at}: nothing runs over`);
      assert.ok(!lines.some((l) => /[╭╮╰╯│▎]/.test(l)), `${at}: no box and no bar`);
      assert.ok(!lines.some((l) => l.endsWith("…") && !l.startsWith(" ↗")), `${at}: nothing is cut with an ellipsis`);
      // A headline is the only line with a rule, and the rule runs to the edge. An empty line stands before each one.
      const heads = lines.map((l, n) => (/ ─+$/.test(l) ? n : -1)).filter((n) => n >= 0);
      assert.ok(heads.length >= 2 && heads.every((n) => /^ [A-Z][^─]* ─+$/.test(lines[n]) && lines[n].length === width - 1 && lines[n - 1] === ""), `${at}: every headline on its rule, after an empty line`);
      assert.ok(!lines.some((l, n) => n && l === "" && lines[n - 1] === ""), `${at}: never two empty lines`);
      // Every fact: its label, then its value in the one column all values start in; what follows a value is under it.
      const facts = lines.filter((l) => !/ ─+$/.test(l) && LABELS.some((k) => l.startsWith(` ${k} `)));
      assert.ok(facts.length >= 8 && facts.every((l) => /^ .{12} \S/.test(l) && LABELS.some((k) => l.slice(1, 14).trimEnd() === k)), `${at}: every value starts in the same column`);
      for (const k of ["State", "Task", "Project", "Agent", "Merge"]) assert.ok(facts.some((l) => l.startsWith(` ${k} `)), `${at}: ${k}`);
    }
    // What each state needs you to see first is under Status, in the same order in every state.
    const side = (name) => s.v.panel(STATES[name], 70, false).map((l) => stripVTControlCharacters(l)), labels = (name) => { const l = side(name); return l.slice(l.findIndex((x) => x.startsWith(" Status ")) + 1, l.indexOf("", 3)).filter((x) => /^ \S/.test(x)).map((x) => x.slice(1, 14).trimEnd()); };
    assert.deepEqual(labels("to do"), ["State", "Task"]); assert.deepEqual(labels("working"), ["State", "Progress", "Now", "On it", "Change", "Task"]);
    assert.deepEqual(labels("reviewing"), ["State", "Progress", "Now", "Change", "Task"]); assert.deepEqual(labels("done"), ["State", "On it", "Change", "Task"]);
    assert.match(side("waiting for approval").join("\n"), /\n State {8}✓ ready to approve · 3rd review · 1m ago\n On it {8}claude\n Change {7}PR#60 · 19 files, \+340 −27\n Task {9}proj\/1\n/);
    assert.match(side("done").join("\n"), /\n Change {7}PR#60 merged · 19 files, \+340 −27\n/);
    // What needs you is a part of its own right under Status, and the reviews read as a history: how each went, then the latest.
    assert.match(side("failed").join("\n"), /\n Task {9}proj\/1\n\n Went wrong ─+\n Conflict with main\n The agent can fix this: ctrl\+r sends it\.\n Next step {4}Resolve the conflict\.\n Details {6}Conflicting files:\n {14}src\/board\/view\/row\.js\n\n Description ─/);
    assert.match(side("done").join("\n"), /\n Reviews · 3 ─+\n History {6}fail → no verdict → pass\n Review 3 {5}✓ Pass · 1m ago\n {14}The change meets the task\. A title at the limit is kept\n {14}whole, and a longer one is cut between words with the\n {14}rest moved into the description\.\n Evidence {5}↗ Open review\n/);
    // Full screen every review is there, the newest first, with what it found by how bad it is.
    const whole = s.v.panel(STATES.done, 100, true).map((l) => stripVTControlCharacters(l)).join("\n");
    assert.match(whole, /\n Review 1 {5}✗ Fail · 1 critical, 1 minor, 1 pre-existing · 2h ago · 1111111\n {14}A title is cut in the middle of a word\.\n Findings {5}critical {2}A title is cut in the middle of a word \(src\/store\/titles\.js:14\)\n {14}minor {5}The limit is written in two places \(src\/store\/titles\.js:14\) · not required\n {14}major {5}The old menu flickers \(src\/store\/titles\.js:14\) · pre-existing, task proj\/7\n Checked {6}• Ran the check\.\n Unverified {3}• Not tried on another machine\.\n/);
    assert.ok(whole.indexOf("\n Review 3 ") < whole.indexOf("\n Review 2 ") && whole.indexOf("\n Review 2 ") < whole.indexOf("\n Review 1 "));
    // Nothing of the evidence is cut on the full screen: a long name, what it is and its address are wrapped under
    // themselves. Beside the list its name is wrapped too, and the last line says where the rest is.
    { const long = { ...STATES.done, review: { ...reviews[2], artifacts: [{ caption: "A recording of every title length from seventy to ninety characters being filed", detail: "Play it from the start: the first minute is the board opening, then one task is filed for each length.", link: "https://example.test/proj/1/recordings/titles-from-seventy-to-ninety-characters.mp4" }] } };
      for (const width of [40, 60, 100]) {
        const page = s.v.panel(long, width, true).map((l) => stripVTControlCharacters(l)), from = page.findIndex((l) => l.startsWith(" Evidence ─")), text = page.slice(from + 1, page.indexOf("", from)).map((l) => l.replace(/^ (↗ | {2})/, "")).join(" ");
        assert.ok(page.every((l) => l.length <= width && !l.endsWith("…")), `evidence at ${width} columns: nothing runs over, nothing is cut`);
        assert.equal(text.replace(/ /g, ""), `${long.review.artifacts[0].caption} ${long.review.artifacts[0].detail} ${long.review.artifacts[0].link}`.replace(/ /g, ""), `evidence at ${width} columns: all of it`);
      }
      const beside = s.v.panel(long, 46, false).map((l) => stripVTControlCharacters(l));
      assert.match(beside.join("\n"), /\n Evidence {5}↗ A recording of every title\n {16}length from seventy to ninety\n {16}characters being filed\n/); assert.equal(beside.at(-1), " alt+t shows the whole task"); }
    // A review whose summary is shortened beside the list says where the rest is, also when nothing else is short.
    { const wordy = { owner: "me", ...S.get(id), description: "", agent: "claude", app: "claude", state: "done", stage: "done", at: now, reviewRound: 1, reviews: undefined, review: { score: 4, recommend: true, text: "word ".repeat(120).trim() } };
      const lines = s.v.panel(wordy, 60, false).map((l) => stripVTControlCharacters(l));
      assert.ok(lines.some((l) => l.endsWith(" …")), "the summary is shortened"); assert.equal(lines.at(-1), " alt+t shows the whole task");
      assert.doesNotMatch(s.v.panel({ ...wordy, review: { score: 4, recommend: true, text: "Fine." } }, 60, false).map((l) => stripVTControlCharacters(l)).join("\n"), /shows the whole task/); }
    // The star of a task's own setting is wrapped with its value: it never runs over the edge.
    S.setValue("reviewer.agent", "claude", { task: S.get(id) }); S.setValue("reviewer.fast", "on", { task: S.get(id) });
    for (const width of [40, 56, 70, 71, 72, 100]) {
      const page = s.v.panel({ owner: "me", ...S.get(id), state: "idle", at: now }, width, true).map((l) => stripVTControlCharacters(l)), from = page.findIndex((l) => l.startsWith(" Reviewer ")), row = page.slice(from, page.findIndex((l, n) => n > from && /^ \S/.test(l)));
      assert.ok(page.every((l) => l.length <= width), `${width} columns: no setting runs over`); assert.match(row.at(-1), /\*$/, `${width} columns: the star is there`);
      assert.equal(row.map((l) => l.slice(14).trim()).join(" "), "claude · default model, effort · no fast mode in claude *", `${width} columns: the whole value`);
    }
    if (!process.env.NO_COLOR) {
      // A result and a severity are said in words and marks; the colour only repeats them. A headline that needs you is in its state's colour.
      const raw = s.v.panel(STATES.done, 100, true).join("\n"), red = "\x1b[38;2;243;139;168m", green = "\x1b[38;2;166;227;161m", yellow = "\x1b[38;2;249;226;175m";
      // Merged, how its reviews went is quiet like its pull request; not merged, they keep their colours.
      const open = s.v.panel({ ...STATES.done, state: "blocked", kind: "permission", stage: "approval", prState: "passing", prMerged: false }, 100, true).join("\n"), quietInk = "\x1b[38;2;108;112;134m";
      assert.ok(open.includes(`${green}✓`) && open.includes(`${red}✗`) && raw.includes(`${red}critical  `) && raw.includes(`${yellow}minor     `), "marks and severities in their colours");
      assert.ok(raw.includes(`${quietInk}✓`) && raw.includes(`${quietInk}✗`) && !raw.includes(`${green}✓`) && !raw.includes(`${red}✗`), "merged: the marks of its reviews are quiet");
      assert.ok(s.v.panel(STATES.failed, 70, false).join("\n").includes(`${red}\x1b[1mWent wrong\x1b[22m`), "what went wrong has a red headline");
    }
  } finally { w.cleanup(); }
});
