// The settings page of a task: every work setting by its name with the place it comes from, moving to a row, changing
// it, the mark on the rows that are the task's own, and the one key that puts a row back.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers.js";
import { open } from "./board-helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";

const rowOf = (text, name) => text.split("\n").find((l) => new RegExp(` ${name.replace(".", "\\.")} `).test(l)) || "";

test("the settings page: every work setting, where each comes from, and a mark on this task's own", async () => {
  const w = await world({ repoSettings: { check: { command: "npm test" } } });
  try {
    const id = A.add(w.root, "One").id;
    S.setValue("review.rounds", 5); S.setValue("merge.by", "itself", { repo: "proj" }); S.setValue("reviewer.agent", "claude", { task: S.get(id) });
    const s = open(w, { rows: 60 }); s.v.sel = id; s.v.load(); // tall enough for every row (a short window scrolls with the selection)
    s.press("ctrl+e");
    const text = s.text(120);
    assert.match(text, /^ Settings {2}proj\/1/); assert.match(text, /↑ ↓ move · enter change · ctrl\+u put back · esc back/);
    for (const name of S.WORK) assert.ok(rowOf(text, name), name);
    for (const name of S.BOARD) assert.equal(rowOf(text, name), "", name); // yours only: not on a task's page
    assert.match(rowOf(text, "worker.agent"), /^ › {3}worker\.agent +claude +built in *$/); // the first row is selected
    assert.match(rowOf(text, "reviewer.agent"), /^ {3}\* reviewer\.agent +claude +this task *$/);
    assert.match(rowOf(text, "review.rounds"), /^ {5}review\.rounds +5 +you *$/);
    assert.match(rowOf(text, "merge.by"), /^ {5}merge\.by +itself +your entry for proj *$/);
    assert.match(rowOf(text, "check.command"), /^ {5}check\.command +npm test +the repo's file *$/);
    assert.match(text, /\* this task's own\. Every other row says the place its value comes from\./); assert.match(text, /Board settings are yours only: herdr-superwork show/);
    // esc goes back one step, to the whole task: it says how to get here, and stars the same choice
    s.press("esc"); assert.equal(s.v.editing, null); assert.equal(s.v.full, true); // back to the whole task, one step
    s.v.panelTop = 1e9; assert.match(s.text(120), /\n Reviewer +claude · default model, effort · no fast mode in claude \*/); assert.match(s.text(120), /ctrl\+e changes them: every setting, and the place each one comes from/);
  } finally { w.cleanup(); }
});

test("the settings page: move to a row, change it (a choice goes to its next value, anything else is typed), and one key puts it back", async () => {
  const w = await world();
  try {
    const id = A.add(w.root, "One").id, other = A.add(w.root, "Two").id;
    const s = open(w); s.v.sel = id; s.v.load();
    const mine = () => S.get(id).settings, at = () => S.WORK[s.v.editing.at];
    const go = (name) => { while (at() !== name) s.press(S.WORK.indexOf(name) > s.v.editing.at ? "down" : "up"); };
    s.press("ctrl+e"); assert.equal(at(), "worker.agent");
    s.press("up"); assert.equal(at(), "worker.agent"); s.press("down"); assert.equal(at(), "worker.effort"); // the arrows move between rows, not between tasks
    assert.equal(s.v.sel, id);
    // a switch and a choice: enter goes to the next value, saved at once, for this task only
    go("worker.fast"); s.press("enter"); assert.deepEqual(mine(), { "worker.fast": true });
    assert.match(rowOf(s.text(120), "worker.fast"), /^ › \* worker\.fast +true +does nothing: claude has no fast mode *$/);
    go("review.when"); s.press("enter"); assert.equal(mine()["review.when"], "never"); s.press("enter"); assert.equal(mine()["review.when"], "always");
    go("merge.by"); s.press("enter"); assert.equal(mine()["merge.by"], "itself"); assert.equal(S.setting("merge.by"), "you"); assert.deepEqual(S.get(other).settings, {});
    // anything else is typed in the box: enter saves it, esc leaves it as it was
    go("worker.agent"); s.press("enter"); assert.equal(s.v.editing.typing, "worker.agent"); assert.match(s.text(120), /Type the new value for worker\.agent below \(now: claude\)\. enter saves it, esc leaves it as it is\./);
    s.type("codex/gpt-5.5"); s.press("enter"); assert.equal(mine()["worker.agent"], "codex/gpt-5.5"); assert.equal(s.v.editing.typing, ""); assert.equal(s.v.value(), "");
    assert.match(rowOf(s.text(120), "worker.agent"), /^ › \* worker\.agent +codex\/gpt-5\.5 +this task *$/); assert.equal(S.list().length, 2); // typed words never became a task
    s.press("enter"); assert.equal(s.v.value(), ""); s.type("claude/opus"); s.press("enter"); assert.equal(mine()["worker.agent"], "claude/opus"); // the box starts empty: what is typed is the whole value
    s.press("enter"); s.type("codex/gpt-5.5"); s.press("enter");
    go("check.timeout"); s.press("enter"); s.type("20m"); s.press("esc"); assert.equal(mine()["check.timeout"], undefined); assert.equal(s.v.value(), ""); assert.ok(s.v.editing);
    // a value that is refused says why, changes nothing, and what was typed stays to be put right
    s.press("enter"); s.type("20"); s.press("enter");
    assert.match(s.text(120), /check\.timeout is a time with a unit, such as 15m \(s, m or h\), not "20"\. Did you mean 20m\?/); assert.equal(mine()["check.timeout"], undefined); assert.equal(s.v.value(), "20");
    s.press("esc"); s.type("m"); assert.equal(s.v.value(), "20m"); s.press("enter"); assert.equal(mine()["check.timeout"], "20m");
    // one key puts the selected row back; on a row that is not this task's own it only says where the value is from
    s.press("ctrl+u"); assert.equal(mine()["check.timeout"], undefined); assert.match(rowOf(s.text(120), "check.timeout"), /^ › {3}check\.timeout +15m +built in *$/);
    s.press("ctrl+u"); assert.match(s.text(120), /check\.timeout is not this task's own: it comes from built in\./);
    go("merge.by"); s.press("ctrl+u"); assert.deepEqual(mine(), { "worker.fast": true, "review.when": "always", "worker.agent": "codex/gpt-5.5" });
    // esc goes back to the task, then to the list; an archived task's settings can be read, not changed
    s.press("esc"); assert.equal(s.v.editing, null);
    A.archive(id); s.v.archiveView = true; s.v.load(); s.v.sel = id; s.v.load(); s.press("ctrl+e"); assert.ok(s.v.editing); s.press("enter");
    assert.match(s.text(120), /Archived tasks are read-only/); assert.equal(S.get(id).settings["worker.agent"], "codex/gpt-5.5");
  } finally { w.cleanup(); }
});
