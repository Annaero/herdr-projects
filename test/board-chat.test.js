// The chat's box: the latest message, an empty line, the line you type on. Whose message it holds, and how it is cut.
import test from "node:test";
import assert from "node:assert/strict";
import { world, settle } from "./helpers.js";
import * as A from "../src/actions.js";
import * as C from "../src/coordinator.js";
import { theme } from "../src/board/theme.js";
import { runJob } from "../src/jobs.js";
import { drainJobs } from "../src/runner.js";
import { open } from "./board-helpers.js";
import { coordWorld, open as openCoord } from "./coordinator-helpers.js";

// The chat as the screen shows it: the line that says who, and what is inside the box (without its frame).
function chat(s, width = 120) {
  const lines = s.screen(width), top = lines.findLastIndex((l) => /^╭─+╮$/.test(l)), end = lines.findLastIndex((l) => /^╰─+╯$/.test(l));
  if (top < 0) { const at = lines.findLastIndex((l) => /^❯/.test(l)); return { framed: false, who: lines[at - 2].trimEnd(), box: [lines[at].trimEnd()], hints: lines.at(-1).trim(), lines }; }
  for (const l of lines.slice(top, end + 1)) assert.equal(l.length, width, "the box is as wide as the window");
  return { framed: true, who: lines[top - 1].trimEnd(), box: lines.slice(top + 1, end).map((l) => l.slice(2, -2).trimEnd()), hints: lines[end + 1].trim(), lines };
}

test("a task agent's chat: its message, then your just-sent words in its place, then its next message; hidden, only who and the line you type on", async () => {
  const w = await world({ settings: { helper: "off", coordinator: "off", reviewer: "off" } });
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f, with one line in it." }, { files: { "g.txt": "1\n" }, commit: "2", note: "Made g." }] });
    const id = A.add(w.root, "Make f").id;
    A.delegate(id); await settle(id);
    const s = open(w, { side: false });
    s.v.sel = id; s.v.load(); s.press("space");
    for (const width of [120, 48]) {
      const c = chat(s, width);
      assert.ok(c.framed); assert.match(c.who, /^ \S Make f {2}\S/); assert.doesNotMatch(c.who, /agent|claude|alt\+|last message/);
      assert.deepEqual(c.box, ["Made f, with one line in it.", "", "❯ your reply"]); // nothing else is in it
      assert.match(c.hints, /space back to the Coordinator$/); // whole at every width: the key is never the part that is cut
    }
    assert.match(chat(s).hints, /alt\+c hide the chat · space back to the Coordinator$/);
    // While you type: your words on the line, and the hints say what the keys do now.
    s.type("yes, g too");
    assert.deepEqual(chat(s).box, ["Made f, with one line in it.", "", "❯ yes, g too"]); assert.equal(chat(s).hints, "enter send to its agent · esc put away · shift+enter new line");
    // Sent: your words stand where the agent's message was. The old message is never under them.
    s.press("enter");
    assert.deepEqual(chat(s).box, ["yes, g too", "", "❯ your reply"]); assert.doesNotMatch(s.text(), /Sent to the agent/);
    assert.equal(s.v.chatShows(s.v.current()), false, "so the task panel has the agent's message meanwhile");
    // The agent answers: its new message takes that place.
    await settle(id); s.v.load();
    assert.deepEqual(chat(s).box, ["Made g.", "", "❯ your reply"]); assert.equal(s.v.justSent.size, 0);
    // Hidden: who you talk to and the line you type on, between two rules. alt+c is the key both ways.
    s.press("\x1bc");
    let c = chat(s);
    assert.equal(c.framed, false); assert.match(c.who, /^ \S Make f {2}\S/); assert.deepEqual(c.box, ["❯ your reply"]); assert.match(c.hints, /alt\+c show the chat · space back to the Coordinator$/);
    assert.doesNotMatch(s.text(), /│ Made g\./);
    // With the chat hidden nothing shows your words, so one line says they went.
    s.type("thanks"); s.press("enter"); assert.match(s.text(), /Sent to the agent/);
    s.press("\x1bc"); assert.deepEqual(chat(s).box, ["thanks", "", "❯ your reply"]);
    // space: back to the same box for everyone else. With no Coordinator there is no message to hold, so no frame.
    s.press("space"); c = chat(s);
    assert.equal(c.framed, false); assert.match(c.who, /^ \+ New task {2}what you type is added as a task/); assert.doesNotMatch(c.hints, /alt\+c/);
  } finally { w.cleanup(); }
});

