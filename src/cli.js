// The one program. With no arguments it opens the board in the current terminal; the plugin's pane entrypoint runs
// the same program as a herdr popup. The subcommands replace pi-work's `work` tool, so any agent can drive the
// board from its shell.
import fs from "node:fs";
import path from "node:path";
import * as S from "./store.js";

const HELP = `herdr-superwork: a work board for herdr

  herdr-superwork                     open the board here (in herdr: bind a key to the plugin action "open")
  herdr-superwork add <title> [--desc TEXT] [--repo NAME|PATH] [--delegate]
  herdr-superwork list [--archived] [--all] [--query TEXT] [--json]
  herdr-superwork report <id> --state idle|working|blocked|done|error [--kind question|permission|auth] [--msg TEXT] [--title TEXT]
  herdr-superwork describe <id> <text>          write or replace a task's description
  herdr-superwork delegate <id> [--agent KIND] [--model M] [--effort E] [--reviewer KIND|off] [--no-worktree] [--base head|fresh]
  herdr-superwork tell <id> <text>              send a message to the task's agent
  herdr-superwork stop <id>                     stop its agent
  herdr-superwork approve <id>                  merge finished work that waits for approval
  herdr-superwork review <id>                   send the reviewer's findings back to the agent
  herdr-superwork retry <id>                    send the saved error back to the agent
  herdr-superwork fix <id>                      send failure details to the agent (never approves a merge)
  herdr-superwork finish <id>                   finish anyway, when the agent stopped without a summary
  herdr-superwork details <id>                  failure details, review and next steps
  herdr-superwork pin|archive|restore|clear <id>
  herdr-superwork config [key [value]] [--id ID]   show or change settings; with --id, one task's own choice
  herdr-superwork --skill                       instructions an agent can load
`;
const SKILL = `# herdr-superwork: the work board

The human keeps one list of tasks on a board. You can read and change it from your shell with \`herdr-superwork\`.
Every command accepts \`--json\`.

- \`herdr-superwork list\`: the tasks: id (\`<repo>/<number>\`), state (idle, working, blocked, done, error), who is on it, title.
  \`--query TEXT\` searches, \`--archived\` shows the archive, \`--all\` includes it.
- \`herdr-superwork add "<short title>" --desc "<full description>"\`: file a new task in the current repo
  (\`--repo <name or path>\` for another). Filing starts nothing. Add \`--delegate\` only if the human asked for an agent.
- \`herdr-superwork delegate <id>\`: put an agent on a task. It works in its own git worktree, as an ordinary herdr
  agent in its own herdr space. Options for this one task: \`--agent claude|codex|…\`, \`--model\`, \`--effort\`,
  \`--reviewer <kind>|off\`, \`--no-worktree\` (work in the human's checkout), \`--base head\` (start from their current commit).
- \`herdr-superwork tell <id> "<text>"\`: send a message to a task's agent.
- \`herdr-superwork report <id> --state <state> [--msg "<one line>"]\`: say where a task stands. \`--title\` renames it.
  \`herdr-superwork describe <id> "<text>"\` replaces its description.
- \`herdr-superwork approve <id>\`: merge finished work that waits for approval. Only when the human plainly says so.
- \`herdr-superwork review <id>\` sends the reviewer's findings back to the agent; \`retry <id>\` sends a saved error back;
  \`fix <id>\` sends failure details; \`details <id>\` reads them; \`stop <id>\` stops the agent.
- \`herdr-superwork archive <id>\` hides a task and keeps everything; \`restore <id>\` brings it back; \`clear <id>\` deletes it
  (only when the human plainly asks).
- \`herdr-superwork config\` shows the settings; \`config <key> <value>\` changes one; \`config <key> <value> --id <id>\` sets it
  for one task (agent, model, effort, reviewer, reviewerModel, reviewerEffort, watcher, review, reviewAuto, rounds,
  artifacts, serve, conflictAuto).

If you are the agent working on a task: do the work yourself, commit on your branch, never push or merge. Before you
stop, write your closing summary (or your question) to \`.herdr-superwork/closing-<number>.md\` in your folder. If you
cannot continue until the human does something, run
\`herdr-superwork report <id> --state blocked --kind question|permission|auth --msg "<why>"\` and stop.
You cannot mark your own task done: the board runs the check, the review and the merge.
`;

