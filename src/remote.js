// Other machines. Every machine keeps its own tasks; a home board asks each machine for its list and sends each
// action to the machine that owns the task, through one entry point there: `herdr-superwork remote list|do|dispatch`,
// run over SSH with a login shell so PATH is set. Work never moves between machines. Why a machine did not answer is
// remote/why.js; the check you can run (`herdr-superwork machines`) is remote/check.js.
//
// Machines come from `herdr machine list --json` (the ones the client added with `herdr machine add`). Each has an
// `id`, a `label`, a `target` (`user@host` or `ssh://user@host:port`), a `session` and `enabled` (seen on herdr
// 0.9.3 with a saved machine). The `machines` setting names them by hand instead.
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as S from "./store.js";
import * as F from "./flow.js";
import { herdr } from "./herdr.js";
import { landsOn } from "./sync.js";
import { readAnswer, whyNot } from "./remote/why.js";
import { automationsSent, isAutomationAction, automationDo } from "./remote/automations.js";
export * from "./remote/why.js";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
export function machines(done) {
  const want = S.setting("board.machines"), user = os.userInfo().username;
  if (want === "none") return done([]);
  if (want !== "auto") return done(want.split(/[\s,]+/).filter(Boolean).map((x) => ({ target: x.includes("@") ? x : `${user}@${x}`, label: x.split("@").pop().split(".")[0], session: "" })));
  let list = [];
  try { list = herdr().machines(); } catch {}
  // `id`: herdr's own id for the saved machine (the web UI names its PCs by it: webui/pcs.js).
  done(list.filter((m) => m && m.enabled !== false).map((m) => ({
    id: String(m.id || ""), target: String(m.ssh_target || m.target || m.ssh || m.host || ""), session: String(m.remote_session || m.session || ""),
    label: String(m.label || m.name || m.ssh_target || m.target || "").split("@").pop().split(".")[0].replace(/[^A-Za-z0-9_.-]/g, "-"),
  })).filter((m) => m.target && m.label));
}
// Its own known-hosts file, so an old saved key elsewhere cannot get in the way; one shared connection per machine,
// so asking again every few seconds costs almost nothing.
export function sshCommand(m, remote, tty = false) {
  // The remote side runs through a login shell so PATH is set, with the profile's session passed along.
  const session = m.session && m.session !== "default" ? `HERDR_SESSION=${m.session.replace(/[^A-Za-z0-9_.-]/g, "")} ` : "";
  const line = `exec "\${SHELL:-/bin/sh}" -lc '${session}${remote}'`;
  if (process.env.HERDR_SUPERWORK_SSH) return { command: process.env.HERDR_SUPERWORK_SSH, args: [m.target, `${session}${remote}`] }; // a stand-in, for tests
  const d = S.dataDir();
  return { command: "ssh", args: [...(tty ? ["-t"] : ["-o", "BatchMode=yes"]), "-o", "ConnectTimeout=6", "-o", "StrictHostKeyChecking=accept-new", "-o", `UserKnownHostsFile=${path.join(d, "known_hosts")}`, "-o", "ControlMaster=auto", "-o", `ControlPath=${path.join(d, "ssh-%C")}`, "-o", "ControlPersist=120", "-o", "LogLevel=ERROR", m.target, line] };
}
// `cb(answer, why)`: the answer (one line of JSON, wherever the shell's start-up files printed around it), or null
// with why there is none (remote/why.js): the exit code and stderr are kept for that.
export function ask(m, what, arg, cb, ms = 20000) {
  const { command, args } = sshCommand(m, `herdr-superwork remote ${what}${arg ? " " + b64(arg) : ""}`);
  let out = "", err = "", ended = false;
  const end = (how) => {
    if (ended) return;
    ended = true; clearTimeout(timer);
    const j = how.timedOut || how.error ? null : readAnswer(out);
    try { j ? cb(j) : cb(null, whyNot({ ...how, stdout: out, stderr: err, ms }, m)); } catch {}
  };
  const c = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const timer = setTimeout(() => { try { c.kill("SIGKILL"); } catch {} end({ timedOut: true }); }, ms);
  c.on("error", (e) => end({ error: String((e && e.message) || e) }));
  c.stdout.on("data", (d) => { if (out.length < 64 << 20) out += d; });
  c.stderr.on("data", (d) => { if (err.length < 1 << 16) err += d; });
  c.on("close", (code) => end({ code }));
}
// Entering a remote task's agent: SSH to that machine and `herdr agent attach <pane id>` there, in the board's own
// terminal. A direct view of that one agent's terminal, no nested herdr; detaching (ctrl+b q) returns to the board.
export function attachCommand(m, pane) {
  const safe = String(pane).replace(/[^A-Za-z0-9:_-]/g, "");
  const session = m.session && m.session !== "default" ? ` --session ${m.session.replace(/[^A-Za-z0-9_.-]/g, "")}` : "";
  return sshCommand(m, `herdr${session} agent attach ${safe}`, true);
}

