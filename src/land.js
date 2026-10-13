// Landing: bring the branch up to date with main in the task's own worktree, merge (through the pull request when
// there is one, else locally), then clean up. Conflicts are rolled back and saved; a checkout with unsaved files
// is never forced.
import fs from "node:fs";
import path from "node:path";
import * as S from "./store.js";
import * as F from "./flow.js";
import { createHash } from "node:crypto";
import { herdr, currentSocket, socketExists, readScreen } from "./herdr.js";
import { claim, release, guardFor, sh, outputOf, sleep } from "./runner.js";
import * as Y from "./sync.js";
import { calledOff } from "./finish/auto-merge.js";
import { takeTurn } from "./finish/line.js";
import { readTurnOf } from "./agents.js";

const git = S.gitOut;

// Remove a task's herdr workspace, worktree and branch. Returns what was kept (and why), so no work is ever lost:
// a checkout with unsaved files is never forced. Only things the plugin created are closed. The space leaves herdr's
// sidebar either way: a kept checkout stays on disk, and a reply reopens it.
// `keepUnmerged` (a task that ended without a merge): a branch with work that landed nowhere keeps its worktree too,
// so a reply picks the work up where it stands.
// Clean-up takes a while (teardown), and the agent's terminal is open until its end: whatever it was looked at is
// looked at again right before anything is removed. Work that appeared meanwhile is kept, with its branch.
// A clean-up put off because the space was in use says so on what it returns (`retry`, with what it saw), and the
// housekeeping pass tries again; `since` is what the attempt before saw, so nothing that happened in between is missed.
export async function cleanup(t, { deleteBranch = "merged", keepUnmerged = false, still = null, since = null, first = null } = {}) {
  const kept = [];
  const root = S.folderOf(t.id);
  // After a task ended its own herdr session is asked, whichever session this runs in. A delete acts in this one only.
  const api = t.link?.socket && (still || t.link.socket === currentSocket()) && socketExists(t.link.socket) ? herdr(t.link.socket) : null;
  let ws = null, unknown = false; // a space herdr did not answer for is not "closed already"
  if (api && t.link?.workspace) { try { ws = api.call(["workspace", "get", t.link.workspace]).workspace || null; } catch (e) { unknown = !/not_found/.test(String(e.code)); } }
  // False when herdr did not close it (a timeout): then it is still in the sidebar, and that is tried again.
  const closeSpace = () => { if (!ws || !t.link?.ownsWorkspace) return true; try { api.workspaceClose(ws.workspace_id); return true; } catch (e) { return /not_found/.test(String(e.code)) || !still; } };
  const later = (list) => Object.assign(list, { retry: true, turn, comp: seen, tip, still: quiet, eventSeq: S.get(t.id)?.eventSeq || 0 });
  // An agent herdr cannot place (status "unknown") may be at work, or may simply never be reported idle (herdr does
  // that to some agent programs after a reply). Two things together say it is at rest. Its screen: an agent at work
  // moves it, so it must have shown the very same one, with no change of state, from one attempt to a later one. And,
  // because a tool can run for long without a sign on the screen, its turn and its processes: the saved conversation
  // (where it can be read) must end in a finished turn, and the agent program must have nothing running under it.
  let quiet = since?.still || null;
  const stillFor = process.env.HERDR_SUPERWORK_STILL_MS !== undefined ? Number(process.env.HERDR_SUPERWORK_STILL_MS) : 120000;
  const atRest = (a) => {
    let screen = ""; try { screen = String(readScreen(api, t.link.pane, a.agent_status) || ""); } catch {}
    if (!screen.trim()) return false;
    const sig = `${a.state_change_seq ?? ""}|${createHash("sha1").update(screen).digest("hex")}`;
    quiet = { sig, at: quiet?.sig === sig ? quiet.at : Date.now() };
    // Only an earlier attempt's look counts as the first one: two looks of one slow attempt are the same moment.
    if (since?.still?.sig !== sig || Date.now() - quiet.at < stillFor) return false;
    const turn = readTurnOf(t.agent, { file: t.transcript || null, session: t.session, cwd: S.cwdOf(t) });
    if (turn && !(turn.finished || turn.error || turn.interrupted)) return false;
    return api.paneChildless(t.link.pane); // a command it left running in the background would go down with the space
  };
  const keep = (why) => { const open = inUse() || !closeSpace(); if (api) F.closeRepoSpace(api, root); return open ? later([why]) : [why]; };
  const stuck = () => later([`${S.tilde(S.cwdOf(t))} (herdr did not close its space)`]);
  const tipOf = () => { try { return t.branch ? git(root, ["rev-parse", "--verify", `refs/heads/${t.branch}`]) : ""; } catch { return ""; } };
  const tip = since ? since.tip : first ?? tipOf(); // what is safe to delete is what the first look saw
  let turn = false, seen = since?.comp; // was it the agent that was in use, and its last known finished turn
  // Its session is not there to ask (herdr is down, or gone): whether its agent works is unknown, so nothing is touched.
  if (still && !api && t.link?.socket && (t.link.pane || t.link.workspace)) return later([`${S.tilde(S.cwdOf(t))} (its herdr session cannot be reached)`]);
  // After a task ended (`still`, not a delete): a done task's turns are not followed by the hook, so herdr is asked directly: an agent at work in the pane, or a
  // turn of it that ended since, is a turn you started in its terminal. Then nothing is removed and nothing closed.
  // What herdr cannot tell counts as busy: a failed lookup never reads as "nobody there", and only an agent herdr
  // calls idle or done is at rest (status "unknown" may be one at work), and only with nothing running under it: a
  // command it left in the background (a dev server, a long job) would go down with the space.
  const agentNow = () => { if (!still || !api || !t.link?.pane) return null; try { const a = api.agentGet(t.link.pane); seen = a ? a.completion_seq ?? null : null; return a ? { busy: ["working", "blocked"].includes(a.agent_status), unknown: ["idle", "done"].includes(a.agent_status) ? !api.paneChildless(t.link.pane) : !["working", "blocked"].includes(a.agent_status) && !atRest(a), comp: seen } : null; } catch { seen = since?.comp; return { busy: true, comp: undefined, unknown: true }; } };
  // The space is closed whole: a pane of yours in it (a split, a tab, the shell an agent left) with something running
  // keeps it open as well.
  const othersBusy = () => {
    if (still && unknown) return true;
    if (!still || !ws) return false;
    try { return api.panes(ws.workspace_id).some((p) => p.pane_id !== t.link?.reviewer?.pane && (p.pane_id === t.link?.pane && api.agentGet(p.pane_id) ? false : !!api.agentGet(p.pane_id) || !api.paneIdle(p.pane_id))); } catch { return true; }
  };
  // Turn-end events the agent's own hook filed since clean-up began: a turn of yours that already ended again.
  const events = () => (still ? (S.get(t.id)?.eventSeq || 0) - (since ? since.eventSeq || 0 : t.eventSeq || 0) : 0);
  let agent = agentNow();
  // herdr's status can trail the turn that just ended: give it a moment before believing "working". Only a hooked
  // agent's status trails (without the hook the finish line waits for herdr first), and a trailing status files no
  // event: anything else that was working here is a new turn, also when it has ended by now.
  let reused = false;
  if (since) { reused = !!agent && !agent.unknown && (agent.busy || (since.comp !== undefined && agent.comp !== since.comp)); if (agent && !agent.unknown && since.comp === undefined) since = { ...since, comp: agent.comp }; }
  else if (agent?.busy || agent?.unknown) {
    for (const until = Date.now() + (process.env.HERDR_SUPERWORK_SETTLE_MS !== undefined ? Number(process.env.HERDR_SUPERWORK_SETTLE_MS) : 5000); (agent?.busy || agent?.unknown) && Date.now() < until; agent = agentNow()) await sleep(500);
    reused = !agent?.unknown && (!!agent?.busy || !t.hooked || events() > 0);
  }
  const base = () => (since ? since.comp : agent ? agent.comp : undefined);
  const inUse = () => {
    if (reused || events() > 0) return (turn = true);
    const a = agentNow();
    if (a && !a.unknown && (a.busy || (!since && !agent) || (base() !== undefined && a.comp !== base()))) return (turn = true);
    return !!a?.unknown || !!agent?.unknown || othersBusy();
  };
  const used = () => later([`${S.tilde(S.cwdOf(t))} (its space is in use again)`]);
  if (inUse()) return used();
  const moved = () => tipOf() !== tip || (!!still && !still());
  // Nothing on the branch that your checkout or the commit it started from does not already have.
  const landed = () => !tip || ["HEAD", t.baseSha, t.from].some((ref) => { try { git(root, ["merge-base", "--is-ancestor", tip, ref]); return true; } catch { return false; } });
  const spent = keepUnmerged && !!t.branch && landed();
  if (t.worktree && fs.existsSync(t.worktree)) {
    if (F.dirty(t.worktree)) return keep(`${S.tilde(t.worktree)} (uncommitted changes)`);
    if (moved()) return keep(`${S.tilde(t.worktree)} (new work arrived during clean-up)`);
    if (keepUnmerged && t.branch && !spent) return keep(`${S.tilde(t.worktree)} (unmerged work on ${t.branch})`);
    const teardown = S.commandOf(S.setting("workspace.teardown", t));
    if (teardown) await sh(teardown, t.worktree, { HERDR_SUPERWORK_ID: t.id, HERDR_SUPERWORK_WORKTREE: t.worktree, HERDR_SUPERWORK_REPO: root }, { timeoutMin: 5 });
    if (inUse()) return used();
    if (F.dirty(t.worktree)) return keep(`${S.tilde(t.worktree)} (uncommitted changes)`);
    if (moved()) return keep(`${S.tilde(t.worktree)} (new work arrived during clean-up)`);
    try {
      if (api && t.link?.ownsWorkspace) {
        // `herdr worktree remove` also closes its workspace. If the human closed the workspace, reopen it first.
        const target = ws && ws.worktree?.checkout_path === t.worktree ? ws.workspace_id : F.openingWorktree(api, root, () => api.worktreeOpen({ cwd: root, path: t.worktree })).workspace.workspace_id;
        api.worktreeRemove(target);
      } else git(root, ["worktree", "remove", t.worktree]);
    } catch (e) {
      try { git(root, ["worktree", "remove", t.worktree]); } catch { return keep(`${S.tilde(t.worktree)} (${String(e.message || "could not be removed").split("\n")[0]})`); }
    }
    try { git(root, ["worktree", "prune"]); } catch {}
    // git removed the checkout, herdr did not: its space is still there, or herdr does not say (then it is asked again).
    if (api && t.link?.ownsWorkspace && t.link.workspace) {
      let there = true;
      try { api.call(["workspace", "get", t.link.workspace]); } catch (e) { if (/not_found/.test(String(e.code))) there = false; else if (still) return stuck(); }
      if (there && !closeSpace()) return stuck();
    }
  } else if (inUse()) return used();
  else if (!closeSpace()) return stuck();
  if (api) F.closeRepoSpace(api, root);
  if (t.branch && tipOf() !== tip) kept.push(`branch ${t.branch} (new work arrived during clean-up)`);
  else if (t.branch) {
    try { git(root, ["rev-parse", "--verify", `refs/heads/${t.branch}`]); try { git(root, ["branch", deleteBranch === "always" || spent ? "-D" : "-d", t.branch]); } catch { kept.push(`branch ${t.branch} (not merged yet)`); } } catch {}
  }
  return kept;
}
// After landing: remove the leftovers when that is safe, and say where they are when it is not. A task that ended
// with nothing to land is tidied the same way, only its branch is deleted just when git calls it merged.
export async function tidy(id, { deleteBranch = "always" } = {}) {
  const t = S.get(id);
  if (!t || S.setting("workspace.cleanup", t) !== true || t.archivedAt) return;
  // The task as it ended: a turn started since (typed in the agent's own terminal) means it is no longer over.
  const same = (c) => !!c && c.stage === "done" && !c.archivedAt && (c.armedAt ?? null) === (t.armedAt ?? null);
  // What an earlier attempt saw. A note no attempt has acted on yet (see F.tidyMark) only says which commit was done.
  const prev = t.tidy && !t.tidy.fresh ? t.tidy : null;
  if (!t.tidy) { try { S.update(id, (c) => { if (!same(c) || c.tidy) return false; c.tidy = F.tidyMark(c, deleteBranch); }, { waitMs: 10000 }); } catch {} }
  const kept = await cleanup(t, { deleteBranch, keepUnmerged: deleteBranch !== "always", still: () => same(S.get(id)), since: prev, first: t.tidy?.fresh ? t.tidy.tip : null });
  try {
    S.update(id, (t) => {
      if (!same(t)) return false;
      const msg = prev?.msg ?? t.msg;
      // In use: tried again by the housekeeping pass, and after a turn of the agent only once it has been quiet a while.
      t.tidy = kept.retry ? { deleteBranch, tip: kept.tip, comp: kept.comp, still: kept.still || undefined, eventSeq: kept.eventSeq, quietFrom: kept.turn ? Date.now() : prev?.quietFrom || 0, msg } : null;
      if (kept.length) t.kept = [...kept]; else { F.clearNotes(t); delete t.kept; t.worktree = null; t.cleaned = Date.now(); t.link = { socket: t.link?.socket }; }
      t.msg = kept.length ? `${msg}${String(msg).endsWith(".") ? "" : "."} Kept: ${kept.join(", ")}` : msg;
    }, { waitMs: 10000 });
  } catch {}
}
// Clean-up holds a runner marker like every other long step, so archive answers "busy" until it has ended.
export async function cleanupJob(id, { deleteBranch = "always" } = {}) {
  const t = claim(id, "cleanup");
  if (!t) return;
  try { if (t.stage === "done") await tidy(id, { deleteBranch }); } finally { release(id); }
}

