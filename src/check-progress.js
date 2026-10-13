// The board's own check as a task shows it: the count its command reports, the wait for a turn, the minutes left, and saying so when it stands still.
//
// A check command tells the board where it is by writing one line to the file named in HERDR_SUPERWORK_PROGRESS
// (docs/check-progress.md). The runner reads that file while the command runs (finish/check-run.js) and keeps what it
// read on the task as `check`; this file turns that into the line, the percent and the minutes left. Nothing here is
// a guess: with no count there is no percent, and with no earlier run there are no minutes.
const MIN = 60000;
export const KNOWN_LINE = "The check already passed for this exact code";
// How long nothing may move before the row says so: three times what a whole run usually takes, never under three
// minutes; ten minutes where no run was ever timed.
export const stillAfter = (usual) => (usual > 0 ? Math.max(3 * MIN, 3 * usual) : 10 * MIN);
// A count under this share of the work says too little to work minutes out from (state.js has the same floor).
const MIN_SHARE = 0.05;

// What a check wrote: JSON ({"done":31,"total":47,"unit":"tests","before":0}, {"state":"waiting","ahead":2}, {"state":"known"})
// or, for a shell script, plain words ("31/47", "31 of 47 tests"). null: nothing the board can read.
export function readReport(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  const count = (n) => (Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.floor(Number(n)) : undefined);
  const plain = /^(\d+)\s*(?:\/|of)\s*(\d+)(?:\s+([A-Za-z][A-Za-z ]{0,19}))?$/.exec(s);
  let j = null;
  if (plain) j = { done: plain[1], total: plain[2], unit: plain[3] };
  else { try { j = JSON.parse(s); } catch { return null; } }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  if (j.state === "known") return { state: "known" };
  if (j.state === "waiting") return { state: "waiting", ahead: count(j.ahead) };
  if (j.state !== undefined && j.state !== "running") return null;
  const done = count(j.done), total = count(j.total);
  if (done === undefined || !total) return j.state === "running" ? { state: "running" } : null;
  // `before`: how many of those were finished before this run began (they passed earlier and were not run again).
  return { state: "running", done: Math.min(done, total), total, before: Math.min(count(j.before) || 0, done, total), unit: typeof j.unit === "string" ? j.unit.replace(/[^A-Za-z ]/g, "").trim().slice(0, 20) : "" };
}
// A check that just started: nothing read yet. `usual`: how long its last full runs took here, 0 when never timed.
export const startCheck = (now, usual = 0) => ({ at: now, runAt: now, movedAt: now, usual: usual > 0 ? usual : 0 });
// The check after one more reading. It keeps when things last moved (a file finished, the queue got shorter) and
// when the run itself began, which is later than `at` for a check that first waited for its turn.
export function stepCheck(c, r, now) {
  if (!r) return c;
  const n = { at: c.at, usual: c.usual, runAt: c.runAt, movedAt: c.movedAt, state: r.state };
  if (r.state === "waiting") {
    n.ahead = r.ahead;
    if (c.state !== "waiting" || c.ahead !== r.ahead) n.movedAt = now;
  } else if (r.state === "running") {
    Object.assign(n, { done: r.done, total: r.total, unit: r.unit, from: r.before || 0 }); // from: finished before this run began
    if (c.state !== "running" && c.state !== undefined) { n.runAt = now; n.movedAt = now; }
    if (r.done !== c.done) n.movedAt = now;
  }
  return n;
}
// How long the run itself took, for a run worth remembering: one that did all of its work (none of it had passed
// before) and was not answered at once. null otherwise.
export const ranFor = (c, now) => (c.state === "known" || c.state === "waiting" || (c.total && c.from > 0) ? null : Math.max(0, now - c.runAt));

const mins = (ms) => `${Math.max(1, Math.round(ms / MIN))}m`;
const spentWords = (ms) => (ms < MIN ? "under 1m" : `${Math.floor(ms / MIN)}m`);
const leftOf = (ms) => Math.min(99999, Math.max(1, Math.ceil(ms / MIN)));
// What the task shows: { msg, progress, eta }. `progress` only from a true count, `eta` (minutes left) only from the
// time earlier runs took or from the pace of this one.
export function checkShown(c, now = Date.now()) {
  const usual = c.usual > 0 ? c.usual : 0, idle = Math.max(0, now - (c.movedAt || c.at)), still = idle > stillAfter(usual);
  if (c.state === "known") return { msg: KNOWN_LINE };
  if (c.state === "waiting") {
    const ahead = c.ahead > 0 ? c.ahead : 0;
    if (still) return { msg: `Waiting for its turn unusually long · nothing moved for ${mins(idle)}${ahead ? ` · ${ahead} ahead` : ""}` };
    // The runs ahead, less the time since the queue last moved, then its own run.
    return { msg: `Waiting for its turn${ahead ? ` · ${ahead} ahead` : ""}`, eta: usual ? leftOf(Math.max(0, Math.max(1, ahead) * usual - idle) + usual) : undefined };
  }
  const spent = Math.max(0, now - (c.runAt || c.at));
  if (c.total > 0) {
    const done = Math.min(c.done || 0, c.total), from = Math.min(c.from || 0, done);
    const where = `${c.unit ? `${c.unit} ` : ""}${done} of ${c.total}`;
    const progress = done >= c.total ? 100 : Math.min(99, Math.floor((done / c.total) * 100));
    // All finished, and yet the command does not end: that too is standing still.
    if (done >= c.total) return still ? { msg: `The check has not ended · all finished ${mins(idle)} ago · ${where}`, progress } : { msg: `Running the check · ${where}`, progress, eta: 0 };
    if (still) return { msg: `The check stands still · nothing finished for ${mins(idle)} · ${where}`, progress };
    // How long a full run takes here, for the part this run has to do, less the time spent. Past that, or with no
    // run timed yet: at the pace of this run so far.
    const whole = usual * ((c.total - from) / c.total);
    const eta = whole > spent ? leftOf(whole - spent) : (done - from) / (c.total - from) >= MIN_SHARE ? leftOf(spent * (c.total - done) / (done - from)) : undefined;
    return { msg: `Running the check · ${where}`, progress, eta };
  }
  // No count the board can read: the time it has run, against what it took before when that is known. Never a percent.
  if (!usual) return { msg: `Running the check · ${spentWords(spent)}` };
  if (spent > Math.max(3 * usual, usual + 10 * MIN)) return { msg: `The check runs far longer than usual · ${spentWords(spent)}, usually ${mins(usual)}` };
  if (spent >= usual) return { msg: `Running the check · ${spentWords(spent)}, usually ${mins(usual)}` };
  return { msg: `Running the check · ${spentWords(spent)} of about ${mins(usual)}`, eta: leftOf(usual - spent) };
}
