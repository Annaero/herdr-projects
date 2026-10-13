// The automations themselves: making one, changing its name, prompt or trigger, its own settings, on and off,
// removing it. An automation is a saved task plus a trigger:
//   { id, name, prompt, trigger, repo, root, settings, on, since, nextAt, offWhy, created, lastTask, made }
// (`lastTask`: the task of its last firing; `made`: when its last few tasks were made. Both are for the guards in fire.js.)
// `settings` holds only the work settings that differ, exactly as a task holds its own; at a firing they are put on
// the new task and everything else is looked up by the one rule. There is no place of its own in that order.
import crypto from "node:crypto";
import fs from "node:fs";
import * as S from "../store.js";
import { nextAfter, sayTrigger } from "./triggers.js";
import { RESEARCH, isResearch } from "../research.js";

const refuse = (msg) => { throw Object.assign(new Error(msg), { refused: true }); };
export function find(ref) {
  const a = S.automation(ref);
  if (!a) { const names = S.automations().map((x) => x.name), near = S.nearest(String(ref ?? ""), names); refuse(`No automation "${ref}".${near ? ` Did you mean ${near}?` : ""}${names.length ? ` There ${names.length === 1 ? "is" : "are"}: ${names.join(", ")}.` : " There are none yet."}`); }
  return a;
}
// A name is what its tasks are called, so it follows a title's limit, and no two automations share one.
function nameOf(text, except = "") {
  const name = S.oneLine(text, 400);
  if (!name) refuse("An automation needs a name: a few words, as its tasks will be called.");
  if (S.titleWidth(name) > S.TITLE_MAX) refuse(`An automation's name is the title of its tasks: ${S.TITLE_RULE}. "${name}" has ${S.titleWidth(name)}.`);
  if (/^[a-f0-9]{8}$/.test(name)) refuse("That name reads like an automation's id. Give it a name in words.");
  const taken = S.automations().find((a) => a.id !== except && a.name.toLowerCase() === name.toLowerCase());
  if (taken) refuse(`There is an automation "${taken.name}" already. Change that one, or pick another name.`);
  return name;
}
const promptOf = (text) => { const p = String(text ?? "").replace(/\r/g, "").trim(); if (!p) refuse("An automation needs a prompt: what its task is to do, as you would describe a task."); return p; };

// ---- its own settings: looked up as its next task's would be -----------------------------------------------------------
// A task that does not exist yet, in the automation's repo, holding the automation's own settings: asking the one
// lookup about it answers what the next firing's task will run on, and where each value comes from.
export const asTask = (a, settings = a.settings) => ({ id: `${a.repo}/0`, repo: a.repo, settings: { ...(settings || {}) } });
// All of an automation's own values together, checked as a task's would be: a work setting only, a right value, and
// an effort or an access that fits the program it is for. Returns them as they are kept.
export function checkedSettings(a, pairs) {
  for (const name of Object.keys(pairs)) {
    const e = S.entryOf(name);
    if (e && e.kind === "board") refuse(`${name} is a board setting: it is yours only and cannot be set on an automation. Set it for yourself: herdr-superwork set ${name} <value>`);
    if (e && S.needsRepo(name) && !S.inRepo(asTask(a))) refuse(`${name} does not apply to "${a.name}": its folder is no repo.`);
  }
  return S.checked(pairs, { task: asTask(a) });
}
// Will its next task be research only? Its own setting, else what any task in its repo would be.
export const researchOnly = (a) => isResearch(asTask(a));
// Every work setting as the next task will have it: { name, value, from, own, note }.
export const settingRows = (a) => S.settingRows({ task: asTask(a) }).filter((r) => r.kind === "work").map((r) => ({ ...r, from: r.own ? "this automation" : r.from }));
export function setSetting(ref, name, value) {
  const a = find(ref), values = checkedSettings(a, { ...a.settings, [name]: value });
  S.changeAutomation(a.id, (x) => { x.settings = values; });
  return settingRows(find(a.id)).find((r) => r.name === name);
}
export function unsetSetting(ref, name) {
  const a = find(ref);
  if (S.entryOf(name)?.kind !== "work") checkedSettings(a, { [name]: "x" }); // an unknown name and a board setting are refused in the usual words
  S.changeAutomation(a.id, (x) => { x.settings = { ...(x.settings || {}) }; delete x.settings[name]; });
  return settingRows(find(a.id)).find((r) => r.name === name);
}

// ---- making and changing ------------------------------------------------------------------------------------------------
// `folder`: where the command was typed; `repo`: a repo by its name on the board or a path, as `add` takes it.
// `research`: the short form (--research, --no-research) of one of its settings, research.only.
const withResearch = (settings, research) => ({ ...(settings || {}), ...(research === undefined ? {} : { [RESEARCH]: research === true }) });
export function add({ name, prompt, trigger, repo = "", folder, settings = {}, research, now = Date.now() }) {
  if (!trigger) refuse("An automation needs one trigger: --schedule \"every 2h\" or --when merged.");
  const where = S.folderFor(repo, folder);
  if (!where || !fs.existsSync(where)) refuse(`No repo or folder "${repo}".`);
  const { name: repoName, root } = S.repoOf(where);
  const a = { id: crypto.randomBytes(4).toString("hex"), name: nameOf(name), prompt: promptOf(prompt), trigger, repo: repoName, root, settings: {}, on: true, since: now, created: now };
  a.settings = checkedSettings(a, withResearch(settings, research));
  arm(a, now);
  return S.changeAutomations((list) => { if (list.some((x) => x.name.toLowerCase() === a.name.toLowerCase())) refuse(`There is an automation "${a.name}" already.`); list.push(a); return a; });
}
// A trigger as it starts to count: a schedule from now (what was due before is never caught up).
function arm(a, now) {
  a.since = now;
  a.nextAt = a.on && a.trigger.kind === "schedule" ? nextAfter(a.trigger, now, now) : 0;
}
// A change applies from the next firing: tasks already made keep what they had.
export function change(ref, { name, prompt, trigger, research, now = Date.now() } = {}) {
  const a = find(ref);
  const next = { ...(name !== undefined ? { name: nameOf(name, a.id) } : {}), ...(prompt !== undefined ? { prompt: promptOf(prompt) } : {}) };
  if (name === undefined && prompt === undefined && !trigger && research === undefined) refuse("Nothing to change: give --name, --prompt, a trigger (--schedule, --when), or --research / --no-research.");
  if (research !== undefined) next.settings = checkedSettings(a, withResearch(a.settings, research));
  return S.changeAutomation(a.id, (x) => { Object.assign(x, next); if (trigger) { x.trigger = trigger; arm(x, now); } });
}
// Off, it never fires and keeps everything. On again, a schedule counts from now and the runaway count starts over.
export function turn(ref, on, now = Date.now()) {
  const a = find(ref);
  return S.changeAutomation(a.id, (x) => { x.on = !!on; delete x.offWhy; if (on) { x.countFrom = now; arm(x, now); } else x.nextAt = 0; });
}
export function remove(ref) {
  const a = find(ref);
  S.changeAutomations((list) => { const n = list.findIndex((x) => x.id === a.id); if (n >= 0) list.splice(n, 1); });
  S.dropFirings(a.id);
  return a;
}
export { sayTrigger };
