// The top of the task panel: the title, where the task stands under its Status headline, and what it needs from you.
import * as S from "../../store.js";
import { clean, age, prNumber, prTag, merged, idLabel, bar } from "./words.js";
import { reviewing, groupOf, waitOf, reviewerWord } from "./states.js";
import { roundWords, reviewNote } from "./review-words.js";
import { name as keyName } from "../keys.js";

const ASKS = { question: "Asks you", permission: "Asks for your OK", auth: "Needs a login" };
// The facts under Status, in the order they are drawn. In a short window they go from the last of GIVE.
const ORDER = ["head", "state", "progress", "now", "who", "change", "task"];

export class PanelStatus {
  // Returns the title's part, the status part (its facts by name in `rows`, redrawn by `draw`), and what the part
  // about what it needs from you already printed.
  panelStatus(p) {
    const { r, full, t, room, agent, failure, c, underReview, approval, dim, quiet, wrap, head, flow, fact, alert, part } = p;
    const title = part(wrap(r.title || "(no title)").map((l) => t.bold(l)));
    // Where it stands, one fact a row. The state with its mark and since when; the progress; what it is doing right
    // now, wrapped whole; who is on it; the change, its pull request in the colour of its checks; the task's id.
    const when = `${r.state === "working" ? "for " : ""}${age(Date.now() - (r.at || Date.now()))}${r.state === "working" ? "" : " ago"}`;
    const rows = { head: [head("Status")] };
    rows.state = fact("State", flow([this.mark(r) + " " + t.fg(c, t.bold(r.archivedAt ? "archived" : underReview ? reviewerWord(r) : groupOf(r))), (reviewing(r) || r.stage === "approval") && roundWords(r) ? t.fg(c, roundWords(r)) : "", dim(when)]));
    const pct = ` ${r.progress}%`, eta = r.eta !== undefined ? `${r.eta}m left` : ""; // the bar takes what the numbers leave
    const beside = room - pct.length - (eta ? eta.length + 3 : 0); // with the minutes left on the same line, when a bar still fits
    if (r.progress !== undefined && r.state !== "done") rows.progress = fact("Progress", flow([t.fg(c, bar(r.progress, Math.max(1, Math.min(24, beside >= 8 ? beside : room - pct.length))) + pct), eta && t.fg(c, eta)]));
    else if (eta && r.state !== "done") rows.progress = fact("Progress", t.fg(c, eta));
    const note = reviewNote(r);
    if (r.state === "working" && note && !(failure && waitOf(r)?.who === "agent")) rows.now = fact("Now", wrap(note, room));
    const who = underReview ? "" : r.app ? (!agent && r.app === S.me() ? "you" : r.app) : "";
    if (who) rows.who = fact("On it", clean(who), quiet);
    const st = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(String(r.stat || ""));
    const size = st ? `${st[1]} file${st[1] === "1" ? "" : "s"}, +${st[2] || 0} −${st[3] || 0}` : clean(r.stat || "").trim();
    const url = /^https?:\/\/\S+$/.test(String(r.pr || "")) ? String(r.pr) : "";
    const prName = url ? `\x1b]8;;${url}\x1b\\${prNumber(r)}\x1b]8;;\x1b\\` : prNumber(r);
    const pr = r.pr ? prTag(t, r, prName) + (merged(r) ? dim(" merged") : "") : "";
    if (size || pr) rows.change = fact("Change", [...flow([pr, size && quiet(size)]), ...(full && url ? [dim(url)] : [])]);
    rows.task = fact("Task", idLabel(r.id), quiet);
    if (!agent && !r.archivedAt && r.state === "idle" && !String(r.description || "").trim()) rows.next = fact("Next", wrap(`No agent is on this yet. ${keyName("delegate")} puts one on it.`, room), dim);
    const top = part([], { rows });
    top.draw = () => { top.lines = [...ORDER, "next"].flatMap((k) => rows[k] || []); return top; };
    top.drop = (...keys) => { for (const k of keys) delete rows[k]; return top.draw(); };
    top.draw();

    // What it needs from you: a part of its own, its headline in the state's colour.
    const said = agent ? this.lastSaid(r) : "";
    let told = ""; // what this part already printed, so "the agent said" does not repeat it
    if (r.archivedAt) alert("overlay0", "Archived", `Read-only. ${keyName("archive")} restores it. Its state and all its data are kept.`);
    if (failure && waitOf(r)?.who === "agent") { // nothing to do: the board carries on by itself
      told = failure.detail;
      alert(c, "Cut off", `Trying again by itself. ${note}. A reply, ${keyName("sendBack")} or ${keyName("yes")} tells the agent to continue right away.`, [["Cut off by", waitOf(r).error || failure.detail]]);
    } else if (failure) {
      told = failure.detail;
      alert("red", "Went wrong", `${failure.title}\n${failure.sentAt ? "Sent to the agent. Kept here until it works." : failure.agentCanFix ? `The agent can fix this: ${keyName("sendBack")} sends it.` : "This needs you first."}`, [["Next step", failure.next || "Find the cause and fix it."], ["Details", failure.detail]]);
    } else if (approval && r.syncBlocked) alert("peach", "Behind main", `Cannot be approved yet: ${r.syncBlocked.why}. The board keeps trying to bring it up to date.`);
    else if (approval) { /* the state says it: ready to approve */ }
    else if (r.state === "blocked") { told = note || said || ""; alert("red", ASKS[r.kind] || "Needs you", told); }
    else if (r.state === "error") { told = (r.stage === "nosummary" ? r.screen : "") || note || said || "It failed"; alert("red", r.stage === "nosummary" ? "Stopped without a summary" : "Went wrong", told); }
    return { title, top, told };
  }
}
