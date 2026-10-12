// What every part of the task panel is drawn with: wrapped text, headlines, label-and-value rows, and the list of parts.
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { clean } from "./words.js";

// Where every value starts: one column for the whole panel, so the labels of every part line up under each other.
const LABEL = 13;

export function panelKit(t, width) {
  const w = Math.max(10, width - 2);
  const dim = (s) => t.muted(s), quiet = (s) => t.fg("subtext0", s), line = (s) => t.fg("surface1", s);
  const plain = (text) => String(text ?? "").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 $2").replace(/\*\*([^*]+)\*\*/g, "$1");
  const wrap = (text, room = w) => plain(text).split("\n").flatMap((l) => { const x = wrapTextWithAnsi(clean(l), Math.max(1, room)); return x.length ? x : [""]; });
  // Every line is built without its margin; `out` adds it at the end.
  const out = (lines) => lines.map((l) => (l ? " " + l : ""));
  // A headline: bold, on a thin rule that runs to the edge. One that needs your eye is in its state's colour.
  const head = (label, color) => { const s = truncateToWidth(label, w, "…"), left = w - visibleWidth(s) - 1; return (color ? t.fg(color, t.bold(s)) : t.bold(s)) + (left > 0 ? " " + line("─".repeat(left)) : ""); };
  // In a panel too narrow for a value beside its label, the label is a line of its own and the value is under it.
  const stacked = w - LABEL < 16, indent = stacked ? 2 : LABEL, room = Math.max(1, w - indent);
  // Facts on one line, broken only between them: "12m ago" is never split. A line of steps (" → ") that goes on
  // starts its next line with the arrow.
  const flow = (parts, space = room, sep = " · ") => {
    const rows = []; let row = "";
    for (const p of parts.filter(Boolean)) { const next = row ? row + dim(sep) + p : p; if (row && visibleWidth(next) > space) { rows.push(row); row = sep === " · " ? p : dim(sep.trimStart()) + p; } else row = next; }
    if (row) rows.push(row);
    return rows;
  };
  // A fact: its label greyed out on the left, what it is on the right. A value longer than its line is wrapped under
  // itself, never cut. `value` is a text or a list of lines; `paint` colours each line after it was wrapped.
  const fact = (label, value, paint = (x) => x) => {
    const cells = (Array.isArray(value) ? value : [value]).flatMap((v) => String(v ?? "").split("\n")).flatMap((l) => { const x = wrapTextWithAnsi(l, room); return x.length ? x : [""]; }).map(paint);
    return [...(stacked ? [dim(label)] : []), (stacked ? " ".repeat(indent) : dim(label.padEnd(LABEL - 1) + " ")) + (cells[0] ?? ""), ...cells.slice(1).map((x) => " ".repeat(indent) + x)];
  };
  // A list under a label: each item starts with a dot, and its further lines hang under its first word.
  const items = (label, xs, mark = "•") => ((xs || []).length ? fact(label, xs.flatMap((x) => wrap(x, room - 2).map((l, n) => (n ? "  " : dim(mark) + " ") + l))) : []);
  // At most `n` lines of a text; a cut one ends by saying so.
  const first = (lines, n, space = w) => (lines.length <= n ? lines : n < 1 ? [] : [...lines.slice(0, n - 1), truncateToWidth(lines[n - 1].trimEnd() + " …", space, "…")]);
  const parts = [];
  const part = (lines, o = {}) => { const s = { lines, ...o }; parts.push(s); return s; };
  // A part that fails to draw is one red line that says so, in its place: the rest of the panel, and the board, stay.
  // What it had added before it failed goes. Returns what `draw` returns, or `or` when it failed.
  const attempt = (label, draw, or) => {
    const n = parts.length;
    try { return draw(); } catch (e) {
      parts.length = n;
      part([head(label), ...wrap(`${t.mark("error")} This part could not be shown: ${e?.message || "unknown error"}`).map((l) => t.fg("red", l))], { failed: true });
      return or;
    }
  };
  // A headline and a text under it. Short of room it keeps its beginning, or its end with `from: "end"`.
  const text = (label, lines, pri, from = "start") => part([head(label), ...lines], { pri, min: 3,
    at: (n) => (n < 3 ? [] : n > lines.length ? [head(label), ...lines] : from === "end" ? [head(label), dim("…"), ...lines.slice(lines.length - (n - 2))] : [head(label), ...first(lines, n - 1)]) });
  // What needs your eye: a headline in its state's colour, what it says, and facts under it. It gives up lines only
  // after every setting has gone.
  const alert = (color, label, said, facts = []) => { const lines = [head(label, color), ...(said ? wrap(said) : []), ...facts.flatMap(([k, v]) => fact(k, wrap(v, room)))]; return part(lines, { alert: (n) => first(lines, n) }); };
  return { t, w, room, dim, quiet, line, plain, wrap, out, head, flow, fact, items, first, alert, parts, part, text, attempt };
}
