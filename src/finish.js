// The finish line: commit, check, push, draft pull request, review, then the approval gate. Never merges by itself
// unless the repo says "land": "auto". Runs in a detached runner, started by the event hook when herdr says the
// agent stopped, so it works with the board closed.
import fs from "node:fs";
import path from "node:path";
import * as S from "./store.js";
import * as F from "./flow.js";
import { readScreen } from "./herdr.js";
import { claim, release, guardFor, sh, sleep, outputOf } from "./runner.js";
import { startArgs, preTrust, adapter, readTurnOf, versionOf, installed } from "./agents.js";
import { whyStopped } from "./turn.js";
import { launchExtras, taskLine } from "./delegate.js";
import { publishReview } from "./review-page.js";
import * as G from "./gate.js";
import * as Y from "./sync.js";

const ms = (name, fallback) => (process.env[name] !== undefined ? Number(process.env[name]) : fallback);
const lastLines = (text, n = 12) => String(text || "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-n).join("\n");
const firstLine = (text) => String(text || "").split("\n").find((l) => l.trim())?.trim() || "";
export const approvalMessage = (t, note = "") => {
  const rv = S.currentReview(t);
  const kept = rv?.keptAt && rv.kept ? ` ${S.keptWords(rv.kept, S.reviewHistory(t).at(-1)?.round).replace(/^r/, "R")}.` : "";
  return `Approve to merge?${rv ? ` ${G.sentence(rv)}` : ""}${kept} ${firstLine(t.summary) || "The work is finished."}${note}`;
};
function fail(g, failure, extra = {}) {
  const t = g.set((t) => { t.stage = "failed"; t.msg = failure.msg || failure.title; t.mergeIntent = extra.keepIntent ? t.mergeIntent : null; Object.assign(t, S.failurePatch(failure), extra.patch || {}); });
  F.labelPane(t, null);
  return t;
}

// ---- job: the agent's turn ended ----------------------------------------------------------------------------------------
// Started two ways. By the agent's own turn-end hook (`turn-ended`): a definite stop, judged here from the saved
// conversation. Or by herdr's status hook, the hook-less route: herdr's "idle" is a guess from the screen, so it alone
// never finishes a task. `force`: the status hook already decided a turn ended (missed-turn recovery).
// A finish runner that finds another unhandled event when it is done keeps its marker and processes that one too.
export async function finishJob(id, opts = {}) {
  for (let first = true; ; first = false) {
    if (!(await finishOnce(id, first ? opts : {}))) return;
    if (!release(id, { keep: true })) return;
  }
}
const IGNORES = ["todo", "progress", "done", "queued", "starting", "setup"];
const newer = (turn, t) => !!turn && turn.pos > (t.handled?.pos || 0);
// What the status hook does when the human's turn ended without it seeing the start: the old approval, review and
// counters no longer describe the work.
function humanTurn(t) {
  if (t.mergeIntent || t.stage === "approval") t.requireApproval = true;
  t.mergeIntent = null;
  if (t.review && !t.review.stale) t.review = { ...t.review, stale: true };
  t.checkFails = 0; t.reviewRounds = 0; t.prRounds = 0; t.syncRepairs = 0;
  t.armedAt = t.handled?.at || t.armedAt || 0; t.expectedWake = null; t.turnOpen = false;
  t.stage = "working"; t.msg = ""; t.kind = undefined; t.mergeFailed = false;
  if (t.failure?.auth) t.failure = null;
}
async function finishOnce(id, { force = false } = {}) {
  let t = S.get(id);
  if (!t || !F.isAgentTask(t)) return false;
  const kind = t.agent, ver = versionOf(kind);
  const mine0 = (e) => e.role === "agent" && !(e.side && e.session !== t.session);
  // 1. Without an event, give herdr's screen guess time to correct itself.
  if (!S.pendingEvents(t).some(mine0)) await sleep(ms("HERDR_SUPERWORK_SETTLE_MS", 5000));
  let ev = null, mine = false;
  t = S.update(id, (t) => {
    if (t.runner && t.runner.pid !== process.pid && S.markerAlive(t.runner)) return false;
    const pending = S.pendingEvents(t);
    ev = pending.filter((e) => e.role === "agent" && !(e.side && e.session !== t.session)).pop() || null;
    if (!pending.length && (t.stage !== "working" || t.archivedAt)) return false;
    // Every event up to here is now judged: accepted below, or dropped as a repeat, a side chat or a stale round.
    if (pending.length) { t.eventsHandled = Math.max(...pending.map((e) => e.n)); t.events = []; }
    if (t.archivedAt || (ev ? IGNORES.includes(t.stage) || (t.stage === "stopped" && ev.at < (t.stoppedAt || 0) + 3000) : t.stage !== "working")) return;
    mine = true;
    t.runner = S.marker({ job: "finish" });
  }, { waitMs: 10000 });
  if (!mine) return false;
  const api = F.h(t);
  const g = guardFor(id);
  try {
    const a = api.agentGet(t.link.pane);
    const comp = a?.completion_seq ?? null, seq = a?.state_change_seq ?? null, term = a?.terminal_id ?? null;
    const note = F.noteStat(t);
    const freshNote = note && note.mtime > (t.armedAt || 0) && note.mtime !== t.handled?.note ? note : null;
    let turn = null;
    if (ev) {
      // 2a. The agent said its turn ended. The hook can fire before the last message is on disk: re-read for up to
      //     ten seconds until the file shows something newer than the last handled turn.
      const src = { file: ev.file || null, session: ev.session || t.session, cwd: S.cwdOf(t) };
      for (const until = Date.now() + ms("HERDR_SUPERWORK_READ_MS", 10000); ; ) {
        turn = readTurnOf(kind, src);
        if (newer(turn, t) && (turn.finished || turn.error)) break;
        if (Date.now() >= until) break;
        await sleep(400);
      }
      if (adapter(kind).readTurn) S.countMark(`reader:${kind}`, ver, !!turn);
      S.countMark(`hook:${kind}`, ver, true);
      if (turn && !(newer(turn, t) && ((turn.finished && turn.id !== t.handled?.msg) || turn.error))) return true; // a repeat, or an earlier turn
      if (t.selfBlocked && t.stage === "asks") { // it reported itself blocked, then stopped: that is not a finish
        S.update(id, (t) => { t.handled = { ...(t.handled || {}), comp, seq, term, at: Date.now(), msg: turn?.id ?? t.handled?.msg ?? null, pos: turn?.pos ?? t.handled?.pos ?? 0 }; t.selfBlocked = null; t.turnOpen = false; if (turn?.said) t.said = turn.said; if (ev.session) t.session = ev.session; }, { waitMs: 10000 });
        return true;
      }
      // A turn that ended in a stage other than "working" was the human's, typed in the agent's own terminal.
      if (t.stage !== "working") { t = S.update(id, (t) => { humanTurn(t); }, { waitMs: 10000 }); F.labelPane(t, null); await closeReviewer(id); }
    } else {
      // 2b. The hook-less route: no event (a crash, a kind without a hook, a hook marked not working).
      if (a && (a.agent_status === "working" || a.agent_status === "blocked")) return true;
      let session = t.session;
      if (!session && adapter(kind).findSession) { session = adapter(kind).findSession(S.cwdOf(t), t.startedAgentAt || t.armedAt || 0, taskLine(t)); if (session) S.update(id, { session }, { waitMs: 10000 }); }
      turn = readTurnOf(kind, { file: t.transcript || null, session, cwd: S.cwdOf(t) });
      const says = newer(turn, t) && turn.pos > (t.armedAt || 0) && ((turn.finished && turn.id !== t.handled?.msg) || turn.error);
      if (!a) { if (!(says && turn.error)) return true; } // the agent exited: reconcile shows that; a crash still shows its real last error
      else if (!says) {
        if (turn && turn.finished && turn.id === t.handled?.msg && !freshNote) { S.update(id, (t) => { t.handled = { ...(t.handled || {}), comp }; }, { waitMs: 10000 }); return true; } // a late "idle" for a turn already handled
        if (a.agent_status === "unknown" && !freshNote) return true; // herdr cannot tell, and nothing says it stopped
        if (!force && (a.agent_status === "unknown" || comp == null ? !freshNote : comp === t.handled?.comp && !freshNote)) return true;
        turn = turn && newer(turn, t) && turn.interrupted ? turn : null;
      } else if (turn.finished) {
        // The file must have stood still through the settle wait: a message followed by more work is not the end.
        const again = readTurnOf(kind, { file: turn.file });
        if (!again || again.id !== turn.id || again.pos !== turn.pos) return true;
        if (t.hooked) S.countMark(`hook:${kind}`, ver, false);
      }
    }
    g.expect(t);
    // 3. What the agent said, and why it stopped.
    const wake = t.expectedWake;
    const handled = { comp, seq, term, note: freshNote ? freshNote.mtime : t.handled?.note ?? null, at: Date.now(), msg: turn?.id ?? t.handled?.msg ?? null, pos: turn?.pos ?? t.handled?.pos ?? 0 };
    const keep = (t) => { t.handled = handled; t.turnOpen = false; t.turnBy = null; F.seeTerminal(t, term); if (turn) { if (turn.said) t.said = turn.said; if (turn.usage) t.usage = turn.usage; if (turn.model) t.model = turn.model; t.transcript = turn.file; } if (ev?.session) t.session = ev.session; };
    if (turn && (turn.error || turn.stop === "length" || turn.stop === "refusal")) {
      const why = turn.error || (turn.stop === "length" ? "The agent's reply was cut off: it ran out of room (context or output limit)." : "The model refused to continue.");
      g.set(keep);
      fail(g, { stage: "agent", auth: turn.error ? turn.auth : false, agentCanFix: true, title: turn.auth ? "Needs a login" : "Agent stopped", msg: turn.auth ? "Needs a login" : `Agent stopped: ${S.oneLine(why, 200)}`, detail: `${why}${turn.said && turn.said !== why ? `\n\nIts last message:\n${turn.said}` : ""}`, next: "Fix what it reports, then reply or press ctrl+r to tell the agent to continue." });
      return true;
    }
    const finished = !!turn?.finished;
    if (!finished && !freshNote && !wake) {
      // Nothing says the turn finished normally (interrupted, a crash, an unreadable conversation): commit nothing and
      // hold, with what is on the screen as the message. A login screen is recognised from its text.
      const screen = lastLines(readScreen(api, t.link.pane, a?.agent_status ?? null, 60));
      if (S.isAuthFailure(screen)) { g.set(keep); fail(g, { stage: "agent", auth: true, title: "Needs a login", msg: "Needs a login", detail: screen }); return true; }
      t = g.set((t) => { keep(t); t.stage = "nosummary"; t.msg = S.oneLine(lastLines(screen, 2)) || "stopped without a summary"; t.screen = screen; });
      return true;
    }
    const text = finished ? turn.said : freshNote ? freshNote.text : t.said || "";
    if (freshNote) { try { fs.writeFileSync(path.join(S.dirOf(id), "closing.md"), freshNote.text + "\n"); } catch {} }
    t = g.set((t) => { keep(t); t.expectedWake = null; t.said = text; if (a?.agent_session?.value && !t.session) t.session = a.agent_session.value; });
    // Only a kind on the closing-note fallback asks by ending its note with a question: that is where its rules put
    // one. With a readable last message a closing question goes on to check and review; a truly blocked agent says so.
    if (!finished && freshNote && /\?\s*$/.test(text)) {
      t = g.set((t) => { t.stage = "asks"; t.kind = "question"; t.msg = S.oneLine(text.split("\n").filter((l) => l.trim()).pop()); });
      return true;
    }
    await pipeline(id, g, text, wake);
  } catch (e) {
    if (!e.aborted) try { fail(g, { stage: "workflow", title: "The finish line failed", detail: e.stack || e.message, next: "Investigate the error, then finish again." }); } catch {}
    else await closeReviewer(id);
  }
  return true;
}
// "Finish anyway" on a turn that left no closing note: the screen text is the summary.
export async function pipelineJob(id) {
  let t = claim(id, "pipeline");
  if (!t || t.stage !== "checking") { if (t) release(id); return; }
  const g = guardFor(id);
  g.expect(t);
  try { await pipeline(id, g, t.said || t.screen || t.msg || "", null); }
  catch (e) { if (!e.aborted) try { fail(g, { stage: "workflow", title: "The finish line failed", detail: e.stack || e.message, next: "Investigate the error, then finish again." }); } catch {} else await closeReviewer(id); }
  finally { release(id); }
}

// Main moved while a task waits for your approval (another task merged, or anything else): the board brings the
// task's branch up to date by itself. Started by the housekeeping pass. Only a task at rest is touched: waiting for
// approval, its worktree clean and on exactly the commit that was reviewed.
// `force`: main could not even be asked about (the periodic fetch failed), so look whatever is known locally.
export async function syncJob(id, { force = false } = {}) {
  let t = claim(id, "sync");
  if (!t) return;
  const g = guardFor(id);
  try {
    const tree = Y.treeOf(t);
    if (!Y.resyncable(t) || !tree || (Y.knownTarget(t) === t.syncSeen && !t.syncBlocked && !force)) return;
    g.expect(t);
    // Only a task at rest is merged into. One that is not, or whose main cannot be read, is held as "behind main":
    // it no longer invites an approval, and the sync is tried again soon.
    let r = null, why = "";
    if (S.branchOf(tree) !== t.branch) why = `its worktree is not on its own branch ${t.branch}`;
    else if (F.dirty(tree)) why = "its worktree has unsaved files";
    else if (t.reviewedHead && F.headOf(tree) !== t.reviewedHead) why = "its branch changed after the review";
    else r = Y.syncMain(t, tree);
    if (r?.status === "error") why = `main could not be fetched (${S.oneLine(firstLine(r.detail), 200) || "git fetch failed"})`;
    if (r?.status === "skip") why = Y.skipWhy(r);
    if (why) {
      const b = g.set((t) => ({ ...Y.seenPatch(t, null), syncBlocked: { why, at: Date.now() }, msg: Y.behindMsg(why) }));
      return void F.labelPane(b, "needs you");
    }
    if (r.status === "conflict") return void Y.conflictBack(id, g, tree, r, (failure, seen) => { fail(g, failure, { patch: seen }); });
    if (r.status !== "merged") { // already current: asked again when main moves
      const c = g.set((t) => ({ ...Y.seenPatch(t, r), ...(t.syncBlocked ? { syncBlocked: null, msg: approvalMessage(t) } : {}) }));
      return void F.labelPane(c, F.labelOf(c));
    }
    await pipeline(id, g, t.summary || "", { reason: "sync" }, r);
  } catch (e) { if (!e.aborted) try { fail(g, { stage: "workflow", title: "The finish line failed", detail: e.stack || e.message, next: "Investigate the error, then finish again." }); } catch {} else await closeReviewer(id); }
  finally { release(id); }
}

// A finished turn that was re-armed by mistake (F.reopened) and would stand in "working" for ever. The status hook
// only suspects it, from a reading that may be old: this runner asks herdr itself, holding the task, and does nothing
// unless the agent is at rest right now in the newest terminal with no turn finished since the handled one.
// It never finishes the task: what the saved state shows cannot prove that nothing was asked or changed since, so
// nothing is committed, checked or put up for approval here. The task goes to the human as a turn that stopped
// without a summary: "finish anyway" runs the finish line, a reply continues the work. If the agent turns out to be
// working after all, its next status re-arms the task as any typing does.
export async function recoverJob(id) {
  let t = claim(id, "recover");
  if (!t) return;
  const g = guardFor(id);
  try {
    if (!F.isAgentTask(t) || t.archivedAt || t.stage !== "working") return;
    const api = F.h(t), a = api.agentGet(t.link.pane);
    if (!a || (a.agent_status !== "idle" && a.agent_status !== "done")) return;
    if (a.terminal_id && t.terms?.length && t.terms.at(-1) !== a.terminal_id) return; // a terminal the hook has not seen yet: it decides first
    if (!F.reopened(t, a.completion_seq ?? null) || S.pendingText(id).length) return;
    const screen = lastLines(readScreen(api, t.link.pane, a.agent_status, 60));
    g.expect(t);
    g.set((t) => { t.stage = "nosummary"; t.msg = "stopped without a summary"; t.screen = screen; t.turnOpen = false; t.since = Date.now(); });
  } catch (e) { if (!e.aborted) process.stderr.write(`${new Date().toISOString()} recover ${id}: ${e.stack || e}\n`); }
  finally { release(id); }
}

// ---- the pipeline -------------------------------------------------------------------------------------------------------
// `synced`: the caller already brought the branch up to date with main (a re-sync, or the sync after an approval)
// and this is its result.
export async function pipeline(id, g, text, wake, synced = null) {
  let t = g.set((t) => { t.stage = "checking"; t.syncBlocked = null; t.msg = synced ? "checking the branch updated with main" : "checking the result"; t.watch = null; t.summary = String(text || "").trim(); });
  const folder = S.cwdOf(t), root = S.folderOf(t.id), tree = F.isAgentTask(t) && t.worktree && fs.existsSync(t.worktree) ? t.worktree : "";
  const repo = t.repoCfg || {};
  const env = { HERDR_SUPERWORK_ID: t.id, HERDR_SUPERWORK_WORKTREE: folder, HERDR_SUPERWORK_REPO: root };
  const ch = S.choices(t);
  const alive = () => !!g.check();
  // 3. Commit leftovers. A plain folder has nothing to commit.
  if (tree) {
    try { if (F.dirty(tree)) { S.gitOut(tree, ["add", "-A"]); S.gitOut(tree, ["commit", "-m", `${t.title || id}\n\nTask: ${id}`]); } }
    catch (e) { return void fail(g, { stage: "commit", title: "Could not commit the work", detail: outputOf(e), next: "Fix the Git error in your own worktree, commit the work and finish again." }); }
  }
  t = g.check();
  // Bring the branch up to date with main before anything is checked or reviewed, so the reviewer sees the work as
  // it will really land. The board does it; the agent hears nothing unless there is a real conflict.
  let sync = synced;
  if (!sync && Y.treeOf(t)) {
    // Work on another branch than the task's own cannot be brought up to date, pushed or landed as this task: it is
    // not checked or reviewed as if it could.
    const on = S.branchOf(tree);
    if (on !== t.branch) return void fail(g, { stage: "merge", phase: "branch", title: "Task is on the wrong branch", detail: `Worktree: ${tree}\nIt is on: ${on || "no branch"}\nThe task's own branch: ${t.branch}\n\nNothing was checked, reviewed or merged.`, next: `In ${tree}, bring the work onto ${t.branch} and switch back to it (git switch ${t.branch}), then finish again. Do not alter the human's checkout.`, agentCanFix: true, auth: false }, { keepIntent: true });
    sync = Y.syncMain(t, tree);
    if (sync.status === "conflict") return void Y.conflictBack(id, g, tree, sync, (failure, seen) => { fail(g, failure, { keepIntent: true, patch: seen }); });
    // Main could not be read: work that was not brought up to date is never reviewed or put up for approval as if it were.
    if (sync.status === "error") return void fail(g, { stage: "merge", phase: "fetch", title: "Could not synchronize main", detail: `Branch: ${t.branch}\nFolder: ${tree}\n\n${sync.detail}`, next: "Investigate the fetch/Git error and fix what you safely can without altering the human's checkout. Finish again so the board retries the sync." }, { keepIntent: true });
  }
  if (sync) t = g.set((t) => Y.seenPatch(t, sync));
  // A clean update that touched none of the files the task changed leaves its review standing: the check runs again
  // on the merged result, the reviewer is not asked twice about the same change.
  // So does work that passed its review and has only taken main in since, also into its own files and with conflicts
  // resolved (Y.mergeOnly is the rule): the check is what proves the merged result, so there must be one. Anything
  // the agent did beyond the merge, a review that did not pass, or `remerge: review`: reviewed again, as ever.
  const stands = S.config().remerge !== "review";
  let kept = stands && sync?.status === "merged" && sync.overlap && !sync.overlap.length && t.reviewedHead === sync.before ? S.currentReview(t) : null;
  let keptHow = kept ? { from: sync.before, merges: 1, resolved: [] } : null;
  const passedAt = !kept && stands && repo.check && tree && sync?.target && ch.review !== "none" ? S.passedReview(t) : null;
  if (passedAt) {
    const m = Y.mergeOnly(tree, passedAt.head, sync.target);
    if (m.ok) { kept = passedAt.review; keptHow = { from: m.from, merges: m.merges, resolved: m.resolved }; }
  }
  if (t.setupPending && repo.setup) {
    const setup = await sh(repo.setup, folder, env, { alive });
    if (setup.aborted) return;
    if (!setup.ok) return void fail(g, { stage: "setup", title: "Setup still fails", detail: `Command: ${repo.setup}\nFolder: ${folder}\n\n${setup.out}`, next: "Fix the setup problem and finish again. Setup must pass before the check." });
    g.set({ setupPending: false });
  }
  if (repo.check) {
    g.set({ msg: `running the check: ${repo.check}` });
    const r = await sh(repo.check, folder, env, { alive });
    if (r.aborted) return;
    if (!r.ok) {
      const merged = kept ? " The branch was only re-merged with main since its review passed, so the tests ran instead of a new review." : "";
      const fails = (S.get(id).checkFails || 0) + 1;
      const auth = S.isAuthFailure(r.out);
      const failure = { stage: "check", auth, agentCanFix: true, title: `Check failed${fails >= 3 ? " after 3 tries" : ""}`, ...(fails >= 3 ? { msg: `the check still fails after 3 tries (${repo.check}): ${r.out.split("\n").filter(Boolean).slice(-1)[0] || ""}` } : {}), detail: `Command: ${repo.check}\nFolder: ${folder}\n\n${r.out}`, next: "Fix the failed check, run it again and finish for a fresh review." };
      if (fails >= 3 || auth) return void fail(g, failure, { patch: { checkFails: fails } });
      g.check();
      // Straight back to the agent. The turn it causes is the plugin's own: an approved merge survives it.
      F.sendOwn(id, `The check failed, so this is not done yet.${merged}\n\n${S.boundDetail(failure.detail)}\n\nFix it and finish again.`, { reason: "check", keepIntent: !!wake?.keepIntent || !!S.get(id).mergeIntent, patch: { checkFails: fails, ...S.failurePatch(failure), failure: { ...S.failurePatch(failure).failure, sentAt: Date.now() } } });
      return;
    }
  }
  g.check();
  // Push and open a draft pull request, when an origin remote exists.
  let note = "";
  if (tree && S.config().pr) {
    try {
      const hasCommits = Number(S.gitOut(tree, ["rev-list", "--count", `${t.baseSha || t.from || "HEAD"}..HEAD`])) > 0;
      if (hasCommits && F.hasOrigin(root)) {
        t = g.set({ stage: "pushing", msg: "pushing the branch" });
        // The branch is the board's own and an agent may have rebuilt it on a newer base: overwrite what was pushed
        // before, but only while the remote still holds what was last seen here.
        S.gitOut(tree, ["push", "-u", "--force-with-lease", "origin", t.branch], { timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
        g.set({ prHead: S.gitOut(tree, ["rev-parse", `refs/remotes/origin/${t.branch}`]) });
        let url = t.pr || "";
        if (!url) {
          const r = F.gh(["pr", "create", "--draft", "--head", t.branch, "--title", t.title || id, "--body", `${text || t.title || ""}\n\nTask: ${id}`], tree);
          url = ((r.stdout || "").match(/https?:\/\/\S+/) || [""])[0];
          if (!url) return void fail(g, { stage: "pr", title: "Could not open the pull request", detail: `Branch: ${t.branch}\nFolder: ${tree}\n\ngh pr create:\n${outputOf(r)}`, next: "Inspect the GitHub error, fix what you safely can, then finish again. The board retries opening the pull request; do not push or ship manually." });
          g.set({ pr: url, prSeen: "", prState: "waiting" });
        }
        note = ` Pull request: ${url}`;
      }
    } catch (e) { return void fail(g, { stage: "push", title: "Could not push the branch", detail: `Branch: ${t.branch}\nFolder: ${tree}\n\n${outputOf(e)}`, next: "Inspect the Git error and fix what you safely can without altering the human's checkout. Finish again so the board retries the push." }); }
  }
  t = g.check();
  const change = tree ? F.changeOf(t) : null;
  const toLand = !!(change && change.stat);
  // Done with nothing to merge leaves herdr's sidebar like merged work does; its branch goes only if git calls it merged.
  const tidyDone = async (id) => { const { tidy } = await import("./land.js"); await tidy(id, { deleteBranch: "merged" }); };
  const done = (msg, patch = {}) => { const mark = F.tidyMark(t, "merged"); const d = g.set((t) => { t.stage = "done"; t.tidy = mark; t.msg = S.oneLine(msg); t.failure = null; t.mergeIntent = null; Object.assign(t, patch); }); F.labelPane(d, null); return d; };
  // Nothing to land: it is simply done, unless work outside a repo is reviewed too (review "all").
  if (!toLand && ch.review !== "all") {
    if (holdPrFailure(g, t)) return;
    done(`${firstLine(text) || "finished"}${note}`);
    return void (await tidyDone(id));
  }
  // 4. An adversarial review before it reaches you.
  let review = null;
  const reviewNeeded = ch.review !== "none";
  if (reviewNeeded && kept && toLand) {
    review = { ...kept, head: change.head, keptAt: Date.now(), kept: { ...keptHow, head: change.head, check: repo.check || "" } };
    g.set((t) => { S.logKept(t, review.kept); }); // the task's history says what happened instead of a review
  }
  else if (reviewNeeded) {
    const r = await runReview(id, g, { text, change, toLand, ch });
    if (r.aborted) return;
    g.set((t) => { S.logReview(t, r.review || { error: r.error }); }); // the task keeps every review it had
    if (!r.review) return void fail(g, { stage: "review", auth: r.auth ? true : undefined, title: r.auth ? "Needs a login" : "Review failed", msg: r.auth ? "The reviewer needs a login" : `Review failed: ${S.oneLine(r.error, 200)}. Retry the task to review again.`, detail: `Review failed: ${r.error}`, next: "Investigate the reviewer failure, then finish again for a fresh review. Do not bypass review or merge approval." }, { patch: { review: null } });
    review = r.review;
    // The pull request says what the review found, the findings below the gate marked as not required.
    if (t.pr && toLand) { try { F.gh(["pr", "comment", F.prNumber(t.pr), "--body", G.prComment(review, S.reviewRound(S.get(id)))], root, 60000); } catch {} }
  }
  t = g.set({ failure: null });
  // The loop, unless the gate is "off": a review that fails the gate goes straight back, at most `rounds` times.
  // Then, still failing, it stops and waits for you.
  const rounds = t.reviewRounds || 0;
  const passed = !review || G.passes(review);
  if (review && !review.keptAt && (ch.gate !== "off" || t.mergeIntent) && !passed && rounds < ch.rounds) {
    F.sendOwn(id, G.reviewMessage(review), { reason: "review", keepIntent: !!t.mergeIntent, patch: { review: { ...review, stale: true }, reviewRounds: rounds + 1 } });
    return;
  }
  const head = change?.head || F.headOf(folder) || null;
  const { landCore } = await import("./land.js");
  if (t.mergeIntent) { // an approved merge being re-verified after a sync with main or a conflict repair
    if (review && !review.keptAt && !passed) return void fail(g, { stage: "review", title: "Approved merge repair is not ready", detail: `A reviewer went through the repair and found it not ready: ${G.result(review)}.\n\n${G.findingsText(review)}`, next: "The agent could not make this repair pass review. Address the findings before retrying.", agentCanFix: true });
    t = g.set((t) => { t.review = review; t.stat = change?.stat; t.reviewedHead = head; t.mergeIntent = { ...t.mergeIntent, verifiedHead: head }; });
    if (holdPrFailure(g, t)) return;
    t = g.set({ stage: "merging", msg: "merging" });
    return void (await landCore(id, g));
  }
  if (!toLand) { done(`${review ? `${G.sentence(review, "accept")} ` : ""}${firstLine(text) || "finished"}${note}`, { review }); return void (await tidyDone(id)); }
  t = g.set((t) => { t.review = review; t.stat = change.stat; t.reviewedHead = head; t.mergeFailed = false; });
  if (holdPrFailure(g, t)) return;
  // 5. A repo that lands by itself still wants a review that passed the gate: one that failed it, you are asked.
  if (repo.land === "auto" && !t.requireApproval && sync?.status !== "skip" && (!reviewNeeded || (review && passed))) {
    t = g.set((t) => { t.stage = "merging"; t.msg = "merging"; t.mergeIntent = { approvedAt: Date.now(), repairs: 0, verifiedHead: head, auto: true }; });
    return void (await landCore(id, g));
  }
  // Finished work that waits for your yes is not done: it is blocked on you.
  // Checked and reviewed, but not against where it would land (your checkout is on another branch): not approvable yet.
  const behind = sync?.status === "skip" ? Y.skipWhy(sync) : "";
  t = g.set((t) => { t.stage = "approval"; t.msg = behind ? Y.behindMsg(behind) : approvalMessage(t, note); if (behind) t.syncBlocked = { why: behind, at: Date.now() }; });
  F.labelPane(t, F.labelOf(t));
}
// A pull-request blocker found by polling survives a passing local check: remote CI must confirm.
function holdPrFailure(g, t) {
  if (!t.prFailure) return false;
  const h = g.set((t) => { t.stage = "approval"; t.failure = null; t.msg = `Local checks passed; pull request still blocked: ${t.prFailure.title}. Wait for remote confirmation or send the details to the agent.`; });
  F.labelPane(h, "failed");
  return true;
}

// ---- the reviewer: a visible herdr agent in a split of the task's own space ----------------------------------------------
async function closeReviewer(id) {
  const t = S.get(id);
  if (!t?.link?.reviewer?.pane) return;
  try { F.h(t).paneClose(t.link.reviewer.pane); } catch {}
  try { S.update(id, (t) => { if (t.link) t.link = { ...t.link, reviewer: null }; }, { waitMs: 10000 }); } catch {}
}
// `earlier`: the findings of the round before, when the agent was sent back with them (null on a first review).
// `filed`: the faults from before the task that are tasks of their own by now, whichever round found them.
export function reviewBrief(t, { text, change, toLand, ch, earlier = null, filed = [] }) {
  const dir = `${F.RULE_DIR}/review-${t.n}`;
  const share = ch.serve === "tailscale"
    ? "If you start something for the human to try (a dev server, a page), bind it to 127.0.0.1 and share it privately on their tailnet: run `tailscale serve status` first so you replace nothing, then `tailscale serve --bg --https=<a free port> <your port>`; the link is https://<this machine's tailnet name>:<that port>/. Never use tailscale funnel or anything public. Leave it running."
    : "If you start something for the human to try (a dev server, a page), bind it to 127.0.0.1, leave it running, and give its http://127.0.0.1:<port>/ link.";
  const open = (earlier || []).filter((f) => !f.board && !f.preexisting);
  const old = [...(earlier || []).filter((f) => f.preexisting), ...filed].filter((f, n, all) => all.findIndex((x) => G.sameFault(x, f)) === n);
  const known = old.length ? `Already filed as tasks of their own (they were there before this change): do not report these again, in these words or in others.\n${old.map((f) => `- ${G.findingLine(f)}`).join("\n")}` : "";
  return [
    "You are an adversarial reviewer. Another agent says the task below is finished. Assume it is not until the evidence says so: your job is to find what is wrong, missing or risky, and to prove what works.",
    (toLand ? "You are in the repository, on the branch with the change, with all your tools." : "You are in the folder where the work was done, with all your tools. There is no diff: find what the agent made or changed from what it says below.") + " Read the changed files and what surrounds them. Then actually exercise the change: run it, run its tests, open it in a browser if it has a screen, try the awkward inputs. Check it against what was asked: does it do all of it, correctly? Does it break anything nearby? Ignore taste and style nits.",
    "You are here to review, not to fix. Do not change, commit, push or merge anything in the repository. Whatever you alter in the code is discarded when you finish.",
    ch.artifacts ? `Curate evidence that genuinely helps the human judge this work. Choose a small set of distinct, useful items (aim for at most six); no duplicates, scratch files, exhaustive output dumps, or decorative reports. A single navigable review page will combine the work summary, your verdict and only the evidence you explicitly list in your verdict. Do not make your own wrapper page. Each caption should name what matters; each detail should explain what that item proves, or how to try it.\n- Something with a screen (a page, an app, a game, a chart): screenshots of it working, and of anything broken.\n- Something that moves or is interactive: a short screen recording, if you are able to make one.\n- Something a person can use: a link to try it themselves.\n- Logic, a library, a script: the output of the tests or commands you ran, saved as a text file.\n- A tiny or obvious change (a typo, a rename, a one-line fix): no artifact is needed. Do not manufacture any.\nSave evidence files in ${dir}/ in this folder (git ignores it), using plain file names. Do not include secrets or private credentials in evidence.\n${share}` : "",
    `Task: ${t.title}`, t.description ? `Details:\n${t.description.slice(0, 3000)}` : "",
    `What the agent says it did:\n${String(text || "").slice(0, 2000)}`,
    toLand ? `The change is everything on this branch since it started${change.stat ? ` (${change.stat})` : ""}. The commit under review is ${change.head}. See all of it yourself, it is not pasted here: \`git diff ${change.range}\`` : "",
    `First answer one fixed question, true or false: ${G.QUESTION} All of it, and working. That answer is \`meets\`.`,
    "Then report what you found as a list of findings, one fault each. A finding has a `subject` (one sentence saying what is wrong), a `where` (the file or the place), a `proof` (what you actually ran or saw that shows it; leave it empty if you did not show it), `preexisting` (true when the fault was already there before this change and the task did not cause it) and a `severity`. Choose the severity by what the fault does, never by whether you would like this merged:\n- critical: the work does not do what was asked, breaks something that worked, or risks security or data loss.\n- major: a real fault in an unusual case; or a claim that is not proven (a fix not shown to work, a test that cannot catch the bug it is for); or a document that states something false.\n- minor: correct but could be better: wording, naming, a small inaccuracy, a narrow gap.\n- trivial: a note. Nothing to do.",
    `You do not decide whether this ${toLand ? "merges" : "is accepted"} or goes back, and you give no score: the board decides from your findings by a fixed rule. A critical finding with an empty proof is counted as major. If nothing qualifies, return an empty list and say so. Do not invent findings to have something to report.`,
    earlier ? `This is a later round: the agent was sent back with the findings of the round before, listed below. Your job now is narrower. Check that each one is fixed, and that the fixes broke nothing. Return each one that is still not fixed, with its \`id\`; leave out the ones that are fixed. You may add a new finding (with no id) only if it is critical. Anything smaller that you notice only now is left out: do not report it. The one exception is a fault that was already there before this change: report it, marked \`preexisting\`, and it is filed as a task of its own.\n${open.length ? `Earlier findings:\n${open.map((f) => `- ${f.id} ${G.findingLine(f)}`).join("\n")}` : "Earlier findings: none of the task's own."}${known ? `\n${known}` : ""}` : known,
    `Last of all, save your verdict as JSON in ${dir}/verdict.json, then stop. The board waits for that file. Its shape: {"commit": "${change?.head || "<the commit you reviewed>"}", "meets": <true or false>, "text": "<two or three plain sentences: your overall judgement>", "findings": [{${earlier ? '"id": "<the earlier finding\'s id; leave out for a new one>", ' : ""}"severity": "<critical, major, minor or trivial>", "subject": "<one sentence: what is wrong>", "where": "<the file or place>", "proof": "<what you ran or saw; may be empty>", "preexisting": <true or false>}, ...], "checks": ["<what you actually exercised and the result>", ...], "limitations": ["<important areas you could not verify>", ...], "artifacts": [{"file": "<file name you saved in that folder>" or "url": "<link to try it>", "caption": "<what it shows, a few words>", "detail": "<why it matters or what to try>"}, ...]}  (findings and artifacts may be empty lists; do not invent findings, checks or proof)`,
  ].filter(Boolean).join("\n\n");
}
// `earlier` and `used` as in G.settle: the board's rules are applied here, to whatever the reviewer wrote.
export function parseVerdict(raw, head, { earlier = null, used = [] } = {}) {
  const j = JSON.parse(raw);
  if (typeof j.meets !== "boolean" || typeof j.text !== "string" || !j.text.trim() || (j.findings !== undefined && !Array.isArray(j.findings))) throw new Error("no valid verdict");
  // The verdict must name the commit it reviewed; a verdict for another commit is ignored.
  if (head) { const c = String(j.commit || "").trim().toLowerCase(); if (c.length < 7 || !head.toLowerCase().startsWith(c)) return null; }
  const sentences = (xs) => (Array.isArray(xs) ? xs : []).map((x) => String(x).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 8);
  const { findings, left } = G.settle(j.meets, G.readFindings(j.findings), earlier, used);
  return { meets: j.meets, findings, left, text: j.text.replace(/\s+/g, " ").trim(), checks: sentences(j.checks), limitations: sentences(j.limitations), listed: j.artifacts, artifacts: [], at: Date.now(), head: head || null };
}
// A fault that was there before the task never sends the work back: each becomes a task of its own, filed once
// however many rounds name it, and started by nobody.
function fileFaults(id, g, review) {
  const t = S.get(id), filed = Array.isArray(t.filedFaults) ? [...t.filedFaults] : [];
  let changed = false;
  for (const f of review.findings) {
    if (!f.preexisting || f.task) continue;
    let was = filed.find((x) => G.sameFault(x, f));
    if (!was) {
      try { was = { task: S.create(S.folderOf(id), S.oneLine(f.subject, 120), { description: `${f.subject}\n\nWhere: ${f.where || "not said"}\nSeverity: ${f.severity}\n${f.proof ? `What the reviewer saw: ${f.proof}\n` : ""}\nFound by the reviewer of ${id} (${t.title}). It was there before that task, so it was not fixed there.` }).id, severity: f.severity, subject: f.subject, where: f.where, proof: f.proof }; filed.push(was); changed = true; }
      catch { continue; }
    }
    f.task = was.task;
  }
  if (changed) g.set({ filedFaults: filed });
}
async function runReview(id, g, { text, change, toLand, ch }) {
  let t = g.set({ stage: "reviewing", msg: "under review", watch: null, reviewAt: Date.now() });
  g.allow("reviewneeds");
  const api = F.h(t);
  const folder = S.cwdOf(t);
  const dir = F.reviewDir(t);
  const verdictFile = path.join(dir, "verdict.json");
  // The folder is emptied before the reviewer starts. Inside the working folder, so an agent's sandbox allows the writes.
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  // The configured reviewer program may not be installed here: review with the working agent's kind instead, on that
  // kind's own default model and effort, and say so on the task.
  let rkind = ch.reviewer, rmodel = ch.reviewerModel, reffort = ch.reviewerEffort;
  if (!installed(rkind) && installed(t.agent)) { rkind = t.agent; rmodel = ""; reffort = ""; }
  const round = (t.reviewRound || 0) + 1;
  t = g.set((t) => { S.keepSavedReview(t); t.reviewRound = round; t.reviewSession = null; t.fallbacks = { ...(t.fallbacks || {}), reviewer: rkind !== ch.reviewer ? `reviewed by ${rkind}: ${ch.reviewer} is not installed here` : undefined }; });
  // From the second round of a send-back on, the reviewer checks the earlier findings instead of starting over.
  const before = S.reviewHistory(t).filter((e) => G.isTagged(e));
  const earlier = (t.reviewRounds || 0) > 0 && before.length ? before.at(-1).findings : null;
  const used = before.flatMap((e) => e.findings.map((f) => f.id));
  const brief = `${taskLine(t, "reviewer", round)}\n\n${reviewBrief(t, { text, change, toLand, ch, earlier, filed: Array.isArray(t.filedFaults) ? t.filedFaults : [] })}`;
  let pane = null, error = "", review = null, sent = false, sentAt = 0, auth = false, quietSince = 0;
  // The reviewer ended its turn with no verdict: its own error when it has one, else its last message.
  const noVerdict = (cur, ev) => {
    const w = whyStopped(cur, "reviewer", ev);
    auth = !!w.turn?.auth;
    return w.turn?.error ? `the reviewer stopped: ${w.turn.error}` : `the reviewer finished without a verdict${w.turn?.said ? `. Its last message: ${w.turn.said.slice(0, 1500)}` : ""}`;
  };
  try {
    preTrust(rkind, t.root || S.folderOf(t.id));
    await closeReviewer(id); // a pane left over from an interrupted round
    pane = api.paneSplit(t.link.pane, { cwd: folder, env: S.boardEnv() });
    const taken = api.agents().map((a) => a.name).filter(Boolean);
    let name = `${t.link.agent || `sw-task-${t.n}`}-r`.slice(0, 32);
    if (taken.includes(name)) name = `${name.slice(0, 27)}-${String(Date.now() % 10000).padStart(4, "0")}`;
    const x = launchExtras(t, "reviewer", { kind: rkind, round });
    t = g.set((t) => { t.link = { ...t.link, reviewer: { pane: pane.pane_id, agent: name, kind: rkind } }; t.reviewSession = x.session; });
    const startedAt = Date.now();
    const start = (hook) => {
      try { api.agentStart(name, rkind, pane.pane_id, startArgs(rkind, { model: rmodel, effort: reffort, session: x.session, extra: hook })); }
      catch (e) { if (e.code === "agent_not_ready") return; if (!hook.length) throw e; start([]); } // once more without the hook arguments
    };
    start(x.hook);
    const until = Date.now() + ms("HERDR_SUPERWORK_REVIEW_MS", 20 * 60000);
    const every = ms("HERDR_SUPERWORK_POLL_MS", 3000);
    for (;;) {
      g.check();
      // The verdict file appearing is the finish signal.
      if (fs.existsSync(verdictFile)) {
        await sleep(Math.min(every, 300)); // let the write complete
        try { review = parseVerdict(fs.readFileSync(verdictFile, "utf8"), toLand ? change.head : null, { earlier, used }); if (review) break; fs.rmSync(verdictFile, { force: true }); }
        catch (e) { error = String(e.message || e).replace(/\s+/g, " ").slice(0, 400) || "no valid verdict"; break; }
      }
      if (Date.now() > until) { error = "review timed out"; break; }
      const now = S.get(id);
      // The reviewer's own turn-end report for this round, and still no verdict: the review failed, at once.
      // Codex also reports its side chats (it names a conversation with one, right after the first prompt): not this.
      const rev = S.pendingEvents(now).find((e) => e.role === "reviewer" && e.round === round && !e.side);
      if (rev?.session && !now.reviewSession) S.update(id, { reviewSession: rev.session }, { waitMs: 10000 });
      if (rev && sent) { await sleep(Math.min(every, 1500)); if (!fs.existsSync(verdictFile)) { error = noVerdict(now, rev); break; } continue; }
      const a = api.agentGet(pane.pane_id);
      if (!a && sent) { error = "the reviewer exited without a verdict"; break; }
      if (!a && !api.paneGet(pane.pane_id)) { error = "the reviewer's terminal was closed"; break; }
      // herdr status is used only to notice a reviewer that is blocked: "review needs you".
      const blocked = a?.agent_status === "blocked";
      const cur = S.get(id);
      if (blocked && cur.stage === "reviewing") { g.set({ stage: "reviewneeds", msg: "the reviewer shows a dialog: open it and answer" }); g.allow("reviewing"); }
      else if (!blocked && cur.stage === "reviewneeds") { g.set({ stage: "reviewing", msg: "under review" }); g.allow("reviewneeds"); }
      if (!sent && a && (a.agent_status === "idle" || a.agent_status === "done")) { try { api.agentPrompt(pane.pane_id, brief); sent = true; sentAt = Date.now(); } catch (e) { if (e.code !== "agent_blocked" && e.code !== "agent_not_ready") { sent = true; sentAt = Date.now(); } } }
      else if (sent && a && adapter(rkind).readTurn && Date.now() - sentAt > 5000) {
        // No hook: "idle" alone never fails a review (a reviewer in a long test run looks idle). Only its saved
        // conversation ending in a finished message or an error, and still no verdict 15 seconds later, does.
        let session = now.reviewSession;
        if (!session && adapter(rkind).findSession) { session = adapter(rkind).findSession(folder, startedAt, taskLine(t, "reviewer", round)); if (session) S.update(id, { reviewSession: session }, { waitMs: 10000 }); }
        const turn = session ? readTurnOf(rkind, { session, cwd: folder }) : null;
        if (turn && turn.pos > sentAt && (turn.finished || turn.error)) { quietSince = quietSince || Date.now(); if (Date.now() - quietSince > ms("HERDR_SUPERWORK_QUIET_MS", 15000) && !fs.existsSync(verdictFile)) { error = noVerdict(S.get(id), null); break; } }
        else quietSince = 0;
      }
      await sleep(every);
    }
  } catch (e) {
    if (e.aborted) { await closeReviewer(id); return { aborted: true }; }
    error = `${e.message || e}`.replace(/\s+/g, " ").slice(0, 400);
  }
  // Put back anything the reviewer changed: what you approve is exactly what the agent committed.
  if (toLand) { try { S.gitOut(folder, ["reset", "--hard", change.head]); S.gitOut(folder, ["clean", "-fd"]); } catch {} }
  await closeReviewer(id);
  try { if (S.get(id).stage === "reviewneeds") { g.set({ stage: "reviewing", msg: "review complete" }); } } catch (e) { if (e.aborted) return { aborted: true }; }
  if (!review) return { error: error || "no valid verdict", auth };
  G.stamp(review, ch.gate);
  try { fileFaults(id, g, review); } catch (e) { if (e.aborted) return { aborted: true }; }
  // Move the folder to the task's artifacts and publish the evidence page.
  const art = S.artifactsDir(id);
  try { fs.rmSync(art, { recursive: true, force: true }); fs.mkdirSync(path.dirname(art), { recursive: true }); fs.cpSync(dir, art, { recursive: true }); fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  try {
    t = S.get(id);
    review.artifacts = await publishReview({ enabled: ch.artifacts, dir: art, listed: review.listed, review, task: t, serve: ch.serve, onFallback: (why) => { try { S.update(id, (t) => { t.fallbacks = { ...(t.fallbacks || {}), serve: why }; }, { waitMs: 10000 }); } catch {} },
      context: { id, round: S.reviewRound(t), title: t.title, description: t.description, summary: text, stat: change?.stat, head: change?.head, pr: t.pr } });
  } catch { review.artifacts = []; } // a publish failure must not bypass the requested-review gate, nor fail the review
  delete review.listed;
  return { review };
}
