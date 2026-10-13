// `herdr-superwork machines`: the check you can run. This machine first (does a login shell with a bare environment,
// which is what SSH gives, find `herdr-superwork`?), then each other machine: whether it answers, its plugin version
// and how many tasks it has, or why it does not answer and what to do. The other machines are asked as the board asks
// them, and a failure is read by the same code (why.js).
import os from "node:os";
import { spawn } from "node:child_process";
import * as S from "../store.js";
import * as R from "../remote.js";

// What SSH hands a command: the account, its shell and a short PATH. Nothing of the terminal this was typed in.
const bare = () => { const u = os.userInfo(); return { HOME: os.homedir(), USER: u.username, LOGNAME: u.username, SHELL: process.env.SHELL || u.shell || "/bin/sh", PATH: "/usr/local/bin:/usr/bin:/bin" }; };
const runShell = (line, env, ms) => new Promise((done) => {
  let out = "", err = "", ended = false;
  const end = (how) => { if (!ended) { ended = true; clearTimeout(timer); done({ ...how, stdout: out, stderr: err, ms }); } };
  const c = spawn(env.SHELL, ["-lc", line], { env, stdio: ["ignore", "pipe", "pipe"] });
  const timer = setTimeout(() => { try { c.kill("SIGKILL"); } catch {} end({ timedOut: true }); }, ms);
  c.on("error", (e) => end({ error: String((e && e.message) || e) }));
  c.stdout.on("data", (d) => { out += d; }); c.stderr.on("data", (d) => { err += d; });
  c.on("close", (code) => end({ code }));
});
// This machine, as another one would find it. `run`: the shell (a test gives its own).
export async function here({ run = runShell, ms = 20000 } = {}) {
  const env = bare(), m = { label: "this machine", target: "<this machine>" };
  const end = await run("herdr-superwork remote hello", env, ms);
  const j = end.timedOut || end.error ? null : R.readAnswer(end.stdout);
  // Found, but an older one that does not know this request: it is found, which is what was asked.
  if (j && /^Unknown request/.test(String(j.msg || ""))) return { label: os.hostname(), here: true, ok: true, version: "", shell: env.SHELL };
  if (j && j.ok) return { label: os.hostname(), here: true, ok: true, version: String(j.version || ""), shell: env.SHELL };
  // A shell that cannot be started is this machine's own trouble, not ssh's.
  const why = j ? R.notList(j, m) : end.error ? { kind: "path", line: "its login shell could not be started", detail: [`${env.SHELL}: ${end.error}`], said: "", code: null } : R.whyNot(end, m);
  return { label: os.hostname(), here: true, ok: false, shell: env.SHELL, why: { ...why, detail: why.detail.filter((l) => !l.startsWith("Test it from this machine")).concat(`Test it from another machine: ${R.testLine(`${env.USER}@${os.hostname()}`)}`) } };
}
const asked = (m, ask, ms) => new Promise((done) => ask(m, "list", null, (j, why) => done(j && Array.isArray(j.tasks)
  ? { label: m.label, target: m.target, ok: true, version: String(j.version || ""), tasks: j.tasks.filter((t) => !t.archivedAt).length }
  : { label: m.label, target: m.target, ok: false, why: j ? R.notList(j, m) : why || R.unknown(m) }), ms));

export async function check({ ask = R.ask, run, ms = 20000 } = {}) {
  let list = []; R.machines((l) => { list = l; });
  const [me, ...others] = await Promise.all([here({ run, ms }), ...list.map((m) => asked(m, ask, ms))]);
  return { here: me, machines: others, off: S.setting("board.machines") === "none" };
}
export function say(r) {
  const rows = [r.here, ...r.machines], wide = Math.max(...rows.map((x) => x.label.length));
  const one = (x) => [
    `${x.label.padEnd(wide)}  ${x.here ? (x.ok ? `this machine: a login shell (${x.shell}) finds herdr-superwork ${x.version || "(an older one than this)"}` : `this machine: other machines cannot ask it: ${x.why.line}`) : x.ok ? `answers · herdr-superwork ${x.version || "(an older one: update it there)"} · ${x.tasks} task${x.tasks === 1 ? "" : "s"}` : `does not answer: ${x.why.line}`}${x.here ? "" : `  (${x.target})`}`,
    ...(x.ok ? [] : [...x.why.detail, ...(x.why.said ? ["What came back:", ...x.why.said.split("\n").map((l) => `  ${l}`)] : [])].map((l) => `    ${l}`)),
  ].join("\n");
  const none = r.off ? "Other machines are off (unset board.machines turns them on)." : "No other machines. Add one with: herdr machine add <name> <ssh target>  (or name them in the board.machines setting).";
  return [...rows.map(one), ...(r.machines.length ? [] : [none])].join("\n");
}
