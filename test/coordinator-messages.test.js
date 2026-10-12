// What you say to the Coordinator is never lost: dialogs, failed starts, stop, on and off.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as C from "../src/coordinator.js";
import { runJob } from "../src/jobs.js";
import { drainJobs } from "../src/runner.js";
import { coordWorld, open } from "./coordinator-helpers.js";

test("what you say is never lost: a dialog on its screen holds it, a failed start says why", async () => {
  const w = await coordWorld();
  try {
    w.patchState((st) => { st.dialogs.claude = 1; }); // a first-run dialog blocks the start
    C.send(w.root, "first"); await drainJobs(runJob);
    assert.equal(C.get().queue.length, 1); assert.equal(C.look().state, "blocked");
    const s = open(w);
    assert.match(s.text(), /Coordinator {2}needs you/); assert.match(s.text(), /› first {2}\(waiting to be sent\)/);
    s.press("alt+v"); assert.match(s.text(), /\n . Coordinator {2}needs you {2}/); assert.doesNotMatch(s.text(), /waiting to be sent/); // hidden: its one line still says it
    // You answer the dialog in its chat; the tick then types the waiting words in.
    w.patchState((st) => { const p = st.panes.find((x) => x.agent); p.agent.status = "idle"; });
    fs.rmSync(S.stampFile(`coordinator-default`), { force: true });
    C.tick(); await drainJobs(runJob);
    assert.equal(C.get().queue.length, 0); assert.deepEqual(w.agents()[0].agent.prompts.map((p) => p.split("\n").pop()), ["first"]);
    // A second message refused by a dialog did not go in: the first, still being worked on, keeps its repo and its
    // delegate choice, and the second is only said once it really went in.
    const other = path.join(w.base, "elsewhere"); fs.mkdirSync(other);
    w.patchState((st) => { st.panes.find((x) => x.agent).agent.status = "blocked"; });
    C.send(other, "later", { delegate: true }); await drainJobs(runJob);
    assert.equal(C.get().queue.length, 1); assert.deepEqual(C.get().where.map((x) => [x.said, x.repo, x.delegate]), [["first", "proj", false]]);
    assert.doesNotMatch(C.where(), /later|elsewhere|was sent with tab/);
    w.patchState((st) => { st.panes.find((x) => x.agent).agent.status = "idle"; });
    fs.rmSync(S.stampFile(`coordinator-default`), { force: true });
    C.tick(); await drainJobs(runJob);
    assert.deepEqual(C.get().where.map((x) => [x.said, x.repo, x.delegate]), [["first", "proj", false], ["later", "elsewhere", true]]);
    // Two messages in the same millisecond, the same words, from different repos with opposite Tab choices: both
    // reach the agent and each keeps its own.
    const now = Date.now; Date.now = () => 1700000000000;
    try { C.send(w.root, "same words"); C.send(other, "same words", { delegate: true }); } finally { Date.now = now; }
    await drainJobs(runJob);
    assert.equal(C.get().queue.length, 0); assert.deepEqual(w.agents()[0].agent.prompts.filter((p) => p.startsWith("same words")), ["same words", `same words\n\n${C.TAB_NOTE}`]);
    assert.deepEqual(C.get().where.slice(-2).map((x) => [x.said, x.repo, x.delegate]), [["same words", "proj", false], ["same words", "elsewhere", true]]);
    // The list is full (five that went in). One more that a dialog refuses takes nothing away from the oldest.
    process.env.HERDR_SUPERWORK_HANDLED_MS = "0"; // at rest means dealt with, for this part
    C.send(w.root, "fifth"); await drainJobs(runJob);
    const full = C.get().where.map((x) => x.said); assert.deepEqual(full, ["first", "later", "same words", "same words", "fifth"]);
    w.patchState((st) => { st.panes.find((x) => x.agent).agent.status = "blocked"; });
    C.send(other, "sixth", { delegate: true }); await drainJobs(runJob);
    assert.deepEqual(C.get().where.map((x) => x.said), full, "the refused one is not said, and the first is still there");
    w.patchState((st) => { st.panes.find((x) => x.agent).agent.status = "idle"; });
    fs.rmSync(S.stampFile(`coordinator-default`), { force: true });
    C.tick(); await drainJobs(runJob);
    assert.deepEqual(C.get().where.map((x) => x.said), ["later", "same words", "same words", "fifth", "sixth"]);
    // Still working through what it was sent: nothing it has not dealt with yet is dropped, however many wait.
    w.script({ coordinator: [1, 2, 3, 4, 5, 6, 7].map(() => ({ status: "working" })) });
    for (const n of [1, 2, 3, 4, 5, 6, 7]) C.send(n === 1 ? other : w.root, `busy ${n}`, { delegate: n === 1 });
    await drainJobs(runJob);
    assert.equal(C.look().state, "working");
    assert.deepEqual(C.get().where.map((x) => x.said), [1, 2, 3, 4, 5, 6, 7].map((n) => `busy ${n}`), "all seven it still has ahead of it; the ones dealt with before them are gone");
    assert.match(C.where(), /- "busy 1" was sent from the repo "elsewhere"[^\n]*It was sent with tab/);
    // There is no number at which one it has not dealt with is let go: 61 more, and the very first is still there.
    w.script({ coordinator: Array.from({ length: 61 }, () => ({ status: "working" })) });
    for (let n = 8; n <= 68; n++) C.send(w.root, `busy ${n}`);
    await drainJobs(runJob);
    assert.equal(C.get().queue.length, 0); assert.equal(C.get().where.length, 68);
    assert.deepEqual(C.get().where.slice(0, 1).map((x) => [x.said, x.repo, x.delegate]), [["busy 1", "elsewhere", true]]);
    assert.match(C.where(), /- "busy 1" was sent from the repo "elsewhere"[^\n]*It was sent with tab/);
    // Restarted in the middle of that work: its program is idle again, and none of it is done. Idle alone is not
    // taken for dealt with, however long ago the words went in, so the next message drops nothing.
    C.restart(); await drainJobs(runJob);
    assert.equal(C.look().state, "idle"); assert.equal(C.get().where.length, 68);
    w.script({ coordinator: [{ said: "ok" }] });
    C.send(w.root, "after the restart"); await drainJobs(runJob);
    assert.equal(C.get().where.length, 69); assert.deepEqual(C.get().where[0].said, "busy 1"); assert.equal(C.get().where[0].delegate, true);
    // It has finished a turn since and is at rest: the next message finds them dealt with, and the list is the
    // last five once more.
    w.script({ coordinator: [{ said: "ok" }] });
    C.send(w.root, "after"); await drainJobs(runJob);
    assert.deepEqual(C.get().where.map((x) => x.said), ["busy 66", "busy 67", "busy 68", "after the restart", "after"]);
    // A message typed in a moment ago may not have set it working yet: it is not taken for dealt with.
    process.env.HERDR_SUPERWORK_HANDLED_MS = "15000";
    w.script({ coordinator: [1, 2, 3, 4, 5, 6].map(() => ({ said: "ok" })) });
    for (const n of [1, 2, 3, 4, 5, 6]) C.send(w.root, `quick ${n}`);
    await drainJobs(runJob);
    assert.equal(C.look().state, "idle"); assert.deepEqual(C.get().where.map((x) => x.said), ["after", ...[1, 2, 3, 4, 5, 6].map((n) => `quick ${n}`)]);
    // A program that is not installed cannot be started: the reason shows, and the words wait.
    S.writeJson(path.join(S.dataDir(), "versions.json"), { nope: { v: "", at: Date.now(), found: false } });
    C.fresh(C.pickOf({ agent: "nope" })); C.send(w.root, "second"); await drainJobs(runJob);
    assert.match(C.look().error, /"nope" is not installed here/); assert.equal(C.get().queue.length, 1);
    s.beat(); assert.match(s.text(), /Coordinator {2}could not be started[^\n]*\n(?: ›[^\n]*\n)* It could not be started: "nope" is not installed here/); // also with its message hidden
    // alt+v hides that too, as the chat's line says; esc does not.
    s.v.chatOpen = false; s.v.setValue(""); s.v.reply = false; s.v.full = false; s.v.filter = ""; s.v.msg = "";
    assert.match(s.text(), /alt\+v hide its message/);
    s.press("esc"); assert.equal(s.v.ask, null); assert.deepEqual(s.closed, []); assert.match(s.text(), /It could not be started:/);
    s.press("alt+v");
    assert.doesNotMatch(s.text(), /It could not be started:/); assert.match(s.text(), /Coordinator {2}could not be started[^\n]*alt\+v show its message/);
    s.beat(); assert.doesNotMatch(s.text(), /It could not be started:/, "the same error stays hidden");
    s.press("esc"); assert.ok(s.v.closing); s.v.closeSoon();
    // alt+v shows it again and hides it again, shown by the setting or not.
    s.press("alt+v"); assert.match(s.text(), /It could not be started:/); s.press("alt+v"); assert.doesNotMatch(s.text(), /It could not be started:/); assert.equal(s.v.ask, null);
    s.v.errHid = ""; s.v.chatOpen = true; assert.match(s.text(), /It could not be started:/); s.press("alt+v"); assert.doesNotMatch(s.text(), /It could not be started:/);
    assert.throws(() => C.pickOf({ agent: "not a kind" }), /must be an agent kind/);
  } finally { delete process.env.HERDR_SUPERWORK_HANDLED_MS; w.cleanup(); }
});