test("the Coordinator's chat: what you sent stands in the box until it says something new, also when the board is opened again", async () => {
  const w = await coordWorld();
  try {
    w.script({ coordinator: [{ said: "Six tasks are in progress." }, { status: "working" }] });
    const s = openCoord(w);
    s.type("where do things stand?"); s.press("enter"); s.beat();
    assert.deepEqual(chat(s).box, ["where do things stand?", "", "❯ ask or tell it anything"]); assert.match(chat(s).who, /^ . Coordinator {2}starting · 1 message waits to be sent$/);
    await drainJobs(runJob); s.beat();
    assert.deepEqual(chat(s).box, ["Six tasks are in progress.", "", "❯ ask or tell it anything"]); assert.equal(chat(s).who, " ○ Coordinator  idle");
    // The next words go in and it starts working: they stay in the box, the old reply is not shown under them.
    s.type("archive the last one"); s.press("enter"); await drainJobs(runJob); s.beat();
    assert.equal(C.get().queue.length, 0); assert.equal(C.look().said, "Six tasks are in progress."); assert.equal(C.look().sent, "archive the last one");
    assert.deepEqual(chat(s).box, ["archive the last one", "", "❯ ask or tell it anything"]); assert.doesNotMatch(s.text(), /Six tasks|›/);
    assert.deepEqual(chat(openCoord(w)).box, ["archive the last one", "", "❯ ask or tell it anything"], "a board opened now shows the same");
    // Typed in its own chat instead: the box's words no longer stand for the latest thing said.
    C.typedThere(); s.beat();
    assert.deepEqual(chat(s).box, ["Six tasks are in progress.", "", "❯ ask or tell it anything"]);
  } finally { w.cleanup(); }
});

