// What a task has used: the tokens of every conversation it had (its agent's, each reviewer's, each new chat's),
// added up on the task, and how long its agent's run has taken.
//
// Tokens. Each conversation file has a counter of its own (agents/read-tokens.js) that reads on from where it
// stopped, kept on the task as `spent.files[<file>]`; `spent.total` is their sum, so a file is never counted twice
// and a reviewer's tokens stay counted after its tab is closed. While no limit is said, the conversations are only
// written down (`spent.owed`) and read when one is. Counted at the end of every turn (a worker's:
// finish/turn-ended.js, a reviewer's: finish/review.js) and, for the panel, every few seconds while one runs.
// `spent.base` is where the count of `limit.tokens` starts: 0, then the total at the moment you said to carry on
// after the limit stopped the task, so your word gives it the limit once more.
import fs from "node:fs";
import * as S from "../store.js";
import { adapter } from "../agents.js";
import { limitSaid } from "./run.js";

// Can this program's tokens be counted? Where not, `limit.tokens` does nothing for it (store/settings/show.js says so).
export const canCount = (kind) => typeof adapter(kind).tokens === "function";
const kindOf = (t, role) => (role === "reviewer" ? t.link?.reviewer?.kind : t.agent);
// A conversation the task had, as it is found again later: { kind, session, file, cwd }.
function known(t, role) {
  const kind = kindOf(t, role), session = (role === "reviewer" ? t.reviewSession : t.session) || "", file = role !== "reviewer" && t.transcript ? t.transcript : "";
  return kind && (session || file) ? { kind, session, file, cwd: S.cwdOf(t) } : null;
}
const same = (a, b) => a.kind === b.kind && a.session === b.session && a.file === b.file;
// Where a conversation is on disk now, or null.
function fileOf(e) {
  if (e.file && fs.existsSync(e.file)) return e.file;
  try { return e.session && adapter(e.kind).transcript ? adapter(e.kind).transcript(e.session, e.cwd) : null; } catch { return null; }
}
// `spent` with every conversation the task is owed read first, then this role's read on; null when nothing changed.
// `owed`: the conversations it had while no limit was said (see `count`), which nobody has looked for yet.
export function counted(t, role = "agent") {
  const spent = t.spent || {}, files = { ...(spent.files || {}) };
  let changed = false;
  const read = (e) => {
    if (!e || !canCount(e.kind)) return;
    const file = fileOf(e);
    if (!file) return;
    try { const was = files[file], now = adapter(e.kind).tokens(file, was); if (!was || was.at !== now.at || was.n !== now.n) { files[file] = now; changed = true; } } catch {}
  };
  for (const e of spent.owed || []) read(e);
  read(known(t, role));
  if (!changed && !(spent.owed || []).length) return null;
  const { owed, ...rest } = spent;
  return { ...rest, files, total: Object.values(files).reduce((sum, f) => sum + (Number(f.n) || 0), 0) };
}
// Count a role's conversation onto its task. Returns the task as it now is.
// While no limit is said for the task, nothing is looked for on disk (a board with no limits pays nothing for
// having them): the conversation is only written down as owed, so that a limit set later still counts all of the
// task: every review that ended before, and a chat its agent left for a new one.
export function count(id, role = "agent", waitMs = 10000) {
  const seen = S.get(id);
  if (!seen) return seen;
  try {
    if (!limitSaid(seen)) {
      const e = known(seen, role);
      if (!e || !canCount(e.kind) || (seen.spent?.owed || []).some((o) => same(o, e))) return seen;
      return S.update(id, (t) => { const now = known(t, role); if (!now || (t.spent?.owed || []).some((o) => same(o, now))) return false; t.spent = { ...(t.spent || {}), owed: [...(t.spent?.owed || []), now] }; }, { waitMs });
    }
    if (!counted(seen, role)) return seen; // nothing new: nothing is written
    return S.update(id, (t) => { const s = counted(t, role); if (!s) return false; t.spent = s; }, { waitMs });
  } catch { return S.get(id); }
}
