#!/usr/bin/env node
// The repo's own rules, checked: no source file past its size, every source file says what it holds, no name used and
// never defined, and no made table out of date (`npm run check` writes those before it runs this, and says so).
// Part of the check (test/guard.test.js runs it); by hand: `node scripts/guard.js`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, sources, stale, wherePage } from "./docs.js";
import { problems as names } from "./names.js";

// A source file past this many lines is split by area (as src/finish/ was) rather than appended to.
export const MAX_LINES = 300;
const KEYS_FILE = "src/board/keys.js";

export function problems() {
  const out = [];
  for (const file of sources()) {
    const n = fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\n$/, "").split("\n").length;
    if (n > MAX_LINES) out.push(`${file} has ${n} lines, more than ${MAX_LINES}: split it by area into a folder of small files (AGENTS.md, "Where new things go")`);
  }
  // A key's chord and its name are written in src/board/keys.js and nowhere else, so that changing a key is one edit.
  for (const file of sources().filter((f) => f.startsWith("src/") && f !== KEYS_FILE)) {
    fs.readFileSync(path.join(ROOT, file), "utf8").split("\n").forEach((l, n) => {
      const code = l.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/ .*$/, "");
      if (/\bmatchesKey\(/.test(code) || /\b(ctrl|alt|shift)\+[a-z↑↓]/i.test(code)) out.push(`${file}:${n + 1} names a key by its chord: use K.is(data, "id") and keyName("id") from ${KEYS_FILE}, where every key is defined once`);
    });
  }
  // A name a file uses is one it defines or imports: code moved to another file leaves none behind.
  out.push(...names());
  // Every source file starts with a comment that says what it holds: the map is made from those.
  try { wherePage(); } catch (e) { out.push(e.message); }
  let old = [];
  try { old = stale(); } catch (e) { out.push(e.message); }
  if (old.length) out.push(`${old.join(", ")} ${old.length > 1 ? "are" : "is"} out of date: run \`npm run check\` (or \`node scripts/docs.js\`) and commit what it writes (never edit a made table by hand)`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bad = problems();
  for (const b of bad) console.error(`✖ ${b}`);
  if (bad.length) process.exit(1);
  console.log("Guard: every source file is within its size, every name is defined and every made table is up to date.");
}
