// The attempts in the task panel, for a task done several times at once: the reviewer's comparison with its
// recommendation on top, then each attempt with its agent, where it stands, its time, its tokens, the size of its
// change, what the reviewer said of it and a link to its diff (or its report). The selected one is marked.
import { artifactRows } from "../artifact-lines.js";
import { standingOf, markOf, agentWord } from "../../attempts/words.js";
import { age, tokens, short } from "./words.js";
import { name as keyName } from "../keys.js";

// "3 files changed, 10 insertions(+), 2 deletions(-)" -> "3 files · +10 −2".
export const sizeOf = (stat) => {
  const n = (re) => Number((re.exec(String(stat || "")) || [])[1] || 0), files = n(/(\d+) files? changed/);
  return files ? `${files} file${files === 1 ? "" : "s"} · +${n(/(\d+) insertions?/)} −${n(/(\d+) deletions?/)}` : "";
};
const BY = { you: "by you", reviewer: "by the reviewer", check: "the only one that passed" };

export class PanelAttempts {
  panelAttempts(p) {
    const { r, full, t, w, room, dim, wrap, head, flow, fact, part, c: color } = p;
    const tries = r.tries || [];
    if (!tries.length) return;
    const passed = tries.filter((c) => standingOf(c) === "passed"), cmp = r.comparison, sel = this.choosing(r) ? this.attemptSel(r) : "";
    const lines = [r.stage === "pick" ? head(`Pick one of ${passed.length}`, color) : head("Attempts")];
    if (r.picked) lines.push(...fact("Chosen", `${r.picked.letter} · ${BY[r.picked.by] || r.picked.by}`));
    if (cmp?.pick) lines.push(...fact("Reviewer", wrap(`recommends ${cmp.pick}${cmp.why ? `: ${cmp.why}` : ""}`, room)));
    else if (cmp?.error) lines.push(...fact("Reviewer", wrap(`no comparison: ${cmp.error}`, room), (l) => t.fg("yellow", l)));
    else if (r.stage === "reviewing" && r.comparing) lines.push(...fact("Reviewer", dim("is comparing them")));
    const now = Date.now();
    // Beside the list, once the choice is made, each attempt is one fact: what the reviewer said of it and its link
    // are on the full screen.
    const short_ = !full && r.stage !== "pick";
    for (const c of tries) {
      const st = standingOf(c), spec = (r.attempts || []).find((a) => a.letter === c.letter)?.agent || agentWord(c);
      const word = markOf(c, now).slice(`${c.letter} ${agentWord(c)} `.length);
      const where = st === "passed" ? t.fg("green", c.checked === false ? "✓ finished" : "✓ passed the check") : st === "out" ? t.fg("red", word) : st === "needs" ? t.fg("red", word) : t.fg("yellow", word);
      const used = c.usage ? `${tokens((c.usage.in || 0) + (c.usage.out || 0))} tokens` : "";
      const time = age(((["passed", "out"].includes(st) && (c.triedAt || c.at)) || now) - (c.since || c.created || now));
      const facts = flow([t.bold(spec), where, time, used, sizeOf(c.stat)].filter(Boolean), room);
      if (cmp?.notes?.[c.letter] && !short_) facts.push(...wrap(cmp.notes[c.letter], room).map((l) => dim(l)));
      if (st === "out" && c.failure?.title && full) facts.push(...wrap(c.failure.title, room).map((l) => dim(l)));
      const link = c.report?.link ? { link: c.report.link, caption: "Open its report" } : c.diff?.link ? { link: c.diff.link, caption: "Open its diff" } : null;
      if (link && !short_) facts.push(...artifactRows(t, { ...link, detail: full ? short(c.worktree || "") : "" }, room, full));
      else if (full && c.worktree) facts.push(dim(short(c.worktree)));
      const mark = c.letter === sel ? " ›" : r.picked?.letter === c.letter || (!r.picked && cmp?.pick === c.letter) ? " ★" : "";
      lines.push(...fact(`${c.letter}${mark}`, facts).map((l, n) => (n === 0 && c.letter === sel ? t.bold(l) : l)));
    }
    if (r.stage === "pick") lines.push(...wrap(`${keyName("nextAttempt")} moves to the next attempt, ${keyName("yes")} keeps the one marked ›, ${keyName("enter")} goes into its tab.`, w).map((l) => dim(l)));
    // Short of room it gives up lines from its end, like every long part: while it waits for you, last of all.
    part(lines, r.stage === "pick" ? { alert: (n) => p.first(lines, n) } : { pri: 3, min: 3, at: (n) => (n < 3 ? [] : p.first(lines, n)) });
    return short_ && !!(cmp?.pick || tries.some((c) => c.diff?.link || c.report?.link)); // something is shorter here than on the full screen
  }
}
