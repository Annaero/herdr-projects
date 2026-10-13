// The command line.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import { execFileSync } from "node:child_process";
import { main, parse, HELP } from "../src/cli.js";
import { unknownFlags } from "../src/cli/flags.js";

test("[real programs] the command: add, list, report, set, unset, show, and the hook entry does nothing when there are no tasks (one real launch, the rest in this process)", async () => {
  const w = await world();
  try {
    // The same command in this process, without starting the program for every line: what it wrote, as text.
    const run = async (...args) => { let out = ""; const write = process.stdout.write; process.stdout.write = (x, ...r) => (typeof x === "string" ? ((out += x), true) : write.call(process.stdout, x, ...r)); /* the test runner writes its own records there too */ try { await main(args); } finally { process.stdout.write = write; } return out; };
    assert.equal(await run("hook"), "");
    assert.ok(!fs.existsSync(path.join(S.dataDir(), "tasks")));
    // One real launch, as a smoke test of the program itself: its entry, its exit, where it takes the repo from.
    const added = execFileSync(process.execPath, [S.BIN, "add", "From", "the", "shell", "--desc", "d", "--json"], { encoding: "utf8", cwd: w.root });
    const out = [added, await run("report", "1", "--state", "working", "--msg", "on it"), await run("list", "--json"), await run("set", "board.agents", "2"), await run("--skill")];
    assert.match(out[4], /^---\nname: herdr-superwork\n/);
    assert.equal(JSON.parse(out[0]).id, "proj/1");
    const listed = JSON.parse(out[2]); assert.deepEqual([listed[0].state, listed[0].app, listed[0].msg], ["working", S.me(), "on it"]);
    assert.equal(out[3], "board.agents: 2  (you)\n");
    assert.equal(S.setting("board.agents"), 2);
    // show: yours with the changed ones marked; one task's with the place each value came from; unset puts it back
    assert.equal(await run("set", "review.when", "never", "--task", "1"), "review.when for proj/1: never  (this task)\n");
    assert.equal(S.setting("review.when", S.get("proj/1")), "never");
    assert.match(await run("show"), /^Your settings \(\* = changed by you\)\n[\s\S]*\n {2}merge\.by +you +built in\n[\s\S]*\n\* board\.agents +2 +you\n/);
    assert.match(await run("show", "1"), /^proj\/1: every setting, and the place it came from[\s\S]*\n\* review\.when +never +this task\n[\s\S]*\n {2}board\.agents +2 +you\n/);
    assert.deepEqual(JSON.parse(await run("show", "1", "--json")).settings.find((r) => r.name === "review.when"), { name: "review.when", kind: "work", value: "never", from: "this task", place: "task", own: true, note: "" });
    await run("set", "merge.by", "itself", "--repo", "proj"); assert.match(await run("show", "1"), /\n {2}merge\.by +itself +your entry for proj\n/); assert.match(await run("show", "--repo", "proj"), /\n\* merge\.by +itself +your entry for proj\n/);
    assert.equal(await run("unset", "review.when", "--task", "1"), "review.when for proj/1: repos  (built in)\n"); assert.equal(await run("unset", "board.agents"), "board.agents: 4  (built in)\n");
    // refused, with the nearest right one; a board setting is yours only; the old command is gone
    const said = async (...args) => { try { await run(...args); return ""; } catch (e) { return e.message; } };
    assert.match(await said("set", "merge.pr", "maybe"), /merge\.pr is a switch: true or false/); assert.match(await said("set", "review.round", "2"), /Unknown setting "review\.round"\. Did you mean review\.rounds\?/);
    assert.match(await said("set", "board.agents", "2", "--task", "1"), /board\.agents is a board setting: it is yours only and cannot be set on a task/);
    assert.match(await said("delegate", "1", "--merge.by", "sometimes", "--reviewer.agent", "claude"), /merge\.by must be you, itself/); assert.deepEqual(S.get("proj/1").settings, {});
    assert.match(await said("config", "max", "2"), /Unknown command "config"/);
    assert.match(out.at(-1), /report <your id> --state blocked/);
    await assert.rejects(run("frobnicate"), /Unknown command/);
  } finally { w.cleanup(); }
});

