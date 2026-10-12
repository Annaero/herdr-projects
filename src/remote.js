// Other machines. Every machine keeps its own tasks; a home board asks each machine for its list and sends each
// action to the machine that owns the task, through one entry point there: `herdr-superwork remote list|do|dispatch`,
// run over SSH with a login shell so PATH is set. Work never moves between machines.
//
// Machines come from `herdr machine list --json` (the ones the client added with `herdr machine add`). Not verified
// on a machine with saved profiles: when that list does not expose SSH targets, the `machines` setting names them.
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as S from "./store.js";
import * as F from "./flow.js";
import { herdr } from "./herdr.js";
import { fullAccess } from "./agents.js";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
export function machines(done) {
  const c = S.config();
  const user = c.remoteUser || os.userInfo().username;
  const named = String(c.machines || "").split(/[\s,]+/).filter((x) => x && !["auto", "off", "none"].includes(x.toLowerCase()));
  if (named.length) return done(named.map((x) => ({ target: x.includes("@") ? x : `${user}@${x}`, label: x.split("@").pop().split(".")[0], session: "" })));
  if (["off", "none"].includes(String(c.machines).toLowerCase())) return done([]);
  let list = [];
  try { list = herdr().machines(); } catch {}
  done(list.filter((m) => m && m.enabled !== false).map((m) => ({
    target: String(m.ssh_target || m.target || m.ssh || m.host || ""), session: String(m.remote_session || m.session || ""),
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
export function ask(m, what, arg, cb, ms = 20000) {
  const { command, args } = sshCommand(m, `herdr-superwork remote ${what}${arg ? " " + b64(arg) : ""}`);
  let out = "", ended = false;
  const end = (j) => { if (!ended) { ended = true; clearTimeout(timer); try { cb(j); } catch {} } };
  const c = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
  const timer = setTimeout(() => { try { c.kill("SIGKILL"); } catch {} end(null); }, ms);
  c.on("error", () => end(null));
  c.stdout.on("data", (d) => { out += d; });
  c.on("close", () => { try { end(JSON.parse(out.trim().split("\n").pop() || "")); } catch { end(null); } });
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
  const c = S.config();
  return { folder: S.tilde(folder), tree: S.tilde(tree), branch: S.branchOf(tree || folder), choices: S.choices(t), config: { watcherAgent: c.watcherAgent, watcherModel: c.watcherModel }, fullAccess: fullAccess(t.agent || S.choices(t).agent), canWorktree: S.canWorktree(folder), worktree: c.worktree };
};
// `said`, `usage` and `agentVersion` ride along on each task; `version` is this side's plugin version (a machine on
// an older plugin sends none, and the asking side then knows which requests it would not understand). Pending
// hook events are this machine's own and are not sent (nor is `announced`, a marker older versions left on tasks).
export const remoteList = () => ({ host: os.hostname(), version: S.VERSION, tasks: F.board({ includeArchived: true }).map((t) => { const { live, announced, events, ...rest } = t; return { ...rest, snap: snapshot(t) }; }) });
export async function remoteMain([what, payload]) {
  const a = payload ? JSON.parse(Buffer.from(payload, "base64").toString("utf8")) : {};
  const say = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  try {
    if (what === "list") return say(remoteList());
    if (what === "do") {
      const A = await import("./actions.js");
      const t = S.find(a.id);
      const acts = {
        archive: () => { A.archive(t.id); return `${t.id}: archived. ? has undo, and the archive.`; },
        restore: () => { A.restore(t.id); return `${t.id}: restored`; },
        delegate: () => { A.delegate(t.id); return `${t.id}: an agent is on it`; },
        tell: () => A.tell(t.id, String(a.text || "")).msg,
        approve: () => A.approve(t.id, a.seen || null).msg,
        fix: () => A.sendFailure(t.id).msg,
        retry: () => A.sendError(t.id).msg,
        again: () => A.retry(t.id).msg,
        review: () => A.sendReview(t.id).msg,
        finish: () => A.finishAnyway(t.id).msg,
        pin: () => { A.pin(t.id); return ""; },
        seen: () => { A.seen(t.id); return ""; },
        stop: () => { A.stop(t.id); return `${t.id}: stopped.`; },
      };
      // Going into a task from another machine: reopen its space and restart its exited agent here first, with the
      // same function the local board calls, and answer with the pane to attach to.
      if (a.action === "reopen") { const D = await import("./delegate.js"); const r = D.reopen(t.id, { restart: true }); return say({ ok: true, msg: "", pane: r.pane.pane_id, hasAgent: r.hasAgent }); }
      if (a.action === "clear") { const out = await A.clear(t.id); return say({ ok: true, msg: out.kept.length ? `${t.id} deleted. Kept, so no work is lost: ${out.kept.join(", ")}` : `${t.id} deleted` }); }
      if (!acts[a.action]) return say({ ok: false, msg: `Unknown action ${a.action}` });
      return say({ ok: true, msg: acts[a.action]() });
    }
    if (what === "dispatch") {
      const C = await import("./coordinator.js");
      const cwd = a.about ? S.folderOf(a.about) : process.env.HOME || process.cwd();
      if (!C.ready()) {
        const A = await import("./actions.js");
        const [title, ...rest] = String(a.text || "").split("\n");
        const t = A.add(cwd, title, { description: rest.join("\n") });
        if (a.delegate) A.delegate(t.id);
        return say({ ok: true, msg: `${t.id}: filed${a.delegate ? ", an agent is on it" : ""}` });
      }
      // This machine's own Coordinator takes it, in its one conversation; its answer shows on this machine's board.
      C.send(cwd, String(a.text || ""), { delegate: !!a.delegate, about: a.about || null });
      return say({ ok: true, msg: `sent to ${os.hostname()}` });
    }
    say({ ok: false, msg: `Unknown request ${what}` });
  } catch (e) { say({ ok: false, msg: String((e && e.message) || e) }); }
}
