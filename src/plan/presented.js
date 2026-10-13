// A program in its own plan mode presents its plan: the board takes it there, and the tool that would ask in the terminal is refused.
// `herdr-superwork plan-written` is run by the hook the board passes at launch (agents/kinds.js: Claude Code's
// PreToolUse on ExitPlanMode), inside the agent's turn. It saves the plan as the task's plan file, tells the agent
// on stderr to stop, and exits 2, which is how such a hook says no. The turn then ends, and its end is the plan's
// (plan/written.js). Anything that is not a plan of an open plan step is let through (exit 0).
import fs from "node:fs";
import * as S from "../store.js";
import { open, writePlan } from "../plan.js";

export const SAVED = "The work board has your plan: it is saved, and it now waits for approval there. Stop here, with one line that says so. Do not present the plan again, and change nothing, until you are sent a message.";
export function presented({ id, token }, input = null) {
  try {
    const t = id && S.get(id);
    if (!t || !open(t) || !S.tokenOk(t.id, "agent", token)) return 0;
    const j = input || JSON.parse(fs.readFileSync(0, "utf8") || "{}"), tool = j.tool_input || {};
    let plan = String(tool.plan || "").trim();
    if (!plan && tool.planFilePath) { try { plan = fs.readFileSync(tool.planFilePath, "utf8").trim(); } catch {} }
    if (!plan) return 0;
    writePlan(t, plan);
    process.stderr.write(`${SAVED}\n`);
    return 2;
  } catch { return 0; }
}
