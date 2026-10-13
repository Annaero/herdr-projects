// The one program. With no arguments it opens the board in the current terminal; the plugin's pane entrypoint runs
// the same program as the plugin's pane in herdr. The subcommands replace pi-work's `work` tool, so any agent can drive the
// board from its shell.
import fs from "node:fs";
import path from "node:path";
import * as S from "./store.js";
import { name as keyName } from "./board/keys.js";
import { isResearch } from "./research.js";

const HELP = `herdr-superwork: a work board for herdr

  herdr-superwork                     open the board here (in herdr: bind a key to the plugin action "open")
  herdr-superwork add <title> [--desc TEXT] [--repo NAME|PATH] [--delegate] [--<setting> VALUE ...] [--research|--no-research]
                                      (--research: research only, short for --research.only true. Its agent changes
                                       nothing in the repo; the result is a report. --no-research: not research only,
                                       where a default says it is)
  herdr-superwork list [--archived] [--all] [--query TEXT] [--json]
  herdr-superwork report <id> --state idle|working|blocked|done|error [--kind question|permission|auth] [--msg TEXT] [--title TEXT]
                         [--progress 0-100] [--eta MINUTES]   (your own task, with --state working: how far, and minutes left)
  herdr-superwork describe <id> <text>          write or replace a task's description
  (a title is at most 60 characters: a longer one is shortened at a word, its full text kept in the description)
  (an <id> is repo/134; where its repo has a short key, HSW-134 names the same task, in any letter case.
   A key: herdr-superwork set repo.key HSW --repo NAME)
  herdr-superwork delegate <id> [--<setting> VALUE ...] [--research|--no-research]
                                      any work setting, for this task only: --reviewer.agent claude --merge.by itself
                                      (a refused option changes nothing on the task)
  herdr-superwork tell <id> <text>              send a message to the task's agent
  herdr-superwork stop <id>                     stop its agent
  herdr-superwork approve <id> [--anyway]       merge finished work that waits for approval (--anyway: also when its review failed)
  herdr-superwork pick <id> <letter>            keep one of a task's several attempts (attempts.by); the others' tabs close
  herdr-superwork review <id>                   send the reviewer's findings back to the agent
  herdr-superwork retry <id>                    send the saved error back to the agent
  herdr-superwork fix <id>                      send failure details to the agent (never approves a merge)
  herdr-superwork finish <id>                   finish anyway, when the agent stopped without a summary
  herdr-superwork details <id>                  failure details, review and next steps
  herdr-superwork pin|archive|restore|clear <id>
  herdr-superwork set <name> <value> [--repo NAME | --task ID | --automation NAME]
                                      change a setting: for you, for your entry for one repo, for one task, or for an automation
  herdr-superwork unset <name> [--repo NAME | --task ID]
                                      back to what it would be without that answer
  herdr-superwork show [<id>] [--repo NAME]     every setting and the place it came from; without an id, your own
  herdr-superwork automations [add|show|change|on|off|run|firings|remove] …
                                      tasks made on a schedule or when something happens on the board; each firing adds
                                      a task and puts an agent on it. \`herdr-superwork automations help\` says how
  herdr-superwork coordinator                   the Coordinator (the agent behind the board's box): who it is, how it stands
  herdr-superwork coordinator tell <text> [--delegate]
                                                say something to it (it is started when it is not running); --delegate is
                                                the board's tab: what it adds from this message gets an agent at once
  herdr-superwork coordinator where             where the human was when they last wrote to it from the board (for the Coordinator itself)
  herdr-superwork coordinator restart           start its program again, in the same conversation
  herdr-superwork coordinator new [--agent KIND[/MODEL]] [--effort E]
                                                a fresh one; with options, that choice is for this one only
  herdr-superwork coordinator stop              close it; the next message starts it again where it left off (words still waiting go in then)
  herdr-superwork --skill                       instructions an agent can load
  herdr-superwork machines                      other machines: whether each answers, its version, or why not and what to do;
                                                and whether another machine could ask this one
  herdr-superwork web-ui [link|unlink]          the board inside the herdr web UI: how it stands; point the web UI's shared link at it, or back
  herdr-superwork remove-extras                 take out what the plugin added outside its own folders (the how-to
                                                files, its blocks in herdr's config); run it before unlinking
`;
// positional arguments, --flag value, --flag (true), --no-flag (false)
export function parse(argv) {
  const pos = [], flags = {};
  const BOOL = new Set(["json", "archived", "all", "delegate", "force", "help", "skill", "research", "every-repo", "anyway"]);
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
// Where the board is "in". Run as a command: the current folder. Run as the plugin's pane (the board key's tab,
// whose own working directory is the plugin folder): the folder of the pane you opened it from; for a worktree
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
// Is the caller the agent of a task? Its shell runs in the task's worker pane (or its reviewer's). The board's own
// pane is the plugin's and the Coordinator's pane belongs to no task, so neither is ever taken for a worker, even
// when the board was opened from a worker's pane.
function caller() {
  const pane = process.env.HERDR_PANE_ID, socket = process.env.HERDR_SOCKET_PATH;
  if (!pane || !socket || process.env.HERDR_PLUGIN_ID) return null;
  for (const t of S.list({ includeArchived: true, attempts: true })) { // an attempt of several is its own agent's task
    if (t.link?.socket !== socket) continue;
    if (t.link.pane === pane) return { task: t, role: "agent" };
    if (t.link.reviewer?.pane === pane) return { task: t, role: "reviewer" };
  }
  return null;
}
const callerTask = () => { const c = caller(); return c?.role === "agent" ? c.task : null; };
const line = (t) => `${t.id.padEnd(14)} ${String(t.state).padEnd(8)}${t.kind ? ` ${t.kind}` : ""}${t.shownApp ? ` [${t.shownApp}]` : ""}  ${t.title}${t.research ? " [research]" : ""}${t.note ? `  · ${t.note}` : ""}${t.archivedAt ? "  (archived)" : ""}`;
const brief = (t) => ({ id: t.id, state: t.state, kind: t.kind, app: t.shownApp, title: t.title, msg: t.note, stage: t.stage, progress: t.progress, eta: t.eta, pr: t.pr || undefined, research: t.research || undefined, archivedAt: t.archivedAt || undefined, review: S.currentReview(t) || undefined, reviewRound: S.reviewRound(t) || undefined });

export async function main(argv) {
  const { pos, flags } = parse(argv);
  const cmd = pos[0] || (flags.skill ? "--skill" : flags.help ? "help" : "board");
  // What a person reads names a task by its repo's short key where it has one (`HSW-134: updated`); --json keeps the ids.
  const out = (value, text) => process.stdout.write(flags.json ? JSON.stringify(value, null, 2) + "\n" : `${text === undefined || text === null ? JSON.stringify(value, null, 2) : S.sayIds(text)}\n`);
  const need = (n, what) => { if (!pos[n]) throw new Error(`${cmd} needs ${what}. Try: herdr-superwork help`); return pos[n]; };
  const rest = (n) => pos.slice(n).join(" ");
  S.homeAtStart(cmd); // an older version's folders move into the one home folder, once (store/move-home.js)
  // …and its settings into the new names, once (store/settings/migrate.js). Asking for help changes nothing.
  if (!["help", "--skill", "skill"].includes(cmd) && !flags.help) S.moveSettings();

  // ---- entries herdr itself calls: keep them light, they run on every agent status change -------------------------
  if (cmd === "turn-ended") { const { turnEnded } = await import("./turn.js"); try { turnEnded({ id: flags.id, role: flags.role, token: flags.token, round: flags.round }, pos.slice(1)); } catch {} return 0; } // run by an agent's own hook: silent, always 0
  if (cmd === "hook") { const { hookMain } = await import("./hook.js"); hookMain(); return 0; }
  if (cmd === "keeper") { const { keeperMain } = await import("./keeper.js"); await keeperMain(); return 0; }
  if (cmd === "keeper-work") { const { keeperWork } = await import("./keeper.js"); await keeperWork(); return 0; }
  if (cmd === "run") { const { runJob } = await import("./jobs.js"); await runJob(pos[1], pos[2], pos.slice(3).concat(flags.force ? ["--force"] : [])); return 0; }
  if (cmd === "open") { (await import("./board/place.js")).show(); return 0; }
  // Into the Coordinator's chat: herdr moves to its real pane, as for any agent. No board in between.
  if (cmd === "open-coordinator") { const C = await import("./coordinator.js"); try { await C.goIn(); } catch (e) { console.error(e.message); return 1; } return 0; }
  if (cmd === "approve-current") {
    // For the task that owns the focused pane, from the invocation context; does nothing otherwise.
    let pane = "";
    try { pane = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}").focused_pane_id || ""; } catch {}
    const { currentSocket } = await import("./herdr.js");
    const t = pane && S.list().find((t) => t.link?.socket === currentSocket() && (t.link.pane === pane || t.link.reviewer?.pane === pane));
    if (!t || t.stage !== "approval") return 0;
    // A merge cannot be undone and this action has no screen to ask on: the board opens on the task and asks first.
    const A = await import("./actions.js");
    try { A.askApprove(t.id, undefined, (await import("./board/place.js")).show(undefined, { keep: true })); } catch {}
    return 0;
  }
  if (cmd === "serve") { const { serveMain } = await import("./review-page.js"); await serveMain(); return 0; }
  if (cmd === "remote") { const { remoteMain } = await import("./remote.js"); await remoteMain(pos.slice(1)); return 0; }
  if (cmd === "--skill" || cmd === "skill") { const X = await import("./extras.js"); const F = await import("./flow.js"); process.stdout.write(X.skillText(F.shim())); return 0; }
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
      const { research, ...settings } = pickChoices(flags); // the task's own from the start, an agent on it or not
      const t = A.add(here, need(1, "a title") && rest(1), { description: flags.desc || flags.description || "", repo: flags.repo, research, settings, from: caller()?.task });
      // Added by the Coordinator from a message the human sent with tab: delegated here, flag or no flag.
      let tab = false;
      if (!flags.delegate && process.env.HERDR_PANE_ID && !process.env.HERDR_PLUGIN_ID) { try { tab = (await import("./coordinator.js")).tabTurn(process.env.HERDR_PANE_ID); } catch {} }
      if (flags.delegate || tab) A.delegate(t.id);
      result = [brief(shownOf(t.id)), `${t.id}: added${isResearch(t) ? " as research only" : ""}${flags.delegate || tab ? `, an agent is on it${tab ? ` (the message was sent with ${keyName("delegate")})` : ""}` : ""}${S.titleNote(rest(1))}`];
      break;
    }
    case "list": case "ls": {
      const q = String(flags.query || "").trim().toLowerCase(), keys = q ? S.repoKeys() : {}; // a task is found by its number and its tag too: 134, #134, hsw-134
      const all = F.board({ includeArchived: true }).filter((t) => (flags.archived ? t.archivedAt : flags.all || q || !t.archivedAt))
        .filter((t) => !q || `${S.tagOf(t.id, keys)} #${t.n} ${t.id} ${t.title} ${t.note || ""} ${t.state} ${t.shownApp || ""} ${t.description || ""}`.toLowerCase().includes(q));
      result = [all.map(brief), all.length ? all.map(line).join("\n") : "No tasks."];
      break;
    }
    // Suggested tasks were taken out of the board. An agent that was started before that, or whose task still asks
    // for "suggestions on this task", is told so in a plain sentence, with what to do instead.
    case "suggest": case "suggestions": case "accept": case "dismiss":
      throw new Error(`There is no "${cmd}" command any more: suggested tasks were removed from the board. Mention work you came across outside your task in a short "Also noticed" list in your closing note or your report, and carry on with your own task.`);
    case "report": {
      const me = callerTask();
      if (!pos[1] && flags.title && !me) { const t = A.add(here, flags.title, { description: flags.msg || flags.desc || "", repo: flags.repo }); result = [brief(shownOf(t.id)), `${t.id}: added${S.titleNote(flags.title)}`]; break; }
      const id = pos[1] || me?.id;
      if (!id) throw new Error("report needs an id, or --title to add a new task.");
      const target = S.find(id);
      const t = A.report(target.id, { state: flags.state, kind: flags.kind, msg: flags.msg, title: flags.title, progress: flags.progress, eta: flags.eta, asAgent: !!me && me.id === target.id });
      const what = [flags.title && "title", flags.state].filter(Boolean).join(", "); // what changed: "proj/1: updated (title, done)"
      result = [brief(shownOf(t.id)), me && me.id === t.id && flags.state === "blocked" ? "Reported: you are waiting, not finished, so no check and no review follow this stop. Stop now; the human's answer arrives as your next message." : `${t.id}: updated${what ? ` (${what})` : ""}${flags.title ? S.titleNote(flags.title) : ""}`];
      break;
    }
    case "describe": { const t = A.describe(need(1, "an id"), rest(2)); result = [brief(shownOf(t.id)), `${t.id}: updated (description)`]; break; }
    case "rename": { const t = A.rename(need(1, "an id"), rest(2)); result = [brief(shownOf(t.id)), `${t.id}: updated (title)`]; break; }
    case "delegate": { const t = A.delegate(need(1, "an id"), pickChoices(flags)); result = [brief(shownOf(t.id)), `${t.id}: ${t.stage === "attempts" ? `started, ${t.attempts.length} attempts at once (${t.attempts.map((a) => `${a.letter} ${a.agent}`).join(", ")})` : t.stage === "queued" ? "started, waiting for a free slot" : "started, an agent is on it"}`]; break; }
    case "tell": { const r = A.tell(need(1, "an id"), need(2, "the text") && rest(2)); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "stop": { const t = A.stop(need(1, "an id")); result = [brief(shownOf(t.id)), `${t.id}: stopped`]; break; }
    case "start": { const t = A.startHuman(need(1, "an id")); result = [brief(shownOf(t.id)), `${t.id}: in progress`]; break; }
    case "pick": { const r = A.pick(need(1, "an id"), pos[2] || ""); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "approve": { const r = A.approve(need(1, "an id"), null, { anyway: flags.anyway === true }); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "review": { const r = A.sendReview(need(1, "an id")); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "retry": { const r = A.sendError(need(1, "an id")); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "fix": { const r = A.sendFailure(need(1, "an id")); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "finish": { const r = A.finishAnyway(need(1, "an id")); result = [brief(shownOf(r.task.id)), r.msg]; break; }
    case "details": { const d = A.details(need(1, "an id")); result = [d, JSON.stringify(d, null, 2)]; break; }
    case "pin": { const t = A.pin(need(1, "an id")); result = [brief(shownOf(t.id)), `${t.id}: ${t.pinned ? "pinned" : "unpinned"}`]; break; }
    case "archive": { const t = A.archive(need(1, "an id")); result = [brief(shownOf(t.id)), `${t.id}: archived`]; break; }
    case "restore": case "unarchive": { const t = A.restore(need(1, "an id")); result = [brief(shownOf(t.id)), `${t.id}: restored`]; break; }
    case "clear": { const r = await A.clear(need(1, "an id")); result = [r, r.kept.length ? `${r.id}: removed. Kept, so no work is lost: ${r.kept.join(", ")}` : `${r.id}: removed`]; break; }
    case "set": case "unset": case "show": { result = (await import("./actions/settings.js")).settingsCommand(cmd, pos, flags, rest); break; }
    case "automations": case "automation": { result = (await import("./automations/command.js")).automationsCommand(pos.slice(1), flags, here); break; }
    case "coordinator": {
      const C = await import("./coordinator.js");
      const what = pos[1] || "status";
      const said = { tell: "sent to the Coordinator", restart: "the Coordinator is restarting, in the same conversation", new: "a new Coordinator is starting", stop: "the Coordinator is stopped; the next message starts it again" };
      if (what === "where") { result = [{ where: C.get()?.where || [] }, C.where()]; break; }
      if (what === "tell") C.send(here, need(2, "the text") && rest(2), { delegate: !!flags.delegate });
      else if (what === "restart") C.restart();
      else if (what === "new" || what === "fresh") C.fresh(C.pickOf({ agent: flags.agent, effort: flags.effort }));
      else if (what === "stop") C.stop();
      else if (what !== "status") throw new Error("coordinator takes: tell <text>, where, restart, new, stop. Try: herdr-superwork help");
      const s = C.summary();
      result = [s, said[what === "fresh" ? "new" : what] || `Coordinator: ${s.state} · ${[s.agent, s.model || "default model", s.effort || "default effort"].join(" · ")}${s.oneOff ? " (for this one only)" : ""} · default: ${s.default}${s.error ? `\n${s.error}` : ""}${s.said ? `\n\n${s.said}` : ""}`];
      break;
    }
    case "machines": { const M = await import("./remote/check.js"); const r = await M.check(); result = [r, M.say(r)]; break; }
    case "web-ui": { const W = await import("./webui/command.js"); const r = await W.main(pos.slice(1), { json: !!flags.json }); if (!r.ok) throw new Error(r.msg); result = [r, r.msg]; break; }
    case "remove-extras": { const X = await import("./extras.js"); const web = await X.removeWebUi(); const r = { ...X.removeExtras(), webUi: web.n }; result = [r, `Removed: the how-to files${r.blocks ? " and the plugin's blocks in herdr's config (a backup is beside it)" : ""}. The how-to is not written again and the key question will not be asked again.${web.n || !web.ok ? ` ${web.msg}` : ""}`]; break; }
    case "reopen": { const D = await import("./delegate.js"); const r = D.reopen(need(1, "an id"), { restart: true }); result = [{ pane: r.pane.pane_id, hasAgent: r.hasAgent }, `${r.task.id}: its space is open${r.hasAgent ? "" : ", no agent in it"}`]; break; }
    case "housekeep": { housekeeping(undefined, { force: flags.pr ? "pr" : true }); result = [{ ok: true }, "ok"]; break; }
    default: throw new Error(`Unknown command "${cmd}". Try: herdr-superwork help`);
  }
  out(...result);
  try { housekeeping(); } catch {}
  return 0;
}
// The options of add and delegate that are the task's own settings: every --<setting> (a name with a dot), and
// --research / --no-research, the short form of research.only. Any other option is refused there.
function pickChoices(flags) {
  const o = {};
  for (const [k, v] of Object.entries(flags)) if (k.includes(".")) o[k] = v;
  if (flags.research !== undefined) o.research = flags.research === true;
  return o;
}
export const pluginRoot = () => path.resolve(S.ROOT);
