// What you do to a task: approve and merge, the ? menu, stop or remove, retry.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, git, until } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { osc } from "../src/board/view.js";
import { main as cli } from "../src/cli.js";
import { here, open, keyed } from "./board-helpers.js";

test("the board: ready to approve, the merge asks first, the ? menu acts, remove asks, messages stay", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f." }], reviewer: [{ verdict: { meets: true, text: "Good.", findings: [{ severity: "minor", subject: "f.txt has no title", where: "f.txt" }] } }] });
    const id = A.add(w.root, "Make f").id; A.add(w.root, "Other");
    A.delegate(id); await settle(id);
    const s = open(w);
    s.v.sel = id; s.v.load();
    // Finished, reviewed work is good news: its own group, the reviewer's advice in words, no "approve to merge?" on every row.
    assert.match(s.text(80), /\n ready to approve *\n[ ▌]◆ #\d+ Make f +R#1 +\d+s ago *\n[ ▌] {5}Pass · 1 minor *\n/); assert.doesNotMatch(s.text(80), /blocked|approve to merge|r1/);
    let text = s.text();
    assert.match(text, /│ {2}State {8}◆ ready to approve · \d+s ago *\n/);
    assert.match(text, /│ {2}Review ─+ *\n[^\n]*│ {2}Review 1 {5}✓ Pass · 1 minor · \d+s ago *\n[^\n]*│ {15}Good\./); assert.match(text, /│ {2}Change {7}1 file, \+1 −0/);
    assert.equal(S.get(id).reviews.length, 1); assert.deepEqual([S.get(id).reviews[0].round, S.get(id).reviews[0].pass, S.get(id).reviews[0].findings.length, S.get(id).reviews[0].text], [1, true, 1, "Good."]); // the task keeps every review it had assert.match(text, /│ {2}The agent said *\n[^\n]*│ {2}Made f\./);
    assert.match(text, keyed(/\n[ ▌] {1}{yes} approve and merge this task · {sendBack} send the review to the agent · space talk to the agent · \? all keys/));
    // ctrl+l asks once before the merge; esc says no and nothing happened
    s.press("ctrl+l");
    assert.match(s.text(), /\n[ ▌]\? Merge #1 "Make f" into \S+\? *\n {3}A merge cannot be undone\. *\n {3}y = merge · n = do not merge/); // what is merged, where it lands, and that it cannot be undone assert.equal(S.get(id).stage, "approval");
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
    s.press("ctrl+l"); assert.match(s.text(), /\n[ ▌]\? Merge #1 "Make f" \(PR#19\) into \S+\? /);
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
    assert.match(s.text(), /#1: approved, merging/); // a result stays until the next key press, however long that takes
    s.v.beat(); s.v.beat(); assert.match(s.text(), /#1: approved, merging/);
    await settle(id); s.v.load();
    assert.match(s.text(80), /\n done *\n[ ▌]✓ #\d+ Make f +R#1 +\d/); assert.doesNotMatch(s.text(80), /unread/); // a done row says nothing more than its name and time
    // the ? menu: every key the board has, each line with its key, in three groups: plain, ctrl (does something), alt
    // (only shows or hides). Exactly this set, in this order; nothing else is a key of the board.
    s.v.sel = "proj/2"; s.v.load(); s.v.tui.terminal.rows = 60; s.press("?");
    text = s.text();
    assert.match(text, /^ Menu {2}for #2 "Other"/);
    assert.deepEqual(text.split(/\n on a row/)[0].split("\n").filter((l) => /^ (❯| ) \S/.test(l)).map((l) => l.slice(3, 11).trim()).filter(Boolean),
      ["↑ ↓", "pgup pgd", "enter", "space", "tab", "esc", "?", "y  n", "ctrl+l", "ctrl+r", "ctrl+x", "ctrl+a", "ctrl+p", "ctrl+e", "ctrl+z", "ctrl+f", "ctrl+c", "alt+c", "alt+u", "alt+j", "alt+p", "alt+t", "alt+a", "alt+s", "alt+d", "alt+m"]);
    assert.match(text, /\n plain keys *\n[ ▌] {2}↑ ↓ +move between tasks/); assert.match(text, keyed(/\n ctrl: does something *\n[ ▌] {2}{yes} +yes: approve the merge, say yes, retry, take it as it is/)); assert.equal(s.v.menu.at, -1, "no line is picked when the menu opens: enter right after ? does nothing"); s.press("enter"); assert.ok(s.v.menu); assert.match(text, keyed(/\n alt: only shows or hides *\n[ ▌] {2}{chatMessage} +hide the chat's latest message/));
    for (const line of [keyed(/{sendBack} +send it back: tell the agent to fix it, or to continue/), keyed(/{stop} +remove this task/), keyed(/{archive} +archive this task/), keyed(/{pin} +pin this task to the top/), keyed(/{undo} +undo/), keyed(/{find} +find: show only the tasks that match/), keyed(/{close} +twice: close the board/), keyed(/{side} +hide the side panel/), keyed(/{panel} +show the whole task, full screen/), keyed(/{archiveView} +show the archive/), keyed(/{byRepo} +group by repo/), keyed(/{allDone} +show all done/), keyed(/{scope} +show every machine's tasks \(now: this machine\)/), /◆ +ready to approve/, /@ +needs a login/, /65% 2m left/]) assert.match(text, line);
    assert.match(text, /\n[ ▌] {2}y {2}n +answer a question: y yes, n or esc no \(enter never confirms\)/); // the menu says how a question is answered
    assert.doesNotMatch(text, /Coordinator's chat|restart|new Coordinator|ctrl\+[stdog]\b|alt\+[vhrn]\b|delete {2}/); assert.match(text, /↑↓ pick a key · enter press it · esc close the menu/);
    s.press("x", "ctrl+l"); assert.ok(s.v.menu, "a stray key neither acts nor closes the menu");
    // a ctrl or alt line is picked with ↑ ↓ and enter, and does what its key does
    s.press("down", "down", "down", "down", "enter"); assert.ok(S.get("proj/2").archivedAt); assert.equal(s.v.menu, null); assert.ok(!/Other/.test(s.screen().slice(0, 12).join("\n")));
    assert.match(s.text(), keyed(/Archived #2 "Other"\. {undo} undoes it; {archiveView} shows the archive\. Now on #1 "Make f"\./));
    s.v.tui.terminal.rows = 34;
    // the keys themselves: alt+a shows and hides the archive, where ctrl+a restores; ctrl+z undoes; ctrl+p pins; ctrl+f finds
    s.press("alt+a"); assert.match(s.text(), /^ herdr-superwork {2}archive · 1 archived/); assert.match(s.text(), /\n archived [^\n]*\n[ ▌]. #2 Other /); assert.doesNotMatch(s.text(), /\[archived\]/, "the archive does not say archived a third time"); assert.match(s.text(), keyed(/\n[ ▌] {1}{archive} restore this task · {stop} remove this task · esc back to the board/));
    s.press("ctrl+a"); assert.ok(!S.get("proj/2").archivedAt); A.archive("proj/2"); s.v.archiveUndo = S.get("proj/2");
    s.press("alt+a", "ctrl+z"); assert.equal(s.v.archiveView, false); assert.ok(!S.get("proj/2").archivedAt);
    s.v.sel = "proj/2"; s.v.load(); s.press("ctrl+p"); assert.equal(S.get("proj/2").pinned, true); assert.match(s.text(80), /\n pinned +\n/);
    s.press("ctrl+f"); assert.match(s.text(), /\nfind ❯ /); s.type("make"); s.press("enter");
    assert.match(s.text(), /^ herdr-superwork {2}proj · [^\n]*\n filter "make" · 1 of 2 · esc clears /); // a kept filter has a line of its own: what it is, how many match, the key that clears it assert.ok(!/○ Other/.test(s.text()));
    s.press("esc"); assert.equal(s.v.filter, "");
    // ctrl+x on a task with no agent running asks to remove it, with the board's one question. A second ctrl+x, or
    // enter, is no answer: only y deletes.
    s.v.sel = "proj/2"; s.v.load(); s.press("ctrl+x"); assert.match(s.text(), /\n[ ▌]\? Remove #2 "Other"\? *\n {3}This cannot be undone\. The task goes, with its description and what its agent said\. It has no worktree\. ctrl\+a only *\n {3}archives it\. *\n {3}y = remove · n = keep/); // the whole title, and what is really lost
    s.press("ctrl+x", "enter"); assert.ok(s.v.ask); assert.ok(S.get("proj/2"));
    s.press("esc"); assert.ok(S.get("proj/2")); assert.equal(s.v.ask, null);
    // a question too long for the window never loses its keys: it wraps, its title whole, and each key stays whole
    A.rename("proj/2", "A task with quite a long title here"); s.v.load(); s.press("ctrl+x");
    for (const width of [80, 60, 40, 30]) {
      const lines = s.screen(width);
      assert.ok(lines.some((l) => l.includes("y = remove")) && lines.some((l) => l.includes("n = keep")), `the keys show at ${width}`);
      assert.match(lines.join(" ").replace(/\s+/g, " "), /\? Remove #2 "A task with quite a long title here"\? This cannot be undone\./, `the question shows at ${width}`);
      assert.ok(lines.every((l) => l.length <= width) && lines.length === 34);
    }
    s.press("esc"); A.rename("proj/2", "Other"); s.v.load();
    // from the menu it is the same question
    s.press("?");
    const at = s.v.menuItems().findIndex((i) => i.key === "ctrl+x"); assert.equal(s.v.menuItems()[at].label, "remove this task"); for (let i = 0; i <= at; i++) s.press("down"); // (no line is picked when the menu opens)
    s.press("enter", "enter"); assert.ok(s.v.ask); assert.ok(S.get("proj/2")); s.press("y");
    await until(() => !S.get("proj/2"));
    assert.equal(S.get("proj/2"), null);
    // an error stays until esc dismisses it; other keys leave it where it is
    s.v.flash("It broke.", "red"); s.press("down", "up"); assert.match(s.text(), /It broke\. {2}\(esc dismisses\)/);
    s.press("esc"); assert.doesNotMatch(s.text(), /It broke/); assert.equal(s.v.ask, null);
    assert.equal(osc({ state: "blocked", kind: "question", id: "proj/1", title: "T", msg: "m", app: "claude" }), "\x1b]7501;state=blocked:id=proj/1:kind=question:app=claude:title=VA==:msg=bQ==\x1b\\");
  } finally { w.cleanup(); }
});

test("ctrl+l on something that went wrong retries it as it stands; the focused-pane action asks before it merges", async () => {
  const w = await world({ repoSettings: { "check.command": "test -f good.txt" }, settings: { "review.when": "never", "review.rounds": 2 } });
  try {
    w.script({ worker: [{ note: "Done 1." }, { note: "Done 2." }, { note: "Done 3." }] });
    const id = A.add(w.root, "Never passes").id;
    A.delegate(id);
    let t = await settle(id, { max: 30 });
    assert.equal(t.stage, "failed"); assert.match(t.failure.title, /Check failed after 3 tries/);
    const s = open(w);
    s.v.sel = id; s.v.load();
    assert.match(s.text(), keyed(/\n[ ▌] {1}{sendBack} tell this task's agent to fix it · {yes} retry as it is · space talk to the agent · \? all keys/));
    // You fixed the cause yourself: yes runs the same step again, with nothing sent to the agent.
    const prompts = () => w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts.length;
    const sent = prompts();
    fs.writeFileSync(path.join(t.worktree, "good.txt"), "ok\n"); git(t.worktree, "add", "-A"); git(t.worktree, "commit", "-qm", "good");
    s.press("ctrl+l");
    assert.match(s.text(), /#1: trying again/); assert.equal(S.get(id).stage, "checking");
    t = await settle(id, { max: 30 });
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.equal(prompts(), sent);
    // An agent that said it needs a login: the panel says ctrl+l after you have signed in, and ctrl+l tells it to carry on.
    {
      w.script({ worker: [{ status: "working" }] });
      const lid = A.add(w.root, "Needs a login").id; A.delegate(lid); const lt = await settle(lid);
      S.update(lid, (x) => { x.stage = "asks"; x.kind = "auth"; x.msg = "Please log in to the registry."; });
      const l = open(w); l.v.sel = lid; l.v.load();
      assert.match(l.text(), /│ {2}Needs a login/); assert.match(l.text(), keyed(/press {yes} to tell the agent to try\s+[^\n]*│?\s*again|{yes}/)); assert.match(l.text(), keyed(/\n[ ▌] {1}{yes} tell this task's agent to try again · space talk to the agent · enter open the agent · \? all keys/));
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
    // (the command, in this process: test/cli.test.js starts the real program once)
    try { await cli(["approve-current"]); } finally { delete process.env.HERDR_PLUGIN_CONTEXT_JSON; }
    assert.equal(S.get(id).stage, "approval", "the action alone merges nothing");
    assert.ok(w.state().calls.some((c) => /popup|open|plugin/.test(c)), "it opens the board");
    const b = open(w);
    assert.equal(b.v.sel, id); assert.match(b.text(), /\n[ ▌]\? Merge #1 "Never passes" into \S+\? *\n {3}A merge cannot be undone\. *\n {3}y = merge · n = do not merge/);
    b.press("esc"); assert.equal(S.get(id).stage, "approval");
    assert.equal(open(w).v.ask, null, "asked once, not every time the board opens");
    process.env.HERDR_PLUGIN_CONTEXT_JSON = JSON.stringify({ focused_pane_id: t.link.pane });
    try { await cli(["approve-current"]); } finally { delete process.env.HERDR_PLUGIN_CONTEXT_JSON; }
    const b2 = open(w); b2.press("enter"); assert.equal(S.get(id).stage, "approval"); b2.press("y");
    assert.equal(S.get(id).stage, "merging");
    assert.equal((await settle(id, { max: 30 })).stage, "done");
  } finally { w.cleanup(); }
});
