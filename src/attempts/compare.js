// The reviewer's comparison of the attempts that passed the check: it reads each one's change, says what is good and
// bad about each, names one and says why. A visible herdr agent in a tab of its own (`Picker`) in the task's space,
// as every reviewer is. With `attempts.pick reviewer` the one it names goes on by itself; with `you` its comparison
// stands on top of the attempts you choose from. For a research-only task it reads the reports instead, and, when it
// is the one who picks, also writes one report from all of them.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import * as F from "../flow.js";
import { claim, release, guardFor, sleep } from "../runner.js";
import { startArgs, preTrust, installed, roleOf, ownWords } from "../agents.js";
import { launchExtras, taskLine } from "../delegate.js";
import { settle as settleScreen, hand } from "../submit.js";
import { isResearch, reportFolder } from "../research.js";
import { REVIEWER_BOARD_RULE } from "../board-rule.js";
import { standingOf, agentWord } from "./words.js";
import { adopt } from "./adopt.js";
import { toPick } from "./settle.js";

const ms = (name, fallback) => (process.env[name] !== undefined ? Number(process.env[name]) : fallback);
export const compareDir = (t) => path.resolve(S.dirOf(t.id), "compare");
// What the reviewer is told. `passed`: the attempts to compare. `writes`: it also writes one report from all of them.
export function compareBrief(t, passed, { writes = false } = {}) {
  const dir = compareDir(t), research = isResearch(t);
  const one = (c) => [`Attempt ${c.letter}, by ${agentWord(c)}:`,
    research ? `  its report: ${reportFolder(c)}/` : `  worktree ${c.worktree}, branch ${c.branch}${c.stat ? ` (${c.stat})` : ""}`,
    research ? "" : `  its change: git -C ${c.worktree} diff ${c.syncedTo || c.baseSha || c.from || "HEAD"}...HEAD`,
    `  what its agent says it did: ${String(c.summary || c.said || "").replace(/\s+/g, " ").slice(0, 1200) || "nothing"}`].filter(Boolean).join("\n");
  return [
    `You compare ${passed.length} attempts at one task. Each was made by an agent of its own that did not see the others${research ? "" : ", in a worktree and on a branch of its own, and each passed the repo's check"}. One of them will be kept and the others thrown away: nothing of two attempts is ever put together${research ? " in the repo" : ""}. Your job is to say which one, and why.`,
    research ? "This task is research only: each attempt's whole result is a report. Read every report whole, and check what they claim where you can." : "Read each attempt's whole change and what surrounds it, and try each one: run it, look at what it does with the awkward inputs. Judge them against what was asked: which does all of it, correctly, with the least risk? A smaller change that does the job beats a larger one. Ignore taste and style.",
    "You are here to compare, not to fix. Change, commit, push and merge nothing, in any of the worktrees.",
    REVIEWER_BOARD_RULE,
    `Task: ${t.title}`, t.description ? `Details:\n${t.description.slice(0, 3000)}` : "",
    passed.map(one).join("\n\n"),
    writes ? `Then write one report from all of them: the best of each, what they agree on, and where they differ and which is right. Save it in ${reportFolder(t)}/ as index.html (one page that stands by itself) or report.md. It is the task's report; the attempts' own reports are kept beside it only until the task is done.` : "",
    `Last of all, save your answer as JSON in ${dir}/comparison.json, then stop. The board waits for that file. Its shape: {"pick": "<the letter of the attempt to keep: ${passed.map((c) => c.letter).join(" or ")}>", "why": "<two or three plain sentences: why that one>", "attempts": [{"letter": "<its letter>", "note": "<one or two sentences: what is good and what is bad about it>"}, ...]}`,
  ].filter(Boolean).join("\n\n");
}
// The answer as the board keeps it, or an error that says what is wrong with it.
export function readComparison(raw, letters) {
  const j = JSON.parse(raw), want = String(j.pick || "").trim().toUpperCase();
  if (!letters.includes(want)) throw new Error(`it named "${String(j.pick ?? "").slice(0, 20)}", which is none of ${letters.join(", ")}`);
  const line = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const notes = Object.fromEntries((Array.isArray(j.attempts) ? j.attempts : []).map((a) => [String(a?.letter || "").toUpperCase(), line(a?.note, 600)]).filter(([l, n]) => letters.includes(l) && n));
  return { pick: want, why: line(j.why, 1200), notes, at: Date.now() };
}

