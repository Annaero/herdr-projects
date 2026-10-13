// The web board's data: the same list, panel, buttons, questions and words the terminal board has, read from the
// board's own code, and a button that presses the board's own key
import test from "node:test";
import assert from "node:assert/strict";
import { world, settle } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as K from "../src/board/keys.js";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { WebView, bytesOf, TERMINAL_ONLY } from "../src/webui/web-view.js";
import { CALLS, snapshot, viewOf } from "../src/webui/worker.js";
import { pieces, plain, webTheme } from "../src/webui/ink.js";
import { readLine } from "../src/webui/panel-model.js";

const rowsOf = (list) => list.groups.flatMap((g) => g.rows);
const drive = { role: "drive" };
// One board for the first two tests, which follow one task from its review to its merge: one agent run, not three.
let w, id;
test.before(async () => {
  w = await world();
  w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f." }], reviewer: [{ verdict: { meets: true, text: "Good.", findings: [{ severity: "minor", subject: "f.txt has no title", where: "f.txt" }] } }] });
  id = A.add(w.root, "Make f", { description: "A file called f." }).id;
  A.delegate(id); await settle(id);
});
test.after(() => w.cleanup());

test("the web board shows the terminal board's list: the same groups, order, marks and words, and one task's whole panel", async () => {
  {
    const mine = A.add(w.root, "Write notes").id; A.report(mine, { state: "working", msg: "Drafting", progress: 40 });
    A.add(w.root, "Later");
    const v = new WebView({ cwd: w.root });
    // the terminal board, on the same tasks: its rows under its headings are what the page gets
    const term = new View({ terminal: { rows: 40, columns: 120 }, requestRender() {}, stop() {}, start() {} }, theme, () => {}, { cwd: w.root }); clearInterval(term.timer);
    const want = []; for (const row of term.rows) { if (row.header) want.push([row.header]); else if (row.rec) want.at(-1).push(row.rec.id); }
    let s = snapshot(v);
    assert.deepEqual(s.list.groups.map((g) => [g.name, ...g.rows.map((r) => r.id)]), want);
    assert.deepEqual(s.list.groups.map((g) => [g.name, g.color]), [["ready to approve", "green"], ["working", "yellow"], ["to do", "overlay0"]]);
    const [ready, working, todo] = rowsOf(s.list);
    assert.deepEqual([ready.title, ready.mark, ready.color, plain(term.sentence(term.items.find((r) => r.id === id)).text)], ["Make f", "✓", "green", ready.says.map((p) => p.t).join("")]);
    assert.equal(ready.says.map((p) => p.t).join(""), "Pass · 1 minor"); assert.equal(ready.says[0].c, "green"); assert.deepEqual(ready.review, [{ t: "R#1", c: "green" }]); assert.match(ready.time, /^\d+s ago$/);
    assert.deepEqual([working.progress, working.percent, working.says.map((p) => p.t).join(""), working.strong, working.live], [40, "40%", "Drafting", true, true]);
    assert.deepEqual([todo.progress, todo.says, todo.live, todo.mark], [null, [], false, "○"]);
    // who is on a task shows without colour here too: the agent's dot, the reviewer's half moon, the board's own; a task that only waits keeps the dot
    { const wv = Object.assign(Object.create(View.prototype), { theme: webTheme }), at = (r) => pieces(wv.mark({ state: "working", ...r }))[0];
      assert.deepEqual(at({ stage: "working" }), { t: "●", c: "yellow" }); assert.deepEqual(at({ stage: "reviewing" }), { t: "◑", c: "review" }); assert.deepEqual(at({ stage: "queued" }), { t: "●", c: "yellow" });
      for (const stage of ["starting", "setup", "checking", "pushing", "merging"]) assert.equal(at({ stage }).t, "◒", stage);
      for (const kind of ["working", "review", "board", "blocked", "done", "idle", "error"]) assert.notEqual(webTheme.mark(kind), webTheme.mark("unknown"), kind); }
    // a page that already has this is told only that
    assert.deepEqual(snapshot(v, s.mark), { same: true, mark: s.mark });
    // one task, whole: the panel's parts under their headlines, each a list of facts and lines of text
    s = CALLS.pick.run(v, { id, open: true });
    assert.equal(s.list.selected, id); assert.equal(s.panel.title, "Make f"); assert.deepEqual(s.panel.parts.map((p) => p.head), ["Status", "Description", "Review", "The agent said", "Settings", "Session"]);
    const fact = (head, label) => s.panel.parts.find((p) => p.head === head).items.find((x) => x.label === label);
    assert.equal(fact("Status", "State").lines[0].map((p) => p.t).join(""), `✓ ready to approve · ${ready.time}`); assert.equal(fact("Status", "State").lines[0][2].c, "green");
    assert.match(fact("Review", "Review 1").lines.map((l) => l.map((p) => p.t).join("")).join("|"), /^✓ Pass · 1 minor · \d+s ago · [0-9a-f]{7}\|Good\.$/);
    assert.match(fact("Review", "Findings").lines[0].map((p) => p.t).join(""), /^minor +f\.txt has no title \(f\.txt\) · not required$/);
    assert.equal(fact("Settings", "Merge").lines[0][0].t, "after your yes");
    assert.deepEqual(s.panel.parts.find((p) => p.head === "Description").items, [{ k: "text", value: [{ t: "A file called f." }] }]);
    // the buttons are the board's own hints, each with the key it presses; the menu is its ? menu
    assert.deepEqual(s.actions.map((b) => [b.id, b.label]), [["yes", "approve and merge this task"], ["sendBack", "send the review to the agent"], ["talk", "talk to the agent"]]);
    assert.equal(s.canOpen, true);
    assert.ok(s.menu.some((m) => m.id === "archive" && m.label === "archive this task") && s.menu.some((m) => m.id === "scope")); assert.equal(s.menu.some((m) => TERMINAL_ONLY.includes(m.id)), false);
    assert.deepEqual([s.send.enter, s.send.delegate, s.send.place], ["add it as a task", "add it and put an agent on it", "what's next?"]);
    // a panel line read back: a headline, a fact (its value may be as grey as its label), what goes on under it, a text
    const t = webTheme, kinds = (line) => readLine(line).k;
    assert.deepEqual(readLine(` ${t.fg("red", t.bold("Asks you"))} ${t.fg("surface1", "────")}`), { k: "head", text: "Asks you", color: "red" });
    assert.deepEqual(readLine(` ${t.muted("Next         ")}${t.muted("No agent yet.")}`), { k: "fact", label: "Next", value: [{ t: "No agent yet.", c: "overlay0" }] });
    assert.deepEqual([kinds(` ${" ".repeat(13)}more of it`), kinds(` ${t.muted("The work has changed since its review.")}`), kinds(""), kinds(" plain words")], ["more", "text", "gap", "text"]);
    assert.deepEqual(pieces(`a \x1b]8;;https://x.y/z\x1b\\${t.underline("PR#3")}\x1b]8;;\x1b\\`), [{ t: "a " }, { t: "PR#3", href: "https://x.y/z" }]);
    // opening the task's agent is a link to the web UI's own view of its pane; each press is a new going
    const task = S.get(id);
    s = CALLS.press.run(v, { id: "enter", ...drive });
    assert.deepEqual(s.go, { n: 1, pane: task.link.pane, workspace: task.link.workspace, view: s.go.view }); assert.ok(["chat", "terminal"].includes(s.go.view));
    assert.equal(CALLS.press.run(v, { id: "enter", ...drive }).go.n, 2);
    // a task nobody was on has no pane to go to, and says so
    CALLS.pick.run(v, { id: mine, open: true });
    const none = CALLS.press.run(v, { id: "enter", ...drive }); assert.equal(none.go.n, 2); assert.match(none.msg.text, /No agent has been on this yet/); assert.equal(none.canOpen, false);
    term.dispose(); v.dispose();
  }
});

