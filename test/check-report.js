// What the test command tells whoever started it, and the line of runs waiting for a turn. The board gives its check
// the name of a file in HERDR_SUPERWORK_PROGRESS and reads it while the check runs (docs/check-progress.md):
// how many test files are finished out of how many, how many runs are ahead of this one, or that the answer was known.
import fs from "node:fs";
import path from "node:path";

// Takes the file's name out of the environment: the tests this run starts must not write to it (some run this very
// command on a repo of their own). Returns what writes one report; it does nothing when nobody asked.
export function reporter(env = process.env) {
  const file = env.HERDR_SUPERWORK_PROGRESS || "";
  delete env.HERDR_SUPERWORK_PROGRESS;
  let last = "";
  return (report) => {
    const text = JSON.stringify(report);
    if (!file || text === last) return;
    last = text;
    try { fs.writeFileSync(`${file}.tmp`, `${text}\n`); fs.renameSync(`${file}.tmp`, file); } catch {}
  };
}

// ---- the line -------------------------------------------------------------------------------------------------------
// A run that has to wait puts a file in <store>/queue, named so that the names sort by when each came, and touches it
// while it waits. A file not touched for LINE_GONE_MS belongs to a run that is gone: it counts for nothing and is
// removed. A run only tries for a slot when fewer runs than there are slots came before it, so turns go in order
// and "2 ahead" is true.
export const LINE_GONE_MS = 5000;
const lineDir = (store) => path.join(store, "queue");
export function joinLine(store, now = Date.now(), pid = process.pid) {
  fs.mkdirSync(lineDir(store), { recursive: true });
  const file = path.join(lineDir(store), `${String(now).padStart(15, "0")}-${pid}`);
  fs.writeFileSync(file, "");
  return file;
}
export const stayInLine = (file, now = Date.now()) => { try { fs.utimesSync(file, now / 1000, now / 1000); } catch { try { fs.writeFileSync(file, ""); } catch {} } };
export const leaveLine = (file) => { if (file) fs.rmSync(file, { force: true }); };
// How many runs wait before `mine` (before everyone, with no file of its own yet).
export function waitingBefore(store, mine = null, now = Date.now()) {
  let names = [];
  try { names = fs.readdirSync(lineDir(store)).sort(); } catch {}
  let n = 0;
  for (const name of names) {
    const file = path.join(lineDir(store), name);
    if (mine && name >= path.basename(mine)) break;
    try { if (now - fs.statSync(file).mtimeMs > LINE_GONE_MS) { fs.rmSync(file, { force: true }); continue; } } catch { continue; }
    n += 1;
  }
  return n;
}
