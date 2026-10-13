import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { world, settle, git, stateOf } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { rules } from "../src/delegate.js";
import { onPane } from "../src/hook.js";


test("delegate: a herdr worktree workspace, the agent in its root pane, the first prompt with the rules", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ status: "working" }] }); // the agent keeps working
    const t0 = A.add(w.root, "Add a greeting", { description: "Say hello." });
    A.delegate(t0.id);
    assert.equal(S.get(t0.id).stage, "starting");
    const t = await settle(t0.id);
    assert.equal(t.stage, "working");
    assert.equal(t.branch, "work/1-add-a-greeting");
    assert.ok(fs.existsSync(t.worktree) && t.worktree !== w.root);
    assert.equal(t.link.socket, w.socket); assert.ok(t.link.pane && t.link.workspace && t.link.ownsWorkspace);
    const st = w.state();
    const pane = st.panes.find((p) => p.pane_id === t.link.pane);
    assert.equal(pane.agent.name, "sw-proj-1"); assert.equal(pane.agent.kind, "claude");
    assert.ok(pane.agent.args.includes("--dangerously-skip-permissions")); // full access by default, as pi-work's agents had
    const prompt = pane.agent.prompts[0];
    assert.match(prompt, /\n\nAdd a greeting\n\nSay hello\./);
    const standing = fs.readFileSync(pane.agent.args[pane.agent.args.indexOf("--append-system-prompt-file") + 1], "utf8"); // the rules ride on the launch, in a file, in force for the whole session
    assert.match(standing, /closing-note\.md/); assert.match(standing, /herdr-superwork report proj\/1 --state blocked/); assert.match(standing, /Do not push/); assert.match(prompt, /^Work board task proj\/1, role: agent\./);
    assert.match(git(w.root, "rev-parse", "--git-path", "info/exclude") && fs.readFileSync(path.join(w.root, ".git/info/exclude"), "utf8"), /\.herdr-superwork\//);
    assert.equal(JSON.parse(fs.readFileSync(process.env.HERDR_SUPERWORK_CLAUDE_JSON, "utf8")).projects[w.root].hasTrustDialogAccepted, true); // pre-trusted
    assert.equal(stateOf(t.id).state, "working");
    assert.throws(() => A.delegate(t.id), /already has an agent/);
  } finally { w.cleanup(); }
});

test("a freshly delegated task says starting, and finishing only once its agent has worked", async () => {
  const w = await world();
  try {
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Add a greeting").id;
    A.delegate(id);
    const t = await settle(id);
    const set = (status) => { w.patchState((s) => { const p = s.panes.find((p) => p.pane_id === t.link.pane); s.seq += 1; p.agent.status = status; p.agent.seq = s.seq; }); onPane(w.socket, t.link.pane); return stateOf(id); };
    // the agent program is up and its first turn is not under way: herdr calls that idle, as it does a turn's end
    S.update(id, (t) => { delete t.workedAt; });
    assert.deepEqual([set("idle").state, stateOf(id).note, S.get(id).stage], ["working", "Starting", "working"]);
    assert.equal(set("working").note, "Working");
    assert.equal(set("idle").note, "Finishing"); // it worked, and its turn's end has not been handled yet
    // a reply to an agent that worked before: idle until it picks the reply up is not the end of a turn either
    S.update(id, (t) => { t.armedAt = Date.now() + 5; t.turnBy = "reply"; });
    assert.equal(stateOf(id).note, "About to continue");
  } finally { w.cleanup(); }
});

test("a start-up dialog answered, the first prompt sent and not picked up yet: still starting, however often herdr is read", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    w.patchState((s) => { s.dialogs.claude = 1; });
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Behind a dialog").id;
    A.delegate(id);
    const t = await settle(id);
    const { herdr } = await import("../src/herdr.js");
    herdr().agentKeys(t.link.pane, "down", "enter"); // herdr counts the answer as a finished turn
    const agent = () => w.state().panes.find((p) => p.pane_id === t.link.pane).agent;
    const before = { status: agent().status, seq: agent().seq };
    onPane(w.socket, t.link.pane); // the reading that sends the waiting prompt
    assert.equal(S.pendingText(id).length, 0); assert.equal(agent().prompts.length, 1);
    // the agent program has taken the prompt and its model has not begun: herdr reads exactly as before
    w.patchState((s) => { Object.assign(s.panes.find((p) => p.pane_id === t.link.pane).agent, before); });
    S.update(id, (t) => { delete t.workedAt; });
    for (let i = 0; i < 3; i++) { onPane(w.socket, t.link.pane); assert.deepEqual([stateOf(id).state, stateOf(id).note, S.get(id).stage], ["working", "Starting", "working"]); }
    assert.ok(S.get(id).last.comp != null && S.get(id).workedAt === undefined);
    // and the finish line does not take the answered dialog for the end of the agent's work
    const after = await settle(id);
    assert.deepEqual([after.stage, after.msg, stateOf(id).note], ["working", "", "Starting"]);
    // herdr's state moves on with no work done: the prompt counts as taken, and the dialog's count is still not a turn's end
    w.patchState((s) => { const a = s.panes.find((p) => p.pane_id === t.link.pane).agent; s.seq += 1; a.seq = s.seq; });
    for (let i = 0; i < 3; i++) onPane(w.socket, t.link.pane);
    assert.equal(S.get(id).sent, null); assert.deepEqual(globalThis.__swJobs, []); // no finish line was started
    const later = await settle(id);
    assert.deepEqual([later.stage, later.msg, stateOf(id).state, stateOf(id).note], ["working", "", "working", "Starting"]);
  } finally { w.cleanup(); }
});

