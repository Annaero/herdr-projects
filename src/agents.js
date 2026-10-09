// Everything agent-specific lives in this one table. Every entry is optional and has a stated fallback, so any
// `herdr agent start --kind` value works as a worker or reviewer:
//   args        default arguments after `--` (full access, as pi-work's agents had)  none: the agent keeps its prompts
//   resume      arguments that reopen a conversation by id                          none: starts fresh
//   model       arguments that choose a model                                       none: the agent's default
//   effort      arguments that choose an effort level                               none: the agent's default
//   interrupt   the key that stops a turn                                           none: esc
//   oneShot     a headless command for the hidden helpers                           none: cannot be a helper
//   allow       restrict a one-shot helper to herdr-superwork commands              none: cannot be the Coordinator
//   trust       mark a repo as trusted in the agent's own settings                  none: its trust dialog waits for you
//   minVersion  the oldest program version its turn-end hook was verified on        older: runs without the hook
//   hookArgs    launch arguments that make it call `turn-ended` at every turn end   none: the closing note and herdr's status
//   sessionArgs launch arguments that choose the conversation's id                  none: the id comes from the hook or the file
//   standing    launch arguments that keep the rules in force for the whole session none: rules ride on every prompt
//   transcript  where a conversation is saved                                       none: nothing is read
//   readTurn    the end of a saved conversation: last message, error, token use     none: blank on the board
//   skillDir    the program's own user-level skills folder                          none: no how-to is installed
// Verified on claude 2.1.296, codex 0.160.0, pi 1.1.0 (README, "What was checked").
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { config, isAuthFailure, dataDir, readJson, writeJson, mark } from "./store.js";

const claudeFile = () => process.env.HERDR_SUPERWORK_CLAUDE_JSON || path.join(os.homedir(), ".claude.json");
const codexFile = () => process.env.HERDR_SUPERWORK_CODEX_TOML || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const piHome = () => process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");

// ---- reading the end of a saved conversation ------------------------------------------------------------------------
// Only the tail is read: these files grow to many megabytes. Every reader fails soft and returns null.
function tailLines(file, bytes = 768 * 1024) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, "r");
  try {
    const len = Math.min(st.size, bytes), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    const lines = buf.toString("utf8").split("\n");
    if (len < st.size) lines.shift(); // a cut first line
    return lines.filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } finally { fs.closeSync(fd); }
}
const when = (ts) => { const n = Date.parse(ts); return Number.isFinite(n) ? n : 0; };
// What every reader returns. `finished`: a complete assistant message ends the file. `pending`: a tool call or a partial
// message does. `interrupted`: the human stopped it. `error`: the program recorded an API, login or limit error.
const turn = (o) => ({ id: "", pos: 0, said: "", stop: "", error: "", auth: false, finished: false, pending: false, interrupted: false, usage: null, model: "", ...o, auth: !!o.error && (o.authCode === true || isAuthFailure(o.error)) });
const WINDOWS = [[/^claude-(?:opus|sonnet|haiku)-4/, 200000], [/^claude-3/, 200000]]; // only models whose window is known; the rest stay blank
const windowOf = (model) => (WINDOWS.find(([re]) => re.test(String(model || ""))) || [])[1] || null;
const usageOf = (i, o, model, window) => { const inp = Number(i) || 0, out = Number(o) || 0; return inp || out ? { in: inp, out, context: inp + out, window: window || windowOf(model) } : null; };

