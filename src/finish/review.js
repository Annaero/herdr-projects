// The reviewer: a visible herdr agent in a tab of its own in the task's space. Starting it, waiting for it, trying again.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import * as F from "../flow.js";
import { sleep } from "../runner.js";
import { startArgs, preTrust, adapter, readTurnOf, installed, roleOf, ownWords } from "../agents.js";
import { whyStopped } from "../turn.js";
import { launchExtras, taskLine } from "../delegate.js";
import { publishReview } from "../review-page.js";
import { settle, hand, look, shown } from "../submit.js";
import * as G from "../gate.js";
import { ms, fail } from "./shared.js";
import { reviewBrief, parseVerdict } from "./review-brief.js";
import { REPORT } from "../research.js";
import { reviewerNow, nextReviewer } from "./review-fallback.js";
import { count } from "../limits/spent.js";
import { tokensOver, stopAt } from "../limits/reached.js";

// ---- the reviewer: a visible herdr agent in a tab of its own in the task's space (flow/tabs.js) -------------------------
export async function closeReviewer(id) {
  const t = S.get(id);
  if (!t?.link?.reviewer?.pane) return;
  try { F.closeReviewerTab(F.h(t), t.link.reviewer); } catch {}
  try { S.update(id, (t) => { if (t.link) t.link = { ...t.link, reviewer: null }; }, { waitMs: 10000 }); } catch {}
}
// A reviewer whose turn ended in a provider error did not review anything: that is not a round. It uses up none of
// the task's rounds and is not on the list of its reviews. When the error is one that passes by itself, the board
// waits and starts the review again, a few times with growing waits; the row says why and when. Then, or at once for
// an error that waiting cannot fix (a login, a model that does not exist), it fails with the provider's own words.
export async function runReview(id, g, o) {
  const waits = S.retryWaits();
  const tried = [];
  for (let tries = 0; ; tries++) {
    const r = await reviewOnce(id, g, o);
    if (!r.cut) return r;
    // At the task's token limit a cut-off review is not started again by itself (limits/reached.js).
    const spent = tokensOver(id);
    if (spent) { stopAt(id, "tokens", spent, { role: "reviewer" }); return { aborted: true }; }
    // It cannot review: the next one on `reviewer.fallback` does, as the same review, with the tries counted afresh.
    if (!r.cut.passing || tries >= waits.length) {
      try { tried.push(r.by); if (nextReviewer(g, o.ch, { from: r.by, cut: r.cut, auth: r.auth, tries: tries + 1, tried })) { tries = -1; continue; } } catch (e) { if (e.aborted) return { aborted: true }; throw e; }
    }
    if (!r.cut.passing) return { error: `the reviewer stopped: ${r.cut.error}`, auth: r.auth, cut: true };
    if (tries >= waits.length) return { error: `${S.gaveUp("reviewer", r.cut.reason, tries + 1)}. Its error: ${r.cut.error.replace(/[.\s]+$/, "")}`, auth: false, cut: true };
    try {
      const until = Date.now() + waits[tries];
      g.set((t) => { t.msg = "Under review"; t.watch = null; t.waiting = { who: "reviewer", reason: r.cut.reason, error: S.oneLine(r.cut.error, 400), until, tries: tries + 1 }; });
      while (Date.now() < until) { await sleep(Math.max(1, Math.min(1000, until - Date.now()))); g.check(); }
    } catch (e) {
      if (!e.aborted) throw e;
      try { S.update(id, (t) => { if (t.waiting?.who !== "reviewer") return false; t.waiting = null; }, { waitMs: 10000 }); } catch {}
      return { aborted: true };
    }
  }
}
async function reviewOnce(id, g, { text, change, toLand, ch, check }) {
  // One that just took the review over says so on the row until the Watcher has a line of it (review-fallback.js).
  let t = g.set((t) => { const took = S.lastHandover(t, "reviewer"); t.msg = took && t.msg === S.handoverLine(took) ? t.msg : "Under review"; t.stage = "reviewing"; t.watch = null; t.waiting = null; t.reviewAt = Date.now(); });
  g.allow("reviewneeds");
  const api = F.h(t);
  const folder = S.cwdOf(t);
  const dir = F.reviewDir(t);
  const verdictFile = path.join(dir, "verdict.json");
  // The folder is emptied before the reviewer starts. It is the task's own, in the board's data folder: nothing of the
  // board's is written into the folder the work is in.
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  // The configured reviewer program may not be installed here: review with the working agent's kind instead, on that
  // kind's own default model and effort, and say so on the task.
  // Or, with a `reviewer.fallback`, the first on that list that is installed; and one that took the review over
  // earlier on this task (`reviewerOn`) reviews its later rounds too.
  const who = roleOf("reviewer", (n) => ch[n]), now = reviewerNow(t, ch), on = S.agentOf(now.agent);
  let rkind = on.kind, rmodel = on.model, reffort = who.effort, by = now.agent;
  if (!installed(rkind) && installed(t.agent)) { rkind = t.agent; rmodel = ""; reffort = ""; by = rkind; }
  // A stand-in for a program that is not installed is a hand-over like any other: written on the task, and the
  // reviewer of its later rounds.
  if (now.standIn) g.set((t) => { const h = S.logHandover(t, { role: "reviewer", from: ch["reviewer.agent"], to: now.agent, why: `${now.standIn} is not installed here` }); t.reviewerOn = now.agent; t.msg = S.handoverLine(h); });
  const round = (t.reviewRound || 0) + 1, other = by !== ch["reviewer.agent"];
  t = g.set((t) => { S.keepSavedReview(t); t.reviewRound = round; t.reviewSession = null; t.fallbacks = { ...(t.fallbacks || {}), reviewer: rkind !== who.kind && !t.reviewerOn && !now.standIn ? `reviewed by ${rkind}: ${who.kind} is not installed here` : undefined }; });
  // From the second round of a send-back on, the reviewer checks the earlier findings instead of starting over.
  const before = S.reviewHistory(t).filter((e) => G.isTagged(e));
  const earlier = (t.reviewRounds || 0) > 0 && before.length ? before.at(-1).findings : null;
  const used = before.flatMap((e) => e.findings.map((f) => f.id));
  const brief = `${taskLine(t, "reviewer", round)}\n\n${reviewBrief(t, { text, change, toLand, ch, earlier, check })}${who.instructions ? `\n\n${ownWords(who.instructions)}` : ""}`;
  let pane = null, tab = null, error = "", review = null, sent = false, sentAt = 0, auth = false, quietSince = 0, cut = null, mark = null;
  // The reviewer ended its turn with no verdict. Its saved conversation says why: a turn that ended in the provider's
  // error was cut off (`cut`), and only one that really finished is "finished without a verdict", with its last message.
  // Its own turn-end report can come before the end is on disk: the file is read again for a few seconds.
  const noVerdict = async (ev, or = "") => {
    let w = whyStopped(S.get(id), "reviewer", ev);
    for (const until = Date.now() + ms("HERDR_SUPERWORK_READ_MS", 5000); ev && w.canRead && !(w.turn && (w.turn.finished || w.turn.error)) && Date.now() < until; ) { await sleep(400); w = whyStopped(S.get(id), "reviewer", ev); }
    auth = !!w.turn?.auth;
    if (w.turn?.error) { cut = { passing: w.turn.passing, reason: w.turn.reason, error: w.turn.error }; return `the reviewer stopped: ${w.turn.error}`; }
    return or || `the reviewer finished without a verdict${w.turn?.finished && w.turn.said ? `. Its last message: ${w.turn.said.slice(0, 1500)}` : ""}`;
  };
  try {
    preTrust(rkind, t.root || S.folderOf(t.id), who.access);
    await closeReviewer(id); // a tab left over from an interrupted round
    // Its own tab, never focused: the human stays where they are, and the agent's tab and the board keep their size.
    const made = F.openReviewerTab(api, t, round, { cwd: folder, env: S.boardEnv(), by: other ? rkind : "" });
    tab = made.tab; pane = { pane_id: made.pane };
    const taken = api.agents().map((a) => a.name).filter(Boolean);
    let name = `${t.link.agent || `sw-task-${t.n}`}-r`.slice(0, 32);
    if (taken.includes(name)) name = `${name.slice(0, 27)}-${String(Date.now() % 10000).padStart(4, "0")}`;
    const startedAt = Date.now(); // a turn-end report older than this is from a try of this review that was cut off
    const x = launchExtras(t, "reviewer", { kind: rkind, round });
    t = g.set((t) => { t.link = { ...t.link, reviewer: { pane: pane.pane_id, tab, agent: name, kind: rkind } }; t.reviewSession = x.session; });
    F.tellSidebar(t); // the reviewer's pane has its entry in herdr's sidebar from the start
    const start = (hook) => {
      const args = startArgs(rkind, { model: rmodel, effort: reffort, fast: who.fast, access: who.access, session: x.session, extra: hook });
      try { api.agentStart(name, rkind, pane.pane_id, args); settle(api, pane.pane_id, [rkind, ...args].join(" ")); } // up before its brief is typed (submit.js)
      catch (e) { if (e.code === "agent_not_ready") return; if (!hook.length) throw e; start([]); } // once more without the hook arguments
    };
    start(x.hook);
    // The end of the reviewer's saved conversation, for the look at whether it started on its brief.
    const briefShown = () => { const s = S.get(id).reviewSession || adapter(rkind).findSession?.(folder, startedAt, taskLine(t, "reviewer", round)); return s ? shown(rkind, { session: s, cwd: folder }, mark, brief) : null; };
    const until = Date.now() + ms("HERDR_SUPERWORK_REVIEW_MS", 20 * 60000);
    const every = ms("HERDR_SUPERWORK_POLL_MS", 3000);
    for (;;) {
      g.check();
      // The verdict file appearing is the finish signal.
      if (fs.existsSync(verdictFile)) {
        await sleep(Math.min(every, 300)); // let the write complete
        try { review = parseVerdict(fs.readFileSync(verdictFile, "utf8"), toLand ? change.head : null, { earlier, used }); if (review) break; fs.rmSync(verdictFile, { force: true }); }
        catch (e) { error = String(e.message || e).replace(/\s+/g, " ").slice(0, 400) || "no valid verdict"; break; }
      }
      if (Date.now() > until) { error = "review timed out"; break; }
      const now = S.get(id);
      // The reviewer's own turn-end report for this round, and still no verdict: the review failed, at once.
      // Codex also reports its side chats (it names a conversation with one, right after the first prompt): not this.
      const rev = S.pendingEvents(now).find((e) => e.role === "reviewer" && e.round === round && !e.side && e.at >= startedAt);
      if (rev?.session && !now.reviewSession) S.update(id, { reviewSession: rev.session }, { waitMs: 10000 });
      if (rev && sent) { await sleep(Math.min(every, 1500)); if (!fs.existsSync(verdictFile)) { error = await noVerdict(rev); break; } continue; }
      const a = api.agentGet(pane.pane_id);
      if (!a && sent) { error = await noVerdict(null, "the reviewer exited without a verdict"); break; }
      if (!a && !api.paneGet(pane.pane_id)) { error = "the reviewer's terminal was closed"; break; }
      // herdr status is used only to notice a reviewer that is blocked: "review needs you".
      const blocked = a?.agent_status === "blocked";
      const cur = S.get(id);
      if (blocked && cur.stage === "reviewing") { g.set({ stage: "reviewneeds", msg: "The reviewer shows a dialog: open it and answer" }); g.allow("reviewing"); }
      else if (!blocked && cur.stage === "reviewneeds") { g.set({ stage: "reviewing", msg: "Under review" }); g.allow("reviewneeds"); }
      if (!sent && a && (a.agent_status === "idle" || a.agent_status === "done")) { try { mark = hand(api, pane.pane_id, brief); sent = true; sentAt = Date.now(); } catch (e) { if (e.code !== "agent_blocked" && e.code !== "agent_not_ready") { sent = true; sentAt = Date.now(); } } }
      // The brief was typed: did the reviewer start on it? If not, enter is pressed again; the brief is never typed twice.
      else if (mark && a) {
        const r = look(api, pane.pane_id, mark, briefShown);
        if (r === "took" || r === "unknown") mark = null;
        else if (r === "lost") { error = "the reviewer did not start: its brief sits unsent in its box"; break; }
      }
      else if (sent && a && adapter(rkind).readTurn && Date.now() - sentAt > ms("HERDR_SUPERWORK_ENDED_MS", 5000)) {
        // No hook: "idle" alone never fails a review (a reviewer in a long test run looks idle). Only its saved
        // conversation ending in a finished message or an error, and still no verdict 15 seconds later, does.
        let session = now.reviewSession;
        if (!session && adapter(rkind).findSession) { session = adapter(rkind).findSession(folder, startedAt, taskLine(t, "reviewer", round)); if (session) S.update(id, { reviewSession: session }, { waitMs: 10000 }); }
        const turn = session ? readTurnOf(rkind, { session, cwd: folder }) : null;
        if (turn && turn.pos > sentAt && (turn.finished || turn.error)) { quietSince = quietSince || Date.now(); if (Date.now() - quietSince > ms("HERDR_SUPERWORK_QUIET_MS", 15000) && !fs.existsSync(verdictFile)) { error = await noVerdict(null); break; } }
        else quietSince = 0;
      }
      await sleep(every);
    }
  } catch (e) {
    if (e.aborted) { await closeReviewer(id); if (pane) F.closeReviewerTab(api, { tab, pane: pane.pane_id }); return { aborted: true }; } // also one the task had not noted yet
    error = `${e.message || e}`.replace(/\s+/g, " ").slice(0, 400);
  }
  // Put back anything the reviewer changed: what you approve is exactly what the agent committed.
  // Asked first, so a reviewer that changed nothing (nearly every one) costs one git program, not two.
  if (toLand && (F.headOf(folder) !== change.head || F.dirty(folder))) { try { S.gitOut(folder, ["reset", "--hard", change.head]); S.gitOut(folder, ["clean", "-fd"]); } catch {} }
  count(id, "reviewer"); // its tokens are the task's (limits/spent.js), read while the task still names its conversation
  await closeReviewer(id);
  try { if (S.get(id).stage === "reviewneeds") { g.set({ stage: "reviewing", msg: "Review complete" }); } } catch (e) { if (e.aborted) return { aborted: true }; }
  if (!review && cut) {
    // Not a review: the task's count of reviews is put back, so the next try (or the next real review) has this number.
    try { g.set((t) => { if (t.reviewRound === round) t.reviewRound = round - 1; }); } catch (e) { if (e.aborted) return { aborted: true }; }
    return { cut, error, auth, by };
  }
  if (!review) return { error: error || "no valid verdict", auth };
  G.stamp(review, ch["review.mustFix"]);
  review.by = by; // who reviewed: the task's history keeps it
  // Move the folder to the task's artifacts and publish the evidence page.
  const art = S.artifactsDir(id);
  try { for (const f of fs.existsSync(art) ? fs.readdirSync(art) : []) if (f !== REPORT) fs.rmSync(path.join(art, f), { recursive: true, force: true }); /* the task's report is kept there too (research.js) */ fs.mkdirSync(art, { recursive: true }); fs.cpSync(dir, art, { recursive: true }); fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  try {
    t = S.get(id);
    review.artifacts = await publishReview({ enabled: ch["review.evidence"], dir: art, listed: review.listed, review, task: t,
      context: { id, round: S.reviewRound(t), title: t.title, description: t.description, summary: text, stat: change?.stat, head: change?.head, pr: t.pr } });
  } catch { review.artifacts = []; } // a publish failure must not bypass the requested-review gate, nor fail the review
  delete review.listed;
  return { review };
}
