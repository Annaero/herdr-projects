// The report in the task panel: that a task is research only, and the link to the report its agent wrote.
import { artifactRows } from "../artifact-lines.js";
import { isResearch } from "../../research.js";
import { age } from "./words.js";

export class PanelReport {
  // A part of its own, for a research-only task (with or without a report yet) and for any task that has a report.
  // Beside the list: the link by its name. Full screen: also when it was kept, and the link printed in full.
  panelReport(p) {
    const { r, full, t, w, room, dim, wrap, head, part } = p;
    const research = isResearch(r), rep = r.report && (r.report.link || r.report.file) ? r.report : null;
    if (!research && !rep) return;
    const lines = [head(research ? "Research only" : "Report")];
    if (research) lines.push(...wrap(rep ? "Changes nothing in the repo." : "Changes nothing in the repo. No report yet.", w).map((l) => dim(l)));
    if (rep) lines.push(...artifactRows(t, { link: rep.link, caption: "Open report", detail: full ? `${rep.file}${rep.at ? ` · kept ${age(Date.now() - rep.at)} ago` : ""}` : "" }, full ? w : room + 2, full));
    part(lines);
  }
}
export const part = PanelReport; // what this file adds to the board: view.js loads every file here that names its part
