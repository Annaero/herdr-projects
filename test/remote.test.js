// Other machines: the door, actions where the task lives, the SSH line.
import test from "node:test";
import assert from "node:assert/strict";
import { world, settle } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { machines, sshCommand, attachCommand } from "../src/remote.js";
import { execFileSync } from "node:child_process";

test("other machines: the door answers one line of JSON, actions run where the task lives, and the SSH line uses a login shell", async () => {
  const w = await world({ settings: { "review.when": "never", "board.machines": "exedev@vm-a, vm-b" } });
  try {
    const t = A.add(w.root, "Remote task");
    const door = (...args) => execFileSync(process.execPath, [S.BIN, "remote", ...args], { encoding: "utf8" }).trim();
    const pack = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
    const lines = [door("list"), door("do", pack({ action: "pin", id: t.id })), door("do", pack({ action: "nope", id: t.id })), door("dispatch", pack({ text: "Added from afar" }))];
    const [list, pin, nope, disp] = lines.map((l) => JSON.parse(l));
    assert.equal(list.tasks[0].id, t.id); assert.equal(list.tasks[0].state, "idle"); assert.ok(list.tasks[0].snap.folder);
    assert.deepEqual(pin, { ok: true, msg: "" }); assert.equal(S.get(t.id).pinned, true);
    assert.equal(nope.ok, false); assert.equal(disp.ok, true); assert.match(disp.msg, /added/);
    let found; machines((m) => { found = m; });
    assert.deepEqual(found.map((m) => [m.target, m.label]), [["exedev@vm-a", "vm-a"], [`${S.me() === "exedev" ? "exedev" : (await import("node:os")).userInfo().username}@vm-b`, "vm-b"]]);
    const cmd = sshCommand({ target: "exedev@vm-a", session: "work" }, "herdr-superwork remote list");
    assert.equal(cmd.command, "ssh"); assert.ok(cmd.args.includes("BatchMode=yes"));
    assert.equal(cmd.args.at(-1), `exec "\${SHELL:-/bin/sh}" -lc 'HERDR_SESSION=work herdr-superwork remote list'`);
    const at = attachCommand({ target: "exedev@vm-a", session: "" }, "w4:p1; rm -rf /");
    assert.ok(at.args.includes("-t")); assert.match(at.args.at(-1), /herdr agent attach w4:p1rm-rf'$/);
  } finally { w.cleanup(); }
});

test("other machines: the asking machine's work settings arrive with the task it starts, its panel reads the task's settings, and a row is changed where the task lives", async () => {
  const w = await world({ settings: { "review.rounds": 1 } });
  try {
    const { remoteMain } = await import("../src/remote.js");
    const pack = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
    const door = async (...args) => { let out = ""; const write = process.stdout.write; process.stdout.write = (x, ...r) => (typeof x === "string" ? ((out += x), true) : write.call(process.stdout, x, ...r)); try { await remoteMain(args); } finally { process.stdout.write = write; } return JSON.parse(out.trim().split("\n").pop()); };
    const t = A.add(w.root, "Started from afar");
    w.script({ worker: [{ status: "working" }] });
    // delegate, with what the asking machine says for this repo: it stands where this machine's own "you" would
    const sent = { "review.rounds": 5, "worker.agent": "codex", "merge.by": "itself" };
    assert.equal((await door("do", pack({ action: "delegate", id: t.id, settings: sent, from: "laptop" }))).ok, true);
    assert.deepEqual(S.get(t.id).carried, { from: "laptop", settings: sent }); assert.equal(S.get(t.id).agent, "codex");
    assert.equal(S.setting("review.rounds", S.get(t.id)), 5); assert.equal(S.setting("review.rounds"), 1); // this machine's own are untouched
    // the list carries each setting with its place, for the asking side's task panel
    const row = (await door("list")).tasks.find((x) => x.id === t.id).snap.settings.find((r) => r.name === "review.rounds");
    assert.deepEqual([row.value, row.from, row.own], [5, "sent from laptop", false]);
    // a row changed, and put back, from the asking side's settings page
    assert.deepEqual(await door("do", pack({ action: "set", id: t.id, name: "review.rounds", value: "2" })), { ok: true, msg: "review.rounds: 2 (this task)" });
    assert.deepEqual(await door("do", pack({ action: "set", id: t.id, name: "review.rounds" })), { ok: true, msg: "review.rounds: 5 (sent from laptop)" });
    // what is sent is checked like anything else: a board setting or a wrong value is refused, and nothing starts
    const u = A.add(w.root, "Refused");
    const no = await door("do", pack({ action: "delegate", id: u.id, settings: { "merge.by": "sometimes" }, from: "laptop" }));
    assert.equal(no.ok, false); assert.match(no.msg, /merge\.by must be you, itself/); assert.equal(S.get(u.id).stage, "todo"); assert.equal(S.get(u.id).carried, undefined);
  } finally { w.cleanup(); }
});

test("settings carried from another machine outlast the agent's start, and a task that waited for a slot starts on the agent the setting names then", async () => {
  const w = await world({ settings: { "review.rounds": 7, "merge.by": "itself", "board.agents": 1 } });
  try {
    const { delegateJob } = await import("../src/delegate.js");
    const first = A.add(w.root, "Carried").id;
    S.update(first, (t) => { t.carried = { from: "laptop", settings: { "review.rounds": 0, "merge.by": "you" } }; });
    w.script({ worker: [{ status: "working" }, { status: "working" }] });
    A.delegate(first); await settle(first);
    // the first prompt went in and is tracked on the task: what was carried is still what counts, not this machine's own
    let t = S.get(first);
    assert.equal(t.stage, "working"); assert.deepEqual(t.carried, { from: "laptop", settings: { "review.rounds": 0, "merge.by": "you" } });
    assert.deepEqual([S.setting("review.rounds", t), S.setting("merge.by", t)], [0, "you"]);
    S.update(first, { sent: { at: Date.now(), tries: 1, text: "x" } }); assert.equal(S.setting("review.rounds", S.get(first)), 0); // the prompt's own record is another field
    S.update(first, { sent: null }); assert.deepEqual([S.setting("review.rounds", S.get(first)), S.setting("merge.by", S.get(first))], [0, "you"]);
    // a task of this machine reads this machine's own, whatever is tracked of its prompt
    const second = A.add(w.root, "Waits its turn").id;
    A.delegate(second);
    assert.equal(S.get(second).stage, "queued"); assert.equal(S.get(second).agent, "claude"); assert.equal(S.setting("review.rounds", S.get(second)), 7);
    // while it waits, its agent is changed: it starts on that one, with its model
    S.setValue("worker.agent", "codex/gpt-5.5", { task: S.get(second) });
    S.update(first, { stage: "stopped" });
    const { startQueued } = await import("../src/actions/start.js");
    startQueued(); await settle(second);
    t = S.get(second);
    const agent = w.state().panes.find((p) => p.pane_id === t.link.pane).agent;
    assert.equal(t.agent, "codex"); assert.equal(agent.kind, "codex"); assert.deepEqual(agent.args.slice(agent.args.indexOf("-m"), agent.args.indexOf("-m") + 2), ["-m", "gpt-5.5"]);
    assert.equal(typeof delegateJob, "function");
  } finally { w.cleanup(); }
});
