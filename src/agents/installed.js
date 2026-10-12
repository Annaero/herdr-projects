// What is installed on this machine, whether its turn-end hook can be used, and pre-trusting a repo.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { config, dataDir, readJson, writeJson, mark } from "../store.js";
import { adapter } from "./start.js";

// ---- what is installed, and whether its hook can be used on this machine --------------------------------------------
export function versionOf(kind) {
  if (!/^[a-z][a-z0-9_-]*$/.test(String(kind))) return "";
  const file = path.join(dataDir(), "versions.json");
  const all = readJson(file, {}) || {};
  if (all[kind] && Date.now() - all[kind].at < 600000) return all[kind].v;
  const r = spawnSync(kind, ["--version"], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] });
  const v = r.status === 0 ? (String(r.stdout).match(/\d+\.\d+(?:\.\d+)?/) || [""])[0] : "";
  try { writeJson(file, { ...all, [kind]: { v, at: Date.now(), found: !r.error } }); } catch {}
  return v;
}
export const installed = (kind) => { versionOf(kind); return (readJson(path.join(dataDir(), "versions.json"), {}) || {})[kind]?.found !== false; };
const atLeast = (v, min) => { const a = String(v).split(".").map(Number), b = String(min).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); } return true; };
// Can this kind's turn-end hook be passed at launch here? Decided per machine: the installed version meets the
// adapter's minimum, and the hook is not marked as not working for this program and plugin version.
export function hookUsable(kind) {
  const a = adapter(kind);
  if (!a.hookArgs || process.env.HERDR_SUPERWORK_NO_HOOK === "1") return false;
  const v = versionOf(kind);
  return !!v && atLeast(v, a.minVersion || "0") && !mark(`hook:${kind}`, v);
}
// Does a finished turn still need the closing note? Yes unless the hook and the reader both work for this kind.
export const needsNote = (kind) => !adapter(kind).readTurn || !hookUsable(kind) || !!mark(`reader:${kind}`, versionOf(kind));
// The end of a task's (or its reviewer's) saved conversation, or null. Never throws.
export function readTurnOf(kind, { file, session, cwd } = {}) {
  const a = adapter(kind);
  if (!a.readTurn) return null;
  try { const f = file && fs.existsSync(file) ? file : session && a.transcript ? a.transcript(session, cwd) : null; if (!f) return null; const t = a.readTurn(f); return t ? { ...t, file: f } : null; } catch { return null; }
}
export const fullAccess = (kind) => { const user = config().agentArgs?.[kind]; return (Array.isArray(user) ? user : adapter(kind).args || []).some((x) => /dangerously|bypass|yolo/i.test(x)) || kind === "pi"; };
export const interruptKey = (kind) => adapter(kind).interrupt || "esc";
// Best effort: a failure here only means the agent's own trust dialog shows, which the inbox handles.
export function preTrust(kind, root) {
  if (!config().trust || !adapter(kind).trust || !fullAccess(kind)) return false;
  try { return adapter(kind).trust(root); } catch { return false; }
}
