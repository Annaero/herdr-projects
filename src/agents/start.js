// The arguments an agent of a kind is started with, and whether it has a fast mode.
import { AGENTS } from "./kinds.js";

export const adapter = (kind) => (Object.hasOwn(AGENTS, String(kind)) ? AGENTS[kind] : {});
// Whether this kind has a fast mode the board can turn on. Without one, `<role>.fast` does nothing.
export const hasFast = (kind) => typeof adapter(kind).fast === "function";
// The effort a program is really given: none for `default`, and none for a level it does not accept (the setting was
// right for the program it was set for; the role has another one now).
export const effortFor = (kind, effort) => (!effort || effort === "default" || (adapter(kind).efforts && !adapter(kind).efforts.includes(effort)) ? "" : effort);
// The flags of `<role>.access` for this program. A program that cannot ask is never started as if it could.
export function accessArgs(kind, access = "full") {
  const table = adapter(kind).access, flags = table && Object.hasOwn(table, access) ? table[access] : null;
  if (!flags && access !== "full") throw new Error(`${kind} cannot be started with access "${access}": it never asks before it acts. Set the role's access to full, or choose another program.`);
  return flags || [];
}
// The arguments a worker, a reviewer or the Coordinator of this kind is started with.
// `resume` reopens a known conversation; `session` names a new one; `extra` are the hook and standing-rule arguments.
// `plan`: the program's own plan-mode arguments, in place of its access flags (plan.js).
export function startArgs(kind, { model, effort, fast, access = "full", plan = null, resume, session, extra = [] } = {}) {
  const a = adapter(kind), level = effortFor(kind, effort);
  return [
    ...(resume && a.resume ? a.resume(resume) : []), // first: Codex's `resume` is a subcommand
    ...(!resume && session && a.sessionArgs ? a.sessionArgs(session) : []),
    ...(plan || accessArgs(kind, access)),
    ...(model && a.model ? a.model(model) : []),
    ...(level && a.effort ? a.effort(level) : []),
    ...(fast === true && a.fast ? a.fast() : fast === false && a.slow ? a.slow() : []),
    ...extra,
  ];
}
// What a role is started as, from its five settings: `get(name)` answers `<role>.<name>`.
export function roleOf(role, get) {
  const v = String(get(`${role}.agent`) || ""), at = v.indexOf("/");
  const kind = v === "none" ? "" : at < 0 ? v : v.slice(0, at), words = get(`${role}.instructions`);
  return { kind, model: at < 0 ? "" : v.slice(at + 1), effort: get(`${role}.effort`), fast: get(`${role}.fast`), access: get(`${role}.access`), instructions: !words || words === "none" ? "" : words };
}
// Your own words for a role, as they are added after the board's own fixed rules.
export const ownWords = (text) => (text ? `The human's own instructions for you follow. The board's rules above stay as they are; where two of these disagree, the later one wins.\n\n${text}` : "");
