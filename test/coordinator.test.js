// The Coordinator: one long-lived agent behind the box, its drawer on the board, and its real terminal full screen.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as C from "../src/coordinator.js";
import { main } from "../src/cli.js";
import { View } from "../src/board/view.js";
import { Bridge } from "../src/board/bridge.js";
import { theme } from "../src/board/theme.js";
import { runJob } from "../src/jobs.js";
import { drainJobs } from "../src/runner.js";

const KEY = { enter: "\r", tab: "\t", esc: "\x1b", space: " ", "alt+c": "\x1bc", "alt+v": "\x1bv", "alt+n": "\x1bn", "alt+r": "\x1br" };
// A world with a Coordinator: the default one is Claude Code on its defaults. Its folder and Claude's own files are the
// test's, and both programs count as installed without being run.
async function coordWorld(settings = {}) {
  const w = await world({ settings: { coordinator: "claude", reviewer: "off", ...settings } });
  process.env.HERDR_SUPERWORK_COORDINATOR_DIR = path.join(w.base, "home"); fs.mkdirSync(process.env.HERDR_SUPERWORK_COORDINATOR_DIR);
  process.env.CLAUDE_CONFIG_DIR = path.join(w.base, "claude");
  S.writeJson(path.join(S.dataDir(), "versions.json"), Object.fromEntries(["claude", "codex"].map((k) => [k, { v: "9.9.9", at: Date.now(), found: true }])));
  const end = w.cleanup;
  w.cleanup = () => { delete process.env.HERDR_SUPERWORK_COORDINATOR_DIR; delete process.env.CLAUDE_CONFIG_DIR; end(); };
  w.agents = () => w.state().panes.filter((p) => p.agent);
  return w;
}
function open(w, { rows = 34, bridges = [] } = {}) {
  const calls = [];
  const tui = { terminal: { rows, columns: 120 }, requestRender() {}, stop() { calls.push("stop"); }, start() { calls.push("start"); } };
  // A stand-in for the real terminal bridge: it remembers what it was given and lets the test press its keys.
  const bridge = (o) => { const b = { o, started: false, stopped: false, start() { this.started = true; }, stop() { this.stopped = true; }, drawFooter() {} }; bridges.push(b); return b; };
  const v = new View(tui, theme, () => {}, { cwd: w.root, bridge });
  // As main.js does: the board's screen starts after the view is made, and only then may the chat take it over.
  const early = bridges.length; calls.push("start"); v.started();
  v.early = early;
  clearInterval(v.timer);
  const screen = (width = 120) => v.render(width).map((l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, ""));
  const press = (...keys) => { for (const k of keys) v.handleInput(KEY[k] ?? k); };
  const type = (text) => { for (const ch of text) v.handleInput(ch); };
  const beat = () => { v.load(); v.syncDrawer(); };
  return { v, tui: calls, screen, press, type, beat, text: (width) => screen(width).join("\n") };
}

test("the box talks to one long-lived Coordinator: an ordinary agent, started once, with nothing held back", async () => {
  const w = await coordWorld();
  try {
    assert.ok(C.ready());
    w.script({ coordinator: [{ said: "Filed proj/1." }, { said: "Delegated proj/1." }] });
    const s = open(w);
    assert.match(s.text(), /❯ what's next\?/); assert.match(s.text(), /alt\+c coordinator/);
    s.type("build a login page"); s.press("enter");
    assert.equal(C.get().queue.length, 1);
    s.beat();
    assert.match(s.text(), /● Coordinator starting · build a login page · alt\+c shows it/); // hidden: one row while it is busy
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
    assert.match(agent.prompts[0], /^\[board: the human is in the repo "proj" \(.*\)\]\nbuild a login page$/);
    assert.equal(C.get().queue.length, 0);
    // Its reply pops the drawer up, once.
    s.beat();
    assert.equal(s.v.drawer, "peek");
    let text = s.text();
    assert.match(text, /○ Coordinator {2}idle {2}claude · default model · default effort {2}· last message/);
    assert.match(text, /› build a login page *\n Filed proj\/1\./);
    assert.match(text, /❯ say something to the Coordinator/);
    s.press("esc"); assert.equal(s.v.drawer, "hidden"); s.beat(); assert.equal(s.v.drawer, "hidden", "a reply you have seen does not pop up again");
    assert.doesNotMatch(s.text(), /Filed proj\/1\./);
    // The next thing you type goes to the same agent in the same conversation; Tab asks it to delegate.
    s.type("and start it"); s.press("tab");
    await drainJobs(runJob);
    assert.equal(w.agents().length, 1); assert.equal(w.state().calls.filter((c) => c.startsWith("agent start")).length, 1);
    assert.equal(w.agents()[0].agent.prompts.length, 2);
    assert.match(w.agents()[0].agent.prompts[1], /\nand start it\n\nDelegate what you file to an agent\.$/);
    s.beat(); assert.equal(s.v.drawer, "peek"); assert.match(s.text(), /Delegated proj\/1\./);
    // With the preview of a task open that has no agent to reply to, the words go to the Coordinator with that task named.
    const t = A.add(w.root, "Write the docs");
    A.report(t.id, { state: "done" });
    s.v.sel = t.id; s.press("esc", "space"); assert.equal(s.v.peek, true); assert.equal(s.v.drawer, "hidden");
    s.type("make it shorter"); s.press("enter"); await drainJobs(runJob);
    assert.match(w.agents()[0].agent.prompts[2], /task proj\/1 \("Write the docs"\) is open, so "it" and "this" mean that task\]\nmake it shorter$/);
  } finally { w.cleanup(); }
});

