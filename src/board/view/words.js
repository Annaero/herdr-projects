// Small words and numbers the board's parts share: a time as "12m", a pull request as "PR#16", a long text cut short.
import os from "node:os";
import * as S from "../../store.js";

export const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
// A long text's beginning, for the panel beside the list: cut between words, a few lines at most.
export const brief = (text, max = 400, mark = " …") => {
  let s = String(text ?? "").trim().replace(/\n{2,}/g, "\n");
  const lines = s.split("\n");
  if (lines.length > 8) { s = lines.slice(0, 8).join("\n"); if (s.length <= max) return s + mark; }
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"), max - 40)).trimEnd() + mark;
};
export const short = S.tilde;
export const clean = (s) => String(s ?? "").replace(/[\x00-\x1f\x7f]+/g, " ");
export const age = (ms) => { const x = Math.max(0, Math.round(ms / 1000)); return x < 60 ? `${x}s` : x < 3600 ? `${Math.floor(x / 60)}m` : x < 86400 ? `${Math.floor(x / 3600)}h` : `${Math.floor(x / 86400)}d`; };
// The minutes left on a row, never wider than four cells ("999m"): from a thousand on they are hours ("17h").
export const left = (min) => (min < 1000 ? `${min}m` : `${Math.min(999, Math.round(min / 60))}h`);
export const prNumber = (r) => (r.pr ? `PR#${String(r.pr).split("/").pop()}` : "");
// A pull request's checks are the colour of its number, by the review tag's rule (reviewTagColor) and with no mark
// beside it: green, they pass; red, they fail; plain, no result yet (they run, or there are none). Merged, it goes
// quiet: nothing there needs your eye, and a list of done tasks must not be a wall of green.
// Quiet is the theme's own muted, so that it is quieter than plain in the terminal's colours too.
export const merged = (r) => !!(r.prMerged || r.prState === "merged");
// The work landed: its pull request is merged, or the task finished (stage "done": a branch merged here with no pull
// request sets no pull request flag).
export const landed = (r) => merged(r) || r.stage === "done";
export const ink = (t, c, s) => (!s ? "" : c === "overlay0" ? t.muted(s) : t.fg(c, s));
export const prTag = (t, r, s = prNumber(r)) => ink(t, prColor(r), s);
export const prColor = (r) => (merged(r) ? "overlay0" : { passing: "green", failing: "red" }[r.prState] || "subtext0");
export const repoLabel = (name) => (S.knownRepos()[name] === os.homedir() ? "~" : name);
export const idLabel = (id) => { const [repo, ...rest] = String(id).split("/"); return [repoLabel(repo), ...rest].join("/"); };
// A moment as a person reads it, the same on every machine: "Mon 19 Oct, 09:00".
export const when = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, "0"); return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}, ${p(d.getHours())}:${p(d.getMinutes())}`; };
export const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n || 0));
export const bar = (pct, n = 8) => "█".repeat(Math.round((pct / 100) * n)).padEnd(n, "░");
