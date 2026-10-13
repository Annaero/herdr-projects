// The text of a saved conversation, one reader per agent program: what was said to the program and what it said
// back, oldest first. Only words: no tool call, no tool's output, no thinking, nothing the program wrote for itself.
// It is what the board shows of a chat (the preview, the task panel, the web board), so nothing of a program's
// screen has to be cut to pieces for it.
import fs from "node:fs";
import { adapter } from "./start.js";
import { tailLines, when } from "./read-turn.js";

const textOf = (c, types = ["text"]) => (typeof c === "string" ? c : (Array.isArray(c) ? c : []).filter((x) => x && types.includes(x.type)).map((x) => x.text || "").join("")).trim();
// One entry: { who: "you" | "them", text, at }. Two entries in a row from the same side with the same words are one.
const add = (out, who, text, at) => { const t = String(text || "").trim(); if (t && !(out.at(-1)?.who === who && out.at(-1).text === t)) out.push({ who, text: t, at: at || 0 }); };

// Claude Code. A prompt is a user entry with text of its own (a tool's result has none). What the program wrote into
// the conversation itself (a command it ran and its output, a notice of a finished helper) is told apart by how the
// entry is filed, never by its words, so a prompt that is all in a tag of the human's own stays. An entry is the
// program's own only on evidence: it names another origin than the human (`origin`), or it lacks the mark the
// program puts on every prompt that was submitted (`promptSource`) while entries of that same program version carry
// it. An entry the program files as the human's is always kept, and so is every entry of a version that marks none
// (an older one, also in a conversation a newer version went on with).
// An answer in several entries (text, a tool call, more text) has one message id: its texts are one message.
function claudeTalk(rows) {
  const out = [];
  const marks = new Set(rows.filter((e) => e.type === "user" && e.promptSource).map((e) => e.version || ""));
  const own = (e) => (e.origin?.kind ? e.origin.kind !== "human" : !e.promptSource && marks.has(e.version || ""));
  let id = null;
  for (const e of rows) {
    if (e.isSidechain || e.isMeta || e.isCompactSummary || !e.message) continue;
    if (e.type === "user") {
      const text = textOf(e.message.content).replace(/^<pasted_content[^>]*>\s*([\s\S]*?)\s*<\/pasted_content[^>]*>$/, "$1");
      if (!text || own(e) || /^\[Request interrupted by user/.test(text)) continue;
      add(out, "you", text, when(e.timestamp)); id = null;
    } else if (e.type === "assistant" && !e.isApiErrorMessage) {
      const text = textOf(e.message.content);
      if (!text) continue;
      if (id && id === e.message.id && out.at(-1)?.who === "them") out.at(-1).text += `\n\n${text}`;
      else add(out, "them", text, when(e.timestamp));
      id = e.message.id || null;
    }
  }
  return out;
}
// Codex. What it said is a message of the assistant. What was typed to it is written down as an event of its own;
// the same words stand among the model's input too, beside what Codex itself put there (the repo's instructions),
// so that input is read only in a file that has no such event.
function codexTalk(rows) {
  const typed = (e) => { const p = e.payload || {}; return e.type !== "event_msg" ? null : p.type === "user_message" ? String(p.message || "") : p.type === "item_completed" && p.item?.type === "UserMessage" ? textOf(p.item.content) : null; };
  const events = rows.some((e) => typed(e) !== null);
  const out = [];
  for (const e of rows) {
    const p = e.payload || {}, at = when(e.timestamp);
    if (typed(e) !== null) add(out, "you", typed(e), at);
    else if (e.type === "response_item" && p.type === "message" && p.role === "assistant") add(out, "them", textOf(p.content, ["output_text", "text"]), at);
    else if (!events && e.type === "response_item" && p.type === "message" && p.role === "user") add(out, "you", textOf(p.content, ["input_text", "text"]), at);
  }
  return out;
}
function piTalk(rows) {
  const out = [];
  for (const e of rows) {
    const m = e.type === "message" ? e.message : null;
    if (m?.role === "user" || m?.role === "assistant") add(out, m.role === "user" ? "you" : "them", textOf(m.content), when(e.timestamp));
  }
  return out;
}
const READERS = { claude: claudeTalk, codex: codexTalk, pi: piTalk };
export const canReadTalk = (kind) => !!READERS[kind];

// Read again only when the file changed, and a conversation's file is looked for once: the board asks on every beat.
const files = new Map(), read = new Map();
const NEAR = 768 * 1024, FAR = 6 * 1024 * 1024;
// The end of a conversation's text: the last `keep` things said, or null where nothing can be read (a program with no
// reader, no file yet). Never throws.
export function talkOf(kind, { file, session, cwd, keep = 12 } = {}) {
  if (!READERS[kind]) return null;
  try {
    let f = file && fs.existsSync(file) ? file : null;
    const key = `${kind}|${session}|${cwd}`;
    if (!f && session) { f = files.get(key); if (!f || !fs.existsSync(f)) { f = adapter(kind).transcript?.(session, cwd) || null; if (f) files.set(key, f); } }
    if (!f) return null;
    const st = fs.statSync(f), hit = read.get(f);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.list.slice(-keep);
    // The end of the file is read; where that holds little of what was said (a pasted picture is one very long
    // line), a longer end is.
    let list = READERS[kind](tailLines(f));
    if (list.length < keep && st.size > NEAR) list = READERS[kind](tailLines(f, FAR));
    if (read.size > 200) read.clear();
    read.set(f, { mtime: st.mtimeMs, size: st.size, list });
    return list.slice(-keep);
  } catch { return null; }
}
