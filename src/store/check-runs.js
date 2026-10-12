// How long a repo's check took the last few times it ran in full on this machine: what its minutes left are worked out from.
import path from "node:path";
import { dataDir, readJson, writeJson, withLock } from "./files.js";

// One list per repo and command: another command is another check. The middle of the last few, so one slow run on a
// busy machine does not move it.
export const CHECK_RUNS_KEPT = 5;
const file = () => path.join(dataDir(), "check-runs.json");
const key = (root, cmd) => `${path.resolve(String(root || ""))}\n${String(cmd || "").trim()}`;
// Milliseconds a full run usually takes, 0 when none was timed yet.
export function usualCheck(root, cmd) {
  const runs = (readJson(file(), {})?.[key(root, cmd)] || []).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  return runs.length ? runs[Math.floor((runs.length - 1) / 2)] : 0;
}
export function noteCheckRun(root, cmd, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  try {
    withLock("check-runs", () => {
      const all = readJson(file(), {}) || {};
      all[key(root, cmd)] = [...(all[key(root, cmd)] || []), Math.round(ms)].slice(-CHECK_RUNS_KEPT);
      for (const k of Object.keys(all).slice(0, -200)) delete all[k];
      writeJson(file(), all);
    });
  } catch {}
}
