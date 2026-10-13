// Changing a setting: `set` and `unset`, for you, for your entry for a repo, or for one task. Every value is checked
// first; several changes to one task are all checked before any is saved, so a refused request changes nothing.
import { assertUnarchived, update } from "../tasks.js";
import { knownRepos } from "../repos.js";
import { check, known, fits, nearest } from "./values.js";
import { writeYours } from "./places.js";
import { lookup, inRepo } from "./lookup.js";
import { needsRepo, entryOf } from "../settings-list.js";
import { saidKeys } from "../keys.js";
import { NONE } from "./values.js";
import { RESEARCH } from "../old-research.js";
import { turnRefusal } from "../../research.js";

const refuse = (msg) => { throw Object.assign(new Error(msg), { refused: true }); };
const roleOf = (name) => name.split(".")[0];
// A board setting is yours only; where a task is in no repo, the repo's settings mean nothing to it.
function allowed(name, { task, repo }) {
  const e = known(name);
  if (e.kind === "board" && (task || repo)) refuse(`${name} is a board setting: it is yours only and cannot be set ${task ? "on a task" : "for a repo"}. Set it for yourself: herdr-superwork set ${name} <value>`);
  if (e.kind === "repo" && !repo) refuse(`${name} is one repo's own: it cannot be set ${task ? "on a task" : "for every repo at once"}. Set it for the repo: herdr-superwork set ${name} <value> --repo <name>, or in the repo's own .herdr-superwork.json.`);
  if (repo && !knownRepos()[repo]) { const near = nearest(repo, Object.keys(knownRepos())); refuse(`No repo "${repo}" on the board.${near ? ` Did you mean ${near}?` : ""} Known: ${Object.keys(knownRepos()).join(", ") || "none yet"}.`); }
  if (task && needsRepo(name) && !inRepo(task)) refuse(`${name} does not apply to ${task.id}: it is in no repo.`);
  return e;
}
// The checked values of a request: { name: value }. An effort and an access are checked against the program they are
// for: the one named in the same request, else the one the scope has.
export function checked(pairs, scope = {}) {
  const out = {};
  for (const [name, value] of Object.entries(pairs)) { allowed(name, scope); out[name] = check(name, value); }
  // Two repos with one key would make `HSW-134` two tasks: the second is refused, and told who has it.
  if (out["repo.key"] && out["repo.key"] !== NONE) { const other = saidKeys().find((s) => s.key === out["repo.key"] && s.repo !== scope.repo); if (other) refuse(`repo.key: ${other.repo} already has the key ${other.key}. Choose another for ${scope.repo}.`); }
  // Research only, on a task that was started as an ordinary one: refused where it cannot be honoured (research.js).
  if (scope.task && out[RESEARCH] !== undefined) { const why = turnRefusal(scope.task, out[RESEARCH]); if (why) refuse(why); }
  const agentFor = (role) => out[`${role}.agent`] ?? lookup(`${role}.agent`, scope).value;
  for (const [name, value] of Object.entries(out)) {
    const e = known(name);
    if (e.type === "effort" || e.type === "access") { const why = fits(name, value, agentFor(roleOf(name))); if (why) refuse(`${name}: ${why}`); }
    // A program that cannot ask is refused while the role's access says ask.
    // Every agent of a list of attempts works with the working agent's access.
    if (e.type === "attempts" && typeof value === "string") { const access = out["worker.access"] ?? lookup("worker.access", scope).value; for (const a of value.split(", ")) { const why = fits("worker.access", access, a); if (why) refuse(`${name}: ${why}`); } }
    if (e.type === "agent" && entryOf(`${roleOf(name)}.access`)) { const access = out[`${roleOf(name)}.access`] ?? lookup(`${roleOf(name)}.access`, scope).value; const why = fits(`${roleOf(name)}.access`, access, value); if (why) refuse(`${name}: ${why}`); }
  }
  return out;
}
function save(values, { task, repo }) {
  if (!task) { for (const [name, v] of Object.entries(values)) writeYours(name, v, repo || ""); return null; }
  return update(task.id, (t) => {
    assertUnarchived(t);
    t.settings = { ...(t.settings || {}) };
    for (const [name, v] of Object.entries(values)) { if (v === undefined) delete t.settings[name]; else t.settings[name] = v; }
    // "This one merges by itself" is your word on this very task: an approval it owed you from before is not asked for again.
    if (values["merge.by"] === "itself") t.requireApproval = false;
  });
}
// set: returns { name, value, from } as the scope now reads it.
export function setValue(name, value, scope = {}) {
  const values = checked({ [name]: value }, scope);
  const t = save(values, scope);
  return lookup(name, scope.task ? { task: t } : scope);
}
// Several settings of one task at once (delegate's options): all or none.
export function setMany(pairs, scope = {}) { const values = checked(pairs, scope); return Object.keys(values).length ? save(values, scope) : scope.task || null; }
// unset: back to what it would be without this place's answer. Works for every setting.
export function unsetValue(name, scope = {}) {
  allowed(name, scope);
  // Taking a task's own "not research only" away may turn it on, by a default: refused as setting it would be.
  if (name === RESEARCH && scope.task) { const { [name]: own, ...rest } = scope.task.settings || {}; const why = turnRefusal(scope.task, lookup(name, { task: { ...scope.task, settings: rest } }).value); if (why) refuse(why); }
  const t = save({ [name]: undefined }, scope);
  return lookup(name, scope.task ? { task: t } : scope);
}
