// The only file that runs the herdr binary. JSON in, JSON out.
//
// Verified on herdr 0.9.3 (see README "What was checked on herdr"):
//   - ids (workspace, tab, pane) survive a server restart; terminal_id does not
//   - agent get: state_change_seq always; completion_seq only after a first finished turn; agent_session only with
//     an official integration installed
//   - a pane whose agent exited answers agent_not_found to `agent get`, and `pane get` shows agent: null
//   - `agent start` answers agent_not_ready when a dialog blocks the start; `agent prompt` answers agent_blocked
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export class HerdrError extends Error {
  constructor(code, message, args) { super(message || code); this.code = code; this.args = args; }
}
const bin = () => process.env.HERDR_BIN_PATH || "herdr";
// The session a plain command talks to: the pane it runs in, else the default session.
export function currentSocket() {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH;
  const base = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "herdr");
  return process.env.HERDR_SESSION ? path.join(base, "sessions", process.env.HERDR_SESSION, "herdr.sock") : path.join(base, "herdr.sock");
}
export const sessionName = (socket) => { const m = /\/sessions\/([^/]+)\/herdr\.sock$/.exec(String(socket || "")); return m ? m[1] : "default"; };
export const inHerdr = () => process.env.HERDR_ENV === "1";

function run(socket, args, { timeout = 30000, raw = false, input } = {}) {
  const env = { ...process.env };
  // Never let the caller's own pane leak in as an implicit target: every command names its pane.
  delete env.HERDR_PANE_ID; delete env.HERDR_TAB_ID; delete env.HERDR_WORKSPACE_ID; delete env.HERDR_SESSION;
  if (socket) env.HERDR_SOCKET_PATH = socket;
  const r = spawnSync(bin(), args, { encoding: "utf8", env, timeout, input, maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw new HerdrError(r.error.code === "ENOENT" ? "herdr_missing" : r.error.code === "ETIMEDOUT" ? "timeout" : "spawn_failed", r.error.code === "ENOENT" ? "The herdr program was not found." : r.error.message, args);
  if (r.status !== 0) {
    let code = "failed", message = String(r.stderr || r.stdout || "").trim();
    for (const text of [r.stderr, r.stdout]) {
      try { const j = JSON.parse(String(text).trim().split("\n").pop()); if (j.error) { code = j.error.code || code; message = j.error.message || message; break; } } catch {}
    }
    if (code === "server_not_running" || (code === "failed" && /no such file|connection refused|not running|failed to connect/i.test(message))) code = "no_server";
    throw new HerdrError(code, message || `herdr ${args.join(" ")} failed`, args);
  }
  if (raw) return r.stdout;
  try { const j = JSON.parse(r.stdout); if (j.error) throw new HerdrError(j.error.code, j.error.message, args); return j.result ?? j; }
  catch (e) { if (e instanceof HerdrError) throw e; return { text: r.stdout }; }
}

// An API bound to one herdr session (by socket path). `null` means "whatever this process would talk to".
export function herdr(socket = null) {
  const call = (args, opts) => run(socket, args, opts);
  const quiet = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
  return {
    socket: socket || currentSocket(),
    call,
    alive() { try { call(["workspace", "list"], { timeout: 5000 }); return true; } catch { return false; } },
    // ---- layout
    workspaces: () => call(["workspace", "list"]).workspaces || [],
    workspaceGet: (id) => quiet(() => call(["workspace", "get", id]).workspace),
    workspaceCreate: ({ cwd, label, env = {} }) => call(["workspace", "create", "--cwd", cwd, ...(label ? ["--label", label] : []), ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]), "--no-focus"]),
    workspaceClose: (id) => call(["workspace", "close", id]),
    workspaceFocus: (id) => call(["workspace", "focus", id]),
    tabFocus: (id) => call(["tab", "focus", id]),
    worktreeCreate: ({ cwd, branch, base, label }) => call(["worktree", "create", "--cwd", cwd, "--branch", branch, ...(base ? ["--base", base] : []), ...(label ? ["--label", label] : []), "--no-focus"], { timeout: 120000 }),
    worktreeOpen: ({ cwd, path: p, label }) => call(["worktree", "open", "--cwd", cwd, "--path", p, ...(label ? ["--label", label] : []), "--no-focus"], { timeout: 60000 }),
    worktreeRemove: (workspace, force = false) => call(["worktree", "remove", "--workspace", workspace, ...(force ? ["--force"] : [])], { timeout: 120000 }),
    // ---- panes
    panes: (workspace) => call(["pane", "list", ...(workspace ? ["--workspace", workspace] : [])]).panes || [],
    paneGet: (id) => quiet(() => call(["pane", "get", id]).pane),
    // Where a pane sits in herdr's own window: its tab's area, every pane's rect, and whether one is zoomed.
    paneLayout: (id) => quiet(() => call(["pane", "layout", "--pane", id], { timeout: 3000 }).layout),
    paneSplit: (id, { cwd, direction = "right", env = {} } = {}) => call(["pane", "split", id, "--direction", direction, ...(cwd ? ["--cwd", cwd] : []), ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]), "--no-focus"]).pane,
    // Is nothing but its shell running in the pane? Unknown counts as busy.
    paneIdle: (id) => quiet(() => { const i = call(["pane", "process-info", "--pane", id]).process_info; return Number.isInteger(i.shell_pid) && i.foreground_process_group_id === i.shell_pid && (i.foreground_processes || []).every((p) => p.pid === i.shell_pid) && spawnSync("pgrep", ["-P", String(i.shell_pid)], { stdio: "ignore" }).status === 1; }, false),
    // Does nothing run in the pane but the program in its foreground (and the shell that started it)? No tool or
    // command under that program, and no background job of the shell beside it. Unknown counts as no.
    paneChildless: (id) => quiet(() => {
      const i = call(["pane", "process-info", "--pane", id]).process_info;
      const front = (i.foreground_processes || []).map((p) => p.pid).filter(Number.isInteger);
      if (!front.length) return false;
      const kids = (pid) => { const r = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }); if (r.error || r.status > 1) throw new Error("pgrep failed"); return r.stdout.split("\n").map(Number).filter(Boolean); };
      if (front.some((pid) => kids(pid).length)) return false;
      return !Number.isInteger(i.shell_pid) || kids(i.shell_pid).every((pid) => front.includes(pid));
    }, false),
    paneClose: (id) => quiet(() => call(["pane", "close", id])),
    paneRead: (id, { source = "visible", lines } = {}) => call(["pane", "read", id, "--source", source, ...(lines ? ["--lines", String(lines)] : [])], { raw: true }),
    metadata: (id, args) => quiet(() => call(["pane", "report-metadata", id, "--source", "plugin:herdr-superwork", ...args])),
    // ---- agents
    agents: () => call(["agent", "list"]).agents || [],
    // The agent in a pane (or by name), or null when no agent is there.
    agentGet(target) {
      try { return call(["agent", "get", target]).agent; }
      catch (e) { if (["agent_not_found", "not_found", "agent_not_running", "pane_not_found"].includes(e.code)) return null; throw e; }
    },
    agentStart: (name, kind, pane, args = [], timeout = 60000) => call(["agent", "start", name, "--kind", kind, "--pane", pane, "--timeout", String(timeout), ...(args.length ? ["--", ...args] : [])], { timeout: timeout + 15000 }).agent,
    agentPrompt: (target, text) => call(["agent", "prompt", target, text], { timeout: 60000 }),
    agentKeys: (target, ...keys) => call(["agent", "send-keys", target, ...keys]),
    agentFocus: (target) => call(["agent", "focus", target]),
    agentRead: (target, { source = "visible", lines } = {}) => call(["agent", "read", target, "--source", source, ...(lines ? ["--lines", String(lines)] : [])], { raw: true, timeout: 60000 }),
    // ---- the rest
    openBoard: () => call(["plugin", "pane", "open", "--plugin", "herdr-superwork", "--entrypoint", "board"]),
    machines: () => quiet(() => { const j = JSON.parse(run(null, ["machine", "list", "--json"], { raw: true })); return Array.isArray(j) ? j : j.machines || j.result?.machines || []; }, []),
  };
}
const oneLineFor = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n) || "-";

// Reading a terminal. A deep read is only possible (and only harmless) when the agent is idle or done: in any other
// status herdr refuses it and it would scroll the agent's own view, so only the visible screen is read.
export function readScreen(h, pane, status, lines = 120) {
  try {
    if (status === "idle" || status === "done") return h.agentRead(pane, { source: "recent-unwrapped", lines });
    if (status == null) return h.paneRead(pane, { source: "visible" }); // no agent left in the pane
    return h.agentRead(pane, { source: "visible" });
  } catch (e) {
    if (e.code === "agent_not_idle") { try { return h.agentRead(pane, { source: "visible" }); } catch {} }
    try { return h.paneRead(pane, { source: "visible" }); } catch { return ""; }
  }
}
export const socketExists = (socket) => { try { return fs.statSync(socket).isSocket(); } catch { return false; } };
