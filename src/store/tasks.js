// Tasks on disk: reading, listing, changing, creating, and finding one by what it is called (its id, its number, its repo's key).
import fs from "node:fs";
import path from "node:path";
import { STAGES, tasksDir, dirOf, me, readJson, writeJson, withLock, withTaskLock } from "./files.js";
import { repoOf } from "./repos.js";
import { titled } from "./titles.js";
import { movedOnRead } from "./settings/migrate.js";
import { researchMoved } from "./old-research.js";
import { idOfKey } from "./keys.js";

// ---- tasks ----------------------------------------------------------------------------------------------------------
const SEGMENT = /^[A-Za-z0-9_.+-]{1,32}$/;
// Minutes left, as the Watcher or a report gave them: a whole number from 0 up, or undefined when none was given.
export const minutes = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? undefined : Math.max(0, Math.min(99999, Math.round(Number(v)))));
export const oneLine = (text, max = 2048) => { let t = String(text ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim(); while (Buffer.byteLength(t, "utf8") > max) t = t.slice(0, -1); return t; };
const taskFile = (id) => path.join(dirOf(id), "task.json");
export function get(id) {
  const t = readJson(taskFile(id));
  return t && t.id ? researchMoved(movedOnRead(t)) : null; // a task an older version saved reads in the new names (settings/migrate.js, old-research.js)
}
export function list({ includeArchived = false, archived = false } = {}) {
  const out = [];
  let repos = [];
  try { repos = fs.readdirSync(tasksDir()); } catch {}
  for (const repo of repos) {
    let ns = [];
    try { ns = fs.readdirSync(path.join(tasksDir(), repo)); } catch { continue; }
    for (const n of ns) {
      if (!/^\d+$/.test(n)) continue;
      const t = get(`${repo}/${n}`);
      if (!t) continue;
      if (archived ? !t.archivedAt : t.archivedAt && !includeArchived) continue;
      out.push(t);
    }
  }
  return out.sort((a, b) => (b.created || 0) - (a.created || 0));
}
export function find(ref) {
  const s = String(ref || "").trim(), byKey = idOfKey(s); // `HSW-134`: the repo's short key and the number (store/keys.js)
  const hit = (/^[^/]+\/\d+$/.test(s) && get(s)) || (byKey && get(byKey)) || list({ includeArchived: true }).find((t) => t.id.toLowerCase() === s.toLowerCase() || String(t.n) === s.replace(/^#/, ""));
  if (!hit) throw new Error(`No task ${ref}`);
  return hit;
}
export function assertUnarchived(t) { if (t.archivedAt) throw new Error(`${t.id} is archived. Restore it before making changes.`); }
// The one way a task changes: a short read-modify-write under its lock. `fn` may mutate the task or return a patch.
// Never held across a check, a review or a herdr call.
export function update(id, fn, opts) {
  return withTaskLock(id, () => {
    const t = get(id);
    if (!t) throw new Error(`No task ${id}`);
    const before = t.stage;
    // The Watcher's sentence about the agent's work outlives the guess it came with: whatever this change does to
    // `watch` (every new run drops it), the sentence is kept with its time (status-kept.js). Kept here, where every
    // change passes, so a task saved by an older version keeps its sentence too.
    if (t.watch?.role === "agent" && t.watch.msg) t.lastLine = { msg: t.watch.msg, at: t.watch.at };
    const patch = typeof fn === "function" ? fn(t) : fn;
    if (patch === false) return t; // nothing to write
    if (patch && typeof patch === "object") Object.assign(t, patch);
    if (t.stage !== before) { t.at = Date.now(); if (!STAGES.includes(t.stage)) throw new Error(`Unknown stage ${t.stage}`); }
    writeJson(taskFile(id), t);
    return t;
  }, opts);
}
export function create(folder, title, extra = {}) {
  const { name, root } = repoOf(folder);
  // A title longer than the limit is shortened, and its full text opens the description (store/titles.js).
  const { title: text, description } = titled(title, extra.description);
  if (!text) throw new Error("A task needs a title.");
  return withLock(`seq:${name}`, () => {
    const seq = path.join(tasksDir(), name, "seq");
    const n = (Number(readJson(seq, 0)) || 0) + 1;
    writeJson(seq, n);
    const now = Date.now();
    const t = { id: `${name}/${n}`, repo: name, n, root, title: text, description, owner: extra.owner || me(), app: null,
      stage: "todo", msg: "", created: now, at: now, pinned: false, archivedAt: null, settings: {} };
    writeJson(taskFile(t.id), t);
    return t;
  });
}
export function remove(id) { fs.rmSync(dirOf(id), { recursive: true, force: true }); }