test("the drawer has three stops and moves between them freely: hidden, the last message, the real chat full screen", async () => {
  const w = await coordWorld();
  try {
    const bridges = [];
    const s = open(w, { bridges });
    assert.equal(s.v.drawer, "hidden");
    s.press("alt+c"); assert.equal(s.v.drawer, "peek");
    assert.match(s.text(), /Coordinator {2}not started {2}claude · default model · default effort/); assert.match(s.text(), /it starts with your first message, and stays/);
    assert.match(s.text(), /alt\+c its chat, full screen · alt\+v or esc hide · alt\+r restart · alt\+n new one/);
    // Full screen before it ever ran: it is started with nothing said, and its terminal shows as soon as it is there.
    s.press("alt+c"); assert.equal(s.v.drawer, "full"); assert.equal(bridges.length, 0);
    assert.match(s.text(), /Starting the Coordinator… its chat opens here as soon as it is ready\./);
    s.type("x"); assert.equal(s.v.value(), "", "nothing is typed anywhere while it starts");
    await drainJobs(runJob);
    assert.equal(w.agents().length, 1); assert.equal(w.agents()[0].agent.prompts, undefined);
    s.beat();
    assert.equal(bridges.length, 1); assert.ok(bridges[0].started); assert.deepEqual(s.tui, ["start", "stop"]); // the board's own screen steps aside
    assert.equal(bridges[0].o.pane, C.get().pane); assert.equal(bridges[0].o.socket, w.socket);
    assert.match(stripVTControlCharacters(bridges[0].o.footer(120)), /Coordinator {2}claude · default model · default effort {2}· {2}alt\+v drawer down · alt\+c back to the board/);
    // Its keys: alt+v lowers to the last message, alt+c goes back to the board.
    bridges[0].o.onKey("peek");
    assert.equal(s.v.drawer, "peek"); assert.ok(bridges[0].stopped); assert.deepEqual(s.tui, ["start", "stop", "start"]);
    s.press("alt+c"); assert.equal(s.v.drawer, "full"); assert.equal(bridges.length, 2); assert.ok(bridges[1].started);
    bridges[1].o.onKey("hidden"); assert.equal(s.v.drawer, "hidden"); assert.ok(bridges[1].stopped);
    // Down one step at a time, and esc hides it.
    s.press("alt+c", "alt+c"); assert.equal(s.v.drawer, "full"); bridges[2].o.onKey("peek"); s.press("alt+v"); assert.equal(s.v.drawer, "hidden");
    s.press("alt+c", "esc"); assert.equal(s.v.drawer, "hidden");
    // herdr ending the stream (its terminal taken over elsewhere) drops back to the last message, with the reason.
    s.press("alt+c", "alt+c"); bridges[3].o.onClose("its terminal was closed or taken over elsewhere");
    assert.equal(s.v.drawer, "peek"); assert.match(s.text(), /The Coordinator's chat closed: its terminal was closed or taken over elsewhere\./);
    // A task's preview and the drawer share the place above the box: one at a time, and a reply never pops up over a
    // preview, where your typing belongs to that task's agent.
    A.add(w.root, "A task"); s.v.msgAt = 0; s.beat();
    s.press("space"); assert.equal(s.v.peek, true); assert.equal(s.v.drawer, "hidden");
    w.script({ coordinator: [{ said: "All done." }] });
    C.send(w.root, "do something"); await drainJobs(runJob); s.beat();
    assert.equal(s.v.drawer, "hidden"); assert.match(s.text(), /Coordinator replied · alt\+c shows it · All done\./);
    s.press("alt+c"); assert.equal(s.v.peek, false); assert.equal(s.v.drawer, "peek"); assert.match(s.text(), /last message *\n › do something *\n All done\./);
    // The plugin's herdr action asks an open board for the full-screen chat.
    s.press("esc"); C.askFull(); s.v.beat(); assert.equal(s.v.drawer, "full"); assert.equal(bridges.length, 5);
    s.v.dispose(); assert.ok(bridges[4].stopped);
    // A board opened straight into the chat: its own screen starts first and is then stopped for the chat's, so only
    // the chat hears the keys, and alt+v lands on the last message, not past it.
    C.askFull(); const before = bridges.length; const d = open(w, { bridges });
    assert.equal(d.v.early, before, "no chat before the board's screen runs"); assert.equal(bridges.length, before + 1);
    assert.deepEqual(d.tui.slice(0, 2), ["start", "stop"]);
    bridges.at(-1).o.onKey("peek"); assert.equal(d.v.drawer, "peek"); assert.deepEqual(d.tui, ["start", "stop", "start"]);
    d.v.dispose();
    assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).drawer, "peek"); // a board closed on the chat reopens on its last message
    for (const width of [24, 40, 64, 90, 200]) assert.ok(open(w).screen(width).every((l) => l.length <= width), `fits ${width}`);
  } finally { w.cleanup(); }
});

