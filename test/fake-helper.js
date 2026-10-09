#!/usr/bin/env node
// A stand-in for the hidden helper model. Reads the prompt on stdin and answers by rule: no model calls in tests.
import { execFileSync } from "node:child_process";
let input = ""; process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
if (/Write its status for a dashboard/.test(input)) { console.log(`{"msg": "editing the greeting file", "progress": ${process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === "100000" ? 42 : 1}}`); process.exit(0); }
const m = /Instruction: ([\s\S]*?)(\n\nDelegate what you file to an agent\.)?$/.exec(input.trim());
if (!m) { console.error("no instruction"); process.exit(1); }
if (/fail on purpose/.test(m[1])) { console.error("the model refused"); process.exit(2); }
const out = execFileSync("herdr-superwork", ["add", m[1].trim().slice(0, 40), "--desc", `From the box: ${m[1].trim()}`, ...(m[2] ? ["--delegate"] : []), "--json"], { encoding: "utf8" });
console.log(`Filed ${JSON.parse(out).id}.`);
