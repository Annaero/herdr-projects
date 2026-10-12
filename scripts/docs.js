#!/usr/bin/env node
// The pages made from the code: `node scripts/docs.js` writes them, `node scripts/docs.js --check` only says which
// are out of date (the check does that too: scripts/guard.js). What is made:
//   docs/keys.md              the table of keys, from src/board/keys.js
//   docs/settings.md          the table of settings, from src/store/settings-list.js
//   docs/where-things-live.md the whole page, from the comment at the top of each file (tests included)
// A page made in part keeps its own words outside the two marker lines; only what is between them is replaced.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { KEYS, KEY, name, written } from "../src/board/keys.js";
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
  }
  // Another chord for the same thing is named in its row (the shifted and "return" twins of a key are not).
  const also = (k) => { const more = k.keys.slice(1).filter((c) => !/^shift\+|^return$/.test(c)); return more.length ? `. ${more.map(written).join(", ")} does the same` : ""; };
  return table(["Key", "Does"], KEYS.filter((k) => k.doc).map((k) => [written(name(k.id, true)), keyWords(k.doc) + also(k)]));
}

// ---- the settings ----------------------------------------------------------------------------------------------------
function settingsTable() {
  for (const s of SETTINGS) if (!s.doc) throw new Error(`src/store/settings-list.js: the setting "${s.key}" has no \`doc\``);
  const shown = (s) => (s.shown ? s.shown : "`" + (typeof s.default === "string" ? s.default : JSON.stringify(s.default)) + "`");
  return table(["Setting", "Default", "Per task", "Means"], SETTINGS.map((s) => ["`" + s.key + "`", shown(s), s.taskOnly ? "only" : s.task ? "yes" : "", keyWords(s.doc)]));
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
  if (!words.length) { if (file.startsWith("test/")) return ""; throw new Error(`${file} does not start with a comment that says what it holds (docs/where-things-live.md is made from it)`); }
  const text = words.join(" ");
  const end = text.search(/\.(\s|$)/);
  const first = (end < 0 ? text : text.slice(0, end)).replace(/\s+/g, " ").replace(/:$/, "");
  return first.length > 220 ? first.slice(0, 219).replace(/\s+\S*$/, "") + "…" : first;
}
function wherePage() {
  const files = sources(), dirs = [...new Set(files.map((f) => path.dirname(f)))];
  const order = (d) => [d.startsWith("src") ? 0 : 1, d];
  dirs.sort((a, b) => (order(a) < order(b) ? -1 : 1));
  const pages = tracked(["docs"]).filter((f) => /^docs\/[^/]+\.md$/.test(f));
  const tests = tracked(["test"]).filter((f) => /^test\/[^/]+\.js$/.test(f));
  const title = (f) => (read(f).match(/^# (.+)$/m) || [, ""])[1];
  return [
    "# Where things live",
    "",
    "<!-- Made by `node scripts/docs.js` from the comment at the top of each file. Do not edit this page: change the",
    "     file's own comment, then run the command again. -->",
    "",
    "Which file holds what. Every line is the first sentence of the comment at the top of that file, so the page is",
    "never edited by hand: `node scripts/docs.js` writes it, and the check fails when it is out of date. Where a new",
    "thing goes is in [AGENTS.md](../AGENTS.md).",
    "",
    ...dirs.flatMap((d) => [`## \`${d}/\``, "", table(["File", "Holds"], files.filter((f) => path.dirname(f) === d).map((f) => ["`" + path.basename(f) + "`", holds(f)])), ""]),
    "## The pages: `docs/`",
    "",
    table(["Page", "About"], pages.map((f) => [`[${path.basename(f)}](${path.basename(f)})`, title(f)])),
    "",
    "## The tests: `test/`",
    "",
    "One file per area, named after it; `npm run check <area>` runs every `test/<area>*.test.js` ([testing.md](testing.md)).",
    "",
    table(["File", "Tests"], tests.map((f) => ["`" + path.basename(f) + "`", holds(f)])),
    "",
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
// Every made page as it should be now: { "docs/keys.md": text, … }.
export function pages() {
  const out = {};
  for (const [file, id, from, make] of PARTS) out[file] = withPart(file, id, from, make());
  out["docs/where-things-live.md"] = wherePage();
  return out;
}
// The made pages that are not what the code says now.
export function stale() {
  return Object.entries(pages()).filter(([file, text]) => { try { return read(file) !== text; } catch { return true; } }).map(([file]) => file);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const old = stale();
    if (old.length) { console.error(`Out of date: ${old.join(", ")}. Run: node scripts/docs.js`); process.exit(1); }
    console.log("The made pages are up to date.");
  } else {
    const old = stale(), all = pages();
    for (const file of old) fs.writeFileSync(path.join(ROOT, file), all[file]);
    console.log(old.length ? `Wrote ${old.join(", ")}` : "Nothing to write: the made pages are up to date.");
  }
}
