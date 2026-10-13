// A record of conflicts with main: one line per conflict, appended to `conflicts.jsonl` in the data folder once the
// conflict is repaired and the board knows whether a new review followed. The board kept no trace of a conflict once
// it was repaired, so "how often, in which files, how long did it cost" had to be rebuilt from git and the logs each
// time; now it is a read. A line: { at, task, files, minutes, repairs, review }.
//   at        when the conflict was found (ISO time)
//   files     the files that conflicted, every round of the repair added up
//   minutes   from the conflict being found to the branch being up to date with main again
//   repairs   how often the agent was sent back before it was
//   review    true when the repaired work was reviewed anew, false when the review it had was kept
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";

export const conflictLog = () => path.join(S.dataDir(), "conflicts.jsonl");
const files = (r) => String(r?.files || "").split("\n").map((f) => f.trim()).filter(Boolean);
// A conflict was found (sync.js: conflictBack). Changes the task in place: a repair that conflicts again is the same
// conflict, counted once from the moment it was first found.
export function conflictFound(t, r, now = Date.now()) {
  const was = t.conflict && !t.conflict.repairedAt ? t.conflict : null;
  t.conflict = { at: was?.at || now, files: [...new Set([...(was?.files || []), ...files(r)])], repairs: (was?.repairs || 0) + 1 };
}
// The branch is up to date with main again. Changes the task in place; nothing where no conflict is open.
export function conflictRepaired(t, now = Date.now()) {
  if (t.conflict && !t.conflict.repairedAt) t.conflict = { ...t.conflict, repairedAt: now };
}
// The repaired work reached its review, or kept the one it had: the line is written and the task forgets the conflict.
// Returns the line, or null where there was nothing to write. Never throws: a log must not stop a finish line.
export function conflictLogged(t, reviewed) {
  const c = t.conflict;
  if (!c?.repairedAt) return null;
  const line = { at: new Date(c.at).toISOString(), task: t.id, files: c.files, minutes: Math.max(0, Math.round((c.repairedAt - c.at) / 6000) / 10), repairs: c.repairs, review: !!reviewed };
  try { fs.mkdirSync(path.dirname(conflictLog()), { recursive: true }); fs.appendFileSync(conflictLog(), `${JSON.stringify(line)}\n`); } catch {}
  t.conflict = null;
  return line;
}
// Every line of the record, oldest first.
export function conflicts() {
  try { return fs.readFileSync(conflictLog(), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
