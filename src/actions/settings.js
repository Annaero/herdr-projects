// The settings' commands: set, unset and show, for you, for your entry for a repo, or for one task.
import * as S from "../store.js";
import { settingsFor } from "../automations/command.js";

// Returns what the command line prints: [value for --json, text].
export function settingsCommand(cmd, pos, flags, rest) {
  if ([flags.task, flags.repo, flags.automation].filter((x) => x !== undefined).length > 1) throw new Error(`${cmd} takes one of --task, --repo and --automation, not several.`);
  if (flags.automation !== undefined) return settingsFor(cmd, pos, flags, rest); // an automation's own settings (automations/command.js)
  const id = cmd === "show" ? flags.task || pos[1] : flags.task;
  const scope = id ? { task: S.find(id) } : flags.repo ? { repo: String(flags.repo) } : {};
  const where = scope.task ? ` for ${scope.task.id}` : scope.repo ? ` for ${scope.repo}` : "";
  if (cmd === "show") {
    if (scope.repo && !S.knownRepos()[scope.repo]) throw new Error(`No repo "${scope.repo}" on the board. Known: ${Object.keys(S.knownRepos()).join(", ") || "none yet"}.`);
    return [{ settings: S.settingRows(scope), problems: S.settingProblems(scope.task) }, S.showText(scope)];
  }
  if (!pos[1]) throw new Error(`${cmd} needs a setting's name. \`herdr-superwork show\` lists them all.`);
  if (cmd === "set" && pos.length < 3) throw new Error(`set needs a value: herdr-superwork set ${pos[1]} <value>. To take your answer away: herdr-superwork unset ${pos[1]}`);
  const r = cmd === "set" ? S.setValue(pos[1], rest(2), scope) : S.unsetValue(pos[1], scope);
  const row = S.settingRows(scope.task ? { task: S.get(scope.task.id) } : scope).find((x) => x.name === r.name);
  const note = row?.note || (row?.later ? `It ${row.later}.` : ""); // research.only on a task that is under way
  const text = `${r.name}${where}: ${S.say(r.value)}  (${r.from})${note ? `\n${note}` : ""}`;
  return [{ name: r.name, value: r.value, from: r.from, ...(note ? { note } : {}) }, text];
}
