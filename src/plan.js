// A plan first (`plan.approve`, `plan.agent`): the work starts with a plan, and nothing in the repo is changed until the plan is approved.
// The plan belongs to the task, not to an agent or a worktree: it is one file in the task's own folder on the board,
// written once and approved once, and whoever builds is handed that file. So several attempts on one task (a later
// setting) all build the same approved plan: `buildWords` is what each of them is given.
//
// What a task keeps of it, as `plan`:
//   asked       when the step began                       by          who approves, as read when it began (you, reviewer)
//   home        the working agent's own tab and pane, while a planner of its own (`plan.agent`) holds the task's pane
//   writer      the planner's program and model, when there is one     mode    its program was started in its own plan mode
//   at, words   when the plan was last written, and its first line     rounds  how often it went back to its writer
//   was         the plan that went back (plan.js: planMark): the same file again is not a new plan
//   review      what the reviewer found in it (`plan.approve`: reviewer)
//   undone      what was changed in the repo before the yes, and put back
//   locked      the task's own worktree is read-only until the build starts (plan/lock.js)
//   ignored     the files git ignores, as they were when the step began (plan/untouched.js)
//   approvedAt, approvedBy   the yes: from then on the step is closed and the task is built
//   usage, took the planner's tokens and time, kept when its tab closes: they count to the task
// The steps themselves are in plan/: written.js (the plan's turn ended), build.js (after the yes), review.js (the
// reviewer's look), lock.js (nothing can change), untouched.js (nothing changed).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import * as S from "./store.js";
import { adapter } from "./agents.js";

// The task whose plan it is: an attempt builds its task's plan (attempts.js).
export const source = (t) => (t?.attemptOf ? S.get(t.attemptOf) || t : t);
// ---- where the plan is ---------------------------------------------------------------------------------------------------
// In the task's own folder, among what the board serves for it: so the plan has a private link, as a report has.
export const PLAN = "plan";
export const planFolder = (t) => path.join(S.artifactsDir(t.id), PLAN);
export const planFile = (t) => path.join(planFolder(t), "plan.md");
export function readPlan(t) { try { return fs.readFileSync(planFile(t), "utf8").trim(); } catch { return ""; } }
export function writePlan(t, text) { fs.mkdirSync(planFolder(t), { recursive: true }); fs.writeFileSync(planFile(t), `${String(text).trim()}\n`); }
// The plan as it is on file now, in a few letters: kept when a plan goes back, so that the same file coming back is known for the old plan.
export const planMark = (t) => { const text = readPlan(t); return text ? createHash("sha1").update(text).digest("hex").slice(0, 16) : ""; };
// Its link: `base` answers where the task's pages are served from ("" when nothing serves them: then it is the file).
export const planLink = (t, base = () => "") => { let root = ""; try { root = base() || ""; } catch {} return root ? `${root}/${PLAN}/plan.md` : planFile(t); };

// ---- where the step stands -----------------------------------------------------------------------------------------------
export const APPROVERS = { you: "you", reviewer: "the reviewer" };
// Does this task start with a plan? The setting, read now.
export const wanted = (t) => { const by = S.setting("plan.approve", t); return by === "none" ? "" : by; };
// The step is open: a plan was asked for and nobody has said yes to it. Every turn that ends meanwhile is the plan's.
export const open = (t) => !!t?.plan && !t.plan.approvedAt;
// A planner of its own holds the task's pane.
export const planner = (t) => open(t) && !!t.plan.home;
export const approved = (t) => !!t?.plan?.approvedAt;
// The step is not over: no yes yet, or a yes whose build has not started (its start failed, and is tried again).
export const pending = (t) => !!t?.plan && !t.plan.built;
// Started in its program's own plan mode: only there, and only while the step is open.
export const planArgs = (t, kind = t.agent) => (open(t) && adapter(kind).planMode ? adapter(kind).planMode() : null);

