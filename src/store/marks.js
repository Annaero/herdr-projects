// Small shared files: stamps, hook tokens, turn-ended events, marks.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { dataDir, dirOf, readJson, writeJson, VERSION, withLock } from "./files.js";

// ---- view preferences and small shared files -------------------------------------------------------------------------
export const stampFile = (name) => path.join(dataDir(), "stamps", name);
// True at most once per `ms` across all processes: the housekeeping pass rides on every hook run and board tick.
export function due(name, ms) {
  const file = stampFile(name);
  let last = 0;
  try { last = fs.statSync(file).mtimeMs; } catch {}
  if (Date.now() - last < ms) return false;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, String(process.pid)); } catch {}
  return true;
}
export const tilde = (p) => (p === os.homedir() ? "~" : String(p).startsWith(os.homedir() + "/") ? "~" + String(p).slice(os.homedir().length) : String(p));

// ---- per-launch hook tokens: beside the task, never in its record, so no listing, snapshot or log prints them --------
const tokensFile = (id) => path.join(dirOf(id), "tokens.json");
export function setToken(id, role, token, round = 0) {
  const j = readJson(tokensFile(id), {}) || {};
  if (role === "reviewer") j.reviewer = { ...(j.reviewer || {}), [round]: token }; else j.agent = token;
  fs.mkdirSync(dirOf(id), { recursive: true });
  fs.writeFileSync(tokensFile(id), JSON.stringify(j), { mode: 0o600 });
}
// The chosen attempt's agent goes on as its task's (attempts/adopt.js): its hook's token is the task's from then on.
export function copyToken(from, to) { const j = readJson(tokensFile(from), {}) || {}; if (j.agent) setToken(to, "agent", j.agent); }
export function tokenOk(id, role, token, round = 0) {
  const j = readJson(tokensFile(id), {}) || {};
  const want = role === "reviewer" ? j.reviewer?.[round] : j.agent;
  return !!want && !!token && want === token;
}
// ---- turn-ended events: appended by the agent's own hook, judged only by the finish runner ---------------------------
export const pendingEvents = (t) => (t?.events || []).filter((e) => e.n > (t.eventsHandled || 0));
// ---- marks: "this kind's hook (or reader) does not work on this machine", valid for one program and plugin version ---
const marksFile = () => path.join(dataDir(), "marks.json");
export function mark(name, version) { const m = readJson(marksFile(), {}) || {}; const k = m[name]; return k && k.set && k.program === version && k.plugin === VERSION ? k : null; }
// Count one more turn in a row (or reset with ok = true). Returns true when the mark was set just now.
export function countMark(name, version, ok) {
  return withLock("marks", () => {
    const m = readJson(marksFile(), {}) || {};
    const k = m[name] && m[name].program === version && m[name].plugin === VERSION ? m[name] : { program: version, plugin: VERSION, n: 0, set: false };
    if (ok) { if (!k.n && !k.set) return false; k.n = 0; k.set = false; m[name] = k; writeJson(marksFile(), m); return false; }
    k.n += 1;
    const now = !k.set && k.n >= 3;
    if (now) k.set = true;
    m[name] = k; writeJson(marksFile(), m);
    return now;
  });
}
