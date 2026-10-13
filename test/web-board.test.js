// The web board's data: the same list, panel, buttons, questions and words the terminal board has, read from the
// board's own code, and a button that presses the board's own key. The automations too: their group in the list, one of them
// whole, the same actions, and a firing as a link to the task it made. And other machines: the web UI's PCs (below).
// Last, what the second UI/UX check asked of the page: a draft that keeps who it is for, a merge with no filled yes,
// a More menu of only what applies, no terminal key on the page, and sizes a thumb can hit.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
import { address, same, pcOf, machineOf, readPcs } from "../src/webui/pcs.js";
import * as L from "../src/automations/list.js";
import { parseSchedule, parseEvent } from "../src/automations/triggers.js";
import { fire } from "../src/automations/fire.js";

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
    assert.deepEqual(s.list.groups.map((g) => [g.name, g.color]), [["ready to approve", "green"], ["working", "yellow"], ["to do", "todo"]]);
    const [ready, working, todo] = rowsOf(s.list);
    assert.deepEqual([ready.title, ready.mark, ready.color, plain(term.sentence(term.items.find((r) => r.id === id)).text)], ["Make f", "◆", "green", ready.says.map((p) => p.t).join("")]);
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
    assert.equal(fact("Status", "State").lines[0].map((p) => p.t).join(""), `◆ ready to approve · ${ready.time}`); assert.equal(fact("Status", "State").lines[0][2].c, "green");
    assert.match(fact("Review", "Review 1").lines.map((l) => l.map((p) => p.t).join("")).join("|"), /^✓ Pass · 1 minor · \d+s ago · at [0-9a-f]{7}\|Good\.$/);
    assert.match(fact("Review", "Findings").lines[0].map((p) => p.t).join(""), /^minor +f\.txt has no title \(f\.txt\) · not required$/);
    assert.equal(fact("Settings", "Merge").lines[0][0].t, "after your yes");
    assert.deepEqual(s.panel.parts.find((p) => p.head === "Description").items, [{ k: "text", value: [{ t: "A file called f." }] }]);
    // the buttons are the board's own hints, each with the key it presses; the menu is its ? menu
    assert.deepEqual(s.actions.map((b) => [b.id, b.label]), [["yes", "approve and merge this task"], ["sendBack", "send the review to the agent"], ["talk", "talk to the agent"]]);
    assert.equal(s.canOpen, true);
    assert.ok(s.menu.some((m) => m.id === "archive" && m.label === "archive this task") && s.menu.some((m) => m.id === "scope")); assert.equal(s.menu.some((m) => TERMINAL_ONLY.includes(m.id)), false);
    assert.deepEqual([s.send.enter, s.send.delegate, s.send.place], ["add it as a task", "add it and put an agent on it", "Add a task"]);
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
    // (It names the task, where it lands and that it cannot be undone; `danger`: neither answer is the filled button.)
    assert.deepEqual(s.ask, { q: 'Merge #1 "Make f" into main?', detail: "A merge cannot be undone.", danger: true, keys: [{ id: "sayYes", label: "merge" }, { id: "sayNo", label: "do not merge" }] }); assert.deepEqual(s.actions, []);
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
    assert.match(s.panel.parts[0].items.find((x) => x.label === "Next").lines[0][0].t, /^No agent is on this yet\. “Put an agent on this task” puts one on it\.$/);
    assert.deepEqual(s.actions.map((b) => b.id), ["delegate", "talk"]);
    s = CALLS.press.run(v, { id: "stop", ...drive }); assert.match(s.ask.q, /^Remove #\d+ "Sort the notes"\?/); s = CALLS.press.run(v, { id: "back", ...drive }); assert.equal(s.ask, null); assert.ok(S.get(plainTask.id));
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
    s = CALLS.pick.run(v, { id: far.id, open: true }); assert.equal(s.panel.parts.find((p) => p.head === "Settings").items.find((x) => x.label === "Machine").lines[0][0].t.trim(), "vm-a"); assert.equal(s.canOpen, true); // its agent opens in the web UI's view of that machine (below)
    s = CALLS.press.run(v, { id: "archive", ...drive });
    assert.deepEqual(asked.at(-2), ["vm-a", "do", { action: "archive", id: "far/1" }]); assert.equal(s.msg.text, "far/1: archived.");
    v.dispose();
  }
});

const said = (r) => r.says.map((p) => p.t).join("");
const texts = (part) => part.items.filter((x) => x.k === "text").map((x) => x.value.map((p) => p.t).join(""));

