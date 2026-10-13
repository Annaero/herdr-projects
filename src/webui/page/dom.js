// The page's few tools: making elements, drawing the board's coloured pieces of text, and calling the front door.
/* global document, fetch, sessionStorage, crypto, location */

// h("div.sw-row", { onclick }, child, …): a tag with classes, then properties and children.
export function h(spec, ...rest) {
  const [tag, ...classes] = spec.split(".");
  const el = document.createElement(tag || "div");
  if (classes.length) el.className = classes.join(" ");
  for (const x of rest.flat()) {
    if (x == null || x === false) continue;
    if (typeof x === "string" || typeof x === "number") el.append(String(x));
    else if (x.nodeType) el.append(x);
    else for (const [k, v] of Object.entries(x)) { if (v == null || v === false) continue; if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (k === "data") Object.assign(el.dataset, v); else if (k in el && k !== "list") el[k] = v; else el.setAttribute(k, v === true ? "" : v); }
  }
  return el;
}
// The few icons, drawn as the web UI draws its own (24 by 24, a line of the text's colour).
const PATHS = {
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  find: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  board: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M13 8h4"/><path d="M13 12h4"/><path d="M13 16h2"/>',
};
export function icon(name) {
  const span = document.createElement("span");
  span.className = "sw-icon";
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`;
  return span.firstChild;
}
// The board's text as it was painted there: each piece with the name of its colour, which the styles give a colour.
export function ink(pieces, cls = "") {
  const out = h(`span${cls ? "." + cls : ""}`);
  for (const p of pieces || []) {
    const cls = [p.c ? `sw-c-${p.c}` : "", p.b ? "sw-b" : "", p.d ? "sw-d" : ""].filter(Boolean).join(" ");
    out.append(p.href ? h("a", { className: cls, href: p.href, target: "_blank", rel: "noopener noreferrer" }, p.t) : cls ? h("span", { className: cls }, p.t) : p.t);
  }
  return out;
}
// A status mark. The three round ones (an agent, its reviewer, the board at work) are drawn, all at one size: as
// text the two half discs came out a third the size of the dot. Every other mark is its character.
const ROUND = { "●": "full", "◑": "right", "◒": "bottom" };
export const markEl = (mark, color = "", dim = false) => h(`span.sw-mark${color ? `.sw-c-${color}` : ""}${dim ? ".sw-d" : ""}`, { "aria-hidden": "true" }, ROUND[mark] ? h(`span.sw-dot.sw-dot-${ROUND[mark]}`) : mark);
export const said = (pieces) => (pieces || []).map((p) => p.t).join("");

// This browser tab's own board (its selection, its question): a name of its own, kept while the tab lives.
export const client = (() => {
  try { let id = sessionStorage.getItem("sw-client"); if (!id) { id = crypto.randomUUID().replace(/-/g, "").slice(0, 16); sessionStorage.setItem("sw-client", id); } return id; }
  catch { return Math.random().toString(36).slice(2, 14); }
})();
const BASE = "/superwork/api";
// The PC the web UI's page is on (its address says: `?machine=<pc>`, left out for this machine). Sent with every
// call, so the board is the board of that machine.
const machine = () => { try { return new URLSearchParams(location.search).get("machine") || ""; } catch { return ""; } };
// A read. Answers { ok, status, … }; never throws.
export async function get(what, params = {}) {
  try {
    const r = await fetch(`${BASE}/${what}?${new URLSearchParams({ client, machine: machine(), ...params })}`, { credentials: "same-origin", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    return { ...j, ok: r.ok && j.ok !== false, status: r.status };
  } catch { return { ok: false, status: 0, msg: "No connection." }; }
}
// A change: the same address, with the header that says it comes from the board's own controls.
export async function post(what, body = {}) {
  try {
    const r = await fetch(`${BASE}/${what}?${new URLSearchParams({ client, machine: machine() })}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-herdr-superwork": "1" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { ...j, ok: r.ok && j.ok !== false, status: r.status };
  } catch { return { ok: false, status: 0, msg: "No connection." }; }
}
