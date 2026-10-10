import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { world, settle } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import * as H from "../src/helpers.js";
import { View, osc } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { runJob } from "../src/jobs.js";
import { drainJobs } from "../src/runner.js";
import { remoteMain, machines, sshCommand, attachCommand } from "../src/remote.js";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY = { enter: "\r", tab: "\t", esc: "\x1b", space: " ", right: "\x1b[C", down: "\x1b[B", up: "\x1b[A", "ctrl+a": "\x01", "ctrl+e": "\x05", "ctrl+x": "\x18", "ctrl+t": "\x14", "ctrl+r": "\x12", "ctrl+y": "\x19", "ctrl+g": "\x07", "ctrl+z": "\x1a", "ctrl+b": "\x02", "ctrl+f": "\x06", "ctrl+s": "\x13", "alt+a": "\x1ba", "alt+h": "\x1bh" };
function open(w, { rows = 34 } = {}) {
  let closed;
  const tui = { terminal: { rows, columns: 120 }, requestRender() {}, stop() {}, start() {} };
  const v = new View(tui, theme, (x) => { closed = x ?? null; }, { cwd: w.root });
  clearInterval(v.timer);
  const screen = (width = 120) => v.render(width).map((l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, ""));
  const press = (...keys) => { for (const k of keys) v.handleInput(KEY[k] ?? k); };
  const type = (text) => { for (const ch of text) v.handleInput(ch); };
  return { v, screen, press, type, closed: () => closed, text: (width) => screen(width).join("\n") };
}

