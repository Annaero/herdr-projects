// Keeping a task's branch current with main, in the task's own worktree. The board does this by itself, in code:
// before a finished turn is checked and reviewed, again whenever main moves while the task waits for you, and one
// last time after you approve (land.js). The agent hears about it only when a real conflict exists. A merge attempt
// that fails is always rolled back, and the human's checkout is never touched.
import fs from "node:fs";
import path from "node:path";
import * as S from "./store.js";
import * as F from "./flow.js";
import { outputOf } from "./runner.js";
import { mergesItself } from "./finish/auto-merge.js";

const git = S.gitOut;
const lines = (text) => String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);

// The branch main lives on at the remote: what the worktree started from, else origin's default, else main.
export function mainBranch(root, t) {
  const from = String(t.from || "");
  if (/^origin\/(?!HEAD$)/.test(from)) return from.slice(7);
  try { return git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).replace(/^origin\//, ""); } catch {}
  for (const b of ["main", "master"]) { try { git(root, ["rev-parse", "--verify", `refs/remotes/origin/${b}`]); return b; } catch {} }
  return "main";
}
// Where a task lands decides what "main" is for it. Through its pull request: the remote's main. Otherwise it is
// merged locally into the branch your checkout is on (also with a remote, when pull requests are off), and that
// branch is its main: tasks landed there are not at the remote yet.
export const viaRemote = (root, t) => !!t.pr || (S.setting("merge.pr", t) === true && F.hasOrigin(root));
// The branch a task's work lands on, in words, for the question that asks before a merge.
export function landsOn(t) { const root = S.folderOf(t.id); try { return (viaRemote(root, t) ? mainBranch(root, t) : S.branchOf(root)) || "main"; } catch { return "main"; } }
// The task's own worktree: the only place a sync ever merges. Empty for a task that works in the human's checkout.
export function treeOf(t) {
  const root = S.folderOf(t.id);
  return t.worktree && fs.existsSync(t.worktree) && path.resolve(t.worktree) !== path.resolve(root) ? t.worktree : "";
}
// A task the board may re-sync by itself when main moves: at rest, waiting for your approval, nothing else blocking.
export const resyncable = (t) => t.stage === "approval" && !t.archivedAt && !t.mergeIntent && !t.autoMerge && !t.failure && F.isAgentTask(t);
// Where main is known to stand, without asking the remote: cheap enough for every housekeeping pass. `cache` is
// one pass's answers, a repo asked once.
export function knownTarget(t, cache = null) {
  const root = S.folderOf(t.id), key = `${root}|${t.from || ""}`;
  if (cache?.has(key)) return cache.get(key);
  let sha = "";
  // For a task that lands locally the branch your checkout is on is part of the answer: another branch at the same commit is
  // still another place to land.
  try { sha = viaRemote(root, t) ? git(root, ["rev-parse", "--verify", `refs/remotes/origin/${mainBranch(root, t)}`]) : `${F.headOf(root) || git(root, ["rev-parse", "HEAD"])} ${S.branchOf(root)}`; } catch {}
  cache?.set(key, sha);
  return sha;
}

// Ask the remote where main is. The remote-tracking ref is named, so what git knows locally (knownTarget) is
// updated by every fetch, whatever the repo's own fetch settings are.
export function fetchMain(dir, b) {
  git(dir, ["fetch", "origin", `+refs/heads/${b}:refs/remotes/origin/${b}`], { timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
// Fetch main and merge it into the task's branch. Every result that looked at main carries `seen`: where main stood
// in the form knownTarget gives it, for exactly the commit that was merged here. Main moving on meanwhile (even
// during the merge) therefore still reads as "moved". Returns one of:
//   { status: "current" }   the branch already holds main
//   { status: "merged" }    a clean update that changed the commit; `overlap` lists the files both sides touched
//   { status: "conflict" }  rolled back; `files` are the conflicting ones
//   { status: "skip" }      nothing was tried (your checkout is on another branch); the caller holds the task
//   { status: "error" }     main could not be read (a failed fetch)
// For a task that lands locally "main" is the branch your checkout is on, and it follows the one it first saw there:
// checking out something else for a moment merges nothing into a task. While your checkout is elsewhere the task
// cannot be approved or merged either: it would land on a branch it was never brought up to date with.
// (A branch that no longer exists is not followed any more: the current one is adopted.)
export function syncMain(t, tree) {
  const root = S.folderOf(t.id);
  let target, base, onto = null, adopt = false;
  try {
    if (viaRemote(root, t)) { const b = mainBranch(root, t); fetchMain(tree, b); target = git(tree, ["rev-parse", "FETCH_HEAD"]); base = `origin/${b}`; }
    else {
      onto = S.branchOf(root);
      if (t.syncBranch && onto !== t.syncBranch) {
        let gone = false; try { git(root, ["rev-parse", "--verify", "-q", `refs/heads/${t.syncBranch}`]); } catch { gone = true; }
        if (!gone) return { status: "skip", onto, want: t.syncBranch };
        adopt = true;
      }
      target = F.headOf(root) || git(root, ["rev-parse", "HEAD"]); base = onto || "HEAD";
    }
  } catch (e) { return { status: "error", detail: outputOf(e) }; }
  const seen = onto === null ? target : `${target} ${onto}`;
  const before = F.headOf(tree);
  try { git(tree, ["merge-base", "--is-ancestor", target, "HEAD"]); return { status: "current", target, seen, base, onto, adopt, head: before }; } catch {}
  try { git(tree, ["merge", "--no-edit", target]); }
  catch (e) {
    let files = ""; try { files = git(tree, ["diff", "--name-only", "--diff-filter=U"]); } catch {}
    // Rolled back means: no merge is in progress any more and the branch is where it was.
    try { git(tree, ["merge", "--abort"]); } catch {}
    let restored = F.headOf(tree) === before;
    try { git(tree, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]); restored = false; } catch {}
    return { status: "conflict", files, restored, target, seen, base, onto, adopt, before, out: outputOf(e) };
  }
  const head = F.headOf(tree);
  // What the update changed here, against what the task itself changed. Unknown counts as overlapping. Renames are
  // not followed: a file main moved away counts under its old path too, so a task that edited it overlaps.
  let overlap = null;
  try {
    const theirs = new Set(lines(git(tree, ["diff", "--name-only", "--no-renames", before, head])));
    overlap = lines(git(tree, ["diff", "--name-only", "--no-renames", `${target}...${before}`])).filter((f) => theirs.has(f));
  } catch {}
  return { status: "merged", target, seen, base, onto, adopt, before, head, overlap };
}
// ---- only the merge of main? --------------------------------------------------------------------------------------------
// Has the branch, since the commit a review looked at, done nothing but take main in? Then that review still
// describes the task's own work, and only the tests need to run again (finish.js). The rule, checkable in git:
//   1. Every commit on the branch since the reviewed one is a merge commit with two parents: the branch as it was,
//      and a commit of main (`target`, or one it holds). No ordinary commit, no rebase, no other branch.
//   2. Each of those merges is what git itself makes of its two parents, file for file. Only the files git could not
//      merge by itself (the conflicts) may differ: resolving them is what the merge needed.
// Anything else, and anything that cannot be read, is "no": then the work is reviewed. The answer says why.
export function mergeOnly(tree, reviewed, target) {
  const no = (why) => ({ ok: false, why });
  const short = (c) => String(c).slice(0, 7);
  if (!tree || !reviewed || !target) return no("the reviewed commit or main is not known");
  try {
    const head = F.headOf(tree);
    if (!head || head === reviewed) return no("nothing was merged since the review");
    try { git(tree, ["merge-base", "--is-ancestor", reviewed, head]); } catch { return no("the branch no longer holds the reviewed commit"); }
    const chain = lines(git(tree, ["rev-list", "--first-parent", "--reverse", `${reviewed}..${head}`]));
    const resolved = new Set();
    let prev = reviewed;
    for (const c of chain) {
      const parents = git(tree, ["show", "-s", "--format=%P", c]).split(/\s+/).filter(Boolean);
      if (parents.length !== 2 || parents[0] !== prev) return no(`${short(c)} is new work, not a merge of main`);
      try { git(tree, ["merge-base", "--is-ancestor", parents[1], target]); } catch { return no(`${short(c)} merges something that is not main`); }
      // The same merge, made again by git in memory: the tree it gives, and the files it could not merge.
      let out = "";
      try { out = git(tree, ["merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", parents[0], parents[1]]); }
      catch (e) { if (e.status !== 1) return no(`the merge ${short(c)} could not be made again to compare`); out = String(e.stdout || ""); }
      const [auto, ...conflicts] = out.split("\0").map((x) => x.trim()).filter(Boolean);
      if (!/^[0-9a-f]{40,}$/.test(auto || "")) return no(`the merge ${short(c)} could not be made again to compare`);
      const differs = git(tree, ["diff", "--name-only", "--no-renames", "-z", auto, `${c}^{tree}`]).split("\0").filter(Boolean);
      const extra = differs.filter((f) => !conflicts.includes(f));
      if (extra.length) return no(`the merge ${short(c)} changes more than its conflicts needed (${extra.slice(0, 3).join(", ")}${extra.length > 3 ? ", …" : ""})`);
      for (const f of differs) resolved.add(f);
      prev = c;
    }
    if (!chain.length || prev !== head) return no("the reviewed commit is not on the branch's own line");
    return { ok: true, from: reviewed, head, merges: chain.length, resolved: [...resolved] };
  } catch (e) { return no(`git could not say (${S.oneLine(outputOf(e), 160)})`); }
}

// What a task remembers of a sync that was tried: where main stood for the commit that was really merged, so the
// housekeeping pass asks again whenever main is anywhere else.
// Only a sync that really looked counts as seen. One that could not read main (a failed fetch) or was not tried at
// all (the worktree was not at rest, or your checkout is on another branch) marks nothing: the housekeeping pass
// tries again after a pause, whether or not main moves in between. Until then the task is held as "behind main"
// (`syncBlocked`): it does not look ready, and an approval is refused.
const RETRY_MS = () => (process.env.HERDR_SUPERWORK_SYNC_RETRY_MS !== undefined ? Number(process.env.HERDR_SUPERWORK_SYNC_RETRY_MS) : 60000);
export const skipWhy = (r) => `your checkout is on ${r.onto || "no branch"}, not on ${r.want}, the branch this task lands on`;
export const behindMsg = (why) => `Behind main, and not up to date yet: ${why}. The board keeps trying; it cannot be approved until then`;
export function seenPatch(t, r) {
  if (!r || r.status === "error" || r.status === "skip") return { syncRetryAt: Date.now() + RETRY_MS() };
  const p = { syncSeen: r.seen, syncRetryAt: 0, syncBlocked: null };
  if (r?.target && (r.status === "current" || r.status === "merged")) { p.syncedTo = r.target; p.syncRepairs = 0; }
  if (r?.onto && (!t.syncBranch || r.adopt)) p.syncBranch = r.onto;
  return p;
}

// ---- a real conflict ---------------------------------------------------------------------------------------------------
// The saved failure: the row, the details and ctrl+r show and send it.
export function conflictFailure(t, tree, r) {
  return { stage: "merge", phase: "sync", target: r.target, base: r.base, agentCanFix: r.restored, auth: false,
    title: r.files ? "Merge conflict with main" : "Could not update task from main",
    detail: `Conflicting files:\n${r.files || "none reported"}\n\nTask branch: ${t.branch}\nTarget branch: ${r.base}\nTarget commit: ${r.target}\nWorktree: ${tree}\n\nGit output:\n${r.out}\n\n${r.restored ? "The private merge attempt was rolled back. The human's checkout is unchanged." : "The private merge could not be rolled back; inspect it before continuing."}`,
    next: `In ${tree} on ${t.branch}, merge target commit ${r.target} (${r.base}), resolve and commit the conflicts, then finish. The board checks the result again (and reviews it again, unless a review already passed and the merge is all that changed)${t.mergeIntent ? " and retries the approved merge" : ""}. Never alter the human's checkout.` };
}
// What the agent is told: the facts, and nothing else.
const passedBefore = (t) => !!S.passedReview(t) && !!S.commandOf(S.setting("check.command", t)) && !mergesItself(t);
export function conflictMessage(t, tree, r) {
  return `Your branch ${t.branch} conflicts with ${r.base}, so this is not done yet.\n\nConflicting files:\n${lines(r.files).map((f) => `- ${f}`).join("\n")}\n\nTarget commit: ${r.target} (${r.base})\n\nIn your own worktree (${tree}), merge that commit into ${t.branch}, resolve the conflicts, commit, and finish again. The board's own merge attempt was rolled back, so your branch is as you left it. Do not touch the human's checkout.${passedBefore(t) ? " Your work already passed its review: change only the conflicting files, in that one merge commit, and the board reruns the tests instead of reviewing everything again. Anything more is reviewed again." : ""}${t.mergeIntent ? " The human already approved this merge: after your repair the board checks, reviews and merges it; do not push or merge it yourself." : ""}`;
}
// The conflict goes straight back to the task's agent, as the plugin's own turn (so an approved merge survives the
// repair), at most `review.rounds` times in a row; after that, or when it cannot be sent, the human is asked.
// `held` puts the task where the human sees the blocker when nothing was sent.
export function conflictBack(id, g, tree, r, held) {
  const t = g.check();
  const rounds = S.setting("review.rounds", t), repairs = t.syncRepairs || 0;
  const failure = conflictFailure(t, tree, r);
  const can = !!r.files && r.restored && F.isAgentTask(t);
  let live = false;
  try { F.assertLive(t); live = !!F.h(t).agentGet(t.link.pane); } catch {}
  if (can && live && repairs < rounds) {
    const saved = S.failurePatch(failure);
    try {
      F.sendOwn(id, conflictMessage(t, tree, r), { reason: "conflict", keepIntent: !!t.mergeIntent, patch: { ...saved, failure: { ...saved.failure, sentAt: Date.now() }, ...seenPatch(t, r), syncRepairs: repairs + 1, mergeFailed: false, review: t.review ? { ...t.review, stale: true } : t.review } });
      // No approval to give while this is open: the row and herdr's sidebar say what the agent is doing instead.
      try { S.update(id, (t) => { if (t.stage !== "working" || t.expectedWake?.reason !== "conflict") return false; t.msg = "Resolving a conflict with main"; }, { waitMs: 10000 }); } catch {}
      return "sent";
    } catch {
      // The stage already says "working" but nothing went out: show the blocker instead of a turn that never comes.
      try { S.update(id, (t) => { t.stage = "failed"; t.expectedWake = null; t.msg = failure.title; Object.assign(t, S.failurePatch(failure)); }, { waitMs: 10000 }); } catch {}
      return "held";
    }
  }
  if (can && rounds > 0 && repairs >= rounds) {
    const a = g.set((t) => { Object.assign(t, S.failurePatch(failure), seenPatch(t, r)); t.stage = "asks"; t.kind = "question"; t.mergeFailed = false; t.msg = `The agent could not resolve the conflict with main after ${repairs} repairs. Full details are kept; you are needed`; });
    F.tellSidebar(a);
    return "asked";
  }
  held(failure, seenPatch(t, r));
  return "held";
}
