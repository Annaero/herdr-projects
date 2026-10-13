// The one home folder: where things are kept by default, and the one-time move of an older version's folders into it (old layout in, new layout out; twice; cut off; with new data there already).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as S from "../src/store.js";
import { AGENTS } from "../src/agents.js";

const put = (file, text, at) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); if (at) fs.utimesSync(file, at / 1000, at / 1000); };
const read = (file) => fs.readFileSync(file, "utf8");
const NONE = { moved: [], line: "", stay: [] };
// Two paths change places. The real one does it in one step (tested with the real program at the end); this one is for
// the light tests, which start no program.
const swap = (a, b) => { const x = `${a}.x`; fs.renameSync(a, x); fs.renameSync(b, a); fs.renameSync(x, b); return true; };
const free = { swap, grab: () => () => {} };
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
// Every file under a folder with its text, links followed: what "nothing is lost" is checked against.
function all(dir, base = dir, out = {}) {
  for (const n of fs.readdirSync(dir)) { const f = path.join(dir, n); if (fs.statSync(f).isDirectory()) all(f, base, out); else out[path.relative(base, f)] = read(f); }
  return out;
}
// A home folder as an older version left it: data, settings and a report in three places, and the stray files a
// task in the home folder itself wrote into ~/.herdr-superwork (that name is every repo's rule folder).
function oldHome({ bin = S.BIN } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sw-home-")));
  const data = path.join(home, ".local", "state", "herdr-superwork"), settings = path.join(home, ".config", "herdr-superwork"), reports = path.join(home, ".local", "share", "herdr-superwork-reports");
  put(path.join(data, "tasks", "proj", "1", "task.json"), '{"n":1}');
  put(path.join(data, "coordinator", "default", "state.json"), '{"session":"abc"}');
  put(path.join(data, "coordinator", "default", "chat", "note.txt"), "its folder");
  put(path.join(data, "locks", "dGFzaw.lock"), "");
  put(path.join(data, "bin", "herdr-superwork"), `#!/bin/sh\nexport HERDR_SUPERWORK_DATA_DIR='${data}'\nexec node '${bin}' "$@"\n`);
  put(path.join(settings, "config.json"), '{"max":7}');
  put(path.join(reports, "109", "index.html"), "<p>report</p>");
  put(path.join(home, ".herdr-superwork", "closing-1.md"), "a home task's closing note");
  const to = path.join(home, ".herdr-superwork");
  return { home, data, settings, reports, to, env: {}, run: (o = {}) => S.moveHome({ home, env: {}, linked: false, ...free, ...o }), done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test("a new install keeps everything in ~/.herdr-superwork: data, settings and reports each in a folder of their own; the XDG variables choose nothing", () => {
  const keep = { ...process.env };
  try {
    for (const k of ["HERDR_SUPERWORK_HOME", "HERDR_SUPERWORK_DATA_DIR", "HERDR_SUPERWORK_CONFIG_DIR", "HERDR_SUPERWORK_REPORTS_DIR"]) delete process.env[k];
    Object.assign(process.env, { XDG_STATE_HOME: "/x/state", XDG_CONFIG_HOME: "/x/config", XDG_DATA_HOME: "/x/share" });
    const home = path.join(os.homedir(), ".herdr-superwork");
    assert.deepEqual([S.homeDir(), S.dataDir(), S.configDir(), S.reportsDir()], [home, path.join(home, "data"), path.join(home, "settings"), path.join(home, "reports")]);
    assert.deepEqual(S.boardEnv(), { HERDR_SUPERWORK_DATA_DIR: path.join(home, "data"), HERDR_SUPERWORK_CONFIG_DIR: path.join(home, "settings") });
    // One variable moves the whole folder; each part still has its own.
    process.env.HERDR_SUPERWORK_HOME = "/somewhere";
    assert.deepEqual([S.dataDir(), S.configDir(), S.reportsDir()], ["/somewhere/data", "/somewhere/settings", "/somewhere/reports"]);
    Object.assign(process.env, { HERDR_SUPERWORK_DATA_DIR: "/d", HERDR_SUPERWORK_CONFIG_DIR: "/c", HERDR_SUPERWORK_REPORTS_DIR: "/r" });
    assert.deepEqual([S.dataDir(), S.configDir(), S.reportsDir()], ["/d", "/c", "/r"]);
    // A new install has nothing to move, and the move makes no folder for it.
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "sw-home-"));
    try { assert.deepEqual(S.moveHome({ home: fresh, env: {}, linked: false, ...free }), NONE); assert.deepEqual(fs.readdirSync(fresh), []); } finally { fs.rmSync(fresh, { recursive: true, force: true }); }
  } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
});

