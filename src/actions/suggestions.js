// Suggested tasks: work an agent or a reviewer came across that is not theirs to do. Raising one, and the human's
// yes (it becomes a task) or no (it is dismissed). Nothing here adds a task by itself.
import * as S from "../store.js";

// Never a task by itself: a suggestion on the task it came from. The same work raised again is not a second one.
export function suggest(id, title, { description = "", by = "agent" } = {}) {
  const t = S.find(id), out = S.suggest(t.id, { title, description, by });
  if (out.known) return { ...out, msg: out.known.task ? `Already a task: ${out.known.task}. Nothing was added.` : `Already suggested${out.known.state === "dismissed" ? ", and the human said no" : ""} (${out.known.id} on ${out.known.on}). Nothing was added.` };
  return { ...out, msg: `${out.suggestion.id} on ${t.id}: suggested to the human. It becomes a task only if they accept it.` };
}
export function acceptSuggestion(id, sid) { const out = S.acceptSuggestion(S.find(id).id, sid); return { task: out.task, existing: out.existing, msg: out.existing ? `Already a task: ${out.task.id}. No second one was made.` : `${out.task.id}: added from the suggestion` }; }
export function dismissSuggestion(id, sid) { const t = S.find(id), out = S.dismissSuggestion(t.id, sid); return { task: S.get(t.id), msg: `${out.suggestion.id} on ${t.id}: dismissed` }; }
