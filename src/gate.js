// The gate. A reviewer describes what it found, each fault tagged by what it does; the board decides from the fixed
// rules here what goes back to the agent and what may merge. The reviewer's own wish to merge decides nothing.
// Pure: no files, no herdr. A review from before the gate (a 1-to-5 score and a merge advice) still reads correctly.
export const SEVERITIES = ["trivial", "minor", "major", "critical"]; // mildest first: the place in the list is the rank
export const GATES = ["critical", "major", "minor", "trivial", "off"];
export const DEFAULT_GATE = "major";
export const QUESTION = "Does the change do what the task asked?";
const rank = (s) => SEVERITIES.indexOf(s);
const MAX_FINDINGS = 100;
const line = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// "off" sends nothing back by itself, but the result shown and an automatic merge still need a bar: the default one.
export const barOf = (gate) => (SEVERITIES.includes(gate) ? gate : DEFAULT_GATE);
// The old reviewAuto setting, said as a gate: true was "send it back by itself", false "wait for me".
export const gateOfAuto = (v) => (v === true || ["true", "on", "yes", "auto"].includes(String(v).toLowerCase()) ? DEFAULT_GATE : "off");

// ---- what the reviewer wrote -----------------------------------------------------------------------------------------
// A severity the board does not know is read as major: it goes back at the default gate rather than slipping through.
export function readFindings(list) {
  return (Array.isArray(list) ? list : []).filter((f) => f && typeof f === "object" && line(f.subject, 1)).map((f) => {
    const severity = String(f.severity ?? "").trim().toLowerCase();
    return { id: line(f.id, 16), severity: SEVERITIES.includes(severity) ? severity : "major", subject: line(f.subject, 400), ...(line(f.title, 1) ? { title: line(f.title, 200) } : {}), where: line(f.where, 200), proof: line(f.proof, 600), preexisting: f.preexisting === true };
  });
}
// The board's rules, applied to what came back.
// `earlier`: the findings of the round before, when this is a later round (null on a first review). Then an earlier
// finding still open comes back under its id, and anything new stays only if it is critical with proof, or was
// there before the task: that one holds nothing back, it is only suggested to the human as a task of its own.
// `used`: every finding id this task has had, so a new one never takes an old number.
export function settle(meets, found, earlier = null, used = []) {
  const prior = new Map((earlier || []).filter((f) => !f.board).map((f) => [f.id, f]));
  const out = [];
  let left = 0;
  for (const f of found) {
    // A critical finding nobody showed is a claim, not a proven fault.
    let severity = f.severity === "critical" && !f.proof ? "major" : f.severity;
    const was = f.id ? prior.get(f.id) : null;
    if (was) {
      if (out.some((o) => o.id === was.id)) continue;
      // An earlier finding may not grow on the way, except into a proven critical one. What it was tagged as stays.
      if (severity !== "critical" && rank(severity) > rank(was.severity)) severity = was.severity;
      out.push({ ...f, id: was.id, severity, preexisting: was.preexisting, ...(was.task ? { task: was.task } : {}), ...(was.suggested ? { suggested: was.suggested } : {}), ...(was.unsuggested ? { unsuggested: was.unsuggested } : {}) });
    } else if (earlier && severity !== "critical" && !f.preexisting) left++;
    else out.push({ ...f, id: "", severity });
  }
  // The fixed question answered "no" is a critical finding, whatever the list says.
  if (meets === false && !out.some((f) => f.severity === "critical" && !f.preexisting)) out.unshift({ id: "meets", severity: "critical", subject: "The change does not do what the task asked.", where: "", proof: "", preexisting: false, board: true });
  // A very long list of the task's own findings is cut only now, with the rules applied, and from the mildest up:
  // what can fail the gate is never what goes. What was there before the task is never cut: each is to be suggested.
  const own = out.filter((f) => !f.preexisting);
  if (own.length > MAX_FINDINGS) {
    const gone = new Set([...own].sort((a, b) => rank(b.severity) - rank(a.severity)).slice(MAX_FINDINGS));
    left += gone.size;
    out.splice(0, out.length, ...out.filter((f) => !gone.has(f)));
  }
  let n = Math.max(0, ...[...used, ...prior.keys()].map((id) => Number(String(id).replace(/^F/, "")) || 0));
  for (const f of out) if (!f.id) f.id = `F${++n}`;
  return { findings: out, left };
}