// positional arguments, --flag value, --flag (true), --no-flag (false)
export function parse(argv) {
  const pos = [], flags = {};
  const BOOL = new Set(["json", "archived", "all", "delegate", "force", "help", "skill", "worktree", "no-worktree"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith("--") && a.length > 2) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) flags[name] = a.slice(eq + 1);
      else if (name.startsWith("no-")) flags[name.slice(3)] = false;
      else if (BOOL.has(name) || i + 1 >= argv.length || argv[i + 1].startsWith("--")) flags[name] = true;
      else flags[name] = argv[++i];
    } else pos.push(a);
  }
  return { pos, flags };
}
// Where the board is "in". Run as a command: the current folder. Run as the plugin popup (whose own working
// directory is the plugin folder and which gets no pane id): the folder of the pane underneath; for a worktree
// workspace, its primary repo.
export function contextFolder() {
  if (process.env.HERDR_PLUGIN_ID) {
    try {
      const c = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}");
      const dir = c.worktree?.repo_root || c.focused_pane_cwd || c.workspace_cwd;
      if (dir && fs.existsSync(dir)) return dir;
    } catch {}
    return process.env.HOME || process.cwd();
  }
  return process.cwd();
}
// Is the caller the agent of a task? Its shell runs in the task's worker pane.
function callerTask() {
  const pane = process.env.HERDR_PANE_ID, socket = process.env.HERDR_SOCKET_PATH;
  if (!pane || !socket || process.env.HERDR_PLUGIN_ID) return null;
  return S.list({ includeArchived: true }).find((t) => t.link?.pane === pane && t.link?.socket === socket) || null;
}
const line = (t) => `${t.id.padEnd(14)} ${String(t.state).padEnd(8)}${t.kind ? ` ${t.kind}` : ""}${t.shownApp ? ` [${t.shownApp}]` : ""}  ${t.title}${t.note ? `  · ${t.note}` : ""}${t.archivedAt ? "  (archived)" : ""}`;
const brief = (t) => ({ id: t.id, state: t.state, kind: t.kind, app: t.shownApp, title: t.title, msg: t.note, stage: t.stage, progress: t.progress, pr: t.pr || undefined, archivedAt: t.archivedAt || undefined, review: S.currentReview(t) || undefined });

