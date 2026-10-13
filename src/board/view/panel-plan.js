// The plan in the task panel: where the plan step stands, the plan's own words, and its private link.
import fs from "node:fs";
import * as G from "../../gate.js";
import { artifactRows } from "../artifact-lines.js";
import { age, tokens } from "./words.js";
import { name as keyName } from "../keys.js";
import { planFile } from "../../plan.js";

// Beside the list the plan is its first lines; full screen it is whole.
const SHORT = 12;

export class PanelPlan {
  // A part of its own for a task that starts with a plan: who wrote it and who approves, the plan, and its link.
  // Returns true where the plan is shorter here than on the full screen.
  panelPlan(p) {
    const { r, full, t, w, room, dim, wrap, head, fact, part } = p;
    const plan = r.plan;
    if (!plan) return false;
    const who = plan.writer ? `${plan.writer.kind}${plan.model || plan.writer.model ? ` · ${plan.model || plan.writer.model}` : ""}` : "the working agent";
    const yes = plan.approvedAt ? `approved by ${plan.approvedBy === "reviewer" ? "the reviewer" : plan.approvedBy === "nobody" ? "nobody: plan.approve was taken off" : "you"} ${age(Date.now() - plan.approvedAt)} ago`
      : r.stage === "plan" ? `waits for your yes` : plan.at ? "written" : "being written";
    const lines = [head("Plan"), ...fact("Stands", wrap(yes, room)), ...fact("Written by", wrap(who, room), dim)];
    // A planner's time and tokens count to the task: said here, since the session below is the working agent's.
    if (plan.took) lines.push(...fact("Planner used", wrap([age(plan.took), plan.usage ? `${tokens(plan.usage.in)} in · ${tokens(plan.usage.out)} out` : ""].filter(Boolean).join(" · "), room), dim));
    const rv = plan.review;
    if (rv) lines.push(...fact("Reviewer", wrap(`${G.result(rv)}${rv.text ? `. ${rv.text}` : ""}`, room)), ...(!plan.approvedAt || full ? rv.findings.flatMap((f) => wrap(`- ${G.findingLine(f)}`, w)) : []));
    if (plan.undone) lines.push(...fact("Put back", wrap(`${plan.undone.n} ${plan.undone.n === 1 ? "change" : "changes"} made in the repo before the yes${full ? `: ${plan.undone.list.join(", ")}` : ""}`, room)));
    if (plan.backs) lines.push(...fact("Sent back", `${plan.backs} ${plan.backs === 1 ? "time" : "times"}`, dim));
    let cut = false;
    if (plan.at) {
      // The plan's own words, from the task's file (plan.js); another machine's task has its link only.
      const text = r.host ? "" : (() => { try { return fs.readFileSync(planFile(r), "utf8").trim(); } catch { return ""; } })();
      const all = text ? wrap(text, w) : [], shown = full ? all : all.slice(0, SHORT);
      if (shown.length) lines.push("", ...shown);
      if (shown.length < all.length) { cut = true; lines.push(dim(`… ${all.length - shown.length} more lines`)); }
      lines.push(...artifactRows(t, { link: plan.link, caption: "Open plan", detail: full ? `${plan.file || "plan.md"} · written ${age(Date.now() - plan.at)} ago` : "" }, full ? w : room + 2, full));
    }
    if (r.stage === "plan" && !r.archivedAt) lines.push("", ...wrap(this.ctx?.web ? "Yes approves this plan and the build starts. A reply sends it back with your words, and it is written again." : `${keyName("yes")} approves this plan and the build starts. A reply (${keyName("talk")}) sends it back with your words, and it is written again.`, w).map((l) => dim(l)));
    part(lines);
    return cut;
  }
}
