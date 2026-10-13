// Replying to a task's agent: who gets your words, and words put away.
import test from "node:test";
import assert from "node:assert/strict";
import { world, settle } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { open } from "./board-helpers.js";

test("only space flips between the Coordinator and a task's agent: the arrows only move, and while you talk to an agent the chat follows the selection", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    const alpha = A.add(w.root, "Alpha"), beta = A.add(w.root, "Beta");
    const s = open(w); s.v.sel = alpha.id; s.v.load(); s.screen(120);
    s.press("space"); assert.equal(s.v.reply, true); assert.equal(s.v.replyId, alpha.id); assert.match(s.text(), /\n *\n . Alpha {2}no agent yet: your message starts one/);
    // Up or down selects the other task and nothing else: you still talk to a task's agent, now that task's.
    const toBeta = s.v.rows.filter((x) => x.rec).map((x) => x.rec.id).indexOf(alpha.id) ? "up" : "down", toAlpha = toBeta === "up" ? "down" : "up";
    s.press(toBeta);
    assert.equal(s.v.sel, beta.id); assert.equal(s.v.reply, true); assert.equal(s.v.replyId, beta.id);
    assert.match(s.text(), /\n *\n . Beta {2}no agent yet: your message starts one/); assert.doesNotMatch(s.text(), /\n *\n . Alpha {2}|New task/);
    s.press(toAlpha); assert.equal(s.v.replyId, alpha.id); assert.match(s.text(), /\n *\n . Alpha {2}/);
    // Find, and leaving it with esc, changes nothing about who you talk to; nor is the search kept as a put-away reply.
    s.press("ctrl+f"); s.type("Alp"); assert.doesNotMatch(s.text(), /\n *\n . Alpha {2}/); s.press("esc");
    assert.equal(s.v.mode, "new"); assert.equal(s.v.reply, true); assert.equal(s.v.sel, alpha.id); assert.equal(s.v.draftAway, null); assert.match(s.text(), /\n *\n . Alpha {2}/);
    // Talking to the Coordinator, the arrows change nothing about that either: no task's agent is talked to unasked.
    s.press("space"); assert.equal(s.v.reply, false);
    s.press(toBeta); assert.equal(s.v.sel, beta.id); assert.equal(s.v.reply, false);
    assert.match(s.text(), /\n *\n \+ New task {2}[^\n]*\n─+\n❯ what's next\?/); assert.doesNotMatch(s.text(), /\n *\n . Beta {2}/);
    s.type("for nobody's agent"); s.press("enter");
    assert.equal(S.get(beta.id).stage, "todo", "Beta's agent was not started"); assert.equal(S.get(alpha.id).stage, "todo"); assert.equal(S.list().length, 3, "it went where the chat said: a new task");
    // Space on Alpha, then over to Beta: what you send goes to the one the chat names, and the chat stays Beta's.
    s.v.sel = alpha.id; s.v.load(); s.press("space", toBeta); assert.equal(s.v.sel, beta.id); s.type("start on this"); s.press("enter");
    assert.notEqual(S.get(beta.id).stage, "todo"); assert.equal(S.get(alpha.id).stage, "todo");
    await settle(beta.id); s.v.load();
    assert.equal(s.v.sel, beta.id); assert.equal(s.v.reply, true); assert.match(s.text(), /\n *\n . Beta {2}/);
    // The task you talk to going away is back to the Coordinator too, never on to a neighbour.
    await A.clear(beta.id); s.v.load();
    assert.equal(s.v.reply, false); assert.notEqual(s.v.sel, beta.id); assert.match(s.text(), /\n *\n \+ New task {2}/);
  } finally { w.cleanup(); }
});

