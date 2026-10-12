// Reading the end of a saved conversation, one reader per agent program: last message, error, tokens.
import fs from "node:fs";
import path from "node:path";
import { isAuthFailure } from "../store.js";
import { providerError } from "./provider-error.js";

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
export const headOf = (file, bytes) => { const fd = fs.openSync(file, "r"); try { const buf = Buffer.alloc(bytes); return buf.toString("utf8", 0, fs.readSync(fd, buf, 0, bytes, 0)); } finally { fs.closeSync(fd); } };
export const when = (ts) => { const n = Date.parse(ts); return Number.isFinite(n) ? n : 0; };
// What every reader returns. `finished`: a complete assistant message ends the file. `pending`: a tool call or a partial
// message does. `interrupted`: the human stopped it. `error`: the program recorded an API, login or limit error.
// `passing`: the error is the provider's and waiting may fix it (see providerError); `reason` says which, in plain words.
export const turn = (o) => {
  const pe = o.error ? providerError(o.error, { code: o.code, status: o.status }) : null;
  const auth = !!o.error && (o.authCode === true || pe.auth || isAuthFailure(o.error));
  return { id: "", pos: 0, said: "", stop: "", error: "", finished: false, pending: false, interrupted: false, usage: null, model: "", ...o, auth, passing: !!pe && pe.passing && !auth, reason: pe && pe.passing && !auth ? pe.reason : "" };
};
// Codex writes its code as a word, or as a table with the word as its one key ({"http_connection_failed": {…}}).
const codexCode = (c) => String(c && typeof c === "object" ? Object.keys(c)[0] || "" : c || "").replace(/[A-Z]/g, (m, i) => (i ? "_" : "") + m.toLowerCase());
const WINDOWS = [[/^claude-(?:opus|sonnet|haiku)-4/, 200000], [/^claude-3/, 200000]]; // only models whose window is known; the rest stay blank
const windowOf = (model) => (WINDOWS.find(([re]) => re.test(String(model || ""))) || [])[1] || null;
const usageOf = (i, o, model, window) => { const inp = Number(i) || 0, out = Number(o) || 0; return inp || out ? { in: inp, out, context: inp + out, window: window || windowOf(model) } : null; };