// ---- the result ------------------------------------------------------------------------------------------------------
export const isTagged = (rv) => !!rv && Array.isArray(rv.findings) && typeof rv.meets === "boolean";
// What holds the work back (at or above the gate), what does not, and what was there before the task.
export function split(rv, gate = rv?.gate) {
  const bar = rank(barOf(gate)), all = isTagged(rv) ? rv.findings : [];
  const open = all.filter((f) => !f.preexisting);
  return { required: open.filter((f) => rank(f.severity) >= bar), optional: open.filter((f) => rank(f.severity) < bar), preexisting: all.filter((f) => f.preexisting) };
}
// Written on the review when it is made: the gate it was judged at and how it came out. A later change of the
// setting does not rewrite what a finished review said.
export function stamp(rv, gate) { rv.gate = barOf(gate); rv.pass = split(rv).required.length === 0; return rv; }
// "Merge", everywhere the board asks whether work may: the gate passed. An old review: 4 or 5, and not "don't merge".
export const passes = (rv) => (isTagged(rv) ? rv.pass === true : Number.isInteger(rv?.score) && rv.score >= 4 && rv.recommend !== false);
export const isLegacy = (rv) => !isTagged(rv) && Number.isInteger(rv?.score);
// Is there anything to hand to the agent?
export const sendable = (rv) => (isTagged(rv) ? rv.findings.some((f) => !f.preexisting) : isLegacy(rv) && rv.score < 5);
// "1 critical, 2 minor": the task's own faults, worst first, then how many were there before it.
export function tally(rv) {
  if (!isTagged(rv)) return "";
  const { preexisting } = split(rv);
  const open = rv.findings.filter((f) => !f.preexisting);
  const parts = [...SEVERITIES].reverse().map((s) => [open.filter((f) => f.severity === s).length, s]).filter(([n]) => n).map(([n, s]) => `${n} ${s}`);
  if (preexisting.length) parts.push(`${preexisting.length} pre-existing`);
  return parts.join(", ");
}
export const word = (rv) => (passes(rv) ? "Pass" : "Fail");
// "Pass · 2 minor", "Fail · 1 critical, 1 major". An old review keeps its own words: "4/5, says merge".
export function result(rv, verb = "merge") {
  if (isTagged(rv)) return `${word(rv)}${tally(rv) ? ` · ${tally(rv)}` : ""}`;
  return `${rv.score}/5${rv.recommend === true ? `, says ${verb}` : rv.recommend === false ? `, says don't ${verb}` : ""}`;
}
export const sentence = (rv, verb = "merge") => (isTagged(rv) ? `Review: ${result(rv)}.` : `Reviewed ${result(rv, verb)}.`);
// The board's own review words at the start of a task's message, for a screen that shows them elsewhere.
export const SENTENCE = /^(Approve to merge\?\s*)?(?:Reviewed [1-5]\/5(?:, says (?:don't )?(?:merge|accept))?|Review: (?:Pass|Fail)(?: · [a-z0-9, -]+)?)\.\s*/;

// ---- words for the agent, the pull request and the board ----------------------------------------------------------------
export const findingLine = (f) => `[${f.severity}] ${f.subject}${f.where ? ` (${f.where})` : ""}`;
const withProof = (f) => `- ${findingLine(f)}${f.proof ? `\n  Proof: ${f.proof}` : ""}`;
// Where a fault from before the task went: never a task by itself. It is suggested to the human, unless the board
// knew it already: as a task (`task`), or as a suggestion raised before (`suggested`: { on, id }).
// `unsuggested`: the board could not save the suggestion (it was busy); the human sees that instead of nothing.
export const wentTo = (f) => (f.task ? `task ${f.task}` : f.suggested ? "suggested as a task" : f.unsuggested ? "not suggested: the board could not save it" : "");
const filedAs = (f) => `- ${findingLine(f)}${wentTo(f) ? ` → ${wentTo(f)}` : ""}`;
// The review as plain text: its summary and what it found. `all`: the human sends it by hand, so nothing is optional.
export function findingsText(rv, { all = false } = {}) {
  if (!isTagged(rv)) return `${rv.text}${rv.problems && rv.problems.length ? `\n\nProblems it found:\n${rv.problems.map((p) => `- ${p}`).join("\n")}` : ""}`;
  const s = split(rv);
  const required = all && !s.required.length ? [...s.required, ...s.optional] : s.required, optional = required === s.required ? s.optional : [];
  return [rv.text,
    required.length ? `Required: fix each of these.\n${required.map(withProof).join("\n")}` : "",
    optional.length ? `Optional: these do not hold the work back. Fix one only if it is quick and safe; otherwise leave it.\n${optional.map(withProof).join("\n")}` : "",
    s.preexisting.length ? `Not yours to fix: these were there before your work. The human is asked whether each becomes a task of its own. Leave them.\n${s.preexisting.map(filedAs).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}
export function reviewMessage(rv, opts = {}) {
  if (!isTagged(rv)) return `A reviewer went through your change and rated it ${rv.score} out of 5.\n\n${findingsText(rv)}\n\nAddress these, then finish again.`;
  return `A reviewer went through your change. Result: ${result(rv)}.\n\n${findingsText(rv, opts)}\n\nFix what is required, then finish again. The next review checks that each of these is fixed and that the fixes broke nothing.`;
}
// What a pull request says about a review: every finding, those below the gate marked as not required.
export function prComment(rv, round) {
  const s = split(rv);
  const item = (f) => `- **${f.severity}**: ${f.subject}${f.where ? ` (\`${f.where}\`)` : ""}${f.proof ? `\n  Proof: ${f.proof}` : ""}${f.preexisting && wentTo(f) ? `\n  ${wentTo(f)[0].toUpperCase()}${wentTo(f).slice(1)}.` : ""}`;
  const group = (title, xs) => (xs.length ? `**${title}**\n${xs.map(item).join("\n")}` : "");
  return [`**Review${round ? ` ${round}` : ""} · ${result(rv)}**`, `Does the change do what the task asked? ${rv.meets ? "Yes." : "No."} Gate: ${rv.gate} and worse must be fixed.`, rv.text,
    group("Required", s.required), group("Not required (below the gate)", s.optional), group("Not required (there before this change)", s.preexisting),
    rv.left ? `${rv.left} smaller finding${rv.left === 1 ? "" : "s"} noticed in this later round ${rv.left === 1 ? "was" : "were"} left out.` : "",
    rv.findings.length ? "" : "No findings."].filter(Boolean).join("\n\n");
}
// Is this the same finding, word for word? The same thing said about the same place. Used to list a finding once.
// Whether two findings are the same work in other words is the suggestions' question (store/suggestions.js).
const plain = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function sameFault(a, b) {
  // A place is compared as written: import-csv.js and import_csv.js, or a.js and A.js, are different files.
  const place = (x) => String(x || "").replace(/\s+/g, " ").trim();
  if (place(a.where) !== place(b.where)) return false;
  return !!plain(a.subject) && plain(a.subject) === plain(b.subject);
}
