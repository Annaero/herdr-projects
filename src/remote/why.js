// Why another machine's tasks could not be read, and what to do about it. One reading of how the SSH call ended (its
// exit code, what it wrote to stderr and stdout, whether the board gave up waiting) for the board, the web board and
// `herdr-superwork machines`. Five kinds: `connect` (the machine cannot be reached), `login` (it does not let the
// board in), `path` (a login shell there does not find `herdr-superwork`, or `node`), `answer` (it said something
// that is not the board's answer) and `slow` (it took too long).
//
// The words ssh and the shells use were read from the real programs (OpenSSH 9, sh, dash, bash, zsh, env).

import path from "node:path";
import { dataDir, tilde } from "../store.js";

// The answer is one line of JSON. A shell's start-up file may print before it (a banner) and its exit file after it,
// however much, and such a line may be JSON itself. So the answer is the last line that is the board's own (a task
// list, or an answer with `ok`), wherever it stands; with none, the last line that is a JSON object at all.
const ours = (j) => Array.isArray(j.tasks) || typeof j.ok === "boolean";
export function readAnswer(stdout) {
  const lines = String(stdout || "").split(/\r?\n/);
  let other = null;
  for (let n = lines.length - 1; n >= 0; n--) {
    const l = lines[n].trim();
    if (!l.startsWith("{")) continue;
    try { const j = JSON.parse(l); if (j && typeof j === "object" && !Array.isArray(j)) { if (ours(j)) return j; other ??= j; } } catch {}
  }
  return other;
}

// A machine as its line in known_hosts names it: the host, or [host]:port when the port is not 22.
export function knownHost(target) {
  const m = /^(?:ssh:\/\/)?(?:[^@/]*@)?(\[[^\]]+\]|[^:/]+)(?::(\d+))?\/?$/.exec(String(target || "").trim());
  if (!m) return String(target || "");
  const host = m[1].replace(/^\[|\]$/g, ""), port = Number(m[2] || 22);
  return port === 22 ? host : `[${host}]:${port}`;
}

// The test to run by hand, from the machine that asks.
export const testLine = (target) => `ssh ${target || "<machine>"} 'exec $SHELL -lc "herdr-superwork remote list"' | tail -c 200`;
const tail = (text, most = 400) => { const s = String(text || "").replace(/\s+$/, "").split(/\r?\n/).filter((l) => l.trim() && !/^@+$|^@ +WARNING/.test(l.trim())).slice(-4).join("\n"); return s.length > most ? "…" + s.slice(-most) : s; };

const ONPATH = (what) => [
  `${what} must be on the PATH that a login shell gets when nobody types into it: the board runs \`$SHELL -lc\` over SSH.`,
  "A PATH set in ~/.bashrc does not count where that file stops early for such a shell (its \"if not running interactively, return\" line).",
  "On that machine, either set the PATH in the profile file (~/.profile or ~/.bash_profile for bash, ~/.zprofile for zsh), or link the program into a folder that is on it already:",
  `  ln -s "$(command -v ${what === "node" ? "node" : "herdr-superwork"})" ~/.local/bin/   (or /usr/local/bin)`,
];

