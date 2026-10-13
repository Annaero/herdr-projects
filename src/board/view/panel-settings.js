// The settings in the task panel: what this task runs on, in a few rows, and its agent's session. Every setting by
// its name, each one changeable, is the settings page (panel-edit.js).
import fs from "node:fs";
import path from "node:path";
import * as S from "../../store.js";
import { sessionName } from "../../herdr.js";
import { short, tokens } from "./words.js";
import { name as keyName } from "../keys.js";
import { isResearch } from "../../research.js";

// A task's settings, each with the place it came from: this machine's own lookup, or what the task's machine sent.
export const settingsOf = (r) => (r.host ? r.snap?.settings || [] : S.settingRows({ task: r }));

export class PanelSettings {
  // Returns the settings' part, its rows, the table that draws them, and whether something is shorter here than on
  // the full screen.
  panelSettings(p) {
    const { r, full, t, room, agent, dim, quiet, wrap, head, fact, part } = p;
    // Each row is [label, value, is it this task's own choice, is it a fact about the task and no setting of its].
    const rows = [];
    const RX = r.host ? r.snap || {} : null;
    const folder = RX ? RX.folder : S.folderOf(r.id);
    const tree = RX ? RX.tree : r.worktree && fs.existsSync(r.worktree) ? r.worktree : "";
    const all = Object.fromEntries(settingsOf(r).map((x) => [x.name, x]));
    const val = (name) => all[name]?.value;
    const mine = (...names) => names.some((n) => all[n]?.own || (n.endsWith(".") && Object.values(all).some((x) => x.own && x.name.startsWith(n))));
    rows.push(["Project", short(folder || ""), !r.host && !!this.repo && path.resolve(String(folder || "")) !== path.resolve(this.repo.root), true]);
    if (r.host) rows.push(["Machine", r.host, true, true]);
    // Where the worktree is, full screen only: beside the list its long path would take the lines of three settings.
    rows.push(["Worktree", tree ? (full ? `on · ${short(tree)}` : "on") : !r.startedOnce && (RX ? RX.canWorktree : S.canWorktree(folder)) ? "on" : "off", false]);
    const branch = RX ? RX.branch : S.branchOf(tree || folder);
    if (branch) rows.push(["Branch", branch + (tree && r.from ? `  (from ${r.from === "HEAD" ? "your checkout" : r.from})` : ""), false]);
    // Each role reads the same way: program and version, model, effort; fast and "asks first" only where they are so.
    const role = (name, kind, version = "") => {
      const who = S.agentOf(val(`${name}.agent`)), k = kind || who.kind, model = k === who.kind ? who.model : "", effort = val(`${name}.effort`) === "default" ? "" : val(`${name}.effort`);
      const fast = val(`${name}.fast`) !== true ? "" : all[`${name}.fast`]?.note ? ` · no fast mode in ${k}` : " · fast";
      return `${k}${version ? ` ${version}` : ""} · ${model || "default model"} · ${effort || "default effort"}${fast}${val(`${name}.access`) === "ask" ? " · asks before acting" : ""}`;
    };
    rows.push(["Agent", role("worker", r.agent, r.agentVersion), mine("worker.")]);
    // Done several times at once: how many and by whom, and who picks (attempts.js).
    if (r.attempts?.length > 1 || S.attemptCount(val("attempts.by")) > 1) rows.push(["Attempts", `${r.attempts?.length > 1 ? r.attempts.map((a) => `${a.letter} ${a.agent}`).join(", ") : S.say(val("attempts.by"))} · ${r.picked ? `${r.picked.letter} was chosen` : val("attempts.pick") === "reviewer" ? "the reviewer picks" : "you pick"}`, mine("attempts.")]);
    const noReview = val("review.when") === "never";
    rows.push(["Reviewer", noReview ? "off" : role("reviewer"), mine("reviewer.", "review.when")]);
    rows.push(["Review when", noReview ? "never" : val("review.when") === "always" ? "always" : "the task is in a repo", mine("review.when")]);
    const bar = val("review.mustFix"), rounds = val("review.rounds");
    rows.push(["Send back", `${bar === "trivial" ? "any finding" : bar === "critical" ? "critical only" : `${bar} or worse`} · ${rounds === 0 ? "by hand" : `${rounds ?? "?"} round${rounds === 1 ? "" : "s"} max`}`, mine("review.mustFix", "review.rounds")]);
    rows.push(["Evidence", val("review.evidence") === false ? "off" : "on", mine("review.evidence")]);
    // A research-only task merges nothing: its row says so in place of how it would merge.
    if (isResearch(r)) rows.push(["Research", "only · no change to the repo", mine("research.only")]);
    else rows.push(["Merge", val("merge.by") === "itself" ? "by itself, once it passes" : "after your yes", mine("merge.by")]);
    const notes = [...Object.values(r.fallbacks || {}).filter(Boolean), ...(RX ? RX.problems || [] : S.settingProblems(r)).map((x) => `Not counted: ${x}`)];
    if (notes.length) rows.push(["Note", notes.join("\n"), true, true]);
    // The agent's session, full screen only. Context fullness and token use come from its saved conversation: blank
    // when that cannot be read, and the fullness only for a model whose window is known.
    const session = [];
    const usage = agent ? r.usage : null;
    if (usage && usage.context && usage.window) session.push(["Context", `${Math.min(100, Math.round((usage.context / usage.window) * 100))}% full of ${tokens(usage.window)}`, false]);
    if (usage) session.push(["Tokens", `${tokens(usage.in)} in · ${tokens(usage.out)} out`, false]);
    // The task's id as a command takes it: the one place the panel says it (everywhere else it is the row's tag).
    session.push(["Task id", r.rid || r.id, false]);
    if (r.link?.pane) session.push(["herdr", `${r.link.socket && !r.host ? `session ${sessionName(r.link.socket)} · ` : ""}space ${r.link.workspace || "?"} · pane ${r.link.pane}${r.link.agent ? ` · ${r.link.agent}` : ""}`, false]);
    // A table of labels and what they name, each value wrapped whole. A line never ends in the dot between two
    // facts: the dot goes with the fact after it, and is left out where that fact starts a line. Full screen a
    // choice made for this task alone is starred, and the star is wrapped with the value: it never runs over the edge.
    const lines = (v) => String(v).split("\n").flatMap((text) => {
      const rows = []; let row = "";
      for (const word of text.replace(/ · /g, " ·\0").split(" ")) { if (row && row.length + 1 + word.length > room) { rows.push(row); row = word.replace(/^·\0/, ""); } else row = row ? `${row} ${word}` : word; }
      return [...rows, row].map((l) => l.replace(/\0/g, " "));
    });
    // On the web board there is no star to explain and no key to name: a row of this task's own says so in words,
    // and the line under the rows names the command that changes one.
    const web = !!this.ctx?.web, own = web ? "(this task's own)" : "*";
    const table = (list) => list.flatMap(([k, v, differs, fact_]) => { const star = full && differs && !(web && fact_), x = fact(k, lines(star ? `${v} ${own}` : v), (l) => (differs ? l : quiet(l))); if (star && !web) x[x.length - 1] = x[x.length - 1].replace(/\*$/, t.fg("accent", "*")); return x; });
    const change = web ? "All settings, below, has every one of them, and changes them" : `${keyName("settings")} changes them: every setting, and the place each one comes from`;
    const foot = full ? [...(!web && rows.some(([, , differs]) => differs) ? wrap("* this task's own, not what it would be otherwise").map((l) => dim(l).replace("*", t.fg("accent", "*"))) : []), ...(r.archivedAt ? [] : wrap(change).map(dim))] : [];
    // Beside the list only what differs from what it would be anyway: the rows that are this task's own (and a
    // note, which is always about this task). The usual ones are a key away, on the whole task and its settings page.
    const shown = full ? rows : rows.filter(([, , differs]) => differs);
    const usual = !full && shown.length < rows.length ? wrap(shown.length ? `the rest as usual · ${keyName("settings")} shows every setting` : `all as usual · ${keyName("settings")} shows them`).map(dim) : [];
    const settings = part([head("Settings"), ...table(shown), ...usual, ...foot]);
    if (full && session.length) part([head("Session"), ...table(session)]);
    return { settings, rows: shown, table, cut: !full && !!tree };
  }
}
