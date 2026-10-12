// One Watcher call at a time on the whole machine: the turn is a small file in the data folder, so an open board and a keeper that tick at the same moment cannot both start one.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";

export const CALL_MS = 45000; // a call that takes longer is stopped
const file = () => path.join(S.dataDir(), "watcher-call.json");
// Somebody's call is under way: its turn was taken, not given back, and it cannot have been stopped for taking too
// long yet. A process that died with the turn in its hand so holds it for under a minute, never for good.
const taken = (now) => { const m = S.readJson(file()); return !!m && now - (m.at || 0) < CALL_MS + 5000 && now >= (m.at || 0); };
// Take the turn: false when another call runs, in this process or any other.
export function takeTurn(now = Date.now()) {
  try {
    return S.withLock("watcher-call", () => { if (taken(now)) return false; S.writeJson(file(), S.marker({ at: now })); return true; }, { waitMs: 0 });
  } catch { return false; }
}
export function giveTurn() { try { fs.rmSync(file(), { force: true }); } catch {} }
