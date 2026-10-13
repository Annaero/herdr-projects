// The attempts are through: the check filtered, now the picker chooses. None passed: the task failed, with every
// attempt kept to look at. One passed: it is the winner and nobody is asked. Several: `attempts.pick`, read now,
// says who chooses. `you`: the task waits as "pick one", with the reviewer's comparison when there is a reviewer.
// `reviewer`: the reviewer compares them and names one, and that one goes on by itself.
import * as S from "../store.js";
import * as F from "../flow.js";
import { runnerAlive, spawnRunner } from "../runner.js";
import { standingOf, outWhy, agentWord, pickLine } from "./words.js";
import { adopt } from "./adopt.js";
import { name as keyName } from "../board/keys.js";

// Called by the housekeeping pass for every task whose attempts are under way.
const LOST_MS = 60000;
export function settlePass(tasks, socket, now = Date.now()) {
  for (const t of tasks) {
    if (t.archivedAt || t.link?.socket !== socket || runnerAlive(t)) continue;
    if (t.stage === "attempts") { try { settle(t.id, now); } catch {} }
    // A comparison whose runner is gone (the machine restarted): nobody will name one, so the task waits for your pick.
    else if (t.stage === "reviewing" && t.comparing && now - (t.comparing.at || 0) > LOST_MS) { try { toPick(t.id, { error: "the comparison stopped before the reviewer named an attempt" }, "reviewing"); } catch {} }
  }
}
export function settle(id, now = Date.now()) {
  const t = S.get(id);
  if (!t || t.stage !== "attempts") return t;
  const kids = S.attemptsOf(t), st = kids.map((c) => standingOf(c, now));
  if (!kids.length || st.some((s) => ["works", "waits", "needs"].includes(s)) || kids.some((c) => runnerAlive(c))) return t;
  const passed = kids.filter((c, n) => st[n] === "passed");
  if (!passed.length) {
    const lines = kids.map((c) => `${c.letter} ${agentWord(c)}: ${outWhy(c)}${c.failure?.title ? ` (${c.failure.title})` : ""}`);
    const f = S.update(id, (t) => {
      if (t.stage !== "attempts") return false;
      t.stage = "failed"; t.msg = `No attempt passed: ${lines.join(" · ")}`;
      Object.assign(t, S.failurePatch({ stage: "attempts", auth: false, agentCanFix: false, title: "No attempt passed", detail: `All ${kids.length} attempts are out:\n${lines.map((l) => `- ${l}`).join("\n")}\n\nEach one's worktree, branch and tab are kept, to look at.`, next: `Look at what each attempt did in its tab. Delegate the task again to start over with fresh attempts (${keyName("delegate")}); the old ones are removed then.` }));
    }, { waitMs: 10000 });
    return f;
  }
  if (passed.length === 1) return adopt(id, passed[0].letter, "check");
  // Read now, as this step starts: who picks, and whether there is a reviewer to compare them.
  const pick = S.setting("attempts.pick", t), reviewer = S.setting("review.when", t) !== "never";
  if (reviewer) {
    const c = S.update(id, (t) => { if (t.stage !== "attempts") return false; t.stage = "reviewing"; t.comparing = { pick, at: Date.now() }; t.reviewAt = Date.now(); t.msg = "Comparing the attempts"; t.watch = null; t.comparison = null; }, { waitMs: 10000 });
    if (c.stage === "reviewing" && c.comparing) spawnRunner("compare", id);
    return c;
  }
  return toPick(id, pick === "reviewer" ? { error: "attempts.pick is reviewer, but review.when is never: there is no reviewer to choose" } : null);
}
// The task waits for you to choose. `comparison`: what the reviewer said of the attempts, or why it said nothing.
export function toPick(id, comparison = null, from = "attempts") {
  const t = S.update(id, (t) => {
    if (t.stage !== from) return false;
    if (comparison) t.comparison = comparison;
    t.stage = "pick"; t.comparing = null; t.watch = null; t.kind = "permission"; t.msg = pickLine(t);
  }, { waitMs: 10000 });
  return t;
}
// Your choice (the approve key on an attempt, or `herdr-superwork pick <id> <letter>`). With no letter: the one the
// reviewer recommends, when it recommended one.
export function pick(id, letter = "") {
  const t = S.find(id);
  S.assertUnarchived(t);
  if (t.stage !== "pick") throw new Error(t.attempts?.length ? `${t.id} does not wait for a pick${t.picked ? `: attempt ${t.picked.letter} was chosen` : t.stage === "attempts" ? ": its attempts are still under way" : ""}.` : `${t.id} was not done in several attempts.`);
  const kids = S.attemptsOf(t), passed = kids.filter((c) => standingOf(c) === "passed"), want = String(letter || t.comparison?.pick || "").toUpperCase();
  const names = passed.map((c) => c.letter).join(", ");
  if (!want) throw new Error(`Say which attempt: herdr-superwork pick ${t.id} <${passed.map((c) => c.letter).join("|")}>.`);
  const kid = passed.find((c) => c.letter === want);
  if (!kid) throw new Error(kids.some((c) => c.letter === want) ? `Attempt ${want} did not pass the check, so it cannot be chosen. Those that passed: ${names}.` : `${t.id} has no attempt ${want}. Those that passed: ${names}.`);
  return { task: adopt(t.id, want, "you"), msg: `${t.id}: attempt ${want} (${agentWord(kid)}) chosen. It goes on to review; the other attempts' tabs close.` };
}
