// The task list as the page draws it: the groups under their headings and one row per task. Everything shown comes
// from the board (webui/list-model.js): this file only lays it out.
import { h, ink, said } from "./dom.js";

const MARK = { "●": "working", "◑": "working", "◒": "working", "?": "blocked", "!": "blocked", "⚷": "blocked", "✓": "done", "✕": "error", "○": "idle", "·": "idle" };

export function rowEl(r, { selected, onPick }) {
  const tags = h("span.sw-tags", r.review?.length ? ink(r.review, "sw-tag") : null,
    r.pr?.length ? (r.prUrl ? h("a.sw-tag", { href: r.prUrl, target: "_blank", rel: "noopener noreferrer", onclick: (e) => e.stopPropagation() }, ink(r.pr)) : ink(r.pr, "sw-tag")) : null);
  const meter = r.progress === null && !r.eta ? null : h("span.sw-meter", { className: `sw-meter sw-c-${r.color}` },
    r.progress === null ? null : h("span.sw-bar", { role: "progressbar", "aria-valuenow": r.progress, "aria-valuemin": 0, "aria-valuemax": 100 }, h("span.sw-bar-fill", { style: `width:${r.progress}%` })),
    r.percent ? h("span.sw-num", r.percent) : null, r.eta ? h("span.sw-num", `${r.eta} left`) : null);
  const says = said(r.says);
  return h("li.sw-row", { className: `sw-row${selected ? " is-selected" : ""}${r.quiet ? " is-quiet" : ""}${r.archived ? " is-archived" : ""}`, data: { id: r.id }, role: "option", "aria-selected": selected ? "true" : "false", tabIndex: 0,
    onclick: () => onPick(r.id), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(r.id); } } },
    h(`span.sw-mark.sw-mark-${MARK[r.mark] || "idle"}.sw-c-${r.color}${r.markDim ? ".sw-d" : ""}`, { "aria-hidden": "true" }, r.mark),
    h("span.sw-main",
      h("span.sw-line", h(`span.sw-title${r.strong ? ".sw-b" : ""}`, r.host ? h("span.sw-host", r.host + " ") : null, r.title), h("span.sw-time", r.time)),
      says ? h("span.sw-says", ink(r.says)) : null,
      meter || tags.childNodes.length ? h("span.sw-under", meter, tags) : null));
}

// Words on their way to another machine: a row of their own until that machine has taken them.
const jobEl = (j, { selected, onPick }) => h("li.sw-row", { className: `sw-row${selected ? " is-selected" : ""}`, data: { id: j.id }, role: "option", "aria-selected": selected ? "true" : "false", tabIndex: 0, onclick: () => onPick(j.id) },
  h(`span.sw-mark.sw-c-${j.failed ? "red" : "yellow"}`, { "aria-hidden": "true" }, j.failed ? "✕" : "●"),
  h("span.sw-main", h("span.sw-line", h("span.sw-title", j.text)), j.failed && j.msg ? h("span.sw-says", j.msg) : null));

export function listEl(list, { onPick, onMore }) {
  if (!list.groups.length && !list.jobs.length) return h("p.sw-empty", list.empty);
  const jobs = list.jobs.length ? h("section.sw-group", h("h3.sw-group-name.sw-c-overlay0", "on their way"), h("ul.sw-rows", list.jobs.map((j) => jobEl(j, { selected: j.id === list.selected, onPick })))) : null;
  return h("div.sw-list", { role: "listbox", "aria-label": "Tasks" }, jobs, list.groups.map((g) => h("section.sw-group",
    h(`h3.sw-group-name.sw-c-${g.color}`, g.name, h("span.sw-count", String(g.rows.length + g.more))),
    h("ul.sw-rows", g.rows.map((r) => rowEl(r, { selected: r.id === list.selected, onPick }))),
    g.more ? h("button.btn.btn-ghost.sw-more", { type: "button", onclick: () => onMore(g) }, `${g.more} more`) : null)));
}
