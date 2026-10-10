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
    for (const fact of ["Project", "Permissions", "Worktree", "Agent", "Reviewer", "Watcher"]) assert.match(text, new RegExp(`│  ${fact} `), fact);
    assert.doesNotMatch(text, /More below/);
    // A 24-row terminal: the description shrinks to its heading alone before any fact is lost.
    const small = open(w, { rows: 24 });
    for (const width of [120, 90]) {
      const t24 = small.text(width);
      assert.match(t24, /│  Description · ctrl\+e shows it/, `description at ${width}`);
      for (const fact of ["Project", "Permissions", "Worktree", "Agent", "Reviewer", "Watcher"]) assert.match(t24, new RegExp(`│  ${fact} `), `${fact} at ${width}x24`);
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
    const b = A.add(w.root, "My own task"); A.report(b.id, { state: "working", msg: "half way", progress: 50 });
    const s = open(w);
    let text = s.text(120);
    assert.match(text, /herdr-superwork {2}work board for herdr/);
    // Every line is in herdr's text colour (Catppuccin's here), unless colours are switched off; each task's mark is in
    // herdr's colour for its state (working yellow, idle green), and its title stays plain text.
    const raw = s.v.render(120), text0 = "\x1b[38;2;205;214;244m", yellow = "\x1b[38;2;249;226;175m", green = "\x1b[38;2;166;227;161m";
    assert.ok(raw.every((l) => (process.env.NO_COLOR ? !l.includes("\x1b[38;2;") : l.startsWith(text0))));
    if (!process.env.NO_COLOR) {
      assert.ok(raw.some((l) => l.includes(`${yellow}●\x1b[39m${text0} \x1b[1mMy own task\x1b[22m  `)), "a working task's mark is herdr's working colour, its title plain text");
      assert.ok(raw.some((l) => l.includes(`${green}○\x1b[39m${text0} Write the docs  `)), "an idle task's mark is herdr's idle colour, its title plain text");
      assert.ok(raw.some((l) => l.includes(`${yellow}working\x1b[39m`)) && raw.some((l) => l.includes(`${green}idle\x1b[39m`)), "the headings are in herdr's colour for their state");
      assert.ok(raw.some((l) => l.includes(`${yellow} 50%`)), "progress is in the working colour while working");
    }
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

test("a tight row keeps the task's name, then the columns on the right; the sentence takes what is left or goes", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const s = open(w);
    const at = Date.now() - 6 * 60000;
    const records = [
      { id: "proj/1", state: "working", title: "Remove notification pop-ups", msg: "Removing pop-up calls from plugin, fixing tests, writing closing note.", progress: 95, at },
      { id: "proj/2", state: "working", title: "Fix ugly blocked row on the board", msg: "Fixing layout so approval names keep width.", progress: 55, pr: 3, at },
      { id: "proj/3", state: "done", title: "Truncate long descriptions in sidebar", pr: 2, seen: true, at },
    ];
    const draw = (width) => { const layout = s.v.rowLayout(records, width); return records.map((r) => stripVTControlCharacters(s.v.row(r, width, layout))); };
    for (const width of [200, 120, 90, 72, 64, 50, 40, 30, 20]) assert.ok(draw(width).every((l) => l.length <= width), `fits ${width}`);
    let rows = draw(200); // room for everything
    assert.match(rows[0], /Remove notification pop-ups {2}Removing pop-up calls from plugin, fixing tests, writing closing note\. .* 95% +6m$/);
    rows = draw(92); // the sentence is cut, the name and the columns are whole
    assert.match(rows[0], /Remove notification pop-ups {2}Removing pop-up calls[^…]*… +█+ +95% +6m$/);
    assert.match(rows[1], /Fix ugly blocked row on the board {2}Fixing layout[^#]*… +#3 .*55% +6m$/);
    rows = draw(72); // too little left for a sentence worth reading: none at all
    assert.match(rows[0], /Remove notification pop-ups +\S.* 95% +6m$/); assert.doesNotMatch(rows[0], /Remov[^ ]* {2}Re/);
    assert.match(rows[1], /Fix ugly blocked row on the board +#3 .*55% +6m$/);
    rows = draw(56); // no bars below 64 columns
    assert.match(rows[0], /Remove notification pop-ups +95% +6m$/);
    assert.match(rows[1], /Fix ugly blocked row on the board +#3 +55% +6m$/); // a PR row keeps its percent while it fits
    rows = draw(45); // each row gives up only what its own name needs: the percent, then the PR number
    assert.match(rows[0], /Remove notification pop-ups +95% +6m$/);
    assert.match(rows[1], /Fix ugly blocked row on the board +#3 +6m$/);
    assert.match(rows[2], /Truncate long descriptions in sidebar +6m$/);
    rows = draw(40); // last of all the time; a row without a PR is not charged for the PR column
    assert.match(rows[0], /Remove notification pop-ups +95% +6m$/); assert.match(rows[2], /^ \S Truncate long descriptions in sidebar$/);
    rows = draw(30); // only now is a name cut
    assert.match(rows[0], /^ \S Remove notification pop-ups$/); assert.match(rows[1], /^ \S Fix ugly blocked row on th…$/);
    // A long name on one row costs the other rows nothing: their columns still come before their sentence.
    records.splice(0, 3,
      { id: "proj/8", state: "working", title: "Fix login", msg: "Tracing why the login form rejects valid passwords.", progress: 55, pr: 3, at },
      { id: "proj/9", state: "working", title: "Fix layout for task names in narrow terminal board", msg: "Working.", progress: 20, at });
    rows = draw(60);
    assert.match(rows[0], /Fix login {2}Tracing why the login form[^#]*… +#3 +55% +6m$/);
    assert.match(rows[1], /Fix layout for task names in narrow terminal board +6m$/);
    rows = draw(72);
    assert.match(rows[0], /Fix login {2}Tracing[^#]*… +#3 █+░+ +55% +6m$/);
    assert.match(rows[1], /Fix layout for task names in narrow terminal board +█+░+ +20% +6m$/); // not charged for the PR column it leaves blank: the bar fits
    // All machines: the machine's name is cut before the task's, and before any column goes.
    s.v.scope = "*";
    const far = { ...records[0], host: "very-long-machine-name-on-the-tailnet" };
    const one = (width) => stripVTControlCharacters(s.v.row(far, width, s.v.rowLayout([far], width)));
    assert.match(one(120), /very-long-machine-name-on-the-tailnet Fix login {2}Tracing/);
    assert.match(one(40), /very-long-m\S*… Fix login +#3 +55% +6m$/);
    assert.match(one(24), /^ \S ve… Fix login +#3 +6m$/); assert.match(one(18), /^ \S Fix login +6m$/);
    for (const width of [200, 60, 40, 30, 24, 16]) assert.ok(one(width).length <= width, `fits ${width}`);
  } finally { w.cleanup(); }
});

test("the bottom preview never opens by itself: a failure only adds the hint line, space opens and closes it", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    const id = A.add(w.root, "Match the colors").id;
    S.update(id, (t) => { t.stage = "failed"; t.failure = { stage: "merge", phase: "sync", title: "Merge conflict with main", detail: "Conflicting files:\nsrc/board/view.js", agentCanFix: true, next: "Resolve the conflict." }; });
    const s = open(w);
    s.v.load();
    assert.equal(s.v.sel, id); assert.equal(s.v.peek, false);
    let text = s.text(80);
    assert.doesNotMatch(text, /Conflicting files/);
    assert.match(text, /ctrl\+e full details · space to preview/);
    s.press("space"); text = s.text(80);
    assert.match(text, /Merge conflict with main/); assert.match(text, /Conflicting files: *\n src\/board\/view\.js/);
    s.press("space");
    assert.doesNotMatch(s.text(80), /Conflicting files/);
    // Nor does coming back from Archives, whether the panel was open before going in or opened while there.
    s.press("space"); assert.equal(s.v.peek, true);
    s.press("alt+h"); assert.equal(s.v.archiveView, true); assert.equal(s.v.peek, false);
    s.press("alt+h"); assert.equal(s.v.archiveView, false); assert.equal(s.v.sel, id); assert.equal(s.v.peek, false);
    assert.doesNotMatch(s.text(80), /Conflicting files/);
    s.press("alt+h"); s.v.peek = true; s.press("esc"); if (s.v.archiveView) s.press("esc");
    assert.equal(s.v.archiveView, false); assert.equal(s.v.peek, false);
    // Reopening the board never brings the panel back: an open panel is not remembered.
    s.press("space"); assert.equal(s.v.peek, true); s.v.savePrefs();
    const again = open(w);
    again.v.load();
    assert.equal(again.v.sel, id); assert.equal(again.v.peek, false);
    assert.doesNotMatch(again.text(80), /Conflicting files/);
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
    assert.match(s.text(), /● Add a greeting/); assert.match(s.text(), /1 working/);
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
    assert.match(s.text(80), /\n blocked +\n ● /); assert.match(text, /● blocked · review/);
    s.press("space");
    assert.doesNotMatch(s.text(), /Recommends|merge 4\/5/); assert.match(s.text(), /Score {11}4\/5 · review 1/); assert.match(s.text(), /ctrl\+a to approve and merge/);
    s.press("esc", "ctrl+a");
    assert.equal(S.get(id).stage, "merging");
    await settle(id); s.v.load();
    assert.match(s.text(), /● Make f/);
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
    assert.equal(S.dispatches().length, 1); assert.match(s.text(), /● build a login page/);
    await drainJobs(runJob); s.v.load();
    assert.equal(S.dispatches().length, 0); assert.doesNotMatch(s.text(), /Filed proj\/1\./); // a result arriving shows nothing at the bottom
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

test("the board: a row waiting for approval keeps its name, with the PR and the score on the right", () => {
  const v = Object.create(View.prototype); v.theme = theme; v.scope = "";
  const row = (r, width, list = [r]) => stripVTControlCharacters(v.row(r, width, v.rowLayout(list, width)));
  const base = { id: "proj/1", title: "Build a flying game", state: "blocked", kind: "permission", stage: "approval", agent: "claude", at: Date.now(), msg: "Approve to merge? Reviewed 3/5, says don't merge. Built **Skylark**: a little plane over endless sunny islands, with clouds." };
  const review = { score: 3, recommend: false, text: "Crashes." };
  const pr = { ...base, pr: "https://github.com/a/b/pull/12", prState: "passing", review }, plain = { ...base, review };
  const working = { id: "proj/2", title: "Other", state: "working", agent: "claude", stage: "work", progress: 50, msg: "A long sentence about what the other agent is doing right now, in detail.", at: Date.now() };
  // wide: the name, what it waits for, and on the right the score and that it is a PR. No "merge" or "don't merge":
  // the score's colour is the reviewer's advice.
  assert.match(row(pr, 120), /^ \S Build a flying game {2}approve to merge\? +3\/5 PR #12 +0s$/);
  assert.match(row(plain, 120), /^ \S Build a flying game {2}approve to merge\? +3\/5 +0s$/);
  if (!process.env.NO_COLOR) {
    const red = "\x1b[38;2;243;139;168m", green = "\x1b[38;2;166;227;161m", teal = "\x1b[38;2;148;226;213m", yellow = "\x1b[38;2;249;226;175m";
    assert.ok(v.row(pr, 120).includes(`${red}3/5`)); assert.ok(v.row({ ...pr, review: { ...review, recommend: true } }, 120).includes(`${green}3/5`));
    assert.ok(v.row({ ...pr, review: { score: 3 } }, 120).includes(`${teal}3/5`)); // no advice: the state's colour
    // whatever the state, the title is plain text; under review the bar and the percent are the working colour
    for (const r of [pr, working, { ...working, state: "error", stage: "failed" }, { ...working, state: "done", seen: true }, { ...working, state: "idle" }]) assert.match(v.row(r, 120), /^ \S+ (\x1b\[1m)?[A-Z]/);
    const reviewed = v.row({ ...working, stage: "reviewing", reviewRound: 1 }, 120);
    assert.ok(reviewed.includes(`${yellow} 50%`) && reviewed.includes(`${yellow}█`) && !/\x1b\[(35|38;2;250;179;135)m/.test(reviewed));
  }
  assert.match(row(base, 120), /^ \S Build a flying game {2}approve to merge\? +0s$/); // no reviewer: only what it waits for
  assert.match(row({ ...pr, review: { ...review, stale: true } }, 120), /^ \S Build a flying game {2}approve to merge\? +PR #12 +0s$/);
  assert.match(row({ ...pr, review: { ...review, recommend: true, score: 5 } }, 120), /\? +5\/5 PR #12 +0s$/);
  // which review it is on: a small marker of its own, kept when the score has to go
  const second = { ...pr, reviewRound: 2 };
  assert.match(row(second, 120), /^ \S Build a flying game {2}approve to merge\? +r2 3\/5 PR #12 +0s$/);
  assert.match(row(second, 44), /^ \S Build a flying game +r2 3\/5 PR #12 +0s$/);
  assert.match(row(second, 40), /^ \S Build a flying game +r2 PR #12 +0s$/);
  // a failed merge still shows its score, so it still says which review gave it
  const failedMerge = { ...second, mergeFailed: true, review: { ...review, recommend: true, score: 5 }, msg: "The merge failed." };
  assert.match(row(failedMerge, 120), / r2 5\/5 #12 +0s$/);
  assert.match(row({ ...failedMerge, pr: undefined }, 120), / r2 +0s$/);
  assert.match(stripVTControlCharacters(v.pageLines({ ...failedMerge, owner: "me" }, 80).join("\n")), /blocked · permission · review 2 · /);
  // behind main and not brought up to date yet: neither the row nor the full details say it is ready
  const behind = { ...pr, owner: "me", summary: "Did the work.", syncBlocked: { why: "main could not be fetched (network is down)" }, msg: "Behind main, and not up to date yet: main could not be fetched (network is down). The board keeps trying; it cannot be approved until then." };
  assert.match(row(behind, 120), /Build a flying game {2}Behind main, and not up to date yet/); assert.doesNotMatch(row(behind, 120), /approve to merge\?/);
  const behindPage = stripVTControlCharacters(v.pageLines(behind, 80, true).join("\n"));
  assert.match(behindPage, /Behind main \(cannot be approved yet\)/); assert.match(behindPage, /main could not be fetched \(network is down\)/); assert.doesNotMatch(behindPage, /Ready to merge/);
  assert.match(stripVTControlCharacters(v.pageLines({ ...pr, owner: "me", summary: "Did the work." }, 80, true).join("\n")), /Ready to merge \(approve on board\)/);
  assert.match(row({ ...second, stage: "merging", state: "working", kind: undefined, msg: "merging" }, 120), / r2 3\/5 #12 +0s$/);
  assert.doesNotMatch(row({ ...second, state: "done", stage: "done" }, 120), /r2/);
  const under = { ...working, stage: "reviewing", reviewRound: 3, msg: "Running the tests." };
  assert.match(row(under, 120), /^ \S Other {2}Running the tests\. +r3 \S+ +50% +0s$/);
  assert.match(row(under, 30), /^ \S Other +r3 +50% +0s$/);
  assert.match(row({ ...under, stage: "reviewneeds", state: "blocked", progress: undefined, msg: "the reviewer shows a dialog" }, 120), / r3 +0s$/);
  assert.doesNotMatch(row({ ...working, reviewRound: 3 }, 120), /r3/); // back with the agent: no review is running
  assert.match(stripVTControlCharacters(v.pageLines({ ...under, owner: "me" }, 80).join("\n")), /reviewing · review 3 · /);
  assert.match(stripVTControlCharacters(v.pageLines({ ...plain, reviewRound: 2, owner: "me" }, 80).join("\n")), /blocked · review 2 · /);
  // narrower: the name stays whole, the columns go one at a time
  assert.match(row(pr, 40), /^ \S Build a flying game +3\/5 PR #12 +0s$/);
  assert.match(row(plain, 32), /^ \S Build a flying game +3\/5 +0s$/);
  assert.match(row(pr, 34), /^ \S Build a flying game +PR #12 +0s$/);
  assert.match(row(pr, 24), /^ \S Build a flying game *$/);
  // another row's long sentence or progress does not take the score away
  assert.match(row(pr, 80, [pr, working]), /^ \S Build a flying game .* 3\/5 PR #12 +0s$/);
  for (const width of [24, 30, 40, 60, 80, 120]) for (const r of [pr, plain, base]) {
    const line = row(r, width, [r, working]);
    assert.ok(line.length <= width, `fits ${width}`); assert.ok(!/Skylark|\*\*|Reviewed/.test(line)); assert.match(line, /^ \S Build a flying game/);
  }
  // what blocks a row outranks its score: a failed merge says why before it says 5/5
  const failed = { ...pr, pr: "https://github.com/a/b/pull/13", mergeFailed: true, review: { score: 5, recommend: true, text: "Fine." }, msg: "The merge failed: conflict in src/game.js" };
  assert.match(row(failed, 60), /^ \S Build a flying game {2}The merge failed: conf… +5\/5 #13 +0s$/);
  assert.match(row(failed, 54), /^ \S Build a flying game {2}The merge failed: co… +#13 +0s$/);
  assert.match(row(failed, 120), /^ \S Build a flying game {2}The merge failed: conflict in src\/game\.js +5\/5 #13 +0s$/);
  // a question without a PR is not charged for the columns a PR row beside it fills
  const quiz = { ...base, title: "Choose colours", stage: "", kind: "question", msg: "Sand or pebbles on the beach?" };
  assert.equal(row(quiz, 60, [quiz, pr]), row(quiz, 60));
  assert.match(row(quiz, 60, [quiz, pr]), /^ \S Choose colours {2}Sand or pebbles on the beach\? +0s$/);
  assert.match(row(pr, 60, [quiz, pr]), / 3\/5 PR #12 +0s$/);
  // other rows that need you still say what blocks them, after the name and without Markdown marks
  const ask = "Which colour should the plane be, and should the **islands** have `palm` trees?";
  for (const r of [{ ...base, stage: "", kind: "question", msg: ask }, { ...base, mergeFailed: true, msg: ask }, { ...base, state: "error", kind: "", stage: "failed", msg: ask }])
    assert.match(row(r, 120), /^ \S Build a flying game {2}Which colour should the plane be, and should the islands have palm trees\? +0s$/);
});
