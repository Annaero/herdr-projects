// What a setting's value may be: a typed or hand-written value is checked against its entry in settings-list.js and
// comes back as the board keeps it, or is refused with the nearest right one as a hint.
import { AGENTS } from "../../agents/kinds.js";
import { NAMES, entryOf } from "../settings-list.js";

export const NONE = "none";
const refuse = (msg) => { throw Object.assign(new Error(msg), { refused: true }); };
// The nearest of a list of words to what was typed, when one is near enough to be meant.
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
export function nearest(word, list) {
  const w = String(word).toLowerCase();
  const tail = (x) => x.split(".").pop().toLowerCase();
  let best = null, score = Infinity;
  for (const x of list) { const s = Math.min(distance(w, x.toLowerCase()), distance(tail(w), tail(x)) + (w.includes(".") ? 1 : 2)); if (s < score) { best = x; score = s; } }
  return best && score <= Math.max(3, Math.ceil(w.length / 2)) ? best : null;
}
const hint = (word, list) => { const n = nearest(word, list); return n ? ` Did you mean ${n}?` : ""; };
// The entry of a name, or a refusal that names the nearest one.
export function known(name) {
  const e = entryOf(name);
  if (!e) refuse(`Unknown setting "${name}".${hint(name, NAMES)} \`herdr-superwork show\` lists them all.`);
  return e;
}

// ---- a time carries a unit --------------------------------------------------------------------------------------------
const UNIT = { s: 1000, m: 60000, h: 3600000 };
export const ms = (time) => { const m = /^(\d+)([smh])$/.exec(String(time)); return m ? Number(m[1]) * UNIT[m[2]] : 0; };

// ---- an agent: a program, and the model that travels with it ------------------------------------------------------------
export const AGENT_KINDS = () => Object.keys(AGENTS);
// "codex/gpt-5.5" -> { kind: "codex", model: "gpt-5.5" }; "none" -> { kind: "" }.
export function agentOf(value) {
  const v = String(value ?? "");
  if (!v || v === NONE) return { kind: "", model: "" };
  const at = v.indexOf("/");
  return at < 0 ? { kind: v, model: "" } : { kind: v.slice(0, at), model: v.slice(at + 1) };
}
// An effort or an access is right or wrong for one program: checked where both are known (set, and each start).
export function fits(name, value, agent) {
  const e = entryOf(name), { kind } = agentOf(agent), a = Object.hasOwn(AGENTS, kind) ? AGENTS[kind] : null;
  if (!a || !e) return "";
  if (e.type === "effort" && value !== "default" && a.efforts && !a.efforts.includes(value)) return `${kind} has no effort "${value}": it takes ${a.efforts.join(", ")} (or default, for its own).`;
  if (e.type === "access" && value !== "full" && !(a.access && Object.hasOwn(a.access, value))) return `${kind} cannot do "${value}": it never asks before it acts. Keep ${name} at full, or choose another program for ${name.split(".")[0]}.agent.`;
  return "";
}

