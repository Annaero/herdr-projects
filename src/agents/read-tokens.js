// The tokens a saved conversation has used so far, one counter per agent program: everything the model read and
// everything it wrote, every request of the conversation added up, as the provider counts it. What a request read
// again from the provider's cache is counted too: it is part of what the task used. (`limit.tokens` is measured in
// this count: limits.js. A request reads the whole conversation so far, so the count grows fast: a task of fifty
// steps at 100k of context has used five million.)
//
// A conversation file only grows, so it is read on from where the last count stopped: `state` is what a counter
// gave back the time before ({ at: the byte it read to, n: the tokens so far, … }), and nothing for a first count.
// A file that is shorter than it was is another file, and is counted from its start.
import fs from "node:fs";

// The whole lines written since byte `at`: { rows, at }. A last line still being written waits for the next count.
function grown(file, at = 0) {
  const size = fs.statSync(file).size;
  if (size < at) at = 0;
  if (size === at) return { rows: [], at, fresh: false };
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - at);
    fs.readSync(fd, buf, 0, buf.length, at);
    const end = buf.lastIndexOf(10) + 1; // the byte after the last line break
    const rows = buf.toString("utf8", 0, end).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return { rows, at: at + end };
  } finally { fs.closeSync(fd); }
}
const num = (v) => Number(v) || 0;
const from = (file, state) => (state && fs.statSync(file).size >= num(state.at) ? state : {});

// Claude Code writes one line per part of a reply, each with the whole reply's use: a reply counts once, by its id.
export function claudeTokens(file, state) {
  let { at = 0, n = 0, id = "", idN = 0 } = from(file, state);
  const g = grown(file, at);
  for (const e of g.rows) {
    const u = e.type === "assistant" && !e.isApiErrorMessage && e.message?.usage;
    if (!u) continue;
    const v = num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens) + num(u.output_tokens);
    if (e.message.id && e.message.id === id) { n += Math.max(0, v - idN); idN = Math.max(idN, v); }
    else { n += v; id = e.message.id || ""; idN = v; }
  }
  return { at: g.at, n, id, idN };
}
// Codex writes the conversation's running total after every request (its input includes what came from the cache). A total that went down is a count that began
// again (a conversation taken up in a new run of the program): it is added to what was counted before.
export function codexTokens(file, state) {
  let { at = 0, n = 0, last = 0 } = from(file, state);
  const g = grown(file, at);
  for (const e of g.rows) {
    const u = e.type === "event_msg" && e.payload?.type === "token_count" && e.payload.info?.total_token_usage;
    if (!u) continue;
    const v = num(u.input_tokens) + num(u.output_tokens);
    n += v >= last ? v - last : v;
    last = v;
  }
  return { at: g.at, n, last };
}
// pi writes each reply once, with its own use.
export function piTokens(file, state) {
  let { at = 0, n = 0 } = from(file, state);
  const g = grown(file, at);
  for (const e of g.rows) {
    const u = e.type === "message" && e.message?.role === "assistant" && e.message.usage;
    if (u) n += num(u.input) + num(u.cacheRead) + num(u.cacheWrite) + num(u.output);
  }
  return { at: g.at, n };
}
