// Loaded into every test file's process by test/check.js (NODE_OPTIONS). When the file ends it writes down what it
// cost: seconds by the clock, seconds of processor time (its own and that of the programs it started and waited for),
// and how many programs it started. The check holds each file to a budget on these. Does nothing anywhere else.
const dir = process.env.HERDR_SUPERWORK_CHECK_PROBE;
const file = process.argv[1] || "";
if (dir && /\.test\.js$/.test(file)) {
  const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
  const began = process.hrtime.bigint();
  let launches = 0;
  for (const k of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
    const real = cp[k];
    // execFileSync, execSync and fork go through spawnSync or spawn inside node, but by its own reference, not this one.
    cp[k] = function (...args) { launches += 1; return real.apply(this, args); };
  }
  require("node:module").syncBuiltinESMExports();
  // Processor time in seconds: Linux counts the waited-for children too (fields 14 to 17 of /proc/self/stat, in ticks
  // of a hundredth of a second). Elsewhere: this process only.
  const cpu = () => {
    try { const s = fs.readFileSync("/proc/self/stat", "utf8"); return s.slice(s.lastIndexOf(")") + 2).split(" ").slice(11, 15).reduce((a, n) => a + Number(n), 0) / 100; }
    catch { const u = process.cpuUsage(); return (u.user + u.system) / 1e6; }
  };
  process.on("exit", () => {
    try { fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ file: path.basename(file), wall: Number(process.hrtime.bigint() - began) / 1e9, cpu: cpu(), launches })); } catch {}
  });
}
