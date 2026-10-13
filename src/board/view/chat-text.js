// A conversation's text as the lines of a box: each thing said under a line that names who said it, wrapped to the
// box, with markdown read as text (a list item's next lines stand under its words, code keeps its lines, the marks
// of a headline, of bold and of a code block are left out).
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { clean } from "./words.js";

const wrap = (text, width, lead = "", hang = lead) => {
  const rows = wrapTextWithAnsi(text, Math.max(1, width - visibleWidth(lead)));
  return (rows.length ? rows : [""]).map((l, n) => (n ? hang : lead) + l);
};
// One text, wrapped to `width`. `raw`: a screen's lines, kept as they are.
export function proseLines(text, width, raw = false) {
  const out = [];
  let code = false;
  for (const line of String(text ?? "").split("\n")) {
    if (raw) { out.push(...wrap(clean(line), width)); continue; }
    if (/^\s*(```|~~~)/.test(line)) { code = !code; continue; }
    if (code) { out.push(...wrap(clean(line.replace(/\t/g, "  ")), width, "  ")); continue; }
    const l = clean(line).replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/^(\s*)#{1,6}\s+/, "$1");
    const lead = (l.match(/^\s*(?:[-*+•]|\d+[.)])\s+|^\s*>\s?|^\s+/) || [""])[0];
    out.push(...wrap(l.slice(lead.length), width, lead, " ".repeat(visibleWidth(lead))));
  }
  return out;
}
// The parts of a chat ([{ by, text, mine, tone, raw }], oldest first) as lines: an empty line between two, and the
// line that names who said it first. `paint(kind, line)` colours a line. Returns { lines, latest }: `latest` is the
// line the newest part starts on, which is where the box opens.
export function partLines(parts, width, paint) {
  const lines = [];
  let latest = 0;
  parts.forEach((p, n) => {
    if (n) lines.push("");
    latest = lines.length;
    if (p.by) lines.push(...wrap(`${clean(p.by)}:`, width).map((l) => paint("by", l, p)));
    lines.push(...proseLines(p.text, width, p.raw).map((l) => paint("text", l, p)));
  });
  return { lines, latest };
}
// The same parts as plain text, for a page that wraps by itself.
export const partsText = (parts) => parts.map((p) => (p.by ? `${p.by}:\n` : "") + p.text).join("\n\n");
