// A repo's short key (`repo.key`: `HSW` for herdr-superwork) and what it does to a task's name: its tag reads
// `HSW-134` instead of `#134`, and `HSW-134` names the task wherever its id does. Nothing is stored under a key: it
// is another way to write the id, worked out each time, so changing or removing one breaks nothing.
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./files.js";
import { knownRepos } from "./repos.js";
import { lookup } from "./settings/lookup.js";
import { NONE } from "./settings/values.js";
import { yours, configFile, REPO_FILE } from "./settings/places.js";

// Every key that is said, with who says it: [{ repo, key, place }]. Asked on every look at the board, so the answer
// is kept until one of the files it comes from changes: the list of repos, your settings, a repo's own file.
const mark = (file) => { try { const st = fs.statSync(file); return `${st.ino}|${st.size}|${st.mtimeMs}|${st.ctimeMs}`; } catch { return ""; } };
let kept = null;
export function saidKeys() {
  const repos = knownRepos();
  const now = [dataDir(), configFile(), mark(configFile()), ...Object.entries(repos).flatMap(([name, root]) => [name, root, mark(path.join(root, REPO_FILE))])].join("\n");
  if (kept && kept.now === now) return kept.out;
  const mine = yours(), out = [];
  for (const repo of Object.keys(repos)) {
    try { const r = lookup("repo.key", { repo }, mine); if (r.value && r.value !== NONE) out.push({ repo, key: r.value, place: r.place }); } catch {}
  }
  kept = { now, out };
  return out;
}
// The keys that count: { repo: key }. `set` refuses a key another repo has, but a repo's own file can still say one:
// then your entry wins over a file, and a key two repos say in the same kind of place counts for neither, so a key
// never names a task of two repos.
export function repoKeys() {
  const said = saidKeys(), out = {};
  for (const s of said) {
    const same = said.filter((x) => x.key === s.key), entries = same.filter((x) => x.place === "repo");
    if (same.length === 1 || (entries.length === 1 && entries[0] === s)) out[s.repo] = s.key;
  }
  return out;
}
const numberOf = (id) => { const n = String(id).split("/").pop(); return /^\d+$/.test(n) ? n : ""; };
// `hsw-134` -> `herdr-superwork/134`, in any letter case; "" when it is not a key and a number, or no repo has the key.
export function idOfKey(ref, keys = undefined) {
  const m = /^([A-Za-z][A-Za-z0-9]{1,4})-(\d+)$/.exec(String(ref || "").trim());
  if (!m) return "";
  const all = keys || repoKeys(), repo = Object.keys(all).find((r) => all[r] === m[1].toUpperCase());
  return repo ? `${repo}/${Number(m[2])}` : "";
}
// A task's short tag: `HSW-134` with a key, `#134` without. "" for an id with no number.
export function tagOf(id, keys = repoKeys()) {
  const n = numberOf(id), key = keys[String(id).split("/")[0]];
  return !n ? "" : key ? `${key}-${n}` : `#${n}`;
}
// A task named in words on the board: `HSW-134` with a key, else its id as it is.
export function sayId(id, keys = repoKeys()) {
  const n = numberOf(id), key = keys[String(id).split("/")[0]];
  return n && key ? `${key}-${n}` : String(id);
}
// Words that name tasks by their ids, as a person reads them: each id of a keyed repo in its short form
// (`proj/134: archived` -> `HSW-134: archived`). An id inside a path (a slash before or after it) is left as it is.
export function sayIds(text, keys = repoKeys()) {
  let out = String(text ?? "");
  for (const [repo, key] of Object.entries(keys)) out = out.split(new RegExp(`(?<![\\w/.+-])${repo.replace(/[.+]/g, "\\$&")}/(\\d+)(?![\\w/])`)).map((part, n) => (n % 2 ? `${key}-${part}` : part)).join("");
  return out;
}
// The same for the board's own screen, where a task's name is the tag its row has: every known repo's ids, keyed or
// not (`proj/14: stopped` -> `#14: stopped`, `HSW-14: stopped`). `repos`: the names of the repos the board knows.
export function tagIds(text, repos = [], keys = repoKeys()) {
  let out = String(text ?? "");
  for (const repo of new Set([...repos, ...Object.keys(keys)])) out = out.split(new RegExp(`(?<![\\w/.+-])${repo.replace(/[.+*?^$()[\]{}|\\]/g, "\\$&")}/(\\d+)(?![\\w/])`)).map((part, n) => (n % 2 ? (keys[repo] ? `${keys[repo]}-${part}` : `#${part}`) : part)).join("");
  return out;
}
// A task as a commit and a pull request name it: the short name with the id it stands for, or the id alone.
export const taskRef = (id, keys = repoKeys()) => { const short = sayId(id, keys); return short === String(id) ? String(id) : `${short} (${id})`; };
