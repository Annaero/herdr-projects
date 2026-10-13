// The plan's turn ended: the board makes sure nothing was changed, takes the plan, and hands it to whoever approves it.
// Every turn that ends while the plan step is open is the plan's (the finish line asks here first: finish/pipeline.js),
// so nothing is committed, checked, pushed or reviewed as work before the yes. Who approves is `plan.approve` as it
// reads now: you (the task waits as "plan ready"), the reviewer (its look decides, plan/review.js), or nobody any
// more (the setting was taken off meanwhile: the build goes on).
import * as S from "../store.js";
import * as F from "../flow.js";
import * as G from "../gate.js";
import * as P from "../plan.js";
import { artifactBase } from "../review-page.js";
import { fail } from "../finish/shared.js";
import { putBack, undoneWords, heldFailure } from "./untouched.js";
import { reviewPlan, pointsOf } from "./review.js";
import { startBuild } from "./build.js";

// The plan's first line of words, for the row: a headline's marks taken off.
export const firstWords = (text) => S.oneLine((String(text || "").split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) || "").slice(0, 200));
// What the task keeps of a plan that was taken: when, its first words, its link.
const taken = (t, text) => ({ at: Date.now(), words: firstWords(text), file: "plan.md", link: P.planLink(t, () => artifactBase(t.id)) });

export async function planWritten(id, g, said) {
  let t = g.check();
  if (P.approved(t)) return void (await startBuild(id, g)); // it has its yes, and the build's start went wrong: that start, again
  // 1. Nothing changed. In the task's own worktree the board puts it back itself; in your checkout it goes back to
  //    the agent that changed it, `review.rounds` times, and then waits for you.
  const undone = putBack(t);
  if (undone === null) {
    const rounds = t.plan.undo || 0, failure = heldFailure(t);
    if (rounds >= S.setting("review.rounds", t)) return void fail(g, failure);
    return void F.sendOwn(id, `${failure.title}, so the plan is not taken yet.\n\n${S.boundDetail(failure.detail)}\n\n${failure.next}`, { reason: "plan", patch: { plan: { ...t.plan, undo: rounds + 1 } } });
  }
  // 2. The plan: the file its writer saved (or its program's plan mode handed over); failing that, its last message.
  //    A plan that went back and was not saved again since is the old one: then what its writer said last is the
  //    new plan, so an older file is never what gets the yes.
  let text = P.readPlan(t);
  const old = !!text && !!t.plan.was && P.planMark(t) === t.plan.was;
  if ((!text || old) && String(said || "").trim()) { P.writePlan(t, said); text = P.readPlan(t); }
  else if (old) text = "";
  if (!text) return void fail(g, { stage: "plan", auth: false, agentCanFix: true, title: "No plan was written", msg: "Stopped without a plan", detail: `The agent stopped, and there is no ${t.plan.was ? "new " : ""}plan in ${P.planFile(t)}.`, next: `Write the plan and save it as ${P.planFile(t)}, then stop.` });
  t = g.set((t) => { t.plan = { ...t.plan, was: undefined, ...taken(t, text), ...(undone.length ? { undone: { list: undone.slice(0, 30), n: undone.length, at: Date.now() } } : {}) }; t.failure = null; });
  // 3. Who says yes, as the setting reads now.
  const by = P.wanted(t);
  if (!by) return void (await startBuild(id, g, "nobody"));
  if (by === "reviewer") {
    const ch = S.work(t), r = await reviewPlan(id, g, ch);
    if (r.aborted) return;
    if (!r.review) return void fail(g, { stage: "plan", auth: r.auth ? true : undefined, title: r.auth ? "Needs a login" : "The plan's review failed", msg: r.auth ? "The reviewer needs a login" : `The plan's review failed: ${S.oneLine(r.error, 200)}. Retry to review it again`, detail: `The reviewer could not check the plan: ${r.error}`, next: "Investigate the reviewer failure, then retry: the plan is reviewed again." });
    t = g.set((t) => { t.plan = { ...t.plan, review: r.review }; });
    if (G.passes(r.review)) return void (await startBuild(id, g, "reviewer"));
    const rounds = t.plan.rounds || 0;
    // It goes back to its writer by itself, as failed work does; after that many times it is yours to judge.
    if (rounds < ch["review.rounds"]) return void F.sendOwn(id, P.backWords(t, pointsOf(r.review), "the reviewer"), { reason: "plan", patch: { plan: { ...t.plan, rounds: rounds + 1, was: P.planMark(t) } } });
  }
  ready(g, undone);
}
// "Plan ready": the task waits for your yes, with the plan's first words on its row.
export function ready(g, undone = []) {
  const t = g.set((t) => {
    const rv = t.plan.review;
    t.stage = "plan"; t.kind = "permission"; t.turnOpen = false; t.expectedWake = null; t.watch = null;
    t.msg = rv && !G.passes(rv) ? `The reviewer did not pass the plan (${G.tally(rv)}): yours to judge` : undone.length ? `${t.plan.words} · ${undoneWords(undone)}` : t.plan.words || "The plan is written";
  });
  F.tellSidebar(t);
  return t;
}
