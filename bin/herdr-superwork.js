#!/usr/bin/env node
// Argument routing only: everything lives in src/.
import { main } from "../src/cli.js";
main(process.argv.slice(2)).then((code) => { if (typeof code === "number") process.exitCode = code; }, async (e) => { let said = String(e?.message || e); try { said = (await import("../src/store.js")).sayIds(said); } catch {} process.stderr.write(`${said}\n`); process.exitCode = 1; }); // a task is named by its repo's short key where it has one
