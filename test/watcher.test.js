// The hidden helper: the watcher's line and guess.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, settle, until } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import * as H from "../src/helpers.js";
import { here } from "./board-helpers.js";
import { watcherPrompt, readAnswer } from "../src/watcher/prompt.js";

test("the Watcher is shown how a status text is written, and what it writes is kept exactly as written", () => {
  const prompt = watcherPrompt([{ t: { title: "Add a greeting" }, role: "agent", lines: "● Editing greet.sh" }]);
  for (const example of ["Updating file locations and running checks", "Waiting for the PR review on GitHub", "Fixing the two failing tests"]) assert.ok(prompt.includes(`"${example}"`), example);
  assert.equal(readAnswer('[{"n": 1, "msg": "fixing the PR on github.", "progress": 40}]', 1).get(1).msg, "fixing the PR on github.");
});

test("the hidden helper: the watcher writes a line and a guess", async () => {
  const w = await world({ settings: { "review.when": "never", "watcher.agent": "claude" } });
  try {
    process.env.HERDR_SUPERWORK_HELPER_CMD = JSON.stringify(["node", path.join(here, "fake-helper.js")]);
    const seen = path.join(w.root, "..", "watcher-prompt.txt"); process.env.FAKE_HELPER_PROMPT = seen;
    A.add(w.root, "build a login page", { description: "It needs a password field.\n" + "x".repeat(3000) });
    // the watcher: only while herdr says working; 100k auto-compact on the watcher only
    w.script({ worker: [{ status: "working", screen: "● Writing greet.sh\n" }] });
    A.delegate("proj/1"); await settle("proj/1");
    S.update("proj/1", (t) => { t.since = Date.now() - 40 * 60000; t.workAt = 0; }); // forty minutes into the work
    H.watcherReset();
    H.watchTick(F.board(), Date.now(), { load: 0 });
    await until(() => S.get("proj/1").watch); // the helper is a program of its own
    // It guesses the line and the percent only; the minutes left are worked out, never stored.
    assert.deepEqual([S.get("proj/1").watch.msg, S.get("proj/1").watch.progress, "eta" in S.get("proj/1").watch], ["editing the greeting file", 42, false]);
    const shown = F.board().find((t) => t.id === "proj/1");
    assert.deepEqual([shown.note, shown.progress, shown.eta], ["editing the greeting file", 42, 55]); // 40 × 58 ÷ 42
    F.syncSidebar(F.board()); // whoever ticks tells herdr's sidebar the row: the same line, percent and minutes left
    assert.ok(w.state().metadata.some((m) => m.args.join(" ").includes("--display-agent agent · working") && m.args.join(" ").includes("summary=editing the greeting file") && m.args.join(" ").includes("progress=42% 55m left")));
    // What it was told: the task's description (cut short), the time spent, and no rule against going lower.
    const first = fs.readFileSync(seen, "utf8");
    assert.match(first, /Task: build a login page\nWhat the task asks for:\nIt needs a password field\. x+\n/); assert.ok(!first.includes("x".repeat(900)));
    assert.match(first, /^You write short status lines for a dashboard/); // the few words that stand in for the program's own long instructions
    assert.match(first, /The agent has been on this for 40 minutes so far\./); assert.match(first, /This is your first look at it\./);
    assert.doesNotMatch(first, /"eta"|minutes are left|started over/);
    // The next look gets the previous guess, and may lower it when new work shows up.
    w.patchState((st) => { st.panes.find((p) => p.pane_id === S.get("proj/1").link.pane).agent.screen = "● 3 tests failed\n"; });
    const at = S.get("proj/1").watch.at;
    H.watchTick(F.board(), Date.now() + 61000, { load: 0 }); // a minute later: the next look is due
    await until(() => S.get("proj/1").watch.at !== at);
    const second = fs.readFileSync(seen, "utf8");
    assert.match(second, /Your previous guess was 42 percent\. Keep it unless something on the screen is a reason to change it\./); assert.match(second, /Lower it when new work shows up: a failing test/);
    // Stopped and delegated again: the old guess goes, so the new assignment starts with no percent and no minutes.
    A.stop("proj/1"); S.update("proj/1", (t) => { t.watch = { msg: "reading the diff", progress: 80, role: "reviewer", at: Date.now() }; t.reviewAt = Date.now() - 40 * 60000; });
    w.script({ worker: [{ status: "working", screen: "● Starting over\n" }] });
    A.delegate("proj/1"); await settle("proj/1");
    const fresh = F.board().find((t) => t.id === "proj/1");
    assert.deepEqual([S.get("proj/1").stage, S.get("proj/1").watch, fresh.eta], ["working", null, undefined]);
  } finally { delete process.env.HERDR_SUPERWORK_HELPER_CMD; delete process.env.FAKE_HELPER_PROMPT; w.cleanup(); }
});
