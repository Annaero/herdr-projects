// Running the repo's check with its progress shown: the file the command reports to, what is kept on the task while it runs, and telling herdr's sidebar.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import { sh } from "../runner.js";
import { herdr } from "../herdr.js";
import { readReport, startCheck, stepCheck, checkShown, ranFor, KNOWN_LINE } from "../check-progress.js";

// The name of the file a check writes its progress to, given to the command in this variable (docs/check-progress.md).
export const PROGRESS_ENV = "HERDR_SUPERWORK_PROGRESS";
export const progressFile = (id) => path.join(S.dirOf(id), "check-progress");
// herdr's sidebar hears of a change at most this often, and again this often with no change, before what it was told runs out.
const TELL_MS = 5000, TELL_AGAIN_MS = 60000, TELL_TTL_MS = 180000;

// The line, the percent and the minutes left as pane metadata tokens, the ones the Watcher fills for an agent at
// work (helpers.js), so herdr's own sidebar shows the check the same way. `shown` null: the check is over.
export function tellCheck(t, shown) {
  if (!t.link?.pane || !t.link.socket) return;
  const token = (name, value) => (value === undefined ? ["--clear-token", name] : ["--token", `${name}=${value}`]);
  const args = shown ? [...token("summary", shown.msg), ...token("progress", shown.progress === undefined ? undefined : `${shown.progress}%`), ...token("eta", shown.eta === undefined ? undefined : `${shown.eta}m`), "--ttl-ms", String(TELL_TTL_MS)]
    : ["--clear-token", "summary", "--clear-token", "progress", "--clear-token", "eta"];
  try { herdr(t.link.socket).metadata(t.link.pane, args); } catch {}
}
// One check being followed. `look()` reads what the command wrote and keeps it on the task when it changed (as this
// runner: a superseded runner's look throws Aborted, which stops its check). `end(ok)` is the last look: it takes
// the check off the task, remembers how long a full run that passed took, and says so when the answer was known.
export function follow(g, t, { cmd, root, file = progressFile(t.id), now = () => Date.now() } = {}) {
  let check = startCheck(now(), S.usualCheck(root, cmd)), seen = "", told = { at: 0, key: "", state: undefined };
  try { fs.rmSync(file, { force: true }); } catch {}
  t = g.set({ msg: "Running the check", check });
  // At once when the check goes from one state to another (its turn came); a count that moves, a little later.
  const tell = () => {
    const at = now(), shown = checkShown(check, at), key = JSON.stringify(shown);
    if (check.state === told.state && told.at && (key === told.key ? at - told.at < TELL_AGAIN_MS : at - told.at < TELL_MS)) return;
    told = { at, key, state: check.state };
    tellCheck(t, shown);
  };
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
  tell();
  return {
    file,
    look() { if (read()) t = g.set({ check }); tell(); },
    end(ok) {
      read();
      const known = check.state === "known", ran = ok ? ranFor(check, now()) : null;
      if (ran !== null) S.noteCheckRun(root, cmd, ran);
      try { fs.rmSync(file, { force: true }); } catch {}
      tellCheck(t, null);
      return { known, check };
    },
  };
}
// The check itself. Returns what `sh` does, plus `known` when the command answered at once for code that passed before.
export async function runCheck(g, t, { cmd, folder, env, alive, root }) {
  const f = follow(g, t, { cmd, root });
  const r = await sh(cmd, folder, { ...env, [PROGRESS_ENV]: f.file }, { alive, tick: () => f.look() });
  const { known } = f.end(r.ok && !r.aborted);
  if (r.aborted) return r;
  // Off the task again; the row says an answer that took no run, and then moves on.
  g.set((t) => { t.check = null; if (known && r.ok) t.msg = KNOWN_LINE; });
  return { ...r, known };
}