// `end`: { code, stderr, stdout, timedOut, ms, error } as ask() saw it. `m`: the machine ({ label, target }).
export function whyNot(end = {}, m = {}) {
  const err = String(end.stderr || ""), out = String(end.stdout || ""), all = `${err}\n${out}`, name = m.label || "that machine", target = m.target || "<machine>";
  const make = (kind, line, detail) => ({ kind, line, detail: [...detail, `Test it from this machine: ${testLine(target)}`], said: tail(err) || tail(out), code: end.code ?? null });
  if (end.timedOut) return make("slow", "it took too long", [`${name} did not answer within ${Math.round((end.ms || 20000) / 1000)} seconds. The board asks again by itself.`, "If it stays so: the machine may be very busy, or its shell's start-up file waits for something (a prompt, a network drive)."]);
  if (end.error) return make("connect", "ssh could not be started", [`This machine could not start ssh: ${end.error}`, "Install OpenSSH's client here, so that `ssh` is on the PATH."]);
  // 255 is ssh's own: it never got as far as running the command.
  if (end.code === 255 || /^ssh: /m.test(err)) {
    if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(err)) return make("connect", "its host key changed", [`${name} shows another host key than the one the board saved for it, so ssh refused to connect.`, "If the machine was set up again, forget the old key (the board keeps its own list, in its data folder) and the next try saves the new one:", `  ssh-keygen -R '${knownHost(target)}' -f ${tilde(path.join(dataDir(), "known_hosts"))}`]);
    if (/Permission denied|Too many authentication failures|No more authentication methods|no such identity|password/i.test(err)) return make("login", "it does not let the board in", [`${name} refused the login. The board cannot type a password: it runs ssh in batch mode, so a key must work by itself.`, `Put your public key on it (ssh-copy-id ${target}), or load your key into the ssh agent this board runs under.`]);
    const how = /Could not resolve hostname/i.test(err) ? "its name is not known" : /timed out/i.test(err) ? "connecting timed out" : /Connection refused/i.test(err) ? "it refused the connection" : /No route to host|Network is unreachable/i.test(err) ? "there is no way to it from here" : "";
    return make("connect", how ? `cannot connect (${how})` : "ssh could not connect", [`This machine cannot reach ${name} (${target})${how ? `: ${how}` : "; what ssh said is below"}.`, "Check that it is on and on the network, and that its name and port are right (herdr machine list, or the board.machines setting)."]);
  }
  // The shell on the other side ran, and did not find the program (127, in every shell's own words).
  const missing = /(?:^|[\s:'"`])(herdr-superwork|node)['"`]?: (?:command )?not found|command not found: (herdr-superwork|node)|env: ['‘`]?(node)['’`]?: No such file or directory/m.exec(all);
  const what = missing && (missing[1] || missing[2] || missing[3]);
  if (what === "herdr-superwork") return make("path", "herdr-superwork is not found there", [`A login shell on ${name} does not find \`herdr-superwork\`.`, ...ONPATH("`herdr-superwork`"), "Not installed there yet? See docs/other-machines.md."]);
  if (what === "node") return make("path", "node is not found there", [`A login shell on ${name} finds \`herdr-superwork\` but not \`node\`, which runs it.`, ...ONPATH("node")]);
  if (end.code === 127) return make("path", "a program is not found there", [`A login shell on ${name} did not find a program it needs.`, ...ONPATH("`herdr-superwork` (and `node`)")]);
  const old = /Node\.js v(\d+)\./.exec(all);
  if (old && Number(old[1]) < 22) return make("path", `its node is too old (${old[1]})`, [`\`herdr-superwork\` on ${name} was started by Node ${old[1]}; it needs Node 22.19 or newer.`, "Install a newer Node there and make it the `node` a login shell finds first:", ...ONPATH("node").slice(2)]);
  if (end.code) return make("answer", "it answered with an error", [`\`herdr-superwork remote\` on ${name} ended with an error (exit ${end.code}) and no answer.`, "Run the test below to see all of it; updating herdr-superwork there often settles it."]);
  if (!out.trim()) return make("answer", "it answered nothing", [`${name} ran the command and printed nothing.`, "Its shell's start-up file may end the shell early, or `herdr-superwork` there is another program."]);
  return make("answer", "it answered something else than the board's answer", [`${name} printed text, and none of it is the one line the board reads.`, "It may be an older herdr-superwork (update it there), or a start-up file of its shell that prints and then stops."]);
}

// An answer that is the board's own, but not a task list: an older plugin that does not know the request, an error.
export const notList = (j, m = {}) => ({ kind: "answer", line: "it answered, but not with its tasks", detail: [`${m.label || "That machine"} answered${j && j.msg ? `: ${String(j.msg).slice(0, 300)}` : " without a list of tasks"}.`, "It may run an older herdr-superwork: update it there.", `Test it from this machine: ${testLine(m.target)}`], said: j && j.msg ? String(j.msg).slice(0, 300) : "", code: 0 });
// No reason was kept (a caller that only knows it got nothing).
export const unknown = (m = {}) => ({ kind: "answer", line: "it did not answer", detail: [`${m.label || "That machine"} did not answer.`, `Test it from this machine: ${testLine(m.target)}`], said: "", code: null });
// "<machine> did not answer", with the reason when there is one: what an action on its task says.
export const unanswered = (label, why) => `${label} did not answer${why?.line && why.line !== "it did not answer" ? `: ${why.line}` : ""}`;
