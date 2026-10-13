// Several attempts at one task, and one result kept: "best of three" with one agent, a "council" of different agents
// with a judge. Both are the settings `attempts.by` (how many, and by whom) and `attempts.pick` (who chooses).
//
// Each attempt is a small task of its own (store/attempts.js) with its own agent, worktree, branch and tab in the
// task's one herdr space. It goes through the usual steps up to the check and stops there. The check filters, the
// picker chooses: none passed, the task failed; one passed, it is the winner; several, you or the reviewer choose.
// The chosen attempt then becomes the task itself, and from there on the task is like any other: one review loop,
// one push, one pull request, one merge. Each area is a file in attempts/.
export * from "./attempts/fan-out.js";
export * from "./attempts/place.js";
export * from "./attempts/settle.js";
export * from "./attempts/adopt.js";
export * from "./attempts/compare.js";
export * from "./attempts/words.js";
export * from "./attempts/diff.js";
