// What every part of the task panel is drawn with: wrapped text, headlines, callouts, boxes, and the list of parts.
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { clean, bar } from "./words.js";

export function panelKit(t, width) {
  const w = Math.max(10, width - 2);
  const dim = (s) => t.muted(s), quiet = (s) => t.fg("subtext0", s), line = (s) => t.fg("surface1", s);
  const plain = (text) => String(text ?? "").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 $2").replace(/\*\*([^*]+)\*\*/g, "$1");
  const wrap = (text, room = w) => plain(text).split("\n").flatMap((l) => { const x = wrapTextWithAnsi(clean(l), Math.max(1, room)); return x.length ? x : [""]; });
  // Every line is built without its margin; `out` adds it at the end.
  const out = (lines) => lines.map((l) => (l ? " " + l : ""));
  // A headline: bold, on a thin rule that runs to the edge.
  const head = (label) => { const s = truncateToWidth(label, w, "…"), left = w - visibleWidth(s) - 1; return t.bold(s) + (left > 0 ? " " + line("─".repeat(left)) : ""); };
  // Facts on one line, broken only between them: "12m ago" is never split.
  const flow = (parts, room = w) => {
    const rows = []; let row = "";
    for (const p of parts.filter(Boolean)) { const next = row ? row + dim(" · ") + p : p; if (row && visibleWidth(next) > room) { rows.push(row); row = p; } else row = next; }
    if (row) rows.push(row);
    return rows.map((l) => truncateToWidth(l, room, "…"));
  };
  // At most `n` lines of a text; a cut one ends by saying so.
  const first = (lines, n, room = w) => (lines.length <= n ? lines : n < 1 ? [] : [...lines.slice(0, n - 1), truncateToWidth(lines[n - 1].trimEnd() + " …", room, "…")]);
  // What needs your eye, behind a bar in its state's colour: a headline, what it says, and further parts under
  // quiet headings of their own.
  const callout = (color, label, text, more = []) => {
    const lines = [...wrapTextWithAnsi(t.fg(color, t.bold(label)), w - 2), ...(text ? wrap(text, w - 2) : [])];
    for (const [k, v] of more) lines.push("", dim(k), ...wrap(v, w - 2));
    return lines.map((l) => t.fg(color, "▎") + " " + l);
  };
  // A box: its name in the top edge, quiet notes at that edge's right end. Where the edge has no room for them
  // they are the box's first line instead, broken between them: a narrow box never drops one.
  const card = (title, notes, inner) => {
    const iw = Math.max(1, w - 4), name = ` ${truncateToWidth(title, Math.max(1, w - 6), "…")} `, note = notes.join(" · ");
    const tail = note && visibleWidth(name) + visibleWidth(note) + 7 <= w ? ` ${note} ` : "";
    if (note && !tail) inner = [...flow(notes.map((x) => dim(x)), iw), ...inner];
    const fill = Math.max(0, w - (tail ? 4 : 3) - visibleWidth(name) - visibleWidth(tail));
    return [line("╭─") + t.bold(name) + line("─".repeat(fill)) + dim(tail) + line(tail ? "─╮" : "╮"),
      ...inner.map((l) => { const s = truncateToWidth(l, iw, "…"); return line("│") + " " + s + " ".repeat(Math.max(0, iw - visibleWidth(s))) + " " + line("│"); }),
      line("╰" + "─".repeat(Math.max(0, w - 2)) + "╯")];
  };
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
  return { t, w, dim, quiet, line, plain, wrap, out, head, flow, first, callout, card, parts, part, text, attempt };
}