function readClaude(file) {
  const rows = tailLines(file);
  let last = null, usage = null, model = "";
  for (const e of rows) {
    if (e.type === "assistant" && e.message) {
      if (e.isApiErrorMessage) { last = { kind: "error", e }; continue; }
      const text = (e.message.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
      const tool = (e.message.content || []).some((c) => c.type === "tool_use");
      if (last?.kind === "say" && last.id === e.message.id) { last.text += text; last.tool = last.tool || tool; last.e = e; }
      else last = { kind: "say", id: e.message.id, text, tool, e };
      if (e.message.usage) { const u = e.message.usage; usage = [(u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), u.output_tokens || 0]; model = e.message.model || model; }
    } else if (e.type === "user" && e.message) {
      const c = e.message.content;
      const text = typeof c === "string" ? c : (c || []).filter((x) => x.type === "text").map((x) => x.text).join("");
      if (/^\[Request interrupted by user/.test(text)) last = { kind: "interrupt", e, said: last?.kind === "say" ? last.text : "" };
      else last = { kind: "user", e }; // a real prompt or a tool result: either way the agent has not answered it yet
    }
  }
  if (!last) return null;
  const base = { pos: when(last.e.timestamp), usage: usage ? usageOf(usage[0], usage[1], model) : null, model };
  if (last.kind === "error") { const text = (last.e.message.content || []).map((c) => c.text || "").join("").trim(); return turn({ ...base, id: last.e.uuid, said: text, stop: "error", error: text || String(last.e.error || "error"), authCode: last.e.error === "authentication_failed" }); }
  if (last.kind === "interrupt") return turn({ ...base, id: last.e.uuid, said: last.said, stop: "interrupted", interrupted: true });
  if (last.kind === "user") return turn({ ...base, id: last.e.uuid, pending: true });
  const stop = last.e.message.stop_reason;
  const done = !last.tool && ["end_turn", "stop_sequence", "max_tokens", "refusal"].includes(stop);
  return turn({ ...base, id: last.id, said: last.text.trim(), stop: stop === "max_tokens" ? "length" : stop === "refusal" ? "refusal" : done ? "stop" : "", finished: done, pending: !done });
}
function readCodex(file) {
  const rows = tailLines(file);
  let last = null, said = "", usage = null, model = "", window = null;
  for (const e of rows) {
    const p = e.payload || {};
    if (e.type === "turn_context") model = p.model || model;
    else if (e.type === "response_item" && p.type === "message" && p.role === "assistant") { said = (p.content || []).map((c) => c.text || "").join(""); last = { kind: p.phase === "final_answer" ? "final" : "partial", e }; }
    else if (e.type === "response_item" && p.type === "message" && p.role === "user") last = { kind: "user", e };
    else if (e.type === "response_item" && /call/.test(String(p.type))) last = { kind: "tool", e };
    else if (e.type === "event_msg" && p.type === "token_count" && p.info) { const u = p.info.last_token_usage || p.info.total_token_usage || {}; usage = [u.input_tokens || 0, u.output_tokens || 0]; window = p.info.model_context_window || window; }
    else if (e.type === "event_msg" && p.type === "task_complete") { last = { kind: "done", e, id: p.turn_id }; if (p.last_agent_message) said = p.last_agent_message; }
    else if (e.type === "event_msg" && p.type === "turn_aborted") last = { kind: "interrupt", e, id: p.turn_id };
    else if (e.type === "event_msg" && (p.type === "error" || p.type === "stream_error")) last = { kind: "error", e, text: String(p.message || p.error || "error") };
    else if (e.type === "event_msg" && p.type === "task_started") last = { kind: "user", e };
  }
  if (!last) return null;
  const base = { pos: when(last.e.timestamp), usage: usage ? usageOf(usage[0], usage[1], model, window) : null, model, id: last.id || String(when(last.e.timestamp)) };
  if (last.kind === "error") return turn({ ...base, said: last.text, stop: "error", error: last.text });
  if (last.kind === "interrupt") return turn({ ...base, said, stop: "interrupted", interrupted: true });
  if (last.kind === "done" || last.kind === "final") return turn({ ...base, said: said.trim(), stop: "stop", finished: true });
  return turn({ ...base, pending: true });
}
function readPi(file) {
  const rows = tailLines(file);
  let last = null, usage = null, model = "";
  for (const e of rows) {
    if (e.type !== "message" || !e.message) continue;
    const m = e.message;
    if (m.role === "assistant") { last = { kind: "say", e, m }; if (m.usage) usage = [(m.usage.input || 0) + (m.usage.cacheRead || 0) + (m.usage.cacheWrite || 0), m.usage.output || 0]; model = m.model || model; }
    else if (m.role === "user" || m.role === "toolResult") last = { kind: "user", e };
  }
  if (!last) return null;
  const base = { pos: when(last.e.timestamp), usage: usage ? usageOf(usage[0], usage[1], model) : null, model, id: last.e.id || "" };
  if (last.kind === "user") return turn({ ...base, pending: true });
  const text = (last.m.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
  const stop = last.m.stopReason;
  if (stop === "error") return turn({ ...base, said: text, stop: "error", error: String(last.m.errorMessage || text || "error") });
  if (stop === "aborted") return turn({ ...base, said: text, stop: "interrupted", interrupted: true });
  const done = stop === "stop" || stop === "length";
  return turn({ ...base, said: text, stop: stop === "length" ? "length" : done ? "stop" : "", finished: done, pending: !done });
}
// A file whose name ends in the id, anywhere under a folder (a few levels deep), newest first.
function findFile(root, test, depth = 4) {
  const hits = [];
  const walk = (dir, d) => { let names = []; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const n of names) { const p = path.join(dir, n.name); if (n.isDirectory()) { if (d > 0) walk(p, d - 1); } else if (test(n.name)) hits.push(p); } };
  walk(root, depth);
  return hits.sort((a, b) => { try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; } });
}
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const hookCommand = (h) => [h.shim, "turn-ended", "--id", h.id, "--role", h.role, "--token", h.token, ...(h.role === "reviewer" ? ["--round", String(h.round)] : [])];
const skillAt = (home) => (fs.existsSync(home) ? path.join(home, "skills") : null);

export const AGENTS = {
  claude: {
    minVersion: "2.1.296",
    // A settings file of the task's own, added to the user's settings for this one launch (verified: the user's own
    // hooks still run). The hooks are asynchronous, so a slow or failing one never holds the agent's turn.
    hookArgs(h) {
      const command = hookCommand(h).map(shq).join(" ");
      const file = path.join(h.dir, `hook-${h.role}.json`);
      const one = [{ hooks: [{ type: "command", command, async: true }] }];
      fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: one, StopFailure: one } }), { mode: 0o600 });
      return ["--settings", file];
    },
    newSession: () => randomUUID(),
    sessionArgs: (id) => ["--session-id", id],
    // From a file: herdr refuses launch arguments that hold line breaks.
    standing: (text, dir) => { const f = path.join(dir, "rules.md"); fs.writeFileSync(f, text); return ["--append-system-prompt-file", f]; },
    transcript(session, cwd) {
      const real = (() => { try { return fs.realpathSync(cwd); } catch { return cwd; } })();
      const direct = path.join(claudeHome(), "projects", real.replace(/[^A-Za-z0-9]/g, "-"), `${session}.jsonl`);
      return fs.existsSync(direct) ? direct : findFile(path.join(claudeHome(), "projects"), (n) => n === `${session}.jsonl`, 1)[0] || null;
    },
    readTurn: readClaude,
    skillDir: () => skillAt(claudeHome()),
    args: ["--dangerously-skip-permissions"],
    resume: (id) => ["--resume", id],
    model: (m) => ["--model", m],
    effort: (e) => ["--effort", e],
    // The prompt goes in on stdin: --tools and --allowedTools take lists and would swallow a trailing prompt.
    oneShot: ({ model, effort, prompt, allow, system }) => ({ command: "claude", stdin: prompt, args: ["-p", ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : []), ...(system ? ["--append-system-prompt", system] : []), "--no-session-persistence", ...(allow ? ["--allowedTools", "Bash(herdr-superwork:*)"] : ["--tools", ""])] }),
    allow: true,
    // Claude keeps trust per repository root, in ~/.claude.json. Verified on 2.1.295: with the flag set, a brand-new
    // worktree of that repo starts without the "trust this folder?" dialog.
    trust(root) {
      const file = claudeFile();
      let j = {};
      try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") return false; } // unreadable: leave it alone
      if (j.projects?.[root]?.hasTrustDialogAccepted) return true;
      j.projects = { ...(j.projects || {}), [root]: { ...(j.projects?.[root] || {}), hasTrustDialogAccepted: true } };
      const tmp = `${file}.${process.pid}.sw.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(j, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, file);
      return true;
    },
  },
  codex: {
    minVersion: "0.160.0",
    // Codex runs one `notify` program at each turn end, with a JSON argument. Given at launch it would replace one
    // the user configured, so a user who has one gets no hook (the hook-less route covers them).
    hookArgs(h) {
      try { if (/^\s*notify\s*=/m.test(fs.readFileSync(codexFile(), "utf8").split(/^\s*\[/m)[0])) return null; } catch {}
      return ["-c", `notify=${JSON.stringify(hookCommand(h))}`];
    },
    standing: (text) => ["-c", `developer_instructions=${JSON.stringify(text)}`],
    transcript: (session) => findFile(path.join(codexHome(), "sessions"), (n) => n.endsWith(`${session}.jsonl`))[0] || null,
    // Codex names its own conversations: without a hook, the one for this task is the file made after launch, in this
    // folder, whose prompts name this task and role. No match, or more than one: no session.
    findSession(cwd, since, needle) {
      const real = (() => { try { return fs.realpathSync(cwd); } catch { return cwd; } })();
      const hits = findFile(path.join(codexHome(), "sessions"), (n) => n.endsWith(".jsonl")).filter((f) => { try { return fs.statSync(f).mtimeMs >= since - 60000; } catch { return false; } }).filter((f) => {
        try { const head = fs.readFileSync(f, "utf8").slice(0, 400000); const meta = JSON.parse(head.slice(0, head.indexOf("\n"))); return meta.payload?.cwd === real && when(meta.timestamp) >= since - 5000 && head.includes(needle); } catch { return false; }
      });
      if (hits.length !== 1) return null;
      try { return JSON.parse(fs.readFileSync(hits[0], "utf8").split("\n")[0]).payload.id; } catch { return null; }
    },
    readTurn: readCodex,
    skillDir: () => skillAt(codexHome()),
    // --no-daemon: a shared Codex background server of another version shows a restart dialog that herdr reads as
    // idle, so a prompt would be typed into it. Each agent runs on its own instead.
    args: ["--dangerously-bypass-approvals-and-sandbox", "--no-daemon"],
    resume: (id) => ["resume", id],
    model: (m) => ["-m", m],
    effort: (e) => ["-c", `model_reasoning_effort="${e}"`],
    oneShot: ({ model, prompt }) => ({ command: "codex", args: ["exec", "--skip-git-repo-check", "--ephemeral", "--color", "never", ...(model ? ["-m", model] : []), prompt] }),
    // Codex keeps trust per repository root, in ~/.codex/config.toml. A command-line override does not count
    // (verified on 0.160), so the table is appended to the file once.
    trust(root) {
      const file = codexFile();
      let text = "";
      try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (e.code !== "ENOENT") return false; }
      const head = `[projects.${JSON.stringify(root)}]`;
      if (text.includes(head)) return true; // already has an entry: trusted or deliberately not, either way not ours to change
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}\n${head}\ntrust_level = "trusted"\n`);
      return true;
    },
  },
  pi: {
    minVersion: "1.1.0",
    // A one-file extension of the task's own: pi's settled event runs the same command, with the session file on stdin.
    hookArgs(h) {
      const file = path.join(h.dir, `hook-${h.role}.ts`);
      fs.writeFileSync(file, `import { spawn } from "node:child_process";
const cmd = ${JSON.stringify(hookCommand(h))};
export default function (pi: any) {
  pi.on("agent_settled", (_e: any, ctx: any) => {
    try {
      let file = ""; try { file = ctx?.sessionManager?.getSessionFile?.() || ""; } catch {}
      const c = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "ignore", "ignore"], detached: true });
      c.on("error", () => {}); c.stdin.on("error", () => {});
      c.stdin.end(JSON.stringify({ transcript_path: file })); c.unref();
    } catch {}
  });
}
`, { mode: 0o600 });
      return ["-e", file];
    },
    newSession: () => `sw-${randomUUID().slice(0, 13)}`,
    sessionArgs: (id) => ["--session-id", id],
    standing: (text, dir) => { const f = path.join(dir, "rules.md"); fs.writeFileSync(f, text); return ["--append-system-prompt", f]; }, // pi reads a file given here
    transcript: (session) => findFile(path.join(piHome(), "sessions"), (n) => n.endsWith(`_${session}.jsonl`), 1)[0] || null,
    readTurn: readPi,
    skillDir: () => skillAt(piHome()),
    args: [], // pi never asks before running something
    resume: (id) => ["--session-id", id],
    model: (m) => (m.includes("/") ? ["--provider", m.slice(0, m.indexOf("/")), "--model", m.slice(m.indexOf("/") + 1)] : ["--model", m]),
    effort: (e) => ["--thinking", e],
    oneShot: ({ model, prompt, system }) => ({ command: "pi", args: ["-p", "--no-session", "--no-tools", "--no-skills", "--no-context-files", ...(model ? AGENTS.pi.model(model) : []), ...(system ? ["--append-system-prompt", system] : []), "--", prompt] }),
  },
};
export const adapter = (kind) => AGENTS[kind] || {};
// The arguments a worker or reviewer of this kind is started with.
// `resume` reopens a known conversation; `session` names a new one; `extra` are the hook and standing-rule arguments.
export function startArgs(kind, { model, effort, resume, session, extra = [] } = {}) {
  const a = adapter(kind);
  const user = config().agentArgs?.[kind];
  return [
    ...(resume && a.resume ? a.resume(resume) : []), // first: Codex's `resume` is a subcommand
    ...(!resume && session && a.sessionArgs ? a.sessionArgs(session) : []),
    ...(Array.isArray(user) ? user : a.args || []),
    ...(model && a.model ? a.model(model) : []),
    ...(effort && a.effort ? a.effort(effort) : []),
    ...extra,
  ];
}
// ---- what is installed, and whether its hook can be used on this machine --------------------------------------------
export function versionOf(kind) {
  if (!/^[a-z][a-z0-9_-]*$/.test(String(kind))) return "";
  const file = path.join(dataDir(), "versions.json");
  const all = readJson(file, {}) || {};
  if (all[kind] && Date.now() - all[kind].at < 600000) return all[kind].v;
  const r = spawnSync(kind, ["--version"], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] });
  const v = r.status === 0 ? (String(r.stdout).match(/\d+\.\d+(?:\.\d+)?/) || [""])[0] : "";
  try { writeJson(file, { ...all, [kind]: { v, at: Date.now(), found: !r.error } }); } catch {}
  return v;
}
export const installed = (kind) => { versionOf(kind); return (readJson(path.join(dataDir(), "versions.json"), {}) || {})[kind]?.found !== false; };
const atLeast = (v, min) => { const a = String(v).split(".").map(Number), b = String(min).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); } return true; };
// Can this kind's turn-end hook be passed at launch here? Decided per machine: the installed version meets the
// adapter's minimum, and the hook is not marked as not working for this program and plugin version.
export function hookUsable(kind) {
  const a = adapter(kind);
  if (!a.hookArgs || process.env.HERDR_SUPERWORK_NO_HOOK === "1") return false;
  const v = versionOf(kind);
  return !!v && atLeast(v, a.minVersion || "0") && !mark(`hook:${kind}`, v);
}
// Does a finished turn still need the closing note? Yes unless the hook and the reader both work for this kind.
export const needsNote = (kind) => !adapter(kind).readTurn || !hookUsable(kind) || !!mark(`reader:${kind}`, versionOf(kind));
// The end of a task's (or its reviewer's) saved conversation, or null. Never throws.
export function readTurnOf(kind, { file, session, cwd } = {}) {
  const a = adapter(kind);
  if (!a.readTurn) return null;
  try { const f = file && fs.existsSync(file) ? file : session && a.transcript ? a.transcript(session, cwd) : null; if (!f) return null; const t = a.readTurn(f); return t ? { ...t, file: f } : null; } catch { return null; }
}
export const fullAccess = (kind) => { const user = config().agentArgs?.[kind]; return (Array.isArray(user) ? user : adapter(kind).args || []).some((x) => /dangerously|bypass|yolo/i.test(x)) || kind === "pi"; };
export const interruptKey = (kind) => adapter(kind).interrupt || "esc";
// Best effort: a failure here only means the agent's own trust dialog shows, which the inbox handles.
export function preTrust(kind, root) {
  if (!config().trust || !adapter(kind).trust || !fullAccess(kind)) return false;
  try { return adapter(kind).trust(root); } catch { return false; }
}
