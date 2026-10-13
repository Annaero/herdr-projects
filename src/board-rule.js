// What an agent or a reviewer the board started is told about the board itself: able, not nudged. The board refuses
// them no command (an automation's agent adds and delegates further tasks when its task says so), and their rules
// list no way to change the board: they leave it alone unless a human explicitly told them to. A task an automation
// made is covered by the same rule: its description is the automation's prompt, the human's own words, and its
// rules say so in a line of their own (automations/told.js: automationRule).
const TOLD = "An explicit instruction in this task's own description, or in a message from the human, counts as being told.";

export const AGENT_BOARD_RULE = `Do nothing to the work board beyond your own task (reporting your own state and suggesting work you came across, both as said here) unless a human explicitly told you to. ${TOLD} Work you merely come across is a suggestion, never a task.`;
export const REVIEWER_BOARD_RULE = `Do nothing to the work board unless a human explicitly told you to. ${TOLD} A fault you merely come across goes in your findings, never onto the board: one that was there before this change is marked \`preexisting\`, and the board suggests it to the human by itself.`;