// ---- the door on this machine: each request answers in one line of JSON ---------------------------------------------
const snapshot = (t) => {
  const folder = S.folderOf(t.id);
  const tree = t.worktree || "";
  // Its settings as this machine reads them, each with the place it came from: the task panel on the asking side.
  // What its agent (its reviewer, while it is under review) said: only for a task someone is on, and kept small.
  const talk = F.isAgentTask(t) && !t.archivedAt && t.stage !== "done" ? (() => { try { return F.taskTalk(t, { keep: 8, most: 6000 }); } catch { return undefined; } })() : undefined;
  // Where its work lands, for the asking side's merge question: only for a task that waits for that yes.
  const onto = t.stage === "approval" ? (() => { try { return landsOn(t); } catch { return undefined; } })() : undefined;
  return { talk, landsOn: onto, folder: S.tilde(folder), tree: S.tilde(tree), branch: S.branchOf(tree || folder), settings: S.settingRows({ task: t }), problems: S.settingProblems(t), canWorktree: S.canWorktree(folder), repo: S.inRepo(t) };
};
// `said`, `usage` and `agentVersion` ride along on each task; `version` is this side's plugin version (a machine on
// an older plugin sends none, and the asking side then knows which requests it would not understand). Pending
// hook events are this machine's own and are not sent (nor is `announced`, a marker older versions left on tasks).
// `automations`: this machine's own, for the asking board's list (remote/automations.js).
export const remoteList = () => { const keys = S.repoKeys(); return { host: os.hostname(), version: S.VERSION, automations: (() => { try { return automationsSent(); } catch { return []; } })(), tasks: F.board({ includeArchived: true }).map((t) => { const { live, announced, events, ...rest } = t; return { ...rest, ...(keys[t.repo] ? { key: keys[t.repo] } : {}), snap: snapshot(t) }; }) }; };
export async function remoteMain([what, payload]) {
  const a = payload ? JSON.parse(Buffer.from(payload, "base64").toString("utf8")) : {};
  const say = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  try {
    if (what === "list") return say(remoteList());
    if (what === "hello") return say({ ok: true, host: os.hostname(), version: S.VERSION }); // the check a machine runs on itself (remote/check.js)
    if (what === "do" && isAutomationAction(a.action)) return say(automationDo(a)); // an automation of this machine, not a task
    if (what === "do") {
      const A = await import("./actions.js");
      let t = S.find(a.id);
      // The work settings of the machine that asked travel with the task it starts: they stand where this machine's
      // own "you" and its entry for the repo would. Board settings stay with each machine.
      const sent = () => { if (a.settings && typeof a.settings === "object") t = S.update(t.id, (t) => { t.carried = { from: String(a.from || "another machine").slice(0, 64), settings: S.checked(a.settings, {}) }; }); };
      // A change to one of its own settings, from the asking side's task panel.
      if (a.action === "set") { const r = a.value === undefined ? S.unsetValue(String(a.name), { task: t }) : S.setValue(String(a.name), a.value, { task: t }); const later = S.settingRows({ task: S.get(t.id) }).find((x) => x.name === r.name)?.later; return say({ ok: true, msg: `${r.name}: ${S.say(r.value)} (${r.from})${later ? ` · ${later}` : ""}` }); }      const acts = {
        archive: () => { A.archive(t.id); return `${t.id}: archived. ? has undo, and the archive.`; },
        restore: () => { A.restore(t.id); return `${t.id}: restored`; },
        delegate: () => { sent(); A.delegate(t.id); return `${t.id}: an agent is on it`; },
        tell: () => { if (!t.startedOnce) sent(); return A.tell(t.id, String(a.text || "")).msg; },
        approve: () => A.approve(t.id, a.seen || null, { anyway: a.anyway === true }).msg,
        fix: () => A.sendFailure(t.id).msg,
        retry: () => A.sendError(t.id).msg,
        again: () => A.retry(t.id).msg,
        review: () => A.sendReview(t.id).msg,
        finish: () => A.finishAnyway(t.id).msg,
        pin: () => { const p = A.pin(t.id); return `${t.id}: ${p.pinned ? "pinned" : "unpinned"}`; },
        stop: () => { A.stop(t.id); return `${t.id}: stopped.`; },
      };
      // Going into a task from another machine: reopen its space and restart its exited agent here first, with the
      // same function the local board calls, and answer with the pane to attach to.
      if (a.action === "reopen") { const D = await import("./delegate.js"); const r = D.reopen(t.id, { restart: true }); return say({ ok: true, msg: "", pane: r.pane.pane_id, workspace: r.pane.workspace_id || "", hasAgent: r.hasAgent }); }
      if (a.action === "clear") { const out = await A.clear(t.id); return say({ ok: true, msg: out.kept.length ? `${t.id}: removed. Kept, so no work is lost: ${out.kept.join(", ")}` : `${t.id}: removed` }); }
      if (!acts[a.action]) return say({ ok: false, msg: `Unknown action ${a.action}` });
      return say({ ok: true, msg: acts[a.action]() });
    }
    if (what === "dispatch") {
      const C = await import("./coordinator.js");
      const cwd = a.about ? S.folderOf(a.about) : process.env.HOME || process.cwd();
      if (!C.ready()) {
        const A = await import("./actions.js");
        const [title, ...rest] = String(a.text || "").split("\n");
        let t = A.add(cwd, title, { description: rest.join("\n") });
        if (a.settings && typeof a.settings === "object") t = S.update(t.id, (t) => { t.carried = { from: String(a.from || "another machine").slice(0, 64), settings: S.checked(a.settings, {}) }; });
        if (a.delegate) A.delegate(t.id);
        return say({ ok: true, msg: `${t.id}: added${a.delegate ? ", an agent is on it" : ""}` });
      }
      // This machine's own Coordinator takes it, in its one conversation; its answer shows on this machine's board.
      C.send(cwd, String(a.text || ""), { delegate: !!a.delegate, about: a.about || null });
      return say({ ok: true, msg: `sent to ${os.hostname()}` });
    }
    say({ ok: false, msg: `Unknown request ${what}` });
  } catch (e) { say({ ok: false, msg: String((e && e.message) || e) }); }
}
