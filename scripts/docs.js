#!/usr/bin/env node
// The pages made from the code: `node scripts/docs.js` writes them, `node scripts/docs.js --check` only says which
// are out of date. `npm run check` writes them too, and says so. What is made:
//   docs/keys.md              the table of keys, from src/board/keys.js
//   docs/settings.md          the table of settings, from src/store/settings-list.js
//   docs/where-things-live.md the map: which file holds what, from the comment at the top of each file. Not in git
//                             (it changed in most pull requests and collided): written in your own folder only.
//   node scripts/docs.js --where [folder]   prints the map, or only the folders under the one named (src/board/view)
// A page made in part keeps its own words outside the two marker lines; only what is between them is replaced.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { KEYS, KEY, GROUPS, name, written } from "../src/board/keys.js";
import { SETTINGS } from "../src/store/settings-list.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const cell = (s) => String(s).replace(/\|/g, "\\|");
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");

// Words that name a key as {id}, with each key as a page writes it.
const keyWords = (text) => String(text).replace(/\{(\w+)\}/g, (m, id) => { if (!KEY[id]) throw new Error(`"{${id}}" names no key (src/board/keys.js)`); return written(name(id)); });

// ---- the keys --------------------------------------------------------------------------------------------------------
function keysTable() {
  for (const k of KEYS) {
    if (!k.doc && !k.with) throw new Error(`src/board/keys.js: the key "${k.id}" has no \`doc\` (or \`with\`, the entry whose row describes it)`);
    if (k.with && !KEY[k.with]?.doc) throw new Error(`src/board/keys.js: the key "${k.id}" is described with "${k.with}", which has no \`doc\``);
    for (const w of [k.help, k.hint]) for (const [, id] of String(w || "").matchAll(/\{(\w+)\}/g)) if (!KEY[id]) throw new Error(`src/board/keys.js: "{${id}}" in the key "${k.id}" names no key`);
    if (k.menu && !k.run) throw new Error(`src/board/keys.js: the key "${k.id}" has a menu line and nothing to run`);
    if (k.group && !GROUPS.some(([g]) => g === k.group)) throw new Error(`src/board/keys.js: the key "${k.id}" is in the group "${k.group}", which is none of ${GROUPS.map(([g]) => g).join(", ")}`);
    if (k.group && k.group !== "plain" && !k.keys.every((c) => c.startsWith(`${k.group}+`))) throw new Error(`src/board/keys.js: the key "${k.id}" is in the group "${k.group}" and is pressed with ${k.keys.join(", ")}`);
    if (k.group && !k.with && !(k.group === "plain" ? k.help : k.menu)) throw new Error(`src/board/keys.js: the key "${k.id}" has no line for the ? menu (\`help\` for a plain key, \`menu\` for a ctrl or alt key)`);
  }
  // Another chord for the same thing is named in its row (the shifted and "return" twins of a key are not).
  const also = (k) => { const more = k.keys.slice(1).filter((c) => !/^shift\+|^return$/.test(c)); return more.length ? `. ${more.map(written).join(", ")} does the same` : ""; };
  // One table for each group, in the ? menu's order, then the keys that are in no group.
  const rows = (pick) => KEYS.filter((k) => k.doc && pick(k)).map((k) => [written(name(k.id, true)), keyWords(k.doc) + also(k)]);
  const heads = { plain: ["**Plain keys**", "Does"], ctrl: ["**`Ctrl`: does something**", "Does"], alt: ["**`Alt`: only shows or hides**", "Shows or hides"] };
  return [...GROUPS.map(([g]) => `${heads[g][0]}\n\n${table(["Key", heads[g][1]], rows((k) => k.group === g))}`),
    `**The text box's own** (not a key of the board, and not in the \`?\` menu)\n\n${table(["Key", "Does"], rows((k) => !k.group))}`].join("\n\n");
}

// ---- the settings ----------------------------------------------------------------------------------------------------
function settingsTable() {
  for (const s of SETTINGS) if (!s.doc) throw new Error(`src/store/settings-list.js: the setting "${s.name}" has no \`doc\``);
  const shown = (v) => "`" + (Array.isArray(v) ? v.join(", ") : String(v)) + "`";
  const where = (s) => (s.kind === "board" ? "you only" : s.kind === "repo" ? "repo entry, repo file" : s.repo ? "task, repo entry, you, repo file" : "task, repo entry, you");
  return table(["Setting", "Built in", "Can be said by", "Means"], SETTINGS.map((s) => ["`" + s.name + "`", shown(s.builtin), where(s), keyWords(s.doc)]));
}

