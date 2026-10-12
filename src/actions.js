// The exact actions of the board, also the subcommands any agent can run from its shell. Each one only records a
// request under the task lock and, when a long job follows, starts the detached runner; none of them waits for it.
// One area per file in actions/; this file only passes them on, so the rest of the code still says A.name.
export * from "./actions/filing.js";
export * from "./actions/suggestions.js";
export * from "./actions/start.js";
export * from "./actions/talk.js";
export * from "./actions/finish-line.js";
export * from "./actions/archive.js";
