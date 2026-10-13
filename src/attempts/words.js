// An attempt in a few words: where it stands (passed, out, needs you, waits for a slot, at work), its mark on the
// task's row (`A claude ✓ · B codex working 60% · C pi ✗ check`), and what the task says while its attempts run or
// wait for a pick. The row, the task panel, herdr's sidebar, the web page and `show <id>` all say it with these.
import * as S from "../store.js";

// Where one attempt stands, from its own saved task:
//   passed   it finished and its check passed (or the repo has none): it can be chosen
//   out      its check failed after its tries, it stopped with no summary, was stopped, or its agent is gone
//   needs    it waits for you: a question, a login
//   waits    queued for a free slot
//   works    anything else: its agent, its check or the board is on it
const GONE_MS = 15000;
export function standingOf(c, now = Date.now()) {
  if (!c) return "out";
  if (c.stage === "tried") return "passed";
  if (["nosummary", "stopped", "todo", "done"].includes(c.stage)) return "out";
  if (c.stage === "failed") return S.waitingOf(c) ? "works" : c.failure?.auth ? "needs" : "out";
  if (["asks", "reviewneeds"].includes(c.stage)) return "needs";
  if (c.stage === "queued") return "waits";
  // Its terminal was closed, or its program ended, and nothing is bringing it back.
  if (c.stage === "working" && !S.markerAlive(c.runner) && (c.last?.gone || (c.last?.status === null && c.exitedAt && now - c.exitedAt > GONE_MS))) return "out";
  return "works";
}
// Why an attempt is out, in a word or two: what stands after its ✗.
export function outWhy(c) {
  if (c.stage === "failed") return { check: "check", setup: "setup", start: "could not start", research: "changed the repo", agent: "agent stopped" }[c.failure?.stage] || "failed";
  if (c.stage === "nosummary") return "no summary";
  if (c.stage === "stopped") return "stopped";
  return "agent gone";
}
export const agentWord = (c) => S.agentOf(c.settings?.["worker.agent"] || c.agent || "").kind || c.agent || "agent";
// One attempt's mark. `c` is the attempt as the board shows it (its `state`, `note` and `progress` are herdr's and the
// Watcher's), or as saved.
export function markOf(c, now = Date.now()) {
  const who = `${c.letter} ${agentWord(c)}`, st = standingOf(c, now);
  if (st === "passed") return `${who} ✓`;
  if (st === "out") return `${who} ✗ ${outWhy(c)}`;
  if (st === "needs") return `${who} ? ${c.stage === "failed" ? "needs a login" : "asks you"}`;
  if (st === "waits") return `${who} waits for a slot`;
  const step = { starting: "starting", setup: "setting up", checking: "checking", failed: "cut off, trying again" }[c.stage];
  if (step) return `${who} ${step}`;
  if (c.state === "blocked") return `${who} ? needs you`;
  return `${who} working${Number.isFinite(c.progress) && c.progress > 0 ? ` ${c.progress}%` : ""}`;
}
export const marksLine = (kids, now = Date.now()) => kids.map((c) => markOf(c, now)).join(" · ");
// What the task shows while its attempts are under way: { state, kind, msg, progress, eta }.
export function attemptsShown(kids, now = Date.now()) {
  const st = kids.map((c) => standingOf(c, now));
  const needs = kids.some((c, n) => st[n] === "needs" || (st[n] === "works" && c.state === "blocked"));
  const live = kids.filter((c, n) => ["works", "waits"].includes(st[n]));
  const pct = kids.map((c, n) => (["passed", "out"].includes(st[n]) ? 100 : Number.isFinite(c.progress) ? c.progress : 0));
  const etas = live.map((c) => c.eta).filter((x) => x !== undefined);
  return { state: needs ? "blocked" : "working", kind: needs ? "question" : undefined, msg: marksLine(kids, now), progress: kids.length ? Math.round(pct.reduce((a, b) => a + b, 0) / kids.length) : undefined, eta: etas.length ? Math.max(...etas) : undefined };
}
// What the task says while it waits for your pick: "Pick one of 3 · the reviewer recommends B".
export function pickLine(t, kids = S.attemptsOf(t)) {
  const n = kids.filter((c) => standingOf(c) === "passed").length, c = t.comparison;
  return `Pick one of ${n}${c?.pick ? ` · the reviewer recommends ${c.pick}` : c?.error ? " · no comparison" : ""}`;
}
