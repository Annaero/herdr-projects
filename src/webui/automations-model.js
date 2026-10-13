// The automations for the web board: one's row in the list's last group, and one automation, whole, in the shapes
// the page already draws a task's row and a task in (list-model.js, panel-model.js). Nothing is worked out here: the
// row is the terminal board's own (view/automation-rows.js: autoCells), and the panel is its panel
// (view/automation-panel.js) read back into parts.
import { pieces, plain } from "./ink.js";
import { partsOf } from "./panel-model.js";

const WIDE = 4000;

// One automation's row. Off, it is quiet as a done task is, and its words say "off".
export function autoRowOf(v, a, now = Date.now(), repos = false) {
  const c = v.autoCells(a, now, repos), mark = pieces(c.mark)[0] || { t: "·" };
  return { id: a.row, label: "", tag: "", host: a.host || "", title: plain(c.name), strong: false, mark: mark.t, markDim: !a.on, markBold: false, color: a.on ? "green" : "overlay0", live: false,
    says: pieces(v.theme.muted([...c.rest, c.why].filter(Boolean).join(" · "))), progress: null, percent: "", eta: "", review: [], pr: [], prUrl: "", time: "", quiet: !a.on, pinned: false, archived: false, app: "", automation: true }; // `automation`: the page shows all of what it says, never a clamped part (board.css)
}
// One automation, whole. Each firing that made a task carries its id (`go`): the page goes to that task from it.
export function autoPanelOf(v, a) {
  const parts = partsOf(v.autoPanel(a, WIDE, true).lines), made = v.autoFirings(a).map((f) => (f.task ? v.autoTask(a, f.task) : ""));
  const lines = (parts.find((p) => p.head === "Firings")?.items || []).filter((x) => x.k === "text");
  lines.forEach((x, n) => { if (made[n]) x.go = made[n]; });
  return { id: a.row, title: a.name, task: false, automation: true, parts };
}
