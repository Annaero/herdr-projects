// Reports and research-only tasks: a report never goes into the repo, and a task marked research only changes nothing in it.
// A report (a review, a research result, anything written for the human to read that is not part of the product) is
// written into the task's own folder among the board's reports (docs/home-folder.md), outside every repo; the board
// gives it a private link.
// A research-only task (`research`, a setting of one task) has that report as its whole result: the finish line
// pushes, opens and merges nothing for it, and a change in its worktree or on its branch goes back to its agent.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import * as S from "./store.js";

// The setting exists per task only and is off unless chosen, so the task's own choice is all there is to read: this
// also answers for a row that came from another machine.
export const isResearch = (t) => t?.research === true;
// Where a task's report is: a folder of its own among the board's reports, where the agent writes it and where it
// stays. And the name the board serves it under.
export const REPORT = "report";
export const reportFolder = (t) => path.join(S.reportsDir(), ...String(t.id).split("/"));
// The page a report opens on: the first of these that is there, else its first file.
const FIRST = ["index.html", "report.html", "report.md", "README.md"];

// ---- what agents are told ----------------------------------------------------------------------------------------------
// Every agent, in every repo: where a report goes.
export const reportRule = (t) => `A report, a review or a research result (anything you write for the human to read that is not part of the product) never goes into the repo: do not commit one, in no folder. Save it in ${reportFolder(t)}/ (this task's own folder among the board's reports, outside every repo), as index.html (one page that stands by itself) or report.md. The board gives the human a private link to it.`;
// The agent of a research-only task.
export const researchRule = (t) => `This task is research only: change nothing in the repo. Add, edit and delete no file, and commit nothing. Your result is a report, saved as said below, plus a suggestion on the task for each piece of work that should follow from it (the suggest command below). When you finish, the board looks at this ${t.worktree ? `worktree and at branch ${t.branch}` : "folder"}: if anything changed, committed or not, nothing is pushed or merged and it comes back to you.`;
// The worktree's line for such a task: there is nothing to commit, and no pull request follows.
export const researchTree = (t) => `You are in your own git worktree on branch ${t.branch}; the human's checkout is elsewhere and untouched. Commit nothing on this branch, and do not push, merge or switch branches. When you finish, the board keeps your report and opens no pull request.`;
// The reviewer of a research-only task: it reviews the report, and a change to the repo is a finding.
export const reviewRule = (t) => `This task is research only: nothing in the repository may change, and its whole result is a report, in ${reportFolder(t)}/ (outside the repository; the human gets a private link to it). You are in the folder where the work was done, with all your tools. Read the report whole and check it against what was asked: does it answer all of it, correctly? Check what it states against the code, the sources and the commands it speaks of: a claim that is false, or that nothing shows, is a finding. No report there is a critical finding. The agent was told to change nothing in the repository: look for yourself (\`git status\`, \`git log\`, other branches, anything pushed) and report any file it added, changed or deleted, and any commit, as a critical finding. Ignore taste and style nits.`;