test("restart keeps the conversation, new starts a fresh one, and one Coordinator can be picked for a single use", async () => {
  const w = await coordWorld({ coordinatorModel: "claude-haiku-5-5" });
  try {
    const out = [];
    const write = process.stdout.write.bind(process.stdout);
    const cli = async (...args) => { process.stdout.write = (x) => { out.push(String(x)); return true; }; try { await main(args); } finally { process.stdout.write = write; } await drainJobs(runJob); return out.pop(); };
    const arg = (flag) => { const a = w.agents()[0].agent.args; return a[a.indexOf(flag) + 1]; };
    w.script({ coordinator: [{ said: "Hello." }] }); // it has said something: there is a conversation to come back to
    assert.match(await cli("coordinator", "tell", "hello"), /sent to the Coordinator/);
    const first = C.get();
    assert.equal(arg("--session-id"), first.session); assert.equal(arg("--model"), "claude-haiku-5-5");
    assert.match(await cli("coordinator"), /Coordinator: idle · claude · claude-haiku-5-5 · default effort · default: claude · claude-haiku-5-5 · default effort/);
    // Restart: a new terminal, the same conversation.
    assert.match(await cli("coordinator", "restart"), /restarting, in the same conversation/);
    assert.notEqual(C.get().pane, first.pane); assert.equal(w.state().workspaces.length, 1);
    assert.equal(arg("--resume"), first.session); assert.equal(C.get().session, first.session);
    // The program exiting by itself is the same: the next message starts it again where it left off.
    w.patchState((st) => { st.panes.find((p) => p.agent).agent = null; });
    assert.equal(C.look().state, "exited");
    C.send(w.root, "still there?"); await drainJobs(runJob);
    assert.equal(arg("--resume"), first.session); assert.deepEqual(w.agents()[0].agent.prompts.map((p) => p.split("\n").pop()), ["still there?"]);
    // New, for one use: codex, its own model and effort. The default is untouched.
    assert.match(await cli("coordinator", "new", "--agent", "codex", "--model", "gpt-x", "--effort", "high"), /a new Coordinator is starting/);
    let agent = w.agents()[0].agent;
    assert.equal(agent.kind, "codex"); assert.deepEqual(agent.args.slice(-6, -2), ["-m", "gpt-x", "-c", 'model_reasoning_effort="high"']);
    assert.match(agent.args.at(-1), /^developer_instructions=.*You are the Coordinator/);
    assert.deepEqual(C.get().run, { kind: "codex", model: "gpt-x", effort: "high", oneOff: true }); assert.equal(C.get().session, null);
    assert.equal(S.config().coordinator, "claude"); assert.equal(C.look().stale, false);
    assert.match(await cli("coordinator"), /codex · gpt-x · high \(for this one only\) · default: claude · claude-haiku-5-5/);
    // Restarting a one-off keeps it; a plain new one is the default again.
    await cli("coordinator", "restart"); assert.equal(w.agents()[0].agent.kind, "codex");
    await cli("coordinator", "new");
    assert.equal(w.agents()[0].agent.kind, "claude"); assert.notEqual(C.get().session, first.session); assert.equal(C.get().run.oneOff, undefined);
    // The default is a setting like the agent's, the watcher's and the reviewer's; a running one says when it changed.
    await cli("config", "coordinator", "codex");
    assert.deepEqual(C.choice(), { kind: "codex", model: "claude-haiku-5-5", effort: "" });
    const s = open(w); s.press("alt+c");
    assert.equal(C.look().stale, true); assert.match(s.text(), /your default is now codex · claude-haiku-5-5 · default effort: alt\+n starts a new one on it/);
    // From the board: alt+r and alt+n ask twice; a kind typed first makes alt+n a one-off.
    s.press("alt+r"); assert.match(s.text(), /alt\+r again: restart the Coordinator/); assert.ok(!C.get().want);
    s.press("alt+r"); assert.equal(C.get().want.what, "restart"); await drainJobs(runJob); assert.equal(w.agents()[0].agent.kind, "claude");
    s.type("pi some-model"); s.press("alt+n"); assert.match(s.text(), /alt\+n again: a new Coordinator on pi · some-model · default effort \(this one only\)/);
    s.press("alt+n"); assert.equal(s.v.value(), ""); assert.deepEqual(C.get().want.pick, { kind: "pi", model: "some-model", effort: "" });
    // An empty box again: alt+n is the default, and the request before it is replaced.
    s.press("alt+n", "alt+n"); await drainJobs(runJob);
    assert.equal(w.agents()[0].agent.kind, "codex"); assert.equal(C.look().stale, false);
    // Stop closes it; off turns the box back into filing word for word.
    await cli("coordinator", "stop"); assert.equal(w.agents().length, 0); assert.equal(w.state().workspaces.length, 0); assert.equal(C.look().state, "exited");
    await cli("config", "coordinator", "off");
    assert.equal(C.choice(), null);
  } finally { w.cleanup(); }
});

