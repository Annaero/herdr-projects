// The flags each command takes. A command refuses a flag it does not know and names the nearest right one: a
// mistyped flag (`list --archvied`) used to be kept and silently ignored, and the command did something else than
// what was asked.
import { nearest, known } from "../store/settings/values.js";
import { SETTINGS } from "../store/settings-list.js";

// Taken by every command.
const ALWAYS = ["json", "help"];
const SETTING = "any work setting by its name (--review.when never)";
// One command per line, beside the commands it belongs with, never at the end. `settings`: also every --<setting name>.
// `subs`: what each of its subcommands takes instead (`automations add`), and nothing for one that is not named.
// The entries herdr, an agent's hook and the board itself run are here too: no command lets a flag through unread.
const TAKES = {
  board: { flags: ["skill"] },
  help: { flags: [] },
  "--skill": { flags: ["skill"] },
  skill: { flags: ["skill"] },
  hook: { flags: [] },
  "turn-ended": { flags: ["id", "role", "token", "round"] },
  "plan-written": { flags: ["id", "token"] },
  keeper: { flags: [] },
  "keeper-work": { flags: [] },
  run: { flags: ["force", "merged"] },
  open: { flags: [] },
  "open-coordinator": { flags: [] },
  "approve-current": { flags: [] },
  serve: { flags: [] },
  remote: { flags: [] },
  add: { flags: ["desc", "description", "repo", "delegate", "research"], settings: true },
  new: { flags: ["desc", "description", "repo", "delegate", "research"], settings: true },
  list: { flags: ["archived", "all", "query"] },
  ls: { flags: ["archived", "all", "query"] },
  report: { flags: ["state", "kind", "msg", "title", "progress", "eta", "desc", "repo"] },
  describe: { flags: [] },
  rename: { flags: [] },
  delegate: { flags: ["research"], settings: true },
  tell: { flags: [] },
  stop: { flags: [] },
  start: { flags: [] },
  pick: { flags: [] },
  approve: { flags: ["anyway"] },
  review: { flags: [] },
  retry: { flags: [] },
  fix: { flags: [] },
  finish: { flags: [] },
  details: { flags: [] },
  pin: { flags: [] },
  archive: { flags: [] },
  restore: { flags: [] },
  unarchive: { flags: [] },
  clear: { flags: [] },
  set: { flags: ["repo", "task", "automation"] },
  unset: { flags: ["repo", "task", "automation"] },
  show: { flags: ["repo", "task", "automation"] },
  automations: { flags: [], subs: { add: { flags: ["prompt", "desc", "schedule", "when", "every-repo", "repo", "research"], settings: true }, new: { flags: ["prompt", "desc", "schedule", "when", "every-repo", "repo", "research"], settings: true }, change: { flags: ["name", "prompt", "schedule", "when", "every-repo", "research"] }, edit: { flags: ["name", "prompt", "schedule", "when", "every-repo", "research"] } } },
  automation: { flags: [], subs: { add: { flags: ["prompt", "desc", "schedule", "when", "every-repo", "repo", "research"], settings: true }, new: { flags: ["prompt", "desc", "schedule", "when", "every-repo", "repo", "research"], settings: true }, change: { flags: ["name", "prompt", "schedule", "when", "every-repo", "research"] }, edit: { flags: ["name", "prompt", "schedule", "when", "every-repo", "research"] } } },
  coordinator: { flags: [], subs: { tell: { flags: ["delegate"] }, new: { flags: ["agent", "effort"] }, fresh: { flags: ["agent", "effort"] } } },
  machines: { flags: [] },
  "web-ui": { flags: [] },
  "remove-extras": { flags: [] },
  reopen: { flags: [] },
  housekeep: { flags: ["pr"] },
};
const takesOf = (cmd, sub) => { const t = TAKES[cmd]; return t?.subs ? t.subs[sub] || { flags: t.flags } : t; };
// The flags of a command that it does not know, as typed. `sub`: its subcommand, where it has them. A command with
// no entry is no command at all: that is said elsewhere. A name with a dot is a setting where settings are taken,
// and is checked as one below.
export function unknownFlags(cmd, flags, typed = {}, sub = "") {
  const takes = takesOf(cmd, sub);
  if (!takes) return [];
  const ok = new Set([...ALWAYS, ...takes.flags]);
  return Object.keys(flags).filter((k) => !ok.has(k) && !(takes.settings && k.includes("."))).map((k) => (Object.hasOwn(typed, k) && typed[k]) || `--${k}`);
}
// Throws for the first flag the command does not know: what it is, the nearest right one, and all it takes. And for
// a setting no setting has that name: the same refusal `set` gives, with the nearest name.
export function refuseUnknown(cmd, flags, typed = {}, sub = "") {
  const takes = takesOf(cmd, sub);
  if (!takes) return;
  const odd = unknownFlags(cmd, flags, typed, sub);
  if (!odd.length) { if (takes.settings) for (const k of Object.keys(flags)) if (k.includes(".")) known(k); return; }
  const all = [...takes.flags, ...ALWAYS];
  const word = odd[0].replace(/^--(no-)?/, "");
  const names = takes.settings ? SETTINGS.map((s) => s.name) : [];
  // `--reviewer claude` meant a setting of that area: the first one that starts with the word, else the nearest name.
  // A setting's name where no setting is taken: said as that, with the name it most likely was.
  if (word.includes(".") && !takes.settings) {
    const meant = nearest(word, SETTINGS.map((s) => s.name));
    throw new Error(`${cmd === "board" ? "herdr-superwork" : TAKES[cmd].subs && sub ? `${cmd} ${sub}` : cmd} does not know ${odd.join(", ")}: it takes no settings${meant && meant !== word ? ` (and the setting is named ${meant})` : ""}. It takes: ${all.map((f) => `--${f}`).join(", ")}. Nothing was done.`);
  }
  const near = names.find((n) => n.startsWith(`${word}.`)) || nearest(word, [...all, ...names]);
  const list = [...all.map((f) => `--${f}`), ...(takes.settings ? [SETTING] : [])].join(", ");
  const who = cmd === "board" ? "herdr-superwork" : TAKES[cmd].subs && sub ? `${cmd} ${sub}` : cmd;
  throw new Error(`${who} does not know ${odd.join(", ")}.${near ? ` Did you mean --${near}?` : ""} It takes: ${list}. Nothing was done.`);
}
