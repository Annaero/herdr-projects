// Automations on disk: the list (a saved task plus a trigger, each), every firing written down, and which board
// events were seen already. All of it is one folder in the data folder,
// `automations/`, and belongs to this machine. What an automation is and does: src/automations/, docs/automations.md.
import fs from "node:fs";
import path from "node:path";
import { dataDir, readJson, writeJson, readLines, withLock } from "./files.js";

export const automationsDir = () => path.join(dataDir(), "automations");
const listFile = () => path.join(automationsDir(), "automations.json");
const firingsFile = (id) => path.join(automationsDir(), "firings", `${id}.jsonl`);
const eventsFile = () => path.join(automationsDir(), "events.json");
const ID = /^[a-f0-9]{8}$/;
// The most firings kept for one automation: older ones go, the newest stay.
export const FIRINGS_KEPT = 200;

// ---- the list ----------------------------------------------------------------------------------------------------------
export const automations = () => { const j = readJson(listFile()); return Array.isArray(j?.list) ? j.list.filter((a) => a && ID.test(a.id)) : []; };
export const hasAutomations = () => fs.existsSync(listFile());
// One automation by its name (any case) or its id; null when there is none.
export function automation(ref) {
  const want = String(ref ?? "").trim().toLowerCase();
  return (want && automations().find((a) => a.id === want || String(a.name).toLowerCase() === want)) || null;
}
// The one way the list changes: a short read-modify-write under its lock. `fn` gets the list and changes it in place.
export function changeAutomations(fn) {
  return withLock("automations", () => { const list = automations(); const out = fn(list); writeJson(listFile(), { list }); return out; }, { waitMs: 5000 });
}
// One automation changed in place; null when it is gone.
export const changeAutomation = (id, fn) => changeAutomations((list) => { const a = list.find((x) => x.id === id); if (!a) return null; fn(a); return a; });

// ---- its firings: one line each, the newest last on disk ---------------------------------------------------------------
export const firingsOf = (id) => (ID.test(String(id)) ? readLines(firingsFile(id)) : []);
// A firing is written down. The same skip again and again is one line with a count, so a schedule that
// comes round a thousand times while its task is busy does not write a thousand lines.
export function noteFiring(id, entry) {
  return withLock("automation-firings", () => {
    const all = firingsOf(id), last = all.at(-1);
    if (entry.skipped && last?.skipped === entry.skipped) all[all.length - 1] = { ...last, ...entry, n: (last.n || 1) + 1 };
    else all.push(entry);
    const kept = all.slice(-FIRINGS_KEPT), file = firingsFile(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, kept.map((e) => JSON.stringify(e)).join("\n") + "\n"); fs.renameSync(tmp, file);
    return kept.at(-1);
  }, { waitMs: 5000 });
}
export function dropFirings(id) { if (ID.test(String(id))) fs.rmSync(firingsFile(id), { force: true }); }

// ---- board events seen already: { "<task id>": ["added", "merged:17…", …] }, or null before the first look ---------------
export const eventsSeen = () => readJson(eventsFile());
export const saveEventsSeen = (seen) => writeJson(eventsFile(), seen);
export const dropEventsSeen = () => fs.rmSync(eventsFile(), { force: true });
