// An automation as it is shown, in the same words on the board's list, in its panel and on the command line: on or
// off, its trigger in plain words, its repo, the last firing (how long ago, and the task it made or "skipped"), the
// next one for a schedule; and one firing as a line.
import * as S from "../store.js";
import { sayTrigger } from "./triggers.js";

const span = (ms) => { const x = Math.max(0, Math.round(ms / 1000)); return x < 60 ? `${x}s` : x < 3600 ? `${Math.floor(x / 60)}m` : x < 86400 ? `${Math.floor(x / 3600)}h` : `${Math.floor(x / 86400)}d`; };
export const ago = (at, now = Date.now()) => `${span(now - at)} ago`;
// One firing: when, what fired it, the task it made or why it was skipped.
export const firingWords = (f, now = Date.now()) => ({ when: ago(f.at, now), what: f.what || f.cause, made: f.task || "", result: f.task ? `made ${S.sayId(f.task)}${f.note ? ` (${f.note})` : ""}` : `skipped${f.n > 1 ? ` ×${f.n}` : ""}: ${f.skipped}` });
export const firingLine = (f, now) => { const w = firingWords(f, now); return `${w.when.padEnd(8)} ${w.what}  →  ${w.result}`; };
// Its firings, newest first.
export const firings = (a) => S.firingsOf(a.id).reverse();

// What its row says. `state` is a word, never colour alone: "on" or "off".
export function rowOf(a, now = Date.now()) {
  const last = S.firingsOf(a.id).at(-1);
  return {
    id: a.id, name: a.name, on: !!a.on, state: a.on ? "on" : "off", trigger: sayTrigger(a.trigger), repo: a.repo,
    last: last ? `${ago(last.at, now)} · ${last.task ? S.sayId(last.task) : "skipped"}` : "never fired", lastTask: last?.task || "",
    next: a.on && a.trigger?.kind === "schedule" && a.nextAt ? (a.nextAt <= now ? "now" : `in ${span(a.nextAt - now)}`) : "",
    why: a.offWhy || "",
  };
}
// Everything about one, for `show` and --json.
export function describe(a, now = Date.now()) {
  const r = rowOf(a, now);
  return { id: a.id, name: a.name, on: r.on, trigger: r.trigger, repo: a.repo, folder: a.root, research: !!a.research, prompt: a.prompt, settings: a.settings || {},
    last: S.firingsOf(a.id).at(-1) || null, next: a.on && a.nextAt ? a.nextAt : null, ...(a.offWhy ? { offWhy: a.offWhy } : {}) };
}
export const listLine = (a, now) => { const r = rowOf(a, now); return `${r.state.padEnd(3)}  ${r.name}  ·  ${r.trigger}  ·  ${r.repo}  ·  ${r.last}${r.next ? `  ·  next ${r.next}` : ""}${r.why ? `  ·  ${r.why}` : ""}`; };
