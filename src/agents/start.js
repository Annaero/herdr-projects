// The arguments an agent of a kind is started with, and whether it has a fast mode.
import { config } from "../store.js";
import { AGENTS } from "./kinds.js";

export const adapter = (kind) => AGENTS[kind] || {};
// Whether this kind has a fast mode the board can turn on. Without one, `fast` and `reviewerFast` do nothing.
export const hasFast = (kind) => typeof adapter(kind).fast === "function";
// The arguments a worker or reviewer of this kind is started with.
// `resume` reopens a known conversation; `session` names a new one; `extra` are the hook and standing-rule arguments.
export function startArgs(kind, { model, effort, fast, resume, session, extra = [] } = {}) {
  const a = adapter(kind);
  const user = config().agentArgs?.[kind];
  return [
    ...(resume && a.resume ? a.resume(resume) : []), // first: Codex's `resume` is a subcommand
    ...(!resume && session && a.sessionArgs ? a.sessionArgs(session) : []),
    ...(Array.isArray(user) ? user : a.args || []),
    ...(model && a.model ? a.model(model) : []),
    ...(effort && a.effort ? a.effort(effort) : []),
    ...(fast === true && a.fast ? a.fast() : fast === false && a.slow ? a.slow() : []), // not said (the Coordinator): the program's own setting
    ...extra,
  ];
}