// ---- what agents are told ------------------------------------------------------------------------------------------------
const NOTHING = "change nothing in this folder: add, edit and delete no file, commit nothing, and run nothing that writes into it. Read and run whatever you need to understand the task.";
const WHAT = "The plan says, in plain words: what you understand the task to ask for; what will be changed and where (the files); in which order; how it will be checked; and what you are unsure of or leave out.";
// How the plan reaches the board: a program in its own plan mode presents it there (the board's hook takes it); any other writes the file.
const how = (t) => (planArgs(t)
  ? `Your program was started in its own plan mode: write the plan as that mode has you do it and present it for approval the way the mode asks. The board takes the plan from there and answers that it has it: stop then, and do not present it again until you are sent a message.`
  : `Save it as ${planFile(t)} (the board's own folder for this task, not the folder you work in), replacing an older one, then stop.`);
const AFTER = "The board looks at this folder when you stop, and puts back whatever changed in it. The plan is then read and approved, or it comes back to you with words on what to change: write it again then, whole, the same way.";
// The last line of the first prompt, while the step is open: the rules say the rest.
export const FIRST = "This task starts with a plan (your rules say how): write the plan and stop. Change nothing yet.";
// The working agent that writes its own plan. The rule holds for the whole conversation, so it says when it ends.
export const planRule = (t) => `This task starts with a plan, and nothing is changed before the plan is approved. Until a message from the board says that your plan is approved: ${NOTHING} ${WHAT} ${how(t)} Stopping with the plan written is right in this step: it is not taken for finished work, and nothing is checked or reviewed. ${AFTER} Once a message says the plan is approved, build exactly that plan under the rules below; where you have to leave it, say where and why in your closing summary.`;
// A planner of its own: it never builds.
export const plannerRule = (t) => `You are the planner of this task: you write the plan, and another agent builds from it after the plan is approved. You build nothing: ${NOTHING} ${WHAT} Write it for an agent that has not seen what you read: name the files and the steps. ${how(t)} ${AFTER}`;
// The yes, as the plan's own writer hears it.
export const goWords = (t) => `Your plan is approved${t.plan?.approvedBy === "reviewer" ? " (the reviewer checked it against the task)" : ""}. Build it now, exactly that plan: it is in ${planFile(t)}. From here on the task's rules for the work hold: do the work, check it, and stop only when it is finished. Where you have to leave the plan, say where and why in your closing summary: the review checks the work against the task and against this plan.`;
// The same, for an agent that did not write the plan (a planner did; or one of several attempts).
export const buildWords = (t) => `This task has an approved plan, written by ${t.plan?.writer ? "a planner" : "the agent before you"}: read ${planFile(t)} first, and build exactly that plan. Where you have to leave it, say where and why in your closing summary: the review checks the work against the task and against this plan.`;
// What a builder's first prompt ends with when its task has an approved plan: every one that starts fresh is handed
// the same plan, a single builder and each of several attempts alike.
export const handed = (t) => { const of = source(t); return approved(of) && readPlan(of) ? buildWords(of) : ""; };
// The plan goes back to its writer.
export const backWords = (t, words, from = "the human") => `Your plan is not approved. ${from === "the reviewer" ? "The reviewer checked it against the task and found" : "The human read it and sent it back with these words"}:\n\n${String(words).trim()}\n\nStill ${NOTHING} Write the plan again, whole, with that taken in. ${how(t)}`;
// The reviewer of the finished work: against the task and against the plan.
export const reviewRule = (t, of = source(t)) => (approved(of) && readPlan(of) ? `This task was built from a plan that was approved before the work began: ${planFile(of)}. Read it, and check the work against it as well as against the task. Say where the build left the plan, one sentence each, in \`offPlan\` in your verdict (an empty list when it kept to it). Leaving the plan is a finding only when the result is worse for it or does not do what was asked: then report it by what it does.` : "");
