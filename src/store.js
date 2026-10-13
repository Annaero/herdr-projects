// Tasks on disk, locks and settings. No herdr calls here: this file only knows files.
//
// One folder per task: <data>/tasks/<repo>/<n>/ holding task.json, inbox.jsonl and artifacts/.
// task.json is the whole truth the plugin owns about a task; what herdr knows (agent status) is read live.
// Each area is a file of its own in store/ (docs/where-things-live.md says which); everything is still reached as S.name.
export * from "./store/files.js";
export * from "./store/move-home.js";
export * from "./store/settings.js";
export * from "./store/repos.js";
export * from "./store/keys.js";
export * from "./store/tasks.js";
export * from "./store/attempts.js";
export * from "./store/runs.js";
export * from "./store/titles.js";
export * from "./store/inbox.js";
export * from "./store/failures.js";
export * from "./store/retries.js";
export * from "./store/reviews.js";
export * from "./store/old-suggestions.js";
export * from "./store/automations.js";
export * from "./store/marks.js";
export * from "./store/check-runs.js";
