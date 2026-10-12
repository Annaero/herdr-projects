// The only file that runs the herdr binary. JSON in, JSON out.
//
// Verified on herdr 0.9.3 (see docs/checked-on-herdr.md):
//   - ids (workspace, tab, pane) survive a server restart; terminal_id does not
//   - agent get: state_change_seq always; completion_seq only after a first finished turn; agent_session only with
//     an official integration installed
//   - a pane whose agent exited answers agent_not_found to `agent get`, and `pane get` shows agent: null
//   - `agent start` answers agent_not_ready when a dialog blocks the start; `agent prompt` answers agent_blocked
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export class HerdrError extends Error {
  constructor(code, message, args) { super(message || code); this.code = code; this.args = args; }
}
const bin = () => process.env.HERDR_BIN_PATH || "herdr";
// The one place the program is started. Tests may answer for one program path themselves (`globalThis.__swHerdr`: its
// `bin`, and `run(args, env)` giving what the program would: status, stdout, stderr), so that a test's hundreds of calls
// are not hundreds of programs; any other path is started as always.
const launch = (args, opts) => { const own = globalThis.__swHerdr; return own && own.bin === bin() ? own.run(args, opts.env) : spawnSync(bin(), args, opts); };
// The processes started by one process. Tests answer this too (`kids` beside `run`): pgrep reads every process there is.
const kids = (pid) => {
  const own = globalThis.__swHerdr;
  if (own?.kids && own.bin === bin()) return own.kids(pid);
  const r = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  if (r.error || r.status > 1) throw new Error("pgrep failed");
  return r.stdout.split("\n").map(Number).filter(Boolean);
};
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
  const r = launch(args, { encoding: "utf8", env, timeout, input, maxBuffer: 32 * 1024 * 1024 });
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

