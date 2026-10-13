// Approval holds an older version left behind: tasks owing you a yes although you never stepped into them.
// Their failure or their review was sent back to the agent as it stood, and that used to count as stepping in. It no
// longer does, so no hold made from now on is ever lifted by the board. A hold from before is lifted only where the
// agent's own conversation proves that nothing of yours was ever said in it; where it cannot, you are asked.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import * as F from "../flow.js";
import * as G from "../gate.js";
import { promptsOf } from "../agents/prompts.js";

// The moment this rule first ran on this board, written down once. Only a task whose last turn began before it can
// carry a hold of the old kind.
function ruleSince() {
  const file = S.stampFile("send-back-is-no-hold");
  try { return Number(fs.readFileSync(file, "utf8")) || 0; } catch {}
  const now = Date.now();
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, String(now), { flag: "wx" }); } catch { try { return Number(fs.readFileSync(file, "utf8")) || 0; } catch { return 0; } }
  return now;
}
// Only one kind of message can be known for the board's own: a review. It is the very text the board makes of a
// review this task had, and the task still has every review, so it is compared letter for letter: nothing added,
// nothing left out. A failure's details, a failed check's output or a conflict's files are not kept once they are
// over, so a message that looks like one of those cannot be told from words of yours put in its shape: with one in
// the conversation the hold stays.
const reviewTexts = (t) => new Set(S.reviewHistory(t).filter((e) => !e.error).flatMap((e) => { try { return [G.reviewMessage(e), G.reviewMessage(e, { all: true })]; } catch { return []; } }));
// Messages that waited behind a dialog go out together, one after the other, each whole.
function boardsOwn(text, reviews) {
  if (reviews.has(text)) return true;
  for (const rv of reviews) { if (text.startsWith(`${rv}\n\n`)) return boardsOwn(text.slice(rv.length + 2), reviews); }
  return false;
}
// Was this task never stepped into? Its agent was told its task, once, before any review (so it was not delegated
// again), and after that only reviews of its own, as the board words them. Anything else (a reply, a turn typed in
// its terminal, a stop, any other message), or a conversation that cannot be read (only Claude Code's can be), and
// the answer is no.
export function neverSteppedInto(t) {
  const told = promptsOf(t.agent, t.transcript);
  if (!told?.length) return false;
  const [task, ...rest] = told, reviewed = S.reviewHistory(t)[0]?.at || 0, tail = F.promptTail(t), reviews = reviewTexts(t);
  if (!task.text.startsWith(`Work board task ${t.id}, role: agent.`) || !(task.at > 0) || !(reviewed > task.at)) return false;
  return rest.every((p) => {
    const text = tail && p.text.endsWith(`\n\n${tail}`) ? p.text.slice(0, -tail.length - 2) : p.text;
    return boardsOwn(text, reviews);
  });
}
// Looked at once for every turn of a task that holds.
export function liftOldHolds(tasks, socket) {
  let since = null;
  for (const seen of tasks) {
    const held = (t) => t.stage === "approval" && !!t.requireApproval && t.holdLooked !== (t.armedAt ?? 0) && !t.archivedAt && t.link?.socket === socket && F.isAgentTask(t) && S.setting("merge.by", t) === "itself";
    if (!held(seen)) continue;
    since ??= ruleSince();
    const free = (seen.armedAt || 0) < since && neverSteppedInto(seen);
    S.update(seen.id, (t) => { if (!held(t) || t.transcript !== seen.transcript) return false; t.holdLooked = t.armedAt ?? 0; if (free) t.requireApproval = false; }, { waitMs: 10000 });
  }
}
