// The rows every screen test can draw: one task in each state the board shows, with the long, wide and odd text that
// breaks a layout (a title at the limit, a line of CJK, an emoji, a path with no space, a number that grows). Kept
// in one place so a new state is one new row here, and every "nothing overflows" test draws it.
const MIN = 60000;
const review = (pass, findings = []) => ({ round: 1, meets: pass, gate: "major", pass, text: pass ? "The change meets the task." : "A title is cut in the middle of a word.", findings, checks: ["Ran the whole check."], limitations: ["Not tried on another machine."], head: "abcdef12345" });
const finding = (severity, subject, more = {}) => ({ id: "F1", severity, subject, where: "src/store/titles.js:14", proof: "ran it with a title of 81 characters", ...more });
// `id`: a task that exists in the test's world (the panel reads its settings). `now`: the moment the rows are drawn at.
export function fixtureRows(task, now = Date.now()) {
  const base = { owner: "me", ...task, agent: "claude", app: "claude", at: now - MIN, description: "A task title should have a maximum length. A longer one is cut between words.\n\nSecond paragraph, with a/very/long/path/that/has/no/space/in/it/at/all/src/board/view/row-wrap.js and more words after it.", reviews: [], reviewRound: 0 };
  const failed = review(false, [finding("critical", "A title is cut in the middle of a word"), finding("minor", "The limit is written in two places"), finding("major", "The old menu flickers", { preexisting: true })]);
  return {
    "to do": { ...base, agent: undefined, app: "", state: "idle", stage: "todo" },
    "yours, in progress": { ...base, agent: undefined, app: "me", state: "working", stage: "progress", progress: 40, eta: 90, msg: "Drafting" },
    queued: { ...base, state: "idle", stage: "queued", msg: "Waiting for a free slot" },
    starting: { ...base, state: "working", stage: "starting", msg: "Starting" },
    working: { ...base, state: "working", stage: "working", progress: 60, eta: 11, msg: "Found the cause; now checking every caller of the resize handler for the same mistake" },
    "working, long numbers": { ...base, n: 12345, state: "working", stage: "working", progress: 100, eta: 1439, msg: "x".repeat(300), at: now - 400 * 24 * 60 * MIN },
    checking: { ...base, state: "working", stage: "checking", progress: 65, eta: 3, msg: "Running the check · tests 31 of 47" },
    reviewing: { ...base, state: "working", stage: "reviewing", progress: 35, eta: 6, msg: "Reading the diff.", reviewRound: 1 },
    "asks you": { ...base, state: "blocked", kind: "question", stage: "asks", msg: "Should the old settings file be removed, or kept for one more version so that nobody loses what they set?" },
    "needs a login": { ...base, state: "blocked", kind: "auth", stage: "asks", msg: "Needs a login" },
    "ready to approve": { ...base, state: "blocked", kind: "permission", stage: "approval", pr: "https://github.com/a/b/pull/60", prState: "passing", stat: " 19 files changed, 340 insertions(+), 27 deletions(-)", reviews: [review(true)], review: review(true), reviewRound: 1, msg: "Approve to merge? Review: Pass. Done." },
    "review failed": { ...base, state: "blocked", kind: "permission", stage: "approval", pr: "https://github.com/a/b/pull/123456", prState: "failing", reviews: [failed], review: failed, reviewRound: 1, msg: "Approve to merge? Review: Fail · 1 critical, 1 minor, 1 pre-existing." },
    "went wrong": { ...base, state: "error", stage: "failed", msg: "Conflict with main", failure: { stage: "merge", phase: "sync", title: "Conflict with main", detail: "Conflicting files:\nsrc/board/view/row.js\nsrc/board/view/a-file-with-a-very-long-name-and-no-space-anywhere-in-it.js", agentCanFix: true, next: "Resolve the conflict." } },
    "stopped without a summary": { ...base, state: "error", stage: "nosummary", msg: "Stopped without a summary" },
    done: { ...base, state: "done", stage: "done", pr: "https://github.com/a/b/pull/60", prState: "merged", prMerged: true, reviews: [review(true)], review: review(true), reviewRound: 1, msg: "Merged: https://github.com/a/b/pull/60", said: "Titles longer than 60 characters are cut between words." },
    archived: { ...base, state: "done", stage: "done", archivedAt: now - MIN, msg: "Merged" },
    "research only": { ...base, state: "working", stage: "working", research: true, msg: "Reading the logs" },
    "a wide title": { ...base, title: "日本語のタイトルはとても長いので二倍の幅になります 🚀🚀 and then some more", state: "working", stage: "working", progress: 5, msg: "幅の広い文字 🎉 の行" },
    "a title at the limit": { ...base, title: "T".repeat(60), state: "idle", stage: "todo" },
  };
}