test("turning the Coordinator on while the board is open takes effect at once, and off again too", async () => {
  const w = await coordWorld({ coordinator: "off" });
  try {
    const s = open(w);
    assert.match(s.text(), /\n─+\n \+ New task {2}what you type is filed as a task, word for word *\n─+\n❯ what's next\? *\n/); assert.doesNotMatch(s.text(), /Coordinator/); // with it off, the chat says what the box does
    s.type("first thing"); s.press("enter");
    assert.equal(S.get("proj/1").title, "first thing"); assert.equal(C.get(), null);
    S.setConfig("coordinator", "default"); // the board stays open
    s.type("second thing"); s.press("enter");
    assert.equal(S.get("proj/2"), null, "not filed word for word any more"); assert.equal(C.get().queue.length, 1);
    await drainJobs(runJob);
    assert.equal(w.agents()[0].agent.prompts[0], "second thing"); assert.doesNotMatch(s.text(), /no Coordinator/);
    // Off again: the next beat that checks sees it, even with one still running.
    S.setConfig("coordinator", "off");
    s.v.tick = 4; s.v.beat();
    s.type("third thing"); s.press("enter");
    assert.equal(S.get("proj/2").title, "third thing"); assert.equal(w.agents()[0].agent.prompts.length, 1);
    // And the chat's key turns up a Coordinator that was switched on after the board opened.
    const off = open(w); assert.equal(off.v.canDispatch, false); assert.match(off.text(), /\+ New task/);
    S.setConfig("coordinator", "default"); off.press("alt+c"); assert.equal(off.v.canDispatch, true); assert.match(off.text(), /\n . Coordinator {2}/);
  } finally { w.cleanup(); }
});

test("a start that fails loses nothing: a restart asked for meanwhile still happens, and a long launch line never reaches the shell", async () => {
  const w = await coordWorld({ coordinator: "codex" });
  try {
    // Codex's flag for standing rules carries the text itself. The whole launch line must stay well under what a
    // terminal takes on one line (4096 bytes): the flag points at a file, and your words go in as they are.
    C.send(w.root, "hello"); await drainJobs(runJob);
    const agent = w.agents()[0].agent;
    assert.ok(["codex", ...agent.args].join(" ").length < 2000, "the launch line is short");
    const flag = agent.args.at(-1);
    assert.match(flag, /^developer_instructions="You are the Coordinator of the human's work board in herdr\. Your standing rules are in the file .*rules\.md: read it/);
    assert.match(fs.readFileSync(/in the file (\S+rules\.md):/.exec(flag)[1], "utf8"), /board add "<short title/);
    assert.equal(agent.prompts[0], "hello", "the rules are never put on what you say");
    C.send(w.root, "again"); await drainJobs(runJob);
    assert.equal(w.agents()[0].agent.prompts[1], "again");
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
    const s = open(w); assert.doesNotMatch(s.text(), /could not be started/); assert.match(s.text(), /Coordinator {2}idle/);
    // A start that failed is not tried again every few seconds by itself; your next message tries.
    S.writeJson(path.join(S.dataDir(), "versions.json"), { nope: { v: "", at: Date.now(), found: false } });
    C.fresh(C.pickOf({ agent: "nope" })); C.send(w.root, "x"); await drainJobs(runJob);
    assert.match(C.get().error, /not installed/);
    fs.rmSync(S.stampFile(`coordinator-default`), { force: true });
    C.tick(); assert.equal(globalThis.__swJobs.length, 0);
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