test("a start-up dialog's turn that herdr counts only after the first prompt went out: the finish line leaves the untouched task alone", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    w.patchState((s) => { s.dialogs.claude = 1; });
    w.script({ worker: [{ status: "working" }] });
    const id = A.add(w.root, "Behind a dialog").id;
    A.delegate(id);
    const t = await settle(id);
    const read = (fn) => { w.patchState((s) => { const a = s.panes.find((p) => p.pane_id === t.link.pane).agent; s.seq += 1; a.status = "idle"; a.seq = s.seq; fn?.(a, s); }); onPane(w.socket, t.link.pane); };
    read(); // the dialog is answered, and herdr has not counted that yet: the waiting prompt goes out
    assert.equal(S.pendingText(id).length, 0); assert.equal(w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts.length, 1);
    // now herdr counts it, the model has not begun: every reading starts the finish line, which finds nothing to finish
    for (let i = 0; i < 3; i++) {
      read((a, s) => { a.completion = a.completion ?? s.seq; });
      const after = await settle(id);
      assert.deepEqual([after.stage, after.msg, stateOf(id).state, stateOf(id).note], ["working", "", "working", "Starting"]);
    }
    assert.equal(w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts.length, 1);
    // the agent then works and ends its turn as any other: that end is still seen
    w.patchState((s) => { const a = s.panes.find((p) => p.pane_id === t.link.pane).agent; s.seq += 1; a.status = "working"; a.seq = s.seq; });
    onPane(w.socket, t.link.pane);
    assert.equal(stateOf(id).note, "Working");
    read((a, s) => { a.completion = s.seq; });
    assert.equal((await settle(id)).stage, "nosummary"); // it worked and said nothing: that is for the human
  } finally { w.cleanup(); }
});