test("what you say is never lost: a dialog on its screen holds it, a failed start says why", async () => {
  const w = await coordWorld();
  try {
    w.patchState((st) => { st.dialogs.claude = 1; }); // a first-run dialog blocks the start
    C.send(w.root, "first"); await drainJobs(runJob);
    assert.equal(C.get().queue.length, 1); assert.equal(C.look().state, "blocked");
    const s = open(w); s.press("alt+c");
    assert.match(s.text(), /Coordinator {2}needs you/); assert.match(s.text(), /› first {2}\(waiting to be sent\)/);
    s.press("esc"); assert.match(s.text(), /Coordinator needs you · something on its screen waits · alt\+c shows it/);
    // You answer the dialog in its chat; the tick then types the waiting words in.
    w.patchState((st) => { const p = st.panes.find((x) => x.agent); p.agent.status = "idle"; });
    fs.rmSync(S.stampFile(`coordinator-default`), { force: true });
    C.tick(); await drainJobs(runJob);
    assert.equal(C.get().queue.length, 0); assert.deepEqual(w.agents()[0].agent.prompts.map((p) => p.split("\n").pop()), ["first"]);
    // A program that is not installed cannot be started: the reason shows, and the words wait.
    S.writeJson(path.join(S.dataDir(), "versions.json"), { nope: { v: "", at: Date.now(), found: false } });
    C.fresh(C.pickOf({ agent: "nope" })); C.send(w.root, "second"); await drainJobs(runJob);
    assert.match(C.look().error, /"nope" is not installed here/); assert.equal(C.get().queue.length, 1);
    s.beat(); assert.match(s.text(), /Coordinator could not be started: "nope" is not installed here/);
    assert.throws(() => C.pickOf({ agent: "not a kind" }), /must be an agent kind/);
  } finally { w.cleanup(); }
});

test("the full-screen chat is the agent's real terminal: frames out, keys in, and only the drawer's keys are kept", () => {
  const written = [], spawned = [];
  const stdin = Object.assign(new EventEmitter(), { raw: null, setRawMode(v) { this.raw = v; }, resume() {} });
  const stdout = Object.assign(new EventEmitter(), { rows: 30, columns: 100, write(x) { written.push(Buffer.isBuffer(x) ? x.toString("utf8") : String(x)); return true; } });
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill() {} });
  const sent = []; child.stdin.on("data", (d) => sent.push(...String(d).split("\n").filter(Boolean).map((l) => JSON.parse(l))));
  const keys = [], closed = [];
  const b = new Bridge({ socket: "/tmp/x.sock", pane: "w9:p1", footer: () => "FOOT", keys: [["alt+c", "hidden"], ["alt+v", "peek"]], onKey: (k) => keys.push(k), onClose: (why) => closed.push(why),
    io: { stdin, stdout, spawn: (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return child; } } });
  b.start();
  // One row is the board's: the agent's terminal is asked for one row less than the screen.
  assert.deepEqual(spawned[0].args, ["terminal", "session", "control", "w9:p1", "--takeover", "--cols", "100", "--rows", "29"]);
  assert.equal(spawned[0].opts.env.HERDR_SOCKET_PATH, "/tmp/x.sock"); assert.equal(stdin.raw, true);
  assert.ok(written[0].startsWith("\x1b[?1049h")); assert.ok(written.at(-1).includes("\x1b[30;1H") && written.at(-1).includes("FOOT"));
  const frame = (text, full) => child.stdout.write(JSON.stringify({ type: "terminal.frame", full, bytes: Buffer.from(text).toString("base64") }) + "\n");
  written.length = 0; frame("\x1b[2Jhello", true);
  return new Promise((resolve) => setImmediate(() => {
    assert.equal(written[0], "\x1b[2Jhello"); assert.ok(written[1].includes("FOOT"), "a full frame clears the screen, so the board's row is drawn again");
    stdin.emit("data", Buffer.from("hi\r")); stdin.emit("data", Buffer.from("\x1bc")); stdin.emit("data", Buffer.from("\x1bv")); stdin.emit("data", Buffer.from("\x1b[5;2~"));
    stdout.rows = 20; stdout.columns = 60; stdout.emit("resize");
    setImmediate(() => {
      assert.deepEqual(sent, [{ type: "terminal.input", bytes: Buffer.from("hi\r").toString("base64") }, { type: "terminal.scroll", direction: "up", lines: 14 }, { type: "terminal.resize", cols: 60, rows: 19 }]);
      assert.deepEqual(keys, ["hidden", "peek"]);
      child.stdout.write(JSON.stringify({ type: "terminal.closed", reason: "detached" }) + "\n");
      setImmediate(() => {
        assert.equal(closed.length, 1); assert.equal(stdin.raw, false); assert.ok(written.at(-1).endsWith("\x1b[?1049l")); assert.equal(stdin.listenerCount("data"), 0);
        resolve();
      });
    });
  }));
});

