// The automations for the web board: the list and one automation, whole, in the shapes the page already draws a task
// list and a task in (list-model.js, panel-model.js). Nothing is worked out here: the rows are the terminal board's
// own (view/automations.js: autoCells), and the panel is its panel (view/automation-panel.js) read back into parts.
import os from "node:os";
import * as S from "../store.js";
import { currentSocket, sessionName } from "../herdr.js";
import { firings } from "../automations/show.js";
import { pieces, plain } from "./ink.js";
import { partsOf } from "./panel-model.js";

const WIDE = 4000;

export function autoListOf(v) {
  const list = S.automations(), now = Date.now(), a = v.autoCurrent(list), session = sessionName(currentSocket());
  const rows = list.map((x) => {
    const c = v.autoCells(x, now), mark = pieces(c.mark)[0] || { t: "·" };
    return { id: x.id, label: "", host: "", title: plain(c.name), strong: !!x.on, mark: mark.t, markDim: !x.on, markBold: false, color: x.on ? "green" : "overlay0", live: false,
      says: pieces(v.theme.muted([...c.rest, c.why].filter(Boolean).join(" · "))), progress: null, percent: "", eta: "", review: [], pr: [], prUrl: "", time: "", quiet: !x.on, pinned: false, archived: false, app: "" };
  });
  return {
    head: { where: "automations", session: session === "default" ? "" : session, machines: "", only: "", filter: "", suggested: 0, host: os.hostname(), version: S.VERSION },
    groups: rows.length ? [{ name: "automations", color: "subtext0", repo: false, rows, more: 0 }] : [], selected: a ? a.id : "", jobs: [],
    empty: v.talksToCoord ? "No automations yet. Tell the Coordinator what to automate, and when." : "No automations yet. Make one: herdr-superwork automations add",
  };
}
// One automation, whole. Each firing that made a task carries its id (`go`): the page goes to that task from it.
export function autoPanelOf(v) {
  const a = v.autoCurrent();
  if (!a) return null;
  const parts = partsOf(v.autoPanel(a, WIDE, true).lines), made = firings(a).map((f) => f.task || "");
  const lines = (parts.find((p) => p.head === "Firings")?.items || []).filter((x) => x.k === "text");
  lines.forEach((x, n) => { if (made[n]) x.go = made[n]; });
  return { id: a.id, title: a.name, task: false, automation: true, parts };
}
