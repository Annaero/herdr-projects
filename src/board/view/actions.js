// What you do to the selected task: yes, send back, stop, delete, undo, archive.
import { truncateToWidth } from "@earendil-works/pi-tui";
import * as A from "../../actions.js";
import { herdr } from "../../herdr.js";
import { clean, prNumber } from "./words.js";
import { isAgent, failureFor } from "./states.js";
import { WIDE } from "./size.js";

export class Actions {
  // herdr's "approve the task in the focused pane" action lands here: the board opens on that task and asks first.
  takeApprove() {
    const id = A.takeApprove();
    const r = id && this.items.find((x) => x.id === id && !x.archivedAt);
    if (!r) return;
    this.menu = null; this.sel = r.id; this.load();
    this.yes(r);
  }
  toggleArchive() {
    if (!this.archiveView) {
      this.archiveBack = { sel: this.sel, top: this.top, filter: this.filter, mode: this.mode, value: this.value() };
      this.archiveView = true;
      this.filter = ""; this.mode = "new"; this.setValue(""); this.reply = false; this.full = false; this.top = 0;
    } else {
      this.archiveView = false;
      const back = this.archiveBack;
      if (back) { this.sel = back.sel; this.top = back.top; this.filter = back.filter; this.mode = back.mode; this.setValue(back.value); }
      this.reply = false; this.full = false;
      this.archiveBack = null;
    }
    this.load();
  }
  archiveSelected(r) {
    const action = r.archivedAt ? "restore" : "archive";
    if (r.host) return this.act(r, action);
    this.try(() => {
      if (action === "archive") { A.archive(r.id); this.archiveUndo = r; } else A.restore(r.id);
      this.reply = false; this.full = false;
      this.flash(action === "archive" ? `${r.id}: archived. ? has undo, and the archive.` : `${r.id}: restored.`, "green");
    });
  }
  // ---- what the keys do -------------------------------------------------------------------------------------------------
  // "Yes": whatever the selected task waits for. A merge cannot be undone, so that one asks first.
  yes(r) {
    if (r.archivedAt) return this.flash("Archived tasks are read-only. ? has restore.", "yellow");
    if (r.stage === "approval" && r.state === "blocked") {
      if (r.syncBlocked) return this.flash(`Behind main, so it cannot be approved yet: ${r.syncBlocked.why}. The board keeps trying to bring it up to date.`, "yellow");
      const mark = this.mergeMark(r.id), seen = { pr: r.pr ?? null, head: r.reviewedHead ?? null };
      return this.confirm(`Merge ${prNumber(r) || `"${truncateToWidth(clean(r.title || r.id), 32, "…")}"`}?`, () => (r.host ? this.act(r, "approve", { seen }) : this.try(() => { const out = A.approve(r.id, seen); this.flash(out.msg, "green"); })), () => this.mergeMark(r.id) === mark);
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
    if (r.archivedAt) return this.flash("Archived tasks are read-only. ? has restore.", "yellow");
    const failure = failureFor(r);
    if (failure && !failure.agentCanFix && !(r.stage === "failed" && r.failure?.auth)) return this.flash(`This needs you first. ${failure.next || ""}`, "yellow");
    if (r.host) return this.act(r, failure && failure.agentCanFix ? "fix" : r.state === "error" ? "retry" : "review");
    return this.try(() => { const out = failure && failure.agentCanFix ? A.sendFailure(r.id) : r.state === "error" ? A.sendError(r.id) : A.sendReview(r.id); this.flash(out.msg, "green"); });
  }
  stop(r) {
    const running = r.state === "working" && (isAgent(r) || r.stage === "progress") || r.stage === "queued" || (isAgent(r) && r.stage === "working");
    if (!running) return this.flash("No agent is working on this. ? has delete and archive.");
    this.stick = r.id; // the selection stays on this row: a second tap never lands on another task
    if (r.host) return this.act(r, "stop");
    return this.try(() => { A.stop(r.id); this.flash(`${r.id}: stopped.`, "yellow"); });
  }
  remove(r) {
    this.confirm(`Delete "${truncateToWidth(clean(r.title || r.id), 32, "…")}"? Its worktree goes too.`, () => {
      if (r.host) return this.act(r, "clear");
      A.clear(r.id).then((out) => { this.flash(out.kept.length ? `${r.id} deleted. Kept, so no work is lost: ${out.kept.join(", ")}` : `${r.id} deleted`, out.kept.length ? "yellow" : "overlay0"); this.load(); this.tui.requestRender(); }, (e) => { this.flash(e.message, "red"); this.tui.requestRender(); });
      this.flash(`${r.id}: deleting…`);
    });
  }
  undo() {
    // A draft comes back to whoever it was for: a reply stays a reply to that task, never a new task.
    if (this.draftAway) {
      const d = this.draftAway;
      // Its task is gone: the words are not lost, and not turned into something else unasked. A second ctrl+z says so.
      if (d.to && !this.items.some((r) => r.id === d.to && !r.archivedAt)) {
        if (!d.warned) { d.warned = true; return this.flash("The task that reply was for is gone. ctrl+z again brings the words back as a draft of their own.", "yellow"); }
        d.to = "";
      }
      this.draftAway = null;
      if (d.to) { this.sel = d.to; this.replyId = d.to; this.reply = true; if (this.width < WIDE) { this.full = true; this.panelTop = 0; } }
      else if (this.reply || this.full) this.closePanel();
      this.setValue(d.text); this.load();
      return;
    }
    const r = this.archiveUndo; this.archiveUndo = null;
    if (!r) return this.flash("Nothing to undo.");
    if (r.host) return this.act(r, "restore");
    return this.try(() => { A.restore(r.id); this.flash(`${r.id}: restored`, "green"); });
  }
}
