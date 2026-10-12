// The task panel: beside the list and full screen.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { open } from "./board-helpers.js";

test("the task panel beside the list cuts a long description short and says where the rest is; the whole panel shows all of it", async () => {
  const w = await world({ settings: { helper: "off" } });
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
    // Status first, then the description, then the settings: each part under its own headline, an empty line between.
    assert.match(text, /│ {2}Long one *\n[^\n]*│ {2}○ to do · \ds ago · proj\/2 *\n[^\n]*│ *\n[^\n]*│ {2}Description ─+ *\n/);
    assert.match(text, /│ {2}Settings ─+ *\n[^\n]*│ {2}Project {6}\S+ *\n[^\n]*│ {2}Worktree {5}on *\n[^\n]*│ {2}Branch {7}main *\n[^\n]*│ {2}Agent /);
    // Every setting shows beside the list, also one that is only your default.
    const SETTINGS = ["Project", "Worktree", "Agent", "Reviewer", "Reviewed", "Send back", "Evidence", "Watcher", "Merge", "Conflicts", "Permissions"];
    for (const fact of SETTINGS) assert.match(text, new RegExp(`│  ${fact} `), fact);
    assert.match(text, /│ {2}Reviewed {5}work in a repo *\n[^\n]*│ {2}Send back {4}major or worse · 3 rounds max *\n[^\n]*│ {2}Evidence {5}on · local links/);
    // A short window keeps every setting too: the long parts give way, never the settings.
    { const low = open(w, { rows: 24 }); low.v.sel = big.id; low.v.load(); const t24 = low.text(120);
      for (const fact of SETTINGS) assert.match(t24, new RegExp(`│  ${fact} `), `${fact} in a 24-row window`);
      assert.match(t24, /│ {2}alt\+t shows the whole task/); assert.doesNotMatch(t24, /Line 1 of/); }
    S.setTaskConfig(big.id, "model", "opus"); s.v.load();
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
    for (const [k, v] of [["review", "all"], ["gate", "minor"], ["rounds", "5"], ["artifacts", "false"]]) S.setTaskConfig(big.id, k, v);
    s.v.load(); s.v.panelTop = 1e9; text = s.text(120);
    assert.match(text, /\n Reviewed {5}all work \*/); assert.match(text, /\n Send back {4}minor or worse · 5 rounds max \*/); assert.match(text, /\n Evidence {5}off \*/);
    assert.match(text, /opus · default effort \*/); assert.match(text, /\* this task's own, not your default/);
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
  const w = await world({ settings: { helper: "off" } });
  try {
    const id = A.add(w.root, "Match the colors").id;
    S.update(id, (t) => { t.stage = "failed"; t.failure = { stage: "merge", phase: "sync", title: "Merge conflict with main", detail: "Conflicting files:\nsrc/board/view.js", agentCanFix: true, next: "Resolve the conflict." }; });
    const s = open(w);
    s.v.load();
    assert.equal(s.v.sel, id); assert.equal(s.v.full, false); assert.equal(s.v.reply, false);
    let text = s.text(80);
    assert.match(text, /\n needs you *\n ✗ Match the colors {2}Merge conflict with main/);
    assert.doesNotMatch(text, /Conflicting files/);
    // The hint line: what matters now, the main thing first, never more than four.
    assert.match(text, /\n {2}ctrl\+r send it to the agent to fix · ctrl\+l retry · space reply · \? more *$/);
    assert.match(s.text(60), /\n {2}ctrl\+r send it to the agent to fix · ctrl\+l retry · \? more *$/); assert.match(s.text(50), /\n {2}ctrl\+r send it to the agent to fix · \? more *$/); // and it never runs off a narrow screen
    // Wide, the panel beside the list already says it, in order: where it stands, then what it needs from you.
    text = s.text(120);
    assert.match(text, /│ {2}✗ needs you · \ds ago · proj\/1 *\n[^\n]*│ *\n[^\n]*│ {2}▎ Merge conflict with main/); assert.match(text, /│ {2}▎ Next step/); assert.match(text, /│ {2}▎ What went wrong *\n[^\n]*│ {2}▎ Conflicting files:/);
    // Narrow, space does what it does at every width: the chat names the task, and the list stays. alt+t opens the
    // same panel full screen; esc leaves it, and the chat stays the task's.
    s.screen(80); s.press("space");
    assert.equal(s.v.full, false); assert.equal(s.v.reply, true); assert.match(s.text(80), /^ herdr-superwork/); assert.match(s.text(80), /\n *\n . Match the colors {2}/);
    s.press("alt+t"); text = s.text(80);
    assert.equal(s.v.full, true); assert.equal(s.v.reply, true);
    assert.match(text, /^ Task details {2}proj\/1/); assert.match(text, /Merge conflict with main/); assert.match(text, /▎ Conflicting files: *\n ▎ src\/board\/view\.js/);
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
