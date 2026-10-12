// What an agent was told: every prompt in its saved conversation, oldest first, where the program's file can be read.
import fs from "node:fs";
import { when } from "./read-turn.js";

// Claude Code: one JSON object a line. A prompt is a user entry with text of its own: not a tool's result, not a
// note the program wrote itself, not a helper agent's. Text that was pasted in
// arrives wrapped in a tag: taken off only where the prompt is that one paste and nothing else.
function claudePrompts(file) {
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { return null; } // a line that cannot be read may hide a prompt
    if (e.type !== "user" || !e.message || e.isMeta || e.isSidechain || e.isCompactSummary) continue;
    const c = e.message.content;
    const text = (typeof c === "string" ? c : (c || []).filter((x) => x.type === "text").map((x) => x.text).join("\n")).trim().replace(/^<pasted_content[^>]*>\s*([\s\S]*?)\s*<\/pasted_content[^>]*>$/, "$1");
    if (text) out.push({ at: when(e.timestamp), text });
  }
  return out;
}
const READERS = { claude: claudePrompts };
// Null when nothing can be said: a kind with no reader, no file, a file that cannot be read.
export function promptsOf(kind, file) {
  if (!READERS[kind] || !file) return null;
  try { return READERS[kind](file); } catch { return null; }
}
