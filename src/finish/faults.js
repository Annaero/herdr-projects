// Faults a reviewer found that were there before the task: suggested to the human, never added as tasks, and what the
// next reviewer is told is known already.
import * as S from "../store.js";
import * as G from "../gate.js";

// A fault that was there before the task never sends the work back, and never becomes a task by itself: it is
// suggested to the human on this task, once. One the board knows already (a suggestion raised by any review in this
// repo, or a task that is not done) is not suggested again: the finding only says where it is. When the board is
// busy it waits, and tries once more; a fault that still could not be saved says so on the finding (`unsuggested`),
// where the human reads the review, and the board tries it again by itself (`suggestOwed`). No reviewer has to
// name it a second time: the next one is told it is known.
// Its title is the reviewer's own short one; a finding without one gets its sentence, shortened. The sentence itself
// stays whole in `subject` and at the top of the description.
const wordsFor = (t, f) => ({ title: S.shortTitle(f.title || f.subject), subject: S.oneLine(f.subject, Infinity), where: f.where, by: "reviewer", severity: f.severity,
  description: `${f.subject}\n\nWhere: ${f.where || "not said"}\nSeverity: ${f.severity}\n${f.proof ? `What the reviewer saw: ${f.proof}\n` : ""}\nIt was there before ${t.id} (${t.title}), so it was not fixed there.` });
// Where it went, written on the finding: an existing task, or a suggestion (new, or raised before).
const went = (out) => (out.known?.task ? { task: out.known.task } : { suggested: out.known ? { on: out.known.on, id: out.known.id } : { on: out.on, id: out.suggestion.id } });
// What a finding went to is taken: no other finding of the same review may go there too.
const claim = (apart, out) => { const k = out.known; apart.push(k?.task ? k.task : k ? `${k.on} ${k.id}` : `${out.on} ${out.suggestion.id}`); return went(out); };
// One review's findings, each fault to a place of its own. First the ones the board knows by the very same words
// (a later round naming the same faults again), so that a finding in other words cannot take their place; then the
// rest. Only a finding of the very same words as another of its review shares that one's place: it is that fault,
// named twice.
function place(id, t, findings, apart, save) {
  const exact = (f) => { let known = null; try { known = S.knownWork(t.repo, wordsFor(t, f), { exact: true }); } catch {} if (known) { Object.assign(f, claim(apart, { known })); delete f.unsuggested; } return !!known; };
  for (const f of findings.filter((f) => !exact(f))) { if (!exact(f)) save(f); }
}
export function suggestFaults(id, review) {
  try { suggestOwed(id); } catch {}
  const t = S.get(id), old = Array.isArray(t.filedFaults) ? t.filedFaults : [];
  const apart = []; // where this review's other findings went: each is a fault of its own, however alike the words
  const mine = [];
  for (const f of review.findings) {
    if (!f.preexisting || f.task || f.suggested) continue;
    const was = old.find((x) => G.sameFault(x, f)); // added as a task by an older version of the board
    if (was) f.task = was.task; else mine.push(f);
  }
  place(id, t, mine, apart, (f) => {
    const tryIt = () => { Object.assign(f, claim(apart, S.suggest(id, { ...wordsFor(t, f), round: S.reviewRound(t), waitMs: 10000, apart }))); delete f.unsuggested; };
    try { tryIt(); } catch { try { tryIt(); } catch (e) { f.unsuggested = S.oneLine(e.message, 200) || "could not be saved"; } }
  });
}
// The faults of a task's saved reviews that could not be suggested when they were found.
const reviewsOf = (t) => [t?.review, ...(Array.isArray(t?.reviews) ? t.reviews : [])].filter((rv) => Array.isArray(rv?.findings));
export const owedFaults = (t) => reviewsOf(t).flatMap((rv) => rv.findings.filter((f) => f.preexisting && f.unsuggested && !f.task && !f.suggested).map((f) => ({ ...f, round: rv.round || S.reviewRound(t) })));
// Try them again: the housekeeping pass does, and so does every later review of the task. One that is saved now
// (or that the board knows by now) is written on the reviews that named it; one that still fails stays owed.
export function suggestOwed(id, { waitMs = 2000 } = {}) {
  const t = S.get(id);
  // Where the reviews' other findings went is taken, as it was when they were found: a fault that waited is not
  // put where another fault of its review already is.
  const apart = reviewsOf(t).flatMap((rv) => rv.findings.map((f) => (f.task ? f.task : f.suggested ? `${f.suggested.on} ${f.suggested.id}` : ""))).filter(Boolean);
  const owed = owedFaults(t).filter((f, n, all) => all.findIndex((x) => G.sameFault(x, f)) === n).map((f) => ({ ...f }));
  place(id, t, owed, apart, (f) => { try { Object.assign(f, claim(apart, S.suggest(id, { ...wordsFor(t, f), round: f.round, waitMs, apart }))); } catch {} });
  const done = owed.filter((f) => f.task || f.suggested);
  if (!done.length) return 0;
  const fix = (rv) => (Array.isArray(rv?.findings) ? { ...rv, findings: rv.findings.map((f) => { const hit = f.unsuggested && done.find((x) => G.sameFault(x, f)); if (!hit) return f; const { unsuggested, ...rest } = f; return { ...rest, ...(hit.task ? { task: hit.task } : { suggested: hit.suggested }) }; }) } : rv);
  S.update(id, (t) => { if (t.review) t.review = fix(t.review); if (Array.isArray(t.reviews)) t.reviews = t.reviews.map(fix); }, { waitMs: 10000 });
  return done.length;
}
// What reviewers in this repo are told is known already: every suggestion still open or dismissed, and what an older
// version of the board added as tasks from this task's own reviews.
export const knownFaults = (t) => [...(Array.isArray(t.filedFaults) ? t.filedFaults : []), ...S.repoSuggestions(t.repo).map((s) => ({ severity: s.severity || "", subject: s.subject || s.title, where: s.where }))];
