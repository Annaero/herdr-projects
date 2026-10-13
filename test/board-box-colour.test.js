// The text box says who you type to by colour: the plain text colour for the Coordinator, the task's status colour for its agent.
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { world } from "./helpers.js";
import * as A from "../src/actions.js";
import * as S from "../src/store.js";
import { theme } from "../src/board/theme.js";
import { GROUP_COLOR, groupOf, statusColor } from "../src/board/view/states.js";
import { open } from "./board-helpers.js";

// The colour code a colour name is painted with; where a colour starts on a line.
const on = (c) => theme.fg(c, "\0").split("\0")[0];
const starts = (line, c, what) => assert.ok(String(line).startsWith(on(c)), `${what}: starts in ${c}`);
// Every status a task can be in, with the colour its mark has in the list.
const STATUSES = [
  ["working", { state: "working", stage: "working", agent: "claude", link: { pane: "p1" } }, "yellow"],
  ["needs you", { state: "blocked", kind: "question", stage: "working", agent: "claude", link: { pane: "p1" } }, "red"],
  ["went wrong", { state: "error", stage: "failed", agent: "claude", link: { pane: "p1" } }, "red"],
  ["ready to approve", { state: "blocked", kind: "permission", stage: "approval", agent: "claude", link: { pane: "p1" } }, "green"],
  ["under review", { state: "working", stage: "reviewing", agent: "claude", link: { pane: "p1" } }, "review"],
  ["the board's check", { state: "working", stage: "checking", agent: "claude", link: { pane: "p1" } }, "check"],
  ["done", { state: "done", stage: "merged", agent: "claude", link: { pane: "p1" } }, "teal"],
  ["to do", { state: "idle", stage: "todo" }, "todo"],
  ["archived", { state: "done", stage: "merged", agent: "claude", link: { pane: "p1" }, archivedAt: 1 }, "overlay0"],
];

// One board for both tests: nothing here changes a task.
const w = await world();
test.after(() => w.cleanup());

test("the box is the task's status colour when it sends to that task's agent, and the plain text colour for the Coordinator: frame and prompt mark, also while typing", async () => {
  const noColor = process.env.NO_COLOR;
  try {
    delete process.env.NO_COLOR;
    const task = S.get(A.add(w.root, "Make f").id), s = open(w), v = s.v;
    const colours = new Set();
    for (const typed of ["", "half a sentence"]) {
      v.setValue(typed);
      for (const [name, fields, colour] of STATUSES) for (const host of ["", "pc"]) {
        const r = { ...task, ...fields, ...(host ? { host } : {}) };
        // Another machine's task nobody started has no agent to start from here: its message goes to the Coordinator.
        // The box is the mark's own colour for every status, the light grey of the board's check too.
        const want = host && name === "to do" ? "text" : colour, what = `${name}${host ? " on another machine" : ""}${typed ? ", typing" : ""}`;
        v.reply = true;
        if (!host) { assert.equal(statusColor(r), colour, name); if (name !== "archived" && !["review", "check"].includes(colour)) assert.equal(GROUP_COLOR[groupOf(r)], colour, name); }
        assert.equal(v.boxColor(r), want, what);
        if (want !== "text") assert.ok(stripVTControlCharacters(v.mark(r)).length && v.mark(r).includes(on(want)), `${what}: the mark in the list is that colour too`);
        // The plain box: its two rules and its prompt mark.
        const lines = v.boxLines(60, 3, r);
        starts(lines[0], want, what); starts(lines.at(-1), want, what); starts(lines[1], want, what); assert.match(stripVTControlCharacters(lines[1]), /^❯ /);
        // The framed box, around a message: every edge.
        const framed = v.chatBox(60, 3, r, ["hello"]);
        for (const l of framed) { starts(l, want, what); assert.ok(l.endsWith(theme.fg(want, stripVTControlCharacters(l).at(-1))), `${what}: its right edge too`); }
        colours.add(on(want));
        // To the Coordinator the same box is the plain text colour, whatever the task is doing.
        v.reply = false;
        assert.equal(v.boxColor(r), "text"); starts(v.boxLines(60, 3, r)[0], "text", what); starts(v.chatBox(60, 3, r, ["hello"])[0], "text", what);
      }
    }
    // Each status has a colour of its own (an archived task is as grey as one nobody started), and none is the Coordinator's.
    { const live = ["yellow", "red", "green", "review", "check", "teal", "todo", "text"]; assert.equal(new Set(live.map(on)).size, live.length); for (const c of live) assert.ok(colours.has(on(c)), c); }
    assert.notEqual(on("todo"), on("text")); assert.notEqual(theme.fg(GROUP_COLOR["to do"], "to do"), theme.fg("text", "to do"));
    // The colour follows the status while something is typed.
    v.setValue("still typing"); v.reply = true;
    const seen = ["working", "needs you", "ready to approve"].map((n) => v.boxLines(60, 3, { ...task, ...STATUSES.find((x) => x[0] === n)[1] })[1]);
    assert.deepEqual(seen.map((l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, "").trimEnd()), Array(3).fill("❯ still typing")); assert.equal(new Set(seen).size, 3);
    // A task with no agent on it, whose message goes to the Coordinator: the Coordinator's colour. Find is no message at all.
    v.setValue(""); assert.equal(v.boxColor({ ...task, state: "idle", stage: "stopped" }), "text"); assert.equal(v.boxColor({ ...task, state: "working", stage: "working", agent: "claude" }), "text"); // an agent whose pane is gone takes no message: enter sends to the Coordinator
    v.mode = "find"; assert.equal(v.boxColor({ ...task, ...STATUSES[0][1] }), "text"); v.mode = "";
  } finally { if (noColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = noColor; }
});

test("colour is never the only clue: with NO_COLOR the box has the same words and no colour, and the list's \"to do\" is told from plain text by its heading", async () => {
  const noColor = process.env.NO_COLOR;
  try {
    const task = S.list()[0], s = open(w), v = s.v;
    const draw = (r, reply) => { v.reply = reply; return [...v.boxLines(60, 3, r), ...v.chatBox(60, 3, r, ["hello"])]; };
    const bare = (lines) => lines.map((l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, ""));
    for (const [name, fields] of STATUSES) for (const reply of [true, false]) {
      const r = { ...task, ...fields };
      delete process.env.NO_COLOR; const coloured = draw(r, reply);
      process.env.NO_COLOR = "1"; const plain = draw(r, reply);
      assert.deepEqual(bare(plain), bare(coloured), name);
      for (const l of plain) assert.doesNotMatch(l, /\x1b\[(?:3[0-9]|9[0-7]|38;)[0-9;]*m/, `${name}: no colour`);
      // The grey words inside the box still name who gets the message.
      const words = bare(plain)[1];
      if (!reply) assert.doesNotMatch(words, /Agent|starts an agent/);
      else if (name === "to do") assert.match(words, /your message starts an agent on it/);
      else if (name === "archived") assert.match(words, /archived: read-only/);
      else assert.match(words, /^❯ Send message to /);
    }
    // On the board itself, with colour off: the heading and the hint line say it.
    process.env.NO_COLOR = "1";
    const text = s.text();
    assert.match(text, /^ to do\s/m); assert.match(text, /Make f/);
  } finally { if (noColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = noColor; }
});