test("a program that names its own conversations (Codex) is restarted in the same one, without the board having looked first", async () => {
  const w = await coordWorld({ coordinator: "codex" });
  const before = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(w.base, "codex");
  try {
    C.send(w.root, "hello"); await drainJobs(runJob);
    assert.equal(w.agents()[0].agent.kind, "codex"); assert.equal(C.get().session, null);
    // Codex wrote its conversation, as it does, under a name of its own. Nothing has read it yet.
    const file = path.join(process.env.CODEX_HOME, "sessions", "2026", "rollout-2026-sess-1.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), type: "session_meta", payload: { id: "sess-1", cwd: fs.realpathSync(C.home()), instructions: "You are the Coordinator of the human's work board in herdr" } }) + "\n");
    C.restart(); await drainJobs(runJob);
    assert.deepEqual(w.agents()[0].agent.args.slice(0, 2), ["resume", "sess-1"]); assert.equal(C.get().session, "sess-1");
    // A helper agent it spawned, and a headless run it made, save conversations of their own in the same folder,
    // newer than the main one. Neither is the Coordinator's: the drawer and a restart stay with the main conversation.
    const other = (name, payload) => { const f = path.join(path.dirname(file), `rollout-2026-${name}.jsonl`); fs.writeFileSync(f, JSON.stringify({ timestamp: new Date().toISOString(), type: "session_meta", payload: { id: name, cwd: fs.realpathSync(C.home()), ...payload } }) + "\n"); const at = new Date(Date.now() + 1000); fs.utimesSync(f, at, at); };
    other("helper-1", { source: { subagent: { thread_spawn: { parent_thread_id: "sess-1", depth: 1 } } }, parent_thread_id: "sess-1", forked_from_id: "sess-1" });
    other("exec-1", { source: "exec", originator: "codex_exec" });
    fs.rmSync(S.stampFile("coordinator-session-default"), { force: true });
    C.look(); assert.equal(C.get().session, "sess-1");
    C.restart(); await drainJobs(runJob);
    assert.deepEqual(w.agents()[0].agent.args.slice(0, 2), ["resume", "sess-1"]);
    // Its own /new is still followed, past those.
    other("sess-2", { source: "cli", originator: "codex-tui" });
    fs.utimesSync(path.join(path.dirname(file), "rollout-2026-sess-2.jsonl"), new Date(Date.now() + 2000), new Date(Date.now() + 2000));
    C.restart(); await drainJobs(runJob);
    assert.deepEqual(w.agents()[0].agent.args.slice(0, 2), ["resume", "sess-2"]);
    fs.rmSync(path.join(path.dirname(file), "rollout-2026-sess-2.jsonl")); for (const n of ["helper-1", "exec-1"]) fs.rmSync(path.join(path.dirname(file), `rollout-2026-${n}.jsonl`));
    C.restart(); await drainJobs(runJob);
    // The same when its program exited and the next message starts it again.
    { const since = C.get().since; w.patchState((st) => { st.panes.find((p) => p.agent).agent = null; }); C.send(w.root, "again"); await drainJobs(runJob); assert.equal(C.get().since, since); }
    assert.deepEqual(w.agents()[0].agent.args.slice(0, 2), ["resume", "sess-1"]);
  } finally { if (before === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = before; w.cleanup(); }
});

test("turning the Coordinator on while the board is open takes effect at once, and off again too", async () => {
  const w = await coordWorld({ coordinator: "off" });
  try {
    const s = open(w);
    assert.match(s.text(), /no Coordinator: what you type is filed as a task, word for word/);
    s.type("first thing"); s.press("enter");
    assert.equal(S.get("proj/1").title, "first thing"); assert.equal(C.get(), null);
    S.setConfig("coordinator", "default"); // the board stays open
    s.type("second thing"); s.press("enter");
    assert.equal(S.get("proj/2"), null, "not filed word for word any more"); assert.equal(C.get().queue.length, 1);
    await drainJobs(runJob);
    assert.match(w.agents()[0].agent.prompts[0], /\nsecond thing$/); assert.doesNotMatch(s.text(), /no Coordinator/);
    // Off again: the next beat that checks sees it, even with one still running.
    S.setConfig("coordinator", "off");
    s.v.tick = 4; s.v.beat();
    s.type("third thing"); s.press("enter");
    assert.equal(S.get("proj/2").title, "third thing"); assert.equal(w.agents()[0].agent.prompts.length, 1);
    // And the drawer's key turns up a Coordinator that was switched on after the board opened.
    const off = open(w); assert.equal(off.v.canDispatch, false);
    S.setConfig("coordinator", "default"); off.press("alt+c"); assert.equal(off.v.drawer, "peek");
  } finally { w.cleanup(); }
});

test("a start that fails loses nothing: a restart asked for meanwhile still happens, and a long launch line never reaches the shell", async () => {
  const w = await coordWorld({ coordinator: "codex" });
  try {
    // Codex's flag for standing rules carries the text itself. The whole launch line must stay well under what a
    // terminal takes on one line (4096 bytes): the flag points at a file and the rules go in with the first message.
    C.send(w.root, "hello"); await drainJobs(runJob);
    const agent = w.agents()[0].agent;
    assert.ok(["codex", ...agent.args].join(" ").length < 2000, "the launch line is short");
    const flag = agent.args.at(-1);
    assert.match(flag, /^developer_instructions="You are the Coordinator of the human's work board in herdr\. Your standing rules are in the file .*rules\.md: read it/);
    assert.match(fs.readFileSync(/in the file (\S+rules\.md):/.exec(flag)[1], "utf8"), /board add "<short title/);
    assert.match(agent.prompts[0], /^You are the Coordinator of the human's work board[\s\S]*\n\n\[board: the human is in the repo "proj"[^\n]*\]\nhello$/);
    C.send(w.root, "again"); await drainJobs(runJob);
    assert.match(w.agents()[0].agent.prompts[1], /^\[board:/, "the rules ride on the first message only");
    // A start that fails while you ask for a new one: the failure is said, and your request is still carried out.
    const real = process.env.HERDR_BIN_PATH, failing = path.join(w.base, "herdr-failing");
    fs.writeFileSync(failing, `#!/bin/sh\nif [ "$1 $2" = "agent start" ] && [ ! -e "${w.base}/ok" ]; then node -e 'const C = await import("${path.resolve("src/coordinator.js")}"); C.fresh(C.pickOf({ agent: "claude" }));' --input-type=module 2>/dev/null; touch "${w.base}/ok"; echo '{"error":{"code":"timeout","message":"the agent did not become ready"}}' >&2; exit 1; fi\nexec "${real}" "$@"\n`, { mode: 0o755 });
    process.env.HERDR_BIN_PATH = failing;
    try {
      C.restart();
      const { pump } = C; globalThis.__swJobs.length = 0; pump(w.socket); // the restart's start fails; a "new" was asked for while it ran
      assert.match(C.look().error, /did not become ready/);
      assert.equal(C.get().want?.what, "new", "the newer request survives the failure");
      assert.equal(C.get().pane, null, "the half-started pane is not reused");
      await drainJobs(runJob);
    } finally { process.env.HERDR_BIN_PATH = real; }
    assert.equal(w.agents().length, 1); assert.equal(w.agents()[0].agent.kind, "claude"); assert.ok(!C.get().want); assert.equal(C.look().state, "idle");
    assert.equal(C.look().error, "", "the failure of the start it replaced is not shown over a Coordinator that is there");
    const s = open(w); s.press("alt+c"); assert.doesNotMatch(s.text(), /could not be started/); assert.match(s.text(), /Coordinator {2}idle/);
    // A start that failed is not tried again every few seconds by itself; your next message tries.
    S.writeJson(path.join(S.dataDir(), "versions.json"), { nope: { v: "", at: Date.now(), found: false } });
    C.fresh(C.pickOf({ agent: "nope" })); C.send(w.root, "x"); await drainJobs(runJob);
    assert.match(C.get().error, /not installed/);
    fs.rmSync(S.stampFile(`coordinator-default`), { force: true });
    C.tick(); assert.equal(globalThis.__swJobs.length, 0);
  } finally { w.cleanup(); }
});

test("the agent's own new-chat command is followed: the drawer shows the new conversation, and a restart reopens that one", async () => {
  const w = await coordWorld();
  try {
    w.script({ coordinator: [{ said: "pineapple" }] });
    C.send(w.root, "pick a fruit"); await drainJobs(runJob);
    const first = C.get().session;
    assert.equal(C.look().said, "pineapple");
    // You type /clear in its chat: Claude Code starts another conversation file beside the first.
    const dir = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", fs.realpathSync(C.home()).replace(/[^A-Za-z0-9]/g, "-"));
    const later = new Date(), earlier = new Date(Date.now() - 1500);
    fs.utimesSync(path.join(dir, `${first}.jsonl`), earlier, earlier);
    fs.writeFileSync(path.join(dir, "22222222-2222-4222-8222-222222222222.jsonl"), JSON.stringify({ type: "assistant", uuid: "u9", message: { id: "msg_new", role: "assistant", content: [{ type: "text", text: "watermelon" }], stop_reason: "end_turn" }, timestamp: later.toISOString() }) + "\n");
    fs.utimesSync(path.join(dir, "22222222-2222-4222-8222-222222222222.jsonl"), later, later);
    fs.rmSync(S.stampFile(`coordinator-session-default`), { force: true });
    const v = C.look();
    assert.equal(v.said, "watermelon"); assert.equal(v.unseen, "msg_new"); assert.equal(C.get().session, "22222222-2222-4222-8222-222222222222");
    // A helper's side conversation and a headless run in the same folder, both newer, are not its conversation.
    const stray = (name, entry) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify({ type: "user", ...entry, message: { role: "user", content: "x" }, timestamp: new Date().toISOString() }) + "\n"); const at = new Date(Date.now() + 1000); fs.utimesSync(f, at, at); };
    stray("agent-abc123.jsonl", { isSidechain: true, entrypoint: "cli" });
    stray("33333333-3333-4333-8333-333333333333.jsonl", { isSidechain: false, entrypoint: "sdk-cli" });
    stray("44444444-4444-4444-8444-444444444444.jsonl", { isSidechain: true, entrypoint: "cli" });
    fs.rmSync(S.stampFile("coordinator-session-default"), { force: true });
    assert.equal(C.look().said, "watermelon"); assert.equal(C.get().session, "22222222-2222-4222-8222-222222222222");
    // Restart, with no board looking in between: the conversation it was in, not the one it began with.
    C.restart(); await drainJobs(runJob);
    const args = w.agents()[0].agent.args;
    assert.equal(args[args.indexOf("--resume") + 1], "22222222-2222-4222-8222-222222222222"); assert.notEqual(C.get().session, first);
    // A new Coordinator leaves both behind: conversations from before it began are not its own.
    await new Promise((r) => setTimeout(r, 30));
    C.fresh(); await drainJobs(runJob);
    fs.rmSync(S.stampFile(`coordinator-session-default`), { force: true });
    assert.equal(C.look().said, ""); assert.ok(!["22222222-2222-4222-8222-222222222222", first].includes(C.get().session));
    // It runs in a folder of its own, so nothing else's conversations are ever taken for its.
    delete process.env.HERDR_SUPERWORK_COORDINATOR_DIR;
    assert.equal(C.home(), path.join(S.dataDir(), "coordinator", "default", "chat"));
  } finally { w.cleanup(); }
});

test("pi's own /new is followed too: the newest session saved for its folder is the Coordinator's", async () => {
  const w = await coordWorld({ coordinator: "pi" });
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(w.base, "pi");
  S.writeJson(path.join(S.dataDir(), "versions.json"), { pi: { v: "9.9.9", at: Date.now(), found: true } });
  try {
    C.send(w.root, "pick a fruit"); await drainJobs(runJob);
    const agent = w.agents()[0].agent, first = C.get().session;
    assert.equal(agent.kind, "pi"); assert.equal(agent.args[agent.args.indexOf("--session-id") + 1], first);
    // pi saves each conversation as <time>_<id>.jsonl in a folder named after the working folder.
    const dir = path.join(process.env.PI_CODING_AGENT_DIR, "sessions", "--the-folder--"); fs.mkdirSync(dir, { recursive: true });
    const save = (id, text, cwd, ms) => { const f = path.join(dir, `2026-10-10T00-00-0${ms}-000Z_${id}.jsonl`); const at = new Date(Date.now() + ms * 10);
      fs.writeFileSync(f, [{ type: "session", version: 3, id, timestamp: at.toISOString(), cwd }, { type: "message", id: `m-${id}`, timestamp: at.toISOString(), message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } }].map((x) => JSON.stringify(x)).join("\n") + "\n"); fs.utimesSync(f, at, at); };
    const look = () => { fs.rmSync(S.stampFile("coordinator-session-default"), { force: true }); return C.look(); };
    save(first, "pineapple", fs.realpathSync(C.home()), 1);
    assert.equal(look().said, "pineapple");
    save("0199aaaa-new", "watermelon", fs.realpathSync(C.home()), 2); // you typed /new in its chat
    save("0199bbbb-other", "kiwi", "/somewhere/else", 3);            // a pi chat of yours in another folder, newer still
    assert.equal(look().said, "watermelon"); assert.equal(C.get().session, "0199aaaa-new");
    C.restart(); await drainJobs(runJob);
    const again = w.agents()[0].agent.args;
    assert.equal(again[again.indexOf("--session-id") + 1], "0199aaaa-new", "restart reopens the conversation it was in");
  } finally { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; w.cleanup(); }
});

test("out of the box the Coordinator is Claude Code on its defaults, whatever the working agent is set to", async () => {
  const w = await coordWorld({ agent: "codex", model: "gpt-5.5", effort: "high" });
  try {
    assert.equal(S.DEFAULTS.coordinator, "claude");
    assert.deepEqual(C.choice(), { kind: "claude", model: "", effort: "" });
    S.setConfig("coordinator", ""); // nothing set is the default too, not the working agent
    assert.deepEqual(C.choice(), { kind: "claude", model: "", effort: "" });
    C.send(w.root, "hello"); await drainJobs(runJob);
    assert.deepEqual(C.get().run, { kind: "claude", model: "", effort: "" });
    const [a] = w.agents();
    assert.equal(a.agent.kind, "claude");
    assert.ok(!/--model|--effort|gpt-5\.5/.test(JSON.stringify(a.agent.args)), "the agent's model and effort are not passed on");
    S.setConfig("coordinatorModel", "claude-haiku-5-5");
    assert.deepEqual(C.choice(), { kind: "claude", model: "claude-haiku-5-5", effort: "" });
  } finally { w.cleanup(); }
});

test("the full-screen shortcut reaches the board of its own herdr session only", async () => {
  const w = await coordWorld();
  try {
    const here = path.join(w.base, "sessions", "one", "herdr.sock"), other = path.join(w.base, "sessions", "two", "herdr.sock");
    C.askFull(here);
    assert.equal(C.takeFull(other), false, "a board in another session does not take it");
    assert.equal(C.takeFull(here), true, "and it is still there for the board it was meant for");
    assert.equal(C.takeFull(here), false);
  } finally { w.cleanup(); }
});

test("stop leaves it stopped, also with words still waiting: they go in with your next message", async () => {
  const w = await coordWorld();
  try {
    C.send(w.root, "first"); await drainJobs(runJob);
    assert.equal(w.agents().length, 1);
    // Words on their way when the stop is asked for: the stop does not start it again to deliver them.
    C.send(w.root, "waiting"); await new Promise((r) => setTimeout(r, 5)); C.stop(); await drainJobs(runJob);
    assert.equal(w.agents().length, 0); assert.equal(C.get().queue.length, 1); assert.equal(C.get().stopped, true);
    assert.equal(C.look().state, "exited"); assert.deepEqual(C.look().waiting, ["waiting"]); // the drawer says stopped, not starting
    S.writeJson(path.join(S.dataDir(), "stamps.json"), {}); C.tick(); await drainJobs(runJob); C.pump(); // neither the tick nor a stray pump
    assert.equal(w.agents().length, 0); assert.equal(C.get().queue.length, 1);
    // The next message starts it, where it left off, and nothing was lost.
    await new Promise((r) => setTimeout(r, 5)); C.send(w.root, "next"); await drainJobs(runJob);
    const [a] = w.agents();
    assert.equal(C.get().queue.length, 0); assert.equal(C.get().stopped, false);
    assert.deepEqual(a.agent.prompts.map((p) => p.split("\n").at(-1)), ["waiting", "next"]);
    // Said after the stop was asked for, before it was carried out: that does start it again.
    C.stop(); await new Promise((r) => setTimeout(r, 5)); C.send(w.root, "after"); await drainJobs(runJob);
    assert.equal(w.agents().length, 1); assert.equal(C.get().queue.length, 0); assert.equal(C.get().stopped, false);
  } finally { w.cleanup(); }
});

test("a stop asked for while a message is going in holds back the ones still waiting", async () => {
  const w = await coordWorld();
  const real = process.env.HERDR_BIN_PATH, stopping = path.join(w.base, "herdr-stopping");
  try {
    C.send(w.root, "hello"); await drainJobs(runJob);
    // herdr as it is, except that the stop is asked for in the middle of the first of two deliveries.
    fs.writeFileSync(stopping, `#!/bin/sh\nif [ "$1 $2" = "agent prompt" ] && [ ! -e "${w.base}/asked" ]; then touch "${w.base}/asked"; node -e 'const C = await import("${path.resolve("src/coordinator.js")}"); C.stop();' --input-type=module 2>/dev/null; fi\nexec "${real}" "$@"\n`, { mode: 0o755 });
    process.env.HERDR_BIN_PATH = stopping;
    C.send(w.root, "one"); await new Promise((r) => setTimeout(r, 5)); C.send(w.root, "two");
    globalThis.__swJobs.length = 0; C.pump(w.socket);
    assert.ok(fs.existsSync(path.join(w.base, "asked")));
    assert.equal(w.agents().length, 0, "it is stopped");
    assert.deepEqual(C.get().queue.map((m) => m.said), ["two"], "the second message was not sent ahead of the stop");
    assert.equal(C.get().stopped, true); assert.equal(C.look().state, "exited");
    globalThis.__swJobs.length = 0; C.tick(w.socket); await drainJobs(runJob); assert.equal(w.agents().length, 0);
    process.env.HERDR_BIN_PATH = real;
    await new Promise((r) => setTimeout(r, 5)); C.send(w.root, "three"); await drainJobs(runJob);
    assert.deepEqual(w.agents()[0].agent.prompts.map((p) => p.split("\n").at(-1)), ["two", "three"]);
  } finally { process.env.HERDR_BIN_PATH = real; w.cleanup(); }
});
