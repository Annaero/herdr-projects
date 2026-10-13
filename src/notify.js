// Telling you that a task needs you, is ready to approve, or failed: the `board.notify` setting. `bell` rings the
// terminal bell where a board is open (board/view/osc.js); a command is run once per event, with the task's id, its
// title and what happened in its environment; `none` does neither.
import { spawn } from "node:child_process";
import * as S from "./store.js";
import { userEnv } from "./runner.js";

// What happened, from where the task stands; "" for a task nobody needs to hear about.
export function eventOf(t) {
  if (!t || t.archivedAt) return "";
  if (["asks", "reviewneeds", "pick"].includes(t.stage)) return "needs you"; // "pick": choose one of its attempts (attempts.js)
  if (t.stage === "attempts") return S.attemptsOf(t).some((c) => ["asks", "reviewneeds"].includes(c.stage)) ? "needs you" : ""; // one of its attempts asks you
  if (["failed", "nosummary"].includes(t.stage)) return "failed";
  if (t.stage === "approval") return t.failure || t.prFailure || t.syncBlocked ? "needs you" : "ready to approve";
  return "";
}
// The housekeeping pass: each event is noted on its task once (`notice`), and the command is run for it.
export function notifyPass(tasks) {
  const how = S.setting("board.notify");
  for (const seen of tasks) {
    const event = eventOf(seen);
    if ((seen.notice?.event || "") === event && (!event || seen.notice.stage === seen.stage)) continue;
    let fresh = false;
    const t = S.update(seen.id, (t) => {
      const now = eventOf(t);
      if ((t.notice?.event || "") === now && (!now || t.notice.stage === t.stage)) return false;
      t.notice = now ? { event: now, stage: t.stage, at: Date.now() } : null; fresh = !!now;
    });
    if (!fresh || how === "none" || how === "bell") continue;
    try {
      const run = globalThis.__swNotify || ((cmd, env) => { const c = spawn("sh", ["-c", cmd], { detached: true, stdio: "ignore", env: { ...userEnv(), ...env } }); c.on("error", () => {}); c.unref(); });
      run(how, { HERDR_SUPERWORK_ID: t.id, HERDR_SUPERWORK_TITLE: String(t.title || ""), HERDR_SUPERWORK_EVENT: t.notice.event });
    } catch {}
  }
}
