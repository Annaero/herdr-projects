// The task panel for the web board. The board's own panel code (view/panel.js and its parts) draws the whole task
// with a web theme, too wide for anything to wrap; this file only reads what it drew back into its shape: parts under
// their headlines, each a list of facts (a label and its value) and lines of text. What the panel says, in which
// order and in which colour, is the terminal board's.
import { pieces } from "./ink.js";

const WIDE = 4000;
// Where every value starts in the panel (view/panel-kit.js: LABEL).
const LABEL = 13;
const isRule = (p) => p && p.c === "surface1" && /^─+$/.test(p.t);
const trimEnd = (ps) => { const out = ps.slice(); while (out.length && !out.at(-1).t.trim()) out.pop(); if (out.length) out[out.length - 1] = { ...out.at(-1), t: out.at(-1).t.trimEnd() }; return out; };
const dropLead = (ps, n) => { const out = ps.slice(); out[0] = { ...out[0], t: out[0].t.slice(n) }; return out[0].t ? out : out.slice(1); };

// One drawn line as what it is: a headline, a fact's first line, a line that goes on under a fact, or a line of text.
export function readLine(line) {
  const ps = pieces(String(line).replace(/^ /, ""));
  if (!ps.length || !ps.some((p) => p.t.trim())) return { k: "gap" };
  if (isRule(ps.at(-1))) return { k: "head", text: trimEnd(ps.slice(0, -1)).map((p) => p.t).join(""), color: ps[0].c || "" };
  const first = ps[0];
  // A fact: its greyed label, filled out to where every value starts. A value that is grey too runs on from it. A
  // label is shorter than its column, so two spaces or more stand after it, which no sentence has.
  const lead = first.t.slice(0, LABEL), label = lead.trimEnd();
  if (first.c === "overlay0" && lead.length === LABEL && label && label.length < LABEL - 1 && !label.startsWith(" ") && !/ {2}/.test(label)) return { k: "fact", label, value: first.t.length > LABEL ? [{ ...first, t: first.t.slice(LABEL) }, ...ps.slice(1)] : ps.slice(1) };
  if (!first.c && !first.b && first.t.startsWith(" ".repeat(LABEL))) return { k: "more", value: dropLead(ps, LABEL) };
  return { k: "text", value: ps };
}

// Drawn lines as parts under their headlines. What stands above the first headline (the title) is left out: the page
// has it from the task itself.
export function partsOf(lines) {
  const parts = [];
  let part = null, fact = null;
  for (const line of lines) {
    const x = readLine(line);
    if (x.k === "head") { part = { head: x.text, color: x.color, items: [] }; parts.push(part); fact = null; continue; }
    if (!part) continue; // the title: the page has it from the task itself
    if (x.k === "gap") { if (part.items.length && part.items.at(-1).k !== "gap") part.items.push({ k: "gap" }); fact = null; }
    else if (x.k === "fact") { fact = { k: "fact", label: x.label, lines: [x.value] }; part.items.push(fact); }
    else if (x.k === "more" && fact) fact.lines.push(x.value);
    else { part.items.push({ k: "text", value: x.k === "more" ? x.value : x.value }); fact = null; }
  }
  for (const p of parts) while (p.items.length && p.items.at(-1).k === "gap") p.items.pop();
  return parts;
}

export function panelOf(v, r) {
  if (!r) return null;
  const parts = partsOf(v.panel(r, WIDE, true));
  // The progress is a bar on the page, not a row of block characters.
  const bar = r.state !== "done" && r.progress !== undefined ? Math.max(0, Math.min(100, Number(r.progress) || 0)) : null;
  for (const p of parts) for (const f of p.items) if (f.k === "fact" && f.label === "Progress" && bar !== null) { f.bar = bar; f.lines = f.lines.map((l) => l.map((x) => ({ ...x, t: x.t.replace(/^[█░]+ ?/, "") })).filter((x) => x.t)); }
  return { id: r.id, title: String(r.title ?? r.text ?? ""), task: r.title !== undefined, parts };
}