test("a reply that was put away comes back as a reply to the same task, never as a new task", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    process.env.HERDR_ENV = "1";
    w.script({ worker: [{ status: "working", screen: "● Working\n" }] });
    const id = A.add(w.root, "Add a greeting").id; A.add(w.root, "Another one");
    A.delegate(id); await settle(id);
    const s = open(w);
    for (const width of [120, 80]) { // beside the list, and with the panel full screen
      s.screen(width); s.v.sel = id; s.v.load();
      s.press("space"); s.type("also say goodbye");
      s.press("esc"); assert.equal(s.v.value(), ""); assert.equal(s.v.reply, true); // the first esc only puts the words away
      s.press("esc"); assert.equal(s.v.chatOpen, true); assert.equal(s.v.reply, true); // a second one touches neither the chat nor who you talk to
      s.press("space"); assert.equal(s.v.reply, false); assert.match(s.text(width), /\n *\n \+ New task {2}[^\n]*\n─+\n❯/);
      s.press("down"); assert.notEqual(s.v.sel, id);
      // ctrl+z never changes who you talk to, nor the selection: with the Coordinator, or with another task's agent,
      // it says who the words were for, and they stay put away until the chat names that task's agent again.
      const other = s.v.sel;
      s.press("ctrl+z"); assert.equal(s.v.sel, other); assert.equal(s.v.reply, false); assert.equal(s.v.value(), ""); assert.equal(s.v.draftAway.text, "also say goodbye");
      assert.match(s.text(width).replace(/\s+/g, " "), /Those words were for the agent on "Add a greeting"\. Select it and press space, then ctrl\+z brings them back\./);
      s.press("space", "ctrl+z"); assert.equal(s.v.sel, other); assert.equal(s.v.reply, true); assert.equal(s.v.replyId, other); assert.equal(s.v.value(), "");
      assert.match(s.text(width).replace(/\s+/g, " "), /Those words were for "Add a greeting"\. Move to it, then ctrl\+z brings them back\./);
      s.press("up"); assert.equal(s.v.sel, id);
      s.press("ctrl+z");
      assert.equal(s.v.sel, id); assert.equal(s.v.reply, true); assert.equal(s.v.full, false); assert.equal(s.v.draftAway, null);
      assert.match(s.text(width), /\n *\n . Add a greeting {2}[^\n]*\n(?:[^\n]*\n)*?│ ❯ also say goodbye/);
      w.script({ worker: [{ status: "working" }] });
      const before = S.list().length;
      s.press("enter");
      assert.equal(S.list().length, before, "no new task was added");
      assert.match(w.state().panes.find((p) => p.pane_id === S.get(id).link.pane).agent.prompts.at(-1), /also say goodbye/);
      s.press("space"); assert.equal(s.v.reply, false); assert.equal(s.v.ask, null); assert.equal(s.v.chatOpen, true);
    }
    // a new task that was put away comes back as a new task, never as a reply: while you talk to a task's agent
    // ctrl+z says so and changes nothing; space goes back, and there it comes back
    s.screen(120); s.type("buy milk"); s.press("esc", "space"); assert.equal(s.v.reply, true);
    s.press("ctrl+z"); assert.equal(s.v.reply, true); assert.equal(s.v.value(), ""); assert.equal(s.v.draftAway.text, "buy milk");
    assert.match(s.text().replace(/\s+/g, " "), /Those words were for the Coordinator\. space goes back to it, then ctrl\+z brings them back\./);
    s.press("space", "ctrl+z"); assert.equal(s.v.reply, false); assert.match(s.text(), /\n *\n \+ New task {2}[^\n]*\n─+\n❯ buy milk/);
    s.press("esc");
    // the task a reply was for is gone: the words stay put away rather than go somewhere else
    const gone = A.add(w.root, "Short lived").id; s.v.sel = gone; s.v.load();
    s.press("space"); s.type("for the short lived one"); s.press("esc", "esc");
    await A.clear(gone); s.v.load();
    s.press("ctrl+z"); assert.equal(s.v.value(), ""); assert.match(s.text(), /The task that reply was for is gone\. ctrl\+z again brings the words back as a draft of their own\./);
    s.press("ctrl+z"); assert.match(s.text(), /\n *\n \+ New task {2}[^\n]*\n─+\n❯ for the short lived one/); assert.equal(s.v.reply, false); // asked for, so never lost and never a surprise
    s.press("esc");
    // the task disappears while the reply is still being typed: the words never slide over to whichever task is selected next
    const doomed = A.add(w.root, "Doomed").id; s.v.sel = doomed; s.v.load();
    s.press("space"); s.type("only for the doomed one");
    await A.clear(doomed); s.v.beat();
    assert.notEqual(s.v.sel, doomed); assert.equal(s.v.reply, false); assert.equal(s.v.value(), "");
    assert.match(s.text(), /The task you were replying to is gone\. Nothing was sent; your words are put away\./);
    const tasks = S.list().length, asked = JSON.stringify(w.state().panes.map((p) => p.agent?.prompts?.length));
    s.press("enter"); // enter now only opens the selected agent or does nothing: it has no words to send anywhere
    assert.equal(S.list().length, tasks); assert.equal(JSON.stringify(w.state().panes.map((p) => p.agent?.prompts?.length)), asked);
    assert.equal(s.v.draftAway.text, "only for the doomed one");
    // words that were put away survive the board closing or reloading itself: ctrl+z still brings them back
    const s4 = open(w);
    s4.v.sel = id; s4.v.load(); s4.press("space"); s4.type("kept across a reload"); s4.press("esc", "esc");
    s4.v.tick = 4; s4.v.stamp = "old"; s4.v.beat(); s4.v.tick = 9; s4.v.beat();
    assert.deepEqual(s4.closed(), { reload: true }); s4.v.dispose();
    const s5 = open(w);
    s5.press("ctrl+z"); assert.equal(s5.v.reply, false); assert.equal(s5.v.value(), ""); // the board reopens with the Coordinator: the reply waits for its task
    s5.v.sel = id; s5.v.load(); s5.press("space", "ctrl+z"); assert.equal(s5.v.sel, id); assert.match(s5.text(), /\n *\n . Add a greeting {2}[^\n]*\n(?:[^\n]*\n)*?│ ❯ kept across a reload/);
    // and so does a reply still in the text box when the board is closed from outside
    s5.v.dispose();
    const s6 = open(w); assert.equal(s6.v.value(), ""); s6.v.sel = id; s6.v.load(); s6.press("space", "ctrl+z");
    assert.match(s6.text(), /\n *\n . Add a greeting {2}[^\n]*\n(?:[^\n]*\n)*?│ ❯ kept across a reload/);
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("a reply typed on the board to work that was merged and cleaned up starts a new round, also with the Coordinator off", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    process.env.HERDR_ENV = "1";
    w.script({ worker: [{ files: { "f.txt": "v1\n" }, commit: "v1", note: "Did v1." }] });
    const id = A.add(w.root, "Work").id;
    A.delegate(id);
    assert.equal((await settle(id)).stage, "approval");
    A.approve(id);
    let t = await settle(id);
    assert.equal(t.stage, "done"); assert.ok(t.cleaned && !t.link.pane);
    const s = open(w);
    s.v.sel = id; s.v.load();
    s.press("space");
    w.script({ worker: [{ files: { "g.txt": "g\n" }, commit: "g", note: "Did g." }] });
    s.type("now add g"); s.press("enter");
    assert.match(s.text(), /new round/); assert.equal(s.v.value(), "");
    t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure)); assert.ok(!String(t.description || "").includes("now add g"));
    assert.ok(w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts.some((x) => /now add g/.test(x)));
    s.v.dispose();
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("a row with no task talks to the Coordinator: words typed or brought back there never become a reply to the task you were on", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    const alpha = A.add(w.root, "Alpha");
    const job = S.newDispatch("@vm-a build it", { remote: "vm-a" });
    const s = open(w); s.v.sel = alpha.id; s.v.load(); s.screen(120);
    const onJob = () => { for (let n = 0; n < 5 && s.v.sel !== job.id; n++) s.press("down"); assert.equal(s.v.sel, job.id); };
    const onAlpha = () => { for (let n = 0; n < 5 && s.v.sel !== alpha.id; n++) s.press("up"); assert.equal(s.v.sel, alpha.id); };
    // Words for the Coordinator, put away; then space on Alpha and down to the row with no task: the chat names the
    // Coordinator there, and ctrl+z brings the words back as what they were.
    s.type("only for the Coordinator"); s.press("esc", "space"); assert.equal(s.v.replyId, alpha.id);
    onJob(); assert.equal(s.v.reply, true); assert.equal(s.v.replyId, ""); assert.match(s.text(), /\n *\n \+ New task {2}/);
    s.press("ctrl+z"); s.v.beat();
    assert.equal(s.v.value(), "only for the Coordinator"); assert.equal(s.v.draftAway, null); assert.match(s.text(), /\n *\n \+ New task {2}[^\n]*\n─+\n❯ only for the Coordinator/);
    // Put away again from there, they are still the Coordinator's: on Alpha ctrl+z does not bring them back as a reply.
    s.press("esc"); assert.deepEqual(s.v.draftAway, { text: "only for the Coordinator", to: "" });
    onAlpha(); assert.equal(s.v.replyId, alpha.id); s.press("ctrl+z");
    assert.equal(s.v.value(), ""); assert.equal(s.v.draftAway.to, ""); assert.match(s.text().replace(/\s+/g, " "), /Those words were for the Coordinator\. space goes back to it, then ctrl\+z brings them back\./);
    // Typed on that row and still in the box when the row goes: put away for the Coordinator, never sent to Alpha.
    s.v.draftAway = null; onJob(); s.type("typed on the row"); s.v.beat(); assert.equal(s.v.value(), "typed on the row");
    S.clearDispatch(job.id); s.v.beat();
    assert.equal(s.v.sel, alpha.id); assert.equal(s.v.value(), ""); assert.deepEqual(s.v.draftAway, { text: "typed on the row", to: "" });
    assert.match(s.text().replace(/\s+/g, " "), /The row you were on is gone\. Nothing was sent; your words for the Coordinator are put away\./);
    s.press("enter"); assert.equal(S.get(alpha.id).stage, "todo"); assert.equal(S.list().length, 1);
  } finally { w.cleanup(); }
});
