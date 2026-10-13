// The reviews in the task panel: how each went, each one under its own label, and the evidence.
import * as S from "../../store.js";
import * as G from "../../gate.js";
import { artifactRows, reviewArtifacts } from "../artifact-lines.js";
import { clean, age, brief } from "./words.js";
import { verdict, verdictMark, quietReview } from "./review-words.js";
import { name as keyName } from "../keys.js";

// A finding's severity is said in words; its colour only repeats it.
const SEVERITY = { critical: "red", major: "red", minor: "yellow" };

export class PanelReviews {
  // Returns whether something is shorter here than on the full screen.
  panelReviews(p) {
    const { r, full, t, w, room, dim, wrap, head, first, flow, fact, items, part } = p;
    let cut = false;
    // The reviews, as facts like every other part. `History` says how each went, oldest first ("fail → no verdict →
    // pass"). Then a review is a row under its own name: a mark and its result, when, and under them its summary.
    // Beside the list only the latest shows; full screen all of them, the newest first, each with what it found (a
    // finding says how bad it is, and whether it held the work back: one below the gate, or there before the task,
    // did not), what it checked and what it could not verify.
    const hist = S.reviewHistory(r), last = hist[hist.length - 1];
    const stale = !!r.review?.stale;
    const name = (e) => `Review ${e.round}`;
    const result = (e) => flow([verdictMark(t, e, quietReview(r, e, last)) + " " + t.bold(verdict(t, e, true, quietReview(r, e, last))), e.at ? dim(`${age(Date.now() - e.at)} ago`) : "", full && e.head ? dim(`at ${String(e.head).slice(0, 7)}`) : "", e.by && S.lastHandover(r, "reviewer") ? dim(`by ${e.by}`) : ""]); // `at abcdef1`: the commit that was reviewed; who reviewed, where a reviewer took over from another
    // A review that still stood after main was merged in says so, with what ran instead: the newest time, and how often.
    const kept = (e) => { const k = (e.kept || []).at(-1); if (!k) return []; const words = S.keptWords(k, e.round); return wrap(`${words[0].toUpperCase()}${words.slice(1)}${k.at ? ` · ${age(Date.now() - k.at)} ago` : ""}${e.kept.length > 1 ? ` · ${e.kept.length} times` : ""}`, room).map((l) => dim(l)); };
    const notes = (e) => [...(e === last && stale && !e.error ? wrap("The work changed since this review.", room).map((l) => dim(l)) : []), ...kept(e)];
    // A finding: how bad it is in a column of its own, then what it is and where, its further lines under the subject.
    const pad = room >= 40 ? 10 : 2;
    const finding = (f, tail = "") => wrap(`${f.subject}${f.where ? ` (${f.where})` : ""}${tail}`, room - pad).flatMap((l, n) => (pad > 2 ? [(n ? " ".repeat(pad) : t.fg(SEVERITY[f.severity] || "overlay0", String(f.severity).padEnd(pad))) + l] : [...(n ? [] : [t.fg(SEVERITY[f.severity] || "overlay0", String(f.severity))]), "  " + l]));
    const found = (e) => { const s = G.split(e); return fact("Findings", [...s.required.flatMap((f) => finding(f)), ...s.optional.flatMap((f) => finding(f, " · not required")), ...s.preexisting.flatMap((f) => finding(f, ` · pre-existing${G.wentTo(f) ? `, ${G.wentTo(f)}` : ""}`)), ...(e.left ? wrap(`${e.left} smaller finding${e.left === 1 ? "" : "s"} noticed late, left out`, room).map((l) => dim(l)) : [])]); };
    const whole = (e) => [...fact(name(e), [...result(e), ...notes(e), ...wrap(e.error || e.text || "No comment.", room)]),
      ...(G.isTagged(e) ? (e.findings?.length || e.left ? found(e) : []) : items("Problems", e.problems)), ...items("Checked", e.checks), ...items("Unverified", e.limitations)];
    const trail = () => fact("History", flow(hist.map((e) => verdict(t, e, false, quietReview(r, e, last))), room, " → "));
    const title = hist.length > 1 ? `Reviews · ${hist.length}` : "Review";
    const evidence = reviewArtifacts(r.review?.artifacts);
    if (hist.length && full) {
      part([head(title), ...(hist.length > 1 ? [...trail(), ""] : []), ...[...hist].reverse().flatMap((e, n) => [...(n ? [""] : []), ...whole(e)])]);
      if (evidence.length) part([head("Evidence"), ...evidence.flatMap((a, n) => [...(n ? [""] : []), ...artifactRows(t, a, w, true)])]);
    } else if (hist.length) {
      const said = clean(last.error || last.text || "No comment."), all = wrap(brief(said, 280), room);
      const links = evidence.length ? fact("Evidence", [...artifactRows(t, evidence[0], room), ...(evidence.length > 1 ? [dim(`… ${evidence.length - 1} more: ${keyName("panel")}`)] : [])]) : [];
      const row = (k) => fact(name(last), [...result(last), ...notes(last), ...first(all, k, room)]);
      // The full screen has more whenever the summary was shortened here, the review found or checked something, or
      // there is more evidence, or more about it, than its name.
      if (hist.length > 1 || brief(said, 280) !== said || [last.findings, last.problems, last.checks, last.limitations].some((x) => x?.length) || last.left || last.head || evidence.length > 1 || evidence.some((a) => a.detail || a.link || a.url)) cut = true;
      // Short of room the summary gives up lines, then the history goes, the evidence, the summary and the headline:
      // what is left last is the review's own row, which one and how it went.
      const shapes = [...all.map((_, n) => [head(title), ...(hist.length > 1 ? trail() : []), ...row(all.length - n), ...links]), [head(title), ...row(1), ...links], [head(title), ...row(1)], [head(title), ...fact(name(last), result(last))], fact(name(last), verdictMark(t, last, quietReview(r, last, last)) + " " + t.bold(verdict(t, last, true, quietReview(r, last, last))))];
      part(shapes[0], { pri: 3, min: shapes.at(-3).length, last: shapes.at(-1).length, at: (n) => shapes.find((s) => s.length <= n) || [] });
    } else if (stale) part([head("Review"), dim("The work changed since its review.")], { pri: 3, min: 2, at: () => [] });
    return cut;
  }
}