test("a long message wraps inside the box and takes the rows it needs, never the text box's: at any width", async () => {
  const w = await coordWorld();
  try {
    for (let i = 1; i <= 40; i++) A.add(w.root, `Task number ${i}`);
    const s = openCoord(w, { rows: 30 });
    s.v.side = false;
    const said = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} of **what** it said, long enough to wrap in a narrow window.`).join("\n");
    const base = s.v.chatOf.bind(s.v);
    let mine = false;
    s.v.chatOf = (r) => ({ ...base(r), text: said, mine });
    for (const width of [44, 80, 200]) {
      for (mine of [false, true]) {
        const c = chat(s, width), body = c.box.slice(0, -2);
        assert.match(c.box.at(-2), /^ +(alt\+j )?more ↓$/); assert.equal(c.box.at(-1), "❯ ask or tell it anything");
        // With its box it takes two thirds of the 30 rows: 16 lines of it. It starts at its beginning, whoever said it.
        assert.equal(body.length, 16, `sixteen lines of it at ${width} columns`); assert.match(body[0], /^Line 1 of what it said/);
        assert.doesNotMatch(body.join("\n"), /\*\*/);
        assert.ok(c.lines.filter((l) => /Task number \d+/.test(l)).length >= 4, "the list keeps rows");
      }
    }
    // A window too short for all of it: the message gives up its lines first; who you talk to and the line you type on stay.
    s.v.tui.terminal.rows = 10; mine = false;
    const c = chat(s, 80);
    assert.equal(c.lines.length, 10); assert.match(c.who, /^ . Coordinator/); assert.equal(c.box.at(-1), "❯ ask or tell it anything"); assert.ok(c.box.length <= 5);
    // The colours: an agent's message is greyed out, your own is in the text colour.
    assert.deepEqual(s.v.chatMessage({ text: "one\ntwo" }, 20, 5), [theme.muted("one"), theme.muted("two")]);
    assert.deepEqual(s.v.chatMessage({ text: "one\ntwo", mine: true }, 20, 5), ["one", "two"]);
    assert.deepEqual(s.v.chatMessage({ text: "one\ntwo\nthree", mine: true }, 20, 2), ["one", "two"]);
    assert.deepEqual(s.v.chatMessage({ text: "one\ntwo\nthree" }, 20, 0), []);
  } finally { w.cleanup(); }
});

test("an answer in the very same words still takes your words' place: the Coordinator's and a task agent's", async () => {
  const w = await coordWorld();
  try {
    w.script({ coordinator: [{ said: "Done." }, { said: "Done." }], worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Done." }, { files: { "g.txt": "1\n" }, commit: "2", note: "Done." }] });
    const s = openCoord(w);
    s.type("first request"); s.press("enter"); await drainJobs(runJob); s.beat();
    assert.deepEqual(chat(s).box, ["Done.", "", "❯ ask or tell it anything"]);
    s.type("second request"); s.press("enter"); s.beat();
    assert.deepEqual(chat(s).box, ["second request", "", "❯ ask or tell it anything"]);
    await drainJobs(runJob); s.beat();
    assert.equal(C.look().state, "idle"); assert.equal(C.look().sent, "");
    assert.deepEqual(chat(s).box, ["Done.", "", "❯ ask or tell it anything"]);
    // A task's agent: the same words at the end of its next turn.
    const id = A.add(w.root, "Make f").id;
    A.delegate(id); await settle(id);
    s.v.sel = id; s.v.load(); s.press("space");
    assert.deepEqual(chat(s).box, ["Done.", "", "❯ your reply"]);
    s.type("make g too"); s.press("enter"); s.v.load();
    assert.deepEqual(chat(s).box, ["make g too", "", "❯ your reply"]);
    await settle(id); s.v.load();
    assert.deepEqual(chat(s).box, ["Done.", "", "❯ your reply"]);
    // The same, with the chat on someone else from the moment the words went until after the answer: nothing was
    // drawn of this task's chat in between, and the answer still takes the words' place.
    w.script({ worker: [{ files: { "h.txt": "1\n" }, commit: "3", note: "Done." }] });
    s.type("and h"); s.press("enter", "space"); assert.equal(s.v.reply, false); s.screen();
    await settle(id); s.v.load(); s.screen();
    s.press("space"); assert.equal(s.v.reply, true);
    assert.deepEqual(chat(s).box, ["Done.", "", "❯ your reply"]);
  } finally { w.cleanup(); }
});

test("a very narrow window keeps the box whole: the message is in it, and every row ends on its right edge", async () => {
  const w = await coordWorld();
  try {
    w.script({ coordinator: [{ said: "Six tasks are in progress and nothing waits on you." }] });
    const s = openCoord(w);
    // Nothing said yet: the placeholder is cut with …, inside the box.
    for (const width of [27, 24, 16]) { const c = chat(s, width); assert.ok(c.framed, `at ${width}`); assert.equal(c.box.length, 1); assert.match(c.box[0], /^❯ a.*…$/, `at ${width}`); }
    assert.deepEqual(chat(s, 40).box, ["❯ ask or tell it anything"]);
    s.type("hi"); s.press("enter"); await drainJobs(runJob); s.beat();
    for (const width of [60, 24, 23, 20, 19, 12, 8]) {
      const c = chat(s, width), body = c.box.slice(0, -2);
      assert.ok(c.framed, `the box is there at ${width} columns`); assert.equal(c.lines.length, 34);
      assert.ok(c.lines.every((l) => l.length <= width), `nothing is wider than ${width} columns`);
      assert.ok(body.length >= 1, `the message shows at ${width} columns`); assert.equal(c.box.at(-2), "");
      if (width >= 20) assert.match(body.at(-1), /you\.$/, "its end is in view");
      assert.match(c.box.at(-1), /^❯/);
    }
    // Typed words wrap inside it too.
    s.type("a reply that is longer than the box is wide");
    for (const width of [24, 12]) { const c = chat(s, width); assert.ok(c.framed); assert.ok(c.lines.every((l) => l.length <= width)); assert.match(c.box.join(" "), /❯ a +reply/); }
  } finally { w.cleanup(); }
});
