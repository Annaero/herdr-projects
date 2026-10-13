// The settings in the task panel: every setting this task runs with, a few to a row, each one that is not the built-in
// value marked with the place it came from; and its agent's session. Every setting by its name, each one changeable,
// is the settings page (panel-edit.js).
import fs from "node:fs";
import path from "node:path";
import * as S from "../../store.js";
import { sessionName } from "../../herdr.js";
import { hasFast } from "../../agents/start.js";
import { short, tokens } from "./words.js";
import { name as keyName } from "../keys.js";
import { isResearch } from "../../research.js";

// A task's settings, each with the place it came from: this machine's own lookup, or what the task's machine sent.
export const settingsOf = (r) => (r.host ? r.snap?.settings || [] : S.settingRows({ task: r }));
// Where a value came from, in the panel's words; nothing for a built-in one.
const PLACES = { task: "this task", repo: "you, for this repo", you: "you", file: "this repo" };
export const cameFrom = (x) => (!x || x.place === "builtin" || x.from === "built in" ? "" : PLACES[x.place] || x.from || "");
// The rows that stay longest where there is no room for all of them, after the ones with a value of their own.
const MAIN = ["Agent", "Reviewer", "Review when", "Send back", "Merge", "Research"];

export class PanelSettings {
  // Returns the settings' part, its rows, what draws rows as lines, and whether something is shorter here than on
  // the full screen.
  panelSettings(p) {
    const { r, full, t, agent, dim, quiet, wrap, head, fact, flow, part } = p;
    // A row is a label and what it says: { label, items: [{ text, names: the settings it says }] }. A row with `fact`
    // is about the task and no setting of its; one with `mark` as well is worth its line beside the list.
    const rows = [];
    const RX = r.host ? r.snap || {} : null;
    const folder = RX ? RX.folder : S.folderOf(r.id);
    const tree = RX ? RX.tree : r.worktree && fs.existsSync(r.worktree) ? r.worktree : "";
    const all = Object.fromEntries(settingsOf(r).map((x) => [x.name, x]));
    const val = (name) => all[name]?.value;
    const from = (...names) => [...new Set(names.map((n) => cameFrom(all[n])).filter(Boolean))].join(", ");
    const applies = (name) => !!all[name] && !/^does not apply/.test(all[name].note || "");
    const it = (text, ...names) => (text ? { text: String(text), names } : null);
    const row = (label, items, o = {}) => { const list = items.filter(Boolean); if (list.length) rows.push({ label, items: list, ...o }); };
    row("Project", [it(short(folder || ""))], { fact: true, mark: !r.host && !!this.repo && path.resolve(String(folder || "")) !== path.resolve(this.repo.root) });
    if (r.host) row("Machine", [it(r.host)], { fact: true, mark: true });
    // Where the worktree is and its branch: on the whole task only, beside the list their lines are the settings'.
    row("Worktree", [it(tree ? `on · ${short(tree)}` : !r.startedOnce && (RX ? RX.canWorktree : S.canWorktree(folder)) ? "on" : "off")], { fact: true });
    const branch = RX ? RX.branch : S.branchOf(tree || folder);
    if (branch) row("Branch", [it(branch + (tree && r.from ? `  (from ${r.from === "HEAD" ? "your checkout" : r.from})` : ""))], { fact: true });
    // Each role reads the same way: program and version with its model, effort; fast, "asks first" and words of
    // your own only where they are so, or where somebody said otherwise. Where an agent took over from another
    // (docs/fallback.md), the row is the one that is on it now.
    const role = (name, kind, version = "") => {
      const who = S.agentOf((name === "worker" ? r.on : r.reviewerOn) || val(`${name}.agent`)), k = kind || who.kind, model = k === who.kind ? who.model : "", effort = val(`${name}.effort`) === "default" ? "" : val(`${name}.effort`);
      const fast = val(`${name}.fast`) === true ? (all[`${name}.fast`]?.note || !hasFast(k) ? `no fast mode in ${k}` : "fast") : from(`${name}.fast`) && hasFast(k) ? "fast mode off" : "";
      const access = val(`${name}.access`) === "ask" ? "asks before acting" : from(`${name}.access`) ? "acts without asking" : "";
      return [it(`${k}${version ? ` ${version}` : ""} · ${model || "default model"}`, `${name}.agent`), it(`${effort || "default"} effort`, `${name}.effort`), it(fast, `${name}.fast`), it(access, `${name}.access`), it((val(`${name}.instructions`) ?? "none") !== "none" && "words of your own", `${name}.instructions`)];
    };
    // Under each of the two: who takes over when it cannot go on. With no list for either, one word says so (below).
    const backups = ["worker.fallback", "reviewer.fallback"], backed = backups.some((n) => Array.isArray(val(n)));
    const takes = (name) => backed && row("Takes over", [it(`${Array.isArray(val(name)) ? val(name).join(", then ") : "nobody"} · when the ${name === "worker.fallback" ? "agent" : "reviewer"} cannot go on`, name)]);
    row("Agent", role("worker", r.agent, r.agentVersion)); takes("worker.fallback");
    // A plan first: who says yes to it, and who writes it when that is not the working agent.
    const planBy = val("plan.approve"), planner = S.agentOf(val("plan.agent"));
    row("Plan first", !planBy || planBy === "none" ? [it("off", "plan.approve"), from("plan.agent") && it(`would be written by ${planner.kind ? `${planner.kind}${planner.model ? ` · ${planner.model}` : ""}` : "the agent"}`, "plan.agent")] : [it(planBy === "reviewer" ? "the reviewer approves it" : "you approve it", "plan.approve"), it(`written by ${planner.kind ? `${planner.kind}${planner.model ? ` · ${planner.model}` : ""}` : "the agent"}`, "plan.agent")]);
    // Done several times at once: how many and by whom, and who picks (attempts.js).
    const many = r.attempts?.length > 1 || S.attemptCount(val("attempts.by")) > 1;
    if (many) row("Attempts", [it(r.attempts?.length > 1 ? r.attempts.map((a) => `${a.letter} ${a.agent}`).join(", ") : S.say(val("attempts.by")), "attempts.by"), it(r.picked ? `${r.picked.letter} was chosen` : val("attempts.pick") === "reviewer" ? "the reviewer picks" : "you pick", "attempts.pick")]);
    const noReview = val("review.when") === "never";
    // With nothing reviewed the reviewer is off: of what it would be, only what somebody chose is still said.
    const chosen = (items) => items.filter((i) => i && from(...i.names));
    row("Reviewer", noReview ? [it("off", "review.when"), ...chosen(role("reviewer"))] : role("reviewer")); takes("reviewer.fallback");
    row("Review when", [it(noReview ? "never" : val("review.when") === "always" ? "always" : "in a repo", "review.when"), (!noReview || from("review.evidence")) && it(val("review.evidence") === false ? "no evidence" : "with evidence", "review.evidence")]);
    const bar = val("review.mustFix"), rounds = val("review.rounds");
    row("Send back", [it(bar === "trivial" ? "any finding" : bar === "critical" ? "critical only" : `${bar} or worse`, "review.mustFix"), it(rounds === 0 ? "by hand" : `${rounds ?? "?"} round${rounds === 1 ? "" : "s"} max`, "review.rounds")]);
    // What counts as done: the check, and how long it may run. Nothing to say for a task in no repo.
    const check = val("check.command") ?? "none";
    if (applies("check.command")) row("Check", [it(check === "none" ? "no command" : check, "check.command"), it(`${val("check.timeout")} at most`, "check.timeout")]);
    // A research-only task merges nothing: its row says so in place of how it would merge.
    const research = isResearch(r);
    if (research) row("Research", [it("only · no change to the repo", "research.only")]);
    else row("Merge", [it(val("merge.by") === "itself" ? "by itself, once it passes" : "after your yes", "merge.by"), applies("merge.method") && it(val("merge.method"), "merge.method"), applies("merge.pr") && it(val("merge.pr") === false ? "no pull request" : "opens a pull request", "merge.pr")]);
    // What it may take: a row where a limit is set, and where this task has one of its own.
    const time = val("limit.time") ?? "none", most = val("limit.tokens") ?? "none", limited = time !== "none" || most !== "none" || !!from("limit.time", "limit.tokens");
    if (limited) row("Limits", [it(time !== "none" ? `${time} a run` : "no time limit", "limit.time"), it(most === "none" ? "no token limit" : all["limit.tokens"]?.note ? `${most} tokens, not counted` : `${most} tokens`, "limit.tokens")]);
    // Where it works: what its worktree starts from, what is done to it, and whether it is kept.
    const said = (name) => (val(name) ?? "none") !== "none" && S.say(val(name)).replace(/\s*\n\s*/g, " / ");
    if (applies("workspace.from")) row("Workspace", [it(`from ${val("workspace.from") === "here" ? "your checkout" : "main"}`, "workspace.from"), it(said("workspace.setup") && `set up with ${said("workspace.setup")}`, "workspace.setup"), it(said("workspace.include") && `copies ${said("workspace.include")}`, "workspace.include"), it(said("workspace.teardown") && `torn down with ${said("workspace.teardown")}`, "workspace.teardown"), it(val("workspace.cleanup") === false ? "kept when done" : "removed when done", "workspace.cleanup")]);
    // What has a row of its own only when it is something: said in a word each while it is nothing.
    row("Also", [!many && it("one attempt", "attempts.by", "attempts.pick"), !research && it("not research only", "research.only"), !limited && it("no limits", "limit.time", "limit.tokens"), !backed && it("no fallback", ...backups)]);
    const notes = [...Object.values(r.fallbacks || {}).filter(Boolean), ...(RX ? RX.problems || [] : S.settingProblems(r)).map((x) => `Not counted: ${x}`)];
    if (notes.length) row("Note", [it(notes.join("\n"))], { fact: true, mark: true });
    // Where room is short the rows go from the last of this order: a value somebody chose, then who works, who
    // reviews, the review and the merge, then the rest.
    for (const x of rows) x.rank = x.fact ? 3 : x.items.some((i) => from(...i.names)) ? 0 : MAIN.includes(x.label) ? 1 : 2;
    // The agent's session, full screen only. Context fullness and token use come from its saved conversation: blank
    // when that cannot be read, and the fullness only for a model whose window is known.
    const session = [];
    const fixed = (label, text) => session.push({ label, items: [it(text)], fact: true });
    const usage = agent ? r.usage : null;
    if (usage && usage.context && usage.window) fixed("Context", `${Math.min(100, Math.round((usage.context / usage.window) * 100))}% full of ${tokens(usage.window)}`);
    if (usage) fixed("Tokens", `${tokens(usage.in)} in · ${tokens(usage.out)} out`);
    if (r.spent?.total) fixed("Used so far", `${S.tokensSay(r.spent.total)} tokens, counted for this task`); // limits/spent.js
    // The task's id as a command takes it: the one place the panel says it (everywhere else it is the row's tag).
    fixed("Task id", r.rid || r.id);
    if (r.link?.pane) fixed("herdr", `${r.link.socket && !r.host ? `session ${sessionName(r.link.socket)} · ` : ""}space ${r.link.workspace || "?"} · pane ${r.link.pane}${r.link.agent ? ` · ${r.link.agent}` : ""}`);
    // A table of labels and what they say. A row breaks only between two of its facts, and a line never ends in the
    // dot between them. A value somebody chose is in the text colour, with the place it came from after it in
    // words; one that is the built-in value is quieter. `more` is how many settings have no room: the last line
    // says so, with the key that shows them.
    const ink = (text, on) => text.split("\n").map((l) => (on ? l : quiet(l))).join("\n");
    const say = (x, i) => { const where = x.fact ? "" : from(...i.names); return ink(i.text, x.fact ? x.mark : !!where) + (where ? " " + t.fg("accent", `(${where})`) : ""); };
    const draw = (list, more = 0) => [...list.flatMap((x) => fact(x.label, flow(x.items.map((i) => say(x, i))))), ...(more ? wrap(`${more} more setting${more === 1 ? "" : "s"} · ${keyName("settings")} shows ${more === 1 ? "it" : "them"}`).map(dim) : [])];
    const change = this.ctx?.web ? "All settings, below, has every one of them, and changes them" : `${keyName("settings")} changes them: every setting, and the place each one comes from`;
    const foot = full && !r.archivedAt ? wrap(change).map(dim) : [];
    // Beside the list every setting, and of the facts about the task only what is worth its line there.
    const shown = full ? rows : rows.filter((x) => !x.fact || x.mark);
    const settings = part([head("Settings"), ...draw(shown), ...foot]);
    if (full && session.length) part([head("Session"), ...draw(session)]);
    return { settings, rows: shown, draw, cut: !full && !!tree };
  }
}
export const part = PanelSettings; // what this file adds to the board: view.js loads every file here that names its part
