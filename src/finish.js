// The finish line: commit, check, push, draft pull request, review, then the approval gate. Never merges by itself
// unless the repo says "land": "auto". Runs in a detached runner, started by the event hook when herdr says the
// agent stopped, so it works with the board closed.
import fs from "node:fs";
import path from "node:path";
import * as S from "./store.js";
import * as F from "./flow.js";
import { readScreen } from "./herdr.js";
import { claim, release, guardFor, sh, sleep, outputOf } from "./runner.js";
import { startArgs, preTrust } from "./agents.js";
import { publishReview } from "./review-page.js";
import { reviewMessage, reviewFindings } from "./actions.js";

const ms = (name, fallback) => (process.env[name] !== undefined ? Number(process.env[name]) : fallback);
const lastLines = (text, n = 12) => String(text || "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-n).join("\n");
const firstLine = (text) => String(text || "").split("\n").find((l) => l.trim())?.trim() || "";
export const approvalMessage = (t, note = "") => {
  const rv = S.currentReview(t);
  return `Approve to merge?${rv ? ` Reviewed ${rv.score}/5${rv.recommend === true ? ", says merge" : rv.recommend === false ? ", says don't merge" : ""}.` : ""} ${firstLine(t.summary) || "The work is finished."}${note}`;
};
function fail(g, failure, extra = {}) {
  const t = g.set((t) => { t.stage = "failed"; t.msg = failure.msg || failure.title; t.mergeIntent = extra.keepIntent ? t.mergeIntent : null; Object.assign(t, S.failurePatch(failure), extra.patch || {}); });
  F.labelPane(t, null);
  F.notify(t, `${t.title}: ${t.failure.auth ? "needs a login" : failure.title}`, firstLine(failure.next));
  return t;
}

// ---- job: the agent's turn ended ----------------------------------------------------------------------------------------
// `force`: the hook already decided a turn ended (missed-turn recovery), so the completion is not de-duplicated.
export async function finishJob(id, { force = false } = {}) {
  // 1. herdr guesses an agent's status from its screen; give a wrong "stopped" reading time to correct itself.
  await sleep(ms("HERDR_SUPERWORK_SETTLE_MS", 5000));
  let t = S.get(id);
  if (!t || !F.isAgentTask(t) || t.stage !== "working") return;
  const api = F.h(t);
  const a = api.agentGet(t.link.pane);
  if (!a || a.agent_status === "working" || a.agent_status === "blocked") return;
  const note = F.noteStat(t);
  const freshNote = note && note.mtime > (t.armedAt || 0) && note.mtime !== t.handled?.note ? note : null;
  if (a.agent_status === "unknown" && !freshNote) return; // herdr cannot tell, and no closing note says it stopped
  const comp = a.completion_seq ?? null;
  // It never de-duplicates on the commit, so a turn that ends without a new commit is still processed.
  const seen = (t) => !force && (a.agent_status === "unknown" || comp == null ? !freshNote : comp === t.handled?.comp && !freshNote);
  let mine = false;
  t = S.update(id, (t) => {
    if (t.stage !== "working" || (t.runner && t.runner.pid !== process.pid && S.pidAlive(t.runner.pid)) || seen(t)) return false;
    mine = true;
    t.runner = { pid: process.pid, started: Date.now(), job: "finish" };
  }, { waitMs: 10000 });
  if (!mine) return;
  const g = guardFor(id);
  g.expect(t);
  try {
    // 2. The closing note is where the plugin reads "the agent's last message".
    const wake = t.expectedWake;
    const handled = { comp, note: freshNote ? freshNote.mtime : t.handled?.note ?? null, at: Date.now() };
    if (!freshNote && !wake) {
      // A human turn that left no closing note did not finish normally (interrupted, a usage limit, an error, a full
      // context): commit nothing and hold, with what is on the screen as the message.
      const screen = lastLines(readScreen(api, t.link.pane, a.agent_status, 60));
      t = g.set((t) => { t.stage = "nosummary"; t.msg = S.oneLine(lastLines(screen, 2)) || "stopped without a summary"; t.screen = screen; t.handled = handled; t.turnOpen = false; t.seen = false; });
      F.notify(t, `${t.title}: stopped without a summary`, "ctrl+r tells it to continue; ctrl+y finishes anyway.");
      return;
    }
    const text = freshNote ? freshNote.text : t.said || "";
    if (freshNote) { try { fs.writeFileSync(path.join(S.dirOf(id), "closing.md"), freshNote.text + "\n"); } catch {} }
    t = g.set((t) => { t.handled = handled; t.expectedWake = null; t.turnOpen = false; t.said = text; if (a.agent_session?.value) t.session = a.agent_session.value; });
    if (freshNote && /\?\s*$/.test(text)) {
      t = g.set((t) => { t.stage = "asks"; t.kind = "question"; t.msg = S.oneLine(text.split("\n").filter((l) => l.trim()).pop()); t.seen = false; });
      F.notify(t, `${t.title}: asks you`, t.msg);
      return;
    }
    await pipeline(id, g, text, wake);
  } catch (e) {
    if (!e.aborted) try { fail(g, { stage: "workflow", title: "The finish line failed", detail: e.stack || e.message, next: "Investigate the error, then finish again." }); } catch {}
    else await closeReviewer(id);
  } finally { release(id); }
}
// "Finish anyway" on a turn that left no closing note: the screen text is the summary.
export async function pipelineJob(id) {
  let t = claim(id, "pipeline");
  if (!t || t.stage !== "checking") { if (t) release(id); return; }
  const g = guardFor(id);
  g.expect(t);
  try { await pipeline(id, g, t.said || t.screen || t.msg || "", null); }
  catch (e) { if (!e.aborted) try { fail(g, { stage: "workflow", title: "The finish line failed", detail: e.stack || e.message, next: "Investigate the error, then finish again." }); } catch {} else await closeReviewer(id); }
  finally { release(id); }
}

// ---- the pipeline -------------------------------------------------------------------------------------------------------
export async function pipeline(id, g, text, wake) {
  let t = g.set((t) => { t.stage = "checking"; t.msg = "checking the result"; t.watch = null; t.summary = String(text || "").trim(); });
  const folder = S.cwdOf(t), root = S.folderOf(t.id), tree = F.isAgentTask(t) && t.worktree && fs.existsSync(t.worktree) ? t.worktree : "";
  const repo = t.repoCfg || {};
  const env = { HERDR_SUPERWORK_ID: t.id, HERDR_SUPERWORK_WORKTREE: folder, HERDR_SUPERWORK_REPO: root };
  const ch = S.choices(t);
  const alive = () => !!g.check();
  // 3. Commit leftovers. A plain folder has nothing to commit.
  if (tree) {
    try { if (F.dirty(tree)) { S.gitOut(tree, ["add", "-A"]); S.gitOut(tree, ["commit", "-m", `${t.title || id}\n\nTask: ${id}`]); } }
    catch (e) { return void fail(g, { stage: "commit", title: "Could not commit the work", detail: outputOf(e), next: "Fix the Git error in your own worktree, commit the work and finish again." }); }
  }
  g.check();
  if (t.setupPending && repo.setup) {
    const setup = await sh(repo.setup, folder, env, { alive });
    if (setup.aborted) return;
    if (!setup.ok) return void fail(g, { stage: "setup", title: "Setup still fails", detail: `Command: ${repo.setup}\nFolder: ${folder}\n\n${setup.out}`, next: "Fix the setup problem and finish again. Setup must pass before the check." });
    g.set({ setupPending: false });
  }
  if (repo.check) {
    g.set({ msg: `running the check: ${repo.check}` });
    const r = await sh(repo.check, folder, env, { alive });
    if (r.aborted) return;
    if (!r.ok) {
      const fails = (S.get(id).checkFails || 0) + 1;
      const auth = S.isAuthFailure(r.out);
      const failure = { stage: "check", auth, agentCanFix: true, title: `Check failed${fails >= 3 ? " after 3 tries" : ""}`, ...(fails >= 3 ? { msg: `the check still fails after 3 tries (${repo.check}): ${r.out.split("\n").filter(Boolean).slice(-1)[0] || ""}` } : {}), detail: `Command: ${repo.check}\nFolder: ${folder}\n\n${r.out}`, next: "Fix the failed check, run it again and finish for a fresh review." };
      if (fails >= 3 || auth) return void fail(g, failure, { patch: { checkFails: fails } });
      g.check();
      // Straight back to the agent. The turn it causes is the plugin's own: an approved merge survives it.
      F.sendOwn(id, `The check failed, so this is not done yet.\n\n${S.boundDetail(failure.detail)}\n\nFix it and finish again.`, { reason: "check", keepIntent: !!wake?.keepIntent || !!S.get(id).mergeIntent, patch: { checkFails: fails, ...S.failurePatch(failure), failure: { ...S.failurePatch(failure).failure, sentAt: Date.now() } } });
      return;
    }
  }
  g.check();
  // Push and open a draft pull request, when an origin remote exists.
  let note = "";
  if (tree && S.config().pr) {
    try {
      const hasCommits = Number(S.gitOut(tree, ["rev-list", "--count", `${t.baseSha || t.from || "HEAD"}..HEAD`])) > 0;
      if (hasCommits && F.hasOrigin(root)) {
        t = g.set({ stage: "pushing", msg: "pushing the branch" });
        // The branch is the board's own and an agent may have rebuilt it on a newer base: overwrite what was pushed
        // before, but only while the remote still holds what was last seen here.
        S.gitOut(tree, ["push", "-u", "--force-with-lease", "origin", t.branch], { timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
        g.set({ prHead: S.gitOut(tree, ["rev-parse", `refs/remotes/origin/${t.branch}`]) });
        let url = t.pr || "";
        if (!url) {
          const r = F.gh(["pr", "create", "--draft", "--head", t.branch, "--title", t.title || id, "--body", `${text || t.title || ""}\n\nTask: ${id}`], tree);
          url = ((r.stdout || "").match(/https?:\/\/\S+/) || [""])[0];
          if (!url) return void fail(g, { stage: "pr", title: "Could not open the pull request", detail: `Branch: ${t.branch}\nFolder: ${tree}\n\ngh pr create:\n${outputOf(r)}`, next: "Inspect the GitHub error, fix what you safely can, then finish again. The board retries opening the pull request; do not push or ship manually." });
          g.set({ pr: url, prSeen: "", prState: "waiting" });
        }
        note = ` Pull request: ${url}`;
      }
    } catch (e) { return void fail(g, { stage: "push", title: "Could not push the branch", detail: `Branch: ${t.branch}\nFolder: ${tree}\n\n${outputOf(e)}`, next: "Inspect the Git error and fix what you safely can without altering the human's checkout. Finish again so the board retries the push." }); }
  }
  t = g.check();
  const change = tree ? F.changeOf(t) : null;
  const toLand = !!(change && change.stat);
  const done = (msg, patch = {}) => { const d = g.set((t) => { t.stage = "done"; t.msg = S.oneLine(msg); t.seen = false; t.failure = null; t.mergeIntent = null; Object.assign(t, patch); }); F.labelPane(d, null); F.notify(d, `${d.title}: done`, d.msg, "done"); return d; };
  // Nothing to land: it is simply done, unless work outside a repo is reviewed too (review "all").
  if (!toLand && ch.review !== "all") {
    if (holdPrFailure(g, t)) return;
    return void done(`${firstLine(text) || "finished"}${note}`);
  }
  // 4. An adversarial review before it reaches you.
  let review = null;
  const reviewNeeded = ch.review !== "none";
  if (reviewNeeded) {
    const r = await runReview(id, g, { text, change, toLand, ch });
    if (r.aborted) return;
    if (!r.review) return void fail(g, { stage: "review", title: "Review failed", msg: `Review failed: ${r.error}. Retry the task to review again.`, detail: `Review failed: ${r.error}`, next: "Investigate the reviewer failure, then finish again for a fresh review. Do not bypass review or merge approval." }, { patch: { review: null } });
    review = r.review;
  }
  t = g.set({ failure: null });
  // The loop, off unless reviewAuto is on: anything below 5 goes straight back, at most `rounds` times.
  const rounds = t.reviewRounds || 0;
  if (review && (ch.reviewAuto || t.mergeIntent) && review.score < 5 && rounds < ch.rounds) {
    F.sendOwn(id, reviewMessage(review), { reason: "review", keepIntent: !!t.mergeIntent, patch: { review: { ...review, stale: true }, reviewRounds: rounds + 1 } });
    return;
  }
  const head = change?.head || F.headOf(folder) || null;
  const { landCore } = await import("./land.js");
  if (t.mergeIntent) { // an approved merge being re-verified after a sync with main or a conflict repair
    if (review && (review.score < 4 || review.recommend === false)) return void fail(g, { stage: "review", title: "Approved merge repair is not ready", detail: `A reviewer went through the repair and found it not ready.\n\n${reviewFindings(review)}`, next: "The agent could not make this repair pass review. Address the findings before retrying.", agentCanFix: true });
    t = g.set((t) => { t.review = review; t.stat = change?.stat; t.reviewedHead = head; t.mergeIntent = { ...t.mergeIntent, verifiedHead: head }; });
    if (holdPrFailure(g, t)) return;
    t = g.set({ stage: "merging", msg: "merging" });
    return void (await landCore(id, g));
  }
  if (!toLand) return void done(`${review ? `Reviewed ${review.score}/5${review.recommend === true ? ", says accept" : review.recommend === false ? ", says don't accept" : ""}. ` : ""}${firstLine(text) || "finished"}${note}`, { review });
  t = g.set((t) => { t.review = review; t.stat = change.stat; t.reviewedHead = head; t.mergeFailed = false; });
  if (holdPrFailure(g, t)) return;
  // 5. A repo that lands by itself still wants a good review first: below 4, you are asked.
  if (repo.land === "auto" && !t.requireApproval && (!reviewNeeded || (review && review.score >= 4 && review.recommend !== false))) {
    t = g.set((t) => { t.stage = "merging"; t.msg = "merging"; t.mergeIntent = { approvedAt: Date.now(), repairs: 0, verifiedHead: head, auto: true }; });
    return void (await landCore(id, g));
  }
  // Finished work that waits for your yes is not done: it is blocked on you.
  t = g.set((t) => { t.stage = "approval"; t.msg = approvalMessage(t, note); t.seen = false; });
  F.labelPane(t, review ? `review ${review.score}/5` : "approve?");
  F.notify(t, `${t.title}: approve to merge?`, review ? `Reviewed ${review.score}/5. ${review.text}` : firstLine(text));
}
// A pull-request blocker found by polling survives a passing local check: remote CI must confirm.
function holdPrFailure(g, t) {
  if (!t.prFailure) return false;
  const h = g.set((t) => { t.stage = "approval"; t.failure = null; t.seen = false; t.msg = `Local checks passed; pull request still blocked: ${t.prFailure.title}. Wait for remote confirmation or send the details to the agent.`; });
  F.labelPane(h, "pr blocked");
  return true;
}

// ---- the reviewer: a visible herdr agent in a split of the task's own space ----------------------------------------------
async function closeReviewer(id) {
  const t = S.get(id);
  if (!t?.link?.reviewer?.pane) return;
  try { F.h(t).paneClose(t.link.reviewer.pane); } catch {}
  try { S.update(id, (t) => { if (t.link) t.link = { ...t.link, reviewer: null }; }, { waitMs: 10000 }); } catch {}
}
export function reviewBrief(t, { text, change, toLand, ch }) {
  const dir = `${F.RULE_DIR}/review-${t.n}`;
  const share = ch.serve === "tailscale"
    ? "If you start something for the human to try (a dev server, a page), bind it to 127.0.0.1 and share it privately on their tailnet: run `tailscale serve status` first so you replace nothing, then `tailscale serve --bg --https=<a free port> <your port>`; the link is https://<this machine's tailnet name>:<that port>/. Never use tailscale funnel or anything public. Leave it running."
    : "If you start something for the human to try (a dev server, a page), bind it to 127.0.0.1, leave it running, and give its http://127.0.0.1:<port>/ link.";
  return [
    "You are an adversarial reviewer. Another agent says the task below is finished. Assume it is not until the evidence says so: your job is to find what is wrong, missing or risky, and to prove what works.",
    (toLand ? "You are in the repository, on the branch with the change, with all your tools." : "You are in the folder where the work was done, with all your tools. There is no diff: find what the agent made or changed from what it says below.") + " Read the changed files and what surrounds them. Then actually exercise the change: run it, run its tests, open it in a browser if it has a screen, try the awkward inputs. Check it against what was asked: does it do all of it, correctly? Does it break anything nearby? Ignore taste and style nits.",
    "You are here to review, not to fix. Do not change, commit, push or merge anything in the repository. Whatever you alter in the code is discarded when you finish.",
    ch.artifacts ? `Curate evidence that genuinely helps the human judge this work. Choose a small set of distinct, useful items (aim for at most six); no duplicates, scratch files, exhaustive output dumps, or decorative reports. A single navigable review page will combine the work summary, your verdict and only the evidence you explicitly list in your verdict. Do not make your own wrapper page. Each caption should name what matters; each detail should explain what that item proves, or how to try it.\n- Something with a screen (a page, an app, a game, a chart): screenshots of it working, and of anything broken.\n- Something that moves or is interactive: a short screen recording, if you are able to make one.\n- Something a person can use: a link to try it themselves.\n- Logic, a library, a script: the output of the tests or commands you ran, saved as a text file.\n- A tiny or obvious change (a typo, a rename, a one-line fix): no artifact is needed. Do not manufacture any.\nSave evidence files in ${dir}/ in this folder (git ignores it), using plain file names. Do not include secrets or private credentials in evidence.\n${share}` : "",
    `Task: ${t.title}`, t.description ? `Details:\n${t.description.slice(0, 3000)}` : "",
    `What the agent says it did:\n${String(text || "").slice(0, 2000)}`,
    toLand ? `The change is everything on this branch since it started${change.stat ? ` (${change.stat})` : ""}. The commit under review is ${change.head}. See all of it yourself, it is not pasted here: \`git diff ${change.range}\`` : "",
    toLand ? "Then give one clear recommendation, separate from the score: should the human merge this as it stands, yes (true) or no (false)? A 4 with a harmless nit can be a yes; a 4 with something that must not ship is a no." : "Then give one clear recommendation, separate from the score: should the human accept this work as it stands, yes (true) or no (false)?",
    "Rate it: 5 = ready to merge, nothing found. 4 = fine, minor points only. 3 = works but has a real problem worth fixing. 2 = significant problems. 1 = does not do the job or is unsafe.",
    `Last of all, save your verdict as JSON in ${dir}/verdict.json, then stop. The board waits for that file. Its shape: {"commit": "${change?.head || "<the commit you reviewed>"}", "score": <1 to 5>, "recommend": <true or false>, "text": "<two or three plain sentences: your overall judgement>", "problems": ["<each real problem, one sentence, naming the file>", ...], "checks": ["<what you actually exercised and the result>", ...], "limitations": ["<important areas you could not verify>", ...], "artifacts": [{"file": "<file name you saved in that folder>" or "url": "<link to try it>", "caption": "<what it shows, a few words>", "detail": "<why it matters or what to try>"}, ...]}  (artifacts may be an empty list; do not invent checks or proof)`,
  ].filter(Boolean).join("\n\n");
}
export function parseVerdict(raw, head) {
  const j = JSON.parse(raw);
  if (!Number.isInteger(j.score) || j.score < 1 || j.score > 5 || typeof j.text !== "string" || !j.text.trim()) throw new Error("no valid verdict");
  // The verdict must name the commit it reviewed; a verdict for another commit is ignored.
  if (head) { const c = String(j.commit || "").trim().toLowerCase(); if (c.length < 7 || !head.toLowerCase().startsWith(c)) return null; }
  const sentences = (xs) => (Array.isArray(xs) ? xs : []).map((x) => String(x).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 8);
  return { score: j.score, recommend: typeof j.recommend === "boolean" ? j.recommend : undefined, text: j.text.replace(/\s+/g, " ").trim(), problems: sentences(j.problems), checks: sentences(j.checks), limitations: sentences(j.limitations), listed: j.artifacts, artifacts: [], at: Date.now(), head: head || null };
}
async function runReview(id, g, { text, change, toLand, ch }) {
  let t = g.set({ stage: "reviewing", msg: "under review", watch: null });
  g.allow("reviewneeds");
  const api = F.h(t);
  const folder = S.cwdOf(t);
  const dir = F.reviewDir(t);
  const verdictFile = path.join(dir, "verdict.json");
  // The folder is emptied before the reviewer starts. Inside the working folder, so an agent's sandbox allows the writes.
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const brief = reviewBrief(t, { text, change, toLand, ch });
  let pane = null, error = "", review = null, sent = false, blockedSaid = false;
  try {
    preTrust(ch.reviewer, t.root || S.folderOf(t.id));
    await closeReviewer(id); // a pane left over from an interrupted round
    pane = api.paneSplit(t.link.pane, { cwd: folder });
    const taken = api.agents().map((a) => a.name).filter(Boolean);
    let name = `${t.link.agent || `sw-task-${t.n}`}-r`.slice(0, 32);
    if (taken.includes(name)) name = `${name.slice(0, 27)}-${String(Date.now() % 10000).padStart(4, "0")}`;
    t = g.set((t) => { t.link = { ...t.link, reviewer: { pane: pane.pane_id, agent: name, kind: ch.reviewer } }; });
    try { api.agentStart(name, ch.reviewer, pane.pane_id, startArgs(ch.reviewer, { model: ch.reviewerModel, effort: ch.reviewerEffort })); }
    catch (e) { if (e.code !== "agent_not_ready") throw e; }
    const until = Date.now() + ms("HERDR_SUPERWORK_REVIEW_MS", 20 * 60000);
    const every = ms("HERDR_SUPERWORK_POLL_MS", 3000);
    for (;;) {
      g.check();
      // The verdict file appearing is the finish signal.
      if (fs.existsSync(verdictFile)) {
        await sleep(Math.min(every, 300)); // let the write complete
        try { review = parseVerdict(fs.readFileSync(verdictFile, "utf8"), toLand ? change.head : null); if (review) break; fs.rmSync(verdictFile, { force: true }); }
        catch (e) { error = String(e.message || e).replace(/\s+/g, " ").slice(0, 400) || "no valid verdict"; break; }
      }
      if (Date.now() > until) { error = "review timed out"; break; }
      const a = api.agentGet(pane.pane_id);
      if (!a && sent) { error = "the reviewer exited without a verdict"; break; }
      if (!a && !api.paneGet(pane.pane_id)) { error = "the reviewer's terminal was closed"; break; }
      // herdr status is used only to notice a reviewer that is blocked: "review needs you".
      const blocked = a?.agent_status === "blocked";
      const cur = S.get(id);
      if (blocked && cur.stage === "reviewing") { g.set({ stage: "reviewneeds", msg: "the reviewer shows a dialog: go in and answer it", seen: false }); g.allow("reviewing"); if (!blockedSaid) { blockedSaid = true; F.notify(t, `${t.title}: review needs you`, "The reviewer shows a dialog."); } }
      else if (!blocked && cur.stage === "reviewneeds") { g.set({ stage: "reviewing", msg: "under review" }); g.allow("reviewneeds"); }
      if (!sent && a && (a.agent_status === "idle" || a.agent_status === "done")) { try { api.agentPrompt(pane.pane_id, brief); sent = true; } catch (e) { if (e.code !== "agent_blocked" && e.code !== "agent_not_ready") { sent = true; } } }
      await sleep(every);
    }
  } catch (e) {
    if (e.aborted) { await closeReviewer(id); return { aborted: true }; }
    error = `${e.message || e}`.replace(/\s+/g, " ").slice(0, 400);
  }
  // Put back anything the reviewer changed: what you approve is exactly what the agent committed.
  if (toLand) { try { S.gitOut(folder, ["reset", "--hard", change.head]); S.gitOut(folder, ["clean", "-fd"]); } catch {} }
  await closeReviewer(id);
  try { if (S.get(id).stage === "reviewneeds") { g.set({ stage: "reviewing", msg: "review complete" }); } } catch (e) { if (e.aborted) return { aborted: true }; }
  if (!review) return { error: error || "no valid verdict" };
  // Move the folder to the task's artifacts and publish the evidence page.
  const art = S.artifactsDir(id);
  try { fs.rmSync(art, { recursive: true, force: true }); fs.mkdirSync(path.dirname(art), { recursive: true }); fs.cpSync(dir, art, { recursive: true }); fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  try {
    t = S.get(id);
    review.artifacts = await publishReview({ enabled: ch.artifacts, dir: art, listed: review.listed, review, task: t, serve: ch.serve,
      context: { id, title: t.title, description: t.description, summary: text, stat: change?.stat, head: change?.head, pr: t.pr } });
  } catch { review.artifacts = []; } // a publish failure must not bypass the requested-review gate, nor fail the review
  delete review.listed;
  return { review };
}