test("the web board has the automations: the last group of its list, one of them whole, the buttons that turn it off, fire it and remove it, and a firing that goes to its task", async () => {
  const w = await world(); // a board of its own, after the shared one: the last test of this file
  try {
    const v = new WebView({ cwd: w.root });
    assert.deepEqual(snapshot(v).list.groups, []); assert.ok(!snapshot(v).menu.some((i) => /automation/.test(i.label))); // none: no group, and no key that shows a list of them
    const a = L.add({ name: "Look for old dependencies", prompt: "Check what is out of date.", trigger: parseSchedule("every 2h"), folder: w.root, settings: { "merge.by": "itself" } });
    const b = L.add({ name: "Release note", prompt: "Write it.", trigger: parseEvent("merged"), folder: w.root });
    L.turn(b.id, false); A.add(w.root, "Mine");
    let s = CALLS.board.run(v, {});
    assert.deepEqual(s.list.groups.map((g) => [g.name, g.rows.length, !!g.automations]), [["to do", 1, false], ["automations", 2, true]]); assert.equal(s.list.selected, "proj/1"); assert.equal(s.flags.automations, undefined); assert.equal(s.flags.onTask, true);
    const [one, two] = s.list.groups[1].rows;
    assert.deepEqual([one.id, one.title, one.mark, one.color, one.quiet, one.tag, said(one)], [`auto:${a.id}`, "Look for old dependencies", "↻", "green", false, "", "every 2h · on · next in 2h"]);
    assert.deepEqual([two.title, two.mark, two.quiet, said(two)], ["Release note", "↻", true, "when a task is merged · off · never fired"]); // off: quiet, and the word
    // on the page its row shows all of what it says, on any width: on or off and the firing are never in a clamped part
    assert.deepEqual([one.automation, two.automation, s.list.groups[0].rows[0].automation], [true, true, undefined]);
    assert.match(fs.readFileSync(new URL("../src/webui/page/board.css", import.meta.url), "utf8"), /\.sw-row\.is-automation \.sw-says \{ display: block; overflow: visible; -webkit-line-clamp: none; \}/);
    // tap one: it opens, whole, with its buttons; a watching device may look
    s = CALLS.pick.run(v, { id: one.id, open: true });
    assert.deepEqual([s.list.selected, s.panel.title, s.panel.automation, s.panel.task, s.flags.open, s.canOpen], [one.id, "Look for old dependencies", true, false, true, false]);
    assert.deepEqual(s.panel.parts.map((p) => p.head), ["Status", "Prompt", "Settings", "Firings"]);
    assert.equal(s.flags.onTask, false); // the chat's first line is no switch here: that key is the automation's own
    assert.match(texts(s.panel.parts[2]).join(" "), /Changed with: herdr-superwork set <name> <value> --automation "Look for old dependencies"/); assert.doesNotMatch(JSON.stringify(s.panel), /ctrl\+/); // no terminal key on the page
    assert.deepEqual(s.panel.parts[0].items.filter((x) => x.k === "fact").map((x) => x.label), ["State", "Trigger", "Next", "Repo", "Last firing"]);
    assert.deepEqual(texts(s.panel.parts[1]), ["Check what is out of date."]); assert.equal(texts(s.panel.parts[2])[0], "merge.by  itself *");
    assert.deepEqual(s.actions, [{ id: "talk", label: "turn this automation off" }, { id: "delegate", label: "fire it now" }, { id: "stop", label: "remove it" }]);
    assert.ok(!s.menu.some((i) => ["archive", "pin", "stop"].includes(i.id))); // More has no entry that acts on a task
    assert.throws(() => CALLS.press.run(v, { id: "delegate", role: "watch" }), /This device can only watch/);
    // fire it now: a task is made and started, and the firing is a link to it
    s = CALLS.press.run(v, { id: "delegate", ...drive });
    assert.match(s.msg.text, /"Look for old dependencies" fired: #2 was added and an agent is on it\./); assert.equal(S.get("proj/2").stage, "starting"); assert.equal(s.list.selected, one.id);
    fire(a, { kind: "schedule" }); s = snapshot(v);
    const lines = s.panel.parts.find((p) => p.head === "Firings").items;
    assert.deepEqual(lines.map((x) => x.go || ""), ["", "proj/2"]); assert.match(texts({ items: lines })[0], /skipped: its last task, proj\/2, is still being worked on/);
    // off and on: off, the button that fires it is gone
    s = CALLS.press.run(v, { id: "talk", ...drive }); assert.equal(S.automation(a.id).on, false); assert.deepEqual(s.actions.map((x) => x.label), ["turn this automation on", "remove it"]);
    CALLS.press.run(v, { id: "talk", ...drive }); assert.equal(S.automation(a.id).on, true);
    // its settings are the terminal board's page: here the board says how they are changed, and no key is swallowed after
    s = CALLS.press.run(v, { id: "settings", ...drive }); assert.match(s.msg.text, /Its settings are changed on the terminal board, or with: herdr-superwork set <name> <value> --automation "Look for old dependencies"/); assert.ok(!v.editing);
    // words typed while it is open are for the Coordinator's place, never for a task: the selection is as it was after
    CALLS.send.run(v, { text: "Another one", to: { id: "", reply: false, scope: "" }, ...drive }); assert.equal(v.sel, one.id); assert.ok(S.list().some((t) => t.title === "Another one"));
    // the firing's link: to that task, in the same list, open
    s = CALLS.pick.run(v, { id: "proj/2", open: true });
    assert.deepEqual([s.list.selected, s.panel.title, s.panel.task, s.panel.automation], ["proj/2", "Look for old dependencies", true, undefined]);
    assert.ok(s.list.groups.flatMap((g) => g.rows).find((r) => r.id === "proj/2").title.endsWith("[auto]"));
    assert.ok(s.panel.parts[0].items.some((x) => x.k === "fact" && x.label === "Made by"));
    // remove: the same question, the same answers
    CALLS.pick.run(v, { id: "proj/2", open: false }); CALLS.pick.run(v, { id: `auto:${b.id}`, open: true });
    s = CALLS.press.run(v, { id: "stop", ...drive }); assert.equal(s.ask.q, 'Remove the automation "Release note"? The tasks it made stay.');
    s = CALLS.press.run(v, { id: "sayYes", ...drive }); assert.deepEqual(S.automations().map((x) => x.name), ["Look for old dependencies"]); assert.equal(s.panel, null);
    // closing an open one leaves it selected in the list; the last one removed takes the group with it
    CALLS.pick.run(v, { id: one.id, open: true }); s = CALLS.pick.run(v, { id: one.id, open: false }); assert.equal(s.panel, null); assert.equal(s.flags.open, false); assert.equal(s.list.selected, one.id);
    L.remove(a.id); s = CALLS.board.run(v, {}); assert.deepEqual(s.list.groups.map((g) => g.name).filter((n) => n === "automations"), []);
  } finally { w.cleanup(); }
});

test("the web board has each task's tag, as the terminal board's rows do: on its row with the width of the column, on the open task, in the chat's line, and find goes to a task by it", () => {
  // On the board the tests above left: two more tasks, with numbers of one and of three digits.
  S.writeJson(path.join(S.tasksDir(), "proj", "seq"), 8); const nine = A.add(w.root, "Number nine").id;
  S.writeJson(path.join(S.tasksDir(), "proj", "seq"), 133); const big = A.add(w.root, "Number one three four").id;
  const v = new WebView({ cwd: w.root }), tags = (s) => Object.fromEntries(rowsOf(s.list).map((r) => [r.id, r.tag])), wide = (s) => Object.fromEntries(rowsOf(s.list).map((r) => [r.id, r.tagWidth]));
  let s = snapshot(v);
  assert.equal(tags(s)[big], "#134"); assert.equal(tags(s)[nine], "#9"); assert.equal(wide(s)[big], 4); assert.equal(wide(s)[nine], 4); // one column, within the limit on the space before a title
  S.setValue("repo.key", "hsw", { repo: "proj" }); v.look(); s = snapshot(v);
  assert.equal(tags(s)[big], "HSW-134"); assert.equal(tags(s)[nine], "HSW-9"); assert.equal(wide(s)[big], 7); assert.equal(wide(s)[nine], 7);
  v.pick(big, true); s = snapshot(v); assert.equal(s.panel.tag, "HSW-134"); assert.equal(s.panel.title, "Number one three four");
  v.press("talk"); s = snapshot(v); assert.equal(s.chat.tag, "HSW-134"); assert.equal(s.chat.name, "Number one three four");
  // The box says who gets your words by its frame too: this task's status colour (nobody started it: the dim grey), and the plain text colour for the Coordinator.
  assert.equal(s.chat.box, "todo"); assert.match(s.send.place, /starts an agent/); v.press("talk"); assert.equal(snapshot(v).chat.box, "text"); v.press("talk");
  v.pick(big); v.find("hsw-9"); assert.equal(v.sel, nine); v.find("#134"); assert.equal(v.sel, big); v.find("");
  S.unsetValue("repo.key", { repo: "proj" });
});

// The page's own code, drawn into a stand-in for the browser's document: enough of it to read back what a part holds.
// As in a browser, replaceChildren writes anything that is not a node out as text: a missing part handed to it as
// `null` shows as the word "null".
class El {
  constructor(tag) { this.tag = tag; this.nodeType = 1; this.kids = []; this.style = {}; this.dataset = {}; this.className = ""; this.hidden = false; this.value = ""; this.scrollHeight = 0; this.clientHeight = 0;
    this.classList = { toggle() {}, remove() {}, add() {} }; }
  append(...xs) { for (const x of xs) this.kids.push(x && x.nodeType ? x : String(x)); }
  replaceChildren(...xs) { this.kids = []; this.append(...xs); }
  addEventListener() {} setAttribute() {} focus() {}
  get childNodes() { return this.kids; }
  get textContent() { return this.kids.map((k) => (typeof k === "string" ? k : k.textContent)).join(""); }
  set textContent(v) { this.kids = [String(v)]; }
}
test("the web page's rows: the tag has a column of its own, so what a task says starts under its title; a narrow list drops every tag at once", async () => {
  const had = { document: globalThis.document, ResizeObserver: globalThis.ResizeObserver };
  const seen = [];
  Object.assign(globalThis, { document: { createElement: (tag) => new El(tag) }, ResizeObserver: class { constructor(run) { this.run = run; } observe(el) { seen.push({ el, run: this.run }); } } });
  try {
    const { rowEl, listEl, tagsFit } = await import("../src/webui/page/list.js");
    const r = { id: "p/2", tag: "#2", tagWidth: 4, mark: "●", color: "blue", title: "Two", time: "5m", says: [{ t: "Running the tests" }], progress: null, review: [], pr: [] };
    const main = rowEl(r, { selected: false, onPick() {} }).kids[1], names = (el) => el.kids.map((k) => k.className);
    assert.deepEqual(names(main), ["sw-id", "sw-line", "sw-says"]); // the tag beside the lines, never inside the first one
    assert.deepEqual(names(main.kids[1]), ["sw-title", "sw-time"]); assert.equal(main.kids[0].style, "min-width:4ch");
    assert.deepEqual(names(rowEl({ ...r, tag: "" }, { selected: false, onPick() {} }).kids[1]), ["sw-line", "sw-says"]);
    // an automation's row is marked as one, so the styles show all of what it says; a task's row is not
    assert.match(rowEl({ ...r, tag: "", automation: true }, { selected: false, onPick() {} }).className, /\bis-automation\b/); assert.doesNotMatch(rowEl(r, { selected: false, onPick() {} }).className, /is-automation/);
    const css = fs.readFileSync(new URL("../src/webui/page/board.css", import.meta.url), "utf8");
    assert.match(css, /\.sw-main \{ display: grid; grid-template-columns: auto minmax\(0, 1fr\)/); assert.match(css, /\.sw-main > \* \{ grid-column: 2; \}/); assert.match(css, /\.sw-no-tags \.sw-main > \.sw-id \{ display: none; \}/);
    // The tags give way together where the widest would leave a title fewer than 16 letters; a wider tag goes sooner.
    assert.equal(tagsFit(400, 4, 6), true); assert.equal(tagsFit(200, 4, 6), false); assert.equal(tagsFit(270, 4, 6), true); assert.equal(tagsFit(270, 9, 6), false); assert.equal(tagsFit(100, 0), true); assert.equal(tagsFit(0, 4), true);
    const list = { groups: [{ name: "working", color: "blue", rows: [r, { ...r, id: "p/140", tag: "HSW-140", tagWidth: 7 }], more: 0 }], jobs: [], selected: "", empty: "" };
    const el = listEl(list, { onPick() {}, onMore() {} }), toggled = []; el.classList.toggle = (name, on) => toggled.push([name, on]);
    assert.equal(seen.length, 1); assert.equal(seen[0].el, el);
    el.clientWidth = 600; seen[0].run(); el.clientWidth = 200; seen[0].run();
    assert.deepEqual(toggled, [["sw-no-tags", false], ["sw-no-tags", true]]);
  } finally { Object.assign(globalThis, had); }
});
test("the web page's chat line shows only what there is: with no task's tag (the Coordinator, a new task) nothing stands in its place", async () => {
  const had = { document: globalThis.document, window: globalThis.window, sessionStorage: globalThis.sessionStorage, requestAnimationFrame: globalThis.requestAnimationFrame };
  Object.assign(globalThis, { document: { createElement: (tag) => new El(tag) }, window: { innerHeight: 800, matchMedia: () => ({ matches: true }) }, sessionStorage: { getItem: () => "", setItem() {} }, requestAnimationFrame() {} });
  try {
    const { chatEl } = await import("../src/webui/page/chat.js");
    const chat = chatEl({ onSend() {}, onPress() {} }), who = chat.el.kids[0];
    const snap = (c, selected = "") => ({ chat: { mark: { t: "+" }, status: "idle", progress: "", text: "", note: "", ...c }, list: { selected }, panel: null, send: { enter: "", delegate: "", place: "" }, role: "drive" });
    const drawn = () => who.kids.map((k) => (typeof k === "string" ? `text:${k}` : `${k.className}:${k.textContent}`));
    chat.update(snap({ tag: "", name: "New task" }));
    assert.deepEqual(drawn(), ["sw-mark:+", "sw-who-name:New task", "sw-who-status:idle"]); assert.doesNotMatch(who.textContent, /null|undefined/);
    chat.update(snap({ name: "Coordinator" })); assert.deepEqual(drawn(), ["sw-mark:+", "sw-who-name:Coordinator", "sw-who-status:idle"]);
    // The box's frame: the plain text colour for the Coordinator, the task's status colour for its agent.
    const box = () => chat.el.kids.at(-1).kids[0].className;
    assert.equal(box(), "sw-card sw-b-text"); chat.update(snap({ name: "Add an undo", toAgent: true, box: "yellow" }, "proj/134")); assert.equal(box(), "sw-card sw-b-yellow");
    { const read = (name) => fs.readFileSync(new URL(`../src/webui/page/${name}.css`, import.meta.url), "utf8"), css = read("board"); for (const c of ["text", "red", "green", "yellow", "teal", "review", "check", "todo", "overlay0"]) assert.ok(read("compose").includes(`.sw-card.sw-b-${c}`), `the page has a frame colour for ${c}`); assert.match(css, /\.sw-c-todo \{ color: var\(--sw-todo\)/); const v = (n) => new RegExp(`--sw-${n}: ([^;]+);`).exec(css)[1]; assert.equal(new Set(["text", "red", "green", "yellow", "teal", "review", "todo"].map(v)).size, 7, "each frame colour is a colour of its own: done is not the green of ready"); }
    chat.update(snap({ tag: "HSW-134", name: "Add an undo", toAgent: true }, "proj/134"));
    assert.deepEqual(drawn(), ["sw-mark:+", "sw-id:HSW-134", "sw-who-name:Add an undo", "sw-who-status:idle", "sw-who-flip:Talk to the Coordinator"]);
    // A reload: the saved words come back with who they were for, before the page knows who it shows. The first
    // drawing must not fail on that; the chip stays, and while another task shows the frame is the plain colour.
    {
      const kept = { "sw-draft": "Only for task one", "sw-draft-to": JSON.stringify({ id: "proj/1", reply: true, scope: "", label: "#1", enter: "send", delegate: "" }) };
      globalThis.sessionStorage = { getItem: (k) => kept[k] ?? null, setItem: (k, v) => { kept[k] = v; }, removeItem: (k) => { delete kept[k]; } };
      const back = chatEl({ onSend() {}, onPress() {} }), card = back.el.kids.at(-1).kids[0], field = card.kids[1], chip = card.kids[2].kids[0];
      assert.equal(field.value, "Only for task one");
      back.update(snap({ tag: "#2", name: "Needs you", toAgent: true, box: "red" }, "proj/2"));
      assert.equal(chip.textContent, "To: #1 · not who is shown above"); assert.equal(chip.hidden, false); assert.equal(chip.className, "sw-to is-locked"); assert.equal(card.className, "sw-card sw-b-text");
      back.update(snap({ tag: "#1", name: "Working", toAgent: true, box: "yellow" }, "proj/1"));
      assert.equal(chip.textContent, "To: #1"); assert.equal(card.className, "sw-card sw-b-yellow"); assert.equal(JSON.parse(kept["sw-draft-to"]).id, "proj/1");
    }
  } finally { Object.assign(globalThis, had); }
});

// ---- across machines: which of the web UI's PCs is which of the board's machines, opening another machine's agent in
// the web UI's own view of that machine's pane, and the board going with the web UI to the PC it is on. No other
// machine is asked for real: a stand-in answers as its door does (src/remote.js).
const pc = (o) => ({ id: "pc-1", name: "far", local: false, profile: "", to: "", port: 0, session: "", connected: true, state: "connected", ...o });

test("a machine of the board and a PC of the web UI are the same one by herdr's id, or by where they connect", () => {
  assert.deepEqual(address("ssh://me@Far.example:2200"), { user: "me", host: "far.example", port: 2200 });
  assert.deepEqual(address("me@far.example", 2200), { user: "me", host: "far.example", port: 2200 });
  assert.deepEqual(address("far"), { user: "", host: "far", port: 0 }); // an SSH alias
  assert.deepEqual(address("ssh://[fd7a::1]:22"), { user: "", host: "[fd7a::1]", port: 22 });
  // herdr's own way to write a saved machine, and the web UI's way to write the PC it was added as
  const m = { id: "79cd", label: "far", target: "ssh://me@far.example:2200", session: "default" };
  assert.equal(same(m, pc({ to: "me@far.example", port: 2200 })), true);
  assert.equal(same(m, pc({ to: "far.example", port: 2200 })), true); // no user said on one side
  assert.equal(same(m, pc({ to: "you@far.example", port: 2200 })), false);
  assert.equal(same(m, pc({ to: "me@far.example" })), false); // a port left out is not taken for another
  assert.equal(same(m, pc({ to: "me@far.example", port: 2200, session: "work" })), false); // another herdr on that machine
  assert.equal(same({ ...m, session: "work" }, pc({ to: "me@far.example", port: 2200, session: "work" })), true);
  assert.equal(same(m, pc({ local: true, to: "me@far.example", port: 2200 })), false);
  // a PC the web UI took from herdr's own list names herdr's id: that decides, whatever the addresses say
  assert.equal(same(m, pc({ profile: "79cd", to: "alias" })), true); assert.equal(same(m, pc({ profile: "other", to: "me@far.example", port: 2200 })), false);
  // a machine named in board.machines has no id and no port
  const named = { target: "me@vm-a", label: "vm-a", session: "" };
  assert.equal(pcOf(named, [pc({ id: "local", local: true }), pc({ id: "x", to: "me@vm-b" }), pc({ id: "y", to: "vm-a" })]).id, "y"); assert.equal(pcOf(named, [pc({ to: "me@vm-b" })]), null);
  assert.equal(machineOf(pc({ to: "vm-a" }), [m, named]), named); assert.equal(machineOf(pc({ to: "nowhere" }), [m, named]), null); assert.equal(pcOf(named, null), null);
  // what the web UI answers, down to what the board needs; an answer that is no list of PCs is none
  const list = readPcs(JSON.stringify({ machines: [{ id: "local", name: "home", kind: "local", enabled: true, state: "connected", snapshot: { panes: [1, 2] } }, { id: "p", name: "far", kind: "ssh", herdr_profile_id: "79cd", target: { destination: "me@far", port: 22, session: "work" }, enabled: false, state: "disconnected" }, { name: "no id" }] }));
  assert.deepEqual(list, [{ id: "local", name: "home", local: true, profile: "", to: "", port: 0, session: "", connected: true, state: "connected" }, { id: "p", name: "far", local: false, profile: "79cd", to: "me@far", port: 22, session: "work", connected: false, state: "turned off" }]);
  for (const bad of ["", "not json", "{}", '{"machines":{}}', '{"error":{"code":"bridge_only"}}']) assert.equal(readPcs(bad), null, bad);
});

test("on the web board another machine's agent opens in the web UI's view of that machine's pane, and what is missing is said plainly", async () => {
  {
    S.setValue("board.machines", "vm-a");
    const v = new WebView({ cwd: w.root });
    const asked = [];
    const theirs = { id: "far/1", title: "Theirs", stage: "working", state: "working", agent: "claude", app: "claude", msg: "", note: "Building", at: Date.now(), created: Date.now(), link: { pane: "w1:p1" }, snap: { folder: "~/far", choices: {} } };
    const todo = { id: "far/2", title: "Not started", stage: "todo", state: "idle", msg: "", at: Date.now(), created: Date.now(), snap: { folder: "~/far", choices: {} } };
    let version = "0.2.0", reopen = { ok: true, msg: "", pane: "w3:p2", workspace: "w3", hasAgent: true };
    v.ssh = (m, what, arg, cb) => { asked.push([m.label, what, arg]); cb(what === "list" ? { host: "vm-a", ...(version ? { version } : {}), tasks: [theirs, todo] } : arg.action === "reopen" ? reopen : { ok: true, msg: "" }); };
    CALLS.press.run(v, { id: "scope", ...drive });
    const open = (pcs) => { CALLS.pick.run(v, { id: "vm-a:far/1", open: true }); v.seeWeb({ pcs, machine: "" }); return CALLS.press.run(v, { id: "enter", ...drive, pcs }); };
    const mine = pc({ id: "pc-9", name: "vm-a", to: "vm-a" });
    // the web UI has that machine as a PC: the machine reopens its own task's space, and the page goes to that pane there
    let s = open([pc({ id: "local", local: true }), mine]);
    assert.deepEqual(asked.at(-1), ["vm-a", "do", { action: "reopen", id: "far/1" }]);
    assert.deepEqual(s.go, { n: 1, machine: "pc-9", pane: "w3:p2", workspace: "w3", view: "chat" }); assert.equal(s.canOpen, true);
    // its agent has exited and could not be restarted: the pane's terminal, as on this machine
    reopen = { ok: true, msg: "", pane: "w3:p2", workspace: "w3", hasAgent: false }; s = open([mine]); assert.deepEqual([s.go.n, s.go.view], [2, "terminal"]);
    // an answer from before the workspace was sent along: a pane's id starts with its space's
    reopen = { ok: true, msg: "", pane: "w7:p1", hasAgent: true }; s = open([mine]); assert.deepEqual([s.go.pane, s.go.workspace], ["w7:p1", "w7"]);
    // the machine refuses, or does not answer: said, and the page goes nowhere
    reopen = { ok: false, msg: "far/1: its worktree is gone" }; s = open([mine]); assert.equal(s.go.n, 3); assert.equal(s.msg.text, "far/1: its worktree is gone");
    reopen = null; s = open([mine]); assert.equal(s.go.n, 3); assert.equal(s.msg.text, "vm-a did not answer");
    reopen = { ok: true, msg: "", pane: "w3:p2", workspace: "w3", hasAgent: true };
    // the web UI has no such PC, has it but not connected, or could not say what it has: each said as what it is
    const before = asked.length;
    s = open([pc({ id: "local", local: true }), pc({ to: "elsewhere" })]); assert.match(s.msg.text, /^The web UI has no PC for vm-a \(.*@vm-a\)\. Add it there \(Settings → Remote PCs → Add PC\)/);
    s = open([{ ...mine, connected: false, state: "reconnecting" }]); assert.equal(s.msg.text, "vm-a is not connected in the web UI (reconnecting). Connect it there, then open the agent again.");
    v.pcs = null; CALLS.pick.run(v, { id: "vm-a:far/1", open: true }); s = CALLS.press.run(v, { id: "enter", ...drive }); assert.match(s.msg.text, /^The web UI did not say which PCs it has/);
    assert.equal(asked.length - before, 0); assert.equal(s.go.n, 3); // and the other machine is not asked to open anything
    // a task there that no agent has been on has nothing to open
    CALLS.pick.run(v, { id: "vm-a:far/2", open: true }); s = CALLS.press.run(v, { id: "enter", ...drive, pcs: [mine] }); assert.equal(s.canOpen, false); assert.match(s.msg.text, /^No agent has been on this yet/);
    // a machine on an older plugin cannot reopen a space: the pane it last named is opened, and the board says to update
    version = ""; v.pollRemotes(true); s = open([mine]);
    assert.deepEqual(s.go, { n: 4, machine: "pc-9", pane: "w1:p1", workspace: "w1", view: "chat" }); assert.equal(s.msg.text, "Update herdr-superwork on vm-a: it cannot reopen a closed space yet."); assert.notEqual(asked.at(-1)[2]?.action, "reopen");
    v.dispose();
  }
});

test("the web board goes with the web UI: on another PC it is that machine's board, and back on this one what it was", async () => {
  {
    S.setValue("board.machines", "vm-a vm-b");
    const v = new WebView({ cwd: w.root });
    v.ssh = (m, what, arg, cb) => cb(what === "list" ? { host: m.label, version: "0.2.0", tasks: [] } : { ok: true, msg: "" });
    v.scope = ""; v.msg = ""; // the test before left every machine showing
    const pcs = [pc({ id: "local", name: "home", local: true }), pc({ id: "pc-a", name: "vm-a", to: "vm-a" }), pc({ id: "pc-x", name: "stranger", to: "nowhere" })];
    const board = (machine, list = pcs) => { v.seeWeb({ pcs: list, machine }); return CALLS.board.run(v, {}); };
    // this machine's page: nothing changes, whatever the board showed
    let s = board(""); assert.equal(s.flags.scope, ""); assert.equal(s.msg, null);
    // the web UI goes to vm-a: that machine's board by itself, as the terminal board's own key shows it
    s = board("pc-a"); assert.equal(s.flags.scope, "vm-a"); assert.equal(s.list.head.only, "vm-a"); assert.equal(s.msg.text, "Only vm-a. What you type goes to vm-a.");
    // what a page opened later starts with is what this one showed before it went there, not where the web UI was
    assert.equal(S.readJson(v.webPrefs).scope, "");
    // while it stays there, a choice of your own stands
    CALLS.press.run(v, { id: "scope", ...drive }); const chosen = v.scope; s = board("pc-a"); assert.equal(s.flags.scope, chosen);
    // back on this machine: what the board showed before it went
    s = board(""); assert.equal(s.flags.scope, "");
    v.setScope("*"); s = board("pc-a"); assert.equal(s.flags.scope, "vm-a"); s = board("local"); assert.equal(s.flags.scope, "*");
    // a PC the board has no machine for: said, and the board stays as it is
    s = board("pc-x"); assert.equal(s.flags.scope, "*"); assert.match(s.msg.text, /^The web UI is on stranger, which the board knows no machine for: add it with herdr machine add/);
    // the machine is added while the web UI stays on that PC: said once, looked for again after a few seconds, and
    // the board then goes there by itself
    s = board("pc-x"); assert.equal(s.msg.n, v.msgN); const said = v.msgN; board("pc-x"); assert.equal(v.msgN, said);
    S.setValue("board.machines", "vm-a vm-b nowhere"); s = board("pc-x"); assert.equal(s.flags.scope, "*"); // not asked again at once
    v.strangerTried = Date.now() - 11000; s = board("pc-x"); assert.equal(s.flags.scope, "nowhere"); assert.equal(s.msg.text, "Only nowhere. What you type goes to nowhere.");
    S.setValue("board.machines", "vm-a vm-b"); s = board(""); assert.equal(s.flags.scope, "*");
    // also straight from another PC's board: it does not go on showing that one under the new PC's name
    s = board("pc-a"); assert.equal(s.flags.scope, "vm-a"); s = board("pc-x"); assert.equal(s.flags.scope, "*"); assert.match(s.msg.text, /The board shows what it showed before\.$/);
    s = board(""); assert.equal(s.flags.scope, "*");
    // the web UI's list has not come (or it has no such PC): nothing happens until it has
    v.pcs = null; s = board("pc-a", null); assert.equal(s.flags.scope, "*"); s = board("pc-a"); assert.equal(s.flags.scope, "vm-a");
    v.dispose();
  }
});

// ---- the second UI/UX check on the web Board (its own board: after the tests that share one) ---------------------------
const failing = { text: "No.", meets: false, pass: false, gate: "major", findings: [{ id: "F1", severity: "critical", subject: "Loses data", where: "a.js" }] };

test("the web board: a draft goes to who it was typed for, a merge has no filled yes, and the page speaks web", async () => {
  const w = await world();
  try {
    const one = A.add(w.root, "First").id, two = A.add(w.root, "Second").id;
    const bad = A.add(w.root, "Add an undo").id; S.update(bad, (x) => { Object.assign(x, { stage: "approval", app: "claude", agent: "claude", review: failing, reviewRound: 1, summary: "Done." }); });
    const v = new WebView({ cwd: w.root });
    // Words typed while the first task was open, for that task; meanwhile another task was tapped. They go to the
    // first all the same (here: they start its agent's description), and the view stays on what you looked at.
    v.pick(one, true); v.press("talk"); assert.equal(v.reply, true); assert.equal(v.replyId, one);
    v.pick(two, true); assert.equal(v.sel, two);
    const before = S.get(two).description || "";
    const out = v.send("for the first one", false, { id: one, reply: true });
    assert.equal(out.kept, false); assert.equal(v.sel, two, "the view is where you left it"); assert.equal(S.get(two).description || "", before, "the task you tapped got nothing");
    assert.ok(/for the first one/.test(S.get(one).description || "") || S.get(one).stage !== "todo", "the task they were for got them");
    // A task that is gone meanwhile: nothing is sent, the words stay on the page.
    assert.deepEqual(v.send("too late", false, { id: "proj/99", reply: true }), { kept: true }); assert.match(v.msg, /is gone\. Nothing was sent\./);
    // For the Coordinator (none here: a new task), whatever task is open: never a reply to it.
    const n = S.list().length; v.pick(two, true); v.press("talk"); v.send("A brand new task", false, { id: "", reply: false });
    assert.equal(S.list().length, n + 1); assert.equal(v.sel, two);
    // A draft for one machine's Coordinator goes to that machine, also after the view moved to another one; a
    // machine that is gone meanwhile gets nothing, and nobody gets the words in its place.
    {
      const got = []; v.remotes = Object.fromEntries(["vm-a", "vm-b"].map((label) => [label, { label, ok: true, items: [] }]));
      v.ssh = (m, what, args, cb) => { got.push([m.label, what, args.text]); cb?.({ ok: true, msg: "ok" }); }; v.pollRemotes = () => {};
      v.scope = "vm-b"; v.load();
      assert.equal(v.send("Words meant for vm-a", false, { id: "", reply: false, scope: "vm-a" }).kept, false);
      assert.deepEqual(got, [["vm-a", "dispatch", "Words meant for vm-a"]]); assert.equal(v.scope, "vm-b", "the view is where you left it");
      assert.deepEqual(v.send("For a machine that left", false, { id: "", reply: false, scope: "vm-c" }), { kept: true }); assert.match(v.msg, /vm-c is not among the machines you can reach now\. Nothing was sent\./); assert.equal(got.length, 1);
      v.scope = ""; v.remotes = {}; v.load();
    }
    // The merge question of work whose review failed: what it is, what failed, and `danger`: neither answer is filled.
    v.pick(bad, true); v.press("yes");
    let s = snapshot(v);
    assert.equal(s.ask.danger, true); assert.match(s.ask.q, /^Merge #3 "Add an undo" into \S+\?$/); assert.match(s.ask.detail, /^Its last review failed: 1 critical\. A merge cannot be undone\.$/);
    assert.deepEqual(s.ask.keys, [{ id: "sayYes", label: "merge anyway" }, { id: "sayNo", label: "do not merge" }]);
    v.press("sayNo"); assert.equal(S.get(bad).stage, "approval");
    // More: only what applies, each a button's own words; nothing that names a terminal key, nothing for a key the page has no button for.
    s = snapshot(v);
    const ids = s.menu.map((i) => i.id);
    assert.ok(!ids.includes("yes") && !ids.includes("sendBack") && !ids.includes("settings") && !ids.includes("undo") && !ids.includes("close") && !ids.includes("free"), ids.join(" "));
    assert.ok(ids.includes("stop") && ids.includes("archive") && ids.includes("pin") && ids.includes("scope"));
    assert.equal(s.menu.find((i) => i.id === "scope").label, "show every machine's tasks (now: this machine)");
    const said = JSON.stringify(s);
    assert.doesNotMatch(said, /ctrl\+|alt\+|\bshift\+/, "no terminal key anywhere on the page");
    assert.match(said, /Change one with: herdr-superwork set <name> <value> --task proj\/3/); assert.doesNotMatch(said, /this task's own, not what it would be/);
    // The header says the repo by its name: no folder path, nothing for the home folder.
    assert.equal(s.list.head.where, "proj");
    // The actions row: the review goes back first, and the yes says what it is.
    assert.deepEqual(s.actions.slice(0, 2).map((b) => b.label), ["send the review to this task's agent", "merge this task anyway"]);
  } finally { w.cleanup(); }
});

test("the page's styles: nothing read under 13px, targets a thumb can hit, one heading case, round marks drawn at one size", () => {
  const css = fs.readFileSync(new URL("../src/webui/page/board.css", import.meta.url), "utf8");
  assert.match(css, /--fs-2xs: 13px; --fs-xs: 13px;/); assert.doesNotMatch(css, /text-transform: uppercase/);
  assert.doesNotMatch(css, /min-height: (2\d|3\d)px/, "no tap target under 40px");
  for (const part of ["full", "right", "bottom"]) assert.match(css, new RegExp(`\\.sw-dot-${part} \\{`));
  assert.match(css, /\.sw-board\.has-task \.sw-back \{ display: none; \}/, "one back arrow at a time on a phone");
  assert.match(css, /\.sw-row\.is-selected \{[^}]*box-shadow: inset 3px 0 0 var\(--accent/, "the selected row has a bar in its gutter, not a tint alone");
  const chat = fs.readFileSync(new URL("../src/webui/page/chat.js", import.meta.url), "utf8"), sheets = fs.readFileSync(new URL("../src/webui/page/sheets.js", import.meta.url), "utf8");
  // The draft is kept with who it is for: a reload brings both back, so the words never go to whoever shows then.
  assert.match(chat, /sessionStorage\.setItem\(TO, JSON\.stringify\(to\)\)/); assert.match(chat, /if \(box\.value\.trim\(\)\) to = savedTo\(\);/); assert.match(chat, /keep\(box\.value, to\)/); assert.match(chat, /scope: to\.scope \|\| ""/); assert.match(chat, /scope: snap\.flags\?\.scope \|\| ""/);
  assert.match(chat, /`To: \$\{whom\.label\}/); assert.match(sheets, /!ask\.danger \? "\.btn-primary" : ""/);
});