export async function main(argv) {
  const { pos, flags } = parse(argv);
  const cmd = pos[0] || (flags.skill ? "--skill" : flags.help ? "help" : "board");
  const out = (value, text) => process.stdout.write(flags.json ? JSON.stringify(value, null, 2) + "\n" : `${text ?? JSON.stringify(value, null, 2)}\n`);
  const need = (n, what) => { if (!pos[n]) throw new Error(`${cmd} needs ${what}. Try: herdr-superwork help`); return pos[n]; };
  const rest = (n) => pos.slice(n).join(" ");

  // ---- entries herdr itself calls: keep them light, they run on every agent status change -------------------------
  if (cmd === "hook") { if (!S.hasTasks()) return 0; const { hookMain } = await import("./hook.js"); hookMain(); return 0; }
  if (cmd === "run") { const { runJob } = await import("./jobs.js"); await runJob(pos[1], pos[2], pos.slice(3).concat(flags.force ? ["--force"] : [])); return 0; }
  if (cmd === "open") { const { herdr } = await import("./herdr.js"); herdr().openBoard(); return 0; }
  if (cmd === "approve-current") {
    // Approves the task that owns the focused pane, from the invocation context; does nothing otherwise.
    let pane = "";
    try { pane = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}").focused_pane_id || ""; } catch {}
    const { currentSocket, herdr } = await import("./herdr.js");
    const t = pane && S.list().find((t) => t.link?.socket === currentSocket() && (t.link.pane === pane || t.link.reviewer?.pane === pane));
    if (!t || t.stage !== "approval") return 0;
    const A = await import("./actions.js");
    try { const r = A.approve(t.id); herdr().notify(r.msg, ""); } catch (e) { herdr().notify("Could not approve", e.message); }
    return 0;
  }
  if (cmd === "serve") { const { serveMain } = await import("./review-page.js"); await serveMain(); return 0; }
  if (cmd === "remote") { const { remoteMain } = await import("./remote.js"); await remoteMain(pos.slice(1)); return 0; }
  if (cmd === "--skill" || cmd === "skill") { process.stdout.write(SKILL); return 0; }
  if (cmd === "help" || flags.help) { process.stdout.write(HELP); return 0; }
  if (cmd === "board") {
    if (!process.stdout.isTTY || !process.stdin.isTTY) { process.stdout.write(HELP); return 0; }
    const { openBoard } = await import("./board/main.js");
    await openBoard({ folder: contextFolder() });
    return 0;
  }

  const A = await import("./actions.js");
  const F = await import("./flow.js");
  const { housekeeping } = await import("./housekeeping.js");
  const here = contextFolder();
  const shownOf = (id) => F.board({ includeArchived: true }).find((t) => t.id === id);
  let result;
  switch (cmd) {
    case "add": case "new": {
      const t = A.add(here, need(1, "a title") && rest(1), { description: flags.desc || flags.description || "", repo: flags.repo });
      if (flags.delegate) A.delegate(t.id, pickChoices(flags));
      result = [brief(shownOf(t.id)), `${t.id}: filed${flags.delegate ? ", an agent is on it" : ""}`];
      break;
    }
    case "list": case "ls": {
      const q = String(flags.query || "").trim().toLowerCase();
      const all = F.board({ includeArchived: true }).filter((t) => (flags.archived ? t.archivedAt : flags.all || q || !t.archivedAt))
        .filter((t) => !q || `${t.id} ${t.title} ${t.note || ""} ${t.state} ${t.shownApp || ""} ${t.description || ""}`.toLowerCase().includes(q));
      result = [all.map(brief), all.length ? all.map(line).join("\n") : "No tasks."];
      break;
    }
    case "report": {
      const me = callerTask();
      if (!pos[1] && flags.title && !me) { const t = A.add(here, flags.title, { description: flags.msg || flags.desc || "", repo: flags.repo }); result = [brief(shownOf(t.id)), `${t.id}: filed`]; break; }
      const id = pos[1] || me?.id;
      if (!id) throw new Error("report needs an id, or --title to file a new task.");
      const target = S.find(id);
      const t = A.report(target.id, { state: flags.state, kind: flags.kind, msg: flags.msg, title: flags.title, progress: flags.progress, asAgent: !!me && me.id === target.id });
      result = [brief(shownOf(t.id)), me && me.id === t.id && flags.state === "blocked" ? "Reported. Stop now; the human's answer arrives as your next message." : `${t.id}: ${flags.state || "updated"}`];
      break;
    }
    case "describe": { const t = A.describe(need(1, "an id"), rest(2)); result = [brief(shownOf(t.id)), `${t.id}: description saved`]; break; }
    case "rename": { const t = A.rename(need(1, "an id"), rest(2)); result = [brief(shownOf(t.id)), `${t.id}: renamed`]; break; }
    case "delegate": { const t = A.delegate(need(1, "an id"), pickChoices(flags)); result = [brief(shownOf(t.id)), `${t.id}: ${t.stage === "queued" ? "waiting for a free slot" : "an agent is on it"}`]; break; }
    case "tell": { const r = A.tell(need(1, "an id"), need(2, "the text") && rest(2)); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "stop": { const t = A.stop(need(1, "an id")); result = [brief(shownOf(t.id)), `${t.id}: stopped`]; break; }
    case "start": { const t = A.startHuman(need(1, "an id")); result = [brief(shownOf(t.id)), `${t.id}: in progress`]; break; }
    case "approve": { const r = A.approve(need(1, "an id")); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "review": { const r = A.sendReview(need(1, "an id")); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "retry": { const r = A.sendError(need(1, "an id")); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "fix": { const r = A.sendFailure(need(1, "an id")); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "finish": { const r = A.finishAnyway(need(1, "an id")); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "details": { const d = A.details(need(1, "an id")); result = [d, JSON.stringify(d, null, 2)]; break; }
    case "pin": { const t = A.pin(need(1, "an id")); result = [brief(shownOf(t.id)), `${t.id}: ${t.pinned ? "pinned" : "unpinned"}`]; break; }
    case "archive": { const t = A.archive(need(1, "an id")); result = [brief(shownOf(t.id)), `${t.id}: archived`]; break; }
    case "restore": case "unarchive": { const t = A.restore(need(1, "an id")); result = [brief(shownOf(t.id)), `${t.id}: restored`]; break; }
    case "clear": { const r = await A.clear(need(1, "an id")); result = [r, r.kept.length ? `${r.id} cleared. Kept, so no work is lost: ${r.kept.join(", ")}` : `${r.id} cleared`]; break; }
    case "config": {
      const id = flags.id;
      const value = pos.length > 2 ? rest(2) : undefined;
      const c = id ? (pos[1] && value !== undefined ? S.setTaskConfig(S.find(id).id, pos[1], value) : S.choices(S.find(id)))
        : pos[1] && value !== undefined ? S.setConfig(pos[1], value) : S.config();
      result = [pos[1] && value === undefined ? { [pos[1]]: c[pos[1]] } : c];
      break;
    }
    case "housekeep": { housekeeping(undefined, { force: flags.pr ? "pr" : true }); result = [{ ok: true }, "ok"]; break; }
    default: throw new Error(`Unknown command "${cmd}". Try: herdr-superwork help`);
  }
  out(...result);
  try { housekeeping(); } catch {}
  return 0;
}
function pickChoices(flags) {
  const o = {};
  for (const k of S.PER_TASK) if (flags[k] !== undefined) o[k] = flags[k];
  if (flags.worktree === false) o.worktree = false; else if (flags.worktree === true) o.worktree = true;
  if (flags.base) o.base = flags.base;
  return o;
}
export const pluginRoot = () => path.resolve(S.ROOT);
