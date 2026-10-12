// The reviews in the task panel: how each went, each one a box, and the evidence.
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import * as G from "../../gate.js";
import { artifactLine, reviewArtifacts } from "../artifact-lines.js";
import { clean, age, brief } from "./words.js";
import { verdict } from "./review-words.js";
import { name as keyName } from "../keys.js";

export class PanelReviews {
  // Returns whether something is shorter here than on the full screen.
  panelReviews(p) {
    const { r, width, full, t, w, dim, wrap, head, first, flow, card, part } = p;
    let cut = false;
    // The reviews. One line says how each went, oldest first ("fail → no verdict → pass"), then each review is a box
    // of its own: its number and age in the edge, then the result, its summary and, full screen, what it found.
    // A finding says how bad it is, and whether it held the work back: one below the gate, or there before the task,
    // did not. Beside the list only the latest review shows.
    const hist = S.reviewHistory(r), last = hist[hist.length - 1];
    const stale = !!r.review?.stale;
    const found = (e) => { const s = G.split(e); return [...s.required.map((f) => G.findingLine(f)), ...s.optional.map((f) => `${G.findingLine(f)} · not required`), ...s.preexisting.map((f) => `${G.findingLine(f)} · pre-existing${f.task ? `, filed as ${f.task}` : ""}`), ...(e.left ? [`${e.left} smaller finding${e.left === 1 ? "" : "s"} noticed late, left out`] : [])]; };
    const iw = Math.max(1, w - 4);
    const list = (label, xs) => ((xs || []).length ? ["", dim(label), ...xs.flatMap((x) => wrap(x, iw - 2).map((l, n) => (n ? "  " : dim("•") + " ") + l))] : []);
    const name = (e) => `Review ${e.round}`;
    const result = (e) => wrapTextWithAnsi(t.bold(verdict(t, e, true)), iw);
    // A review that still stood after main was merged in says so, with what ran instead: the newest time, and how often.
    const keptLines = (e) => { const k = (e.kept || []).at(-1); if (!k) return []; const words = S.keptWords(k, e.round); return wrap(`${words[0].toUpperCase()}${words.slice(1)}${k.at ? ` · ${age(Date.now() - k.at)} ago` : ""}${e.kept.length > 1 ? ` · ${e.kept.length} times` : ""}`, iw).map((l) => dim(l)); };
    const box = (e, summary) => card(name(e), [e.at ? `${age(Date.now() - e.at)} ago` : "", full && e.head ? String(e.head).slice(0, 7) : ""].filter(Boolean), [
      ...result(e), ...(e === last && stale && !e.error ? [dim("The work changed since this review.")] : []), ...keptLines(e), ...summary,
      ...(full ? [...(G.isTagged(e) ? list("Findings", found(e)) : list("Problems", e.problems)), ...list("Checked", e.checks), ...list("Could not verify", e.limitations)] : [])]);
    // How each review went, on one line. Short of room, the oldest ones go.
    const trail = () => {
      const steps = hist.map((e) => verdict(t, e)), arrow = dim(" → ");
      if (full) return wrapTextWithAnsi(steps.join(arrow), w);
      let from = 0;
      const row = () => (from ? dim("… ") : "") + steps.slice(from).join(arrow);
      while (from < steps.length - 1 && visibleWidth(row()) > w) from++;
      return [truncateToWidth(row(), w, "…")];
    };
    const evidence = reviewArtifacts(r.review?.artifacts);
    if (hist.length && full) {
      part([head(hist.length > 1 ? (w >= 30 ? `Reviews · ${hist.length}, the newest first` : `Reviews · ${hist.length}`) : "Review"), ...(hist.length > 1 ? trail() : []), ...[...hist].reverse().flatMap((e, n) => [...(n ? [""] : []), ...box(e, wrap(e.error || e.text || "No comment.", iw))])]);
      if (evidence.length) part([head("Evidence"), ...artifactLines(t, evidence, width, "Evidence").slice(2, -1).map((l) => l.slice(1))]);
    } else if (hist.length) {
      const all = wrap(brief(clean(last.error || last.text || "No comment."), 280), iw);
      const extra = evidence.length ? [artifactLine(t, evidence[0], width).slice(1), ...(evidence.length > 1 ? [dim(`… ${evidence.length - 1} more: ${keyName("panel")}`)] : [])] : [];
      const build = (k) => [head(hist.length > 1 ? `Reviews · ${hist.length}` : "Review"), ...(hist.length > 1 ? trail() : []), ...box(last, first(all, k, iw)), ...extra];
      const least = build(1).length;
      if (hist.length > 1 || evidence.length > 1) cut = true;
      // With no room for its box, the latest review is one line: which one, and how it went.
      part(build(all.length), { pri: 3, min: least, last: 1, at: (n) => (n >= least ? build(Math.min(all.length, n - least + 1)) : n >= 1 ? [truncateToWidth(dim(name(last)) + "  " + verdict(t, last, true), w, "…")] : []) });
    } else if (stale) part([head("Review"), dim("The work changed since its review.")], { pri: 3, min: 2, at: () => [] });
    return cut;
  }
}
