// Suggested tasks. Work a reviewer or an agent came across that is not part of the task it was on is never filed by
// itself: it is saved here, on the task that raised it, as a suggestion. It becomes a task only when the human
// accepts it; a dismissed one is kept, so the same thing is not asked twice.
import { withLock, withTaskLock } from "./files.js";
import { get, list, update, create, remove, oneLine } from "./tasks.js";
import { titled } from "./titles.js";
import { folderOf } from "./repos.js";

export const suggestionsOf = (t) => (Array.isArray(t?.suggestions) ? t.suggestions : []);
export const openSuggestions = (t) => suggestionsOf(t).filter((s) => s.state === "open");
// "the reviewer" or "the agent": who came across it.
export const suggestedBy = (s) => (s.by === "reviewer" ? "the reviewer" : "the agent");
// What it says beyond its title: the description (without the title repeated at its start), or at least the place.
export function detailOf(s) {
  const d = String(s?.description || "").trim(), [lead, ...rest] = d.split(/\n\s*\n/);
  const same = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return (rest.length && same(lead) === same(s.title) ? rest.join("\n\n") : d === s.title ? "" : d) || (s?.where ? `Where: ${s.where}` : "");
}

// ---- is this the same work? ---------------------------------------------------------------------------------------
// Two reviewers rarely describe one fault in the same words, so equal titles are not enough. Two things are taken for
// the same work when their titles are made of mostly the same telling words (four or more of them and over half of
// the shorter title, or nearly all of both), or share a fair part of them and both name the same file (in the title
// or in `where`; with no `where`, in the description). A word matches its longer forms ("fail", "fails"; "clean",
// "cleanup"). It is a guess, kept narrow: what it misses, the one who raises it is told to check for first (the
// reviewer's brief lists what is suggested already), and what it wrongly holds back names where the first one is.
const STOP = new Set("a an and are as at be because both but by can could does for from has have in into is it its not of on once or so than that the their then there these this to was were when which while with without also only still each every very".split(" "));
// Words that say the same thing count as one word ("drops", "loses" and "omits"; "last" and "final"), and so do a
// word's own forms ("importer", "importing"). Words that say the opposite make two things of otherwise equal titles
// ("drops the first row", "drops the last row").
const SAME = ["drop lose loses lost omit skip miss", "last final", "fail break crash", "flaky intermittent intermittently sometimes", "slow slowly hang"].flatMap((g) => g.split(" ").map((w, n, all) => [w, all[0]]));
const SAME_AS = new Map(SAME);
const OPPOSITE = ["first last", "start end", "before after", "top bottom", "header footer", "import export", "read write", "open close", "add remove", "min max", "left right", "up down", "input output"].map((p) => p.split(" "));
const stem = (w) => { const s = w.replace(/(ing|ers?|ed|es|s)$/, "").replace(/([b-df-hj-np-tv-z])\1$/, "$1"); return s.length >= 4 ? s : /[^s]s$/.test(w) && w.length >= 4 ? w.slice(0, -1) : w; };
const wordsOf = (text) => [...new Set(String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 1 && !STOP.has(x)).map((x) => SAME_AS.get(x) || SAME_AS.get(stem(x)) || stem(x)))];
// File names anywhere in a text, without their line numbers: "test/a.test.js:52, called from line 106" is test/a.test.js.
const filesOf = (text) => [...new Set((String(text || "").match(/[\w./-]*\w\.[a-z]{1,5}\b/gi) || []).map((f) => f.toLowerCase().replace(/^\.\//, "")).filter((f) => /[a-z]/.test(f.split(".")[0])))];
const alike = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
// A title as its telling words, whatever their order: "the importer drops the last row", "the last row is dropped by the importer".
const plain = (x) => wordsOf(x).sort().join(" ");
export function sameWork(a, b, { exact = false } = {}) {
  // Where it is: the title and `where`; one that says no `where` (an agent's, a task) names its files in its description.
  // What it says: its whole sentence when its title is a short form of one.
  a = { ...a, title: a.subject || a.title }; b = { ...b, title: b.subject || b.title };
  const text = (x) => `${x.title} ${x.where || x.description || ""}`;
  const fa = filesOf(text(a)), fb = filesOf(text(b));
  const file = fa.some((f) => fb.some((g) => f === g || f.endsWith(`/${g}`) || g.endsWith(`/${f}`)));
  // Each names its files and they share none: two places, so two things, whatever the words (the same sentence about
  // import-csv.js and about import-json.js is two bugs).
  if (fa.length && fb.length && !file) return false;
  if (plain(a.title) && plain(a.title) === plain(b.title)) return true;
  if (exact) return false; // only a title of the very same words was asked for
  const A = wordsOf(a.title), B = wordsOf(b.title);
  const has = (W, x) => W.some((y) => alike(x, y));
  if (OPPOSITE.some(([x, y]) => [[x, y], [y, x]].some(([p, q]) => has(A, p) && has(B, q) && !has(A, q) && !has(B, p)))) return false;
  const [few, many] = A.length <= B.length ? [A, B] : [B, A];
  if (!few.length) return false;
  const shared = few.filter((x) => many.some((y) => alike(x, y))).length;
  if (file) return shared >= 2 && shared / few.length >= 0.4;
  return (shared >= 3 && shared / (few.length + many.length - shared) > 0.6) || (shared >= 4 && shared / few.length >= 0.55);
}
// What the board knows already that is the same work as `s`, in the same repo: a suggestion on any task (open, or
// dismissed: the human said no to it once), or a task on the board that is not done yet. An accepted suggestion
// counts for as long as the task made from it is such a task. A done or archived task holds nothing back: what is
// found now was not fixed by it. Returns { task } or { on, id, state }, or null.
// `apart`: suggestions (as "<task id> <S1>") that are known to be other work: one reviewer's findings in one review
// are one fault each, however alike their words; a task among them is named by its id alone. `exact`: only what
// has a title of the very same words.
const open = (t) => !!t && !t.archivedAt && t.stage !== "done";
const sameTask = (all, s, but = [], exact = false) => all.find((t) => !but.includes(t.id) && open(t) && sameWork({ title: t.title, subject: t.subject, description: t.description }, s, { exact }));
export function knownWork(repo, s, { apart = [], exact = false } = {}) {
  const all = list({ includeArchived: true }).filter((t) => t.repo === repo);
  const onBoard = (id) => open(all.find((x) => x.id === id));
  for (const t of all) for (const x of suggestionsOf(t)) {
    if (apart.includes(`${t.id} ${x.id}`) || !sameWork(x, s, { exact })) continue;
    if (x.state === "accepted") { if (x.task && onBoard(x.task) && !apart.includes(x.task)) return { task: x.task }; continue; }
    return { on: t.id, id: x.id, state: x.state };
  }
  const hit = sameTask(all, s, apart, exact);
  return hit ? { task: hit.id } : null;
}
// Every suggestion in a repo that is still open or was dismissed, newest first: what a reviewer is told not to raise again.
export function repoSuggestions(repo, max = 30) {
  return list({ includeArchived: true }).filter((t) => t.repo === repo).flatMap((t) => suggestionsOf(t).filter((s) => s.state !== "accepted").map((s) => ({ ...s, on: t.id })))
    .sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, max);
}

// ---- raising, accepting, dismissing ---------------------------------------------------------------------------------
// Raise one on task `id`. Never a task, and never a second time: when the board knows the same work already, nothing
// is added and `known` says where it is. Returns { suggestion, on } for a new one, { known } otherwise.
export function suggest(id, { title, subject = "", description = "", where = "", by = "agent", severity = "", round = 0, waitMs = 2000, apart = [] } = {}) {
  const t = get(id);
  if (!t) throw new Error(`No task ${id}`);
  // The title keeps to the limit (store/titles.js). `subject` is the whole sentence a short title stands for (a
  // reviewer's finding, or a title that had to be cut): the same work is known by it, not by the few words shown.
  // It is never cut itself: two sentences may differ only in their last words, however long they are.
  const short = titled(title, description), whole = oneLine(subject, Infinity) || short.subject || "";
  if (!short.title) throw new Error("A suggestion needs a title.");
  const s = { title: short.title, ...(whole && whole !== short.title ? { subject: whole } : {}), description: short.description, where: oneLine(where, 200) };
  return withLock(`suggest:${t.repo}`, () => {
    const known = knownWork(t.repo, s, { apart });
    if (known) return { known };
    let made;
    update(id, (t) => {
      const n = Math.max(0, ...suggestionsOf(t).map((x) => Number(String(x.id).replace(/^S/, "")) || 0)) + 1;
      made = { id: `S${n}`, ...s, by, ...(severity ? { severity } : {}), ...(round ? { round } : {}), at: Date.now(), state: "open" };
      t.suggestions = [...suggestionsOf(t), made];
    }, { waitMs });
    return { suggestion: made, on: id };
  }, { waitMs });
}
const one = (t, sid) => {
  const open = openSuggestions(t), want = String(sid || "").trim().toUpperCase();
  const s = want ? suggestionsOf(t).find((x) => x.id === want) : open.length === 1 ? open[0] : null;
  if (!s) throw new Error(want ? `${t.id} has no suggestion ${want}.` : open.length ? `${t.id} has ${open.length} open suggestions: say which (${open.map((x) => x.id).join(", ")}).` : `${t.id} has no open suggestion.`);
  if (s.state !== "open") throw new Error(`${s.id} on ${t.id} was ${s.state === "accepted" ? `made a task already${s.task ? `: ${s.task}` : ""}` : "dismissed already"}.`);
  return s;
};
// The human's yes: the suggestion becomes a task in the same repo, started by nobody. Checking that it is still
// open, making the task and writing that down are one step under the repo's suggestion lock: two yeses at once (two
// boards, a board and the Coordinator) make one task, and the second is told it was made already. The raising task
// is held for the whole step too, so a task is only made when the answer can be written down; should writing it
// down fail all the same, the task made is taken away again: a yes that failed leaves nothing to make twice.
// When the same work was filed as a task after the suggestion was raised, no second task is made: the suggestion is
// answered with that task (`existing`).
const decide = (id, fn) => {
  const t = get(id);
  if (!t) throw new Error(`No task ${id}`);
  return withLock(`suggest:${t.repo}`, () => withTaskLock(id, () => fn(get(id)), { waitMs: 10000 }), { waitMs: 10000 });
};
export function acceptSuggestion(id, sid) {
  return decide(id, (t) => {
    const s = one(t, sid);
    const there = sameTask(list({ includeArchived: true }).filter((x) => x.repo === t.repo), s, [id]);
    const made = there || create(folderOf(id), s.title, { subject: s.subject, description: [s.description || (s.where ? `Where: ${s.where}` : ""), `Suggested by ${suggestedBy(s)} of ${t.id} (${t.title}).`].filter(Boolean).join("\n\n") });
    try { update(id, (t) => { t.suggestions = suggestionsOf(t).map((x) => (x.id === s.id ? { ...x, state: "accepted", task: made.id, decided: Date.now() } : x)); }, { waitMs: 10000 }); }
    catch (e) { if (!there) { try { remove(made.id); } catch {} } throw e; }
    return { task: made, suggestion: s, existing: !!there };
  });
}
export function dismissSuggestion(id, sid) {
  return decide(id, (t) => {
    const s = one(t, sid);
    update(id, (t) => { t.suggestions = suggestionsOf(t).map((x) => (x.id === s.id ? { ...x, state: "dismissed", decided: Date.now() } : x)); }, { waitMs: 10000 });
    return { suggestion: s };
  });
}
