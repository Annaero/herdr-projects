// The Coordinator's chat: one long-lived agent behind the box, and going into its real pane.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { settle, until } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as C from "../src/coordinator.js";
import { main } from "../src/cli.js";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { runJob } from "../src/jobs.js";
import { drainJobs } from "../src/runner.js";
import { coordWorld, open } from "./coordinator-helpers.js";

test("the box talks to one long-lived Coordinator: an ordinary agent, started once, with nothing held back", async () => {
  const w = await coordWorld();
  try {
    assert.ok(C.ready());
    w.script({ coordinator: [{ said: "Filed proj/1." }, { said: "Delegated proj/1." }] });
    const s = open(w);
    // The chat at the bottom is the Coordinator's: its first line says who you talk to, the prompt is only "❯".
    assert.match(s.text(), /\n─+\n · Coordinator {2}not started · claude · default model · default effort *\n Ask or tell it anything: it starts with your first message, and stays\. *\n─+\n❯ ask or tell it anything *\n/);
    assert.doesNotMatch(s.text(), /new task|reply to/);
    s.press("?"); assert.match(s.text(), /open the Coordinator's chat +alt\+c/); assert.match(s.text(), /hide the latest message in the chat +alt\+v/); s.press("esc"); // lines in the menu, not keys to learn
    s.type("build a login page");
    assert.match(s.text(), /\n❯ build a login page/); assert.match(s.text(), /enter send · tab send, and put an agent on it · esc put away/);
    s.press("enter");
    assert.equal(C.get().queue.length, 1);
    s.beat();
    // What it is doing is said in the chat, and nowhere else: no line of its own above the list or the box.
    assert.match(s.text(), /\n─+\n ◐ Coordinator {2}starting · [^\n]*\n › build a login page {2}\(waiting to be sent\) *\n Starting… *\n─+\n❯/);
    assert.equal(s.screen().filter((l) => /Coordinator/.test(l)).length, 1);
    await drainJobs(runJob);
    // One herdr space of its own, one ordinary agent: full access, a conversation id, the standing rules. No tool limits.
    const st = w.state();
    assert.deepEqual(st.workspaces.map((x) => x.label), ["Coordinator"]);
    assert.equal(w.agents().length, 1);
    const agent = w.agents()[0].agent;
    assert.equal(agent.name, "sw-coordinator"); assert.equal(agent.kind, "claude");
    assert.ok(agent.args.includes("--dangerously-skip-permissions")); assert.ok(agent.args.includes("--session-id")); assert.ok(agent.args.includes("--append-system-prompt-file"));
    assert.ok(!agent.args.some((a) => /allowedTools|--tools/.test(a)), "nothing is held back from it");
    assert.match(fs.readFileSync(agent.args[agent.args.indexOf("--append-system-prompt-file") + 1], "utf8"), /You are the Coordinator of the human's work board/);
    assert.equal(agent.prompts[0], "build a login page", "your words go in exactly as typed");
    assert.match(C.where(), /^The human's last message from the board:\n- "build a login page" was sent from the repo "proj" \(.*\)\. No task was open\. It was sent with enter: delegate only what the human asked you to\.$/);
    assert.equal(C.get().queue.length, 0);
    // Its reply is in the chat, under what you said.
    s.beat();
    let text = s.text(160);
    assert.match(text, /○ Coordinator {2}idle · claude · default model · default effort *\n/);
    assert.match(text, /› build a login page *\n Filed proj\/1\. *\n─+\n❯ ask or tell it anything/);
    assert.equal(C.look().unseen, "", "a reply you can see counts as seen");
    // alt+v hides its latest message and shows it again: who you talk to, and where it stands, stays. The board remembers.
    s.press("alt+v"); assert.equal(s.v.chatOpen, false);
    assert.doesNotMatch(s.text(), /Filed proj\/1\./); assert.match(s.text(), /\n─+\n ○ Coordinator {2}idle · [^\n]*\n─+\n❯ ask or tell it anything/); assert.doesNotMatch(s.text(), /alt\+v|alt\+c/); // the keys work, the line does not name them
    assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).chat, "closed");
    // esc never shows the message, and never closes the board: hidden, it stays hidden, and nothing is asked.
    s.press("esc"); assert.equal(s.v.chatOpen, false); assert.equal(s.v.ask, null); assert.deepEqual(s.closed, []); assert.ok(s.v.closing); assert.match(s.text(), /Press ctrl\+c again to close the board/); s.v.closeSoon();
    // Shown, esc does not hide it either: the same key that hid it shows it, and the chat's line names only that key.
    s.press("alt+v"); assert.equal(s.v.chatOpen, true); assert.match(s.text(), /Filed proj\/1\./); assert.doesNotMatch(s.text(), /alt\+v|esc hide/);
    s.press("esc", "esc"); assert.equal(s.v.chatOpen, true); assert.equal(s.v.ask, null); assert.deepEqual(s.closed, []); assert.match(s.text(), /Filed proj\/1\./); s.v.closeSoon();
    assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).chat, "open");
    // With a draft, esc puts the words away and the message stays up, however often it is pressed.
    s.type("half"); s.press("esc"); assert.equal(s.v.value(), ""); assert.equal(s.v.chatOpen, true);
    s.press("esc"); assert.equal(s.v.chatOpen, true); s.v.closeSoon(); s.press("alt+v"); assert.equal(s.v.chatOpen, false);
    // The next thing you type goes to the same agent in the same conversation; Tab asks it to delegate.
    s.type("and start it"); s.press("tab");
    await drainJobs(runJob);
    assert.equal(w.agents().length, 1); assert.equal(w.state().calls.filter((c) => c.startsWith("agent start")).length, 1);
    assert.equal(w.agents()[0].agent.prompts.length, 2);
    // Sent with tab: that is said in the message itself, under the words, so it cannot be missed. The chat shows the words alone.
    assert.equal(w.agents()[0].agent.prompts[1], `and start it\n\n${C.TAB_NOTE}`);
    assert.match(C.TAB_NOTE, /^\[Sent with tab on the board: start every task you file from this message right away, without asking\./);
    assert.equal(C.get().last, "and start it");
    // Each message keeps its own: the newer one does not take the first one's repo or delegate choice away.
    assert.match(C.where(), /2 messages[^\n]*\n- "build a login page"[^\n]*It was sent with enter[^\n]*\n- "and start it"[^\n]*It was sent with tab: put an agent on every task you file from it, without asking\.$/);
    // Hidden, a new reply is said on the chat's one line; shown again, it is there.
    s.beat(); assert.equal(s.v.chatOpen, false); assert.doesNotMatch(s.text(), /Delegated proj\/1\./); assert.match(s.text(), /\n ○ Coordinator {2}new reply · /); assert.ok(C.look().unseen);
    s.press("alt+v"); assert.match(s.text(), /Delegated proj\/1\./); assert.equal(C.look().unseen, "");
    // With a task open that has no agent to reply to, the words go to the Coordinator with that task named: the chat says so.
    const t = A.add(w.root, "Write the docs");
    A.report(t.id, { state: "done" });
    s.v.sel = t.id; s.v.load(); s.press("space"); assert.equal(s.v.reply, true);
    assert.match(s.text(160), /\n─+\n . Write the docs {2}no agent on it: your message goes to the Coordinator, about this task *\n─+\n❯ what should change\?/);
    s.type("make it shorter"); s.press("enter"); await drainJobs(runJob);
    assert.equal(w.agents()[0].agent.prompts[2], "make it shorter");
    assert.match(C.where(), /\n- "make it shorter"[^\n]*Task proj\/1 \("Write the docs"\) was open: for this message "it" and "this" mean that task\. It was sent with enter/);
    const out = []; const write = process.stdout.write; process.stdout.write = (x) => (out.push(String(x)), true);
    try { assert.equal(await main(["coordinator", "where"]), 0); } finally { process.stdout.write = write; }
    assert.match(out.join("\n"), /was sent from the repo "proj"/, "the Coordinator's own command says it");
  } finally { w.cleanup(); }
});

