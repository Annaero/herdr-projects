// The Coordinator's conversation: restart, new, the agent's own new-chat command, its default program.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as C from "../src/coordinator.js";
import { main } from "../src/cli.js";
import { runJob } from "../src/jobs.js";
import { drainJobs } from "../src/runner.js";
import { coordWorld, open } from "./coordinator-helpers.js";

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
    const s = open(w);
    assert.equal(C.look().stale, true); assert.match(s.text(), /your default is now codex · claude-haiku-5-5 · default effort: alt\+n starts a new one on it/);
    // From the board: alt+r and alt+n ask first, with the board's one question box; a one-off kind is `coordinator new --agent …`.
    s.press("alt+r"); assert.match(s.text(), /\n \? Restart the Coordinator\? It keeps this conversation; what it is doing right now stops\. {2}y = yes · n = no/); assert.ok(!C.get().want);
    s.press("esc"); assert.ok(!C.get().want);
    s.press("alt+r", "enter"); assert.ok(!C.get().want); s.press("y"); assert.equal(C.get().want.what, "restart"); await drainJobs(runJob); assert.equal(w.agents()[0].agent.kind, "claude");
    // Like every shortcut, the chat's keys act only on an empty text box: a draft owns them, and stays what it was.
    s.type("pi some-model"); s.press("alt+n", "alt+r", "alt+c", "alt+v"); assert.equal(s.v.ask, null); assert.equal(s.v.chatOpen, true); assert.deepEqual(s.closed, []); assert.match(s.v.value(), /pi some-model/); assert.ok(!C.get().want);
    s.press("esc");
    s.press("alt+n", "y"); await drainJobs(runJob);
    assert.equal(w.agents()[0].agent.kind, "codex"); assert.equal(C.look().stale, false);
    // Stop closes it; off turns the box back into filing word for word.
    await cli("coordinator", "stop"); assert.equal(w.agents().length, 0); assert.equal(w.state().workspaces.length, 0); assert.equal(C.look().state, "exited");
    await cli("config", "coordinator", "off");
    assert.equal(C.choice(), null);
  } finally { w.cleanup(); }
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
    { const at = new Date(Date.now() + 500); fs.utimesSync(file, at, at); } // written after the start, whatever the file system's clock says
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

test("the agent's own new-chat command is followed: the chat shows the new conversation, and a restart reopens that one", async () => {
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