export async function compareJob(id) {
  let t = claim(id, "compare");
  if (!t || t.stage !== "reviewing" || !t.comparing) { if (t) release(id); return; }
  const g = guardFor(id);
  g.expect(t);
  let out = null;
  try { out = await compare(id, g, t); }
  catch (e) { out = e.aborted ? null : { error: `the comparison failed: ${String(e.message || e).replace(/\s+/g, " ").slice(0, 300)}` }; }
  await closePicker(id);
  // The runner lets go first: what follows (the chosen attempt's finish line) is a runner of its own.
  try { S.update(id, (t) => { if (t.runner?.pid !== process.pid) return false; t.runner = null; t.eventsHandled = t.eventSeq || 0; t.events = []; }, { waitMs: 10000 }); } catch {}
  if (!out) return;
  const now = S.get(id);
  if (!now || now.stage !== "reviewing" || !now.comparing) return;
  const comparison = { ...out, by: out.by || undefined };
  if (now.comparing.pick === "reviewer" && comparison.pick) {
    try { S.update(id, (t) => { t.comparison = comparison; t.comparing = null; }, { waitMs: 10000 }); adopt(id, comparison.pick, "reviewer"); return; }
    catch (e) { comparison.error = String(e.message || e); }
  }
  toPick(id, comparison, "reviewing");
}
async function closePicker(id) {
  const t = S.get(id);
  if (!t?.link?.reviewer?.pane) return;
  try { F.closeReviewerTab(F.h(t), t.link.reviewer); } catch {}
  try { S.update(id, (t) => { if (t.link) t.link = { ...t.link, reviewer: null }; }, { waitMs: 10000 }); } catch {}
}
async function compare(id, g, t) {
  const api = F.h(t), dir = compareDir(t), file = path.join(dir, "comparison.json");
  const passed = S.attemptsOf(t).filter((c) => standingOf(c) === "passed"), letters = passed.map((c) => c.letter);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const ch = S.work(t), who = roleOf("reviewer", (n) => ch[n]);
  let kind = who.kind, model = who.model, effort = who.effort;
  if (!installed(kind) && installed(passed[0].agent)) { kind = passed[0].agent; model = ""; effort = ""; }
  const writes = isResearch(t) && t.comparing.pick === "reviewer";
  const brief = `${taskLine(t, "reviewer", 0)}\n\n${compareBrief(t, passed, { writes })}${who.instructions ? `\n\n${ownWords(who.instructions)}` : ""}`;
  const cwd = passed[0].worktree && fs.existsSync(passed[0].worktree) ? passed[0].worktree : S.folderOf(t.id);
  preTrust(kind, S.folderOf(t.id), who.access);
  await closePicker(id);
  const workspace = t.link?.workspace;
  if (!workspace || !api.workspaceGet(workspace)) return { error: "the task's space is gone, so nobody compared the attempts" };
  const made = api.tabCreate({ workspace, cwd, label: F.PICKER_TAB, env: S.boardEnv() });
  const tab = made.tab?.tab_id || made.root_pane?.tab_id, pane = (made.root_pane || api.panes(workspace).find((p) => p.tab_id === tab))?.pane_id;
  if (!pane) { if (tab) api.tabClose(tab); return { error: "herdr opened no terminal for the comparison" }; }
  const taken = api.agents().map((a) => a.name).filter(Boolean);
  let name = `sw-${t.repo.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 16)}-${t.n}-pick`.slice(0, 32);
  if (taken.includes(name)) name = `${name.slice(0, 27)}-${String(Date.now() % 10000).padStart(4, "0")}`;
  const startedAt = Date.now(), x = launchExtras(t, "reviewer", { kind, round: 0 });
  g.set((t) => { t.link = { ...t.link, reviewer: { pane, tab, agent: name, kind } }; t.reviewSession = x.session; });
  const start = (hook) => {
    const args = startArgs(kind, { model, effort, fast: who.fast, access: who.access, session: x.session, extra: hook });
    try { api.agentStart(name, kind, pane, args); settleScreen(api, pane, [kind, ...args].join(" ")); }
    catch (e) { if (e.code === "agent_not_ready") return; if (!hook.length) throw e; start([]); }
  };
  start(x.hook);
  const until = Date.now() + ms("HERDR_SUPERWORK_REVIEW_MS", 20 * 60000), every = ms("HERDR_SUPERWORK_POLL_MS", 3000);
  let sent = false;
  for (;;) {
    g.check();
    if (fs.existsSync(file)) {
      await sleep(Math.min(every, 300)); // let the write complete
      try { return { ...readComparison(fs.readFileSync(file, "utf8"), letters), by: kind, wrote: writes || undefined }; }
      catch (e) { return { error: `the reviewer's comparison could not be read: ${String(e.message || e).replace(/\s+/g, " ").slice(0, 300)}`, by: kind }; }
    }
    if (Date.now() > until) return { error: "the comparison timed out", by: kind };
    // The reviewer's own turn-end report, and still no answer: it finished without one.
    const ended = S.pendingEvents(S.get(id)).find((e) => e.role === "reviewer" && !e.side && e.at >= startedAt);
    if (ended && sent) { await sleep(Math.min(every, 1500)); if (!fs.existsSync(file)) return { error: "the reviewer finished without naming an attempt", by: kind }; continue; }
    const a = api.agentGet(pane);
    if (!a && sent) return { error: "the reviewer exited without naming an attempt", by: kind };
    if (!a && !api.paneGet(pane)) return { error: "the reviewer's terminal was closed", by: kind };
    if (!sent && a && (a.agent_status === "idle" || a.agent_status === "done")) { try { hand(api, pane, brief); sent = true; } catch (e) { if (e.code !== "agent_blocked" && e.code !== "agent_not_ready") sent = true; } }
    await sleep(every);
  }
}
