// A task done several times at once, on the board: which of its attempts is selected, moving to the next one, and
// choosing it. The approve key on the selected attempt picks it; going into the task's agent goes into that attempt's.
import * as A from "../../actions.js";
import { standingOf, agentWord } from "../../attempts/words.js";
import { clean } from "./words.js";

export class Attempts {
  triesOf(r) { return (r && !r.archivedAt && r.tries) || []; }
  // Is there still a choice among them: its attempts are under way, or it waits for a pick.
  choosing(r) { return this.triesOf(r).length > 1 && !r.picked && ["attempts", "pick", "reviewing"].includes(r.stage); }
  // The selected attempt's letter: the one you moved to, else the reviewer's choice, else the first that passed.
  attemptSel(r) {
    const tries = this.triesOf(r), at = (this.attemptAt ||= {})[r.id];
    if (tries.some((c) => c.letter === at)) return at;
    const passed = tries.filter((c) => standingOf(c) === "passed").map((c) => c.letter);
    return (passed.includes(r.comparison?.pick) && r.comparison.pick) || passed[0] || tries[0]?.letter || "";
  }
  attemptNow(r) { const letter = this.attemptSel(r); return this.triesOf(r).find((c) => c.letter === letter) || null; }
  nextAttempt(r) {
    const tries = this.triesOf(r);
    if (!tries.length) return;
    const n = tries.findIndex((c) => c.letter === this.attemptSel(r));
    (this.attemptAt ||= {})[r.id] = tries[(n + 1) % tries.length].letter;
  }
  // Your pick. It asks first: the other attempts' tabs close with it.
  pickSelected(r) {
    const c = this.attemptNow(r);
    if (!c) return this.flash("This task has no attempts.");
    if (standingOf(c) !== "passed") return this.flash(`Attempt ${c.letter} did not pass the check, so it cannot be kept. Move to one that passed.`, "yellow");
    const letter = c.letter;
    return this.confirm(`Keep attempt ${letter} (${agentWord(c)}) of ${this.numberTag(r)} "${clean(r.title || r.id)}"?`,
      () => (r.host ? this.act(r, "pick", { letter }) : this.try(() => { const out = A.pick(r.id, letter); this.flash(out.msg, "green"); })), () => true,
      { keys: [["sayYes", `keep ${letter}`], ["sayNo", "not yet"]], detail: "Only this one is reviewed, pushed and merged. The other attempts' tabs close; their worktrees stay until the task is done." });
  }
}
export const part = Attempts; // what this file adds to the board: view.js loads every file here that names its part
