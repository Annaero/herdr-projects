// The Coordinator: the agent behind the box at the bottom of the board. One long-lived, ordinary herdr agent per herdr
// session, in a tab of its own ("Coordinator") in the home space, started with the same arguments as any working
// agent: nothing is held back from it. What you type in the box is typed into that one conversation; it is kept across
// board openings, and resumed when the program exited or herdr restarted. Its state is one file beside the tasks.
//
// Nothing here blocks the board: `send`, `restart`, `fresh`, `stop` and `open` only write the request down and start
// the detached job (`pump`), which makes the herdr calls (an agent's start-up can take a while).
//
// One area per file in coordinator/; this file only passes them on.
export * from "./coordinator/state.js";
export * from "./coordinator/who.js";
export * from "./coordinator/rules.js";
export * from "./coordinator/requests.js";
export * from "./coordinator/place.js";
export * from "./coordinator/pump.js";
export * from "./coordinator/look.js";
export * from "./coordinator/sidebar.js";
