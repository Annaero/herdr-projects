// Running the repo's check with its progress shown: the file the command reports to, and what is kept on the task while it runs (the row shows that, and herdr's sidebar the row: flow/sidebar.js).
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import { sh } from "../runner.js";
import { readReport, startCheck, stepCheck, ranFor, KNOWN_LINE } from "../check-progress.js";

// The name of the file a check writes its progress to, given to the command in this variable (docs/check-progress.md).
export const PROGRESS_ENV = "HERDR_SUPERWORK_PROGRESS";
export const progressFile = (id) => path.join(S.dirOf(id), "check-progress");
// One check being followed. `look()` reads what the command wrote and keeps it on the task when it changed (as this
// runner: a superseded runner's look throws Aborted, which stops its check). `end(ok)` is the last look: it takes
// the check off the task, remembers how long a full run that passed took, and says so when the answer was known.
export function follow(g, t, { cmd, root, file = progressFile(t.id), now = () => Date.now() } = {}) {
  let check = startCheck(now(), S.usualCheck(root, cmd)), seen = "";
  try { fs.rmSync(file, { force: true }); } catch {}
  t = g.set({ msg: "Running the check", check });
  const read = () => {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch {}
    if (text === seen) return false;
    seen = text;
    const next = stepCheck(check, readReport(text), now());
    if (JSON.stringify(next) === JSON.stringify(check)) return false;
    check = next;
    return true;
  };
  return {
    file,
    look() { if (read()) t = g.set({ check }); },
    end(ok) {
      read();
      const known = check.state === "known", ran = ok ? ranFor(check, now()) : null;
      if (ran !== null) S.noteCheckRun(root, cmd, ran);
      try { fs.rmSync(file, { force: true }); } catch {}
      return { known, check };
    },
  };
}
// The check itself. Returns what `sh` does, plus `known` when the command answered at once for code that passed before.
export async function runCheck(g, t, { cmd, folder, env, alive, root, timeoutMin = 15 }) {
  const f = follow(g, t, { cmd, root });
  const r = await sh(cmd, folder, { ...env, [PROGRESS_ENV]: f.file }, { alive, tick: () => f.look(), timeoutMin });
  const { known } = f.end(r.ok && !r.aborted);
  if (r.aborted) return r;
  // Off the task again; the row says an answer that took no run, and then moves on.
  g.set((t) => { t.check = null; if (known && r.ok) t.msg = KNOWN_LINE; });
  return { ...r, known };
}