// ---- what a research-only task changed ---------------------------------------------------------------------------------
// The paths git calls changed in a folder (new files too; the board's own folder is ignored by git), each with what
// it holds: the file's content and mode (a hash; for a very large file its size and when it was written) and what is
// staged of it, its mode there too. A file that was already changed and is changed again reads differently, also when only what is staged
// changed; one put back as it was reads the same. Names are read as git has them (`-z`): none is quoted.
function dirtyOf(dir) {
  const out = {}, staged = {};
  // What is staged against the last commit: ":<modes> <blob before> <blob after> <letter>", then the path (two for a rename).
  const raw = S.gitOut(dir, ["diff", "--cached", "--raw", "--no-abbrev", "-z", "HEAD"]).split("\0");
  for (let n = 0; n < raw.length; n++) {
    if (!raw[n].startsWith(":")) continue;
    // The whole entry is what is compared: the staged mode (an executable flag set in the index alone) as well as the blob.
    const entry = raw[n], names = /^[RC]/.test(entry.split(" ")[4] || "") ? [raw[++n], raw[++n]] : [raw[++n]];
    for (const rel of names) if (rel) staged[rel] = entry;
  }
  // Two status letters, a blank, the path; after a rename or a copy, the path it came from as an entry of its own.
  // (The first entry may have lost a leading blank: its letters are then one.)
  const entries = S.gitOut(dir, ["status", "--porcelain", "--untracked-files=all", "-z"]).split("\0");
  const names = new Set(Object.keys(staged));
  for (let n = 0; n < entries.length; n++) {
    const m = /^([ MADRCUT?!]{1,2}) (.+)$/s.exec(entries[n]);
    if (!m) continue;
    names.add(m[2]);
    if (/[RC]/.test(m[1]) && entries[n + 1]) names.add(entries[++n]);
  }
  // A file git was told not to look at (assume-unchanged, skip-worktree) is in neither list whatever is done to
  // it: it is read here all the same, with that mark.
  const hidden = {};
  for (const l of S.gitOut(dir, ["ls-files", "-v", "-z"]).split("\0")) if (/^[a-zS] /.test(l)) { hidden[l.slice(2)] = l[0]; names.add(l.slice(2)); }
  for (const rel of names) {
    let file = "gone";
    try { const f = path.join(dir, rel), s = fs.lstatSync(f); file = `${s.mode.toString(8)}:${s.isFile() && s.size < 8e6 ? createHash("sha1").update(fs.readFileSync(f)).digest("hex") : `${s.size}:${s.mtimeMs}`}`; } catch {}
    out[rel] = `${file} ${staged[rel] || "-"}${hidden[rel] ? ` hidden:${hidden[rel]}` : ""}`;
  }
  return out;
}
const commitsSince = (dir, from) => { try { return Number(S.gitOut(dir, ["rev-list", "--count", `${from}..HEAD`])) || 0; } catch { return 0; } };
const commitWords = (n) => `(${n} ${n === 1 ? "commit" : "commits"} added)`;
// A task that works in your own checkout has no worktree to look at, and what is changed there may be yours. So the
// checkout is written down as it stands when the agent starts (delegate.js): its commit, and every changed file.
// null where there is nothing to compare with later (no repo, or one with no commit).
export function startMark(dir) {
  try { return { head: S.gitOut(dir, ["rev-parse", "HEAD"]), dirty: dirtyOf(dir) }; } catch { return null; }
}
// Everything that changed. In the task's own worktree: what is not committed, what its branch holds beyond the main
// it started from or last took in, every commit there (one that changes no file too, a merge too), and being
// on another branch than its own. In your checkout: every file that reads
// differently from when the agent started, and every commit since. `null`: it cannot be told (no mark was taken).
export function changesOf(t, dir) {
  const seen = new Set();
  if (!t.worktree) {
    const was = t.startMark;
    if (!was) return null;
    let now = {};
    try { now = dirtyOf(dir); } catch { return null; }
    for (const rel of new Set([...Object.keys(now), ...Object.keys(was.dirty || {})])) if (now[rel] !== (was.dirty || {})[rel]) seen.add(rel);
    const n = commitsSince(dir, was.head);
    if (n) seen.add(commitWords(n));
    else { try { if (S.gitOut(dir, ["rev-parse", "HEAD"]) !== was.head) seen.add("(the checkout is on another commit than when the agent started)"); } catch {} }
    return [...seen];
  }
  try { for (const rel of Object.keys(dirtyOf(dir))) seen.add(rel); } catch {}
  for (const from of [t.syncedTo, t.baseSha || t.from].filter(Boolean)) {
    try { for (const l of S.gitOut(dir, ["diff", "--name-only", `${from}...HEAD`]).split("\n")) if (l.trim()) seen.add(l.trim()); } catch { continue; }
    const n = commitsSince(dir, from);
    if (n) seen.add(commitWords(n));
    break;
  }
  const on = S.branchOf(dir);
  if (t.branch && on !== t.branch) seen.add(`(the worktree is on ${on || "no branch"}, not on ${t.branch})`);
  return [...seen];
}
export const changedWords = (list) => `${list.length} ${list.length === 1 ? "change" : "changes"} in the repo`;
// What the agent is told when its research-only task changed the repo, and what the task shows if it does so again.
export function changedFailure(t, tree, list, rounds) {
  const shown = list.slice(0, 30).map((f) => `- ${f}`).join("\n") + (list.length > 30 ? `\n- … and ${list.length - 30} more` : "");
  const gaveUp = rounds === undefined ? "" : ` after ${rounds} ${rounds === 1 ? "round" : "rounds"}`;
  return {
    stage: "research", auth: false, agentCanFix: true, title: `Research only, but the repo was changed${gaveUp}`,
    msg: `Research only, but its agent changed the repo${gaveUp ? ` again${gaveUp}` : ""} (${changedWords(list)}): nothing was pushed, opened or merged`,
    detail: `This task is research only: it may change nothing in the repo. Nothing was committed, pushed, opened as a pull request or merged.\n\n${t.worktree ? `Worktree: ${tree}\nBranch: ${t.branch || ""}` : `Folder (your own checkout): ${tree}`}\n\nChanged${t.worktree ? "" : " since the agent started"}:\n${shown}`,
    next: t.worktree
      ? `Move the result out of the repo: save the report in ${reportFolder(t)}/ (outside the repo), then undo every change, the commits too, so that the branch is where it started (${String(t.syncedTo || t.baseSha || t.from || "").slice(0, 12)}) with no commit of yours on it and \`git status\` is clean. If the change is wanted after all, the human turns the task's research setting off: config research false --id ${t.id}.`
      : `This is the human's own checkout, and it may hold changes of theirs: undo only what you changed yourself, file by file, and never reset or clean the checkout. Move the result out of the repo first: save the report in ${reportFolder(t)}/ (outside the repo). Take back a commit of yours without losing anything of the human's. If a listed change is not yours, or the change is wanted after all, say so and stop: the human turns the task's research setting off (config research false --id ${t.id}) or retries.`,
  };
}

// ---- the report --------------------------------------------------------------------------------------------------------
const filesIn = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile() && !f.name.startsWith(".")).map((f) => f.name).sort(); } catch { return []; } };
// The report the agent wrote, and its link. The folder stays where it is; the page server only serves a task's own
// folder in the board's data, so that folder gets a link to it, beside the review's evidence. `base` answers where
// the task's pages are served from ("" when nothing serves them: then the link is the file); it is only asked when
// there is a report. Returns what the task remembers ({ file, link, at }), or null.
export const reportStore = (id) => path.join(S.artifactsDir(id), REPORT);
export function keepReport(t, base = () => "") {
  const from = reportFolder(t), names = filesIn(from), file = FIRST.find((n) => names.includes(n)) || names[0];
  if (!file) return null;
  let root = "";
  try {
    const to = reportStore(t.id);
    let there = "";
    try { there = fs.readlinkSync(to); } catch {}
    if (there !== from) { fs.rmSync(to, { recursive: true, force: true }); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.symlinkSync(from, to, "dir"); }
    root = base() || "";
  } catch {}
  return { file, link: root ? `${root}/${REPORT}/${encodeURIComponent(file)}` : path.join(from, file), at: Date.now() };
}
