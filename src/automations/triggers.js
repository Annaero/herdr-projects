// An automation's trigger, one of two kinds: a schedule, or something that happened on the board. Reading one as it
// is typed, saying it in plain words (`every 2h`, `when a task is merged`), and working out when a schedule is next
// due. A schedule is in this machine's time zone. There is no webhook trigger (docs/automations.md says why).
//   { kind: "schedule", text, every: ms }   every 2h
//   { kind: "schedule", text, cron }        daily 09:00 · mon 09:00 · cron "0 9 * * 1"
//   { kind: "event", event, everyRepo }     one of EVENTS (events.js), for the automation's repo or for every repo
import { ms, nearest } from "../store/settings/values.js";
import { parseCron, cronNext, DAYS } from "./cron.js";
import { EVENTS, eventNamed } from "./events.js";

// The shortest `every`: the board looks once a second, and a task a minute is already more than anyone wants.
export const EVERY_MIN = 60000;
const HOW = 'A schedule is one of: every 2h · daily 09:00 · mon 09:00 (days: mon,tue,wed,thu,fri,sat,sun) · cron "0 9 * * 1"';
const clock = (text) => { const m = /^(\d{1,2}):(\d{2})$/.exec(text); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? { h: Number(m[1]), m: Number(m[2]), text: `${m[1].padStart(2, "0")}:${m[2]}` } : null; };

export function parseSchedule(typed) {
  const text = String(typed ?? "").trim().replace(/\s+/g, " "), low = text.toLowerCase();
  const [word, ...rest] = low.split(" ");
  if (word === "cron") { const c = parseCron(text.slice(4).trim().replace(/^["']|["']$/g, "")); return { kind: "schedule", text: `cron ${c.text}`, cron: c.text }; }
  if (word === "every" && rest.length === 1) {
    const every = ms(rest[0]);
    if (!every) throw new Error(`"${rest[0]}" is not a time with a unit, such as 30m or 2h (s, m or h).${/^\d+$/.test(rest[0]) ? ` Did you mean ${rest[0]}m?` : ""}`);
    if (every < EVERY_MIN) throw new Error("An automation runs once a minute at most: every 1m or longer.");
    return { kind: "schedule", text: `every ${rest[0]}`, every };
  }
  const at = rest.length === 1 ? clock(rest[0]) : null;
  if (word === "daily" && at) return { kind: "schedule", text: `daily ${at.text}`, cron: `${at.m} ${at.h} * * *` };
  const days = word.split(",");
  if (at && days.every((d) => DAYS.includes(d))) return { kind: "schedule", text: `${days.join(",")} ${at.text}`, cron: `${at.m} ${at.h} * * ${days.map((d) => DAYS.indexOf(d)).join(",")}` };
  throw new Error(`"${text}" is not a schedule. ${HOW}`);
}
export function parseEvent(typed, everyRepo = false) {
  const e = eventNamed(typed);
  if (!e) { const near = nearest(String(typed ?? "").trim().toLowerCase(), EVENTS.map((x) => x.id)); throw new Error(`"${typed}" is not something that happens on the board.${near ? ` Did you mean ${near}?` : ""} One of: ${EVENTS.map((x) => `${x.id} (${x.words})`).join(", ")}.`); }
  return { kind: "event", event: e.id, everyRepo: !!everyRepo };
}
// The one trigger of a command: --schedule <words>, or --when <event> [--every-repo]. null when none is said.
export function triggerOf(flags) {
  const said = ["schedule", "when"].filter((k) => flags[k] !== undefined && flags[k] !== false);
  if (said.length > 1) throw new Error("An automation has one trigger: --schedule or --when, not both.");
  if (!said.length) return null;
  if (flags[said[0]] === true) throw new Error(said[0] === "schedule" ? `--schedule needs its words. ${HOW}` : `--when needs what happened: ${EVENTS.map((x) => x.id).join(", ")}`);
  return said[0] === "schedule" ? parseSchedule(flags.schedule) : parseEvent(flags.when, flags["every-repo"] === true);
}
// In plain words, as the board's row and `show` say it.
export function sayTrigger(t) {
  if (t?.kind === "schedule") return t.text;
  if (t?.kind === "event") return `when a task ${eventNamed(t.event)?.words || t.event}${t.everyRepo ? ", in every repo" : ""}`;
  return "no trigger";
}
// When a schedule is next due after `after`. `since`: when the trigger was set, which is what `every` counts from.
export function nextAfter(t, after, since = after) {
  if (t?.kind !== "schedule") return 0;
  if (t.every) return since + (Math.floor(Math.max(0, after - since) / t.every) + 1) * t.every;
  return cronNext(t.cron, after);
}
