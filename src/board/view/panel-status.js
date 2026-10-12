// The top of the task panel: the title, where the task stands, and what it needs from you.
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import { clean, age, prNumber, prCheck, prColor, idLabel, bar } from "./words.js";
import { reviewing, groupOf, waitOf, reviewerWord } from "./states.js";
import { roundWords, reviewNote } from "./review-words.js";

const ASKS = { question: "Asks you", permission: "Asks for your OK", auth: "Needs a login" };

export class PanelStatus {
  // Returns the title's part, the status lines, and what the callout already printed.
  panelStatus(p) {
    const { r, full, t, w, agent, failure, c, underReview, approval, dim, quiet, wrap, flow, first, callout, part } = p;
    // The title and where it stands: the mark and the group, then quietly who is on it, since when, and its id.
    // Under them the size of the change and its pull request, with a mark for its checks.
    const who = underReview ? "" : r.app ? (!agent && r.app === S.me() ? "you" : r.app) : "";
    const when = `${r.state === "working" ? "for " : ""}${age(Date.now() - (r.at || Date.now()))}${r.state === "working" ? "" : " ago"}`;
    const stand = flow([this.mark(r) + " " + t.fg(c, t.bold(r.archivedAt ? "archived" : underReview ? reviewerWord(r) : groupOf(r))), (reviewing(r) || r.stage === "approval") && roundWords(r) ? t.fg(c, roundWords(r)) : "", who && dim(who), dim(when), dim(idLabel(r.id))]);
    if (r.progress !== undefined && r.state !== "done") stand.push(t.fg(c, bar(r.progress, Math.min(24, w - 6))) + t.fg(c, ` ${r.progress}%${r.eta !== undefined ? ` ${r.eta}m` : ""}`));
    else if (r.eta !== undefined && r.state !== "done") stand.push(t.fg(c, `${r.eta}m`) + dim(" left"));
    const st = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(String(r.stat || ""));
    const size = st ? `${st[1]} file${st[1] === "1" ? "" : "s"}, +${st[2] || 0} −${st[3] || 0}` : clean(r.stat || "").trim();
    const url = /^https?:\/\/\S+$/.test(String(r.pr || "")) ? String(r.pr) : "";
    const prName = url ? `\x1b]8;;${url}\x1b\\${prNumber(r)}\x1b]8;;\x1b\\` : prNumber(r);
    const pr = r.pr ? t.fg(prColor(r), prName + (prCheck(r) ? ` ${prCheck(r)}` : "")) + (r.prMerged || r.prState === "merged" ? dim(" merged") : "") : "";
    const change = size || pr ? [...flow([size && quiet(size), pr]), ...(full && url ? wrapTextWithAnsi(dim(url), w) : [])] : [];
    const titleLines = wrapTextWithAnsi(t.bold(clean(r.title || "(no title)")), w);
    const top = part([...titleLines, ...stand, ...change]);

    // What it needs from you, or what is going on right now.
    const said = agent ? this.lastSaid(r) : "";
    const note = reviewNote(r);
    let told = ""; // what this part already printed, so "the agent said" does not repeat it
    const alert = (lines) => part(lines, { pri: 4, min: 2, at: (n) => first(lines, n) });
    if (r.archivedAt) part(callout("overlay0", "Archived", "Read-only. ? has restore. Its state and all its data are kept."));
    if (failure && waitOf(r)?.who === "agent") { // nothing to do: the board carries on by itself
      told = failure.detail;
      alert(callout(c, "Cut off, trying again by itself", `${note}. A reply, ctrl+r or ctrl+a tells the agent to continue right away.`, [["What cut it off", waitOf(r).error || failure.detail]]));
    } else if (failure) {
      told = failure.detail;
      alert(callout("red", failure.title, failure.sentAt ? "Sent to the agent. Kept here until it works." : failure.agentCanFix ? "The agent can fix this: ctrl+r sends it." : "This needs you first.", [["Next step", failure.next || "Find the cause and fix it."], ["What went wrong", failure.detail]]));
    } else if (approval && r.syncBlocked) alert(callout("peach", "Behind main, cannot be approved yet", `${r.syncBlocked.why}. The board keeps trying to bring it up to date.`));
    else if (approval) { /* the first line says it: ready to approve */ }
    else if (r.state === "blocked") { told = note || said || ""; alert(callout("red", ASKS[r.kind] || "Needs you", told)); }
    else if (r.state === "error") { told = (r.stage === "nosummary" ? r.screen : "") || note || said || "It failed."; alert(callout("red", r.stage === "nosummary" ? "Stopped without a summary" : "Went wrong", told)); }
    else if (r.state === "working" && note) alert(callout(c, underReview ? "The reviewer, now" : "Now", note));
    return { top, stand, told };
  }
}
