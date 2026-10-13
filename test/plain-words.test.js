// The board's plain words: a task is added, updated, removed, started, archived, restored. Nothing is "filed".
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as C from "../src/coordinator.js";
import { main } from "../src/cli.js";
import { skillText } from "../src/extras.js";
import { rules as agentRules } from "../src/delegate.js";
import { reviewBrief } from "../src/finish.js";
import { KEYS } from "../src/board/keys.js";

// "file" as a verb, in any form. The noun (a file on disk) is not meant.
const FILED = /\b(filed|filing|refile)\b|(?<!\b(the|a|that|same|each|every|this) )\bfiles? (it|them|each|this|that|a task|a new|its tasks|tasks?|nothing|no task|no|none)\b|\b(you|to|never|not|it|Coordinator) files?\b/i;

test("commands answer added, updated, removed, archived, restored; the instructions say add, never file", async () => {
  const w = await world();
  const write = process.stdout.write; let said = "";
  const board = async (...args) => { said = ""; process.stdout.write = (x, ...more) => { if (typeof x !== "string") return write.call(process.stdout, x, ...more); said += x; return true; }; try { await main(args); } finally { process.stdout.write = write; } return said; };
  try {
    assert.equal(await board("add", "Add an undo", "--repo", w.root), "proj/1: added\n");
    assert.equal(await board("report", "--title", "Dark mode", "--repo", w.root), "proj/2: added\n");
    assert.equal(await board("describe", "proj/1", "For the clear key."), "proj/1: updated (description)\n");
    assert.equal(await board("rename", "proj/1", "Add an undo key"), "proj/1: updated (title)\n");
    assert.equal(await board("report", "proj/1", "--title", "Undo"), "proj/1: updated (title)\n");
    assert.equal(await board("report", "proj/1", "--state", "working", "--msg", "half way"), "proj/1: updated (working)\n");
    assert.equal(await board("report", "proj/1", "--state", "idle", "--title", "Undo key"), "proj/1: updated (title, idle)\n");
    assert.equal(await board("archive", "proj/1"), "proj/1: archived\n");
    assert.equal(await board("restore", "proj/1"), "proj/1: restored\n");
    assert.equal(await board("clear", "proj/2"), "proj/2: removed\n"); assert.equal(S.get("proj/2"), null);
    assert.doesNotMatch(await board("help"), FILED);
    // What agents, reviewers and the Coordinator are told says add, never file.
    const t = A.add(w.root, "Add an undo");
    const told = { "the Coordinator's rules": C.rules("board"), "the tab note": C.TAB_NOTE, "the skill": skillText("board"), "an agent's rules": agentRules(S.get(t.id)),
      "the reviewer's brief": reviewBrief(S.get(t.id), { text: "done", change: { head: "abc" }, toLand: true, ch: {} }),
      "the keys": KEYS.map((k) => `${k.doc || ""} ${k.hint || ""} ${k.help || ""}`).join("\n"), "the keys page": fs.readFileSync(new URL("../docs/keys.md", import.meta.url), "utf8") };
    for (const [who, text] of Object.entries(told)) assert.doesNotMatch(text, FILED, who);
    // The Coordinator is told which words to report in, and which answer of "add" means no agent was started.
    assert.match(C.rules("board"), /end with one short line saying what you did, naming the ids, in these words: added a task, updated one \(its title, description or settings\), removed one, started an agent on one, approved, archived, restored\. For example: "Added proj\/12"/);
    assert.match(C.rules("board"), /if it only says "added", run "board delegate <id>"/);
    assert.match(C.TAB_NOTE, /if "board add" answers only "added", run "board delegate <id>"/);
    assert.match(skillText("board"), /add a new task to the current repo[^]*Adding starts nothing\./);
    assert.match(agentRules(S.get(t.id)), /do not do it and do not add it as a task: mention it in a short "Also noticed" list at the end of your closing note/);
  } finally { w.cleanup(); }
});
