// The line: a repo's tasks merge one at a time. One catches up with main, is checked and merges, then the next.
// Without it every merge moves main under all the others at once: each catches up and runs the whole check, one of
// them merges, and the rest start over.
import * as S from "../store.js";
import { runnerAlive, spawnRunner } from "../runner.js";

// The stages of the last stretch: catching up with main, the check on the result, the push, the merge. A review is
// not one of them: a task that must be reviewed again lets the others pass and joins the line again afterwards.
const LAST_STRETCH = ["merging", "checking", "pushing"];
// At the head of the line: the turn is its own, taken by the very runner that is at work on it now. A turn left
// behind by a runner that ended (a merge that failed, a conflict that went back to the agent) is nobody's.
const atHead = (t) => !!t.lineTurn && t.lineTurn === t.runner?.started && runnerAlive(t) && LAST_STRETCH.includes(t.stage) && !t.archivedAt;
// Waiting in the line: it may merge, and another task goes first.
export const inLine = (t) => t.stage === "merging" && !!t.lineAt && !t.autoMerge && !t.archivedAt && !atHead(t);
const byArrival = (a, b) => a.lineAt - b.lineAt || String(a.id).localeCompare(String(b.id), "en", { numeric: true });
const ofRepo = (root) => S.list().filter((t) => !t.archivedAt && S.folderOf(t.id) === root);

// Asked by the land step before it catches up with main. True: this task goes now, and holds the turn until its
// runner ends. False: another task of the repo goes first, and this one waits where it is (the housekeeping pass
// starts it when its turn comes). Whoever joined the line first goes first.
export function takeTurn(id, g) {
  const root = S.folderOf(id);
  return S.withLock(`line:${root}`, () => {
    const me = g.check();
    if (atHead(me)) return true;
    const others = ofRepo(root).filter((t) => t.id !== id);
    const mine = { id, lineAt: me.lineAt || Date.now() };
    const first = others.find(atHead) || others.filter(inLine).sort(byArrival).find((t) => byArrival(t, mine) < 0);
    if (!first) { g.set((t) => { t.lineTurn = t.runner?.started || null; t.lineAt = null; }); return true; }
    g.set((t) => { t.lineTurn = null; t.lineAt = mine.lineAt; t.msg = waitingMsg(first.id); });
    return false;
  }, { waitMs: 10000 });
}
export const waitingMsg = (first) => `waiting to merge: ${first} goes first`;
// The line moves: where nobody is at the head, the task that waited longest is started. Called by the housekeeping
// pass, so the line moves with the board closed too.
export function linePass(tasks) {
  const roots = new Map();
  for (const t of tasks) { if (inLine(t)) roots.set(S.folderOf(t.id), null); }
  for (const root of roots.keys()) {
    try {
      const all = ofRepo(root);
      if (all.some(atHead)) continue;
      const next = all.filter(inLine).sort(byArrival)[0];
      if (next && !runnerAlive(next)) spawnRunner("land", next.id);
    } catch {} // tried again on the next pass
  }
}
