// One task, whole: its title, the buttons for what can be done to it now, and the task panel's parts (status, what
// it needs from you, suggested tasks, description, reviews, evidence, what the agent said, settings, session). The
// parts and the buttons come from the board (webui/panel-model.js, webui/side-model.js); this file lays them out.
import { h, icon, ink } from "./dom.js";

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// Buttons that end something are not the ones to hit by mistake.
const QUIET = ["stop", "archive", "back"];

function item(x) {
  if (x.k === "gap") return h("div.sw-gap");
  // A line the board set in under another (a suggestion's words under its title) stays set in when it wraps.
  if (x.k === "text") { const lead = /^ */.exec(x.value[0]?.t || "")[0].length; return h("p.sw-text", lead ? { style: `padding-left:${lead * 0.5}em` } : null, ink(lead ? [{ ...x.value[0], t: x.value[0].t.slice(lead) }, ...x.value.slice(1)] : x.value)); }
  return h("div.sw-fact", h("dt.sw-label", x.label), h("dd.sw-value",
    x.bar === undefined ? null : h("span.sw-bar.sw-bar-wide", { role: "progressbar", "aria-valuenow": x.bar, "aria-valuemin": 0, "aria-valuemax": 100 }, h("span.sw-bar-fill", { style: `width:${x.bar}%` })),
    x.lines.map((l) => h("span.sw-vline", ink(l)))));
}
export function actionsEl(snap, { onPress, onMenu }) {
  const buttons = (snap.actions || []).map((b, n) => h(`button.btn${n === 0 && !QUIET.includes(b.id) ? ".btn-primary" : ""}.sw-act`, { type: "button", onclick: () => onPress(b.id) }, cap(b.label)));
  if (snap.canOpen && !(snap.actions || []).some((b) => b.id === "enter")) buttons.push(h("button.btn.sw-act", { type: "button", onclick: () => onPress("enter") }, "Open this task's agent"));
  buttons.push(h("button.btn.btn-ghost.sw-act", { type: "button", "aria-haspopup": "dialog", onclick: onMenu }, "More…"));
  return h("div.sw-actions", buttons);
}
export function panelEl(snap, handlers) {
  const p = snap.panel;
  if (!p) return null;
  return h("article.sw-panel", { "aria-label": "Task" },
    h("header.sw-panel-head",
      h("button.icon-button.sw-panel-back", { type: "button", "aria-label": "Back to the list", title: "Back to the list", onclick: handlers.onClose }, icon("back")),
      h("h3.sw-panel-title", p.title || "(no title)")),
    actionsEl(snap, handlers),
    h("div.sw-parts", p.parts.map((part) => h("section.sw-part",
      h(`h4.sw-part-head${part.color ? `.sw-c-${part.color}` : ""}`, part.head),
      h("dl.sw-facts", part.items.map(item))))));
}