test("a board kept in its own folder: the agent's command and its herdr space both name that board", async () => {
  const w = await world({ repo: false }); // a plain folder: its space is herdr's to make, not a worktree
  try {
    w.script({ worker: [{ status: "working" }, { status: "working" }] });
    const t0 = A.add(w.root, "Plain folder"); A.delegate(t0.id);
    const t = await settle(t0.id);
    const want = { HERDR_SUPERWORK_DATA_DIR: process.env.HERDR_SUPERWORK_DATA_DIR, HERDR_SUPERWORK_CONFIG_DIR: process.env.HERDR_SUPERWORK_CONFIG_DIR };
    assert.deepEqual(w.state().panes.find((p) => p.pane_id === t.link.pane).env, want); // a space herdr can hand an environment
    // A worktree's space gets none from herdr, so the command itself carries the board. Run as the agent would: by
    // the path in its rules, from its folder, with nothing in the environment pointing at this board.
    const cmd = F.shim();
    assert.ok(rules(S.get(t.id)).includes(`${cmd} suggest `));
    const env = { ...process.env, HERDR_SUPERWORK_HOME: path.join(w.base, "default-home") };
    delete env.HERDR_SUPERWORK_DATA_DIR; delete env.HERDR_SUPERWORK_CONFIG_DIR;
    execFileSync(cmd, ["add", "Found on the way", "--desc", "A follow-up."], { cwd: w.root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.ok(F.board().some((x) => x.title === "Found on the way"));
    assert.ok(!fs.existsSync(path.join(w.base, "default-home"))); // nothing went to the default board
    // folders that come from the home folder rather than their own variables are carried just the same
    const keep = { ...want, HERDR_SUPERWORK_HOME: process.env.HERDR_SUPERWORK_HOME };
    try {
      delete process.env.HERDR_SUPERWORK_DATA_DIR; delete process.env.HERDR_SUPERWORK_CONFIG_DIR;
      process.env.HERDR_SUPERWORK_HOME = path.join(w.base, "other-home");
      fs.mkdirSync(path.join(w.base, "other-home", "settings"), { recursive: true });
      fs.writeFileSync(path.join(w.base, "other-home", "settings", "config.json"), JSON.stringify({ max: 23 }));
      const other = { HERDR_SUPERWORK_DATA_DIR: path.join(w.base, "other-home", "data"), HERDR_SUPERWORK_CONFIG_DIR: path.join(w.base, "other-home", "settings") };
      assert.deepEqual(S.boardEnv(), other);
      const text = fs.readFileSync(F.shim(), "utf8"); // the command names both, so the agent's own environment does not count (run for real above)
      for (const [k, v] of Object.entries(other)) assert.ok(text.includes(`export ${k}='${v}'`));
    } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    // a shim an older version left as a link is replaced
    fs.rmSync(cmd); fs.symlinkSync(S.BIN, cmd);
    assert.ok(!fs.lstatSync(F.shim()).isSymbolicLink());
  } finally { w.cleanup(); }
});

test("the finish line: commit leftovers, check, review, then wait for approval; approve merges and cleans up", async () => {
  const w = await world({ repoSettings: { "check.command": "test -f hello.txt" } });
  try {
    w.script({ worker: [{ files: { "hello.txt": "hello\n", "left.txt": "uncommitted\n" }, note: "Added the greeting." }], reviewer: [{ verdict: { meets: true, text: "Works. One nit.", findings: [{ severity: "minor", subject: "hello.txt lacks a newline check", where: "hello.txt", proof: "" }] } }] });
    const id = A.add(w.root, "Add a greeting").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    assert.equal(t.review.pass, true); assert.equal(t.review.gate, "major"); assert.deepEqual(t.review.findings.map((f) => [f.id, f.severity, f.where]), [["F1", "minor", "hello.txt"]]); assert.equal(t.reviewRounds || 0, 0); // only minor findings: no other round assert.equal(t.summary, "Added the greeting.");
    assert.equal(t.reviewedHead, git(t.worktree, "rev-parse", "HEAD"));
    assert.equal(git(t.worktree, "status", "--porcelain"), ""); // leftovers were committed
    assert.match(t.msg, /^Approve to merge\? Review: Pass · 1 minor\. Added the greeting\./);
    let s = stateOf(id);
    assert.deepEqual([s.state, s.kind, s.asReview], ["blocked", "permission", true]);
    const st = w.state();
    assert.deepEqual(st.notifications, []); // nothing pops up when a task lands in review
    // herdr's own sidebar says what to do. With no sidebar rows in herdr's config the label rides on the agent's name too.
    assert.ok(st.metadata.some((m) => m.args.join(" ").includes("idle=approve? pass") && m.args.join(" ").includes("--display-agent approve? pass · claude")));
    // While the board ran the check, the sidebar had its line (no percent: this check reports no count), taken off again when it ended.
    const told = st.metadata.filter((m) => m.pane === t.link.pane).map((m) => m.args.join(" "));
    const began = told.findIndex((x) => x.includes("--token summary=Running the check") && x.includes("--clear-token progress")), ended = told.findIndex((x) => x.includes("--clear-token summary --clear-token progress --clear-token eta"));
    assert.ok(began >= 0 && ended > began, told.join("\n")); assert.equal(t.check, null);
    // Once the plugin's sidebar rows are installed, the state text shows beside the agent's name: renaming the agent
    // as well would say the label twice on one line, so the name is left alone.
    const cfg = path.join(w.root, "..", "herdr-config.toml"), oldCfg = process.env.HERDR_CONFIG_PATH;
    fs.writeFileSync(cfg, "# >>> herdr-superwork sidebar (added by the herdr-superwork plugin)\n[ui.sidebar.agents]\nrows = [[\"agent\", \"state_text\"]]\n# <<< herdr-superwork sidebar\n");
    process.env.HERDR_CONFIG_PATH = cfg;
    try {
      F.labelPane(t, "approve? pass");
      const last = w.state().metadata.map((m) => m.args.join(" ")).filter((x) => x.includes("--state-label")).at(-1);
      assert.ok(last.includes("idle=approve? pass") && last.includes("--clear-display-agent") && !last.includes("--display-agent approve"), last);
    } finally { if (oldCfg === undefined) delete process.env.HERDR_CONFIG_PATH; else process.env.HERDR_CONFIG_PATH = oldCfg; }
    assert.ok(!st.panes.some((p) => p.agent?.name === "sw-proj-1-r")); // the reviewer pane is closed again
    assert.equal(st.panes.find((p) => p.pane_id === t.link.pane).agent.kind, "claude");
    // approve
    A.approve(id);
    assert.equal(S.get(id).stage, "merging");
    t = await settle(id);
    assert.equal(t.stage, "done", JSON.stringify(t.failure));
    assert.equal(t.msg, "Merged into main.");
    assert.equal(fs.readFileSync(path.join(w.root, "hello.txt"), "utf8"), "hello\n");
    assert.match(git(w.root, "log", "-1", "--format=%B"), /Add a greeting\n\nTask: proj\/1/);
    assert.ok(!fs.existsSync(t.kept ? "/nonexistent" : path.join(w.fake, "worktrees", "proj", "work-1-add-a-greeting")), "worktree removed");
    assert.equal(git(w.root, "branch", "--list", "work/*"), "");
    assert.equal(w.state().workspaces.filter((x) => x.worktree?.is_linked_worktree).length, 0);
    assert.equal(stateOf(id).state, "done");
  } finally { w.cleanup(); }
});

test("a failed check goes straight back to the agent, `review.rounds` times, then a saved failure", async () => {
  const w = await world({ settings: { "review.rounds": 2 }, repoSettings: { "check.command": "test -f good.txt" } });
  try {
    w.script({ worker: [{ note: "Done 1." }, { note: "Done 2." }, { note: "Done 3." }] });
    const id = A.add(w.root, "Never passes").id;
    A.delegate(id);
    const t = await settle(id, { max: 30 });
    assert.equal(t.stage, "failed");
    assert.equal(t.checkFails, 3);
    assert.match(t.failure.title, /Check failed after 3 tries/);
    const prompts = w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts;
    assert.equal(prompts.length, 3); // the task, then two repair rounds
    assert.match(prompts[1], /The check failed, so this is not done yet/); assert.match(prompts[1], /closing-note\.md/);
    assert.equal(stateOf(id).state, "error");
  } finally { w.cleanup(); }
});

test("a human turn with no closing note is held as 'stopped without a summary'; finish anyway runs the pipeline", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    w.script({ worker: [{ files: { "x.txt": "x\n" }, note: null, screen: "I ran out of context\n> " }] });
    const id = A.add(w.root, "No note").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "nosummary");
    assert.match(t.msg, /ran out of context/);
    assert.equal(git(t.worktree, "status", "--porcelain").trim(), "?? x.txt"); // nothing was committed
    assert.equal(stateOf(id).state, "error");
    A.finishAnyway(id);
    t = await settle(id);
    assert.equal(t.stage, "approval");
    assert.equal(git(t.worktree, "status", "--porcelain"), "");
  } finally { w.cleanup(); }
});

