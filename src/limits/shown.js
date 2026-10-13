// What a task shows of its limits: what this run and the task have used against each one, the words the row says
// when one is near, and the same for `details`.
import * as S from "../store.js";
import { tokensOf, tokensSay, ms, NONE } from "../store/settings/values.js";
import { usedOf, ranFor, runRole, limitSaid, runTime, timeSay, stoppedAtLimit } from "./run.js";

// From this share of a limit on, the row says how much is used.
export const NEAR = 0.8;
// A task's limits while an agent runs on it: { time: { limit, used }, tokens: { limit, used, kind }, near }.
// `time` and `tokens` only where that limit is set; nothing at all with neither. `near`: the row's words.
export function limitsOf(t, now = Date.now()) {
  const role = runRole(t);
  if (!role || t.archivedAt || !limitSaid(t)) return undefined;
  let time = NONE, tokens = NONE;
  try { time = runTime(t); tokens = S.setting("limit.tokens", t); } catch {}
  if (time === NONE && tokens === NONE) return undefined;
  const out = {}, near = [];
  if (time !== NONE) { out.time = { limit: time, used: ranFor(t, now) }; if (out.time.used >= NEAR * ms(time)) near.push(`${timeSay(out.time.used)} of its ${time}`); }
  if (tokens !== NONE) {
    const kind = role === "reviewer" ? t.link?.reviewer?.kind : t.agent;
    out.tokens = { limit: tokens, used: usedOf(t), kind: kind || "" }; // `kind`: whose tokens; whether they can be counted is the panel's to ask (limits/spent.js: canCount)
    if (out.tokens.used >= NEAR * tokensOf(tokens)) near.push(`${tokensSay(out.tokens.used)} of ${tokens} tokens`);
  }
  if (near.length) out.near = near.join(" · ");
  return out;
}
// One limit as the panel says it: "1h12m of 2h, this run", "1.2m of 2m".
export const timeLine = (x) => `${timeSay(x.used)} of ${x.limit}, this run`;
export const tokensLine = (x, counted = true) => (counted ? `${tokensSay(x.used)} of ${x.limit}` : `not counted for this program · limit ${x.limit}`);
// For `details`: the limits as they stand, what has been used, and the stop when one was reached.
export function limitsDetail(t, now = Date.now()) {
  const running = !!runRole(t), time = running ? runTime(t) : S.setting("limit.time", t), tokens = S.setting("limit.tokens", t);
  return {
    time: { limit: time, ...(running ? { usedMs: ranFor(t, now), used: timeSay(ranFor(t, now)) } : {}) },
    tokens: { limit: tokens, used: usedOf(t), total: t.spent?.total || 0 },
    ...(stoppedAtLimit(t) ? { stopped: { ...t.limitStop, line: t.msg } } : {}),
  };
}
