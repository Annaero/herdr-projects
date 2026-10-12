// What the Watcher is asked and how its answer is read: one prompt for every agent in the call, one line and one percent each.
import * as S from "../store.js";
import { began } from "../state.js";

// With a program that takes one (agents/kinds.js), this replaces its own long instructions for coding work.
export const SYSTEM = "You write short status lines for a dashboard that shows coding agents at work. You reply with JSON only.";

const spentOf = (t, role, now) => {
  const from = began(t, role);
  const mins = from ? Math.max(0, Math.round((now - from) / 60000)) : 0;
  return mins < 1 ? "under a minute" : mins === 1 ? "1 minute" : `${mins} minutes`;
};
// One agent's part. `look` is { t, role, lines }: the task, whom the Watcher follows on it, and its last screen lines.
function part(look, n, now) {
  const { t, role, lines } = look;
  const about = S.oneLine(t.description, 3000).slice(0, 800);
  return [
    `--- ${n} ---`,
    role === "reviewer" ? "This one is an adversarial reviewer checking finished work. Estimate progress through this review only, not through the agent's task." : "This one is a coding agent working on a task.",
    `Task: ${t.title}`,
    ...(about ? ["What the task asks for:", about] : []),
    `The ${role === "reviewer" ? "reviewer has been on this review" : "agent has been on this"} for ${spentOf(t, role, now)} so far.`,
    t.watch?.role === role
      ? `Your previous guess was ${t.watch.progress} percent. Keep it unless something on the screen is a reason to change it. Raise it as work gets done. Lower it when new work shows up: ${role === "reviewer" ? "more to check than it looked" : "a failing test, a merge conflict, review findings to fix, a bigger job than it looked"}.`
      : "This is your first look at it.",
    `The last lines on the ${role}'s terminal right now:`, lines,
  ].join("\n");
}
export function watcherPrompt(looks, now = Date.now()) {
  const many = looks.length > 1;
  return [
    many ? `You are watching ${looks.length} agents at work, numbered below. Write the status of each for a dashboard.` : "You are watching an agent at work. Write its status for a dashboard.",
    "The percent is the share of the whole job's time that is already spent: the dashboard works out the minutes left from it and the time spent so far, so do not guess high while much is left to do.",
    ...looks.map((look, i) => part(look, i + 1, now)),
    "--- end ---",
    `Reply with only this JSON and nothing else${many ? ", one entry for each number above" : ""}: [{"n": <the number above>, "msg": "<what it is doing right now: at most 8 plain words, present tense, no tool or command names>", "progress": <whole number 0 to 99: your best guess of how far through its current assignment it is>}]`,
  ].join("\n");
}
// The answer as n -> { msg, progress }. A single object is taken as the answer for the only agent asked about.
export function readAnswer(out, count) {
  const text = String(out), found = new Map();
  let list = null;
  for (const [open, close] of ["[]", "{}"]) {
    const a = text.indexOf(open), b = text.lastIndexOf(close);
    if (a < 0 || b <= a) continue;
    try { list = [JSON.parse(text.slice(a, b + 1))].flat(); break; } catch {}
  }
  for (const j of list || []) {
    if (!j || typeof j !== "object" || !j.msg) continue;
    const n = j.n === undefined && count === 1 ? 1 : Math.round(Number(j.n));
    if (!(n >= 1 && n <= count) || found.has(n)) continue;
    found.set(n, { msg: S.oneLine(j.msg, 120), progress: Math.max(0, Math.min(99, Math.round(Number(j.progress)) || 0)) });
  }
  return found;
}
