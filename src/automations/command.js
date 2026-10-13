// `herdr-superwork automations …`: the commands. List them, add one (a name, a prompt, one trigger, a repo, any work
// setting; --research is short for --research.only true), show one, change its name, prompt or trigger, turn it on or off, run it now, read its
// firings, remove it. Its own settings are changed by the settings' own commands with --automation <name>
// (`set`, `unset`, `show`: settingsFor below). Every command accepts --json: each returns [value, text].
import { when } from "../board/view/words.js";
import * as S from "../store.js";
import * as L from "./list.js";
import { triggerOf } from "./triggers.js";
import { fire } from "./fire.js";
import { describe, listLine, firingLine, firings } from "./show.js";

const HOW = `automations takes:
  automations                                   the list
  automations add "<name>" --prompt "<what its task is to do>" (--schedule "<when>" | --when <event> [--every-repo])
                  [--repo NAME|PATH] [--<setting> VALUE ...] [--research|--no-research]
      --schedule   every 2h · daily 09:00 · mon 09:00 · mon,thu 09:00 · cron "0 9 * * 1"   (this machine's time zone)
      --when       added · approval · review-failed · failed · needs-you · merged   (a task of its repo; --every-repo: of any)
  automations show <name>                       all of it: prompt, trigger, settings, last firings
  automations change <name> [--name NEW] [--prompt TEXT] [--schedule … | --when …] [--research | --no-research]
  automations on|off <name>                     off, it never fires and keeps everything
  automations run <name>                        fire it now
  automations firings <name>                    every firing: when, what fired it, the task it made or why it was skipped
  automations remove <name>
  set <setting> <value> --automation <name> · unset <setting> --automation <name> · show --automation <name>`;
// Its work settings from a command's options: every --<name with a dot>.
const settingsOf = (flags) => Object.fromEntries(Object.entries(flags).filter(([k]) => k.includes(".")));
const showText = (a, now = Date.now()) => {
  const d = describe(a, now), own = Object.entries(a.settings || {}), last = firings(a).slice(0, 5);
  return [`${a.name}  (${d.on ? "on" : "off"}${a.offWhy ? `: ${a.offWhy}` : ""})`, `  trigger   ${d.trigger}${d.next ? `  (next: ${when(d.next)})` : ""}`, `  repo      ${a.repo}  ${S.tilde(a.root)}`,
    ...(L.researchOnly(a) ? ["  research  only: its tasks change nothing in the repo"] : []),
    `  settings  ${own.length ? own.map(([k, v]) => `${k} ${S.say(v)}`).join(" · ") : "none of its own: its tasks run on what any task would"}`,
    "  prompt", ...String(a.prompt).split("\n").map((l) => `    ${l}`), "  firings", ...(last.length ? last.map((f) => `    ${firingLine(f, now)}`) : ["    none yet"])].join("\n");
};

export function automationsCommand(pos, flags, here) {
  const cmd = pos[0] || "list", name = pos.slice(1).join(" ");
  const need = () => { if (!name) throw new Error(`automations ${cmd} needs the automation's name. \`herdr-superwork automations\` lists them.`); return name; };
  switch (cmd) {
    case "list": case "ls": { const all = S.automations(); return [all.map((a) => describe(a)), all.length ? all.map((a) => listLine(a)).join("\n") : "No automations. Make one: herdr-superwork automations add \"<name>\" --prompt \"<…>\" --schedule \"every 2h\""]; }
    case "add": case "new": {
      const a = L.add({ name: need(), prompt: flags.prompt === true ? "" : flags.prompt ?? flags.desc ?? "", trigger: triggerOf(flags), repo: flags.repo, folder: here, settings: settingsOf(flags), research: flags.research === undefined ? undefined : flags.research === true });
      return [describe(a), `Added the automation "${a.name}": ${L.sayTrigger(a.trigger)}, in ${a.repo}. Each firing adds a task and puts an agent on it.`];
    }
    case "show": { const a = L.find(need()); return [{ ...describe(a), firings: firings(a) }, showText(a)]; }
    case "change": case "edit": {
      const a = L.change(need(), { name: flags.name === true ? "" : flags.name, prompt: flags.prompt === true ? "" : flags.prompt, trigger: triggerOf(flags) || undefined, research: flags.research === undefined ? undefined : flags.research === true });
      return [describe(a), `Changed "${a.name}": ${L.sayTrigger(a.trigger)}. It applies from its next firing; tasks already made keep what they had.`];
    }
    case "on": case "off": { const a = L.turn(need(), cmd === "on"); return [describe(a), `"${a.name}" is ${cmd}.${cmd === "off" ? " It never fires while it is off, and keeps everything." : ""}`]; }
    case "run": case "fire": {
      const a = L.find(need()), f = fire(a, { kind: "run" });
      if (f.unwritten) throw new Error(`"${a.name}" is off, and off it never fires. Turn it on first: herdr-superwork automations on ${a.name}`);
      return [f, f.task ? `"${a.name}" fired: ${f.task} was added${f.note ? `, ${f.note}` : " and an agent is on it"}.` : `"${a.name}" did not fire: ${f.skipped}.`];
    }
    case "firings": case "log": { const a = L.find(need()), all = firings(a); return [all, all.length ? all.map((f) => firingLine(f)).join("\n") : `"${a.name}" has not fired yet.`]; }
    case "remove": case "rm": case "delete": { const a = L.remove(need()); return [{ removed: a.name, id: a.id }, `Removed the automation "${a.name}". The tasks it made stay.`]; }
    case "help": return [{ help: HOW }, HOW];
    default: throw new Error(`Unknown: automations ${cmd}.\n${HOW}`);
  }
}

// set / unset / show with --automation <name>: the same three commands a task has, for an automation's own settings.
export function settingsFor(cmd, pos, flags, rest) {
  const a = L.find(flags.automation === true ? "" : flags.automation);
  if (cmd === "show") {
    const rows = L.settingRows(a), wide = Math.max(...rows.map((r) => r.name.length)), val = Math.max(...rows.map((r) => S.say(r.value).split("\n")[0].length).filter((n) => n <= 40));
    return [{ settings: rows }, [`"${a.name}": every setting its next task will have, and the place it comes from (* = this automation's own)`, ...rows.map((r) => `${r.own ? "*" : " "} ${r.name.padEnd(wide)}  ${S.say(r.value).replace(/\s*\n\s*/g, " / ").padEnd(val)}  ${r.note || r.from}`)].join("\n")];
  }
  if (!pos[1]) throw new Error(`${cmd} needs a setting's name. \`herdr-superwork show --automation ${a.name}\` lists them all.`);
  if (cmd === "set" && pos.length < 3) throw new Error(`set needs a value: herdr-superwork set ${pos[1]} <value> --automation ${a.name}`);
  const r = cmd === "set" ? L.setSetting(a.id, pos[1], rest(2)) : L.unsetSetting(a.id, pos[1]);
  return [{ name: r.name, value: r.value, from: r.from }, `${r.name} for "${a.name}": ${S.say(r.value)}  (${r.from})${r.note ? `\n${r.note}` : ""}\nIt applies from its next firing.`];
}
