// The places a setting can be said in, as they are on disk: your file (with your entry for each repo in it), a
// task's own, and the repo's own committed file. Reading one checks every value: a mistake made by hand is a
// problem with its setting's name, and that one setting is simply not said there.
import fs from "node:fs";
import path from "node:path";
import { configDir, readJson, writeJson } from "../files.js";
import { gitOut } from "../repos.js";
import { NAMES, REPO_FACTS, entryOf } from "../settings-list.js";
import { check, nearest } from "./values.js";

export const REPO_FILE = ".herdr-superwork.json";
export const configFile = () => path.join(configDir(), "config.json");
const isGroup = (v) => !!v && typeof v === "object" && !Array.isArray(v);
// A file as written, nested ({ "review": { "rounds": 5 } }) or with dotted names, as one flat list of [name, value].
function leaves(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(isGroup(obj) ? obj : {})) {
    const name = prefix ? `${prefix}.${k}` : k;
    if (isGroup(v) && !entryOf(name)) out.push(...leaves(v, name)); else out.push([name, v]);
  }
  return out;
}
// The settings said in one place, checked. `allowed`: the names this place may hold. Returns { values, problems }.
export function read(obj, where, allowed = NAMES, why = "") {
  const values = {}, problems = [];
  for (const [name, v] of leaves(obj)) {
    if (!allowed.includes(name)) {
      const near = nearest(name, allowed);
      problems.push({ where, name, why: entryOf(name) ? `${name} ${why || "cannot be set here"}` : `unknown setting "${name}"${near ? ` (did you mean ${near}?)` : ""}` });
      continue;
    }
    try { values[name] = check(name, v); } catch (e) { problems.push({ where, name, why: e.message }); }
  }
  return { values, problems };
}

// ---- you, and your entry for each repo: one file --------------------------------------------------------------------------
// { "review": { "rounds": 5 }, "repos": { "<repo>": { "merge": { "by": "itself" } } } }
// Asked for every setting that is looked up: the file is read again only when it changed on disk.
let last = null;
export function yours() {
  let mark = "";
  try { const st = fs.statSync(configFile()); mark = `${configFile()}|${st.ino}|${st.size}|${st.mtimeMs}|${st.ctimeMs}`; } catch {}
  if (last && mark && last.mark === mark) return last.out;
  const out = readYours();
  last = { mark, out };
  return out;
}
function readYours() {
  let raw = null, broken = "";
  try { raw = JSON.parse(fs.readFileSync(configFile(), "utf8")); } catch (e) { if (e.code !== "ENOENT") broken = "it is not valid JSON, so nothing in it counts"; }
  const { repos, ...mine } = isGroup(raw) ? raw : {};
  const you = read(mine, "your settings");
  const entries = {}, problems = [...you.problems];
  if (broken) problems.push({ where: "your settings", name: "", why: broken });
  for (const [repo, obj] of Object.entries(isGroup(repos) ? repos : {})) {
    const r = read(obj, `your entry for ${repo}`, NAMES.filter((n) => entryOf(n).kind === "work"), "is a board setting, yours only: say it outside \"repos\"");
    entries[repo] = r.values; problems.push(...r.problems);
  }
  return { you: you.values, repos: entries, problems };
}
// Change one setting in your file: a value, or undefined to take it out. Everything else in the file stays as it is.
export function writeYours(name, value, repo = "") {
  const raw = readJson(configFile()), file = isGroup(raw) ? raw : {};
  let at = file;
  if (repo) { if (!isGroup(file.repos)) file.repos = {}; if (!isGroup(file.repos[repo])) file.repos[repo] = {}; at = file.repos[repo]; }
  const parts = name.split(".");
  delete at[name]; // the dotted spelling, where a hand wrote it that way
  const drop = (obj, i) => { if (!isGroup(obj)) return; if (i === parts.length - 1) delete obj[parts[i]]; else { drop(obj[parts[i]], i + 1); if (isGroup(obj[parts[i]]) && !Object.keys(obj[parts[i]]).length) delete obj[parts[i]]; } };
  drop(at, 0);
  if (value !== undefined) { let o = at; for (const p of parts.slice(0, -1)) { if (!isGroup(o[p])) o[p] = {}; o = o[p]; } o[parts.at(-1)] = value; }
  if (repo && !Object.keys(at).length) { delete file.repos[repo]; if (!Object.keys(file.repos).length) delete file.repos; }
  writeJson(configFile(), file);
}

// ---- the repo's own committed file: five facts, no more ---------------------------------------------------------------------
// Read from the commit a worktree starts from (`ref`), so an agent's own branch cannot change the rules it is checked
// by; anything but the five facts is refused, so code written by agents can never loosen a guard.
// Returns { facts, refused }: `refused` is one sentence per thing that did not count.
export function repoFile(root, ref) {
  let text = "";
  try { text = ref ? gitOut(root, ["show", `${ref}:${REPO_FILE}`]) : fs.readFileSync(path.join(root, REPO_FILE), "utf8"); } catch {}
  if (!text.trim()) return { facts: {}, refused: [] };
  let j;
  try { j = JSON.parse(text); } catch { return { facts: {}, refused: [`${REPO_FILE} is not valid JSON: nothing in it counts`] }; }
  const r = read(j, REPO_FILE, REPO_FACTS, `is refused: the repo's file may only hold ${REPO_FACTS.join(", ")}`);
  return { facts: r.values, refused: r.problems.map((p) => `${REPO_FILE}: ${p.why}`) };
}