export async function landJob(id) {
  const t = claim(id, "land");
  if (!t || t.stage !== "merging") { if (t) release(id); return; }
  const g = guardFor(id);
  g.expect(t);
  try { await landCore(id, g); }
  catch (e) { if (!e.aborted) try { g.set((t) => { t.stage = "approval"; t.mergeFailed = true; t.msg = "Merge failed"; Object.assign(t, S.failurePatch({ stage: "merge", title: "Merge failed", detail: e.stack || e.message, next: "Investigate the error, then approve again." })); }); } catch {} }
  finally { release(id); }
}

// Runs with the task in stage "merging" and this runner's guard standing on it.
export async function landCore(id, g) {
  if (calledOff(g)) return; // `merge.by` went back to `you` before this merge of the board's own began
  // One merge at a time in a repo: behind another task this one waits, and catches up with main when its turn comes.
  if (!takeTurn(id, g)) return;
  let t = g.check();
  const root = S.folderOf(t.id);
  const tree = t.worktree && fs.existsSync(t.worktree) && path.resolve(t.worktree) !== path.resolve(root) ? t.worktree : "";
  const how = S.setting("merge.method", t); // read right before the merge. squash by default: one commit per task
  // A failed merge waits for you again, as plain "permission": the row, panel and details show the blocker.
  const fail = (title, detail, next, { agentCanFix = true, auth = S.isAuthFailure(detail), extra = {}, keepIntent = false } = {}) => {
    const f = g.set((t) => { t.stage = auth ? "failed" : "approval"; t.mergeFailed = true; t.msg = title; if (!keepIntent) t.mergeIntent = null; Object.assign(t, S.failurePatch({ stage: "merge", title, detail, next, agentCanFix, auth, ...extra })); });
    F.labelPane(f, "failed");
    return f;
  };
  // `head`: the commit that was merged. Nothing newer on the branch is taken for merged.
  const landed = async (msg, head = "") => {
    const mark = F.tidyMark(t, "always", head);
    const d = g.set((t) => { t.stage = "done"; t.mergedAt = Date.now(); t.tidy = mark; t.msg = msg; t.failure = null; t.prFailure = null; t.mergeIntent = null; t.autoMerge = false; t.autoMergeLocal = false; t.mergeFailed = false; t.requireApproval = false; t.lineAt = null; t.lineTurn = null; if (t.pr) { t.prMerged = true; t.prState = "merged"; } });
    F.labelPane(d, null);
    await tidy(id);
  };
  const reverify = async (why, synced = null) => {
    const { pipeline } = await import("./finish.js");
    g.set({ msg: why });
    await pipeline(id, g, t.summary || "Branch updated with main.", { keepIntent: true, reason: "sync" }, synced);
  };
  if (tree) {
    try {
      if (!t.pr && F.dirty(root)) return void fail("Merge needs a clean checkout", `Checkout: ${root}\n${F.dirty(root)}`, "Commit, stash or move your own unsaved files, then approve again. The agent must not alter your checkout.", { agentCanFix: false, auth: false });
      if (git(tree, ["symbolic-ref", "--short", "HEAD"]) !== t.branch) return void fail("Task is on the wrong branch", tree, "Restore the task's own branch before retrying.", { agentCanFix: false, auth: false });
      // Approve refuses unless the worktree is clean and its HEAD is exactly the commit that was checked and reviewed;
      // otherwise the finish line runs again first, under the approval already given.
      if (F.dirty(tree) || (t.mergeIntent?.verifiedHead && F.headOf(tree) !== t.mergeIntent.verifiedHead)) return void (await reverify("Checking work that changed after its review"));
      if (!t.mergeIntent) t = g.set({ mergeIntent: { approvedAt: Date.now(), repairs: 0, verifiedHead: F.headOf(tree) } });
    } catch (e) { return void fail("Could not synchronize main", outputOf(e), "Investigate the fetch/Git error, then retry after fixing it."); }
    // The last safety net: the branch was brought up to date before its review and whenever main moved since, so
    // this rarely finds anything. What it finds is handled the same way.
    const r = Y.syncMain(t, tree);
    // Never onto a branch the task was not brought up to date with, even at the very same commit.
    if (r.status === "skip") return void fail("Your checkout is on another branch", `Checkout: ${root}\nIt is on: ${r.onto || "no branch"}\nThis task lands on: ${r.want}\n\nNothing was merged.`, `Switch your checkout back to ${r.want}, then approve again.`, { agentCanFix: false, auth: false });
    if (r.status === "error") return void fail("Could not synchronize main", r.detail, "Investigate the fetch/Git error, then retry after fixing it.");
    if (r.status === "conflict") {
      return void Y.conflictBack(id, g, tree, r, (failure, seen) => {
        const f = g.set((t) => { Object.assign(t, S.failurePatch(failure), seen); t.stage = "approval"; t.mergeFailed = true; t.msg = failure.title; });
        F.labelPane(f, "failed");
      });
    }
    // A clean update changed the commit: it is checked again (and reviewed again only when its review does not stand:
    // see the pipeline), then merged under the approval given.
    if (r.status === "merged") return void (await reverify("Checking the branch updated with main", r));
    g.set((t) => Y.seenPatch(t, r));
  }
  t = g.check();
  if (t.pr) {
    // By number, not link: gh then uses the repo's own remote for the host.
    const pr = F.prNumber(t.pr);
    // Only the commit that was checked and reviewed here may merge. A commit pushed to the pull request from somewhere
    // else since then is said plainly, and GitHub is told the head it may merge, now and for a remembered auto-merge.
    const reviewed = t.mergeIntent?.verifiedHead || "";
    const only = reviewed ? ["--match-head-commit", reviewed] : [];
    if (reviewed) {
      const asked = () => { try { return JSON.parse(F.gh(["pr", "view", pr, "--json", "headRefOid"], root, 60000).stdout).headRefOid || ""; } catch { return ""; } };
      let remote = asked();
      // Asked right after a push (a catch-up with main), GitHub may still name the commit before it. While the branch
      // at the remote is the reviewed commit, that answer is only late: it is asked again, a few times.
      const lag = process.env.HERDR_SUPERWORK_PR_LAG_MS !== undefined ? Number(process.env.HERDR_SUPERWORK_PR_LAG_MS) : 5000;
      for (let i = 0; i < 6 && remote && remote !== reviewed && F.remoteHead(root, t.branch) === reviewed; i++) { if (lag) await sleep(lag); remote = asked(); }
      if (remote && remote !== reviewed) return void fail("Pull request has commits that were not reviewed", `Pull request: ${t.pr}\nBranch: ${t.branch || "unknown"}\nReviewed here: ${reviewed}\nOn the pull request: ${remote}`, `Bring the pull request's commits into your own worktree (git pull origin ${t.branch || "<branch>"}), or push what was reviewed, then finish again so it is checked and reviewed before it merges.`, { auth: false });
    }
    if (calledOff(g)) return;
    F.gh(["pr", "ready", pr], root, 60000);
    const m = F.gh(["pr", "merge", pr, `--${how}`, ...only], root);
    if (m.status !== 0) {
      // GitHub's checks are still running, or a required review is missing: the approval is remembered and the poll
      // merges it when they are there, again at the reviewed commit only.
      let v = {}; try { v = JSON.parse(F.gh(["pr", "view", pr, "--json", "statusCheckRollup,reviewDecision"], root, 60000).stdout); } catch {}
      const states = (v.statusCheckRollup || []).map((c) => String(c.conclusion || c.state || "").toUpperCase());
      const waiting = !states.some((s) => F.CHECK_BAD.includes(s)) && v.reviewDecision !== "CHANGES_REQUESTED" && (states.some((s) => !F.CHECK_GOOD.includes(s)) || v.reviewDecision === "REVIEW_REQUIRED");
      if (waiting) { g.set((t) => { t.failure = null; t.autoMerge = true; t.autoMergeLocal = true; t.msg = `Approved: merges when GitHub's checks pass (${t.pr})`; }); return; }
      return void fail("Pull request could not merge", `Pull request: ${t.pr}\nBranch: ${t.branch || "unknown"}\n\ngh pr merge:\n${outputOf(m)}\n\nNo check is still running and no review is awaited, so there is nothing to wait for.`, "Inspect the pull request's base branch, conflicts and checks. Resolve branch conflicts in your own worktree, or fix failed checks, then finish again. Approval is required before retrying the merge.");
    }
    try { git(root, ["fetch", "origin"], { timeout: 60000 }); if (!git(root, ["status", "--porcelain", "--untracked-files=no"])) git(root, ["merge", "--ff-only", "@{upstream}"]); } catch {} // bring your checkout along when that is safe
    // gh answering "fine" is not "merged": on a repo with a merge queue (or required checks) it only lines the pull
    // request up. Until GitHub itself says MERGED nothing is cleaned up or deleted, and the poll keeps watching it.
    let state = ""; try { state = JSON.parse(F.gh(["pr", "view", pr, "--json", "state"], root, 60000).stdout).state || ""; } catch {}
    if (state !== "MERGED") { g.set((t) => { t.failure = null; t.autoMerge = true; t.autoMergeLocal = false; t.msg = `Approved: GitHub merges it when its checks and merge queue are through (${t.pr})`; }); return; }
    F.dropRemoteBranch(root, t.branch, reviewed);
    return void (await landed(`Merged: ${t.pr}`, reviewed || t.prHead || ""));
  }
  // No pull request: merge into the branch your checkout is on.
  try {
    if (!tree) return void (await landed(t.msg && !/^merging/i.test(t.msg) ? t.msg : "Done"));
    const mess = F.dirty(root);
    if (mess) return void fail("Merge needs a clean checkout", `Checkout: ${root}\n\nUncommitted or untracked files:\n${mess}`, "Commit, stash or move your own unsaved files, then approve again. The agent must not alter your checkout.", { agentCanFix: false, auth: false });
    const onto = git(root, ["symbolic-ref", "--short", "HEAD"]);
    const target = F.headOf(root) || git(root, ["rev-parse", "HEAD"]);
    const conflict = (e) => {
      let files = ""; try { files = git(root, ["diff", "--name-only", "--diff-filter=U"]); } catch {}
      const detail = `${files ? `Conflicting files:\n${files}\n\n` : ""}Task branch: ${t.branch}\nTarget branch: ${onto}\nTarget commit: ${target}\nCheckout: ${root}\n\nGit output:\n${outputOf(e)}`;
      // Save the evidence before restoring the initially clean checkout. Never delete untracked files.
      let restored = true;
      try { git(root, ["merge", "--abort"]); } catch { try { git(root, ["reset", "--merge", "HEAD"]); } catch { restored = false; } }
      fail(files ? "Merge conflict" : "Merge failed", detail + (restored ? "\n\nThe merge attempt was rolled back; the human's checkout is unchanged." : "\n\nRollback failed. The human must inspect the checkout before retrying."),
        restored ? `In your own worktree on ${t.branch}, bring in target commit ${target} (${onto}), resolve the conflicts, run the checks and commit. Do not change the human's checkout. Finish again for review, then ask for merge approval.` : "Inspect and restore the human's checkout before retrying. Do not let the agent reset or discard it.", { agentCanFix: restored, auth: false });
    };
    const message = `${t.title || id}\n\nTask: ${id}`;
    // The commit that was checked and reviewed is the one merged, by its id: a commit that reaches the branch while
    // this runs is neither merged unseen nor deleted as merged.
    const head = t.mergeIntent?.verifiedHead || git(root, ["rev-parse", "--verify", `refs/heads/${t.branch}`]);
    if (calledOff(g)) return;
    if (how === "squash") {
      try { git(root, ["merge", "--squash", head]); } catch (e) { return void conflict(e); }
      if (git(root, ["diff", "--cached", "--name-only"])) try { git(root, ["commit", "-m", message]); } catch (e) { return void conflict(e); }
    } else {
      // Keep every commit: fast-forward when possible (what a rebase gives here), otherwise a merge commit.
      try { git(root, ["merge", how === "rebase" ? "--ff" : "--no-ff", "-m", message, head]); } catch (e) { return void conflict(e); }
    }
    return void (await landed(`Merged into ${onto}.`, head));
  } catch (e) { return void fail("Merge failed", outputOf(e), "Investigate the Git error in your own worktree, then finish again. Approve again only after the problem is fixed."); }
}
