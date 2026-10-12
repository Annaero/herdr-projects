// Settings as saved and read: yours, one task's own, and the repo's file. What there is to set is settings-list.js:
// a new setting goes there.
import fs from "node:fs";
import path from "node:path";
import { GATES, DEFAULT_GATE, gateOfAuto } from "../gate.js";
import { configDir, readJson, writeJson } from "./files.js";
import { gitOut } from "./repos.js";
import { assertUnarchived, update } from "./tasks.js";
import { DEFAULTS, TASK_DEFAULTS, PER_TASK } from "./settings-list.js";

// ---- settings: two places, no more ---------------------------------------------------------------------------------
// 1. Your own preferences: <config dir>/config.json. What there is to set, and each default: settings-list.js.
export { DEFAULTS, TASK_DEFAULTS, PER_TASK };
const REMERGE_WORDS = { tests: "tests", test: "tests", check: "tests", skip: "tests", true: "tests", on: "tests", yes: "tests", review: "review", always: "review", false: "review", off: "review", no: "review" };
const REVIEW_WORDS = { repos: "repos", repo: "repos", true: "repos", on: "repos", yes: "repos", all: "all", always: "all", everything: "all", none: "none", off: "none", false: "none", no: "none", never: "none" };
function coerce(key, value) {
  const shape = key in TASK_DEFAULTS ? TASK_DEFAULTS[key] : DEFAULTS[key];
  let v = value;
  if (key === "agentArgs") {
    if (typeof value === "string") { try { v = JSON.parse(value); } catch { throw new Error('agentArgs must be JSON, for example {"claude":["--dangerously-skip-permissions"]}'); } }
    if (!v || typeof v !== "object" || Array.isArray(v) || !Object.values(v).every((a) => Array.isArray(a) && a.every((x) => typeof x === "string"))) throw new Error("agentArgs must map an agent kind to a list of arguments");
    return v;
  }
  if (typeof shape === "boolean") v = value === true || ["true", "on", "yes", "auto"].includes(String(value).toLowerCase());
  else if (typeof shape === "number") { v = Math.round(Number(value)); if (!(v >= 1)) throw new Error(`${key} must be a whole number, 1 or more`); }
  else {
    v = String(value ?? "").trim();
    if (v.toLowerCase() === "default") v = "";
    if (key === "reviewer") v = ["false", "off", "no", "none"].includes(v.toLowerCase()) ? "off" : v.toLowerCase();
    if (key === "watcher") v = ["false", "off", "no", "none"].includes(v.toLowerCase()) ? "off" : "on";
    if (key === "gate" && v) { v = v.toLowerCase(); if (["false", "no", "none", "manual"].includes(v)) v = "off"; if (!GATES.includes(v)) throw new Error(`gate must be ${GATES.slice(0, -1).join(", ")} or off`); }
    if (key === "theme") { v = v.toLowerCase() || "auto"; if (!["auto", "herdr", "terminal", "dark", "light"].includes(v)) throw new Error("theme must be auto, herdr, terminal, dark or light"); }
    if (["agent", "coordinator", "watcherAgent"].includes(key)) { v = v.toLowerCase(); if (v && !/^[a-z][a-z0-9_-]*$/.test(v)) throw new Error(`${key} must be an agent kind such as claude or codex`); }
  }
  if (key === "review") { v = REVIEW_WORDS[String(value).trim().toLowerCase()]; if (!v) throw new Error("review must be repos, all or none"); }
  if (key === "remerge") { v = v === "" ? DEFAULTS.remerge : REMERGE_WORDS[String(value).trim().toLowerCase()]; if (!v) throw new Error("remerge must be tests or review"); }
  if (key === "worktree" && !["auto", "none"].includes(v)) throw new Error("worktree must be auto or none");
  if (key === "base" && !["fresh", "head"].includes(v)) throw new Error("base must be fresh or head");
  if (key === "merge" && !["squash", "merge", "rebase"].includes(v)) throw new Error("merge must be squash, merge or rebase");
  if (key === "serve") { v = String(v).toLowerCase(); if (!["local", "tailscale"].includes(v)) throw new Error("serve must be local or tailscale"); }
  return v;
}
const configFile = () => path.join(configDir(), "config.json");
// `helper` and `helperModel` were the Watcher's settings before the Coordinator existed: an existing file keeps working.
const ALIAS = { helper: "watcherAgent", helperModel: "watcherModel" };
export const config = () => {
  const file = readJson(configFile()) || {};
  const c = { ...DEFAULTS, ...file };
  delete c.bell; // a setting of older versions: nothing rings any more
  for (const [old, now] of Object.entries(ALIAS)) { if (file[old] !== undefined && file[now] === undefined) c[now] = file[old]; delete c[old]; }
  c.review = REVIEW_WORDS[String(c.review)] || "repos";
  // `reviewAuto` (true or false) was the setting before the gate: a file that still has it behaves as it did.
  if (file.gate === undefined && file.reviewAuto !== undefined) c.gate = gateOfAuto(file.reviewAuto);
  delete c.reviewAuto;
  if (!GATES.includes(c.gate)) c.gate = DEFAULT_GATE;
  c.remerge = REMERGE_WORDS[String(c.remerge)] || DEFAULTS.remerge;
  return c;
};
const isReset = (value) => ["", "default"].includes(String(value ?? "").trim().toLowerCase());
// The old name still sets the gate: true is the default gate, false is "off".
const gateKey = (key, value) => (key === "reviewAuto" ? ["gate", isReset(value) ? "" : gateOfAuto(value)] : [key, value]);
export function setConfig(key, value) {
  [key, value] = gateKey(ALIAS[key] || key, value);
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting "${key}". Settings: ${Object.keys(DEFAULTS).join(", ")}`);
  const now = { ...(readJson(configFile()) || {}) };
  const v = coerce(key, value);
  if (isReset(value)) delete now[key]; else now[key] = v;
  if (key === "gate") delete now.reviewAuto;
  writeJson(configFile(), now);
  return config();
}
export function setTaskConfig(id, key, value) {
  [key, value] = gateKey(key, value);
  if (!PER_TASK.includes(key)) throw new Error(`Per task you can set: ${PER_TASK.join(", ")}. Other settings are yours as a whole.`);
  const reset = isReset(value);
  const t = update(id, (t) => { assertUnarchived(t); t.own = { ...(t.own || {}) }; if (reset) delete t.own[key]; else t.own[key] = coerce(key, value); if (key === "gate") delete t.own.reviewAuto; });
  return choices(t);
}
export function choices(t) {
  const c = config(), own = t?.own || {};
  const out = {};
  for (const k of PER_TASK) out[k] = own[k] !== undefined && own[k] !== null ? own[k] : k in TASK_DEFAULTS ? TASK_DEFAULTS[k] : c[k];
  if ((own.gate === undefined || own.gate === null) && own.reviewAuto !== undefined && own.reviewAuto !== null) out.gate = gateOfAuto(own.reviewAuto); // a task's own choice from before the gate
  if (out.reviewer === "off") out.review = "none"; // no reviewer is no review
  return out;
}
// 2. Facts about a repo: .herdr-superwork.json, committed in that repo. Read from the commit a worktree starts
//    from, so an agent's own branch cannot change the rules it is checked by.
export const REPO_FILE = ".herdr-superwork.json";
export function repoConfig(root, ref) {
  let text = "";
  try { text = ref ? gitOut(root, ["show", `${ref}:${REPO_FILE}`]) : fs.readFileSync(path.join(root, REPO_FILE), "utf8"); } catch {}
  if (!text) return {};
  try {
    const j = JSON.parse(text);
    return { setup: String(j.setup || ""), check: String(j.check || ""), land: j.land === "auto" ? "auto" : "ask", teardown: String(j.teardown || ""), include: Array.isArray(j.include) ? j.include.map(String) : [] };
  } catch { return {}; }
}
