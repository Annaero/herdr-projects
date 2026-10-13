// The light part of the limits, with nothing of the agents or the actions in it, so that what only draws a task
// (state.js, the rows, the panel) can ask it: whether a limit is said at all, whose run it is and how long it has
// taken, the tokens that count, the mark of a stop, and the words for each.
//
// Time. A run is one stretch of an agent's work: from the moment it was set going (by you, or by the board with a
// check's output or a review's findings) to the end of that turn; for a reviewer, one review.
import * as S from "../store.js";

// Does any place say a limit for this task? Asked before the settings are looked up at all, which is on every
// drawing of every row: a limit can only be said on the task, with a task sent from another machine, in your entry
// for its repo or by you (never in the repo's own file), and a board that says none pays nothing for having them.
const NAMES = ["limit.time", "limit.tokens"];
// One of several attempts at a task (attempts.js) is a task of its own that reads its task's settings: the task it
// is an attempt at, or null.
const taskOf = (t) => { try { return t?.attemptOf ? S.get(t.attemptOf) : null; } catch { return null; } };
export function limitSaid(t) {
  const mine = S.yours(), repo = String(t?.repo || String(t?.id || "").split("/")[0]);
  if (t?.runLimit && t.runLimit.time !== "none") return true; // a run still holds the limit it started with
  return [t?.settings, taskOf(t)?.settings, t?.carried?.settings, mine.you, mine.repos?.[repo]].some((p) => !!p && (p.limit !== undefined || NAMES.some((n) => p[n] !== undefined)));
}
export const stoppedAtLimit = (t) => !!t && t.stage === "stopped" && !!t.limitStop && !t.archivedAt;
// "1h12m", "45m", "1m21s", "30s": a time as the limits say it. Seconds only while they matter, under ten minutes.
export const timeSay = (span) => { const s = Math.max(0, Math.round(span / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}h${m ? `${m}m` : ""}` : m >= 10 || (m && !x) ? `${m}m` : m ? `${m}m${x}s` : `${s}s`; };
// The line the row and herdr's sidebar say.
export const stopLine = (what, limit) => (what === "time" ? `stopped at its ${limit} limit` : `stopped at ${limit} tokens`);
// What was used when it stopped: "after 2h1m", "with 2.1m used".
export const usedSay = (ls) => (ls.what === "time" ? `after ${timeSay(ls.used)}` : `with ${S.tokensSay(ls.used)} tokens used`);

// The tokens that count against `limit.tokens`.
// A task done several times at once is one task to its limit: its attempts' tokens and its own count together,
// whichever of them is asked.
// A conversation counts once, whoever of them holds it: a chosen attempt's is the task's from then on
// (attempts/adopt.js), and is on both.
export function usedOf(t) {
  const top = taskOf(t) || t;
  let others = [];
  try { others = top?.attempts?.length ? S.attemptsOf(top) : []; } catch {}
  const files = new Map();
  let loose = 0, base = 0;
  for (const m of [top, ...others].map((x) => (x?.id === t?.id ? t : x))) {
    const own = Object.entries(m?.spent?.files || {});
    for (const [file, f] of own) files.set(file, Math.max(files.get(file) || 0, Number(f.n) || 0));
    if (!own.length) loose += m?.spent?.total || 0;
    base += m?.spent?.base || 0;
  }
  return Math.max(0, [...files.values()].reduce((sum, n) => sum + n, loose) - base);
}
// Whose run it is, when it began and the time limit that holds for it: store/runs.js.
export const { runRole, runBegan, runTime } = S;
// How long this run has taken. A run the board carried on with after its limit was raised goes on from the time it
// had already taken (`runCarry`, limits/reached.js).
export function ranFor(t, now = Date.now()) {
  const from = runBegan(t);
  if (!from) return 0;
  return Math.max(0, now - from) + (t.runCarry && t.runCarry.from === from ? Number(t.runCarry.ms) || 0 : 0);
}
// Every turn you start gives a task that a limit stopped its limit once more: the tokens count from here, the run
// from now. (What every human-started turn does to a task calls this: actions/talk.js, hook.js, finish/turn-ended.js.)
export function granted(t) {
  if (!t.limitStop) return;
  if (t.limitStop.what === "tokens") t.spent = { ...(t.spent || {}), base: (t.spent?.base || 0) + usedOf(t) }; // everything counted so far, its attempts' too
  t.limitStop = null; t.runCarry = null;
}
