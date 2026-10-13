// Other machines that do not answer: why not, for each kind of failure, on both boards and in `herdr-superwork machines`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world } from "./helpers.js";
import { open } from "./board-helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as R from "../src/remote.js";
import { check, say, here } from "../src/remote/check.js";
import { WebView } from "../src/webui/web-view.js";
import { CALLS } from "../src/webui/worker.js";

const M = { label: "vm-a", target: "me@vm-a" };
const LIST = JSON.stringify({ host: "vm-a", version: "0.2.0", tasks: [] });
// How each failure ends, in the words the real programs use (OpenSSH, bash, dash, zsh, env, node).
const ENDS = {
  unknownName: [{ code: 255, stderr: "ssh: Could not resolve hostname vm-a: Name or service not known\n" }, "connect", /cannot connect \(its name is not known\)/],
  timedOut: [{ code: 255, stderr: "ssh: connect to host vm-a port 22: Connection timed out\n" }, "connect", /connecting timed out/],
  refused: [{ code: 255, stderr: "ssh: connect to host vm-a port 22: Connection refused\n" }, "connect", /it refused the connection/],
  hostKey: [{ code: 255, stderr: "@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n@@@@@@@@@@@\nHost key for vm-a has changed and you have requested strict checking.\nHost key verification failed.\n" }, "connect", /its host key changed/],
  noKey: [{ code: 255, stderr: "me@vm-a: Permission denied (publickey).\n" }, "login", /does not let the board in/],
  password: [{ code: 255, stderr: "me@vm-a: Permission denied (publickey,password).\n" }, "login", /does not let the board in/],
  bash: [{ code: 127, stderr: "bash: line 1: herdr-superwork: command not found\n" }, "path", /herdr-superwork is not found there/],
  dash: [{ code: 127, stderr: "sh: 1: herdr-superwork: not found\n" }, "path", /herdr-superwork is not found there/],
  zsh: [{ code: 127, stderr: "zsh:1: command not found: herdr-superwork\n" }, "path", /herdr-superwork is not found there/],
  noNode: [{ code: 127, stderr: "env: 'node': No such file or directory\n" }, "path", /node is not found there/],
  noNodeMac: [{ code: 127, stderr: "env: node: No such file or directory\n" }, "path", /node is not found there/],
  oldNode: [{ code: 1, stderr: "SyntaxError: Unexpected token 'with'\n    at compileSourceTextModule\n\nNode.js v18.19.1\n" }, "path", /its node is too old \(18\)/],
  banner: [{ code: 0, stdout: "Welcome to vm-a\nLast login: today\n" }, "answer", /something else than the board's answer/],
  nothing: [{ code: 0, stdout: "" }, "answer", /answered nothing/],
  error: [{ code: 1, stderr: "Error: cannot read the tasks\n" }, "answer", /answered with an error/],
  slow: [{ timedOut: true, ms: 20000 }, "slow", /took too long/],
  noSsh: [{ error: "spawn ssh ENOENT" }, "connect", /ssh could not be started/],
};

test("why a machine did not answer: cannot connect, not allowed in, the program not found, another answer, too slow, each with what to do", () => {
  for (const [name, [end, kind, line]] of Object.entries(ENDS)) {
    const why = R.whyNot(end, M);
    assert.equal(why.kind, kind, name); assert.match(why.line, line, name);
    assert.match(why.detail.at(-1), /^Test it from this machine: ssh me@vm-a 'exec \$SHELL -lc "herdr-superwork remote list"' \| tail -c 200$/, name);
    assert.ok(why.line.length < 60, name);
  }
  // what to do is said for the one seen for real: on the PATH of a login shell, by the profile file or a link
  const path127 = R.whyNot(ENDS.bash[0], M).detail.join("\n");
  assert.match(path127, /must be on the PATH that a login shell gets/); assert.match(path127, /~\/\.bashrc does not count/); assert.match(path127, /~\/\.profile/); assert.match(path127, /ln -s "\$\(command -v herdr-superwork\)" ~\/\.local\/bin\//);
  assert.match(R.whyNot(ENDS.noNode[0], M).detail.join("\n"), /ln -s "\$\(command -v node\)"/);
  assert.match(R.whyNot(ENDS.noKey[0], M).detail.join("\n"), /batch mode[^]*ssh-copy-id me@vm-a/);
  assert.match(R.whyNot(ENDS.hostKey[0], { label: "vm-a", target: "ssh://me@vm-a:2200" }).detail.join("\n"), /ssh-keygen -R '\[vm-a\]:2200' -f .*known_hosts/);
  // the name is the one known_hosts has: with the port when it is not 22
  assert.deepEqual(["me@vm-a", "ssh://me@vm-a:22", "ssh://me@vm-a:2200", "vm-a", "ssh://[fd7a::1]:2200", "ssh://me@[fd7a::1]"].map(R.knownHost), ["vm-a", "vm-a", "[vm-a]:2200", "vm-a", "[fd7a::1]:2200", "fd7a::1"]);
  // what came back is kept, without the row of @ signs
  assert.equal(R.whyNot(ENDS.bash[0], M).said, "bash: line 1: herdr-superwork: command not found"); assert.doesNotMatch(R.whyNot(ENDS.hostKey[0], M).said, /@@@/);
  // an answer of the board's own that is no task list: an older plugin
  assert.match(R.notList({ ok: false, msg: "Unknown request list" }, M).detail[0], /vm-a answered: Unknown request list/);
  assert.equal(R.unanswered("vm-a", R.whyNot(ENDS.refused[0], M)), "vm-a did not answer: cannot connect (it refused the connection)"); assert.equal(R.unanswered("vm-a"), "vm-a did not answer");
});

test("the answer is read whatever a shell's start-up files print around it: a banner before it, one after it, other lines that look like nothing", () => {
  assert.deepEqual(R.readAnswer(LIST + "\n"), JSON.parse(LIST));
  assert.deepEqual(R.readAnswer(`Welcome to vm-a\r\n\r\n${LIST}\n`), JSON.parse(LIST));
  assert.deepEqual(R.readAnswer(`Welcome\n${LIST}\nlogout\nBye {for now}\n\n`), JSON.parse(LIST));
  assert.deepEqual(R.readAnswer(`{"motd":"hello"}\n${LIST}\n[1, 2]\n"text"\n42\n`), JSON.parse(LIST)); // the last line that is an object
  // a banner that is JSON itself, after the answer, and a long goodbye: the board's own line is still the answer
  assert.deepEqual(R.readAnswer(`${LIST}\n{"motd":"Goodbye"}\n`), JSON.parse(LIST));
  assert.deepEqual(R.readAnswer(`${LIST}\n${"Goodbye\n".repeat(500)}`), JSON.parse(LIST));
  assert.deepEqual(R.readAnswer(`{"ok":true,"msg":""}\n{"motd":"Goodbye"}\n`), { ok: true, msg: "" });
  assert.deepEqual(R.readAnswer(`{"motd":"hello"}\nbye\n`), { motd: "hello" }); // none of the board's: said as "not its tasks"
  for (const none of ["", "Welcome\n", "[1,2]\n", "{not json}\n", "null\n"]) assert.equal(R.readAnswer(none), null, none);
});

test("[real programs] asking over the SSH stand-in: the exit code and stderr are kept, noise around the answer is passed over, and a machine that hangs is given up on", async () => {
  const w = await world();
  const had = process.env.HERDR_SUPERWORK_SSH;
  try {
    // the stand-in is "ssh": it gets the target and the line to run, and ends as that machine would
    const fake = path.join(w.dir || w.root, "..", `fake-ssh-${process.pid}`);
    fs.writeFileSync(fake, `#!/bin/sh
case "$1" in
  *good) echo "Welcome"; echo "warning: something on stderr" >&2; echo '${LIST}'; echo "logout";;
  *nopath) echo "Welcome"; echo "bash: line 1: herdr-superwork: command not found" >&2; exit 127;;
  *nonode) echo "env: 'node': No such file or directory" >&2; exit 127;;
  *down) echo "ssh: connect to host vm port 22: Connection refused" >&2; exit 255;;
  *nokey) echo "me@vm: Permission denied (publickey)." >&2; exit 255;;
  *banner) echo "Welcome to the machine";;
  *hangs) exec sleep 30;;
esac
`, { mode: 0o755 });
    process.env.HERDR_SUPERWORK_SSH = fake;
    const ask = (name, ms) => new Promise((done) => R.ask({ label: name, target: `me@${name}` }, "list", null, (j, why) => done({ j, why }), ms));
    const got = Object.fromEntries(await Promise.all(["good", "nopath", "nonode", "down", "nokey", "banner"].map(async (n) => [n, await ask(n)])));
    assert.deepEqual(got.good.j, JSON.parse(LIST)); assert.equal(got.good.why, undefined);
    assert.deepEqual(Object.entries(got).filter(([, x]) => !x.j).map(([n, x]) => [n, x.why.kind, x.why.code]), [["nopath", "path", 127], ["nonode", "path", 127], ["down", "connect", 255], ["nokey", "login", 255], ["banner", "answer", 0]]);
    assert.equal(got.nopath.why.line, "herdr-superwork is not found there"); assert.equal(got.nopath.why.said, "bash: line 1: herdr-superwork: command not found");
    assert.equal(got.banner.why.said, "Welcome to the machine");
    const slow = await ask("hangs", 40); assert.equal(slow.j, null); assert.equal(slow.why.kind, "slow");
    fs.rmSync(fake, { force: true });
  } finally { if (had === undefined) delete process.env.HERDR_SUPERWORK_SSH; else process.env.HERDR_SUPERWORK_SSH = had; w.cleanup(); }
});

// A board whose other machines end as the test says: { "vm-a": how the call ended, or its tasks }.
const theirs = (n) => ({ id: `far/${n}`, title: `Theirs ${n}`, stage: "todo", state: "idle", agent: "", app: "", msg: "", note: "", at: Date.now(), created: Date.now(), snap: { folder: "~/far" } });
const stub = (v, ends, asked = []) => { v.ssh = (m, what, arg, cb) => { asked.push(m.label); const e = ends[m.label] || []; if (what !== "list" && Array.isArray(e)) return cb({ ok: true, msg: "" }); Array.isArray(e) ? cb({ host: m.label, version: "0.2.0", tasks: e }) : e.msg ? cb(e) : cb(null, R.whyNot(e, m)); }; return asked; };

test("the board never shows a machine that did not answer as an empty one: it says so where its tasks would be, with why and what to do on that machine's own board", async () => {
  const w = await world({ settings: { "board.machines": "vm-a, vm-b, vm-c" } });
  try {
    A.add(w.root, "Mine");
    const s = open(w);
    stub(s.v, { "vm-a": ENDS.bash[0], "vm-b": [theirs(1)], "vm-c": { ok: false, msg: "Unknown request list" } });
    s.press("alt+m"); // every machine: the others' tasks show, and each one that could not be read has its line
    let text = s.text();
    assert.equal(s.v.scope, "*"); assert.match(text, /Mine/); assert.match(text, /Theirs 1/);
    assert.match(text.replace(/ *│.*\n */g, " "), /vm-a: its tasks cannot be read: herdr-superwork is not found there\. +More: \S.*?\./); assert.match(text, /vm-c: its tasks cannot be read: it answered, but not with its tasks\./);
    assert.doesNotMatch(text, /must be on the PATH/);
    // that machine's own board: no "nothing here yet", the reason whole
    s.press("alt+m"); assert.equal(s.v.scope, "vm-a"); text = s.text().replace(/ *│.*\n */g, " ");
    assert.doesNotMatch(text, /Nothing here yet/); assert.match(text, /vm-a: its tasks cannot be read: herdr-superwork is not found there\./);
    assert.match(text, /must be on the PATH that a login shell gets/); assert.match(text, /ln -s "\$\(command -v herdr-superwork\)"/); assert.match(text, /What came back:\s+bash: line 1: herdr-superwork: command not found/);
    // a small screen: what does not fit is reached with the arrows, and a line says that there is more
    const small = s; Object.assign(s.v.tui.terminal, { rows: 24 }); s.v.side = false;
    const seen = []; let last = "";
    for (let n = 0; n < 20; n++) { const now = small.text(60); if (now === last) break; seen.push(last = now); small.press("down"); }
    assert.ok(seen.length > 1); assert.match(seen[0], /↓ more below \(.+\)/); assert.doesNotMatch(seen[0], /↑ more above/); assert.match(seen.at(-1), /↑ more above \(.+\)/); assert.doesNotMatch(seen.at(-1), /↓ more below/);
    const read = seen.join("\n").replace(/\s+/g, " ");
    for (const part of [/or link the program into a folder that is on it already:/, /ln -s "\$\(command -v herdr-superwork\)" ~\/\.local\/bin\//, /Test it from this machine: ssh \S+@vm-a 'exec \$SHELL -lc "herdr-superwork remote list"' \| tail -c 200/]) assert.match(read, part);
    // words on their way to that machine have rows of their own: the arrows still read all of it, then reach the row
    for (let n = 0; n < 20; n++) small.press("up");
    const job = S.newDispatch("@vm-a fix the build", { remote: "vm-a" }); S.setDispatch(job.id, { state: "error", msg: "vm-a did not answer" }); s.v.load();
    const withJob = []; last = "";
    for (let n = 0; n < 20; n++) { const now = small.text(60); if (now === last) break; withJob.push(last = now); small.press("down"); }
    assert.ok(withJob.length > 2); assert.match(withJob.join("\n").replace(/\s+/g, " "), /ln -s "\$\(command -v herdr-superwork\)" ~\/\.local\/bin\/[^]*Test it from this machine: ssh/);
    assert.equal(s.v.sel, job.id); small.press("up"); assert.ok(s.v.unreadTop < s.v.unreadMax);
    S.clearDispatch(job.id); s.v.load();
    for (let n = 0; n < 20; n++) small.press("up"); assert.match(small.text(60), /vm-a: its tasks cannot be read/); assert.doesNotMatch(small.text(60), /↑ more above/); Object.assign(s.v.tui.terminal, { rows: 34 }); s.v.side = true;
    assert.match(s.text(60), /vm-a: its tasks cannot be read/); for (const l of s.screen(60)) assert.ok(l.length <= 60, l);
    // nothing of it is a message, however often the machine is asked again
    const msg = s.v.msg; s.v.pollRemotes(true); s.v.pollRemotes(true); assert.equal(s.v.msg, msg); assert.doesNotMatch(String(msg || ""), /cannot be read|not found/);
    // a machine that answers with no tasks is an empty one, and one that answers again loses its line
    s.press("alt+m"); assert.equal(s.v.scope, "vm-b"); s.press("alt+m"); assert.equal(s.v.scope, "vm-c");
    stub(s.v, { "vm-a": [], "vm-b": [], "vm-c": [] }); s.v.pollRemotes(true);
    assert.match(s.text(), /Nothing here yet/); assert.doesNotMatch(s.text(), /cannot be read/);
    // before a machine's first answer it is being asked, not empty and not failed
    s.v.remotes["vm-c"].ok = false; s.v.remotes["vm-c"].why = null; s.v.load();
    assert.match(s.text(), /vm-c: asking for its tasks…/); assert.doesNotMatch(s.text(), /Nothing here yet/);
    // an action on a task of a machine that stopped answering says why, once
    s.press("alt+m", "alt+m"); stub(s.v, { "vm-a": [], "vm-b": [theirs(1)], "vm-c": [] }); s.v.pollRemotes(true);
    const far = s.v.items.find((r) => r.host === "vm-b"); stub(s.v, { "vm-b": ENDS.refused[0] }); s.v.act(far, "pin");
    assert.equal(s.v.msg, "vm-b did not answer: cannot connect (it refused the connection)");
  } finally { w.cleanup(); }
});

test("the web board says the same: an unread machine is a line with its reason behind it, beside the other machines' tasks and instead of the empty board", async () => {
  const w = await world({ settings: { "board.machines": "vm-a, vm-b" } });
  try {
    const v = new WebView({ cwd: w.root });
    stub(v, { "vm-a": ENDS.noKey[0], "vm-b": [theirs(2)] });
    let s = CALLS.press.run(v, { id: "scope", role: "watch" });
    assert.equal(s.list.head.machines, "vm-a (no answer), vm-b"); assert.deepEqual(s.list.groups.flatMap((g) => g.rows).map((r) => r.title), ["Theirs 2"]);
    assert.deepEqual(s.list.unread.map((u) => [u.machine, u.line]), [["vm-a", "vm-a: its tasks cannot be read: it does not let the board in."]]);
    assert.match(s.list.unread[0].detail.join("\n"), /^What came back:\n {2}me@vm-a: Permission denied[^]*batch mode[^]*ssh-copy-id [^ ]*vm-a/);
    s = CALLS.press.run(v, { id: "scope", role: "watch" }); assert.equal(s.flags.scope, "vm-a");
    assert.equal(s.list.empty, ""); assert.equal(s.list.unread.length, 1); assert.deepEqual(s.list.groups, []);
    assert.doesNotMatch(String(s.msg?.text || ""), /cannot be read|let the board in/);
    // the page draws it: the line, and the rest behind "Why, and what to do"
    class El { constructor(tag) { this.tag = tag; this.nodeType = 1; this.kids = []; this.className = ""; } append(...xs) { this.kids.push(...xs); } addEventListener() {} setAttribute() {} get textContent() { return this.kids.map((k) => (typeof k === "string" ? k : k.textContent)).join(""); } find(cls) { for (const k of this.kids) { if (typeof k === "string") continue; if (k.className.split(" ").includes(cls) || k.tag === cls) return k; const d = k.find(cls); if (d) return d; } return null; } }
    const had = globalThis.document; globalThis.document = { createElement: (tag) => new El(tag) };
    try {
      const { listEl } = await import("../src/webui/page/list.js");
      const el = listEl(s.list, {});
      assert.equal(el.find("sw-unread-line").textContent, "vm-a: its tasks cannot be read: it does not let the board in."); assert.equal(el.find("summary").textContent, "Why, and what to do");
      assert.match(el.find("sw-unread-detail").textContent, /ssh-copy-id/); assert.equal(el.find("sw-empty"), null);
      assert.equal(listEl({ groups: [], jobs: [], unread: [], empty: "Nothing here yet. Type what needs doing." }, {}).textContent, "Nothing here yet. Type what needs doing.");
    } finally { globalThis.document = had; }
    v.dispose();
  } finally { w.cleanup(); }
});

test("herdr-superwork machines: this machine as a login shell with a bare environment finds it, then each machine with its version and tasks, or why it does not answer", async () => {
  const w = await world({ settings: { "board.machines": "vm-a, vm-b" } });
  try {
    const ran = [];
    const run = async (line, env) => { ran.push([line, Object.keys(env).sort().join(" ")]); return { code: 0, stdout: `banner\n${JSON.stringify({ ok: true, host: "here", version: S.VERSION })}\n`, stderr: "" }; };
    const ask = (m, what, arg, cb) => (m.label === "vm-a" ? cb({ host: "vm-a", version: "0.2.0", tasks: [theirs(1), { ...theirs(2), archivedAt: 1 }] }) : cb(null, R.whyNot(ENDS.noNode[0], m)));
    const r = await check({ ask, run });
    assert.deepEqual(ran, [["herdr-superwork remote hello", "HOME LOGNAME PATH SHELL USER"]]); // nothing of the terminal it was typed in
    assert.deepEqual([r.here.ok, r.here.version], [true, S.VERSION]);
    assert.deepEqual(r.machines.map((m) => [m.label, m.ok, m.version || m.why.kind, m.tasks]), [["vm-a", true, "0.2.0", 1], ["vm-b", false, "path", undefined]]);
    const text = say(r);
    assert.match(text, new RegExp(`this machine: a login shell \\(.+\\) finds herdr-superwork ${S.VERSION.replace(/\./g, "\\.")}\\n`));
    assert.match(text, /vm-a +answers · herdr-superwork 0\.2\.0 · 1 task {2}\(.*@vm-a\)\n/); assert.match(text, /vm-b +does not answer: node is not found there {2}\(.*@vm-b\)\n {4}A login shell on vm-b finds `herdr-superwork` but not `node`/);
    assert.match(text, / {4}What came back:\n {6}env: 'node': No such file or directory/);
    // this machine itself, when a login shell does not find the program: said with the fix, by the same reading
    const lost = await here({ run: async () => ({ code: 127, stdout: "", stderr: "bash: line 1: herdr-superwork: command not found\n" }) });
    assert.equal(lost.ok, false); assert.equal(lost.why.kind, "path"); assert.match(lost.why.detail.join("\n"), /must be on the PATH that a login shell gets[^]*Test it from another machine: ssh /);
    assert.match(say({ here: lost, machines: [], off: false }), /this machine: other machines cannot ask it: herdr-superwork is not found there\n[^]*No other machines\. Add one with/);
    // an older one that is found is found
    assert.equal((await here({ run: async () => ({ code: 0, stdout: '{"ok":false,"msg":"Unknown request hello"}\n', stderr: "" }) })).ok, true);
    // the door's own answer to the check
    let out = ""; const write = process.stdout.write; process.stdout.write = (x, ...more) => (typeof x === "string" ? ((out += x), true) : write.call(process.stdout, x, ...more));
    try { await R.remoteMain(["hello"]); } finally { process.stdout.write = write; }
    assert.deepEqual(Object.keys(JSON.parse(out)), ["ok", "host", "version"]);
  } finally { w.cleanup(); }
});
