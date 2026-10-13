// The settings page of a task: every work setting by its plain label and its name with the place it comes from, moving to a row, changing
// it, the mark on the rows that are the task's own, the one key that puts a row back, and the page owning its keys.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers.js";
import { open, keyed } from "./board-helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";

// A row of the page: the line that ends in the setting's name.
const rowOf = (text, name) => text.split("\n").find((l) => new RegExp(` ${name.replace(".", "\\.")} *$`).test(l)) || "";

test("the settings page: every work setting, where each comes from, and a mark on this task's own", async () => {
  const w = await world({ repoSettings: { check: { command: "npm test" } } });
  try {
    const id = A.add(w.root, "One").id;
    S.setValue("review.rounds", 5); S.setValue("merge.by", "itself", { repo: "proj" }); S.setValue("reviewer.agent", "claude", { task: S.get(id) });
    const s = open(w, { rows: 60 }); s.v.sel = id; s.v.load(); // tall enough for every row (a short window scrolls with the selection)
    s.press("ctrl+e");
    const text = s.text(120);
    // The page names the task as its row does, and its hints are its own: the keys that act here, nothing of the list's.
    assert.match(text, /^ Settings {2}#1 "One"/); assert.match(text, keyed(/\n {2}↑ ↓ move · enter change · {putBack} put back · esc back to the task *$/));
    assert.doesNotMatch(text, /Coordinator|put an agent|all keys/);
    // What cannot apply is not offered: fast mode, for a program that has none (both roles run claude here).
    const hidden = ["worker.fast", "reviewer.fast"];
    for (const name of S.WORK) assert.equal(!!rowOf(text, name), !hidden.includes(name), name);
    for (const name of S.BOARD) assert.equal(rowOf(text, name), "", name); // yours only: not on a task's page
    // A row: the plain label first, the value, the place it comes from, and the name a command takes.
    assert.match(rowOf(text, "worker.agent"), /^▌› {3}Agent's program +claude +built in +worker\.agent *$/); // the first row is selected
    assert.match(rowOf(text, "reviewer.agent"), /^ {3}\* Reviewer's program +claude +this task +reviewer\.agent *$/);
    assert.match(rowOf(text, "review.rounds"), /^ {5}Rounds by itself +5 +you +review\.rounds *$/);
    assert.match(rowOf(text, "merge.by"), /^ {5}Merged by +itself +your entry for proj +merge\.by *$/);
    assert.match(rowOf(text, "check.command"), /^ {5}Check command +npm test +the repo's file +check\.command *$/);
    assert.match(rowOf(text, "workspace.cleanup"), /^ {5}Clean up when done +on +built in +workspace\.cleanup *$/); // a switch reads on or off
    // The line on top is the selected row's: what it may be.
    assert.match(text, /\n Agent's program: a program \(claude, codex or pi\), with a model after a slash if you like *\n/);
    s.press("down", "down"); assert.match(s.text(120), /\n Agent's access: \[full\] · ask *\n/); s.press("up", "up");
    assert.match(text, /\* this task's own\. Every other row says the place its value comes from\./); assert.match(text, /Board settings are yours only: herdr-superwork show/);
    // esc goes back one step, to the whole task: it says how to get here, and stars the same choice
    s.press("esc"); assert.equal(s.v.editing, null); assert.equal(s.v.full, true); // back to the whole task, one step
    s.v.panelTop = 1e9; assert.match(s.text(120), /\n Reviewer +claude · default model · default effort · no fast mode in claude \*/); assert.match(s.text(120), keyed(/{settings} changes them: every setting, and the place each one comes from/));
  } finally { w.cleanup(); }
});

test("the settings page: move to a row, change it (a choice goes to its next value, anything else is typed), and one key puts it back", async () => {
  const w = await world();
  try {
    const id = A.add(w.root, "One").id, other = A.add(w.root, "Two").id;
    const s = open(w); s.v.sel = id; s.v.load();
    const mine = () => S.get(id).settings, names = () => s.v.editRows(s.v.current()).map((x) => x.name), at = () => names()[s.v.editing.at];
    const go = (name) => { while (at() !== name) s.press(names().indexOf(name) > s.v.editing.at ? "down" : "up"); };
    s.press("ctrl+e"); assert.equal(at(), "worker.agent");
    s.press("up"); assert.equal(at(), "worker.agent"); s.press("down"); assert.equal(at(), "worker.effort"); // the arrows move between rows, not between tasks
    assert.equal(s.v.sel, id);
    // a switch and a choice: enter goes to the next value, saved at once, for this task only
    go("workspace.cleanup"); s.press("enter"); assert.deepEqual(mine(), { "workspace.cleanup": false });
    assert.match(rowOf(s.text(120), "workspace.cleanup"), /^▌› \* Clean up when done +off +this task +workspace\.cleanup *$/);
    assert.match(s.text(120), /\n Clean up when done: on · \[off\] *\n/); // the values it may be, the one it is now marked
    // only the page's own keys act here: no key of the list archives, merges, removes or pins the task from its settings page
    for (const k of ["ctrl+a", "ctrl+l", "ctrl+x", "ctrl+r", "ctrl+p", "tab", "space", "?", "alt+a", "alt+m", "x"]) { s.press(k); assert.ok(s.v.editing, k); assert.equal(s.v.ask, null, k); assert.equal(s.v.menu, null, k); assert.equal(s.v.value(), "", k); assert.equal(s.v.archiveView, false, k); }
    assert.ok(!S.get(id).archivedAt && !S.get(id).pinned && S.get(id).stage === "todo"); assert.equal(S.list().length, 2);
    go("review.when"); s.press("enter"); assert.equal(mine()["review.when"], "never"); s.press("enter"); assert.equal(mine()["review.when"], "always");
    go("merge.by"); s.press("enter"); assert.equal(mine()["merge.by"], "itself"); assert.equal(S.setting("merge.by"), "you"); assert.deepEqual(S.get(other).settings, {});
    // anything else is typed in the box: enter saves it, esc leaves it as it was
    go("worker.agent"); s.press("enter"); assert.equal(s.v.editing.typing, "worker.agent"); assert.match(s.text(120).replace(/\s+/g, " "), /Type the new value for Agent's program below \(now: claude\): a program \(claude, codex or pi\), with a model after a slash if you like\./);
    assert.match(s.text(120), /\n {2}enter save this value · esc leave it as it is *$/); assert.doesNotMatch(s.text(120), /Coordinator|add it as a task/); // while a value is typed the hints are the page's too
    s.type("codex/gpt-5.5"); s.press("enter"); assert.equal(mine()["worker.agent"], "codex/gpt-5.5"); assert.equal(s.v.editing.typing, ""); assert.equal(s.v.value(), "");
    assert.match(rowOf(s.text(120), "worker.agent"), /^▌› \* Agent's program +codex\/gpt-5\.5 +this task +worker\.agent *$/);
    assert.ok(names().includes("worker.fast"), "codex has a fast mode: its row is offered now"); assert.equal(S.list().length, 2); // typed words never became a task
    s.press("enter"); assert.equal(s.v.value(), ""); s.type("claude/opus"); s.press("enter"); assert.equal(mine()["worker.agent"], "claude/opus"); // the box starts empty: what is typed is the whole value
    s.press("enter"); s.type("codex/gpt-5.5"); s.press("enter");
    go("check.timeout"); s.press("enter"); s.type("20m"); s.press("esc"); assert.equal(mine()["check.timeout"], undefined); assert.equal(s.v.value(), ""); assert.ok(s.v.editing);
    // a value that is refused says why, changes nothing, and what was typed stays to be put right
    s.press("enter"); s.type("20"); s.press("enter");
    assert.match(s.text(120), /check\.timeout is a time with a unit, such as 15m \(s, m or h\), not "20"\. Did you mean 20m\?/); assert.equal(mine()["check.timeout"], undefined); assert.equal(s.v.value(), "20");
    s.press("esc"); s.type("m"); assert.equal(s.v.value(), "20m"); s.press("enter"); assert.equal(mine()["check.timeout"], "20m");
    // one key puts the selected row back; on a row that is not this task's own it only says where the value is from
    s.press("ctrl+u"); assert.equal(mine()["check.timeout"], undefined); assert.match(rowOf(s.text(120), "check.timeout"), /^▌› {3}Check may run for +15m +built in +check\.timeout *$/);
    s.press("ctrl+u"); assert.match(s.text(120), /check\.timeout is not this task's own: it comes from built in\./);
    go("merge.by"); s.press("ctrl+u"); assert.deepEqual(mine(), { "workspace.cleanup": false, "review.when": "always", "worker.agent": "codex/gpt-5.5" });
    // esc goes back to the task, then to the list; an archived task's settings can be read, not changed
    s.press("esc"); assert.equal(s.v.editing, null);
    A.archive(id); s.v.archiveView = true; s.v.load(); s.v.sel = id; s.v.load(); s.press("ctrl+e"); assert.ok(s.v.editing); s.press("enter");
    assert.match(s.text(120), /Archived tasks are read-only/); assert.equal(S.get(id).settings["worker.agent"], "codex/gpt-5.5");
  } finally { w.cleanup(); }
});
