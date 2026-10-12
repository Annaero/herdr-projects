#!/usr/bin/env node
// Runs the tests: all of them (`npm test`), or only the files of the areas named (`npm test board-panel sync`: every
// test/<name>*.test.js). At the end it names each file that took longer than SLOW_S seconds: a file that slow is to be
// split, or its tests made cheaper, before it is handed in. See docs/testing.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { fileURLToPath } from "node:url";

export const SLOW_DEFAULT_S = 25;
export const SLOW_S = Number(process.env.HERDR_SUPERWORK_TEST_SLOW_S) || SLOW_DEFAULT_S; // the variable: another limit for one run (a busy machine)
const here = path.dirname(fileURLToPath(import.meta.url));
// The test files an area name stands for: the files whose name starts with it. No names: every file.
export function filesFor(areas, all) {
  const name = (a) => path.basename(String(a)).replace(/(\.test)?\.js$/, "");
  const files = areas.length ? all.filter((f) => areas.some((a) => f.startsWith(name(a)))) : all;
  return { files, unknown: areas.filter((a) => !all.some((f) => f.startsWith(name(a)))) };
}
// The files over the limit, slowest first, from [file, seconds] pairs.
export const slowOnes = (times, limit = SLOW_S) => times.filter(([, s]) => s > limit).sort((a, b) => b[1] - a[1]);

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const all = fs.readdirSync(here).filter((f) => f.endsWith(".test.js")).sort();
  const { files, unknown } = filesFor(process.argv.slice(2), all);
  if (unknown.length) { console.error(`No test file starts with: ${unknown.join(", ")}\nThe areas: ${all.map((f) => f.replace(".test.js", "")).join(" ")}`); process.exit(2); }
  // A file's time: its tests' own times added up (they run one after another). Not when their results arrive here: the
  // runner holds those back to print the files in order.
  const took = new Map();
  const stream = run({ files: files.map((f) => path.join(here, f)), concurrency: true });
  for (const kind of ["test:pass", "test:fail"]) stream.on(kind, (d) => { if (d.file && d.nesting === 0 && path.resolve(d.name) !== d.file) took.set(d.file, (took.get(d.file) || 0) + (d.details?.duration_ms || 0)); });
  stream.on("test:fail", () => { process.exitCode = 1; });
  stream.compose(spec).pipe(process.stdout);
  stream.on("end", () => {
    const slow = slowOnes([...took].map(([f, ms]) => [path.relative(process.cwd(), f), ms / 1000]));
    if (!slow.length) return;
    console.log(`\n⚠ slow test files (over ${SLOW_S} s; split the file or make its tests cheaper, see docs/testing.md):`);
    for (const [f, s] of slow) console.log(`  ${f}  ${s.toFixed(0)} s`);
    // Times are by the clock: a machine busy with other work stretches them all.
    const load = os.loadavg()[0], cores = os.availableParallelism();
    if (load > cores * 1.5) console.log(`  This machine is busy (load ${load.toFixed(0)} on ${cores} cores), so these times are stretched. Run a named file by itself to see its own time.`);
  });
}
