// A research-only task at the finish line: a change in the repo goes back to its agent, and every task's report is kept.
import * as S from "../store.js";
import * as F from "../flow.js";
import * as R from "../research.js";
import { artifactBase } from "../review-page.js";
import { fail } from "./shared.js";

// Is this task research only, and did it keep to that? false: an ordinary task. true: research only and nothing
// changed. "back": it changed the repo (its worktree or its branch, committed or not). Then nothing is committed,
// pushed, opened or merged: the task goes back to its agent with what changed, as a round of the review loop, and
// after `rounds` of them it waits for the human with a line that says why.
export function researchOnly(id, g, tree) {
  let t = g.check();
  if (!R.isResearch(t)) return false;
  if (t.mergeIntent) t = g.set({ mergeIntent: null }); // a merge approved before the task became research only
  // Its own worktree, or your checkout when it works there: a folder that is no repo has nothing to compare.
  const cwd = S.cwdOf(t), dir = tree || (S.isRepo(cwd) ? cwd : "");
  const list = (dir && R.changesOf(t, dir)) || [];
  if (!list.length) return true;
  tree = dir;
  const rounds = t.reviewRounds || 0;
  if (rounds >= S.choices(t).rounds) { fail(g, R.changedFailure(t, tree, list, rounds)); return "back"; }
  const failure = S.failurePatch(R.changedFailure(t, tree, list)).failure;
  F.sendOwn(id, `This task is research only, and you changed the repo (${R.changedWords(list)}), so it is not done yet.\n\n${S.boundDetail(failure.detail)}\n\n${failure.next}\n\nThen finish again.`, { reason: "research", patch: { reviewRounds: rounds + 1, failure: { ...failure, sentAt: Date.now() } } });
  return "back";
}
// The report the agent left in its folder among the reports, for any task: given its link (research.js).
export function keptReport(g, ch) {
  const t = g.check();
  let report = t.report || null;
  try { report = R.keepReport(t, () => artifactBase(t.id, ch.serve)); } catch {}
  if (!report && !t.report) return t;
  if (report && t.report && report.file === t.report.file && report.link === t.report.link) return t;
  return g.set({ report });
}
