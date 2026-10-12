// The finish line: commit, check, push, draft pull request, review, then the approval gate. Never merges by itself
// unless the autoMerge setting is on (finish/auto-merge.js). Runs in a detached runner, started by the event hook when herdr says the
// agent stopped, so it works with the board closed. One step per file in finish/; this file only passes them on.
export * from "./finish/shared.js";
export * from "./finish/turn-ended.js";
export * from "./finish/pipeline.js";
export * from "./finish/sync-job.js";
export * from "./finish/recover-job.js";
export * from "./finish/review-brief.js";
export * from "./finish/faults.js";
