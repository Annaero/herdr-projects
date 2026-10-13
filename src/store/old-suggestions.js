// Suggested tasks were taken out of the board. What tasks saved by an older version still carry of them is written
// down once, as one page among the board's reports (the ones that still waited for an answer: task, title,
// description, who made it), and then removed from the tasks. A task that carries some loads as any other until then.
import fs from "node:fs";
import path from "node:path";
import { reportsDir } from "./files.js";
import { list, update } from "./tasks.js";
import { stampFile } from "./marks.js";

export const oldSuggestionsFile = () => path.join(reportsDir(), "old-suggestions.md");
const HEAD = `# Suggested tasks that were still open

Suggested tasks were removed from the board. These still waited for an answer when they were taken off their tasks.
Nothing is done with them: add a task yourself for one you still want.
`;
const entry = (t, s) => [`## ${String(s.title || "(no title)").replace(/\s+/g, " ").trim()}`,
  `On ${t.id} (${String(t.title || "").replace(/\s+/g, " ").trim()}) · from ${s.by === "reviewer" ? "the reviewer" : "the agent"}${s.at ? ` · ${new Date(s.at).toISOString().slice(0, 10)}` : ""}`,
  String(s.description || "").trim() || (s.where ? `Where: ${s.where}` : "")].filter(Boolean).join("\n\n");

// Returns how many were written down. Done once: afterwards a stamp says so, and the tasks are not read again.
// A task that could not be changed now (it was busy) keeps its own for the next pass, which also writes no stamp.
export function saveOldSuggestions() {
  const stamp = stampFile("old-suggestions-saved");
  if (fs.existsSync(stamp)) return 0;
  let saved = 0, left = false;
  for (const t of list({ includeArchived: true })) {
    if (t.suggestions === undefined) continue;
    try {
      update(t.id, (t) => {
        const open = (Array.isArray(t.suggestions) ? t.suggestions : []).filter((s) => s && s.state === "open");
        if (open.length) {
          const file = oldSuggestionsFile();
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.appendFileSync(file, `${fs.existsSync(file) ? "" : HEAD}\n${open.map((s) => entry(t, s)).join("\n\n")}\n`);
          saved += open.length;
        }
        delete t.suggestions;
      });
    } catch { left = true; }
  }
  if (!left) { try { fs.mkdirSync(path.dirname(stamp), { recursive: true }); fs.writeFileSync(stamp, String(Date.now())); } catch {} }
  return saved;
}
