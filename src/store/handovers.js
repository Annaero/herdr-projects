// Hand-overs: one agent taking over from another that could not go on (`worker.fallback`, `reviewer.fallback`;
// docs/fallback.md). What is kept on the task, who is next on the list, and the words: why it could not go on, and
// the one line the row, the task panel and the history say (`codex took over from claude: out of allowance until 17:00`).
//
// On the task:
//   handovers  every hand-over it had, oldest first: { at, role: "worker" | "reviewer", from, to, why }
//   on         the agent that is on it now (`codex/gpt-5.5`), once one took over; nothing while `worker.agent` is
//   tried      the agents that were on it since you last stepped in (a reply, a new start): none is tried twice
//   reviewerOn the reviewer that took over, for the later rounds of this task
import { agentOf } from "./settings/values.js";
import { oneLine } from "./tasks.js";

export const handovers = (t) => (Array.isArray(t?.handovers) ? t.handovers : []);
export const lastHandover = (t, role = "worker") => handovers(t).findLast((h) => h.role === role) || null;
// Two agents of one program are told apart by their models; otherwise the program's name says who.
const names = (from, to) => (agentOf(from).kind === agentOf(to).kind ? [from, to] : [agentOf(from).kind, agentOf(to).kind]);
export function handoverLine(h) {
  const [from, to] = names(h.from, h.to);
  return `${to} took over ${h.role === "reviewer" ? "the review " : ""}from ${from}: ${h.why}`;
}
export function logHandover(t, { role = "worker", from, to, why }) {
  t.handovers = [...handovers(t), { at: Date.now(), role, from, to, why: oneLine(why, 200) }];
  return t.handovers.at(-1);
}
// The agent that is on a task now, as a setting says one: the one that took over, else `worker.agent` as it reads
// (`setting`) when that is still the program on it, else the program alone.
export const onNow = (t, setting = "") => t?.on || (agentOf(setting).kind === t?.agent ? setting : t?.agent || "");
// You stepped in (a reply, a new start): the list may be gone through again, from its start.
export function freshList(t) { t.tried = []; t.reviewerOn = null; if (t.fallbacks?.worker || t.fallbacks?.reviewerLeft) t.fallbacks = { ...t.fallbacks, worker: undefined, reviewerLeft: undefined }; }

// The next on the list: the first that is not on it now, was not on it since you last stepped in, and can be
// started here (`usable(agent)`: "" or why not). Returns { agent, skipped }: `skipped` says why each one before it
// was passed over, for the task's note when nobody is left.
export function nextFallback(list, { on = "", tried = [], usable = () => "" } = {}) {
  const skipped = [];
  for (const agent of Array.isArray(list) ? list : []) {
    if (agent === on || tried.includes(agent)) { skipped.push(`${agent} was on it already`); continue; }
    const why = usable(agent);
    if (why) { skipped.push(why); continue; }
    return { agent, skipped };
  }
  return { agent: "", skipped };
}
// What the task says when the list is used up: a note in the task panel.
export const nobodyLeft = (name, skipped) => `${name}: nobody left to take over (${skipped.join("; ")})`;

// ---- why it could not go on, in plain words -------------------------------------------------------------------------------
const LIMIT = /usage limit|usage_limit|(?<!rate.?)limit reached|hit your [\w ]*limit|\bquota\b|billing|credit balance|payment|out of (?:credits?|allowance)/i;
const NO_MODEL = /not supported|unsupported|does not exist|may not exist|model[^\n]{0,40}not found|unknown (?:provider|model)/i;
const clock = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
// When the allowance comes back, where the provider's words say so: "resets 5pm", "try again at 5:00 PM", "resets at
// 17:00", "try again in 3 hours 14 minutes", and the moment itself after a bar ("…|1760367600"). "" when they do not.
export function resetAt(words, now = Date.now()) {
  const s = String(words || "");
  const epoch = /\|(\d{10})\b/.exec(s);
  if (epoch) return clock(new Date(Number(epoch[1]) * 1000));
  const at = /(?:resets?|try again|available again|until)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/i.exec(s) || /(?:resets?|try again|available again|until)\s+(?:at\s+)?(\d{1,2}):(\d{2})\b/i.exec(s);
  if (at) {
    let h = Number(at[1]);
    const m = Number(at[2] || 0), half = (at[3] || "").toLowerCase();
    if (half === "p" && h < 12) h += 12;
    if (half === "a" && h === 12) h = 0;
    return h < 24 && m < 60 ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : "";
  }
  const span = /(?:resets?|try again|available again)\s+in\s+(?:(\d+)\s*(?:hours?|hrs?|h)\b)?[\s,]*(?:and\s+)?(?:(\d+)\s*(?:minutes?|mins?|m)\b)?/i.exec(s);
  if (span && (span[1] || span[2])) return clock(new Date(now + (Number(span[1] || 0) * 60 + Number(span[2] || 0)) * 60000));
  return "";
}
// `passing`: an error that passes by itself, which the board already tried `tries` times. Else the provider's own
// words decide: a login, the allowance, a model that is not there; anything else is said as it was.
export function whyOf({ error = "", auth = false, passing = false, reason = "", tries = 0 } = {}, now = Date.now()) {
  if (auth) return "logged out";
  if (passing) return `its ${reason || "provider failed"}${tries > 1 ? `, still after ${tries} tries` : ""}`;
  if (LIMIT.test(error)) { const at = resetAt(error, now); return `out of allowance${at ? ` until ${at}` : ""}`; }
  if (NO_MODEL.test(error)) return "its model is not available";
  return `it stopped (${oneLine(error, 120).replace(/[.\s]+$/, "") || "no reason given"})`;
}
