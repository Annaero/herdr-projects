// `show`: every setting, its value and the place it came from, for you or for one task; and what is wrong in a file
// somebody edited by hand.
import { AGENTS } from "../../agents/kinds.js";
import { SETTINGS, needsRepo } from "../settings-list.js";
import { agentOf, say } from "./values.js";
import { yours, repoFile } from "./places.js";
import { folderOf } from "../repos.js";
import { lookup, placesOf, inRepo } from "./lookup.js";
import { repoKeys } from "../keys.js";
import { RESEARCH } from "../old-research.js";
import { laterWords } from "../../research.js";

// Why a value does nothing where it stands: one reason per entry, each a block of its own, and the first that says
// something is the note. A new reason goes beside the ones of its area, never at the end.
// Each gets { s: the setting, r: its value and place, task, scope, noRepo, get: the value of another setting here }.
const NOTES = [
  ({ s, noRepo }) => (noRepo && needsRepo(s.name) ? "does not apply: this task is in no repo" : ""),
  ({ s, r, task, scope }) => {
    if (s.name !== "repo.key" || r.value === "none" || !(task || scope.repo)) return "";
    const repo = scope.repo || String(task.id).split("/")[0];
    return repoKeys()[repo] !== r.value ? "not used: another repo says the same key" : "";
  },
  ({ s, task }) => (s.name === "attempts.by" && task?.startedOnce ? "its work has begun: counts when it is started afresh" : ""),
  ({ s, r, get }) => {
    if (!s.name.endsWith(".fast") || r.value !== true) return "";
    const { kind } = agentOf(get(`${s.name.split(".")[0]}.agent`));
    return kind && typeof AGENTS[kind]?.fast !== "function" ? `does nothing: ${kind} has no fast mode` : "";
  },
  // A program whose tokens cannot be counted adds nothing to the count: said for the task's own agent and its reviewer.
  ({ s, r, task, get }) => {
    if (s.name !== "limit.tokens" || r.value === "none") return "";
    const kinds = [task?.agent || agentOf(get("worker.agent")).kind, get("review.when") === "never" ? "" : agentOf(get("reviewer.agent")).kind].filter((k) => k && typeof AGENTS[k]?.tokens !== "function");
    return kinds.length ? `does nothing for ${[...new Set(kinds)].join(" and ")}: its tokens cannot be counted` : "";
  },
  // A list of agents does nothing where its only use is to hand over to the one that is on it anyway.
  ({ s, r, get }) => (s.type === "agents" && Array.isArray(r.value) && r.value.every((a) => a === get(`${s.name.split(".")[0]}.agent`)) ? `does nothing: ${r.value[0]} is the ${s.name.split(".")[0] === "worker" ? "agent" : "reviewer"} already` : ""),
];
// One row per setting: { name, value, from, place, own, kind, note, later }. `own`: said in the nearest place of the
// scope (this task, or you). `note`: why a value does nothing here (NOTES). `later`: a value that counts from the
// task's next start only, said after the place it came from.
export function rows(scope = {}) {
  const mine = yours(), task = scope.task || null, at = placesOf(scope, mine);
  const noRepo = at.noRepo, get = (name) => lookup(name, scope, mine, at).value;
  return SETTINGS.filter((s) => task || (scope.repo ? s.kind !== "board" : s.kind !== "repo")).map((s) => {
    const r = lookup(s.name, scope, mine, at);
    let note = "";
    for (const why of NOTES) { note = why({ s, r, task, scope, noRepo, get }); if (note) break; }
    return { name: s.name, kind: s.kind, value: r.value, from: r.from, place: r.place, own: r.place === (task ? "task" : scope.repo ? "repo" : "you"), note, ...(s.name === RESEARCH && task && laterWords(task, r.value) ? { later: laterWords(task, r.value) } : {}) };
  });
}
// What is wrong in the files, one sentence each. The board keeps running: each such setting falls to the next place.
export function problems(task = null) {
  const mine = yours(), scope = task ? { task } : {}, at = placesOf(scope, mine);
  const out = [...mine.problems, ...at.problems].map((p) => `${p.where}: ${p.why}`);
  // An effort or an access that does not fit the program its role has: said, and not counted.
  for (const s of SETTINGS) if ((s.type === "effort" || s.type === "access") && (task ? s.kind === "work" : true)) out.push(...(lookup(s.name, scope, mine, at).skipped || []));
  // What the repo's own file was refused: as the task took it when it started, else as the file stands now.
  if (task) { let refused = task.repoRefused; if (!refused && !task.repoFile) { try { if (inRepo(task)) refused = repoFile(folderOf(task.id)).refused; } catch {} } out.push(...(refused || [])); }
  return out;
}
export function showText(scope = {}) {
  const list = rows(scope), task = scope.task || null;
  const wide = Math.max(...list.map((r) => r.name.length)), val = Math.max(...list.map((r) => say(r.value).split("\n")[0].length).filter((n) => n <= 40));
  const head = task ? `${task.id}: every setting, and the place it came from (* = this task's own)` : scope.repo ? `Your entry for ${scope.repo} (* = said there)` : "Your settings (* = changed by you)";
  const lines = list.map((r) => `${r.own ? "*" : " "} ${r.name.padEnd(wide)}  ${say(r.value).replace(/\s*\n\s*/g, " / ").padEnd(val)}  ${r.note || r.from}${r.later ? ` · ${r.later}` : ""}`);
  const bad = problems(task);
  // A task done several times at once names each attempt's agent, and the one that was chosen.
  if (task?.attempts?.length) lines.push("", `Attempts: ${task.attempts.map((a) => `${a.letter} ${a.agent}${task.picked?.letter === a.letter ? " (chosen)" : ""}`).join(" · ")}`);
  return [head, ...lines, ...(bad.length ? ["", "Not counted (the next place down is used for each):", ...bad.map((b) => `  ${b}`)] : [])].join("\n");
}