test("a closing note that ends in a question blocks on the human; the reply re-arms the pipeline", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    w.script({ worker: [{ note: "I need a decision.\nRed or blue?" }, { files: { "c.txt": "blue\n" }, commit: "blue", note: "Went with blue." }] });
    const id = A.add(w.root, "Pick a colour").id;
    A.delegate(id);
    let t = await settle(id);
    assert.deepEqual([t.stage, t.kind, t.msg], ["asks", "question", "Red or blue?"]);
    assert.equal(stateOf(id).kind, "question");
    assert.equal(A.tell(id, "Blue.").msg, "Sent to the agent");
    t = await settle(id);
    assert.equal(t.stage, "approval");
    assert.equal(t.summary, "Went with blue.");
  } finally { w.cleanup(); }
});

test("undelivered text is never dropped: a trust dialog queues the first prompt until it is answered", async () => {
  const w = await world({ settings: { "review.when": "never" } });
  try {
    w.patchState((s) => { s.dialogs.claude = 1; });
    w.script({ worker: [{ files: { "d.txt": "d\n" }, commit: "d", note: "Did it after the dialog." }] });
    const id = A.add(w.root, "Behind a dialog").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "working");
    assert.equal(S.pendingText(id).length, 1);
    let s = stateOf(id);
    assert.deepEqual([s.state, s.kind], ["blocked", "permission"]);
    assert.deepEqual(w.state().notifications, []);
    assert.match(A.tell(id, "Also add a test.").msg, /^queued/); // a reply while blocked is queued too
    // the human goes in and answers the dialog
    const { herdr } = await import("../src/herdr.js");
    herdr().agentKeys(t.link.pane, "down", "enter");
    // the dialog is gone, the first prompt has not been sent yet: herdr counts the answer as a finished turn, and the
    // agent has still done nothing
    assert.equal(w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts?.length || 0, 0);
    assert.deepEqual([stateOf(id).state, stateOf(id).note], ["working", "Starting"]);
    t = await settle(id);
    assert.equal(S.pendingText(id).length, 0);
    assert.equal(t.stage, "approval");
    const prompts = w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts;
    assert.equal(prompts.length, 1); assert.match(prompts[0], /Behind a dialog/); assert.match(prompts[0], /Also add a test\.$/);
  } finally { w.cleanup(); }
});