// The size herdr shows a pane at, from `pane layout`: its rectangle, or the whole tab while it is the zoomed one. With other
// panes beside it the borders are inside that rectangle (checked on 0.9.3: two rows and up to three columns).
export function shownOf(layout, pane) {
  const panes = layout?.panes || [], mine = panes.find((p) => p.pane_id === pane);
  // Zooming a pane focuses it: only the focused pane has the tab, the hidden ones keep their place and their size.
  const r = mine && (layout.zoomed && layout.focused_pane_id === pane && layout.area ? layout.area : mine.rect);
  return r && r.width > 0 && r.height > 0 ? { cols: r.width, rows: r.height, split: panes.length > 1 } : null;
}
// Asked without blocking: the board asks this again and again while it is open. `cb(null)` when herdr does not say.
export function paneShown(socket, pane, cb) {
  const env = { ...process.env };
  delete env.HERDR_PANE_ID; delete env.HERDR_TAB_ID; delete env.HERDR_WORKSPACE_ID; delete env.HERDR_SESSION;
  if (socket) env.HERDR_SOCKET_PATH = socket;
  let out = "", done = false;
  const end = (v) => { if (!done) { done = true; cb(v); } };
  try {
    const c = spawn(bin(), ["pane", "layout", "--pane", pane], { env, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
    c.stdout.on("data", (d) => { out += d; });
    c.on("error", () => end(null));
    c.on("close", () => { try { end(shownOf(JSON.parse(out).result?.layout, pane)); } catch { end(null); } });
  } catch { end(null); }
}

// Takes a pane's terminal back from whatever else is attached to it: the other viewer is disconnected ("terminal attach
// taken over"), and as this one leaves at once herdr gives the terminal the size it shows the pane at (checked on 0.9.3).
export function takeTerminal(socket, pane, { cols, rows }) {
  const id = run(socket, ["pane", "get", pane], { timeout: 5000 }).pane?.terminal_id;
  if (!id) throw new HerdrError("pane_not_found", "herdr does not know this pane.", [pane]);
  run(socket, ["terminal", "session", "control", id, "--takeover", "--cols", String(cols), "--rows", String(rows)], { timeout: 5000, raw: true, input: "" });
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
    // A new tab in a space, with one pane at its shell: { tab, root_pane }. Never focused: the human stays where they are.
    tabCreate: ({ workspace, cwd, label, env = {} }) => call(["tab", "create", "--workspace", workspace, ...(cwd ? ["--cwd", cwd] : []), ...(label ? ["--label", label] : []), ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]), "--no-focus"]),
    tabRename: (id, label) => call(["tab", "rename", id, label]),
    tabClose: (id) => quiet(() => call(["tab", "close", id])),
    worktreeCreate: ({ cwd, branch, base, label }) => call(["worktree", "create", "--cwd", cwd, "--branch", branch, ...(base ? ["--base", base] : []), ...(label ? ["--label", label] : []), "--no-focus"], { timeout: 120000 }),
    worktreeOpen: ({ cwd, path: p, label }) => call(["worktree", "open", "--cwd", cwd, "--path", p, ...(label ? ["--label", label] : []), "--no-focus"], { timeout: 60000 }),
    worktreeRemove: (workspace, force = false) => call(["worktree", "remove", "--workspace", workspace, ...(force ? ["--force"] : [])], { timeout: 120000 }),
    // ---- panes
    panes: (workspace) => call(["pane", "list", ...(workspace ? ["--workspace", workspace] : [])]).panes || [],
    paneGet: (id) => quiet(() => call(["pane", "get", id]).pane),
    // Where a pane sits in herdr's own window: its tab's area, every pane's rect, and whether one is zoomed.
    paneLayout: (id) => quiet(() => call(["pane", "layout", "--pane", id], { timeout: 3000 }).layout),
    // Put the keyboard on one pane of the tab that shows (herdr 0.9.3 has no "focus this pane": only "focus the
    // neighbour of"). Zooming a pane focuses it, so: zoom it, and take the zoom off again unless the tab was zoomed.
    paneFocus(id) {
      const before = this.paneLayout(id);
      if (!before || before.focused_pane_id === id) return;
      call(["pane", "zoom", id, "--on"]);
      if (!before.zoomed) quiet(() => call(["pane", "zoom", id, "--off"]));
    },
    paneSplit: (id, { cwd, direction = "right", env = {} } = {}) => call(["pane", "split", id, "--direction", direction, ...(cwd ? ["--cwd", cwd] : []), ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]), "--no-focus"]).pane,
    // Is nothing but its shell running in the pane? Unknown counts as busy.
    paneIdle: (id) => quiet(() => { const i = call(["pane", "process-info", "--pane", id]).process_info; return Number.isInteger(i.shell_pid) && i.foreground_process_group_id === i.shell_pid && (i.foreground_processes || []).every((p) => p.pid === i.shell_pid) && !kids(i.shell_pid).length; }, false),
    // Does nothing run in the pane but the program in its foreground (and the shell that started it)? No tool or
    // command under that program, and no background job of the shell beside it. Unknown counts as no.
    paneChildless: (id) => quiet(() => {
      const i = call(["pane", "process-info", "--pane", id]).process_info;
      const front = (i.foreground_processes || []).map((p) => p.pid).filter(Number.isInteger);
      if (!front.length) return false;
      if (front.some((pid) => kids(pid).length)) return false;
      return !Number.isInteger(i.shell_pid) || kids(i.shell_pid).every((pid) => front.includes(pid));
    }, false),
    paneClose: (id) => quiet(() => call(["pane", "close", id])),
    // End the program in the pane's foreground (an agent that will not take its text), so the pane is at its shell
    // again. True once herdr sees no agent there.
    paneQuit(id, waitMs = 6000) {
      const gone = () => { try { return !this.agentGet(id); } catch { return false; } };
      const info = quiet(() => call(["pane", "process-info", "--pane", id]).process_info);
      const pids = (info?.foreground_processes || []).map((p) => p.pid).filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== info.shell_pid);
      for (const sig of ["SIGTERM", "SIGKILL"]) {
        if (!pids.length || gone()) break;
        for (const pid of pids) { try { (globalThis.__swHerdr?.kill || process.kill)(pid, sig); } catch {} }
        for (const until = Date.now() + waitMs / 2; Date.now() < until && !gone(); ) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
      return gone();
    },
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
    // The board in a tab of its own, an ordinary pane that stays when you go elsewhere. Answers that pane.
    openBoard: () => call(["plugin", "pane", "open", "--plugin", "herdr-superwork", "--entrypoint", "board", "--placement", "tab"]).plugin_pane?.pane || null,
    tabRename: (id, label) => quiet(() => call(["tab", "rename", id, label])),
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
