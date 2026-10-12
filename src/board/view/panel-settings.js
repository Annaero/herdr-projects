// The settings in the task panel: every setting this task runs on, and its agent's session. A new setting's row goes here.
import fs from "node:fs";
import path from "node:path";
import * as S from "../../store.js";
import { herdr, sessionName } from "../../herdr.js";
import { fullAccess, hasFast } from "../../agents.js";
import { short, tokens } from "./words.js";

export class PanelSettings {
  // Returns the settings' part, its rows, the table that draws them, and whether something is shorter here than on
  // the full screen.
  panelSettings(p) {
    const { r, full, t, room, agent, dim, quiet, wrap, head, fact, part } = p;
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
    // Where the worktree is, full screen only: beside the list its long path would take the lines of three settings.
    rows.push(["Worktree", tree ? (full ? `on · ${short(tree)}` : "on") : !r.startedOnce && wtMode !== "none" && (RX ? RX.canWorktree : S.canWorktree(folder)) ? "on" : "off", !!r.worktreeMode]);
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
    // A table of labels and what they name, each value wrapped whole. A line never ends in the dot between two
    // facts: the dot goes with the fact after it, and is left out where that fact starts a line. Full screen a
    // choice made for this task alone is starred, and the star is wrapped with the value: it never runs over the edge.
    const lines = (v) => String(v).split("\n").flatMap((text) => {
      const rows = []; let row = "";
      for (const word of text.replace(/ · /g, " ·\0").split(" ")) { if (row && row.length + 1 + word.length > room) { rows.push(row); row = word.replace(/^·\0/, ""); } else row = row ? `${row} ${word}` : word; }
      return [...rows, row].map((l) => l.replace(/\0/g, " "));
    });
    const table = (list) => list.flatMap(([k, v, differs]) => { const star = full && differs, x = fact(k, lines(star ? `${v} *` : v), (l) => (differs ? l : quiet(l))); if (star) x[x.length - 1] = x[x.length - 1].replace(/\*$/, t.fg("accent", "*")); return x; });
    const settings = part([head("Settings"), ...table(rows), ...(full && rows.some(([, , differs]) => differs) ? wrap("* this task's own, not your default").map((l) => dim(l).replace("*", t.fg("accent", "*"))) : [])]);
    if (full && session.length) part([head("Session"), ...table(session)]);
    return { settings, rows, table, cut: !full && !!tree };
  }
}
