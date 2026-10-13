// The automations for the web board: one's row in the list's last group, and one automation, whole, in the shapes
// the page already draws a task's row and a task in (list-model.js, panel-model.js). Nothing is worked out here: the
// row is the terminal board's own (view/automation-rows.js, drawn there by the tasks' row code), and the panel is its
// panel (view/automation-panel.js) read back into parts.
import { pieces, plain } from "./ink.js";
import { partsOf } from "./panel-model.js";

const WIDE = 4000;

// One automation's row, in a task row's places: the word on or off where a task has its number, its trigger (and why
// it was turned off) where a task says something, the task its last firing made among the tags, and "next in 4m" or
// "fired 2h ago" where a task has its time. Off, it is quiet as a done task is.
export function autoRowOf(v, a, now = Date.now()) {
  const rec = v.autoRec(a), f = v.rowFields(rec, now), mark = pieces(v.mark(rec))[0] || { t: "·" };
  return { id: a.row, label: "", tag: v.numberTag(rec), host: a.host || "", title: plain(v.rowTitle(rec)), strong: false, mark: mark.t, markDim: !a.on, markBold: false, color: "auto", live: false,
    says: pieces(v.autoSaid(a, "all")), progress: null, percent: "", eta: "", review: pieces(f.tag), pr: [], prUrl: "", time: f.when, quiet: !a.on, pinned: false, archived: false, app: "", automation: true }; // `automation`: its word (on, off) never gives way, and what it says is never clamped (board.css)
}
// One automation, whole. Each firing that made a task carries its id (`go`): the page goes to that task from it.
export function autoPanelOf(v, a) {
  const parts = partsOf(v.autoPanel(a, WIDE, true).lines), made = v.autoFirings(a).map((f) => (f.task ? v.autoTask(a, f.task) : ""));
  const lines = (parts.find((p) => p.head === "Firings")?.items || []).filter((x) => x.k === "text");
  lines.forEach((x, n) => { if (made[n]) x.go = made[n]; });
  return { id: a.row, title: a.name, task: false, automation: true, parts };
}
