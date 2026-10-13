// The task list for the web board: the groups and rows the terminal board shows, in its order, each row with the
// mark, the words, the columns and the colours the board's own row code gives it (view/row.js through a web theme).
// The page draws what is here and works nothing out.
import os from "node:os";
import * as S from "../store.js";
import { currentSocket, sessionName } from "../herdr.js";
import { GROUP_COLOR, isLive, statusColor } from "../board/view/states.js";
import { idLabel, repoLabel, short } from "../board/view/words.js";
import { webURL } from "../review-page.js";
import { pieces, plain } from "./ink.js";

export function rowOf(v, r, now = Date.now()) {
  const f = v.rowFields(r, now), mark = pieces(v.mark(r))[0] || { t: "·" };
  return {
    id: r.id, label: idLabel(r.rid || r.id), tag: v.numberTag(r), host: r.host || "", title: plain(v.rowTitle(r)), strong: r.state === "working" || r.state === "blocked",
    mark: mark.t, markDim: !!mark.d, markBold: !!mark.b, color: statusColor(r), live: isLive(r),
    says: pieces(v.sentence(r).text),
    progress: r.state !== "done" && r.progress !== undefined ? Math.max(0, Math.min(100, Number(r.progress) || 0)) : null,
    percent: plain(f.percent).trim(), eta: plain(f.eta),
    review: pieces(f.review), pr: pieces(f.pr), prUrl: webURL(r.pr),
    time: f.elapsed + (f.ago ? " ago" : ""), quiet: r.state === "done",
    pinned: !!r.pinned, archived: !!r.archivedAt, app: r.app || "",
  };
}

export function listOf(v) {
  const now = Date.now(), groups = [];
  for (const row of v.rows) {
    if (row.header) groups.push({ name: v.byRepo ? repoLabel(row.header) : row.header, color: v.byRepo ? "subtext0" : GROUP_COLOR[row.header] || "subtext0", repo: !!v.byRepo, rows: [], more: 0 });
    else if (row.rec) groups.at(-1)?.rows.push(rowOf(v, row.rec, now));
    else if (row.note && groups.length) groups.at(-1).more = Number((/(\d+) more/.exec(row.note) || [])[1]) || 0;
  }
  const session = sessionName(currentSocket());
  const asked = v.archiveView ? 0 : v.suggestionCount();
  return {
    head: {
      where: v.archiveView ? "archive" : v.repo.root === os.homedir() ? "~" : `${v.repo.name} · ${short(v.repo.root)}`,
      session: session === "default" ? "" : session,
      machines: v.scope === "*" ? (Object.values(v.remotes).map((m) => (m.ok ? m.label : `${m.label} (no answer)`)).join(", ") || "no others found") : "",
      only: v.all && v.scope !== "*" ? v.scope : "", filter: v.filter || "", suggested: asked, host: os.hostname(), version: S.VERSION,
    },
    groups, selected: v.sel || "",
    // The widest of the tasks' tags (`#134`, `HSW-134`), in characters: the page gives them one column, as the terminal board does.
    tagWidth: Math.max(0, ...groups.flatMap((g) => g.rows.map((r) => r.tag.length))),
    // Words on their way to another machine: rows of their own under the list, until that machine has taken them.
    jobs: v.jobs.map((j) => ({ id: j.id, text: String(j.text || ""), failed: j.state === "error", msg: String(j.msg || "") })),
    empty: v.rows.length ? "" : v.filter ? "Nothing matches." : v.archiveView ? "No archived tasks." : "Nothing here yet. Type what needs doing.",
  };
}
