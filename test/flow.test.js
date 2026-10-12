import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { world, settle, git } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { rules } from "../src/delegate.js";

const stateOf = (id) => F.board({ includeArchived: true }).find((t) => t.id === id);

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
    assert.match(standing, /closing-1\.md/); assert.match(standing, /herdr-superwork report proj\/1 --state blocked/); assert.match(standing, /Do not push/); assert.match(prompt, /^Work board task proj\/1, role: agent\./);
    assert.match(git(w.root, "rev-parse", "--git-path", "info/exclude") && fs.readFileSync(path.join(w.root, ".git/info/exclude"), "utf8"), /\.herdr-superwork\//);
    assert.equal(JSON.parse(fs.readFileSync(process.env.HERDR_SUPERWORK_CLAUDE_JSON, "utf8")).projects[w.root].hasTrustDialogAccepted, true); // pre-trusted
    assert.equal(stateOf(t.id).state, "working");
    assert.throws(() => A.delegate(t.id), /already has an agent/);
  } finally { w.cleanup(); }
});

test("a board kept in its own folder: the agent's command and its herdr space both name that board", async () => {
  const w = await world({ settings: { worktree: "none" } });
  try {
    w.script({ worker: [{ status: "working" }, { status: "working" }] });
    const t0 = A.add(w.root, "Plain folder"); A.delegate(t0.id);
    const t = await settle(t0.id);
    const want = { HERDR_SUPERWORK_DATA_DIR: process.env.HERDR_SUPERWORK_DATA_DIR, HERDR_SUPERWORK_CONFIG_DIR: process.env.HERDR_SUPERWORK_CONFIG_DIR };
    assert.deepEqual(w.state().panes.find((p) => p.pane_id === t.link.pane).env, want); // a space herdr can hand an environment
    // A worktree's space gets none from herdr, so the command itself carries the board. Run as the agent would: by
    // the path in its rules, from its folder, with nothing in the environment pointing at this board.
    const cmd = F.shim();
    assert.ok(rules(S.get(t.id)).includes(`${cmd} add `));
    const env = { ...process.env, XDG_STATE_HOME: path.join(w.base, "default-state"), XDG_CONFIG_HOME: path.join(w.base, "default-config") };
    delete env.HERDR_SUPERWORK_DATA_DIR; delete env.HERDR_SUPERWORK_CONFIG_DIR;
    execFileSync(cmd, ["add", "Found on the way", "--desc", "A follow-up."], { cwd: w.root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.ok(F.board().some((x) => x.title === "Found on the way"));
    assert.ok(!fs.existsSync(path.join(w.base, "default-state"))); // nothing went to the default board
    // folders chosen through XDG_* rather than the board's own variables are carried just the same
    const keep = { ...want, XDG_STATE_HOME: process.env.XDG_STATE_HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
    try {
      delete process.env.HERDR_SUPERWORK_DATA_DIR; delete process.env.HERDR_SUPERWORK_CONFIG_DIR;
      process.env.XDG_STATE_HOME = path.join(w.base, "xdg-state"); process.env.XDG_CONFIG_HOME = path.join(w.base, "xdg-config");
      fs.mkdirSync(path.join(w.base, "xdg-config", "herdr-superwork"), { recursive: true });
      fs.writeFileSync(path.join(w.base, "xdg-config", "herdr-superwork", "config.json"), JSON.stringify({ max: 23 }));
      const xdg = { HERDR_SUPERWORK_DATA_DIR: path.join(w.base, "xdg-state", "herdr-superwork"), HERDR_SUPERWORK_CONFIG_DIR: path.join(w.base, "xdg-config", "herdr-superwork") };
      assert.deepEqual(S.boardEnv(), xdg);
      const out = execFileSync(F.shim(), ["config", "max"], { cwd: w.root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      assert.match(out, /23/); // read with the agent's environment, which points XDG_* elsewhere
    } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    // a shim an older version left as a link is replaced
    fs.rmSync(cmd); fs.symlinkSync(S.BIN, cmd);
    assert.ok(!fs.lstatSync(F.shim()).isSymbolicLink());
  } finally { w.cleanup(); }
});

test("the finish line: commit leftovers, check, review, then wait for approval; approve merges and cleans up", async () => {
  const w = await world({ repoSettings: { check: "test -f hello.txt" } });
  try {
    w.script({ worker: [{ files: { "hello.txt": "hello\n", "left.txt": "uncommitted\n" }, note: "Added the greeting." }], reviewer: [{ verdict: { score: 4, recommend: true, text: "Works. One nit.", problems: ["hello.txt lacks a newline check"] } }] });
    const id = A.add(w.root, "Add a greeting").id;
    A.delegate(id);
    let t = await settle(id);
    assert.equal(t.stage, "approval", JSON.stringify(t.failure));
    assert.equal(t.review.score, 4); assert.equal(t.review.recommend, true); assert.equal(t.summary, "Added the greeting.");
    assert.equal(t.reviewedHead, git(t.worktree, "rev-parse", "HEAD"));
    assert.equal(git(t.worktree, "status", "--porcelain"), ""); // leftovers were committed
    assert.match(t.msg, /^Approve to merge\? Reviewed 4\/5, says merge\. Added the greeting\./);
    let s = stateOf(id);
    assert.deepEqual([s.state, s.kind, s.asReview], ["blocked", "permission", true]);
    const st = w.state();
    assert.deepEqual(st.notifications, []); // nothing pops up when a task lands in review
    // herdr's own sidebar says what to do. With no sidebar rows in herdr's config the label rides on the agent's name too.
    assert.ok(st.metadata.some((m) => m.args.join(" ").includes("idle=approve? 4/5") && m.args.join(" ").includes("--display-agent approve? 4/5 · claude")));
    // Once the plugin's sidebar rows are installed, the state text shows beside the agent's name: renaming the agent
    // as well would say the label twice on one line, so the name is left alone.
    const cfg = path.join(w.root, "..", "herdr-config.toml"), oldCfg = process.env.HERDR_CONFIG_PATH;
    fs.writeFileSync(cfg, "# >>> herdr-superwork sidebar (added by the herdr-superwork plugin)\n[ui.sidebar.agents]\nrows = [[\"agent\", \"state_text\"]]\n# <<< herdr-superwork sidebar\n");
    process.env.HERDR_CONFIG_PATH = cfg;
    try {
      F.labelPane(t, "approve? 4/5");
      const last = w.state().metadata.map((m) => m.args.join(" ")).filter((x) => x.includes("--state-label")).at(-1);
      assert.ok(last.includes("idle=approve? 4/5") && last.includes("--clear-display-agent") && !last.includes("--display-agent approve"), last);
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

test("a failed check goes straight back to the agent, three tries, then a saved failure", async () => {
  const w = await world({ repoSettings: { check: "test -f good.txt" } });
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
    assert.match(prompts[1], /The check failed, so this is not done yet/); assert.match(prompts[1], /closing-1\.md/);
    assert.equal(stateOf(id).state, "error");
  } finally { w.cleanup(); }
});

test("a human turn with no closing note is held as 'stopped without a summary'; finish anyway runs the pipeline", async () => {
  const w = await world({ settings: { reviewer: "off" } });
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
  const w = await world({ settings: { reviewer: "off" } });
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
  const w = await world({ settings: { reviewer: "off", trust: false } });
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
    t = await settle(id);
    assert.equal(S.pendingText(id).length, 0);
    assert.equal(t.stage, "approval");
    const prompts = w.state().panes.find((p) => p.pane_id === t.link.pane).agent.prompts;
    assert.equal(prompts.length, 1); assert.match(prompts[0], /Behind a dialog/); assert.match(prompts[0], /Also add a test\.$/);
  } finally { w.cleanup(); }
});
