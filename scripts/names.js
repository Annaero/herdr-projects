#!/usr/bin/env node
// Names used but never defined: a function called in a file that neither declares nor imports it (what is left
// behind when code moves to another file). Part of the check (scripts/guard.js); by hand: `node scripts/names.js`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";
import { ROOT, sources } from "./docs.js";

// What node itself gives every file, and what a CommonJS file has besides.
const GLOBALS = Object.fromEntries(Object.getOwnPropertyNames(globalThis).map((n) => [n, "readonly"]));
const COMMONJS = { require: "readonly", module: "writable", exports: "writable", __dirname: "readonly", __filename: "readonly" };
const linter = new Linter();

// The undefined names in one file's text, as lines to print. A file that cannot be read as code is one line too.
export function undefinedNames(text, file) {
  const cjs = file.endsWith(".cjs");
  const config = { languageOptions: { ecmaVersion: "latest", sourceType: cjs ? "commonjs" : "module", globals: cjs ? { ...GLOBALS, ...COMMONJS } : GLOBALS }, linterOptions: { reportUnusedDisableDirectives: "off" }, rules: { "no-undef": "error" } };
  return linter.verify(String(text).replace(/^#!.*/, ""), config, file).filter((m) => m.fatal || m.ruleId === "no-undef")
    .map((m) => (m.fatal ? `${file}:${m.line} cannot be read as code: ${m.message}` : `${file}:${m.line} uses ${(m.message.match(/'([^']+)'/) || [, "a name"])[1]}, which it neither defines nor imports`));
}
// The tests are left out: a test file runs from top to bottom in every check, which finds the same there.
export const problems = () => sources().filter((f) => /\.c?js$/.test(f)).flatMap((file) => undefinedNames(fs.readFileSync(path.join(ROOT, file), "utf8"), file));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bad = problems();
  for (const b of bad) console.error(`✖ ${b}`);
  if (bad.length) process.exit(1);
  console.log("Names: every name a file uses is one it defines or imports.");
}
