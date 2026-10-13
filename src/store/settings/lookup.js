// The one lookup. A work setting is looked up in one order and the nearest answer wins:
//   this task -> your entry for this repo -> you -> the repo's own file -> built in
// A board setting is yours only: you -> built in. A repo's own fact (its key) is said for that repo only: your entry
// for the repo -> the repo's own file, as it is in the repo's folder now -> built in. No setting has a lookup of its own. A setting is read when its
// step starts (the agent at its next start, the review settings at the next review, the merge settings right before
// the merge): callers ask here at that moment and keep nothing.
import { folderOf, isRepo, knownRepos } from "../repos.js";
import { SETTINGS, WORK, entryOf, needsRepo } from "../settings-list.js";
import { known, fits, NONE } from "./values.js";
import { yours, repoFile, read } from "./places.js";
import path from "node:path";
import { dirOf, readJson } from "../files.js";

const repoNameOf = (task) => String(task?.repo || String(task?.id || "").split("/")[0] || "");
// A task in no repo skips the repo places, and where it works, how it is checked and how it lands mean nothing to it.
export const inRepo = (task) => { try { return isRepo(folderOf(task.id)); } catch { return false; } };
// The repo's file as the task took it when its worktree started, else as it is now.
const fileOf = (task) => { if (task.repoFile) return task.repoFile; try { return repoFile(folderOf(task.id)).facts; } catch { return {}; } };

// The places that count for a scope, nearest first: [{ place, from, values }], for a work and for a board setting,
// worked out once for all the settings asked of that scope. `scope`: { task } for one task, { repo } for a repo by its
// name on the board, nothing for you.
const BUILTIN = { place: "builtin", from: "built in", values: Object.fromEntries(SETTINGS.map((s) => [s.name, s.builtin])) };
export function placesOf({ task = null, repo = "" } = {}, mine = yours()) {
  const you = { place: "you", from: "you", values: mine.you };
  const work = [];
  const name = task ? repoNameOf(task) : repo;
  const repoPlaces = !task || inRepo(task);
  // What a task holds is checked like a file a hand may have edited: a wrong value is a problem with its setting's
  // name, and that one setting is not said there.
  const problems = [];
  const held = (obj, where) => { const r = read(obj, where, WORK, "is a board setting, yours only: it cannot be said here"); problems.push(...r.problems); return r.values; };
  // An attempt has its task's settings, as they read now, and its own program (store/attempts.js).
  const said = task?.attemptOf ? { ...(readJson(path.join(dirOf(task.attemptOf), "task.json"))?.settings || {}), ...(task.settings || {}) } : task?.settings;
  if (task) work.push({ place: "task", from: "this task", values: held(said, "this task") });
  // Carried with the task from another machine: that machine's "you" and its entry for the repo, already worked out.
  if (task?.carried) work.push({ place: "carried", from: `sent from ${task.carried.from || "another machine"}`, values: held(task.carried.settings, "sent with this task") });
  else {
    if (name && repoPlaces && mine.repos[name]) work.push({ place: "repo", from: `your entry for ${name}`, values: mine.repos[name] });
    work.push(you);
  }
  // Read only when a setting gets that far down: most are answered above it.
  if (task && repoPlaces) { let facts = null; work.push({ place: "file", from: "the repo's file", get values() { return (facts ??= fileOf(task)); } }); }
  work.push(BUILTIN);
  // A repo's own fact: never a task's and never yours for every repo. Its file is the one in the repo's folder now.
  const own = [];
  if (name && mine.repos[name]) own.push({ place: "repo", from: `your entry for ${name}`, values: mine.repos[name] });
  if (name && knownRepos()[name]) { let facts = null; own.push({ place: "file", from: "the repo's file", get values() { if (!facts) { try { facts = repoFile(knownRepos()[name]).facts; } catch { facts = {}; } } return facts; } }); }
  own.push(BUILTIN);
  return { work, board: [you, BUILTIN], repo: own, noRepo: !!task && !repoPlaces, problems };
}
// { name, value, place, from, applies }. Instructions add up, broadest first; everything else is the nearest answer.
export function lookup(name, scope = {}, mine = undefined, at = placesOf(scope, mine)) {
  const entry = known(name);
  if (at.noRepo && needsRepo(name)) return { name, value: entry.builtin, place: "builtin", from: "built in", applies: false };
  let said = at[entry.kind].filter((p) => p.values[name] !== undefined);
  // An effort and an access are right or wrong for one program: an answer that does not fit the program the role
  // has is not counted, and the next place down is asked (the built-in one fits every program).
  const skipped = [];
  if (entry.type === "effort" || entry.type === "access") {
    const agent = lookup(`${name.split(".")[0]}.agent`, scope, mine, at).value;
    said = said.filter((p) => { const why = p.place === "builtin" ? "" : fits(name, p.values[name], agent); if (why) skipped.push(`${p.from === "you" ? "your settings" : p.from}: ${name}: ${why}`); return !why; });
  }
  if (entry.adds) {
    // `none` in a place cancels what the broader places said.
    const parts = [];
    for (const p of [...said].reverse()) { if (p.values[name] === NONE) parts.length = 0; else parts.push(p); }
    const near = said[0];
    return { name, value: parts.length ? parts.map((p) => p.values[name]).join("\n\n") : NONE, parts: parts.map((p) => ({ from: p.from, value: p.values[name] })), place: near.place, from: parts.length > 1 ? parts.map((p) => p.from).join(" + ") : (parts[0] || near).from, applies: true };
  }
  const p = said[0];
  return { name, value: p.values[name], place: p.place, from: p.from, applies: true, ...(skipped.length ? { skipped } : {}) };
}
export const setting = (name, task = null) => lookup(name, task ? { task } : {}).value;
// Every work setting of one task (or of you, with no task), by name. Board settings are asked one by one.
export function work(task = null, mine = yours()) {
  const scope = task ? { task } : {}, at = placesOf(scope, mine);
  return Object.fromEntries(WORK.map((n) => [n, lookup(n, scope, mine, at).value]));
}
// What only the places above the repo's file say, for a repo: what travels with a task to another machine.
export function toSend(repo, mine = yours()) {
  const out = {};
  for (const n of WORK) {
    const here = mine.repos[repo]?.[n], you = mine.you[n];
    const v = entryOf(n).adds && here !== undefined && here !== NONE && you !== undefined && you !== NONE ? `${you}\n\n${here}` : here ?? you;
    if (v !== undefined) out[n] = v;
  }
  return out;
}
export { entryOf };
