// The keys herdr already uses, its own defaults and what the user's config.toml binds, and so which key the board may
// take: it never takes one that is in use, and says what that key does today.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { parseToml } from "./toml.js";

// What the first run offers, in order: the first one nothing uses. None of them is a herdr default (0.9.3).
export const OFFERED = ["prefix+a", "prefix+y", "prefix+u", "prefix+i", "prefix+m"];
const NOT_ACTIONS = new Set(["key", "type", "command", "description", "width", "height"]); // the commented [[keys.command]] example
// { action: key } as this herdr binds them: the commented `# action = "key"` lines under [keys] of its default config.
export function parseDefaults(out) {
  const part = (String(out || "").split(/^\[keys\]/m)[1] || "").split(/^\[(?!\[)/m)[0];
  const found = {};
  for (const m of part.matchAll(/^#\s*([a-z_]+)\s*=\s*"([^"]*)"/gm)) if (m[2] && !NOT_ACTIONS.has(m[1])) found[m[1]] = m[2];
  return Object.keys(found).length ? found : null;
}
// Every key herdr 0.9.3 binds itself, kept beside this file. Always counted: herdr's printed defaults leave some out
// (copy mode, swapping panes), and herdr may not answer at all. A key is never taken blindly.
export const BUILT_IN = parseDefaults(fs.readFileSync(new URL("./herdr-default-keys.toml", import.meta.url), "utf8"));
export function defaults(bin = process.env.HERDR_BIN_PATH || "herdr") {
  let r = null;
  try { r = spawnSync(bin, ["--default-config"], { encoding: "utf8", timeout: 8000 }); } catch {}
  return { ...BUILT_IN, ...((r && r.status === 0 && parseDefaults(r.stdout)) || {}) };
}

const NAMED = { "-": "minus", ",": "comma", "`": "backtick", "&": "ampersand", return: "enter", escape: "esc", super: "cmd" };
const MODS = ["ctrl", "alt", "shift", "cmd"];
// One spelling per key, so "Prefix+Shift+Ctrl+X" and "prefix+ctrl+shift+x" are seen as the same key.
export function norm(key) {
  const parts = String(key || "").trim().toLowerCase().split("+").map((p) => p.trim()).filter(Boolean).map((p) => NAMED[p] || p);
  const prefix = parts.includes("prefix"), rest = parts.filter((p) => p !== "prefix");
  return [...(prefix ? ["prefix"] : []), ...MODS.filter((m) => rest.includes(m)), ...rest.filter((p) => !MODS.includes(p))].join("+");
}
// "prefix+1..9" is nine keys.
const each = (key) => { const m = /^(.*)1\.\.9$/.exec(String(key)); return (m ? [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `${m[1]}${i}`) : [key]).map(norm); };
const list2 = (v) => (Array.isArray(v) ? v : []).filter((c) => c && typeof c === "object");
const words = (action) => action.replaceAll("_", " ");

// A binding is one key or a list of them: every string in it.
const list = (v) => (Array.isArray(v) ? v : [v]).filter((k) => typeof k === "string" && k);
const CHORD = /["']((?:(?:prefix|ctrl|alt|shift|cmd|super)\+)+[^"'\s]+|f\d+)["']/gi;
const ALIAS = { fullscreen: "zoom" }; // an older name herdr still reads for the same action
// Every key in use, with what it does: Map of key -> { by: "herdr" | "config", what }. herdr's defaults count as the
// user's config leaves them (an action the user moved or switched off frees its default key), then everything the
// config binds itself, however it is written: one key, a list of keys, a command's key or keys, the extra prefix
// keys, and the older [keys.indexed] table. The board's own binding is left out.
export function used(text, defs = BUILT_IN) {
  const map = new Map();
  const put = (key, by, what) => { for (const k of each(key)) if (k && !map.has(k)) map.set(k, { by, what }); };
  let conf = null;
  try { conf = parseToml(String(text || "")); } catch {}
  const keys = conf && conf.keys && typeof conf.keys === "object" ? conf.keys : {};
  const moved = new Set();
  for (const [action, value] of Object.entries(keys)) {
    if (action === "command" || action === "indexed") continue;
    moved.add(ALIAS[action] || action);
    for (const key of list(value)) put(key, "config", words(action));
  }
  for (const c of list2(keys.command)) if (c.command !== "herdr-superwork.open") for (const key of list(c.key)) put(key, "config", String(c.description || c.command || "a command"));
  // [keys.indexed]: tabs = "ctrl" makes ctrl+1 to ctrl+9 switch tabs.
  for (const [what, mods] of Object.entries(keys.indexed && typeof keys.indexed === "object" ? keys.indexed : {})) if (typeof mods === "string" && mods) put(`${mods}+1..9`, "config", `switch ${what}`);
  // A config the reader cannot follow still has its keys found, wherever they stand: better one refusal too many.
  if (!conf) for (const m of String(text || "").matchAll(CHORD)) put(m[1], "config", "a binding");
  for (const [action, key] of Object.entries(defs)) if (!moved.has(action) || !conf) put(key, "herdr", words(action));
  return map;
}
// May the board take this key? { ok } or { ok: false, msg } naming what the key does today.
export function check(key, text, defs = BUILT_IN, file = "your herdr config") {
  const raw = String(key || "").trim().toLowerCase();
  if (!/^[a-z0-9+_.-]+$/.test(raw) || raw.endsWith("+")) return { ok: false, msg: `"${key}" is not a key herdr understands. Try something like prefix+a.` };
  const hit = used(text, defs).get(norm(raw));
  if (!hit) return { ok: true };
  return { ok: false, msg: hit.by === "herdr" ? `herdr itself uses ${raw} (${hit.what}): the board would switch that off. Choose another.` : `${raw} is already bound in ${file} (${hit.what}): the board would replace it. Choose another.` };
}
// The key to offer: { key, note }. `note` says why it is not the first choice, when it is not.
export function suggest(text, defs = BUILT_IN) {
  const map = used(text, defs);
  const key = OFFERED.find((k) => !map.has(norm(k))) || "";
  const first = map.get(norm(OFFERED[0]));
  const why = first ? `${OFFERED[0]} is already ${first.by === "herdr" ? "herdr's own key" : "bound in your config"} (${first.what})` : "";
  return { key, note: !first ? "" : key ? `${why}, so this is the next free key.` : `${why}, and so are the other keys this would offer.` };
}
