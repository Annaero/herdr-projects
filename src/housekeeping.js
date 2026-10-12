// The housekeeping pass. It rides on every hook run (for any pane, in any task), every board tick and the startup
// hook, rate-limited by timestamps in the data folder, so nothing important depends on the board being open:
// start queued tasks when a slot is free, reconcile each linked task with herdr, bring waiting tasks up to date when
// main moved, and poll open pull requests.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as S from "./store.js";
import * as F from "./flow.js";
import { herdr, currentSocket, socketExists } from "./herdr.js";
import { userEnv, inline, runnerAlive, spawnRunner } from "./runner.js";
import { reconcile } from "./hook.js"; // a cycle, used only at call time
import { startQueued } from "./actions.js";
import * as Y from "./sync.js";

const key = (socket) => createHash("sha1").update(String(socket)).digest("hex").slice(0, 8);

export function housekeeping(socket = currentSocket(), { force = false } = {}) {
  if (!S.hasTasks()) return;
  if (!force && !S.due(`housekeep-${key(socket)}`, 2000)) return;
  const tasks = S.list();
  if (socketExists(socket)) {
    const linked = tasks.filter((t) => F.isAgentTask(t) && t.link.socket === socket && !["done", "todo", "progress", "queued"].includes(t.stage));
    if (linked.length) {
      const api = herdr(socket);
      let ok = true;
      try { api.workspaces(); } catch { ok = false; }
      if (ok) for (const t of linked) { try { reconcile(S.get(t.id) || t, api); } catch {} }
    }
    if (tasks.some((t) => t.stage === "queued")) { try { startQueued(socket); } catch {} }
    if (S.due(`spaces-${key(socket)}`, 30000)) { try { F.sweepRepoSpaces(socket); } catch {} try { F.sweepClosing(socket); } catch {} }
    // A clean-up that found the task's space in use is tried again, so a done task leaves the sidebar by itself once
    // the space is free; after a turn in the agent's own terminal only when that has been quiet for a while.
    const quiet = process.env.HERDR_SUPERWORK_QUIET_MS !== undefined ? Number(process.env.HERDR_SUPERWORK_QUIET_MS) : 600000;
    for (const t of tasks) {
      if (!S.config().cleanup || t.stage !== "done" || !t.tidy || t.archivedAt || t.link?.socket !== socket || runnerAlive(t) || Date.now() - (t.tidy.quietFrom || 0) < quiet) continue;
      if (S.due(`tidy-${key(t.id)}`, 30000)) spawnRunner("cleanup", t.id, t.tidy.deleteBranch === "merged" ? ["--merged"] : []);
    }
    try { resync(tasks, socket); } catch {}
  }
  if (tasks.some((t) => (t.pr && !t.prMerged) || (Y.resyncable(t) && t.worktree)) && (force === "pr" || S.due("prpoll", 120000))) {
    if (inline()) (globalThis.__swJobs ||= []).push(["prpoll", "-", []]);
    else spawnLoose(["run", "prpoll", "-"]);
  }
}
// Main moved (another task merged, or anything else): every task that waits for approval is brought up to date in
// its own worktree, each by a runner of its own. A task under review is reached the moment its review ends. Only
// what git already knows locally is read here; the periodic fetch below and every merge keep that current.
function resync(tasks, socket) {
  const known = new Map();
  for (const t of tasks) {
    if (!Y.resyncable(t) || t.link.socket !== socket || !Y.treeOf(t) || runnerAlive(t)) continue;
    const now = Y.knownTarget(t, known);
    if (now && (now !== t.syncSeen || t.syncBlocked) && Date.now() >= (t.syncRetryAt || 0)) spawnRunner("sync", t.id);
  }
}
// Ask the remote where main is, for every repo with a task waiting: main also moves without the board (a merge on
// GitHub, your own push). The housekeeping pass that follows sees the difference.
// A fetch that fails says nothing about main, so nothing may go on looking ready: each waiting task of that repo
// gets a sync runner anyway, which finds the same failure and holds the task as "behind main" until a fetch works.
function fetchMains() {
  const done = new Map(); // repo and branch -> did the fetch work
  for (const t of S.list()) {
    if (!Y.resyncable(t) || !Y.treeOf(t) || runnerAlive(t)) continue;
    const root = S.folderOf(t.id);
    if (!Y.viaRemote(root, t)) continue;
    const b = Y.mainBranch(root, t), key = `${root}|${b}`;
    if (!done.has(key)) { let ok = true; try { Y.fetchMain(root, b); } catch { ok = false; } done.set(key, ok); }
    if (!done.get(key) && !t.syncBlocked) spawnRunner("sync", t.id, ["--force"]);
  }
}
// A detached job that belongs to no single task.
export function spawnLoose(args) {
  const env = { ...userEnv() };
  for (const k of ["HERDR_PLUGIN_EVENT", "HERDR_PLUGIN_EVENT_JSON", "HERDR_PLUGIN_CONTEXT_JSON", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"]) delete env[k];
  fs.mkdirSync(S.dataDir(), { recursive: true });
  const out = fs.openSync(path.join(S.dataDir(), "jobs.log"), "a");
  const child = spawn(process.execPath, [S.BIN, ...args], { detached: true, stdio: ["ignore", out, out], env, cwd: S.dataDir() });
  child.on("error", () => {});
  child.unref();
  fs.closeSync(out);
  return child.pid;
}

// ---- pull requests are watched: failed checks, a requested change or new feedback wake the agent; a merge made
// elsewhere marks the task done. Conflicts with main are found by the board's own sync (sync.js), not here. ------------------------------------------------------
// A task waiting on a login is the human's: pull-request feedback does not wake its agent until that is cleared. The
// blocker itself stays saved, so the next poll after the login wakes the agent in the usual way.
const needsLogin = (t) => !!t.failure?.auth || (t.stage === "asks" && t.kind === "auth");
const BAD = F.CHECK_BAD, GOOD = F.CHECK_GOOD;
export async function pollPrs() {
  try { fetchMains(); } catch {}
  for (const first of S.list()) {
    if (!first.pr || first.prMerged || runnerAlive(first) || (first.stage === "working" && !first.autoMerge) || needsLogin(first)) continue;
    const r = F.gh(["pr", "view", F.prNumber(first.pr), "--json", "state,reviewDecision,statusCheckRollup,author,comments,reviews,headRefOid"], S.folderOf(first.id), 60000);
    let j;
    try { j = JSON.parse(r.stdout); } catch { continue; }
    try { await pollOne(first.id, first.pr, j); } catch {}
  }
}
async function pollOne(id, pr, j) {
  let then = null;
  const { approvalMessage } = await import("./finish.js");
  // What was merged is the pull request's head, not whatever the local branch holds by now: a commit made here since
  // (never pushed, or pushed after the merge) landed nowhere, so its branch and worktree are not thrown away.
  const local = () => { try { const c = S.get(id); return c?.branch ? S.gitOut(S.folderOf(id), ["rev-parse", "--verify", `refs/heads/${c.branch}`]) : ""; } catch { return ""; } };
  const covered = (tip, head) => { if (!tip || tip === head) return true; if (!head) return false; try { S.gitOut(S.folderOf(id), ["merge-base", "--is-ancestor", tip, head]); return true; } catch { return false; } };
  let mode = "always", legacy = false;
  S.update(id, (t) => {
    if (t.archivedAt || t.pr !== pr || runnerAlive(t)) return false; // archived or active since the request started: next poll
    if (j.state === "MERGED") {
      mode = covered(local(), j.headRefOid || t.prHead || "") ? "always" : "merged";
      t.stage = "done"; t.tidy = F.tidyMark(t, mode); t.msg = `Merged: ${pr}`; t.failure = null; t.prFailure = null; t.prMerged = true; t.prState = "merged"; t.autoMerge = false; t.mergeIntent = null; t.seen = false;
      then = "merged";
      return;
    }
    // Closed without merging while its merge was awaited (taken out of the queue, closed by someone): GitHub will not
    // merge it any more, so the task says so and waits for you instead of claiming a merge is on its way.
    if (j.state === "CLOSED" && t.autoMerge) {
      t.autoMerge = false; t.autoMergeLocal = false; t.stage = "approval"; t.mergeFailed = true; t.mergeIntent = null; t.requireApproval = true; t.seen = false; t.prState = "closed";
      t.msg = "Pull request was closed without merging";
      Object.assign(t, S.failurePatch({ stage: "merge", title: t.msg, detail: `Pull request: ${pr}\nBranch: ${t.branch || "unknown"}\n\nGitHub reports it as closed, not merged. The approved merge did not happen.`, next: "Reopen the pull request (gh pr reopen) and approve again, or open a new one from the task's branch. Nothing was cleaned up; the work is still on its branch.", agentCanFix: false, auth: false }));
      then = "closed";
      return;
    }
    if (j.state !== "OPEN" || (t.stage === "working" && !t.autoMerge) || needsLogin(t)) return false;
    // A remembered merge is for the commit that was reviewed. The pull request has moved on (someone pushed to it):
    // the approval is withdrawn, and nothing merges until that has been checked and reviewed here.
    const reviewed = t.mergeIntent?.verifiedHead || t.prHead || "";
    if (t.autoMerge && reviewed && j.headRefOid && j.headRefOid !== reviewed) {
      legacy = !t.autoMergeLocal;
      t.autoMerge = false; t.autoMergeLocal = false; t.stage = "approval"; t.mergeFailed = true; t.mergeIntent = null; t.requireApproval = true; t.seen = false;
      t.msg = "Pull request has commits that were not reviewed";
      Object.assign(t, S.failurePatch({ stage: "merge", title: t.msg, detail: `Pull request: ${pr}\nBranch: ${t.branch || "unknown"}\nReviewed here: ${reviewed}\nOn the pull request: ${j.headRefOid}`, next: `Bring the pull request's commits into your own worktree (git pull origin ${t.branch || "<branch>"}), then finish again so they are checked and reviewed before anything merges.`, agentCanFix: true, auth: false }));
      then = "unreviewed";
      return;
    }
    if (t.prHead && j.headRefOid !== t.prHead) return false; // stale or unknown-head CI cannot resolve a pushed repair
    const failed = (j.statusCheckRollup || []).filter((c) => BAD.includes(String(c.conclusion || c.state || "").toUpperCase())).map((c) => c.name || c.context).filter(Boolean);
    // What others wrote on it (people or review bots), not the author: a new one is worth the agent's attention.
    const author = j.author?.login || "";
    const others = [...(j.comments || []), ...(j.reviews || []).filter((x) => String(x.body || "").trim() || x.state === "COMMENTED")].filter((x) => x.author?.login && x.author.login !== author);
    const feedback = JSON.stringify(others.map((x) => JSON.stringify([x.id || x.url || "", x.author.login, x.body || "", x.updatedAt || x.submittedAt || "", x.state || ""])).sort());
    const newFeedback = others.length > 0 && feedback !== (t.prFeedbackSeen ?? "[]");
    t.prFeedbackSeen = feedback;
    const reason = failed.length ? `Checks failed on the pull request ${pr}: ${failed.join(", ")}. Look at them (gh pr checks) and fix them on your branch.`
      : j.reviewDecision === "CHANGES_REQUESTED" ? `A reviewer asked for changes on the pull request ${pr}. Read the review (gh pr view --comments) and address it on your branch.` : "";
    const why = reason ? reason + (others.length ? " Comments are also available for context (gh pr view --comments)." : "")
      : newFeedback ? `New feedback on the pull request ${pr}. Read the comments (gh pr view --comments) and address what they ask for on your branch; if nothing needs changing, say so and finish.` : "";
    const blocking = failed.length > 0 || j.reviewDecision === "CHANGES_REQUESTED";
    const checks = j.statusCheckRollup || [];
    if (t.autoMerge && !blocking && !t.prFailure) {
      // The checks have passed (and a required review is there): the remembered merge is carried out now.
      const ready = t.autoMergeLocal && checks.every((c) => GOOD.includes(String(c.conclusion || c.state || "").toUpperCase())) && j.reviewDecision !== "REVIEW_REQUIRED";
      if (ready) { t.autoMerge = false; t.autoMergeLocal = false; t.msg = "merging"; then = "land"; }
      return;
    }
    const passed = checks.length > 0 && checks.every((c) => GOOD.includes(String(c.conclusion || c.state || "").toUpperCase()));
    t.prState = blocking ? "failing" : passed && j.reviewDecision !== "REVIEW_REQUIRED" ? "passing" : "waiting";
    // Keep the last remote blocker independently of local check/review success.
    if (blocking) {
      const remoteKind = failed.length ? "checks" : "review";
      const prev = t.prFailure;
      if (!(prev?.detail === why && prev?.remoteKind === remoteKind && prev?.head === j.headRefOid)) {
        t.prFailure = { stage: "pr", remote: true, remoteKind, head: j.headRefOid, title: failed.length ? "Pull request checks failed" : "Pull request changes requested", detail: why,
          next: "Address this on your own branch and finish again. Local checks do not prove remote CI passed; wait for a fresh remote result.", agentCanFix: true, at: Date.now(), sentAt: null };
      }
      if (t.stage === "approval" && !t.failure) { t.msg = `${t.prFailure.title}: ${why} Send details to the agent, or wait for remote confirmation.`; t.seen = false; }
    } else if (t.prFailure) {
      const confirmed = t.prFailure.remoteKind === "review" ? j.reviewDecision === "APPROVED" : t.prState === "passing";
      if (confirmed) {
        t.prFailure = null;
        if (t.stage === "approval" && !t.failure) { if (t.mergeIntent?.verifiedHead) { t.stage = "merging"; t.msg = "merging"; then = "land"; } else t.msg = approvalMessage(t); }
      }
    }
    const seen = blocking ? `${failed.join(",")}|${j.reviewDecision}` : "";
    if (seen === (t.prSeen || "") && !newFeedback) return;
    t.prSeen = seen;
    // Wakes the agent, in the background. Capped like the review loop, so the two cannot go round forever.
    if (why && then !== "land") {
      const went = t.prRounds || 0;
      if (!blocking) Object.assign(t, S.failurePatch({ stage: "pr", title: "Pull request feedback", detail: why, next: "Address this on your own branch, run the checks and finish again for review and approval.", agentCanFix: true, auth: false }));
      if (!t.autoMerge && went < S.choices(t).rounds && ["approval", "failed", "asks", "nosummary"].includes(t.stage)) { t.prRounds = went + 1; then = "wake"; }
      else if (t.stage === "approval" || t.autoMerge) t.msg = `${why} ${t.autoMerge ? "Auto-merge is blocked; send details to cancel pending auto-merge and repair safely." : "Automatic retries are exhausted; send details to the agent to try again."}`;
    }
  }, { waitMs: 10000 });
  if (then === "merged") { const t = S.get(id); F.labelPane(t, null); const { cleanupJob } = await import("./land.js"); await cleanupJob(id, { deleteBranch: mode }); }
  if (then === "merged") { const t = S.get(id); F.dropRemoteBranch(S.folderOf(id), t.branch, mode === "always" ? j.headRefOid || t.prHead || "" : ""); }
  if (then === "unreviewed") { const t = S.get(id); F.labelPane(t, "failed"); if (legacy) F.gh(["pr", "merge", F.prNumber(pr), "--disable-auto"], S.folderOf(id), 60000); }
  if (then === "closed") F.labelPane(S.get(id), "failed");
  if (then === "land") spawnRunner("land", id);
  if (then === "wake") {
    const { sendFailure } = await import("./actions.js");
    const rounds = S.get(id).prRounds;
    try { sendFailure(id); S.update(id, { prRounds: rounds }, { waitMs: 10000 }); } catch {} // a reply resets counters; this one is the plugin's
  }
}
