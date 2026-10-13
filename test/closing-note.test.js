// Where an agent writes for the board: the task's own folder in the board's data folder, never the folder it works
// in; the old place is still read for agents started with the old rule; a cleaned-up task leaves no note behind.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { rules } from "../src/delegate.js";
import { reviewBrief } from "../src/finish/review-brief.js";

const write = (file, text, ahead = 50) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); const at = new Date(Date.now() + ahead); fs.utimesSync(file, at, at); };
const endTurn = (w, t) => w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = "done"; p.agent.seq = s.seq; p.agent.completion = s.seq; });
// A task whose agent is in its first turn, in a plain folder: no worktree, so it works in the folder itself.
async function working(w, title = "Plain folder") {
  w.script({ worker: [{ note: null, status: "working" }] });
  const id = A.add(w.root, title).id;
  A.delegate(id);
  const t = await settle(id);
  assert.equal(t.stage, "working");
  return t;
}

test("the closing note and the review's files are in the task's own folder; the folder worked in gets nothing, and loses nothing", async () => {
  const w = await world({ repo: false });
  try {
    const t = await working(w), dir = S.dirOf(t.id);
    assert.equal(t.ownNote, true);
    assert.equal(F.noteFile(t), path.join(dir, "closing-note.md")); assert.equal(F.reviewDir(t), path.join(dir, "review"));
    assert.ok(F.noteFile(t).startsWith(path.resolve(S.dataDir()) + path.sep));
    assert.ok(!fs.existsSync(path.join(w.root, ".herdr-superwork")));
    // both are told the full path, and neither is told to write into the folder it is in
    const said = [rules(t), F.noteRule(t), reviewBrief(t, { text: "Did it.", change: { head: "abc1234" }, toLand: true, ch: S.work(t) }), ...w.state().panes.flatMap((p) => p.agent?.prompts || [])].join("\n");
    assert.ok(said.includes(F.noteFile(t))); assert.ok(said.includes(`${F.reviewDir(t)}/verdict.json`));
    assert.doesNotMatch(said, /(^|[\s"'`(])\.herdr-superwork\//m);
    // a task this version started is never looked for in the folder it works in
    const old = path.join(w.root, ".herdr-superwork"), evidence = path.join(old, `review-${t.n}`, "evidence.txt");
    write(F.oldNoteFile(t), "Left by something else."); write(evidence, "kept");
    assert.equal(F.noteStat(t), null);
    assert.equal(F.noteStat({ ...t, ownNote: undefined }).text, "Left by something else.");
    // cleaned up: its own note is gone, and nothing was removed from that folder, whatever the files are called
    write(F.noteFile(t), "Done here.");
    endTurn(w, t);
    const done = await settle(t.id);
    assert.equal(done.stage, "done"); assert.equal(done.msg, "Done here."); assert.ok(done.cleaned); assert.ok(!fs.existsSync(F.noteFile(done)));
    assert.equal(fs.readFileSync(F.oldNoteFile(done), "utf8"), "Left by something else."); assert.equal(fs.readFileSync(evidence, "utf8"), "kept");
    await A.clear(t.id);
    assert.equal(S.get(t.id), null); assert.deepEqual(fs.readdirSync(old).sort(), [`closing-${t.n}.md`, `review-${t.n}`]);
  } finally { w.cleanup(); }
});

test("an agent started with the old rule is still heard: its note in the folder it works in is read, and removed with the task", async () => {
  const w = await world({ repo: false });
  try {
    // two tasks an older version started: nothing says their notes are in their own folders
    const old = path.join(w.root, ".herdr-superwork");
    const a = await working(w, "First"), b = await working(w, "Second");
    for (const t of [a, b]) S.update(t.id, (t) => { delete t.ownNote; });
    write(F.oldNoteFile(a), "Old place, first."); write(path.join(old, "mine.txt"), "something of yours");
    endTurn(w, a);
    let t = await settle(a.id);
    assert.equal(t.stage, "done"); assert.equal(t.msg, "Old place, first."); assert.ok(t.cleaned);
    // its own note is gone; the folder holds something else, so it stays as it is
    assert.deepEqual(fs.readdirSync(old), ["mine.txt"]);
    // the newer note wins when both places have one, and an old folder that ends up empty goes
    fs.rmSync(path.join(old, "mine.txt"));
    write(F.oldNoteFile(b), "Old place, second.", 50); write(F.noteFile(b), "New place, second.", 500);
    endTurn(w, b);
    t = await settle(b.id);
    assert.equal(t.stage, "done"); assert.equal(t.msg, "New place, second.");
    assert.ok(!fs.existsSync(old)); assert.ok(!fs.existsSync(F.noteFile(t)));
  } finally { w.cleanup(); }
});