export function readClaude(file) {
  const rows = tailLines(file);
  let last = null, usage = null, model = "", latest = ""; // latest: the newest text the agent said, shown mid-work
  for (const e of rows) {
    if (e.type === "assistant" && e.message) {
      if (e.isApiErrorMessage) { last = { kind: "error", e }; continue; }
      const text = (e.message.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
      if (text.trim()) latest = last?.kind === "say" && last.id === e.message.id && last.text ? last.text + text : text;
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
  if (last.kind === "error") { const text = (last.e.message.content || []).map((c) => c.text || "").join("").trim(); return turn({ ...base, id: last.e.uuid, said: text, stop: "error", error: text || String(last.e.error || "error"), authCode: last.e.error === "authentication_failed", code: last.e.error, status: last.e.apiErrorStatus }); }
  if (last.kind === "interrupt") return turn({ ...base, id: last.e.uuid, said: last.said, stop: "interrupted", interrupted: true });
  if (last.kind === "user") return turn({ ...base, id: last.e.uuid, pending: true, said: latest.trim() });
  const stop = last.e.message.stop_reason;
  const done = !last.tool && ["end_turn", "stop_sequence", "max_tokens", "refusal"].includes(stop);
  return turn({ ...base, id: last.id, said: (last.text.trim() || (done ? "" : latest.trim())), stop: stop === "max_tokens" ? "length" : stop === "refusal" ? "refusal" : done ? "stop" : "", finished: done, pending: !done });
}
export function readCodex(file) {
  const rows = tailLines(file);
  let last = null, said = "", usage = null, model = "", window = null;
  for (const e of rows) {
    const p = e.payload || {};
    if (e.type === "turn_context") model = p.model || model;
    else if (e.type === "response_item" && p.type === "message" && p.role === "assistant") { said = (p.content || []).map((c) => c.text || "").join(""); last = { kind: p.phase === "final_answer" ? "final" : "partial", e }; }
    else if (e.type === "response_item" && p.type === "message" && p.role === "user") last = { kind: "user", e };
    else if (e.type === "response_item" && /call/.test(String(p.type))) last = { kind: "tool", e };
    else if (e.type === "event_msg" && p.type === "token_count" && p.info) { const u = p.info.last_token_usage || p.info.total_token_usage || {}; usage = [u.input_tokens || 0, u.output_tokens || 0]; window = p.info.model_context_window || window; }
    // A turn the provider cut off also ends in `task_complete`: with no last message, and the error it ended on.
    else if (e.type === "event_msg" && p.type === "task_complete" && p.error) last = { kind: "error", e, id: p.turn_id, text: String((typeof p.error === "object" ? p.error.message : p.error) || "error"), code: codexCode(p.error.codex_error_info) };
    else if (e.type === "event_msg" && p.type === "task_complete") { last = { kind: "done", e, id: p.turn_id }; if (p.last_agent_message) said = p.last_agent_message; }
    else if (e.type === "event_msg" && p.type === "turn_aborted") last = { kind: "interrupt", e, id: p.turn_id };
    else if (e.type === "event_msg" && (p.type === "error" || p.type === "stream_error")) last = { kind: "error", e, text: String(p.message || p.error || "error"), code: codexCode(p.codex_error_info) };
    else if (e.type === "event_msg" && p.type === "task_started") last = { kind: "user", e };
  }
  if (!last) return null;
  const base = { pos: when(last.e.timestamp), usage: usage ? usageOf(usage[0], usage[1], model, window) : null, model, id: last.id || String(when(last.e.timestamp)) };
  if (last.kind === "error") return turn({ ...base, said: last.text, stop: "error", error: last.text, code: last.code });
  if (last.kind === "interrupt") return turn({ ...base, said, stop: "interrupted", interrupted: true });
  if (last.kind === "done" || last.kind === "final") return turn({ ...base, said: said.trim(), stop: "stop", finished: true });
  return turn({ ...base, pending: true, said: said.trim() });
}
export function readPi(file) {
  const rows = tailLines(file);
  let last = null, usage = null, model = "", latest = "";
  for (const e of rows) {
    if (e.type !== "message" || !e.message) continue;
    const m = e.message;
    if (m.role === "assistant") { last = { kind: "say", e, m }; const tx = (m.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim(); if (tx) latest = tx; if (m.usage) usage = [(m.usage.input || 0) + (m.usage.cacheRead || 0) + (m.usage.cacheWrite || 0), m.usage.output || 0]; model = m.model || model; }
    else if (m.role === "user" || m.role === "toolResult") last = { kind: "user", e };
  }
  if (!last) return null;
  const base = { pos: when(last.e.timestamp), usage: usage ? usageOf(usage[0], usage[1], model) : null, model, id: last.e.id || "" };
  if (last.kind === "user") return turn({ ...base, pending: true, said: latest });
  const text = (last.m.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
  const stop = last.m.stopReason;
  if (stop === "error") return turn({ ...base, said: text, stop: "error", error: String(last.m.errorMessage || text || "error") });
  if (stop === "aborted") return turn({ ...base, said: text, stop: "interrupted", interrupted: true });
  const done = stop === "stop" || stop === "length";
  return turn({ ...base, said: text, stop: stop === "length" ? "length" : done ? "stop" : "", finished: done, pending: !done });
}
// A file whose name ends in the id, anywhere under a folder (a few levels deep), newest first.
export function findFile(root, test, depth = 4) {
  const hits = [];
  const walk = (dir, d) => { let names = []; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const n of names) { const p = path.join(dir, n.name); if (n.isDirectory()) { if (d > 0) walk(p, d - 1); } else if (test(n.name)) hits.push(p); } };
  walk(root, depth);
  return hits.sort((a, b) => { try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; } });
}
