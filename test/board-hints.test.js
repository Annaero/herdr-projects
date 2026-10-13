// The hint line: each hint says what the key does and to what, a key shows only where it does something, and what
// gives way in a narrow window.
import test from "node:test";
import assert from "node:assert/strict";
import { world, settle } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { open } from "./board-helpers.js";

const hints = (s, width = 120) => s.screen(width).at(-1).trim();

test("the hint line names the task once, says what esc goes back from, and repeats nothing the screen already says", async () => {
  const w = await world({ settings: { helper: "off", coordinator: "off", reviewer: "off" } });
  try {
    const s = open(w, { side: false });
    // An empty board: the text box's own placeholder says what to type, so the line has only the menu's key.
    assert.equal(hints(s), "? all keys"); assert.doesNotMatch(s.text(), /type what needs doing ·/);
    const id = A.add(w.root, "Add a greeting").id; A.add(w.root, "Other");
    s.v.sel = id; s.v.load();
    assert.equal(hints(s), "tab put an agent on this task · space talk about this task · ? all keys");
    // A filter that is kept: esc clears it, and the line says so, also where nothing matches and esc is the way out.
    s.press("ctrl+f"); assert.equal(hints(s), "enter keep the filter · esc cancel");
    s.type("greet"); s.press("enter");
    assert.equal(hints(s), "tab put an agent on this task · space talk about this task · esc clear the filter · ? all keys");
    s.press("esc"); assert.equal(s.v.filter, ""); assert.doesNotMatch(hints(s), /esc/);
    s.press("ctrl+f"); s.type("zzz"); s.press("enter"); assert.equal(hints(s), "esc clear the filter · ? all keys"); s.press("esc");
    // The archive: esc goes back to the board, with a task selected or none.
    s.press("alt+a"); assert.equal(hints(s), "esc back to the board · ? all keys");
    s.press("alt+a"); s.v.sel = id; s.v.load(); s.press("ctrl+a", "alt+a");
    assert.equal(hints(s), "ctrl+a restore this task · ctrl+x remove this task · esc back to the board · ? all keys");
    s.press("ctrl+a", "alt+a"); s.v.sel = id; s.v.load();
    // The whole task: esc goes back to the list; the arrows are named only while they have something to scroll.
    s.press("alt+t"); assert.equal(hints(s), "tab put an agent on this task · space talk about this task · esc back to the list");
    S.update(id, (t) => { t.description = Array.from({ length: 80 }, (_, n) => `Line ${n + 1}.`).join("\n\n"); }); s.v.load();
    assert.equal(hints(s), "tab put an agent on this task · space talk about this task · ↑↓ scroll the task · esc back to the list");
    s.press("esc"); assert.equal(s.v.full, false);
    // Your own task has no agent to stop: the key puts it back.
    S.update(id, (t) => { t.stage = "progress"; }); s.v.stick = id; s.v.load();
    assert.equal(hints(s), "tab put an agent on this task · ctrl+x put it back in to do · ? all keys");
    assert.equal(s.v.menuItems().find((i) => i.key === "ctrl+x").label, "put this task back in to do"); // the menu says the same
    // The menu, and words on their way to another machine.
    s.press("?"); assert.equal(hints(s), "↑↓ pick a key · enter press it · esc close the menu"); s.press("esc");
    const job = S.newDispatch("@far fix the build", { remote: "far" }); s.v.load(); s.v.sel = job.id;
    assert.equal(hints(s), "ctrl+x stop sending this · enter take the words back to change · ? all keys");
  } finally { w.cleanup(); }
});

test("with an agent on the task: whose agent is said once, and in a narrow window the hints give way in one order", async () => {
  const w = await world({ settings: { helper: "off", coordinator: "off", reviewer: "off" } });
  try {
    w.script({ worker: [{ status: "working", screen: "● Editing greet.sh\n" }] });
    const id = A.add(w.root, "Add a greeting").id;
    A.delegate(id); await settle(id);
    const s = open(w, { side: false });
    s.v.sel = id; s.v.load();
    // The first hint says whose agent; after it, it is "the agent". With no message to show or hide, the chat's key
    // is not named. The hints between the first and the last give way first, from the last of them back.
    assert.equal(hints(s, 140), "enter open this task's agent · space talk to the agent · ctrl+x stop the agent · ? all keys");
    assert.equal(hints(s, 80), "enter open this task's agent · space talk to the agent · ? all keys");
    assert.equal(hints(s, 60), "enter open this task's agent · ? all keys");
    assert.equal(hints(s, 36), "enter open this task's agent"); // the main thing is the last to go
    // Talking to its agent, there is a message: the key that hides it is the first to go.
    s.press("space");
    assert.equal(hints(s), "enter open this task's agent · ctrl+x stop the agent · alt+c hide the latest message · space back to the Coordinator");
    assert.equal(hints(s, 100), "enter open this task's agent · ctrl+x stop the agent · space back to the Coordinator");
    // Hidden, that key is how you see a reply: it outlasts the other hints between the first and the last.
    s.press("alt+c");
    assert.equal(hints(s, 100), "enter open this task's agent · alt+c show the latest message · space back to the Coordinator");
    s.press("alt+c");
    // Space is the one way back to the Coordinator, so in the narrowest window that hint stays and the main thing goes.
    assert.equal(hints(s, 70), "enter open this task's agent · space back to the Coordinator");
    assert.equal(hints(s, 48), "space back to the Coordinator");
    // While you type: where enter sends it; the new line goes first, and esc stays.
    s.type("also say goodbye");
    assert.equal(hints(s), "enter send to this task's agent · shift+enter new line · esc put away");
    assert.equal(hints(s, 60), "enter send to this task's agent · esc put away");
    // Too narrow even for the one hint that is left: it is said shorter, never cut in the middle.
    for (const width of [48, 40, 34]) { assert.doesNotMatch(hints(s, width), /…/); assert.ok(hints(s, width).length <= width - 2); }
    assert.equal(hints(s, 30), "enter send"); s.press("esc");
    for (const width of [40, 34]) assert.doesNotMatch(hints(s, width), /…/);
    assert.equal(hints(s, 34), "space back to the Coordinator"); s.press("space");
    assert.equal(hints(s, 26), "enter open its agent");
  } finally { w.cleanup(); }
});