// ---- where things live -----------------------------------------------------------------------------------------------
// What a file holds is the first sentence of the comment at its top.
const tracked = (dirs) => {
  const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...dirs], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return r.stdout.split("\n").filter((f) => f && fs.existsSync(path.join(ROOT, f))).sort();
};
export const sources = () => tracked(["src", "bin", "scripts"]).filter((f) => /\.(js|sh)$/.test(f));
function holds(file) {
  const mark = file.endsWith(".sh") ? "#" : "//";
  const lines = read(file).split("\n");
  if (lines[0].startsWith("#!")) lines.shift();
  const words = [];
  for (const l of lines) { if (!l.startsWith(mark)) break; const w = l.slice(mark.length).trim(); if (!w) break; words.push(w); }
  if (!words.length) throw new Error(`${file} does not start with a comment that says what it holds (the map, \`node scripts/docs.js --where\`, is made from it)`);
  const text = words.join(" ");
  const end = text.search(/\.(\s|$)/);
  const first = (end < 0 ? text : text.slice(0, end)).replace(/\s+/g, " ").replace(/:$/, "");
  return first.length > 220 ? first.slice(0, 219).replace(/\s+\S*$/, "") + "…" : first;
}
const WHERE = "docs/where-things-live.md";
// The map. `under`: only the folders at or below this one ("src/board"), and then without the list of pages.
export function wherePage(under = "") {
  const at = String(under).replace(/^\.\//, "").replace(/\/+$/, "");
  const files = sources(), dirs = [...new Set(files.map((f) => path.dirname(f)))].filter((d) => !at || d === at || d.startsWith(`${at}/`));
  const order = (d) => [d.startsWith("src") ? 0 : 1, d];
  dirs.sort((a, b) => (order(a) < order(b) ? -1 : 1));
  const pages = at ? [] : tracked(["docs"]).filter((f) => /^docs\/[^/]+\.md$/.test(f) && f !== WHERE);
  const title = (f) => (read(f).match(/^# (.+)$/m) || [, ""])[1];
  return [
    "# Where things live",
    "",
    "<!-- Made by `node scripts/docs.js` from the comment at the top of each file. Not in git: it is written in your",
    "     own folder. Do not edit it: change the file's own comment, then run the command again. -->",
    "",
    "Which file holds what. Every line is the first sentence of the comment at the top of that file. Printed by",
    "`node scripts/docs.js --where [folder]`. Where a new thing goes is in [AGENTS.md](../AGENTS.md); the tests are",
    "one file per area in `test/`, named after it (`ls test`).",
    "",
    ...dirs.flatMap((d) => [`## \`${d}/\``, "", table(["File", "Holds"], files.filter((f) => path.dirname(f) === d).map((f) => ["`" + path.basename(f) + "`", holds(f)])), ""]),
    ...(pages.length ? ["## The pages: `docs/`", "", table(["Page", "About"], pages.map((f) => [`[${path.basename(f)}](${path.basename(f)})`, title(f)])), ""] : []),
    ...(dirs.length ? [] : [`No folder of source files is at or under \`${at}\`.`, ""]),
  ].join("\n");
}

// ---- writing and checking --------------------------------------------------------------------------------------------
const PARTS = [["docs/keys.md", "keys", "src/board/keys.js", keysTable], ["docs/settings.md", "settings", "src/store/settings-list.js", settingsTable]];
function withPart(file, id, from, body) {
  const text = read(file), start = `<!-- made:${id} `, end = `<!-- /made:${id} -->`;
  const a = text.indexOf(start), b = text.indexOf(end);
  if (a < 0 || b < a) throw new Error(`${file} has no "${start}…" and "${end}" lines for its made part`);
  return `${text.slice(0, a)}${start}Made by \`node scripts/docs.js\` from ${from}. Do not edit between these two lines. -->\n${body}\n${text.slice(b)}`;
}
// Every made page that is in git, as it should be now: { "docs/keys.md": text, … }.
export function pages() {
  const out = {};
  for (const [file, id, from, make] of PARTS) out[file] = withPart(file, id, from, make());
  return out;
}
// The made pages that are not what the code says now.
export function stale() {
  return Object.entries(pages()).filter(([file, text]) => { try { return read(file) !== text; } catch { return true; } }).map(([file]) => file);
}

// Writes what is out of date, and the map in this folder (ignored by git, so never part of a change). Returns the
// pages in git that it wrote: those are to be committed.
export function write() {
  const old = stale(), all = pages();
  for (const file of old) fs.writeFileSync(path.join(ROOT, file), all[file]);
  try { const map = wherePage(); let had = ""; try { had = read(WHERE); } catch {} if (had !== map) fs.writeFileSync(path.join(ROOT, WHERE), map); } catch {}
  return old;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), where = args.indexOf("--where");
  if (where >= 0) process.stdout.write(wherePage(args[where + 1] || ""));
  else if (args.includes("--check")) {
    const old = stale();
    if (old.length) { console.error(`Out of date: ${old.join(", ")}. Run: node scripts/docs.js`); process.exit(1); }
    console.log("The made pages are up to date.");
  } else {
    const old = write();
    console.log(old.length ? `Wrote ${old.join(", ")}` : "Nothing to write: the made pages are up to date.");
  }
}
