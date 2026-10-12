// Text on its way: an agent's inbox, and instructions for a Coordinator.
import fs from "node:fs";
import path from "node:path";
import { dataDir, dirOf, readJson, writeJson, appendLine, readLines, markerAlive, withLock } from "./files.js";

// ---- the inbox: text for an agent that could not be delivered yet. Never dropped. ----------------------------------
const inboxFile = (id) => path.join(dirOf(id), "inbox.jsonl");
export function queueText(id, text, extra = {}) { appendLine(inboxFile(id), { text: String(text), at: Date.now(), ...extra }); }
export function pendingText(id) {
  const all = readLines(inboxFile(id));
  const off = Number(readJson(path.join(dirOf(id), "inbox.offset"), 0)) || 0;
  return all.slice(off);
}
export function takeText(id) {
  const all = readLines(inboxFile(id));
  const off = Number(readJson(path.join(dirOf(id), "inbox.offset"), 0)) || 0;
  writeJson(path.join(dirOf(id), "inbox.offset"), all.length);
  return all.slice(off);
}
// Put taken text back (the delivery failed after all).
export function untakeText(id, count) {
  const file = path.join(dirOf(id), "inbox.offset");
  writeJson(file, Math.max(0, (Number(readJson(file, 0)) || 0) - count));
}

// ---- dispatcher instructions: siblings of the tasks on disk, so a running or failed one survives the board ---------
const dispatchDir = () => path.join(dataDir(), "dispatch");
export function newDispatch(text, extra = {}) {
  return withLock("seq:dispatch", () => {
    const seq = path.join(dispatchDir(), "seq");
    const n = (Number(readJson(seq, 0)) || 0) + 1;
    writeJson(seq, n);
    const d = { id: `dispatch/${n}`, n, text: String(text), state: "working", msg: "", created: Date.now(), ...extra };
    writeJson(path.join(dispatchDir(), `${n}.json`), d);
    return d;
  });
}
export const getDispatch = (id) => readJson(path.join(dispatchDir(), `${String(id).split("/").pop()}.json`));
export function setDispatch(id, patch) { const d = getDispatch(id); if (!d) return null; const next = { ...d, ...patch }; writeJson(path.join(dispatchDir(), `${d.n}.json`), next); return next; }
export function clearDispatch(id) { fs.rmSync(path.join(dispatchDir(), `${String(id).split("/").pop()}.json`), { force: true }); }
export function dispatches() {
  let names = [];
  try { names = fs.readdirSync(dispatchDir()).filter((f) => /^\d+\.json$/.test(f)); } catch {}
  const out = names.map((f) => readJson(path.join(dispatchDir(), f))).filter(Boolean).sort((a, b) => a.n - b.n);
  // A working one whose helper process is gone did not finish: say so instead of spinning forever.
  for (const d of out) if (d.state === "working" && d.pid && !markerAlive({ pid: d.pid, start: d.pidStart }) && Date.now() - d.created > 3000) Object.assign(d, setDispatch(d.id, { state: "error", msg: d.msg || "stopped before it finished" }));
  return out;
}
