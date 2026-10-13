// The task list for the web board: the groups and rows the terminal board shows, in its order, each row with the
// mark, the words, the columns and the colours the board's own row code gives it (view/row.js through a web theme).
// The automations are its last group, one row each. The page draws what is here and works nothing out.
import os from "node:os";
import * as S from "../store.js";
import { currentSocket, sessionName } from "../herdr.js";
import { GROUP_COLOR, isLive, statusColor } from "../board/view/states.js";
import { idLabel, repoLabel } from "../board/view/words.js";
import { tagCells } from "../board/view/row-number.js";
import { webURL } from "../review-page.js";
import { pieces, plain } from "./ink.js";
import { autoRowOf } from "./automations-model.js";

export function rowOf(v, r, now = Date.now()) {
  const f = v.rowFields(r, now), mark = pieces(v.mark(r))[0] || { t: "·" };
  return {
    id: r.id, label: idLabel(r.rid || r.id), tag: v.numberTag(r), host: r.host || "", title: plain(v.rowTitle(r)), strong: ["working", "blocked", "error"].includes(r.state),
    mark: mark.t, markDim: !!mark.d, markBold: !!mark.b, color: statusColor(r), live: isLive(r),
    says: pieces(v.sentence(r).text),
    progress: r.state !== "done" && r.progress !== undefined ? Math.max(0, Math.min(100, Number(r.progress) || 0)) : null,
    percent: plain(f.percent).trim(), eta: plain(f.eta),
    review: pieces(f.review), pr: pieces(f.pr), prUrl: webURL(r.pr),
    time: f.elapsed + (f.ago ? " ago" : ""), quiet: r.state === "done",
    pinned: !!r.pinned, archived: !!r.archivedAt, app: r.app || "", made: !!r.automation?.id, // `made`: by an automation, whose colour its [auto] tag takes
  };
}

export function listOf(v) {
  const now = Date.now(), groups = [];
  for (const row of v.rows) {
    if (row.autos) groups.push({ name: row.header, color: "auto", repo: false, automations: true, rows: [], more: 0 }); // the last group (automations-model.js)
    else if (row.auto) groups.at(-1)?.rows.push(autoRowOf(v, row.auto, now));
    else if (row.header) groups.push({ name: v.byRepo ? repoLabel(row.header) : row.header, color: v.byRepo ? "subtext0" : GROUP_COLOR[row.header] || "subtext0", repo: !!v.byRepo, rows: [], more: 0 });
    else if (row.rec) groups.at(-1)?.rows.push(rowOf(v, row.rec, now));
    else if (row.note && groups.length) groups.at(-1).more = Number((/(\d+) more/.exec(row.note) || [])[1]) || 0;
  }
  // The characters each task's tag (`#134`, `HSW-134`) fills: the terminal board's column and its limit on the space
  // before a title (row-number.js), so the page lines the titles up the same way.
  const column = v.numbering().cells;
  for (const g of groups) for (const r of g.rows) r.tagWidth = r.automation ? Math.max(column, r.tag.length) : tagCells(r.tag.length, column) || r.tag.length; // an automation's word fills the column: its name starts where the titles do
  const session = sessionName(currentSocket());
  const unread = v.unread();
  return {
    head: {
      // The repo new tasks go to, by its name: no folder path, and nothing for the home folder.
      where: v.archiveView || v.repo.root === os.homedir() ? "" : v.repo.name,
      session: session === "default" ? "" : session,
      machines: v.scope === "*" ? (Object.values(v.remotes).map((m) => (m.ok ? m.label : `${m.label} (no answer)`)).join(", ") || "no others found") : "",
      only: v.all && v.scope !== "*" ? v.scope : "", filter: v.filter || "", host: os.hostname(), version: S.VERSION,
    },
    groups, selected: v.sel || "",
    // Words on their way to another machine: rows of their own under the list, until that machine has taken them.
    jobs: v.jobs.map((j) => ({ id: j.id, text: String(j.text || ""), failed: j.state === "error", msg: String(j.msg || "") })),
    // Machines whose tasks could not be read, each with why and what to do: said where their tasks would be.
    unread,
    empty: v.rows.length || (unread.length && v.scope !== "*") ? "" : v.filter ? "Nothing matches." : v.archiveView ? "No archived tasks." : "Nothing here yet. Type what needs doing.",
  };
}