test("one chat for everyone: space on a task talks to its agent, otherwise to the Coordinator; alt+c goes into the real pane of whoever it names", async () => {
  const w = await coordWorld();
  try {
    process.env.HERDR_ENV = "1";
    const s = open(w);
    assert.equal(s.v.chatOpen, true);
    assert.match(s.text(), /Coordinator {2}not started · claude · default model · default effort/); assert.match(s.text(), /it starts with your first message, and stays/);
    // Opening it before it ever ran: it is started with nothing said, the board stays the board meanwhile (no chat is
    // drawn over it), and its chat opens as soon as it is there.
    s.press("alt+c"); assert.deepEqual(s.closed, []);
    assert.match(s.text(), /Starting the Coordinator: its chat opens as soon as it is ready\. esc stays on the board\./);
    assert.match(s.text(), /\n❯ ask or tell it anything/, "the board is still the board");
    await drainJobs(runJob);
    assert.equal(w.agents().length, 1); assert.equal(w.agents()[0].agent.prompts, undefined);
    assert.deepEqual(w.state().focus, []);
    s.beat();
    assert.deepEqual(s.closed, [{ entered: "coordinator" }], "the board closes"); assert.deepEqual(w.state().focus, [`agent ${C.get().pane}`], "and herdr moves to its real pane");
    assert.deepEqual(s.tui, [], "the board's screen is never handed to a chat inside it");
    s.v.dispose();
    // Back on the board from the Coordinator's pane: herdr names that pane's folder, which is nobody's repo. The
    // board is where it was, so the draft that comes back is sent from the repo it was typed in.
    {
      const b = open(w); b.type("a draft"); b.v.dispose();
      const tui = { terminal: { rows: 34, columns: 120 }, requestRender() {}, stop() {}, start() {} };
      const back = new View(tui, theme, () => {}, { cwd: C.home() }); clearInterval(back.timer);
      assert.equal(back.value(), "a draft"); assert.equal(back.ctx.cwd, w.root); assert.equal(back.repo.root, w.root);
      back.handleInput("\r"); await drainJobs(runJob);
      assert.deepEqual(C.get().where.at(-1).root, w.root, "not the Coordinator's own folder");
      back.dispose();
    }
    // Running: alt+c goes straight in.
    const d = open(w);
    d.press("alt+c"); assert.deepEqual(d.closed, [{ entered: "coordinator" }]); assert.equal(w.state().focus.length, 2);
    // alt+v hides its message and shows it again; it goes nowhere.
    const e = open(w); e.press("alt+v"); assert.equal(e.v.chatOpen, false); e.press("alt+v"); assert.equal(e.v.chatOpen, true); assert.deepEqual(e.closed, []);
    // Asked to go in, then esc: you stay on the board, also once it is there.
    C.stop(); await drainJobs(runJob); e.beat();
    e.press("alt+c"); assert.ok(e.v.going); e.press("esc"); assert.equal(e.v.going, 0);
    await drainJobs(runJob); e.beat(); assert.deepEqual(e.closed, []); assert.equal(w.state().focus.length, 2);
    // Space on a task: the same chat, now with that task's agent. Its first line is the task's whole name, where it
    // stands and who is on it; under it the agent's last message, which the task panel no longer repeats.
    const title = "Add a greeting that is polite, friendly and never cut short";
    const t = A.add(w.root, title); A.delegate(t.id); await settle(t.id);
    e.beat(); e.v.sel = t.id; e.v.load();
    assert.match(e.text(160), /The agent said ─+ *\n[^\n]*Done\./g); assert.match(e.text(160), /\n . Coordinator {2}/);
    e.press("space"); assert.equal(e.v.reply, true);
    let text = e.text(160);
    assert.match(text, new RegExp(`\\n─+\\n . ${title} {2}\\S[^\\n]*\\n Done\\. *\\n─+\\n❯ your reply`)); assert.doesNotMatch(text, /its agent · |alt\\+v|alt\\+c/);
    assert.doesNotMatch(text, /The agent said|\n . Coordinator {2}|reply to/); assert.match(text, /space back to the Coordinator *$/); assert.equal(text.match(/Done\./g).length, 1);
    e.press("alt+v"); assert.match(e.text(160), /The agent said ─+ *\n[^\n]*Done\./g); assert.match(e.text(160), new RegExp(`\\n . ${title} {2}[^\\n]*\\n─+\\n❯ your reply`)); e.press("alt+v");
    // The name is never cut inside a prompt: a window narrower than the name gives it a second line.
    { const lines = e.screen(44), at = lines.findIndex((l, n) => /^─+$/.test(l) && lines[n + 1].includes("Add a greeting")); assert.equal(lines.slice(at + 1, at + 3).map((l) => l.trim().replace(/^\S /, "")).join(" "), title); assert.match(lines.join("\n"), /\n❯ your reply/); }
    // While you talk to a task's agent the chat stays that agent's: the Coordinator's reply is said once, in a line.
    w.script({ coordinator: [{ said: "All done." }] });
    C.send(w.root, "do something"); await drainJobs(runJob); e.beat();
    assert.match(e.text(), /The Coordinator replied\. space goes back to it\./); assert.doesNotMatch(e.text(), /All done\./); assert.ok(C.look().unseen);
    // What you type there is for that agent, not for the Coordinator.
    e.type("also say goodbye"); assert.match(e.text(), /enter send to its agent · esc put away/); e.press("esc");
    // esc is not a chat key: the agent's message stays up, you still talk to the agent, and nothing asks to close.
    e.press("esc", "esc"); assert.equal(e.v.chatOpen, true); assert.equal(e.v.reply, true); assert.equal(e.v.ask, null); assert.deepEqual(e.closed, []); assert.match(e.text(160), /\n Done\. *\n─+\n❯ your reply/);
    // The one key hides and shows a task agent's message exactly as it does the Coordinator's.
    e.press("alt+v"); assert.equal(e.v.chatOpen, false); assert.equal(e.v.reply, true); assert.doesNotMatch(e.text(160), /\n Done\. *\n─+\n❯ your reply/); assert.doesNotMatch(e.text(160), /alt\+v/);
    // Hidden, the chat still says who you talk to, and that follows the selection: a message is never sent blind.
    { const other = A.add(w.root, "Somebody else").id; e.v.load(); const order = e.v.rows.filter((x) => x.rec).map((x) => x.rec.id), d = order.indexOf(other) - order.indexOf(t.id);
      for (let n = 0; n < Math.abs(d); n++) e.press(d > 0 ? "\x1b[B" : "\x1b[A");
      assert.equal(e.v.sel, other); assert.equal(e.v.reply, true); assert.equal(e.v.chatOpen, false); assert.match(e.text(160), /\n─+\n . Somebody else {2}no agent yet: your message starts one *\n─+\n❯ your message starts an agent on it/);
      for (let n = 0; n < Math.abs(d); n++) e.press(d > 0 ? "\x1b[A" : "\x1b[B");
      assert.equal(e.v.sel, t.id); assert.match(e.text(160), new RegExp(`\\n─+\\n . ${title} {2}\\S[^\\n]*\\n─+\\n❯ your reply`)); await A.clear(other); e.v.load(); }
    e.press("alt+v"); assert.equal(e.v.chatOpen, true); assert.match(e.text(160), /\n Done\. *\n─+\n❯ your reply/);
    // space goes back to the Coordinator with its message up, and its reply is there.
    e.press("space"); assert.equal(e.v.chatOpen, true); assert.equal(e.v.reply, false); e.beat();
    assert.match(e.text(), /\n . Coordinator {2}idle[^\n]*\n › do something *\n All done\. *\n─+\n❯ ask or tell it anything/); assert.equal(C.look().unseen, "");
    // Nothing changes who the chat names while you type.
    e.type("half typed");
    w.script({ coordinator: [{ said: "Again." }] });
    C.send(w.root, "once more"); await drainJobs(runJob); e.beat(); e.beat();
    assert.match(e.text(), /\n . Coordinator {2}[^\n]*\n › once more *\n Again\. *\n─+\n❯ half typed/);
    e.press("esc");
    // Whatever was typed in its own chat, the text box's last words no longer head its last message.
    e.press("alt+c"); assert.deepEqual(e.closed, [{ entered: "coordinator" }]); assert.equal(C.get().last, "");
    // alt+c is the same key for a task's agent: with its task open, it goes into that agent's pane.
    w.script({ worker: [{ status: "working", screen: "● Editing greet.sh\n" }] });
    const u = A.add(w.root, "Still at it"); A.delegate(u.id); await settle(u.id);
    const g = open(w); g.v.sel = u.id; g.v.load(); g.press("space");
    assert.match(g.text(160), /\n─+\n . Still at it {2}working *\n ● Editing greet\.sh *\n─+\n❯ your reply/);
    // That line is what herdr's sidebar says about the agent, with the board's own mark: the row's mark, the name in
    // bold, and the Watcher's "doing now" line greyed, cut with "…" where it does not fit. No keys are named on it.
    S.update(u.id, (c) => { c.msg = "Verifying the test run after the rebase onto main"; }); g.v.load();
    assert.match(g.text(160), /\n . Still at it {2}Verifying the test run after the rebase onto main *\n ● Editing/); assert.doesNotMatch(g.text(160), /alt\+c|alt\+v|its agent · /);
    const plain = stripVTControlCharacters, mark = g.v.mark(g.v.current()), headAt = (w) => g.v.chatHead(g.v.chatOf(g.v.current()), w)[0];
    assert.ok(headAt(40).startsWith(` ${mark} ${g.v.theme.bold("Still at it")}  `)); assert.equal(g.v.chatOf(g.v.current()).status, g.v.theme.muted("Verifying the test run after the rebase onto main"));
    // However little room the name leaves, the status is cut, never dropped: down to the "…" alone.
    for (const [w, want] of [[40, "  Verifying the test run …"], [23, "  Verify…"], [18, "  V…"], [17, "  …"], [16, ""]]) assert.equal(plain(headAt(w)), ` ${plain(mark)} Still at it${want}`, `at ${w}`);
    // A review's verdict is coloured on its row; here it is the same grey as every other status.
    g.v.sentence = () => ({ text: "\x1b[32mPass\x1b[39m\x1b[90m · 1 minor\x1b[39m" });
    assert.equal(g.v.chatOf(g.v.current()).status, g.v.theme.muted("Pass · 1 minor")); delete g.v.sentence;
    g.press("alt+c"); assert.deepEqual(g.closed, [{ entered: u.id }]);
    // A narrow window is the same chat: space talks to the task's agent and opens nothing, alt+v hides and shows its
    // message there too (the whole task, on ctrl+e, has it meanwhile), and space again goes back to the Coordinator.
    {
      const n = open(w); n.v.sel = t.id; n.v.load(); n.screen(70); n.press("space");
      assert.equal(n.v.reply, true); assert.equal(n.v.full, false); n.press("ctrl+e");
      assert.match(n.text(70), /\n Done\. *\n─+\n❯ your reply *\n─+\n[^\n]*esc back *$/); assert.doesNotMatch(n.text(70), /alt\+v/, "the hint line does not carry the chat's key either"); assert.doesNotMatch(n.text(70), /The agent said/);
      n.press("alt+v"); assert.match(n.text(70), /The agent said ─+ *\n Done\./); assert.match(n.text(70), /\n─+\n❯ your reply *\n─+\n/);
      // esc leaves the whole task and nothing else: the chat stays hidden, and stays the agent's.
      n.press("esc"); assert.equal(n.v.full, false); assert.equal(n.v.reply, true); assert.equal(n.v.chatOpen, false);
      n.press("alt+v", "space"); assert.equal(n.v.reply, false); assert.equal(n.v.full, false); assert.match(n.text(70), /\n . Coordinator {2}/);
      // ctrl+e alone never changes who gets your words.
      n.press("ctrl+e"); assert.equal(n.v.full, true); assert.equal(n.v.reply, false); assert.match(n.text(70), /\n . Coordinator {2}[^\n]*\n(?:[^\n]*\n)*?─+\n❯ ask or tell it anything/);
      n.type("for the Coordinator"); n.press("enter"); assert.equal(C.get().queue.at(-1).text, "for the Coordinator"); await drainJobs(runJob);
    }
    // A short, narrow window with a long name and a draft of several lines: the draft's line, the box and the hints are whole.
    {
      const x = open(w, { rows: 8 }); x.v.sel = t.id; x.v.load(); x.screen(44); x.press("space");
      x.v.setValue("one\ntwo\nthree\nfour and last");
      const lines = x.screen(44);
      assert.equal(lines.length, 8); assert.ok(lines.every((l) => l.length <= 44));
      assert.ok(lines.some((l) => l.includes("four and last")), "the line you are typing shows"); assert.match(lines.at(-1), /enter send to its agent/); assert.match(lines.at(-2), /^─/);
      assert.ok(lines.some((l) => /Add a greeting/.test(l) && !/task panel/.test(l)), "and so does who you talk to");
    }
    for (const width of [24, 40, 64, 90, 200]) for (const reply of [false, true]) { const x = open(w); x.v.sel = t.id; x.v.load(); if (reply) x.press("space"); assert.ok(x.screen(width).every((l) => l.length <= width), `fits ${width}`); assert.equal(x.screen(width).length, 34); }
    for (const rows of [8, 12, 20]) { const x = open(w, { rows }); assert.equal(x.screen(80).length, rows); assert.ok(x.screen(80).some((l) => /^❯/.test(l)), "the text box is never pushed off a short window"); }
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("the herdr action goes into the Coordinator's pane from anywhere, starting it first when it is not running", async () => {
  const w = await coordWorld();
  try {
    const going = main(["open-coordinator"]);
    await until(() => globalThis.__swJobs.length); await drainJobs(runJob); // it asked for the start and waits for it
    assert.equal(await going, 0);
    assert.equal(w.agents().length, 1); assert.deepEqual(w.state().focus, [`agent ${C.get().pane}`], "its pane, not the board");
    assert.equal(await main(["open-coordinator"]), 0); assert.equal(w.state().focus.length, 2);
  } finally { w.cleanup(); }
});

test("sent with tab: every task the Coordinator files from that message gets an agent, said in the message and done by the board itself", async () => {
  const w = await coordWorld();
  const out = []; const write = process.stdout.write;
  const board = async (...argv) => { out.length = 0; process.stdout.write = (x) => (out.push(String(x)), true); try { assert.equal(await main(argv), 0); } finally { process.stdout.write = write; } globalThis.__swJobs = []; return out.join(""); }; // (the agents themselves are not started here)
  const started = (id) => ["queued", "starting"].includes(S.find(id).stage);
  const ids = () => S.list().map((t) => t.id).sort((a, b) => a.split("/")[1] - b.split("/")[1]);
  // The Coordinator ends its turn: herdr counts one more finished turn.
  const endTurn = () => w.patchState((st) => { const p = st.panes.find((x) => x.agent); st.seq += 1; p.agent.status = "done"; p.agent.seq = st.seq; p.agent.completion = st.seq; });
  try {
    process.env.HERDR_SUPERWORK_HANDLED_MS = "0";
    // tab: the message itself says so, under the words. The Coordinator is now in that message's turn.
    w.script({ coordinator: [{ status: "working" }] });
    C.send(w.root, "a login page, and dark mode", { delegate: true }); await drainJobs(runJob);
    assert.equal(w.agents()[0].agent.prompts[0], `a login page, and dark mode\n\n${C.TAB_NOTE}`);
    assert.match(C.rules(), /A message sent with tab ends with a line in square brackets saying so\.[^\n]*every task you file from that message gets an agent at once, with no question back/);
    const pane = C.get().pane;
    // A task filed from anywhere else is only filed: the human's shell, a working agent's pane.
    assert.match(await board("add", "Mine", "--repo", w.root), /^proj\/1: filed\n$/);
    process.env.HERDR_PANE_ID = "w9:p1";
    assert.match(await board("add", "A worker's follow-up", "--repo", w.root), /^proj\/2: filed\n$/);
    // Filed from the Coordinator's pane, with no flag at all (it forgot): the board delegates it. Every one of them.
    process.env.HERDR_PANE_ID = pane;
    assert.match(await board("add", "Login page", "--repo", w.root), /^proj\/3: filed, an agent is on it \(the message was sent with tab\)\n$/);
    assert.match(await board("add", "Dark mode", "--repo", w.root), /^proj\/4: filed, an agent is on it \(the message was sent with tab\)\n$/);
    // It remembered the flag: the same, once.
    assert.match(await board("add", "Sign up", "--repo", w.root, "--delegate"), /^proj\/5: filed, an agent is on it\n$/);
    assert.deepEqual(ids().filter(started), ["proj/3", "proj/4", "proj/5"]);
    // Its turn is over. What it files later (asked in its own pane, say) is not that message's: filed, not delegated.
    endTurn();
    assert.match(await board("add", "Later", "--repo", w.root), /^proj\/6: filed\n$/);
    // A tab message that files nothing (a question) delegates nothing: no task appears, none is started.
    w.script({ coordinator: [{ said: "Two are being worked on." }] });
    C.send(w.root, "how is it going?", { delegate: true }); await drainJobs(runJob);
    assert.equal(ids().length, 6); assert.deepEqual(ids().filter(started), ["proj/3", "proj/4", "proj/5"]);
    // enter: as before. The words go in alone, and what is filed from them is only filed.
    w.script({ coordinator: [{ status: "working" }] });
    C.send(w.root, "note down: tidy the footer"); await drainJobs(runJob);
    assert.equal(w.agents()[0].agent.prompts.at(-1), "note down: tidy the footer");
    assert.match(await board("add", "Tidy the footer", "--repo", w.root), /^proj\/7: filed\n$/);
    // A tab message that goes in while it is still busy with the enter one: whose task the next one is cannot be
    // known here, so the board leaves it to the line in the message.
    w.script({ coordinator: [{ status: "working" }] });
    C.send(w.root, "and a new logo", { delegate: true }); await drainJobs(runJob);
    assert.equal(w.agents()[0].agent.prompts.at(-1), `and a new logo\n\n${C.TAB_NOTE}`);
    assert.match(await board("add", "New logo", "--repo", w.root), /^proj\/8: filed\n$/);
    // Both dealt with; the next tab message is clear again.
    endTurn();
    w.script({ coordinator: [{ status: "working" }] });
    C.send(w.root, "a pricing page", { delegate: true }); await drainJobs(runJob);
    assert.match(await board("add", "Pricing page", "--repo", w.root), /^proj\/9: filed, an agent is on it \(the message was sent with tab\)\n$/);
    // A Coordinator that was restarted is not in that turn any more.
    S.writeJson(path.join(S.dataDir(), "coordinator", "default", "state.json"), { ...C.get(), startedAt: C.get().startedAt + 1 });
    assert.match(await board("add", "After a restart", "--repo", w.root), /^proj\/10: filed\n$/);
    assert.deepEqual(ids().filter(started), ["proj/3", "proj/4", "proj/5", "proj/9"]);
    globalThis.__swJobs = [];
  } finally { process.stdout.write = write; delete process.env.HERDR_PANE_ID; delete process.env.HERDR_SUPERWORK_HANDLED_MS; w.cleanup(); }
});
