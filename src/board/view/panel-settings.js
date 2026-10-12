// The settings in the task panel: every setting this task runs on, and its agent's session. A new setting's row goes here.
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import fs from "node:fs";
import path from "node:path";
import * as S from "../../store.js";
import { herdr, sessionName } from "../../herdr.js";
import { fullAccess, hasFast } from "../../agents.js";
import { short, tokens } from "./words.js";

export class PanelSettings {
  // Returns the settings' part, its rows, and the table that draws them.
  panelSettings(p) {
    const { r, full, t, w, agent, dim, quiet, head, first, part } = p;
    // Every setting, always: one that is only your default is still what this task runs on. Each row is
    // [label, value, is it this task's own choice].
    const rows = [];
    const RX = r.host ? r.snap || {} : null;
    const folder = RX ? RX.folder : S.folderOf(r.id);
    const tree = RX ? RX.tree : r.worktree && fs.existsSync(r.worktree) ? r.worktree : "";
    const ch = RX ? RX.choices || {} : S.choices(r);
    rows.push(["Project", short(folder || ""), !r.host && !!this.repo && path.resolve(String(folder || "")) !== path.resolve(this.repo.root)]);
    if (r.host) rows.push(["Machine", r.host, true]);
    const wtMode = r.worktreeMode || (RX ? RX.worktree : S.config().worktree);
    rows.push(["Worktree", tree ? `on · ${short(tree)}` : !r.startedOnce && wtMode !== "none" && (RX ? RX.canWorktree : S.canWorktree(folder)) ? "on" : "off", !!r.worktreeMode]);
    const branch = RX ? RX.branch : S.branchOf(tree || folder);
    if (branch) rows.push(["Branch", branch + (tree && r.from ? `  (from ${r.from === "HEAD" ? "your checkout" : r.from})` : ""), false]);
    const own = r.own || {};
    const mine = (...keys) => keys.some((k) => own[k] !== undefined && own[k] !== null);
    const kind = r.agent || ch.agent;
    // Each role reads the same way: program and version, model, effort. The version is the one saved at launch.
    // Two defaults share the word, so the row keeps to one line beside the list.
    const role = (name, model, effort) => `${name} · ${model || effort ? `${model || "default model"} · ${effort || "default effort"}` : "default model, effort"}`;
    // Fast mode is said only where it is on. On for a kind that has none, the row says that it does nothing.
    const fast = (k, on) => (!on ? "" : hasFast(k) ? " · fast" : ` · no fast mode in ${k}`);
    rows.push(["Agent", role(`${kind}${r.agentVersion ? ` ${r.agentVersion}` : ""}`, ch.model, ch.effort) + fast(kind, ch.fast), mine("agent", "model", "effort", "fast")]);
    // No reviewer, or no review at all for this task, reads as "off".
    const noReview = !ch.reviewer || ch.reviewer === "off" || ch.review === "none";
    rows.push(["Reviewer", noReview ? "off" : role(ch.reviewer, ch.reviewerModel, ch.reviewerEffort) + fast(ch.reviewer, ch.reviewerFast), mine("reviewer", "reviewerModel", "reviewerEffort", "reviewerFast", "review")]);
    // How this task is reviewed: what gets a review, who sends a review back, and the evidence the reviewer brings.
    rows.push(["Reviewed", noReview ? "nothing" : ch.review === "all" ? "all work" : "work in a repo", mine("review", "reviewer")]);
    rows.push(["Send back", `${!ch.gate || ch.gate === "off" ? "by hand" : ch.gate === "trivial" ? "any finding" : ch.gate === "critical" ? "critical only" : `${ch.gate} or worse`} · ${ch.rounds ?? "?"} round${ch.rounds === 1 ? "" : "s"} max`, mine("gate", "reviewAuto", "rounds")]);
    rows.push(["Evidence", ch.artifacts === false ? "off" : `on · ${ch.serve === "local" ? "local links" : `${ch.serve || "tailscale"} links`}`, mine("artifacts", "serve")]);
    const conf = RX ? RX.config || {} : S.config();
    rows.push(["Watcher", ch.watcher === "off" ? "off" : `${conf.watcherAgent || conf.helper || "claude"} · ${conf.watcherModel || conf.helperModel || "default model"}`, mine("watcher")]);
    rows.push(["Merge", ch.autoMerge ? "by itself, once it passes" : "after your yes", mine("autoMerge")]);
    rows.push(["Conflicts", ch.conflictAuto ? "repaired automatically" : "repaired by hand", mine("conflictAuto")]);
    rows.push(["Permissions", (RX ? RX.fullAccess : fullAccess(kind)) ? "full access" : "asks before acting", false]);
    const fell = Object.values(r.fallbacks || {}).filter(Boolean);
    if (fell.length) rows.push(["Note", fell.join("\n"), true]);
    // The agent's session, full screen only. Context fullness and token use come from its saved conversation: blank
    // when that cannot be read, and the fullness only for a model whose window is known.
    const session = [];
    const usage = agent ? r.usage : null;
    if (usage && usage.context && usage.window) session.push(["Context", `${Math.min(100, Math.round((usage.context / usage.window) * 100))}% full of ${tokens(usage.window)}`, false]);
    if (usage) session.push(["Tokens", `${tokens(usage.in)} in · ${tokens(usage.out)} out`, false]);
    if (r.link?.pane) session.push(["herdr", `${r.link.socket && !r.host ? `session ${sessionName(r.link.socket)} · ` : ""}space ${r.link.workspace || "?"} · pane ${r.link.pane}${r.link.agent ? ` · ${r.link.agent}` : ""}`, false]);
    const kw = Math.max(...[...rows, ...session].map(([k]) => k.length)) + 2;
    const stacked = w - kw < 16; // stack labels at narrow widths instead of clipping the values beside them
    const indent = stacked ? 2 : kw, room = Math.max(1, w - indent);
    // A table of labels and what they name. Full screen a value wraps and a choice made for this task alone is
    // starred; beside the list a row keeps to `most` lines, so the whole table is always there.
    const table = (list, most = 2) => list.flatMap(([k, v, differs]) => {
      let cells = String(v).split("\n").flatMap((l) => { const x = wrapTextWithAnsi(l, room); return x.length ? x : [""]; });
      if (!full) cells = first(cells, most, room);
      cells = cells.map((x) => (differs ? x : quiet(x)));
      if (full && differs) cells[cells.length - 1] += t.fg("accent", " *");
      return [...(stacked ? [dim(k)] : []), (stacked ? " ".repeat(indent) : dim(k.padEnd(kw))) + (cells[0] ?? ""), ...cells.slice(1).map((x) => " ".repeat(indent) + x)];
    });
    const settings = part([head("Settings"), ...table(rows), ...(full && rows.some(([, , differs]) => differs) ? [t.fg("accent", "*") + dim(" this task's own, not your default")] : [])]);
    if (full && session.length) part([head("Session"), ...table(session)]);
    return { settings, rows, table };
  }
}
