// One row of the list: its mark, its name, what it says, and its columns on the right.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as G from "../../gate.js";
import { herdr } from "../../herdr.js";
import { short, clean, age, prNumber, prCheck, prColor, bar } from "./words.js";
import { MARK_STATES, failureFor, inReview, needsYou, statusColor, waitOf } from "./states.js";
import { resultColor, roundWords, currentReview, reviewNote, verdict } from "./review-words.js";

// The fewest cells a cut "doing now" sentence is still worth showing in.
const SENTENCE_MIN = 20;

export class Row {
  mark(r) {
    const t = this.theme;
    // herdr's own marks, a different one for each state, in the colour of the task's group.
    const c = statusColor(r);
    if (r.archivedAt) return t.fg(c, t.mark("unknown"));
    if (inReview(r)) return t.fg(c, t.bold(t.mark("done")));
    if (r.state === "blocked") return t.fg(c, t.bold(t.mark("blocked")));
    if (r.state === "done") return t.dim(t.fg(c, t.mark("done"))); // finished: the same mark, only quieter
    return t.fg(c, t.mark(MARK_STATES.includes(r.state) ? r.state : "idle"));
  }
  // A row's columns, in the order they are drawn: the bar, the percent and the minutes left, the pull request, the
  // time. A cell the row does not have is the empty string, with no colour codes around nothing: an empty cell must
  // not count as a column. The minutes left ("12m") take the percent's colour and `etaW` cells, so the percents line up.
  rowFields(r, bars, now, etaW = 0) {
    const t = this.theme;
    const paint = (color, s) => (s ? t.fg(color, s) : "");
    const percent = r.state !== "done" && r.progress !== undefined ? paint(statusColor(r), `${String(r.progress).padStart(3)}%`) : "";
    const eta = r.state !== "done" && r.eta !== undefined ? `${r.eta}m` : ""; // shown with no percent too
    const left = etaW && (percent || eta) ? (percent ? " " : "") + (eta ? t.fg(statusColor(r), eta.padStart(etaW)) : " ".repeat(etaW)) : "";
    // The time is "working for" on a working row and "ago" on every other: the word says which.
    return { pr: paint(prColor(r), prNumber(r)), check: paint(prColor(r), prCheck(r)), eta, progress: (percent && bars ? t.fg(statusColor(r), bar(r.progress)) + " " + percent : percent) + left, elapsed: age(now - (r.at || now)), ago: r.state !== "working" };
  }
  // What a row says after its name. Never what its heading already says ("to do", "approve?").
  sentence(r) {
    const t = this.theme;
    const words = (s) => clean(s || "").replace(/\*\*|`/g, "");
    // What a row says is greyed out, never the title's colour: the two are told apart at a glance.
    const quiet = (s) => (s ? t.muted(s) : "");
    const failure = failureFor(r);
    // Cut off by its provider, and the board tries again by itself: the row says why and when, not that it failed.
    if (waitOf(r)) return { text: quiet(words(r.msg)) };
    if (failure && !failure.sentAt && (r.failure || r.prFailure)) return { text: quiet(words(failure.msg || failure.title)) };
    if (inReview(r)) {
      // The result and a short tally: "Pass · 2 minor". Which review it was only from the second on.
      const rv = currentReview(r);
      if (G.isTagged(rv)) {
        const res = t.fg(resultColor(rv), G.word(rv)), tally = res + quiet(G.tally(rv) ? ` · ${G.tally(rv)}` : "");
        const all = tally + (roundWords(r) ? quiet(` · ${roundWords(r)}`) : "");
        return { text: all, forms: [all, tally, res] }; // never cut: it shows whole, or shorter, or as the one word
      }
      // A review from before the gate: its score, and the reviewer's advice in words.
      if (!rv || !Number.isInteger(rv.score)) return { text: r.review?.stale ? quiet("the work changed since its review") : "" };
      const score = t.fg(resultColor(rv), `${rv.score}/5`);
      const advice = score + quiet(rv.recommend === true ? " reviewer says yes" : rv.recommend === false ? " reviewer says no" : "");
      const all = advice + (roundWords(r) ? quiet(` · ${roundWords(r)}`) : "");
      return { text: all, forms: [all, advice, score] }; // never cut: it shows whole, or shorter, or as the score alone
    }
    // Checks that fail with nothing saved about them yet: the row still says why it is not ready.
    if (r.stage === "approval" && r.prState === "failing" && !r.mergeFailed && !r.syncBlocked) return { text: quiet("the pull request's checks fail") };
    const raw = words((r.review?.stale ? reviewNote(r) : r.msg) || "");
    const msg = ["working", "needs you", "under review", "idle"].includes(raw) ? "" : raw;
    // While the reviewer works the row says only what the reviewer is doing: the colour of its mark, its bar, its
    // percent and its minutes left says a review is running.
    if (r.state === "done") return { text: "" };
    if (needsYou(r)) return { text: quiet(msg || { question: "has a question", permission: "asks for your OK", auth: "needs a login" }[r.kind] || (r.state === "error" ? "failed" : "")) };
    return { text: quiet(msg) };
  }
  rowLayout(records, width) {
    const layout = { pr: 0, check: 0, progress: 0, percent: 0, eta: 0, elapsed: 3, ago: false, bars: width >= 64, now: Date.now() };
    const fields = records.map((r) => this.rowFields(r, layout.bars, layout.now));
    const max = (key) => Math.max(0, ...fields.map((f) => visibleWidth(f[key])));
    layout.elapsed = Math.max(3, max("elapsed"));
    layout.ago = fields.some((f) => f.ago); // at every width: a row that is short of room gives it up by itself
    // Extremely long PR identifiers may shorten, but must never push time off-screen.
    layout.pr = Math.min(max("pr"), Math.max(0, width - 3 - layout.elapsed - 3));
    layout.check = max("check");
    layout.progress = max("progress");
    layout.eta = max("eta");
    layout.percent = layout.bars ? Math.max(0, ...records.map((r) => visibleWidth(this.rowFields(r, false, layout.now).progress))) : layout.progress;
    return layout;
  }
  row(r, width, layout = this.rowLayout([r], width)) {
    const t = this.theme;
    const bright = r.state === "working" || r.state === "blocked";
    const title = clean(r.title || r.id) + (r.archivedAt ? " [archived]" : "");
    // The title is plain text whatever the task's state: the mark and the group's heading carry the state's colour.
    const name = bright ? t.bold(title) : title;
    const prefix = ` ${this.mark(r)} `;
    const room = Math.max(0, width - visibleWidth(prefix));
    // In the all-machines view the machine's name sits before the task's, in what the task's name leaves: it is cut first.
    const host = r.host && this.scope === "*" ? clean(r.host) : "";
    const labelName = (w) => {
      const shown = truncateToWidth(name, w, "…");
      const hostRoom = w - visibleWidth(shown) - 1;
      return (host && hostRoom >= Math.min(3, visibleWidth(host)) ? t.fg("overlay0", truncateToWidth(host, hostRoom, "…")) + " " : "") + shown;
    };
    // The name wins over the columns, and the columns win over the sentence. A row whose name does not fit gives up
    // its own columns, one at a time: the bar, the word "ago", the minutes left, the percent, the PR number and, last of
    // all, the time.
    const nameNeed = Math.min(room, visibleWidth(name));
    const fill = (s, n, left) => { const gap = " ".repeat(Math.max(0, n - visibleWidth(s))); return left ? s + gap : gap + s; }; // by terminal cells, not string length
    const build = (drop, noAgo = false) => {
      const bars = layout.bars && drop < 1;
      const etaW = drop < 3 ? layout.eta : 0;
      const fields = this.rowFields(r, bars, layout.now, etaW);
      // PR#16 is left-aligned, so the "PR#" parts line up; the mark for its checks sits in a column of its own.
      const prW = drop < 5 && layout.pr ? layout.pr + (layout.check ? 2 : 0) : 0;
      const prCell = fields.pr ? fill(truncateToWidth(fields.pr, layout.pr, "…"), layout.pr, true) + (layout.check ? " " + (fields.check || " ") : "") : "";
      const cells = [[drop >= 4 ? 0 : ((n) => n + (etaW && etaW + (n ? 1 : 0)))(bars ? layout.progress : layout.percent), fields.progress, false], [prW, prCell, true]].filter(([n]) => n);
      // Blank cells left of a row's first own column are not columns to that row: its words run into them.
      const own = cells.findIndex(([, s]) => visibleWidth(s) > 0);
      const time = drop < 6 ? t.fg("overlay0", fields.elapsed.padStart(layout.elapsed) + (layout.ago && drop < 2 && !noAgo ? (fields.ago ? " ago" : "    ") : "")) : "";
      const metadata = [...(own < 0 ? [] : cells.slice(own)).map(([n, s, left]) => fill(s, n, left)), time].filter(Boolean).join(" ");
      return { metadata, labelRoom: Math.max(0, room - visibleWidth(metadata) - (metadata ? 2 : 0)) };
    };
    let drop = 0, built = build(0);
    while (built.labelRoom < nameNeed && drop < 6) built = build(++drop);
    const said = this.sentence(r);
    // What a row needs from you outranks its bar: the bar goes when the words would be cut beside it.
    const need = needsYou(r) && said.text ? nameNeed + 2 + visibleWidth(said.text) : 0;
    if (need && built.labelRoom < need && drop < 1) built = build(1);
    // One allocation policy for every row: the name first, the columns second, the sentence in what is left.
    const sayW = visibleWidth(said.text || "");
    const lay = (b) => {
      const renderedTitle = labelName(b.labelRoom);
      const sayRoom = b.labelRoom - visibleWidth(renderedTitle) - 2;
      // A sentence cut to a few letters says nothing: it shows whole, or with at least SENTENCE_MIN cells, or not at all.
      const tail = !sayW ? "" : said.forms ? said.forms.find((f) => visibleWidth(f) <= sayRoom) || "" : sayRoom >= Math.min(sayW, SENTENCE_MIN) ? truncateToWidth(said.text, sayRoom, "…") : "";
      return { metadata: b.metadata, tail, label: renderedTitle + (tail ? "  " + tail : "") };
    };
    // The word "ago" goes when that is what lets the sentence show: at all, whole, or as a fuller verdict. A sentence
    // that would be cut either way keeps it.
    let out = lay(built);
    if (sayW && visibleWidth(out.tail) < sayW && layout.ago && drop < 2) { const lean = lay(build(drop, true)), w = visibleWidth(lean.tail); if (w > visibleWidth(out.tail) && (!out.tail || w === sayW || said.forms)) out = lean; }
    const { metadata, label } = out;
    return prefix + label + " ".repeat(Math.max(0, room - visibleWidth(label) - visibleWidth(metadata))) + metadata;
  }
}
