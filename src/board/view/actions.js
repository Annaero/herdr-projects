// What you do to the selected task: yes, send back, stop, remove, undo, archive.
import fs from "node:fs";
import { truncateToWidth } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import * as A from "../../actions.js";
import * as G from "../../gate.js";
import { herdr } from "../../herdr.js";
import { clean, prNumber, short } from "./words.js";
import { isAgent, failureFor, failedReview } from "./states.js";
import { reviewTally } from "../../status-words.js";
import { landsOn } from "../../sync.js";
import { name as keyName } from "../keys.js";

// The stages in which a task's agent (or its reviewer) is alive in its pane. "asks": it waits for your answer.
const LIVE_STAGES = [...S.SLOT_STAGES, "asks"];

export class Actions {
  // herdr's "approve the task in the focused pane" action lands here: the board opens on that task and asks first.
  takeApprove() {
    const id = A.takeApprove(undefined, this.ctx.ownPane);
    const r = id && this.items.find((x) => x.id === id && !x.archivedAt);
    if (!r) return;
    this.menu = null; this.sel = r.id; this.load();
    this.yes(r);
  }
  toggleArchive() {
    if (!this.archiveView) {
      this.archiveBack = { sel: this.sel, top: this.top, filter: this.filter, mode: this.mode, value: this.value() };
      this.archiveView = true;
      this.filter = ""; this.mode = "new"; this.setValue(""); this.full = false; this.top = 0;
    } else {
      this.archiveView = false;
      const back = this.archiveBack;
      if (back) { this.sel = back.sel; this.top = back.top; this.filter = back.filter; this.mode = back.mode; this.setValue(back.value); }
      this.full = false;
      this.archiveBack = null;
    }
    this.load();
  }
  archiveSelected(r) {
    const action = r.archivedAt ? "restore" : "archive";
    if (r.host) return this.act(r, action);
    this.try(() => {
      if (action === "archive") { A.archive(r.id); this.archiveUndo = r; } else A.restore(r.id);
      this.full = false;
      // The task left the list, so the selection went to its neighbour: the message says which.
      this.load();
      const next = this.current(), on = next && next.id !== r.id ? ` Now on ${this.nameSay(next)}.` : "";
      this.flash(action === "archive" ? `Archived ${this.nameSay(r)}. ${keyName("undo")} undoes it; ${keyName("archiveView")} shows the archive.${on}` : `Restored ${this.nameSay(r)}.${on}`, "green");
    });
  }
  // ---- what the keys do -------------------------------------------------------------------------------------------------
  // "Yes": whatever the selected task waits for. A merge cannot be undone, so that one asks first.
  yes(r) {
    if (r.archivedAt) return this.flash(`Archived tasks are read-only. ${keyName("archive")} restores.`, "yellow");
    if (r.stage === "approval" && r.state === "blocked") {
      if (r.syncBlocked) return this.flash(`Behind main, so it cannot be approved yet: ${r.syncBlocked.why}. The board keeps trying to bring it up to date.`, "yellow");
      // The question names what is merged, where it lands and that it cannot be undone. After a failed review the
      // yes is "merge anyway", and only that yes carries the word the approve action asks for.
      const mark = this.mergeMark(r.id), seen = { pr: r.pr ?? null, head: r.reviewedHead ?? null }, failed = failedReview(r), tally = failed ? reviewTally(r) : "";
      // Another machine's task lands on that machine: it says on which branch (an older one there does not: then the
      // question still says where, as far as this side knows).
      const onto = r.host ? `${r.snap?.landsOn || "its main branch"} on ${clean(r.host)}` : landsOn(r), more = { anyway: failed };
      const what = [this.numberTag(r), `"${clean(r.title || r.id)}"`].filter(Boolean).join(" "); // (the machine is named with where it lands)
      return this.confirm(`Merge ${what}${prNumber(r) ? ` (${prNumber(r)})` : ""} into ${onto}?`,
        () => (r.host ? this.act(r, "approve", { seen, ...more }) : this.try(() => { const out = A.approve(r.id, seen, more); this.flash(out.msg, "green"); })), () => this.mergeMark(r.id) === mark,
        { danger: true, keys: [["sayYes", failed ? "merge anyway" : "merge"], ["sayNo", "do not merge"]], detail: `${failed ? `Its last review failed${tally ? `: ${tally}` : ""}. ` : ""}A merge cannot be undone.` });
    }
    if (isAgent(r) && r.state === "blocked" && r.kind === "permission") return r.host ? this.act(r, "approve") : this.try(() => { const out = A.approve(r.id); this.flash(out.msg, "green"); });
    // Stopped without a summary: yes takes the work as it is, through the check and the review.
    if (r.stage === "nosummary") return r.host ? this.act(r, "finish") : this.try(() => { const out = A.finishAnyway(r.id); this.flash(out.msg, "green"); });
    // Something went wrong: yes tries the same step again, as it stands (ctrl+r is the one that asks the agent to fix it).
    if (r.stage === "failed" || (r.stage === "asks" && r.kind === "auth")) return r.host ? this.act(r, "again") : this.try(() => { const out = A.retry(r.id); this.flash(out.msg, "green"); });
    this.flash("Nothing here waits for a yes.");
  }
  // "Send it back": whatever went wrong (a failed step, a conflict, the review) goes to the task's agent to fix.
  sendBack(r) {
    if (r.archivedAt) return this.flash(`Archived tasks are read-only. ${keyName("archive")} restores.`, "yellow");
    const failure = failureFor(r);
    if (failure && !failure.agentCanFix && !(r.stage === "failed" && r.failure?.auth)) return this.flash(`This needs you first. ${failure.next || ""}`, "yellow");
    // Nothing went wrong and no review has anything for the agent: a key that does nothing here says so quietly.
    if (!failure && r.state !== "error" && !(r.review?.text && G.sendable(r.review))) return this.flash("Nothing to send back here.");
    if (r.host) return this.act(r, failure && failure.agentCanFix ? "fix" : r.state === "error" ? "retry" : "review");
    return this.try(() => { const out = failure && failure.agentCanFix ? A.sendFailure(r.id) : r.state === "error" ? A.sendError(r.id) : A.sendReview(r.id); this.flash(out.msg, "green"); });
  }
  // An agent is on it right now: at work, in a step of the finish line, waiting for you to answer it, or waiting
  // for a free slot. That is what the stop key stops; anything else has no agent running.
  running(r) { return r.state === "working" && (isAgent(r) || r.stage === "progress") || r.stage === "queued" || (isAgent(r) && LIVE_STAGES.includes(r.stage)); }
  // Stop the agent while one runs. On a task with none running (idle, never started, stopped, finished) the same key
  // asks to remove the task. A stop never goes on to that question by itself: that takes the key again, and a yes.
  stop(r) {
    if (!this.running(r)) return this.remove(r);
    this.stick = r.id; // the selection stays on this row: a second tap never lands on another task
    if (r.host) return this.act(r, "stop");
    return this.try(() => { A.stop(r.id); this.flash(`Stopped ${this.nameSay(r)}.`, "yellow"); });
  }
  // The question shows the whole title and what is really lost: the task with all it holds, and its worktree only
  // where it has one (a checkout with unsaved or unmerged work is kept, and the board then says where).
  remove(r) {
    const tree = r.host ? r.snap?.tree : r.worktree && fs.existsSync(r.worktree) ? r.worktree : "";
    const lost = `This cannot be undone. The task goes, with its description${r.review || r.reviewRound ? ", its reviews" : ""} and what its agent said${this.running(r) ? "; its agent is stopped" : ""}. ${tree ? `Its worktree ${short(tree)} goes too; work in it that is not saved or not merged is kept.` : "It has no worktree."}${r.archivedAt ? "" : ` ${keyName("archive")} only archives it.`}`;
    this.confirm(`Remove ${this.nameSay(r, Infinity)}?`, () => {
      if (r.host) return this.act(r, "clear");
      A.clear(r.id).then((out) => { this.flash(out.kept.length ? `Removed ${this.nameSay(r)}. Kept, so no work is lost: ${out.kept.join(", ")}` : `Removed ${this.nameSay(r)}.`, out.kept.length ? "yellow" : "overlay0"); this.load(); this.tui.requestRender(); }, (e) => { this.flash(e.message, "red"); this.tui.requestRender(); });
      this.flash(`Removing ${this.nameSay(r)}…`);
    }, null, { danger: true, keys: [["sayYes", "remove"], ["sayNo", "keep"]], detail: lost });
  }
  undo() {
    // A draft comes back only to whoever it was for: a reply stays a reply to that task, never a new task. ctrl+z
    // never changes who you talk to (that is space's, and the arrows' while you talk to an agent): when the chat
    // names somebody else, it says who the words were for and how to get there, and the words stay put away.
    if (this.draftAway) {
      const d = this.draftAway;
      // Its task is gone: the words are not lost, and not turned into something else unasked. A second ctrl+z says so.
      if (d.to && !this.items.some((r) => r.id === d.to && !r.archivedAt)) {
        if (!d.warned) { d.warned = true; return this.flash(`The task that reply was for is gone. ${keyName("undo")} again brings the words back as a draft of their own.`, "yellow"); }
        d.to = "";
      }
      const now = this.reply && this.current() ? this.sel : "";
      if (d.to !== now) {
        const name = d.to ? `"${truncateToWidth(clean(this.items.find((r) => r.id === d.to)?.title || d.to), 40, "…")}"` : "";
        return this.flash(!d.to ? `Those words were for the Coordinator. ${keyName("talk")} goes back to it, then ${keyName("undo")} brings them back.`
          : now ? `Those words were for ${name}. Move to it, then ${keyName("undo")} brings them back.`
          : `Those words were for the agent on ${name}. Select it and press ${keyName("talk")}, then ${keyName("undo")} brings them back.`, "yellow");
      }
      this.draftAway = null;
      this.awayHome(d); // the popup, reopened in another repo since: back to the one these words were typed for
      this.setValue(d.text); this.load();
      return;
    }
    const r = this.archiveUndo; this.archiveUndo = null;
    if (!r) return this.flash("Nothing to undo.");
    if (r.host) return this.act(r, "restore");
    return this.try(() => { A.restore(r.id); this.flash(`Restored ${this.nameSay(r)}.`, "green"); });
  }
}
