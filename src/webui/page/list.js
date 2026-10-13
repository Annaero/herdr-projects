// The task list as the page draws it: the groups under their headings and one row per task. Everything shown comes
// from the board (webui/list-model.js): this file only lays it out.
/* global ResizeObserver */
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
      // The tag has a column of its own, so what the task says and its bar start under the title, not under the tag.
      r.tag ? h("span.sw-id", { style: `min-width:${r.tagWidth || r.tag.length}ch` }, r.tag) : null,
      h("span.sw-line", h(`span.sw-title${r.strong ? ".sw-b" : ""}`, r.host ? h("span.sw-host", r.host + " ") : null, r.title), h("span.sw-time", r.time)),
      says ? h("span.sw-says", ink(r.says)) : null,
      meter || tags.childNodes.length ? h("span.sw-under", meter, tags) : null));
}

// Words on their way to another machine: a row of their own until that machine has taken them.
const jobEl = (j, { selected, onPick }) => h("li.sw-row", { className: `sw-row${selected ? " is-selected" : ""}`, data: { id: j.id }, role: "option", "aria-selected": selected ? "true" : "false", tabIndex: 0, onclick: () => onPick(j.id) },
  h(`span.sw-mark.sw-c-${j.failed ? "red" : "yellow"}`, { "aria-hidden": "true" }, j.failed ? "✕" : "●"),
  h("span.sw-main", h("span.sw-line", h("span.sw-title", j.text)), j.failed && j.msg ? h("span.sw-says", j.msg) : null));

// Do the tags fit a list this wide (in pixels)? As on the terminal board (view/row-number.js: NAME_LEFT), they give
// way on every row at once where the widest would leave its title fewer than 16 letters: the row's padding, the mark,
// the tag, the title and the time at the widths the styles give them (board.css).
const NAME_LEFT = 16, PAD = 24, MARK_W = 30, TAG_CH = 7.3, TAG_GAP = 8, TITLE_CH = 7.5, TIME_CH = 6.6, TIME_GAP = 12;
export const tagsFit = (px, widest, time = 0) => !widest || px <= 0 || px >= PAD + MARK_W + widest * TAG_CH + TAG_GAP + NAME_LEFT * TITLE_CH + (time ? TIME_GAP + time * TIME_CH : 0);

export function listEl(list, opts) {
  const el = drawList(list, opts), rows = list.groups.flatMap((g) => g.rows), widest = Math.max(0, ...rows.map((r) => (r.tag || "").length));
  if (widest && typeof ResizeObserver !== "undefined") {
    const time = Math.max(0, ...rows.map((r) => (r.time || "").length));
    new ResizeObserver(() => el.classList.toggle("sw-no-tags", !tagsFit(el.clientWidth, widest, time))).observe(el);
  }
  return el;
}
function drawList(list, { onPick, onMore }) {
  // A machine whose tasks could not be read: one line, and behind it what happened and what to do.
  const unread = (list.unread || []).map((u) => h("div.sw-unread", { role: "status" }, h("p.sw-unread-line", u.line),
    u.detail.length ? h("details", h("summary", "Why, and what to do"), h("pre.sw-unread-detail", u.detail.join("\n"))) : null));
  if (!list.groups.length && !list.jobs.length) return unread.length ? h("div.sw-list", unread, list.empty ? h("p.sw-empty", list.empty) : null) : h("p.sw-empty", list.empty);
  const jobs = list.jobs.length ? h("section.sw-group", h("h3.sw-group-name.sw-c-overlay0", "on their way"), h("ul.sw-rows", list.jobs.map((j) => jobEl(j, { selected: j.id === list.selected, onPick })))) : null;
  return h("div.sw-list", { role: "listbox", "aria-label": "Tasks" }, unread, jobs, list.groups.map((g) => h("section.sw-group",
    h(`h3.sw-group-name.sw-c-${g.color}`, g.name, h("span.sw-count", String(g.rows.length + g.more))),
    h("ul.sw-rows", g.rows.map((r) => rowEl(r, { selected: r.id === list.selected, onPick }))),
    g.more ? h("button.btn.btn-ghost.sw-more", { type: "button", onclick: () => onMore(g) }, `${g.more} more`) : null)));
}