test("a button presses the board's own key: a merge asks first, the answer is a key too, and what is typed is sent as enter sends it", async () => {
  {
    // every key of the board that the page can press arrives as that key, and as no other
    for (const k of K.KEYS.filter((x) => !x.fixed)) { const data = bytesOf(k.id); assert.ok(K.is(data, k.id), k.id); assert.deepEqual(K.KEYS.filter((x) => !x.fixed && K.is(data, x.id)).map((x) => x.id), [k.id]); }
    const v = viewOf("phone", () => new WebView({ cwd: w.root }));
    assert.equal(viewOf("phone"), v); assert.notEqual(viewOf("desk", () => new WebView({ cwd: w.root })), v); // each browser has its own selection and question
    CALLS.pick.run(v, { id, open: true });
    // yes: the board asks before a merge, on the page too; no answers it and nothing happened
    let s = CALLS.press.run(v, { id: "yes", ...drive });
    assert.deepEqual(s.ask, { q: 'Merge "Make f"?', detail: "", keys: [{ id: "sayYes", label: "yes" }, { id: "sayNo", label: "no" }] }); assert.deepEqual(s.actions, []);
    s = CALLS.press.run(v, { id: "sayNo", ...drive }); assert.equal(s.ask, null); assert.equal(S.get(id).stage, "approval"); assert.equal(s.draft, "");
    assert.equal(snapshot(viewOf("desk")).ask, null); // the other browser was never asked
    CALLS.press.run(v, { id: "yes", ...drive }); s = CALLS.press.run(v, { id: "sayYes", ...drive });
    assert.equal(s.ask, null); assert.equal(s.msg.kind, "green"); assert.notEqual(S.get(id).stage, "approval");
    // a key that is the terminal's own does nothing here, and a watching device presses only what shows or hides
    const before = snapshot(v).mark; CALLS.press.run(v, { id: "close", ...drive }); CALLS.press.run(v, { id: "menu", ...drive }); assert.equal(v.menu, null);
    assert.throws(() => CALLS.press.run(v, { id: "archive", role: "watch" }), /only watch/); assert.throws(() => CALLS.send.run(v, { text: "x", role: "watch" }), /only watch/);
    s = CALLS.press.run(v, { id: "archiveView", role: "watch" }); assert.equal(s.flags.archive, true); s = CALLS.press.run(v, { id: "archiveView", role: "watch" }); assert.equal(s.flags.archive, false);
    assert.ok(before);
    // typed words: with no Coordinator they are added as a task, word for word; the second button also puts an agent on it
    CALLS.pick.run(v, { id: "", open: false });
    s = CALLS.send.run(v, { text: "Tidy the readme\nand its links", ...drive });
    assert.equal(s.kept, false); assert.match(s.msg.text, /added$/); const added = S.list().find((t) => t.title === "Tidy the readme"); assert.equal(added.description, "and its links");
    assert.equal(CALLS.send.run(v, { text: "   ", ...drive }).kept, false); assert.equal(S.list().length, 4); assert.ok(added);
    // the board's words name a button, not a key, on the page
    CALLS.send.run(v, { text: "Sort the notes", ...drive }); const plainTask = S.list().find((t) => t.title === "Sort the notes");
    s = CALLS.pick.run(v, { id: plainTask.id, open: true });
    assert.match(s.panel.parts[0].items.find((x) => x.label === "Next").lines[0][0].t, /^No agent is on this yet\. “Put an agent on it” puts one on it\.$/);
    assert.deepEqual(s.actions.map((b) => b.id), ["delegate", "talk"]);
    s = CALLS.press.run(v, { id: "stop", ...drive }); assert.match(s.ask.q, /^Remove "Sort the notes"\?/); s = CALLS.press.run(v, { id: "back", ...drive }); assert.equal(s.ask, null); assert.ok(S.get(plainTask.id));
    // find narrows the list; an empty one shows everything again
    s = CALLS.find.run(v, { text: "readme" }); assert.deepEqual(rowsOf(s.list).map((r) => r.title), ["Tidy the readme"]); assert.equal(s.flags.filter, "readme");
    s = CALLS.find.run(v, { text: "" }); assert.equal(rowsOf(s.list).length, 5);
    // the web board keeps its own choices: the terminal board's saved ones are not written
    CALLS.press.run(v, { id: "byRepo", ...drive });
    assert.equal(S.readJson(`${S.dataDir()}/web-view.json`).byRepo, true); assert.equal(S.readJson(`${S.dataDir()}/view.json`).byRepo, false);
  }
});

