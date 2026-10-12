#!/usr/bin/env node
// A stand-in for the herdr binary, for tests: no server, no terminals, no model calls. Its whole world is one JSON
// file in $HERDR_FAKE_DIR. Agents are scripted: each `agent prompt` plays the next step of $HERDR_FAKE_DIR/script.json
// for that role (worker, or reviewer when the agent's name ends in -r).
//
// Two ways in, one body: run as a program (test/bin/herdr), or called as `herdr(argv, env)` by the test's own process,
// which is what test/helpers.js sets up, because launching node for each of a test's hundreds of calls was most of
// the suite's time. Both answer what the program would: { status, stdout, stderr }. test/fake-herdr.test.js holds them
// to the same answers.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

class Exit { constructor(status, stdout = "", stderr = "") { Object.assign(this, { status, stdout, stderr }); } }
export function herdr(argv, env = process.env) {
  try { answer(argv, env); } catch (e) { return e instanceof Exit ? e : new Exit(1, "", `${e?.stack || e}\n`); } // an error of its own: what node prints as it dies
}
function answer(argv, env) {
  const dir = env.HERDR_FAKE_DIR;
  const file = path.join(dir, "state.json");
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
  const st = read(file, { seq: 0, nextW: 1, nextP: 100, workspaces: [], panes: [], notifications: [], metadata: [], focus: [], calls: [], dialogs: {} });
  const save = () => fs.writeFileSync(file, JSON.stringify(st, null, 2));
  st.calls.push(argv.join(" ").slice(0, 300));
  const out = (text) => { save(); throw new Exit(0, text); };
  const ok = (result) => out(JSON.stringify({ id: "fake", result }) + "\n");
  const fail = (code, message) => { save(); throw new Exit(1, "", JSON.stringify({ id: "fake", error: { code, message: message || code } }) + "\n"); };
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (name) => argv.includes(name);
  const envOf = () => Object.fromEntries(argv.flatMap((a, i) => (a === "--env" ? [argv[i + 1].split(/=(.*)/s).slice(0, 2)] : [])));
  const git = (cwd, args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

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
    return { workspace: wsOut(w), tab: tabOut(newTab(w, p.tab_id, "1")), root_pane: paneOut(p) };
  }
  // Tabs: a space starts with one, labelled "1" as herdr's are; a tab's number is never given out again.
  const tabs = () => (st.tabs ||= []);
  const tabOut = (t) => ({ tab_id: t.tab_id, workspace_id: t.workspace_id, label: t.label, pane_count: st.panes.filter((p) => p.tab_id === t.tab_id).length, focused: t.tab_id === `${t.workspace_id}:t1` });
  function newTab(w, id, label) { w.nextT = Math.max(w.nextT || 1, Number(id.split(":t")[1]) + 1); const t = { tab_id: id, workspace_id: w.workspace_id, label }; tabs().push(t); return t; }
  // A pane closed (or gone with its space): a tab with no pane left is gone too.
  const dropEmptyTabs = () => { st.tabs = tabs().filter((t) => st.panes.some((p) => p.tab_id === t.tab_id)); };
  const findPane = (id) => st.panes.find((p) => p.pane_id === id);
  const findAgent = (target) => st.panes.find((p) => p.agent && (p.pane_id === target || p.agent.name === target));
  const bump = (p, status, complete) => { st.seq += 1; p.agent.status = status; p.agent.seq = st.seq; if (complete) p.agent.completion = st.seq; };

  // A step's `ends`: the name of a recorded ending in test/fixtures/endings (the last lines of a real saved conversation).
  // They are appended, with times of now, to this agent's own conversation file, where its program would keep it; the
  // first time, after the lines that open such a file. `hook`: the agent's own turn-end report is run too.
  const here = path.dirname(fileURLToPath(import.meta.url));
  function endTurn(p, prompt, step) {
    const kind = p.agent.kind, real = fs.realpathSync(p.cwd), now = () => new Date().toISOString();
    const arg = (...names) => { const i = p.agent.args.findIndex((a) => names.includes(a)); return i >= 0 ? p.agent.args[i + 1] : ""; };
    let file = "", id = "", open = [];
    if (kind === "claude") { id = arg("--session-id", "--resume"); file = path.join(env.CLAUDE_CONFIG_DIR, "projects", real.replace(/[^A-Za-z0-9]/g, "-"), `${id}.jsonl`); open = [{ type: "user", uuid: `u${st.seq}`, timestamp: now(), message: { role: "user", content: prompt } }]; }
    else if (kind === "codex") {
      id = p.agent.thread ||= `thread-${p.pane_id.replace(/\W/g, "")}-${st.seq}`;
      file = path.join(env.CODEX_HOME, "sessions", "2026", `rollout-2026-${id}.jsonl`);
      open = [...(fs.existsSync(file) ? [] : [{ timestamp: now(), type: "session_meta", payload: { id, cwd: real, source: "cli" } }]), { timestamp: now(), type: "event_msg", payload: { type: "task_started" } }, { timestamp: now(), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] } }];
    } else if (kind === "pi") { id = arg("--session-id"); file = path.join(env.PI_CODING_AGENT_DIR, "sessions", "x", `2026_${id}.jsonl`); open = [...(fs.existsSync(file) ? [] : [{ type: "session", id, cwd: real, timestamp: now() }]), { type: "message", id: `u${st.seq}`, timestamp: now(), message: { role: "user", content: [{ type: "text", text: prompt }] } }]; }
    else return;
    const lines = step.ends ? fs.readFileSync(path.join(here, "fixtures", "endings", `${step.ends}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const at = Date.now() + 1500; // a while after the prompt was sent, as the real ones are (the sender notes the time once herdr has answered)
    fs.appendFileSync(file, [...open, ...lines].map((l, i) => JSON.stringify({ ...l, timestamp: new Date(at + i).toISOString() }) + "\n").join(""));
    if (!step.hook) return;
    const task = (/^Work board task (\S+), role: (\w+)(?:, round (\d+))?\./.exec(p.agent.prompts[0]) || []);
    const role = task[2] === "reviewer" ? "reviewer" : "agent", round = task[3] || "0";
    const tokens = read(path.join(env.HERDR_SUPERWORK_DATA_DIR, "tasks", ...task[1].split("/"), "tokens.json"), {});
    const flags = { id: task[1], role, token: role === "reviewer" ? tokens.reviewer?.[round] : tokens.agent, round };
    // Claude and pi say it on stdin, Codex as a last argument.
    const says = kind === "codex" ? { "thread-id": id, "input-messages": [p.agent.prompts[0]] } : kind === "claude" ? { session_id: id, transcript_path: file } : { transcript_path: file };
    // Called in the test's own process, the report is too (test/helpers.js passes the function): no program is started.
    const own = globalThis.__swHerdr?.turnEnded;
    if (own && env.HERDR_SUPERWORK_DATA_DIR === process.env.HERDR_SUPERWORK_DATA_DIR) return void own(flags, [JSON.stringify(says)]);
    const cmd = [path.join(here, "..", "bin", "herdr-superwork.js"), "turn-ended", "--id", flags.id, "--role", role, "--token", flags.token, ...(role === "reviewer" ? ["--round", round] : [])];
    if (kind === "codex") execFileSync(process.execPath, [...cmd, JSON.stringify(says)], { env, stdio: "ignore" });
    else execFileSync(process.execPath, cmd, { input: JSON.stringify(says), env, stdio: ["pipe", "ignore", "ignore"] });
  }

  // One scripted turn. Steps: { merge: "commit to merge first", files: {path: text}, commit: "message", note: "closing note", verdict: {...},
  // status: "done" | "unknown" | "blocked" | "working", session: "id", screen: "text" }
  function play(p, prompt) {
    const script = read(path.join(dir, "script.json"), {});
    // The Coordinator: no task, no closing note. A step may say something, which lands in its saved conversation as
    // Claude Code would write it: { said: "text", status, screen }.
    if (/^sw-coordinator/.test(p.agent.name)) {
      const queue = script.coordinator || [];
      const step = queue.shift() || {};
      fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify({ ...script, coordinator: queue }));
      (p.agent.prompts ||= []).push(prompt);
      bump(p, "working", false);
      const at = p.agent.args.findIndex((a) => a === "--session-id" || a === "--resume");
      if (step.said && at >= 0 && env.CLAUDE_CONFIG_DIR) {
        const file = path.join(env.CLAUDE_CONFIG_DIR, "projects", fs.realpathSync(p.cwd).replace(/[^A-Za-z0-9]/g, "-"), `${p.agent.args[at + 1]}.jsonl`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify({ type: "user", message: { role: "user", content: prompt }, timestamp: new Date().toISOString() }) + "\n"
          + JSON.stringify({ type: "assistant", uuid: `u${st.seq}`, message: { id: `msg_${st.seq}`, role: "assistant", content: [{ type: "text", text: step.said }], stop_reason: "end_turn" }, timestamp: new Date().toISOString() }) + "\n");
      }
      if (step.screen) p.agent.screen = step.screen;
      const status = step.status || "done";
      if (status !== "working") bump(p, status, status === "done" || status === "idle");
      return;
    }
    const role = /-r(-\d+)?$/.test(p.agent.name) ? "reviewer" : "worker";
    const n = (p.agent.name.match(/-(\d+)(?:-[0-9a-f]{4})?(?:-r(?:-\d+)?)?$/) || [])[1];
    const queue = script[role] || [];
    const step = queue.shift() || (role === "reviewer" ? { verdict: { meets: true, findings: [], text: "Looks right. Nothing found." } } : { note: "Done." });
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
    if (step.ends || step.hook) endTurn(p, prompt, step);
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
    if (verb === "close") { st.workspaces = st.workspaces.filter((x) => x !== w); st.panes = st.panes.filter((p) => p.workspace_id !== w.workspace_id); dropEmptyTabs(); ok({ type: "ok" }); }
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
      st.workspaces = st.workspaces.filter((x) => x !== w); st.panes = st.panes.filter((p) => p.workspace_id !== w.workspace_id); dropEmptyTabs();
      ok({ type: "worktree_removed" });
    }
  }
  if (area === "tab" && verb === "focus") { st.focus.push(`tab ${argv[2]}`); ok({ type: "ok" }); }
  if (area === "tab") {
    if (verb === "list") { const w = flag("--workspace"); ok({ type: "tab_list", tabs: tabs().filter((t) => !w || t.workspace_id === w).map(tabOut) }); }
    // A new tab is one pane at its shell. It is never the focused one: the first tab of a space stays that.
    if (verb === "create") {
      const w = st.workspaces.find((x) => x.workspace_id === flag("--workspace"));
      if (!w) fail("workspace_not_found", `workspace ${flag("--workspace")} not found`);
      if (st.tabFails) fail("timeout", "timed out"); // a test's stand-in for a tab herdr did not open
      const n = Math.max(w.nextT || 2, 2), t = newTab(w, `${w.workspace_id}:t${n}`, flag("--label") || String(n));
      const q = { pane_id: `${w.workspace_id}:p${st.panes.filter((x) => x.workspace_id === w.workspace_id).length + 1}`, workspace_id: w.workspace_id, tab_id: t.tab_id, terminal_id: `term_${st.nextP++}`, cwd: path.resolve(flag("--cwd") || w.cwd), env: envOf(), agent: null };
      while (findPane(q.pane_id)) q.pane_id += "x";
      st.panes.push(q);
      ok({ type: "tab_created", tab: tabOut(t), root_pane: paneOut(q) });
    }
    const t = tabs().find((x) => x.tab_id === argv[2]);
    if (!t) fail("tab_not_found", `tab ${argv[2]} not found`);
    if (verb === "get") ok({ type: "tab_info", tab: tabOut(t) });
    if (verb === "rename") { t.label = argv.slice(3).join(" "); ok({ type: "tab_info", tab: tabOut(t) }); }
    if (verb === "close") { st.panes = st.panes.filter((p) => p.tab_id !== t.tab_id); dropEmptyTabs(); ok({ type: "ok" }); }
  }
  if (area === "pane") {
    if (verb === "process-info") { const p = findPane(flag("--pane")); if (!p) fail("pane_not_found", "pane not found"); const shell = 4194400; ok({ type: "pane_process_info", process_info: { pane_id: p.pane_id, shell_pid: p.job ? 1 : shell, /* `job`: the shell has a background job beside the foreground program */ foreground_process_group_id: p.busy ? shell + 1 : shell, foreground_processes: [{ pid: st.pids && p.agent ? p.agent.pid /* `pids`: an agent is a process of its own, which can be ended */ : p.tool ? 1 : p.busy ? shell + 1 : shell, name: p.tool ? "agent" : p.busy ? "sleep" : "bash" }] } }); } // `tool`: a program with children of its own (pid 1 always has some)
    // `layouts`: a test's own answer per pane; without one the pane has its whole tab, 120x34.
    if (verb === "layout") { const p = findPane(flag("--pane")); if (!p) fail("pane_not_found", "pane not found"); const area = { x: 0, y: 0, width: 120, height: 34 }; ok({ type: "pane_layout", layout: st.layouts?.[p.pane_id] || { area, zoomed: false, focused_pane_id: p.pane_id, panes: [{ pane_id: p.pane_id, focused: true, rect: area }], splits: [], tab_id: p.tab_id, workspace_id: p.workspace_id } }); }
    if (verb === "list") { const w = flag("--workspace"); ok({ type: "pane_list", panes: st.panes.filter((p) => !w || p.workspace_id === w).map(paneOut) }); }
    const p = findPane(argv[2]);
    if (!p) fail("pane_not_found", `pane ${argv[2]} not found`);
    if (verb === "get") ok({ type: "pane_info", pane: paneOut(p) });
    // Zooming a pane focuses it; taking the zoom off leaves the focus there.
    if (verb === "zoom") { const on = argv.includes("--on"); if (on) st.focus.push(`pane ${p.pane_id}`); const l = st.layouts?.[p.pane_id]; if (l) { l.zoomed = on; if (on) l.focused_pane_id = p.pane_id; } ok({ type: "pane_zoom", zoom: { pane_id: p.pane_id, zoomed: on, focused_pane_id: p.pane_id } }); }
    if (verb === "split") { const n = st.panes.filter((x) => x.workspace_id === p.workspace_id).length + 1; const q = { pane_id: `${p.workspace_id}:p${n}`, workspace_id: p.workspace_id, tab_id: p.tab_id, terminal_id: `term_${st.nextP++}`, cwd: path.resolve(flag("--cwd") || p.cwd), env: envOf(), agent: null }; while (findPane(q.pane_id)) q.pane_id += "x"; st.panes.push(q); ok({ type: "pane_split", pane: paneOut(q) }); }
    if (verb === "close") { st.panes = st.panes.filter((x) => x !== p); dropEmptyTabs(); ok({ type: "ok" }); }
    if (verb === "read" && p.agent?.boot > 0) { p.agent.boot -= 1; out(`user@host:${p.cwd}$ ${[p.agent.kind, ...p.agent.args].join(" ")}\n`); } // not drawn yet: only the command that started it
    if (verb === "read") out(p.agent?.screen || p.screen || "");
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
      // `slowStart`: a program that herdr calls ready before it has drawn anything. For that many looks at its pane the
      // screen is still the command that started it, and text typed meanwhile stays in its box with the enter lost.
      p.agent = { kind, name: argv[2], status: "idle", seq: st.seq, args: i >= 0 ? argv.slice(i + 1) : [], pid: 5000000 + st.seq, ...(st.slowStart ? { boot: st.slowStart } : {}) };
      if ((st.dialogs[kind] || 0) > 0) { st.dialogs[kind] -= 1; p.agent.status = "blocked"; fail("agent_not_ready", `agent ${argv[2]} is blocked during startup and is not ready for prompts`); }
      ok({ type: "agent_started", agent: agentOut(p) });
    }
    const p = findAgent(argv[2]);
    if (!p) fail("agent_not_found", `agent target ${argv[2]} not found`);
    if (verb === "get") ok({ type: "agent_info", agent: agentOut(p) });
    if (verb === "prompt") {
      if (p.agent.status === "blocked") fail("agent_blocked", "agent is blocked");
      // Typed text lands in the box, on top of whatever sits there unsent. `swallow`: the next so many prompts lose
      // their enter, as every prompt does while the program is still starting.
      const text = p.agent.box != null ? `${p.agent.box}\n${argv[3]}` : argv[3];
      if (p.agent.boot > 0 || st.swallow > 0) { if (!(p.agent.boot > 0)) st.swallow -= 1; p.agent.box = text; ok({ type: "agent_prompted", agent: agentOut(p) }); }
      p.agent.box = null;
      play(p, text);
      ok({ type: "agent_prompted", agent: p.agent ? agentOut(p) : null });
    }
    if (verb === "send-keys") {
      (p.agent.keys ||= []).push(...argv.slice(3));
      // Enter with text in the box submits it; `deaf`: so many enters do nothing at all.
      if (p.agent.box != null && argv.slice(3).includes("enter")) { if (st.deaf > 0) st.deaf -= 1; else { const text = p.agent.box; p.agent.box = null; play(p, text); } ok({ type: "ok" }); }
      if (p.agent.status === "blocked" && argv.slice(3).includes("enter")) bump(p, "idle", true); // answering a dialog counts as a completion, as Codex does
      else if (argv.slice(3).includes("esc") && p.agent.status === "working") bump(p, "idle", true);
      ok({ type: "ok" });
    }
    if (verb === "focus") { st.focus.push(`agent ${p.pane_id}`); ok({ type: "agent_info", agent: agentOut(p) }); }
    if (verb === "read") out(p.agent.screen || "");
  }
  if (area === "notification") { st.notifications.push({ title: argv[2], body: flag("--body") || "" }); ok({ type: "notification_show", shown: true }); }
  // The board is opened in a tab of its own: an ordinary pane, in the first space there is (herdr: the one that shows).
  // `--placement popup`: herdr's popup, which is no pane.
  if (area === "plugin" && verb === "pane") {
    st.focus.push("board"); st.boardPlacement = flag("--placement") || "popup";
    const w = st.workspaces[0];
    if (st.boardPlacement !== "tab" || !w) ok({ type: "ok" });
    const n = Math.max(w.nextT || 2, 2), t = newTab(w, `${w.workspace_id}:t${n}`, String(n));
    const q = { pane_id: `${w.workspace_id}:board`, workspace_id: w.workspace_id, tab_id: t.tab_id, terminal_id: `term_${st.nextP++}`, cwd: w.cwd, agent: null, label: "Work board" };
    while (findPane(q.pane_id)) q.pane_id += "x";
    st.panes.push(q);
    ok({ type: "plugin_pane_opened", plugin_pane: { entrypoint: "board", plugin_id: "herdr-superwork", pane: paneOut(q) } });
  }
  if (area === "machine") out(JSON.stringify(read(path.join(dir, "machines.json"), [])) + "\n");
  fail("unknown_command", `fake herdr does not know: ${argv.join(" ")}`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = herdr(process.argv.slice(2));
  process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exitCode = r.status;
}