// ---- the check -----------------------------------------------------------------------------------------------------------
const SWITCH = { true: true, yes: true, on: true, false: false, no: false, off: false };
const word = (v) => String(v ?? "").trim();
const CHECKS = {
  switch(e, v) {
    if (typeof v === "boolean") return v;
    const w = word(v).toLowerCase();
    if (typeof v !== "string" || !Object.hasOwn(SWITCH, w)) refuse(`${e.name} is a switch: true or false (yes, no, on and off work too), not "${word(v)}".`);
    return SWITCH[w];
  },
  choice(e, v) {
    const w = word(v).toLowerCase();
    if (!e.values.includes(w)) refuse(`${e.name} must be ${e.values.join(", ")}, not "${word(v)}".${hint(w, e.values)}`);
    return w;
  },
  time(e, v) {
    const w = word(v).toLowerCase().replace(/\s+/g, "");
    if (!/^\d+[smh]$/.test(w) || !ms(w)) refuse(`${e.name} is a time with a unit, such as ${e.builtin} (s, m or h), not "${word(v)}".${/^\d+$/.test(w) ? ` Did you mean ${w}${e.builtin.slice(-1)}?` : ""}`);
    return w;
  },
  count(e, v) {
    const n = typeof v === "number" ? v : /^\d+$/.test(word(v)) ? Number(word(v)) : NaN;
    if (!Number.isInteger(n) || n < e.min) refuse(`${e.name} must be a whole number, ${e.min} or more, not "${word(v)}".`);
    return n;
  },
  agent(e, v) {
    const w = word(v), { kind, model } = agentOf(w.toLowerCase() === NONE ? NONE : w);
    if (!kind) { if (e.none && w.toLowerCase() === NONE) return NONE; refuse(`${e.name} must be ${AGENT_KINDS().join(", ")}${e.none ? " or none" : ""}, with an optional model after a slash.`); }
    const k = kind.toLowerCase();
    if (!Object.hasOwn(AGENTS, k)) refuse(`${e.name}: no agent program "${kind}". It must be ${AGENT_KINDS().join(", ")}${e.none ? " or none" : ""}.${hint(k, AGENT_KINDS())}`);
    if (w.includes("/") && !/^[A-Za-z0-9][A-Za-z0-9._:\/\[\]-]*$/.test(model)) refuse(`${e.name}: "${model}" is not a model name.`);
    return model ? `${k}/${model}` : k;
  },
  effort(e, v) {
    const w = word(v).toLowerCase();
    if (!/^[a-z]+$/.test(w)) refuse(`${e.name} must be an effort level such as low, medium or high, or default.`);
    return w;
  },
  access(e, v) {
    const w = word(v).toLowerCase();
    if (!["full", "ask"].includes(w)) refuse(`${e.name} must be full or ask, not "${word(v)}".${hint(w, ["full", "ask"])}`);
    return w;
  },
  text(e, v) {
    if (typeof v !== "string" || !v.trim()) refuse(`${e.name} needs words, or none.`);
    return v.trim().toLowerCase() === NONE ? NONE : v.trim();
  },
  list(e, v) {
    if (typeof v === "string" && v.trim().toLowerCase() === NONE) return NONE;
    const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/) : null;
    if (!items || !items.every((x) => typeof x === "string")) refuse(`${e.name} is a list of names, or none.`);
    const out = items.map((x) => x.trim()).filter(Boolean);
    return out.length ? out : NONE;
  },
  machines(e, v) {
    const names = (Array.isArray(v) ? v.map(String) : word(v).split(/[\s,]+/)).map((x) => x.trim()).filter(Boolean);
    if (!names.length) refuse(`${e.name} must be auto, none, or machine names.`);
    if (names.length === 1 && ["auto", NONE].includes(names[0].toLowerCase())) return names[0].toLowerCase();
    const bad = names.find((x) => !/^([A-Za-z0-9_.-]+@)?[A-Za-z0-9_.-]+$/.test(x) || ["auto", NONE].includes(x.toLowerCase()));
    if (bad) refuse(`${e.name}: "${bad}" is not a machine name (host or user@host). Other values: auto, none.`);
    return names.join(", ");
  },
  // A repo's short key: kept in capitals. `PR` would read as a pull request on a row.
  key(e, v) {
    const w = word(v);
    if (w.toLowerCase() === NONE) return NONE;
    const k = w.toUpperCase();
    if (typeof v !== "string" || !/^[A-Z][A-Z0-9]{1,4}$/.test(k)) refuse(`${e.name} is a short key: 2 to 5 letters or digits, the first a letter (HSW), or none; not "${w}".`);
    if (k === "PR") refuse(`${e.name} cannot be PR: on a row that already means a pull request. Choose another.`);
    return k;
  },
  notify(e, v) {
    if (typeof v !== "string" || !v.trim()) refuse(`${e.name} must be none, bell, or a command.`);
    const w = v.trim();
    return [NONE, "bell"].includes(w.toLowerCase()) ? w.toLowerCase() : w;
  },
};
// The value as kept, or a refusal. `agent`: the program an effort or an access is for, where it is known.
export function check(name, value, { agent = "" } = {}) {
  const e = known(name);
  if (value === undefined || value === null) refuse(`${name} needs a value.`);
  const v = CHECKS[e.type](e, value);
  const why = agent ? fits(name, v, agent) : "";
  if (why) refuse(`${name}: ${why}`);
  return v;
}
// A value as a person reads it.
export const say = (v) => (Array.isArray(v) ? v.join(", ") : String(v));
// A command, or nothing: `none` is a real answer that means no command.
export const commandOf = (v) => (!v || v === NONE ? "" : String(v));
export const listOf = (v) => (Array.isArray(v) ? v : []);
