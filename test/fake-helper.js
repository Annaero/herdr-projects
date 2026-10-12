#!/usr/bin/env node
// A stand-in for the hidden helper model. Reads the prompt on stdin and answers by rule: no model calls in tests.
let input = ""; process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
if (/Write its status for a dashboard/.test(input)) { console.log(`{"msg": "editing the greeting file", "progress": ${process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === "100000" ? 42 : 1}, "eta": 12}`); process.exit(0); }
console.error("no instruction"); process.exit(1);