test("the sidebar cuts a long description short so the task facts stay in view; ctrl+e still shows all of it", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const long = Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of a very long description.`).join("\n");
    A.add(w.root, "Short one", { description: "Brief." });
    A.add(w.root, "Long one", { description: long });
    const s = open(w);
    let text = s.text(120);
    assert.match(text, /Line 1 of a very long/);
    assert.match(text, /… ctrl\+e shows the rest/);
    assert.doesNotMatch(text, /Line 80 of/);
    for (const fact of ["Project", "Permissions", "Worktree", "Agent", "Watcher"]) assert.match(text, new RegExp(`│  ${fact} `), fact);
    assert.doesNotMatch(text, /More below/);
    // A 24-row terminal: the description shrinks to one line, then to its heading alone, before any fact is lost.
    const small = open(w, { rows: 24 });
    for (const width of [120, 90]) {
      const t24 = small.text(width);
      assert.match(t24, width === 120 ? /Line 1 of a very long[^\n]*\n[^\n]*… ctrl\+e shows the rest/ : /│  Description · ctrl\+e shows it/, `description at ${width}`);
      for (const fact of ["Project", "Permissions", "Worktree", "Agent", "Watcher"]) assert.match(t24, new RegExp(`│  ${fact} `), `${fact} at ${width}x24`);
      assert.doesNotMatch(t24, /More below/);
    }
    s.press("ctrl+e");
    s.v.detailsTop = 1e9;
    assert.match(s.text(120), /Line 80 of/); // nothing is lost in full details
    s.press("esc", "down");
    text = s.text(120);
    assert.match(text, /Brief\./);
    assert.doesNotMatch(text, /shows the rest/); // a short one is left alone
  } finally { w.cleanup(); }
});

test("the board: groups, aligned rows, side panel from 90 columns, details, and the helpers-off note", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    A.add(w.root, "Write the docs", { description: "All of them." });
    const b = A.add(w.root, "My own task"); A.report(b.id, { state: "working", msg: "half way" });
    const s = open(w);
    let text = s.text(120);
    assert.match(text, /herdr-superwork {2}work board for herdr/);
    assert.match(text, /0 blocked · 0 error · 1 working · 0 done · 1 idle/);
    assert.match(text, /● My own task {2}half way/); assert.match(text, /○ Write the docs {2}idle/);
    assert.match(text, /│ {2}My own task/); assert.match(text, /you are on it/); assert.match(text, /Permissions {6}full access/);
    assert.match(text, /what's next\? \(no Coordinator: what you type is filed as a task, word for word\)/);
    assert.equal(s.screen(120).length, 34); assert.ok(s.screen(120).every((l) => l.length <= 120));
    assert.ok(!/│ {2}My own task/.test(s.text(80)), "no side panel below 90 columns");
    s.press("ctrl+b"); assert.ok(!/│ {2}My own task/.test(s.text(120))); s.press("ctrl+b");
    s.press("down", "ctrl+e");
    text = s.text(120);
    assert.match(text, /Details · proj\/1 · esc back/); assert.match(text, /All of them\./); assert.match(text, /lines 1–/);
    s.press("esc");
    assert.match(s.text(120), /work board for herdr/);
    for (const width of [24, 40, 64, 89, 90, 200]) assert.ok(s.screen(width).every((l) => l.length <= width), `fits ${width}`);
  } finally { w.cleanup(); }
});

test("the board's keys: file by typing, tab delegates, space previews the agent's screen and replies, enter goes in", async () => {
  const w = await world({ settings: { helper: "off", reviewer: "off" } });
  try {
    process.env.HERDR_ENV = "1";
    w.script({ worker: [{ status: "working", screen: "● Editing greet.sh\n  esc to interrupt\n" }] });
    const s = open(w);
    s.type("Add a greeting"); s.press("enter");
    assert.equal(S.get("proj/1").title, "Add a greeting"); assert.equal(s.v.sel, "proj/1"); assert.equal(s.v.value(), "");
    s.press("right"); assert.match(s.text(), /No agent has been on this yet/);
    s.press("tab");
    await settle("proj/1"); s.v.load();
    assert.match(s.text(), /✽|✻/); assert.match(s.text(), /1 working/);
    s.press("space");
    assert.match(s.text(), /● Editing greet\.sh/); assert.match(s.text(), /reply to Add a greeting/);
    w.script({ worker: [{ status: "working" }] });
    s.type("also say goodbye"); s.press("enter");
    assert.match(s.text(), /Sent to the agent/);
    const t = S.get("proj/1");
    assert.match(w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts.at(-1), /also say goodbye/);
    s.press("esc");
    // enter: focus the agent's real pane by pane id and close the board; selection and filter come back on reopen
    s.press("enter");
    assert.deepEqual(s.closed(), { entered: "proj/1" });
    assert.ok(w.state().focus.includes(`agent ${t.link.pane}`));
    s.v.dispose();
    assert.equal(S.readJson(path.join(S.dataDir(), "view.json")).sel, "proj/1");
    // ctrl+x stops; the stage is set before esc
    const s2 = open(w);
    assert.equal(s2.v.sel, "proj/1");
    s2.press("ctrl+x");
    assert.equal(S.get("proj/1").stage, "stopped"); assert.match(s2.text(), /stopped, idle/);
  } finally { delete process.env.HERDR_ENV; w.cleanup(); }
});

test("the board: approval row draws as review, ctrl+a approves, archive view, undo, pin, find", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f." }], reviewer: [{ verdict: { score: 4, recommend: true, text: "Good." } }] });
    const id = A.add(w.root, "Make f").id; A.add(w.root, "Other");
    A.delegate(id); await settle(id);
    const s = open(w);
    s.v.sel = id; s.v.load();
    let text = s.text();
    assert.match(s.text(80), /\n blocked +\n ◆ /); assert.match(text, /◆ blocked · review/);
    s.press("space");
    assert.match(s.text(), /Recommends {6}merge/); assert.match(s.text(), /Score {11}4\/5/); assert.match(s.text(), /ctrl\+a to approve and merge/);
    s.press("esc", "ctrl+a");
    assert.equal(S.get(id).stage, "merging");
    await settle(id); s.v.load();
    assert.match(s.text(), /✓ Make f/);
    // archive and undo
    s.v.sel = "proj/2"; s.v.load();
    s.press("alt+a"); assert.ok(S.get("proj/2").archivedAt); assert.ok(!/Other/.test(s.screen().slice(0, 12).join("\n")));
    s.press("alt+h"); assert.match(s.text(), /Archived tasks/); assert.match(s.text(), /Other \[archived\]/);
    s.press("alt+h", "ctrl+z"); assert.ok(!S.get("proj/2").archivedAt);
    s.v.sel = "proj/2"; s.v.load(); s.press("ctrl+t"); assert.equal(S.get("proj/2").pinned, true); assert.match(s.text(80), /\n pinned +\n/);
    s.press("ctrl+f"); s.type("make"); s.press("enter");
    s.v.msgAt = 0; // an earlier message has faded
    assert.match(s.text(), /filter: make/); assert.ok(!/○ Other/.test(s.text()));
    // twice ctrl+x clears a non-working task
    s.press("esc"); s.v.sel = "proj/2"; s.v.load(); s.press("ctrl+x"); assert.match(s.text(), /ctrl\+x again to clear proj\/2/);
    assert.equal(osc({ state: "blocked", kind: "question", id: "proj/1", title: "T", msg: "m", app: "claude" }), "\x1b]7501;state=blocked:id=proj/1:kind=question:app=claude:title=VA==:msg=bQ==\x1b\\");
  } finally { w.cleanup(); }
});

test("hidden helpers: the box files through a restricted helper and survives as a row; the watcher writes a line and a guess", async () => {
  const w = await world({ settings: { reviewer: "off", watcher: "on" } });
  try {
    process.env.HERDR_SUPERWORK_HELPER_CMD = JSON.stringify(["node", path.join(here, "fake-helper.js")]);
    fs.mkdirSync(path.join(w.base, "shim")); fs.symlinkSync(S.BIN, path.join(w.base, "shim", "herdr-superwork")); process.env.PATH = `${path.join(w.base, "shim")}:${process.env.PATH}`;
    assert.ok(H.dispatcherReady());
    const s = open(w);
    s.type("build a login page"); s.press("enter");
    assert.equal(S.dispatches().length, 1); assert.match(s.text(), /✽ build a login page|✻ build a login page/);
    await drainJobs(runJob); s.v.load();
    assert.equal(S.dispatches().length, 0); assert.match(s.text(), /Filed proj\/1\./);
    assert.equal(S.get("proj/1").description, "From the box: build a login page");
    s.type("fail on purpose"); s.press("enter"); await drainJobs(runJob); s.v.load();
    assert.equal(S.dispatches()[0].state, "error"); assert.match(s.text(), /✗ fail on purpose {2}the model refused/);
    // the watcher: only while herdr says working; 100k auto-compact on the watcher only
    w.script({ worker: [{ status: "working", screen: "● Writing greet.sh\n" }] });
    A.delegate("proj/1"); await settle("proj/1");
    H.watchTick(F.board());
    for (let i = 0; i < 60 && !S.get("proj/1").watch; i++) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual([S.get("proj/1").watch.msg, S.get("proj/1").watch.progress], ["editing the greeting file", 42]);
    const shown = F.board().find((t) => t.id === "proj/1");
    assert.deepEqual([shown.note, shown.progress], ["editing the greeting file", 42]);
    assert.ok(w.state().metadata.some((m) => m.args.join(" ").includes("summary=editing the greeting file")));
  } finally { delete process.env.HERDR_SUPERWORK_HELPER_CMD; w.cleanup(); }
});

test("other machines: the door answers one line of JSON, actions run where the task lives, and the SSH line uses a login shell", async () => {
  const w = await world({ settings: { helper: "off", reviewer: "off", machines: "exedev@vm-a, vm-b" } });
  try {
    const t = A.add(w.root, "Remote task");
    const door = (...args) => execFileSync(process.execPath, [S.BIN, "remote", ...args], { encoding: "utf8" }).trim();
    const pack = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
    const lines = [door("list"), door("do", pack({ action: "pin", id: t.id })), door("do", pack({ action: "nope", id: t.id })), door("dispatch", pack({ text: "Filed from afar" }))];
    const [list, pin, nope, disp] = lines.map((l) => JSON.parse(l));
    assert.equal(list.tasks[0].id, t.id); assert.equal(list.tasks[0].state, "idle"); assert.ok(list.tasks[0].snap.folder);
    assert.deepEqual(pin, { ok: true, msg: "" }); assert.equal(S.get(t.id).pinned, true);
    assert.equal(nope.ok, false); assert.equal(disp.ok, true); assert.match(disp.msg, /filed/);
    let found; machines((m) => { found = m; });
    assert.deepEqual(found.map((m) => [m.target, m.label]), [["exedev@vm-a", "vm-a"], [`${S.me() === "exedev" ? "exedev" : (await import("node:os")).userInfo().username}@vm-b`, "vm-b"]]);
    const cmd = sshCommand({ target: "exedev@vm-a", session: "work" }, "herdr-superwork remote list");
    assert.equal(cmd.command, "ssh"); assert.ok(cmd.args.includes("BatchMode=yes"));
    assert.equal(cmd.args.at(-1), `exec "\${SHELL:-/bin/sh}" -lc 'HERDR_SESSION=work herdr-superwork remote list'`);
    const at = attachCommand({ target: "exedev@vm-a", session: "" }, "w4:p1; rm -rf /");
    assert.ok(at.args.includes("-t")); assert.match(at.args.at(-1), /herdr agent attach w4:p1rm-rf'$/);
  } finally { w.cleanup(); }
});

test("the command: add, list, report, config, and the hook entry does nothing when there are no tasks", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const sw = (...args) => execFileSync(process.execPath, [S.BIN, ...args], { encoding: "utf8", cwd: w.root });
    assert.equal(sw("hook"), "");
    assert.ok(!fs.existsSync(path.join(S.dataDir(), "tasks")));
    const out = [sw("add", "From", "the", "shell", "--desc", "d", "--json"), sw("report", "1", "--state", "working", "--msg", "on it"), sw("list", "--json"), sw("config", "max", "2"), sw("config", "reviewer", "off", "--id", "1"), sw("--skill")];
    assert.equal(JSON.parse(out[0]).id, "proj/1");
    const listed = JSON.parse(out[2]); assert.deepEqual([listed[0].state, listed[0].app, listed[0].msg], ["working", S.me(), "on it"]);
    assert.equal(S.config().max, 2); assert.equal(S.choices(S.get("proj/1")).review, "none");
    assert.match(out.at(-1), /report <your id> --state blocked/);
    assert.throws(() => sw("frobnicate"), /Unknown command/);
  } finally { w.cleanup(); }
});
