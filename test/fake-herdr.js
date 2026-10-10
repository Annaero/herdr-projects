#!/usr/bin/env node
// A stand-in for the herdr binary, for tests: no server, no terminals, no model calls. Its whole world is one JSON
// file in $HERDR_FAKE_DIR. Agents are scripted: each `agent prompt` plays the next step of $HERDR_FAKE_DIR/script.json
// for that role (worker, or reviewer when the agent's name ends in -r).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.env.HERDR_FAKE_DIR;
const file = path.join(dir, "state.json");
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const st = read(file, { seq: 0, nextW: 1, nextP: 100, workspaces: [], panes: [], notifications: [], metadata: [], focus: [], calls: [], dialogs: {} });
const save = () => fs.writeFileSync(file, JSON.stringify(st, null, 2));
const argv = process.argv.slice(2);
st.calls.push(argv.join(" ").slice(0, 300));
const ok = (result) => { save(); process.stdout.write(JSON.stringify({ id: "fake", result }) + "\n"); process.exit(0); };
const fail = (code, message) => { save(); process.stderr.write(JSON.stringify({ id: "fake", error: { code, message: message || code } }) + "\n"); process.exit(1); };
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name) => argv.includes(name);
const envOf = () => Object.fromEntries(argv.flatMap((a, i) => (a === "--env" ? [argv[i + 1].split(/=(.*)/s).slice(0, 2)] : [])));
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const wsOut = (w) => ({ workspace_id: w.workspace_id, label: w.label, pane_count: st.panes.filter((p) => p.workspace_id === w.workspace_id).length, ...(w.worktree ? { worktree: w.worktree } : {}) });
const agentOut = (p) => ({ agent: p.agent.kind, agent_status: p.agent.status, name: p.agent.name, pane_id: p.pane_id, workspace_id: p.workspace_id, tab_id: p.tab_id, terminal_id: p.terminal_id, cwd: p.cwd, foreground_cwd: p.cwd,
  state_change_seq: p.agent.seq, ...(p.agent.completion != null ? { completion_seq: p.agent.completion } : {}), ...(p.agent.session ? { agent_session: { kind: "id", value: p.agent.session } } : {}) });
const paneOut = (p) => ({ pane_id: p.pane_id, workspace_id: p.workspace_id, tab_id: p.tab_id, terminal_id: p.terminal_id, cwd: p.cwd, foreground_cwd: p.cwd, agent: p.agent?.kind || null, agent_status: p.agent?.status || "unknown" });
function newWorkspace(cwd, label, worktree) {
  const id = `w${st.nextW++}`;
  const w = { workspace_id: id, label: label || path.basename(cwd), cwd, worktree };
  st.workspaces.push(w);
  const p = { pane_id: `${id}:p1`, workspace_id: id, tab_id: `${id}:t1`, terminal_id: `term_${st.nextP++}`, cwd, agent: null };
  st.panes.push(p);
  return { workspace: wsOut(w), tab: { tab_id: p.tab_id, workspace_id: id }, root_pane: paneOut(p) };
}
const findPane = (id) => st.panes.find((p) => p.pane_id === id);
const findAgent = (target) => st.panes.find((p) => p.agent && (p.pane_id === target || p.agent.name === target));
const bump = (p, status, complete) => { st.seq += 1; p.agent.status = status; p.agent.seq = st.seq; if (complete) p.agent.completion = st.seq; };

// One scripted turn. Steps: { merge: "commit to merge first", files: {path: text}, commit: "message", note: "closing note", verdict: {...},
// status: "done" | "unknown" | "blocked" | "working", session: "id", screen: "text" }
function play(p, prompt) {
  const script = read(path.join(dir, "script.json"), {});
  const role = /-r(-\d+)?$/.test(p.agent.name) ? "reviewer" : "worker";
  const n = (p.agent.name.match(/-(\d+)(?:-[0-9a-f]{4})?(?:-r(?:-\d+)?)?$/) || [])[1];
  const queue = script[role] || [];
  const step = queue.shift() || (role === "reviewer" ? { verdict: { score: 5, recommend: true, text: "Looks right. Nothing found." } } : { note: "Done." });
  fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify({ ...script, [role]: queue }));
  (p.agent.prompts ||= []).push(prompt);
  bump(p, "working", false);
  if (step.merge) { try { git(p.cwd, ["merge", "-q", "--no-edit", String(step.merge)]); } catch {} } // conflicts are resolved by `files` and `commit`
  for (const [rel, text] of Object.entries(step.files || {})) { fs.mkdirSync(path.dirname(path.join(p.cwd, rel)), { recursive: true }); fs.writeFileSync(path.join(p.cwd, rel), text); }
  if (step.commit) { git(p.cwd, ["add", "-A"]); git(p.cwd, ["-c", "user.email=agent@test", "-c", "user.name=agent", "commit", "-qm", String(step.commit)]); }
  if (step.note !== undefined && step.note !== null) { const f = path.join(p.cwd, ".herdr-superwork", `closing-${n}.md`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, step.note); const t = new Date(Date.now() + 5); fs.utimesSync(f, t, t); }
  if (step.verdict) {
    const d = fs.readdirSync(path.join(p.cwd, ".herdr-superwork")).find((x) => x.startsWith("review-"));
    const out = path.join(p.cwd, ".herdr-superwork", d);
    for (const [name, text] of Object.entries(step.evidence || {})) fs.writeFileSync(path.join(out, name), text);
    let commit = step.verdict.commit;
    if (!commit || commit === "HEAD") { try { commit = git(p.cwd, ["rev-parse", "HEAD"]); } catch { commit = ""; } }
    if (step.dirtyTree) fs.writeFileSync(path.join(p.cwd, "reviewer-scratch.txt"), "the reviewer changed something\n");
    fs.writeFileSync(path.join(out, "verdict.json"), JSON.stringify({ ...step.verdict, commit }));
  }
  if (step.session) p.agent.session = step.session;
  if (step.screen) p.agent.screen = step.screen;
  if (step.exit) { p.agent = null; return; }
  const status = step.status || "done";
  if (status !== "working") bump(p, status, status === "done" || status === "idle");
}

