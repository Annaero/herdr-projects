// What you do to a task: approve and merge, the ? menu, stop or remove, retry.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, git, until } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { osc } from "../src/board/view.js";
import { execFileSync } from "node:child_process";
import { here, open } from "./board-helpers.js";

test("the board: ready to approve, the merge asks first, the ? menu acts, remove asks, messages stay", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f." }], reviewer: [{ verdict: { meets: true, text: "Good.", findings: [{ severity: "minor", subject: "f.txt has no title", where: "f.txt" }] } }] });
    const id = A.add(w.root, "Make f").id; A.add(w.root, "Other");
    A.delegate(id); await settle(id);
    const s = open(w);
    s.v.sel = id; s.v.load();
    // Finished, reviewed work is good news: its own group, the reviewer's advice in words, no "approve to merge?" on every row.
    assert.match(s.text(80), /\n ready to approve *\n ✓ Make f {2}Pass · 1 minor +R#1 +\d+s ago *\n/); assert.doesNotMatch(s.text(80), /blocked|approve to merge|r1/);
    let text = s.text();
    assert.match(text, /│ {2}✓ ready to approve · claude · \d+s ago/);
    assert.match(text, /│ {2}Review ─+ *\n[^\n]*│ {2}╭─ Review 1 ─[^\n]*\n[^\n]*│ {2}│ Pass · 1 minor +│ *\n[^\n]*│ {2}│ Good\./); assert.match(text, /│ {2}1 file, \+1 −0/);
    assert.equal(S.get(id).reviews.length, 1); assert.deepEqual([S.get(id).reviews[0].round, S.get(id).reviews[0].pass, S.get(id).reviews[0].findings.length, S.get(id).reviews[0].text], [1, true, 1, "Good."]); // the task keeps every review it had assert.match(text, /│ {2}The agent said *\n[^\n]*│ {2}Made f\./);
    assert.match(text, /\n {2}ctrl\+l approve and merge · ctrl\+r send back · space reply · \? more/);
    // ctrl+l asks once before the merge; esc says no and nothing happened
    s.press("ctrl+l");
    assert.match(s.text(), /\n \? Merge "Make f"\? {2}y = yes · n = no/); assert.equal(S.get(id).stage, "approval");
    s.press("esc"); assert.equal(S.get(id).stage, "approval"); assert.equal(s.v.ask, null);
    // The question is about what it names. The task changes underneath it (a new commit was reviewed, another pull
    // request): the question goes, and nothing merges until you have been asked about what is there now.
    s.press("ctrl+l"); assert.ok(s.v.ask);
    const head = S.get(id).reviewedHead;
    S.update(id, (t) => { t.pr = "https://github.com/a/b/pull/19"; });
    s.v.load(); // what every beat does
    assert.equal(s.v.ask, null); assert.match(s.text(), /It changed while you were asked, so nothing was merged\./);
    s.press("enter"); assert.equal(S.get(id).stage, "approval"); assert.equal(s.closed(), undefined);
    // also when it changes between the last look and the key press
    s.press("ctrl+l"); assert.match(s.text(), /\n \? Merge PR#19\? /);
    S.update(id, (t) => { t.pr = undefined; });
    s.press("y"); assert.equal(S.get(id).stage, "approval"); assert.equal(s.v.ask, null); assert.match(s.text(), /It changed while you were asked/);
    // and the action itself refuses a yes that was given to something else
    assert.throws(() => A.approve(id, { pr: "https://github.com/a/b/pull/18", head }), /changed while you were asked\. Nothing was merged/);
    assert.throws(() => A.approve(id, { pr: null, head: "f".repeat(40) }), /changed while you were asked\. Nothing was merged/); assert.equal(S.get(id).stage, "approval");
    // enter never confirms: the question stays up and nothing merges. n says no, in either case, and is not typed
    s.press("ctrl+l", "enter"); assert.ok(s.v.ask); assert.equal(S.get(id).stage, "approval");
    s.press("x", "space", "tab"); assert.ok(s.v.ask); assert.equal(S.get(id).stage, "approval");
    s.press("n"); assert.equal(s.v.ask, null); assert.equal(s.v.value(), ""); assert.equal(S.get(id).stage, "approval");
    s.press("ctrl+l", "N"); assert.equal(s.v.ask, null); assert.equal(s.v.value(), ""); assert.equal(S.get(id).stage, "approval");
    s.press("ctrl+l", "Y"); assert.equal(s.v.value(), "");
    assert.equal(S.get(id).stage, "merging");
    assert.match(s.text(), /proj\/1: approved, merging/); // a result stays until the next key press, however long that takes
    s.v.beat(); s.v.beat(); assert.match(s.text(), /proj\/1: approved, merging/);
    await settle(id); s.v.load();
    assert.match(s.text(80), /\n done *\n ✓ Make f +R#1 +\d/); assert.doesNotMatch(s.text(80), /unread/); // a done row says nothing more than its name and time
    // the ? menu: every key the board has, each line with its key, in three groups: plain, ctrl (does something), alt
    // (only shows or hides). Exactly this set, in this order; nothing else is a key of the board.
    s.v.sel = "proj/2"; s.v.load(); s.v.tui.terminal.rows = 60; s.press("?");
    text = s.text();
    assert.match(text, /^ menu {2}for "Other"/);
    assert.deepEqual(text.split("\n").filter((l) => /^ (❯| ) \S/.test(l)).map((l) => l.slice(3, 11).trim()).filter((k) => k !== "R#2"),
      ["↑ ↓", "enter", "space", "tab", "esc", "?", "y  n", "ctrl+l", "ctrl+r", "ctrl+x", "ctrl+a", "ctrl+p", "ctrl+n", "ctrl+z", "ctrl+f", "ctrl+c", "alt+c", "alt+u", "alt+j", "alt+p", "alt+t", "alt+a", "alt+s", "alt+d", "alt+m"]);
    assert.match(text, /\n plain keys *\n {3}↑ ↓ {5}move between tasks/); assert.match(text, /\n ctrl: does something *\n ❯ ctrl\+l {2}yes: approve the merge, say yes, retry, take it as it is/); assert.match(text, /\n alt: only shows or hides *\n {3}alt\+c {3}hide the chat's latest message/);
    for (const line of [/ctrl\+r {2}send it back to the agent/, /ctrl\+x {2}remove the task/, /ctrl\+a {2}archive the task/, /ctrl\+p {2}pin to the top/, /ctrl\+z {2}undo/, /ctrl\+f {2}find/, /ctrl\+c {2}twice: close the board/, /alt\+p {3}hide the side panel/, /alt\+t {3}the whole task, full screen/, /alt\+a {3}show the archive/, /alt\+s {3}group by repo/, /alt\+d {3}show all done/, /alt\+m {3}other machines \(now: this machine only\)/]) assert.match(text, line);
    assert.match(text, /\n {3}y {2}n {4}answer a question: y yes, n or esc no \(enter never confirms\)/); // the menu says how a question is answered
    assert.doesNotMatch(text, /Coordinator's chat|restart|new Coordinator|ctrl\+[estdog]\b|alt\+[vhrn]\b|delete {2}/); assert.match(text, /↑↓ pick · enter do it · esc close/);
    s.press("x", "ctrl+l"); assert.ok(s.v.menu, "a stray key neither acts nor closes the menu");
    // a ctrl or alt line is picked with ↑ ↓ and enter, and does what its key does
    s.press("down", "down", "down", "enter"); assert.ok(S.get("proj/2").archivedAt); assert.equal(s.v.menu, null); assert.ok(!/Other/.test(s.screen().slice(0, 12).join("\n")));
    assert.match(s.text(), /proj\/2: archived\. ctrl\+z undoes it; alt\+a shows the archive\./);
    s.v.tui.terminal.rows = 34;
    // the keys themselves: alt+a shows and hides the archive, where ctrl+a restores; ctrl+z undoes; ctrl+p pins; ctrl+f finds
    s.press("alt+a"); assert.match(s.text(), /^ herdr-superwork {2}archive/); assert.match(s.text(), /Other \[archived\]/); assert.match(s.text(), /\n {2}ctrl\+a restore · ctrl\+x remove · esc back to the board/);
    s.press("ctrl+a"); assert.ok(!S.get("proj/2").archivedAt); A.archive("proj/2"); s.v.archiveUndo = S.get("proj/2");
    s.press("alt+a", "ctrl+z"); assert.equal(s.v.archiveView, false); assert.ok(!S.get("proj/2").archivedAt);
    s.v.sel = "proj/2"; s.v.load(); s.press("ctrl+p"); assert.equal(S.get("proj/2").pinned, true); assert.match(s.text(80), /\n pinned +\n/);
    s.press("ctrl+f"); assert.match(s.text(), /\nfind ❯ /); s.type("make"); s.press("enter");
    assert.match(s.text(), /^ herdr-superwork {2}proj · \S+ · find: make/); assert.ok(!/○ Other/.test(s.text()));
    s.press("esc"); assert.equal(s.v.filter, "");
    // ctrl+x on a task with no agent running asks to remove it, with the board's one question. A second ctrl+x, or
    // enter, is no answer: only y deletes.
    s.v.sel = "proj/2"; s.v.load(); s.press("ctrl+x"); assert.match(s.text(), /\n \? Remove "Other"\? Its worktree goes too\. {2}y = yes · n = no/);
    s.press("ctrl+x", "enter"); assert.ok(s.v.ask); assert.ok(S.get("proj/2"));
    s.press("esc"); assert.ok(S.get("proj/2")); assert.equal(s.v.ask, null);
    // a question too long for the window never loses its keys: it wraps, and "y = yes · n = no" stays whole
    A.rename("proj/2", "A task with quite a long title here"); s.v.load(); s.press("ctrl+x");
    for (const width of [80, 60, 40, 30]) {
      const lines = s.screen(width);
      assert.ok(lines.some((l) => l.includes("y = yes · n = no")), `the keys show at ${width}`);
      assert.match(lines.join(" ").replace(/\s+/g, " "), /\? Remove "A task with quite a long title …"\? Its worktree goes too\./, `the question shows at ${width}`);
      assert.ok(lines.every((l) => l.length <= width) && lines.length === 34);
    }
    s.press("esc"); A.rename("proj/2", "Other"); s.v.load();
    // from the menu it is the same question
    s.press("?");
    const at = s.v.menuItems().findIndex((i) => i.key === "ctrl+x"); assert.equal(s.v.menuItems()[at].label, "remove the task"); for (let i = 0; i < at; i++) s.press("down");
    s.press("enter", "enter"); assert.ok(s.v.ask); assert.ok(S.get("proj/2")); s.press("y");
    await until(() => !S.get("proj/2"));
    assert.equal(S.get("proj/2"), null);
    // an error stays until esc dismisses it; other keys leave it where it is
    s.v.flash("It broke.", "red"); s.press("down", "up"); assert.match(s.text(), /It broke\. {2}\(esc\)/);
    s.press("esc"); assert.doesNotMatch(s.text(), /It broke/); assert.equal(s.v.ask, null);
    assert.equal(osc({ state: "blocked", kind: "question", id: "proj/1", title: "T", msg: "m", app: "claude" }), "\x1b]7501;state=blocked:id=proj/1:kind=question:app=claude:title=VA==:msg=bQ==\x1b\\");
  } finally { w.cleanup(); }
});

test("ctrl+l on something that went wrong retries it as it stands; the focused-pane action asks before it merges", async () => {
  const w = await world({ repoSettings: { check: "test -f good.txt" }, settings: { helper: "off", reviewer: "off" } });
  try {
    w.script({ worker: [{ note: "Done 1." }, { note: "Done 2." }, { note: "Done 3." }] });
    const id = A.add(w.root, "Never passes").id;
    A.delegate(id);
    let t = await settle(id, { max: 30 });
    assert.equal(t.stage, "failed"); assert.match(t.failure.title, /Check failed after 3 tries/);
    const s = open(w);
    s.v.sel = id; s.v.load();
    assert.match(s.text(), /\n {2}ctrl\+r send it to the agent to fix · ctrl\+l retry · space reply · \? more/);
    // You fixed the cause yourself: yes runs the same step again, with nothing sent to the agent.
    const prompts = () => w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts.length;
    const sent = prompts();
    fs.writeFileSync(path.join(t.worktree, "good.txt"), "ok\n"); git(t.worktree, "add", "-A"); git(t.worktree, "commit", "-qm", "good");
    s.press("ctrl+l");
    assert.match(s.text(), /proj\/1: trying again/); assert.equal(S.get(id).stage, "checking");
    t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(prompts(), sent);
    // An agent that said it needs a login: the panel says ctrl+l after you have signed in, and ctrl+l tells it to carry on.
    {
      w.script({ worker: [{ status: "working" }] });
      const lid = A.add(w.root, "Needs a login").id; A.delegate(lid); const lt = await settle(lid);
      S.update(lid, (x) => { x.stage = "asks"; x.kind = "auth"; x.msg = "Please log in to the registry."; });
      const l = open(w); l.v.sel = lid; l.v.load();
      assert.match(l.text(), /│ {2}Needs a login/); assert.match(l.text(), /press ctrl\+l to tell the agent to try\s+[^\n]*│?\s*again|ctrl\+l/); assert.match(l.text(), /\n {2}ctrl\+l retry · space reply · enter open the agent · \? more/);
      const n = w.state().panes.find((p) => p.pane_id === lt.link.pane).agent.prompts.length;
      l.press("ctrl+l");
      assert.match(l.text(), /told the agent to continue/); assert.doesNotMatch(l.text(), /Nothing here waits for a yes/);
      const after = w.state().panes.find((p) => p.pane_id === lt.link.pane).agent.prompts;
      assert.equal(after.length, n + 1); assert.match(after.at(-1), /Continue the task where you left off/); assert.equal(S.get(lid).stage, "working");
      A.stop(lid);
    }
    // herdr's own action for the focused pane has no screen to ask on: it leaves a request and opens the board,
    // which opens on that task with the question up. Nothing is merged until enter.
    A.add(w.root, "Something else");
    process.env.HERDR_PLUGIN_CONTEXT_JSON = JSON.stringify({ focused_pane_id: t.link.pane });
    try { execFileSync(process.execPath, [S.BIN, "approve-current"], { encoding: "utf8", cwd: w.root }); } finally { delete process.env.HERDR_PLUGIN_CONTEXT_JSON; }
    assert.equal(S.get(id).stage, "approval", "the action alone merges nothing");
    assert.ok(w.state().calls.some((c) => /popup|open|plugin/.test(c)), "it opens the board");
    const b = open(w);
    assert.equal(b.v.sel, id); assert.match(b.text(), /\n \? Merge "Never passes"\? {2}y = yes · n = no/);
    b.press("esc"); assert.equal(S.get(id).stage, "approval");
    assert.equal(open(w).v.ask, null, "asked once, not every time the board opens");
    execFileSync(process.execPath, [S.BIN, "approve-current"], { encoding: "utf8", cwd: w.root, env: { ...process.env, HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_id: t.link.pane }) } });
    const b2 = open(w); b2.press("enter"); assert.equal(S.get(id).stage, "approval"); b2.press("y");
    assert.equal(S.get(id).stage, "merging");
    assert.equal((await settle(id, { max: 30 })).stage, "done");
  } finally { w.cleanup(); }
});
