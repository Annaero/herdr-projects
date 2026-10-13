// `show`: every setting, its value and the place it came from, for you or for one task; and what is wrong in a file
// somebody edited by hand.
import { AGENTS } from "../../agents/kinds.js";
import { SETTINGS, needsRepo } from "../settings-list.js";
import { agentOf, say } from "./values.js";
import { yours, repoFile } from "./places.js";
import { folderOf } from "../repos.js";
import { lookup, placesOf, inRepo } from "./lookup.js";
import { repoKeys } from "../keys.js";

// One row per setting: { name, value, from, place, own, kind, note }. `own`: said in the nearest place of the scope
// (this task, or you). `note`: why a value does nothing here.
export function rows(scope = {}) {
  const mine = yours(), task = scope.task || null, at = placesOf(scope, mine);
  const noRepo = at.noRepo;
  return SETTINGS.filter((s) => task || (scope.repo ? s.kind !== "board" : s.kind !== "repo")).map((s) => {
    const r = lookup(s.name, scope, mine, at);
    let note = "";
    if (noRepo && needsRepo(s.name)) note = "does not apply: this task is in no repo";
    else if (s.name === "repo.key" && r.value !== "none" && (task || scope.repo)) { const repo = scope.repo || String(task.id).split("/")[0]; if (repoKeys()[repo] !== r.value) note = "not used: another repo says the same key"; }
    else if (s.name.endsWith(".fast") && r.value === true) {
      const { kind } = agentOf(lookup(`${s.name.split(".")[0]}.agent`, scope, mine, at).value);
      if (kind && typeof AGENTS[kind]?.fast !== "function") note = `does nothing: ${kind} has no fast mode`;
    }
    return { name: s.name, kind: s.kind, value: r.value, from: r.from, place: r.place, own: r.place === (task ? "task" : scope.repo ? "repo" : "you"), note };
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
  const lines = list.map((r) => `${r.own ? "*" : " "} ${r.name.padEnd(wide)}  ${say(r.value).replace(/\s*\n\s*/g, " / ").padEnd(val)}  ${r.note || r.from}`);
  const bad = problems(task);
  return [head, ...lines, ...(bad.length ? ["", "Not counted (the next place down is used for each):", ...bad.map((b) => `  ${b}`)] : [])].join("\n");
}
