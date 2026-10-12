// What the pieces share: reading herdr's view of a task, and sending text to its agent. One area per file in flow/;
// this file only passes them on, so the rest of the code still says F.name.
export * from "./flow/task.js";
export * from "./flow/live.js";
export * from "./flow/sidebar.js";
export * from "./flow/spaces.js";
export * from "./flow/tabs.js";
export * from "./flow/send.js";
export * from "./flow/git.js";
export * from "./flow/handled-turn.js";