test("an older version's folders are moved by the first run: nothing lost, the old paths still work, said in one line, and a second run does nothing", () => {
  const h = oldHome();
  try {
    const before = { data: all(h.data), settings: all(h.settings), reports: all(h.reports) };
    const r = h.run();
    assert.deepEqual(r.moved.map((x) => [x.what, x.how]), [["data", "moved"], ["settings", "moved"], ["reports", "moved"]]);
    assert.equal(r.line, "Moved the board's files into ~/.herdr-superwork: data (from ~/.local/state/herdr-superwork), settings (from ~/.config/herdr-superwork), reports (from ~/.local/share/herdr-superwork-reports). The old places are links to the new ones, so whatever is running carries on.");
    assert.equal(r.line.split("\n").length, 1);
    // The new layout holds everything, as real folders.
    for (const what of ["data", "settings", "reports"]) { assert.ok(fs.lstatSync(path.join(h.to, what)).isDirectory()); assert.deepEqual(all(path.join(h.to, what)), before[what]); }
    assert.deepEqual(fs.readdirSync(h.to).sort(), ["closing-1.md", "data", "moved.json", "reports", "settings"]);
    assert.equal(read(path.join(h.to, "closing-1.md")), "a home task's closing note"); // a home task's own files are left alone
    // Every old path still reaches the same files: the command agents were handed, a lock, the Coordinator's folder.
    for (const [old, what] of [[h.data, "data"], [h.settings, "settings"], [h.reports, "reports"]]) { assert.ok(isLink(old)); assert.equal(fs.realpathSync(old), path.join(h.to, what)); }
    assert.match(read(path.join(h.data, "bin", "herdr-superwork")), /^#!\/bin\/sh/);
    assert.equal(fs.statSync(path.join(h.data, "locks", "dGFzaw.lock")).ino, fs.statSync(path.join(h.to, "data", "locks", "dGFzaw.lock")).ino); // one lock file, whichever path a process takes it by
    fs.writeFileSync(path.join(h.data, "tasks", "proj", "1", "task.json"), '{"n":1,"by":"a board still on the old path"}');
    assert.match(read(path.join(h.to, "data", "tasks", "proj", "1", "task.json")), /still on the old path/);
    // The line waits until it was shown once.
    const rec = S.readJson(path.join(h.to, "moved.json"));
    assert.equal(rec.told, false); assert.equal(rec.line, r.line); assert.equal(rec.data.state, "done"); assert.equal(rec.data.from, h.data);
    // Moved by a hook or an agent's command, where nobody reads: the line is said by the first run a human sees, once.
    const said = [], tty = { isTTY: true, write: (x) => said.push(x) }, o = { home: h.home, env: {}, linked: false, ...free };
    S.homeAtStart("hook", tty, o); S.homeAtStart("list", { isTTY: false, write: (x) => said.push(x) }, o); assert.deepEqual(said, []);
    assert.equal(S.moveNote(o), r.line); // what the board shows when it opens
    S.homeAtStart("list", tty, o); S.homeAtStart("list", tty, o); assert.deepEqual(said, [`${r.line}\n`]); assert.equal(S.moveNote(o), "");
    // Again: nothing to do, nothing said, nothing changed.
    const after = all(h.to);
    assert.deepEqual(h.run(), NONE); assert.deepEqual(all(h.to), after);
    // An agent's command from before the move names the old data folder outright: still nothing to do, and it works.
    assert.deepEqual(S.moveHome({ home: h.home, linked: false, ...free, env: { HERDR_SUPERWORK_DATA_DIR: h.data } }), NONE);
  } finally { h.done(); }
});

test("the Coordinator's conversation is found again after its folder moved, for every program", () => {
  const h = oldHome();
  const keep = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CODEX_HOME: process.env.CODEX_HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
  try {
    Object.assign(process.env, { CLAUDE_CONFIG_DIR: path.join(h.home, "claude"), CODEX_HOME: path.join(h.home, "codex"), PI_CODING_AGENT_DIR: path.join(h.home, "pi") });
    // Saved by each program while the folder was in the old place: Claude Code keys its file by that folder's path.
    const was = path.join(h.data, "coordinator", "default", "chat");
    const files = {
      claude: path.join(h.home, "claude", "projects", was.replace(/[^A-Za-z0-9]/g, "-"), "abc.jsonl"),
      codex: path.join(h.home, "codex", "sessions", "2026", "rollout-2026-abc.jsonl"),
      pi: path.join(h.home, "pi", "sessions", "--old--", "2026_abc.jsonl"),
    };
    for (const f of Object.values(files)) put(f, "{}\n");
    h.run();
    const now = path.join(h.to, "data", "coordinator", "default", "chat");
    assert.equal(read(path.join(now, "note.txt")), "its folder"); assert.equal(fs.realpathSync(was), now);
    // Found by its id from the new folder, so a restart reopens the same conversation (pump.js resumes what it finds).
    for (const [kind, file] of Object.entries(files)) assert.equal(AGENTS[kind].transcript("abc", now), file, kind);
    // A Coordinator started before the move still knows its folder by the old path: a new chat it begins there
    // (/clear, /new) is saved under that path, and is still followed.
    const o = { home: h.home, env: {} }, id = "11111111-2222-3333-4444-555555555555";
    assert.equal(S.movedFrom(now, o), was); assert.equal(S.movedFrom(path.join(h.to, "data"), o), h.data); assert.equal(S.movedFrom(path.join(h.home, "elsewhere"), o), null);
    put(path.join(path.dirname(files.claude), `${id}.jsonl`), '{"type":"user"}\n');
    put(path.join(h.home, "codex", "sessions", "2026", "rollout-2026-new.jsonl"), JSON.stringify({ timestamp: new Date().toISOString(), type: "session_meta", payload: { id: "new-codex", cwd: was, source: "cli" } }) + "\n");
    put(path.join(h.home, "pi", "sessions", "--old--", "2026_new.jsonl"), JSON.stringify({ type: "session", id: "new-pi", cwd: was }) + "\n");
    assert.deepEqual(["claude", "codex", "pi"].map((k) => AGENTS[k].latestSession(now, 0, was)), [id, "new-codex", "new-pi"]);
    assert.deepEqual(["claude", "codex", "pi"].map((k) => AGENTS[k].latestSession(now, 0)), [null, null, null]);
  } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } h.done(); }
});

