// The Watcher's pace: how often it looks, how much it gives way when the machine is busy, and which screens count as changed.
// Nothing here starts a program or reads a file: the look itself is helpers.js.
import os from "node:os";

export const TICK_MS = 5000; // the Watcher thinks about looking this often, not on every tick of the board
export const GAP_MS = 15000; // from one call's start to the next, at the least
export const BATCH = 8; // agents one call covers at the most; the rest ride in the next call

// How busy the machine is: the one-minute load per core. 1 is every core in use, 2 is twice what it can do.
export const loadNow = () => os.loadavg()[0] / Math.max(1, os.availableParallelism?.() || os.cpus().length);
// The Watcher is the first to give way: up to three quarters of the cores in use it keeps its pace, a fully used
// machine doubles the wait between looks, and from 1.75 on it looks five times less often.
export const slowdown = (load) => (load > 0.75 ? Math.min(5, 1 + (load - 0.75) * 4) : 1);
// A call that failed (no answer, a provider error) is not tried again at full pace: each failure in a row doubles
// the wait, up to eight times.
export const afterFailures = (fails) => Math.min(8, 2 ** Math.max(0, fails));

// The words on a screen, without what changes while nothing happens: a spinner's glyph, a timer, a token count.
// Two screens with the same words are the same screen, and a second look at it would say what the first one said.
export const wordsOf = (lines) => String(lines).replace(/[^\p{L}\n]+/gu, " ").replace(/(^| )\p{L}(?= |$)/gmu, " ").replace(/ +/g, " ").trim();
// The last lines of a screen, as the Watcher is shown them.
export const lastLines = (screen) => String(screen).split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-30).join("\n").slice(-3000);

// Who rides in the next call. `rows` is [{ id, at }] with `at` the time of each one's last look (0: never looked at).
// Nobody is looked at before its time (`every`) is up. A call takes everyone whose time is up, the longest wait
// first. So that agents which started at different moments end up in one call instead of one call each, a call holds
// off while another agent is more than half-way to its own time, but nobody waits more than half as long again.
export function riders(rows, now, every) {
  const wait = (r) => now - (r.at || 0);
  const due = rows.filter((r) => wait(r) >= every);
  if (!due.length) return [];
  const soon = rows.some((r) => wait(r) >= every / 2 && wait(r) < every);
  if (soon && !due.some((r) => wait(r) >= every * 1.5)) return [];
  return due.sort((a, b) => (a.at || 0) - (b.at || 0));
}
