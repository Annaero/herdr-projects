#!/usr/bin/env node
// Names used but never defined: a function called in a file that neither declares nor imports it (what is left
// behind when code moves to another file). Part of the check (scripts/guard.js); by hand: `node scripts/names.js`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as espree from "espree";
import { analyze } from "eslint-scope";
import { ROOT, sources } from "./docs.js";

// What node itself gives every file, and what a CommonJS file has besides.
const GLOBALS = new Set(Object.getOwnPropertyNames(globalThis));
const COMMONJS = ["require", "module", "exports", "__dirname", "__filename"];

// The undefined names in one file's text, as lines to print. A file that cannot be read as code is one line too.
// Read with the parser and the scope reading eslint's own `no-undef` rule is built on, without the linter around
// them: the whole linter took a third of a second of processor time more for every ten files, in every check.
// As in that rule, a name asked about with `typeof` is not a use, and a file names what its page gives it in a
// `/* global a, b */` comment.
export function undefinedNames(text, file) {
  const cjs = file.endsWith(".cjs"), sourceType = cjs ? "commonjs" : "module";
  let ast;
  try { ast = espree.parse(String(text).replace(/^#!.*/, ""), { ecmaVersion: "latest", sourceType, loc: true, range: true, comment: true }); }
  catch (e) { return [`${file}:${e.lineNumber || 1} cannot be read as code: ${e.message}`]; }
  const known = new Set(cjs ? COMMONJS : []);
  for (const c of ast.comments) { const m = c.type === "Block" && /^\s*globals?\s+([\s\S]*)$/.exec(c.value); if (m) for (const n of m[1].split(",")) known.add(n.trim().split(":")[0].trim()); }
  const asked = new Set(); // the names under a `typeof`
  const walk = (n) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "UnaryExpression" && n.operator === "typeof" && n.argument.type === "Identifier") asked.add(n.argument);
    for (const k in n) { if (k === "loc" || k === "range" || k === "comments" || k === "tokens") continue; const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") walk(v); }
  };
  walk(ast);
  return analyze(ast, { ecmaVersion: 2026, sourceType, nodejsScope: cjs }).globalScope.through
    .filter((r) => !GLOBALS.has(r.identifier.name) && !known.has(r.identifier.name) && !asked.has(r.identifier))
    .map((r) => `${file}:${r.identifier.loc.start.line} uses ${r.identifier.name}, which it neither defines nor imports`);
}
// The tests are left out: a test file runs from top to bottom in every check, which finds the same there.
export const problems = () => sources().filter((f) => /\.c?js$/.test(f)).flatMap((file) => undefinedNames(fs.readFileSync(path.join(ROOT, file), "utf8"), file));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bad = problems();
  for (const b of bad) console.error(`✖ ${b}`);
  if (bad.length) process.exit(1);
  console.log("Names: every name a file uses is one it defines or imports.");
}