test("a move that was cut off is finished by the next run, wherever it stopped, and the old paths work in between", () => {
  // Cut off before, between and after the two steps in which paths change places: `n` of them were done.
  for (const n of [0, 1]) {
    const h = oldHome();
    try {
      const before = all(h.data);
      let done = 0;
      const r = h.run({ swap: (a, b) => { if (done === n) throw new Error("cut off"); done++; return swap(a, b); } });
      assert.deepEqual(r.moved, []); assert.equal(S.readJson(path.join(h.to, "moved.json")).data.state, "moving");
      // The old path reaches every file all the same, and a run meanwhile is told to stay on what has not moved.
      assert.deepEqual(all(h.data), before); assert.match(read(path.join(h.data, "bin", "herdr-superwork")), /^#!\/bin\/sh/);
      assert.deepEqual(r.stay.map((x) => x.what), n ? ["settings", "reports"] : ["data", "settings", "reports"]); // data is past the point where its new path works
      if (n) assert.deepEqual(all(path.join(h.to, "data")), before); // moved far enough that the new path works too
      const again = h.run();
      assert.deepEqual(again.moved.map((x) => [x.what, x.how]), [["data", "moved"], ["settings", "moved"], ["reports", "moved"]]);
      assert.ok(isLink(h.data)); assert.ok(fs.lstatSync(path.join(h.to, "data")).isDirectory()); assert.ok(!fs.existsSync(`${h.data}.moving`));
      assert.deepEqual(all(h.data), before); assert.deepEqual(all(path.join(h.to, "data")), before);
      assert.deepEqual(h.run(), NONE);
    } finally { h.done(); }
  }
  // Another mover that died in the middle left its mark: not waited for.
  let h = oldHome();
  try {
    put(path.join(h.to, "moving.lock"), JSON.stringify({ pid: 2 ** 22 + 12345, start: "1" }));
    assert.equal(h.run({ waitMs: 0 }).moved.length, 3); assert.ok(!fs.existsSync(path.join(h.to, "moving.lock")));
  } finally { h.done(); }
  // One that is alive past the wait: nothing is moved twice at once, and this run does not start on an empty new
  // place. It works on the old folders, which are there until the mover's last step.
  h = oldHome();
  try {
    put(path.join(h.to, "moving.lock"), JSON.stringify(S.marker()));
    const r = h.run({ waitMs: 0 });
    assert.equal(r.busy, true); assert.deepEqual(r.moved, []); assert.deepEqual(r.stay.map((x) => x.from), [h.data, h.settings, h.reports]); assert.ok(!isLink(h.data));
    const env = {}; S.homeAtStart("list", { isTTY: false }, { home: h.home, env, linked: false, waitMs: 0, ...free });
    assert.deepEqual(env, { HERDR_SUPERWORK_DATA_DIR: h.data, HERDR_SUPERWORK_CONFIG_DIR: h.settings, HERDR_SUPERWORK_REPORTS_DIR: h.reports });
    assert.ok(fs.existsSync(path.join(env.HERDR_SUPERWORK_DATA_DIR, "tasks", "proj", "1", "task.json"))); // its tasks are where it looks
    fs.rmSync(path.join(h.to, "moving.lock"));
    assert.equal(h.run().moved.length, 3);
  } finally { h.done(); }
  // No way here to change two paths in one step, or the old place is on another disk: the folder stays where it is
  // and the new place is a link to it. Still no moment without the old path, and one folder to look in.
  h = oldHome();
  try {
    const before = all(h.data);
    const r = h.run({ swap: () => false });
    assert.deepEqual(r.moved.map((x) => x.how), ["linked", "linked", "linked"]); assert.deepEqual(r.stay, []);
    assert.ok(!isLink(h.data)); assert.ok(isLink(path.join(h.to, "data"))); assert.deepEqual(all(path.join(h.to, "data")), before); assert.ok(!fs.existsSync(`${h.data}.moving`));
    assert.equal(r.line, "Moved the board's files into ~/.herdr-superwork: data stays in ~/.local/state/herdr-superwork and is linked from there, settings stays in ~/.config/herdr-superwork and is linked from there, reports stays in ~/.local/share/herdr-superwork-reports and is linked from there.");
    assert.deepEqual(h.run(), NONE);
  } finally { h.done(); }
});

test("with data in the new place already, nothing is written over: the newer file stays there and the other is set aside", () => {
  const h = oldHome();
  try {
    const t = Date.now();
    // The new place holds a newer settings file and an older task; each side has things the other lacks.
    put(path.join(h.settings, "config.json"), '{"max":7}', t - 60000);
    put(path.join(h.to, "settings", "config.json"), '{"max":9}', t);
    put(path.join(h.data, "tasks", "proj", "1", "task.json"), '{"n":1,"newer":"old place"}', t);
    put(path.join(h.to, "data", "tasks", "proj", "1", "task.json"), '{"n":1,"older":"new place"}', t - 60000);
    put(path.join(h.to, "data", "tasks", "proj", "5", "task.json"), '{"n":5}');
    const r = h.run();
    assert.deepEqual(r.moved.map((x) => [x.what, x.how]), [["data", "merged"], ["settings", "merged"], ["reports", "moved"]]);
    assert.equal(read(path.join(h.to, "settings", "config.json")), '{"max":9}'); // newer in the new place: kept
    assert.equal(read(path.join(h.to, "data", "tasks", "proj", "1", "task.json")), '{"n":1,"newer":"old place"}'); // newer in the old place: it wins
    assert.equal(read(path.join(h.to, "data", "tasks", "proj", "5", "task.json")), '{"n":5}');
    assert.equal(read(path.join(h.to, "data", "coordinator", "default", "state.json")), '{"session":"abc"}');
    // The two that lost are kept, and the line says where.
    assert.deepEqual(all(path.join(h.to, "set-aside")), { [path.join("settings", "config.json")]: '{"max":7}', [path.join("data", "tasks", "proj", "1", "task.json")]: '{"n":1,"older":"new place"}' });
    assert.match(r.line, /2 files that were in both places are kept in ~\/\.herdr-superwork\/set-aside\.$/);
    assert.ok(isLink(h.data) && isLink(h.settings));
    assert.deepEqual(h.run(), NONE);
  } finally { h.done(); }
});

test("the lock file in the place in use is never replaced or removed, and the new place's copy goes only while nobody holds it", () => {
  const ino = (f) => fs.statSync(f).ino;
  const both = () => { const h = oldHome(); const t = Date.now(); put(path.join(h.data, "locks", "a2VlcGVy.lock"), "", t - 60000); put(path.join(h.to, "data", "locks", "a2VlcGVy.lock"), "", t); return { h, old: path.join(h.data, "locks", "a2VlcGVy.lock"), now: path.join(h.to, "data", "locks", "a2VlcGVy.lock") }; };
  // Both places have the lock file, the new place's the newer one. The old place's is the lock: whoever holds it, or
  // has it open and is about to take it, still has the one real lock afterwards, under both paths.
  let x = both();
  try {
    const mine = ino(x.old), grabbed = [];
    assert.deepEqual(x.h.run({ grab: (f) => { grabbed.push(f); return () => grabbed.push("let go"); } }).moved.map((m) => m.how), ["merged", "moved", "moved"]);
    assert.equal(ino(x.now), mine); assert.equal(ino(x.old), mine); assert.ok(!fs.existsSync(path.join(x.h.to, "set-aside")));
    assert.deepEqual(grabbed, [x.now, "let go"]); // the copy that went was taken while it was removed
  } finally { x.h.done(); }
  // The new place's copy is held by a running process: nothing of the data is moved now, the run stays on the old
  // place, both files are as they were, and a later run moves it.
  x = both();
  try {
    const mine = ino(x.old), other = ino(x.now);
    const r = x.h.run({ grab: () => null });
    assert.deepEqual(r.moved.map((m) => m.what), ["settings", "reports"]); assert.deepEqual(r.stay.map((m) => m.what), ["data"]);
    assert.equal(ino(x.old), mine); assert.equal(ino(x.now), other); assert.ok(!isLink(x.h.data));
    assert.deepEqual(x.h.run().moved.map((m) => [m.what, m.how]), [["data", "merged"]]); assert.ok(isLink(x.h.data)); assert.equal(ino(x.now), mine);
  } finally { x.h.done(); }
});

test("[real programs] a lock file that was replaced between opening it and locking it is not taken for the lock: the one at the path is", async () => {
  const { spawn, spawnSync } = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-lock-"));
  const keep = { data: process.env.HERDR_SUPERWORK_DATA_DIR, locks: globalThis.__swLocks };
  process.env.HERDR_SUPERWORK_DATA_DIR = dir; globalThis.__swLocks = null;
  try {
    const file = path.join(dir, "locks", `${Buffer.from("x").toString("base64url")}.lock`);
    put(file, "");
    const taken = (f) => spawnSync("flock", ["--exclusive", "--nonblock", f, "true"]).status === 1;
    // Someone holds the file; while this process waits for it (the file open, not yet locked), another file takes its
    // place at the path, and then the holder lets go of the old one.
    const holder = spawn("flock", ["--exclusive", file, "sh", "-c", `sleep 0.25; : > "${file}.new"; mv "${file}.new" "${file}"; sleep 0.1`], { stdio: "ignore" });
    try {
      for (let i = 0; i < 200 && !taken(file); i++) await new Promise((r) => setTimeout(r, 5));
      const was = fs.statSync(file).ino;
      const seen = S.withLock("x", () => ({ ino: fs.statSync(file).ino, held: taken(file) }), { waitMs: 5000 });
      assert.notEqual(seen.ino, was); assert.equal(seen.held, true, "what it holds is the file at the path, so nobody else can take that");
      assert.equal(taken(file), false); // and let go again
    } finally { holder.kill(); }
  } finally { process.env.HERDR_SUPERWORK_DATA_DIR = keep.data; globalThis.__swLocks = keep.locks; fs.rmSync(dir, { recursive: true, force: true }); }
});

test("what is not the board's to move stays: a folder you named yourself, another copy's board, old places named by XDG are found", () => {
  // A board kept somewhere of its own (the tests' own, too): its folders are where you put them.
  let h = oldHome();
  try {
    const env = { HERDR_SUPERWORK_DATA_DIR: path.join(h.home, "mine"), HERDR_SUPERWORK_CONFIG_DIR: path.join(h.home, "mine-too") };
    assert.deepEqual(S.moveHome({ home: h.home, linked: false, ...free, env }).moved.map((x) => x.what), ["reports"]); assert.ok(!isLink(h.data) && !isLink(h.settings));
  } finally { h.done(); }
  // The old data folder's command names another copy of the code that is still there (the installed one, seen from a
  // worktree): this copy moves nothing, and is told so that it works on that board where it is.
  h = oldHome({ bin: path.join(os.tmpdir(), "..", process.execPath) });
  try {
    const r = h.run();
    assert.equal(r.other, true); assert.deepEqual(r.moved, []); assert.ok(!isLink(h.data)); assert.deepEqual(fs.readdirSync(h.to), ["closing-1.md"]);
    const env = {}; S.homeAtStart("list", { isTTY: true, write() {} }, { home: h.home, env, linked: false, bin: S.BIN });
    assert.deepEqual(env, { HERDR_SUPERWORK_DATA_DIR: h.data, HERDR_SUPERWORK_CONFIG_DIR: h.settings, HERDR_SUPERWORK_REPORTS_DIR: h.reports });
  } finally { h.done(); }
  // A copy that is a git worktree (a task's agent at work on this code, its reviewer trying it) never moves the board's files.
  h = oldHome();
  try { const r = h.run({ linked: true }); assert.equal(r.other, true); assert.ok(!isLink(h.data)); assert.equal(h.run({ linked: false }).moved.length, 3); } finally { h.done(); }
  // A copy that is gone (the plugin was moved) holds nothing back.
  h = oldHome({ bin: "/no/such/copy/bin/herdr-superwork.js" });
  try { assert.equal(h.run().moved.length, 3); } finally { h.done(); }
  // The old version followed XDG_*: that is where its folders are looked for.
  h = oldHome();
  try {
    const x = path.join(h.home, "xdg");
    put(path.join(x, "state", "herdr-superwork", "tasks", "a", "1", "task.json"), "{}"); put(path.join(x, "config", "herdr-superwork", "config.json"), '{"max":3}');
    const r = S.moveHome({ home: h.home, linked: false, ...free, env: { XDG_STATE_HOME: path.join(x, "state"), XDG_CONFIG_HOME: path.join(x, "config") } });
    assert.deepEqual(r.moved.map((m) => m.from), [path.join(x, "state", "herdr-superwork"), path.join(x, "config", "herdr-superwork"), h.reports]);
    assert.equal(read(path.join(h.to, "settings", "config.json")), '{"max":3}'); assert.ok(isLink(path.join(x, "state", "herdr-superwork")));
    assert.ok(!isLink(h.data)); // the folders in the usual old places were not the ones in use: left alone
  } finally { h.done(); }
});

test("[real programs] the old command runs at every moment of a real move, and a lock held through it stays held", async () => {
  const { spawn, spawnSync } = await import("node:child_process");
  const h = oldHome();
  try {
    put(path.join(h.data, "bin", "herdr-superwork"), "#!/bin/sh\necho ran\n"); fs.chmodSync(path.join(h.data, "bin", "herdr-superwork"), 0o755);
    const lockFile = path.join(h.data, "locks", "dGFzaw.lock");
    const holder = spawn("flock", ["--exclusive", lockFile, "sleep", "30"], { stdio: "ignore" });
    try {
      const taken = (f) => spawnSync("flock", ["--exclusive", "--nonblock", f, "true"]).status === 1;
      for (let i = 0; i < 200 && !taken(lockFile); i++) await new Promise((r) => setTimeout(r, 10));
      // At each of the two steps in which paths change places, before and after it, the old command is started.
      const ran = [];
      const old = () => ran.push(spawnSync(path.join(h.data, "bin", "herdr-superwork"), { encoding: "utf8" }).stdout);
      const env = { HERDR_SUPERWORK_CONFIG_DIR: path.join(h.home, "own"), HERDR_SUPERWORK_REPORTS_DIR: path.join(h.home, "own") }; // the data folder alone: fewer programs
      const r = S.moveHome({ home: h.home, env, linked: false, swap: (a, b) => { old(); const ok = S.swapNow(a, b); old(); return ok; } });
      assert.deepEqual(r.moved.map((x) => [x.what, x.how]), [["data", "moved"]]);
      assert.equal(ran.length, 4); assert.ok(ran.every((x) => x === "ran\n"), JSON.stringify(ran));
      assert.ok(isLink(h.data)); assert.ok(fs.lstatSync(path.join(h.to, "data")).isDirectory());
      assert.ok(taken(lockFile)); assert.ok(taken(path.join(h.to, "data", "locks", "dGFzaw.lock"))); // still the holder's, by either path
    } finally { holder.kill(); }
  } finally { h.done(); }
});
