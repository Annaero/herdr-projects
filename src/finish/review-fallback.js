// The reviewer's hand-over (`reviewer.fallback`, docs/fallback.md): the reviewer cannot review (its provider is still
// down after the board's own tries, it is out of allowance or logged out, or its program is not installed here), and
// the next one on the list reviews in its place: the same review, started again, in a tab of its own. It reviews the
// later rounds of the task too, until you step in. A reviewer that reviewed and found faults is never replaced: that
// is a review, and the working agent's to answer.
import * as S from "../store.js";
import { installed } from "../agents.js";
import { usable } from "./hand-over.js";

// Who reviews now: the one that took over earlier on this task, else `reviewer.agent`; and where that program is not
// installed here, the first on the list that is. { agent, standIn }: `standIn` names the program that is missing.
export function reviewerNow(t, ch) {
  const said = t.reviewerOn || ch["reviewer.agent"], kind = S.agentOf(said).kind;
  if (installed(kind)) return { agent: said, standIn: "" };
  const next = S.nextFallback(S.listOf(ch["reviewer.fallback"]), { on: said, usable: (a) => usable(a, ch["reviewer.access"]) });
  return { agent: next.agent || said, standIn: next.agent ? kind : "" };
}
// The reviewer `from` was cut off for good (`cut`: its provider's error; `tries`: how often the board tried). The
// next on the list, written on the task, or "" when nobody is left. `tried`: who reviewed in this run already.
export function nextReviewer(g, ch, { from, cut, auth = false, tries = 1, tried = [] }) {
  const list = S.listOf(ch["reviewer.fallback"]);
  if (!list.length) return "";
  const next = S.nextFallback(list, { on: from, tried, usable: (a) => usable(a, ch["reviewer.access"]) });
  if (!next.agent) { g.set((t) => { t.fallbacks = { ...(t.fallbacks || {}), reviewerLeft: S.nobodyLeft("reviewer.fallback", next.skipped) }; }); return ""; }
  const why = S.whyOf({ error: cut.error, auth, passing: cut.passing, reason: cut.reason, tries });
  g.set((t) => { const h = S.logHandover(t, { role: "reviewer", from, to: next.agent, why }); t.reviewerOn = next.agent; t.msg = S.handoverLine(h); t.waiting = null; t.fallbacks = { ...(t.fallbacks || {}), reviewerLeft: undefined }; });
  return next.agent;
}
