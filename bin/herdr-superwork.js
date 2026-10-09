#!/usr/bin/env node
// Argument routing only: everything lives in src/.
import { main } from "../src/cli.js";
main(process.argv.slice(2)).then((code) => { if (typeof code === "number") process.exitCode = code; }, (e) => { process.stderr.write(`${e?.message || e}\n`); process.exitCode = 1; });