test("a flag a command does not know is refused, with the nearest right one named, and nothing is done", async () => {
  const w = await world();
  try {
    const cwd = process.cwd(); process.chdir(w.root);
    const run = async (...args) => { let out = ""; const write = process.stdout.write; process.stdout.write = (x, ...r) => (typeof x === "string" ? ((out += x), true) : write.call(process.stdout, x, ...r)); try { await main(args); } finally { process.stdout.write = write; } return out; };
    try {
      await assert.rejects(run("list", "--archvied"), /^Error: list does not know --archvied\. Did you mean --archived\? It takes: --archived, --all, --query, --json, --help\. Nothing was done\.$/);
      await assert.rejects(run("list", "--no-archvied"), /list does not know --no-archvied\. Did you mean --archived\?/); // as it was typed
      await assert.rejects(run("add", "A task", "--reviewer", "claude"), /add does not know --reviewer\. Did you mean --reviewer\.agent\? It takes: .*any work setting by its name/);
      await assert.rejects(run("add", "A task", "--delgate"), /Did you mean --delegate\?/);
      assert.equal(S.list().length, 0, "nothing was added");
      await assert.rejects(run("add", "A task", "--review.wen", "never"), /Unknown setting "review\.wen"\. Did you mean review\.when\?/); assert.equal(S.list().length, 0);
      await assert.rejects(run("set", "board.agents", "2", "--tsak", "1"), /set does not know --tsak\. Did you mean --task\?/);
      await assert.rejects(run("automations", "add", "n", "--prompt", "p", "--schedule", "daily 09:00", "--evry-repo"), /Did you mean --every-repo\?/);
      await assert.rejects(run("report", "--title", "x", "--query=y"), /report does not know --query\./);
      await assert.rejects(run("--archived"), /herdr-superwork does not know --archived\. It takes: --skill, --json, --help/);
      await assert.rejects(run("nonsense", "--x"), /Unknown command "nonsense"/); // the command is what is wrong there
      // no command lets a flag through unread: help, a subcommand that takes none, the entries herdr and a hook run
      await assert.rejects(run("help", "--bogus"), /help does not know --bogus\. It takes: --json, --help/);
      // a name an object has of its own accord is a flag like any other, and refused like any other
      for (const odd of ["--__proto__", "--no-__proto__", "--constructor", "--toString", "--hasOwnProperty=1", "--__proto__=x"]) for (const cmd of ["help", "list"]) await assert.rejects(run(cmd, odd), new RegExp(`${cmd} does not know ${odd.split("=")[0]}\\b`), `${cmd} ${odd}`);
      assert.deepEqual(Object.keys(parse(["--__proto__", "--no-constructor"]).flags), ["__proto__", "constructor"]);
      await assert.rejects(run("remote", "hello", "--bogus"), /remote does not know --bogus/);
      for (const hidden of ["hook", "keeper", "keeper-work", "open", "open-coordinator", "approve-current", "serve", "run", "turn-ended", "plan-written", "skill"]) await assert.rejects(run(hidden, "--bogus"), new RegExp(`${hidden} does not know --bogus`), hidden);
      await assert.rejects(run("turn-ended", "--id", "x", "--rol", "agent"), /turn-ended does not know --rol\. Did you mean --role\?/);
      await assert.rejects(run("automations", "list", "--review.wen", "never"), /automations list does not know --review\.wen: it takes no settings \(and the setting is named review\.when\)\. It takes: --json, --help/);
      await assert.rejects(run("automations", "list", "--review.when", "never"), /automations list does not know --review\.when: it takes no settings\. It takes/); // a real setting, where none is taken
      await assert.rejects(run("automations", "add", "n", "--prompt", "p", "--schedule", "daily 09:00", "--review.wen", "never"), /Unknown setting "review\.wen"\. Did you mean review\.when\?/);
      await assert.rejects(run("automations", "on", "n", "--prompt", "p"), /automations on does not know --prompt/);
      await assert.rejects(run("coordinator", "stop", "--agent", "codex"), /coordinator stop does not know --agent/);
      await assert.rejects(run("delegate", "1", "--worker.agnt", "codex"), /Unknown setting "worker\.agnt"\. Did you mean worker\.agent\?/);
      await assert.rejects(run("list", "--review.when", "never"), /list does not know --review\.when: it takes no settings/);
      assert.equal(S.automations().length, 0);
      // settings given to add without --delegate are the task's own from the start, and kept
      await run("add", "Kept", "settings", "--review.when", "never", "--merge.by=itself", "--no-research");
      const t = S.list()[0];
      assert.deepEqual([t.title, t.settings["review.when"], t.settings["merge.by"], t.settings["research.only"], t.stage], ["Kept settings", "never", "itself", false, "todo"]);
      assert.match(await run("show", t.id), /\n\* review\.when +never +this task\n/);
      assert.match(await run("list", "--archived"), /No tasks/); assert.match(await run("list", "--all", "--query", "kept"), /Kept settings/);
    } finally { process.chdir(cwd); }
    // how a flag was typed is kept beside what it means
    assert.deepEqual(parse(["a", "--no-x", "--y=1", "--z", "v"]), { pos: ["a"], flags: { x: false, y: "1", z: "v" }, typed: { x: "--no-x", y: "--y", z: "--z" } });
    // every flag the help names for a command is one that command takes
    let cmds = [], sub = "";
    for (const l of HELP.split("\n")) {
      const m = /^ {2}herdr-superwork ([a-z|-]+)(?: ([a-z]+)\b)?/.exec(l);
      if (m) { cmds = m[1].split("|"); sub = m[2] || ""; } else if (/^ {2}\S/.test(l)) cmds = [];
      for (const [, f] of l.matchAll(/--(?:no-)?([a-z][a-z-]*)\b(?!\.)/g)) for (const c of cmds) assert.deepEqual(unknownFlags(c, { [f]: true }, {}, sub), [], `${c} ${sub} --${f}`);
    }
  } finally { w.cleanup(); }
});