const [area, verb] = argv;
if (area === "workspace") {
  if (verb === "list") ok({ type: "workspace_list", workspaces: st.workspaces.map(wsOut) });
  if (verb === "create") { const made = newWorkspace(path.resolve(flag("--cwd") || "."), flag("--label")); findPane(made.root_pane.pane_id).env = envOf(); ok({ type: "workspace_created", ...made }); }
  const w = st.workspaces.find((x) => x.workspace_id === argv[2]);
  if (!w) fail("workspace_not_found", `workspace ${argv[2]} not found`);
  if (verb === "get" && st.wsGetOk != null && st.wsGetOk-- <= 0) fail("timeout", "timed out"); // answers this many lookups, then none
  if (verb === "get") ok({ type: "workspace_info", workspace: wsOut(w) });
  if (verb === "focus") { st.focus.push(`workspace ${w.workspace_id}`); ok({ type: "workspace_info", workspace: wsOut(w) }); }
  if (verb === "close" && st.closeFails) fail("timeout", "timed out"); // a test's stand-in for a close herdr did not do
  if (verb === "close") { st.workspaces = st.workspaces.filter((x) => x !== w); st.panes = st.panes.filter((p) => p.workspace_id !== w.workspace_id); ok({ type: "ok" }); }
}
if (area === "worktree") {
  const repoOf = (cwd) => path.dirname(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  if (verb === "create") {
    const root = repoOf(path.resolve(flag("--cwd")));
    const branch = flag("--branch");
    const dest = path.join(dir, "worktrees", path.basename(root), branch.replace(/[^A-Za-z0-9._-]+/g, "-"));
    let exists = true; try { git(root, ["rev-parse", "--verify", `refs/heads/${branch}`]); } catch { exists = false; }
    git(root, exists ? ["worktree", "add", dest, branch] : ["worktree", "add", "--no-track", "-b", branch, dest, flag("--base") || "HEAD"]);
    if (!st.workspaces.some((w) => w.cwd === root)) newWorkspace(root, path.basename(root), { checkout_path: root, repo_root: root, is_linked_worktree: false });
    const made = newWorkspace(dest, flag("--label"), { checkout_path: dest, repo_root: root, is_linked_worktree: true });
    ok({ type: "worktree_created", ...made, worktree: { path: dest, branch, open_workspace_id: made.workspace.workspace_id } });
  }
  if (verb === "open") {
    const dest = path.resolve(flag("--path"));
    const root = repoOf(dest);
    const w = st.workspaces.find((x) => x.cwd === dest);
    if (w) ok({ type: "worktree_opened", workspace: wsOut(w), root_pane: paneOut(st.panes.find((p) => p.workspace_id === w.workspace_id)), already_open: true });
    ok({ type: "worktree_opened", ...newWorkspace(dest, flag("--label"), { checkout_path: dest, repo_root: root, is_linked_worktree: true }), already_open: false });
  }
  if (verb === "remove") {
    const w = st.workspaces.find((x) => x.workspace_id === flag("--workspace"));
    if (!w || !w.worktree?.is_linked_worktree) fail("workspace_not_found", "not a linked worktree workspace");
    if (st.removeFails) fail("timeout", "timed out");
    try { git(w.worktree.repo_root, ["worktree", "remove", ...(has("--force") ? ["--force"] : []), w.cwd]); } catch (e) { fail("worktree_remove_failed", String(e.stderr || e.message)); }
    st.workspaces = st.workspaces.filter((x) => x !== w); st.panes = st.panes.filter((p) => p.workspace_id !== w.workspace_id);
    ok({ type: "worktree_removed" });
  }
}
if (area === "tab" && verb === "focus") { st.focus.push(`tab ${argv[2]}`); ok({ type: "ok" }); }
if (area === "pane") {
  if (verb === "process-info") { const p = findPane(flag("--pane")); if (!p) fail("pane_not_found", "pane not found"); const shell = 4194400; ok({ type: "pane_process_info", process_info: { pane_id: p.pane_id, shell_pid: p.job ? 1 : shell, /* `job`: the shell has a background job beside the foreground program */ foreground_process_group_id: p.busy ? shell + 1 : shell, foreground_processes: [{ pid: p.tool ? 1 : p.busy ? shell + 1 : shell, name: p.tool ? "agent" : p.busy ? "sleep" : "bash" }] } }); } // `tool`: a program with children of its own (pid 1 always has some)
  if (verb === "list") { const w = flag("--workspace"); ok({ type: "pane_list", panes: st.panes.filter((p) => !w || p.workspace_id === w).map(paneOut) }); }
  const p = findPane(argv[2]);
  if (!p) fail("pane_not_found", `pane ${argv[2]} not found`);
  if (verb === "get") ok({ type: "pane_info", pane: paneOut(p) });
  if (verb === "split") { const n = st.panes.filter((x) => x.workspace_id === p.workspace_id).length + 1; const q = { pane_id: `${p.workspace_id}:p${n}`, workspace_id: p.workspace_id, tab_id: p.tab_id, terminal_id: `term_${st.nextP++}`, cwd: path.resolve(flag("--cwd") || p.cwd), env: envOf(), agent: null }; while (findPane(q.pane_id)) q.pane_id += "x"; st.panes.push(q); ok({ type: "pane_split", pane: paneOut(q) }); }
  if (verb === "close") { st.panes = st.panes.filter((x) => x !== p); ok({ type: "ok" }); }
  if (verb === "read") { save(); process.stdout.write(p.agent?.screen || p.screen || ""); process.exit(0); }
  if (verb === "report-metadata") { st.metadata.push({ pane: p.pane_id, args: argv.slice(3) }); ok({ type: "ok" }); }
}
if (area === "agent") {
  if (verb === "get" && st.agentGetFails) fail("timeout", "timed out"); // a test's stand-in for a lookup herdr did not answer
  if (verb === "list") ok({ type: "agent_list", agents: st.panes.filter((p) => p.agent).map(agentOut) });
  if (verb === "start") {
    const p = findPane(flag("--pane"));
    if (!p) fail("pane_not_found", "pane not found");
    if (p.agent) fail("pane_busy", "the pane is not at its shell prompt");
    const kind = flag("--kind"), i = argv.indexOf("--");
    st.seq += 1;
    p.agent = { kind, name: argv[2], status: "idle", seq: st.seq, args: i >= 0 ? argv.slice(i + 1) : [] };
    if ((st.dialogs[kind] || 0) > 0) { st.dialogs[kind] -= 1; p.agent.status = "blocked"; fail("agent_not_ready", `agent ${argv[2]} is blocked during startup and is not ready for prompts`); }
    ok({ type: "agent_started", agent: agentOut(p) });
  }
  const p = findAgent(argv[2]);
  if (!p) fail("agent_not_found", `agent target ${argv[2]} not found`);
  if (verb === "get") ok({ type: "agent_info", agent: agentOut(p) });
  if (verb === "prompt") { if (p.agent.status === "blocked") fail("agent_blocked", "agent is blocked"); play(p, argv[3]); ok({ type: "agent_prompted", agent: p.agent ? agentOut(p) : null }); }
  if (verb === "send-keys") {
    (p.agent.keys ||= []).push(...argv.slice(3));
    if (p.agent.status === "blocked" && argv.slice(3).includes("enter")) bump(p, "idle", true); // answering a dialog counts as a completion, as Codex does
    else if (argv.slice(3).includes("esc") && p.agent.status === "working") bump(p, "idle", true);
    ok({ type: "ok" });
  }
  if (verb === "focus") { st.focus.push(`agent ${p.pane_id}`); ok({ type: "agent_info", agent: agentOut(p) }); }
  if (verb === "read") { save(); process.stdout.write(p.agent.screen || ""); process.exit(0); }
}
if (area === "notification") { st.notifications.push({ title: argv[2], body: flag("--body") || "" }); ok({ type: "notification_show", shown: true }); }
if (area === "plugin" && verb === "pane") { st.focus.push("board"); ok({ type: "ok" }); }
if (area === "machine") { save(); process.stdout.write(JSON.stringify(read(path.join(dir, "machines.json"), [])) + "\n"); process.exit(0); }
fail("unknown_command", `fake herdr does not know: ${argv.join(" ")}`);