test("other machines on the web board: their tasks show with the machine's name, and an action goes to the machine that owns the task", async () => {
  {
    S.setValue("board.machines", "vm-a");
    const v = new WebView({ cwd: w.root });
    const asked = [];
    // the other machine, answering as its door does (src/remote.js)
    const theirs = { id: "far/1", title: "Theirs", stage: "working", state: "working", agent: "claude", app: "claude", msg: "", note: "Building", at: Date.now(), created: Date.now(), link: { pane: "w1:p1" }, snap: { folder: "~/far", choices: {} } };
    v.ssh = (m, what, arg, cb) => { asked.push([m.label, what, arg]); cb(what === "list" ? { host: "vm-a", version: "0.2.0", tasks: [theirs] } : { ok: true, msg: "far/1: archived." }); };
    let s = CALLS.press.run(v, { id: "scope", role: "watch" }); // whose board you see only shows: a watching device may
    assert.equal(s.flags.scope, "*"); assert.equal(s.list.head.machines, "vm-a"); assert.match(s.msg.text, /Every machine you can reach/);
    const far = rowsOf(s.list).find((r) => r.host === "vm-a");
    assert.deepEqual([far.id, far.title, far.says.map((p) => p.t).join("")], ["vm-a:far/1", "Theirs", "Building"]);
    s = CALLS.pick.run(v, { id: far.id, open: true }); assert.equal(s.panel.parts.find((p) => p.head === "Settings").items.find((x) => x.label === "Machine").lines[0][0].t.trim(), "vm-a"); assert.equal(s.canOpen, false);
    s = CALLS.press.run(v, { id: "archive", ...drive });
    assert.deepEqual(asked.at(-2), ["vm-a", "do", { action: "archive", id: "far/1" }]); assert.equal(s.msg.text, "far/1: archived.");
    // its agent's pane is on that machine: the board says so instead of opening it
    theirs.archivedAt = null; s = CALLS.pick.run(v, { id: far.id, open: true }); s = CALLS.press.run(v, { id: "enter", ...drive });
    assert.equal(s.go, null); assert.match(s.msg.text, /Its agent runs on vm-a/);
    v.dispose();
  }
});
