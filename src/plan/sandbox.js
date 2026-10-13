// While a plan waits for its yes, its writer's program runs where the task's worktree is mounted read-only: a barrier the program cannot take off.
// Read-only files (lock.js) keep a careless write out, but a program that runs as you can give itself the write
// permission back. So the program is started inside a mount of its own (bubblewrap: `bwrap --ro-bind`), in which
// the task's worktree and its git folder are a read-only file system: a write, a chmod, a delete or a commit there
// is answered "Read-only file system", whatever the program's own access. Everything else is as on the machine
// (the board's own folder, where the plan is saved, stays writable). It is the board that starts the program, so
// herdr's `agent start` is not used for it: the command is run in the pane, and herdr finds the agent there by
// itself (checked on herdr 0.9.3 with bubblewrap 0.9: `agent get` answers, with its status). After the yes the
// program is ended and started again the usual way, outside that mount, in the same conversation.
// What it is not: a wall against a program that sets out to get around it (one that asks herdr to run a command in
// another pane, say). It stops every write made the ordinary way, and the board's look afterwards (untouched.js)
// stays as it was. Where bubblewrap is missing or may not be used, no plan is written in a repo at all: the task
// does not start, and says what is missing (plan/build.js: begin). A lesser guard is never taken for this one.
// The mount is made for the task's own worktree and, for a task with no worktree, for your checkout: read-only
// there only for the program inside the mount, never for you.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as S from "../store.js";
import { open } from "../plan.js";
import { gitDirOf } from "./lock.js";

// Can a read-only mount be made here? Asked once in a while: `HERDR_SUPERWORK_SANDBOX` says it outright (bwrap, none).
let known = null;
export function sandboxOk() {
  const said = process.env.HERDR_SUPERWORK_SANDBOX;
  if (said) return said !== "none";
  if (known && Date.now() - known.at < 600000) return known.ok;
  const file = path.join(S.dataDir(), "sandbox.json"), kept = S.readJson(file);
  if (kept && Date.now() - kept.at < 600000) return (known = kept).ok;
  let ok = false;
  try { ok = spawnSync("bwrap", ["--dev-bind", "/", "/", "--ro-bind", S.dataDir(), S.dataDir(), "--", "true"], { stdio: "ignore", timeout: 8000 }).status === 0; } catch {}
  known = { ok, at: Date.now() };
  try { S.writeJson(file, known); } catch {}
  return ok;
}
const q = (s) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);
// The folder that may not change: the task's own worktree, or the checkout it works in. "" for a folder that is no repo.
export const guarded = (t) => { const dir = t ? S.cwdOf(t) : ""; return dir && fs.existsSync(dir) && S.isRepo(dir) ? dir : ""; };
// Does this task's plan writer run in such a mount? In a repo, while the step is open.
export const boxed = (t) => open(t) && !!guarded(t) && sandboxOk();
// What a task says when a plan is asked for in a repo and no such mount can be made here.
export const NO_MOUNT = "This task starts with a plan (plan.approve), and its writer must run where the repo cannot be written: that needs bubblewrap (the `bwrap` program, with user namespaces allowed), which is missing or not usable on this machine. Nothing was started. Install it (for example: sudo apt install bubblewrap), or take the plan off for this task: herdr-superwork set plan.approve none --task <id>.";
// The command that starts a program there. The name it would have had from `agent start` rides along.
export function boxedCommand(t, name, kind, args) {
  const tree = guarded(t), git = gitDirOf(tree); // a worktree's git folder is elsewhere (the repo's own .git/worktrees); a checkout's is inside it
  return ["env", `HERDR_SUPERWORK_AGENT=${name}`, "bwrap", "--dev-bind", "/", "/", "--ro-bind", tree, tree, ...(git ? ["--ro-bind", git, git] : []), "--die-with-parent", "--", kind, ...args].map(q).join(" ");
}
// Start an agent program in a pane: in the read-only mount while the task's plan waits, else as herdr starts one.
// Answers and fails as `agent start` does: a program whose start-up dialog is in the way is "agent_not_ready".
export function startProgram(api, t, name, kind, pane, args) {
  if (open(t) && guarded(t) && !sandboxOk()) throw new Error(NO_MOUNT.replace("<id>", t.id)); // never a plan writer in a repo without it
  if (!boxed(t)) return api.agentStart(name, kind, pane, args);
  api.paneRun(pane, boxedCommand(t, name, kind, args));
  const step = Number(process.env.HERDR_SUPERWORK_READY_STEP_MS ?? 250);
  for (const until = Date.now() + 60000; ; ) {
    const a = api.agentGet(pane);
    if (a && a.agent_status === "blocked") throw Object.assign(new Error(`agent ${name} is blocked during startup and is not ready for prompts`), { code: "agent_not_ready" });
    if (a) return a;
    if (Date.now() >= until) throw new Error(`${kind} did not start in its read-only mount (bwrap). Look at the pane; HERDR_SUPERWORK_SANDBOX=none starts it without one.`);
    if (step > 0) S.sleepSync(step);
  }
}
