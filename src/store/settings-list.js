// The settings, each one defined once: its name, its default, whether one task can have its own, and what it means.
// The defaults (settings.js) and the table in docs/settings.md are made from this list. A new setting is one entry
// here, beside the ones of its area, then `node scripts/docs.js`.
//
// An entry:
//   key       its name in config.json and on the command line
//   default   what it is until you say otherwise
//   shown     the default as the page says it, when the value itself says too little
//   task      true: one task can have its own (`--id <id>`, or an option to `delegate`)
//   taskOnly  true: it exists per task only
//   doc       what it means, for docs/settings.md. A key of the board is named as {id} (src/board/keys.js)
import { DEFAULT_GATE } from "../gate.js";

export const SETTINGS = [
  // who works
  { key: "agent", default: "claude", task: true, doc: "the working agent: any `herdr agent start --kind` value" },
  { key: "model", default: "", shown: "the agent's own", task: true, doc: "the working agent's model" },
  { key: "effort", default: "", shown: "the agent's own", task: true, doc: "the working agent's effort level" },
  { key: "fast", default: false, task: true, doc: "the working agent in its program's fast mode: a faster service tier that uses more of your allowance. Only Codex has one (`-c service_tier=\"fast\"`, sent as the `priority` tier); for any other kind the setting does nothing, and `config` and the task panel say so. The setting is the one switch for a task's agent and reviewer: off starts Codex with `-c service_tier=\"default\"` last, which wins over a tier in your own `agentArgs`, in `~/.codex/config.toml` or in a profile, so off is always normal speed" },
  // who reviews
  { key: "reviewer", default: "codex", task: true, doc: "the reviewer's agent kind; `off` for none. Not installed here: the agent's own kind reviews, on its default model, and the task says so" },
  { key: "reviewerModel", default: "", shown: "the reviewer's own", task: true, doc: "the reviewer's model" },
  { key: "reviewerEffort", default: "", shown: "the reviewer's own", task: true, doc: "the reviewer's effort level" },
  { key: "reviewerFast", default: true, task: true, doc: "the reviewer in its program's fast mode: a Codex reviewer runs in fast mode unless you turn this off. Does nothing for a reviewer of another kind. Expect a small gain: writing is about a fifth faster, but a review mostly runs commands and reads code (measured: 212 s against 226 s for the same commit)" },
  // the Coordinator
  { key: "coordinator", default: "claude", doc: "the Coordinator, the agent you talk to in the chat: its own choice, as the agent's is; `off` for none. For one use: `coordinator new --agent … --model … --effort …`" },
  { key: "coordinatorModel", default: "", shown: "the Coordinator's own", doc: "the Coordinator's model" },
  { key: "coordinatorEffort", default: "", shown: "the Coordinator's own", doc: "the Coordinator's effort level" },
  // the Watcher
  { key: "watcherAgent", default: "claude", doc: "the Watcher: a small model behind the \"doing now\" line; any kind with a one-shot entry in `src/agents/kinds.js` (`helper` is still read as this)" },
  { key: "watcherModel", default: "claude-haiku-5-5", doc: "the Watcher's model (`helperModel` is still read as this)" },
  { key: "watcher", default: "on", task: true, doc: "the \"doing now\" line, the progress guess and the minutes left worked out from it, board open or closed. `off`: none of the three" },
  { key: "watcherEvery", default: 60, doc: "seconds between two looks of the Watcher at one working agent, at the least. One hidden model call covers every agent whose look is due (an agent may wait up to half as long again for another to share the call), one call runs at a time on the machine, a screen that has not changed costs none, and a busy machine is looked at up to five times less often. The minutes left keep counting between looks. More: [the Watcher](watcher.md)" },
  // the review
  { key: "review", default: "repos", task: true, doc: "what gets reviewed when finished: `repos`, `all` or `none`" },
  { key: "gate", default: DEFAULT_GATE, task: true, doc: "what a review must clear: `critical`, `major`, `minor`, `trivial` or `off`. A finding that bad or worse sends the work back by itself, at most `rounds` times, and holds a merge; `off` sends nothing back by itself. (`gate` replaces `reviewAuto`: a config that still has `reviewAuto: true` behaves as `gate: major`, `false` as `gate: off`)" },
  { key: "rounds", default: 3, task: true, doc: "how many times agent and reviewer may go back and forth by themselves. Also caps conflict repairs" },
  { key: "artifacts", default: true, task: true, doc: "the reviewer brings evidence: screenshots, a recording, a link, test output" },
  { key: "serve", default: "tailscale", task: true, doc: "how evidence pages are linked: `tailscale`, privately on your tailnet, or `local` for 127.0.0.1 (also used, and said on the task, when Tailscale is not installed)" },
  { key: "remerge", default: "tests", doc: "work that passed its review and then only took main in (conflict resolutions included): `tests` runs the check again and lets the review stand; `review` always reviews again. A task that merges by itself (`autoMerge`) is reviewed again where its agent had to resolve a conflict: there only the board's own clean merge of main lets the review stand" },
  // where the work happens and how it lands
  { key: "worktree", default: "auto", doc: "`none`: agents work in your checkout" },
  { key: "base", default: "fresh", doc: "`head`: worktrees start from your current commit" },
  { key: "pr", default: true, doc: "push the branch and open a draft pull request after the check passes" },
  { key: "merge", default: "squash", doc: "how approved work lands: `squash`, `merge` or `rebase`" },
  { key: "autoMerge", default: false, shown: "the repo's `land`, else `false`", task: true, doc: "`true`: a task merges by itself the moment it may: its review passed the gate, its checks pass, nothing conflicts. Main moving under it does not stop that: it catches up, is checked again and merges, one task at a time. `false`: it waits for your yes. Changing it counts from that moment, for tasks under way too. Never chosen by you: a repo whose `.herdr-superwork.json` says `\"land\": \"auto\"` merges by itself, every other repo asks. More: [the gate](gate.md#merging-by-itself)" },
  { key: "cleanup", default: true, doc: "remove a done task's space, worktree and branch" },
  // other machines
  { key: "machines", default: "auto", doc: "other machines: `auto` (herdr's saved machines), names (`exedev@vm-a, vm-b`) or `off`" },
  { key: "remoteUser", default: "", shown: "yours", doc: "the user to reach other machines as" },
  // starting agents
  { key: "max", default: 4, doc: "agents working at once" },
  { key: "skill", default: true, doc: "write a small how-to into each installed agent program's own skills folder, so any chat knows the board" },
  { key: "trust", default: true, doc: "mark a new task's repo as trusted in the agent's own settings, so no dialog blocks the start" },
  { key: "agentArgs", default: {}, shown: "full access", doc: "per agent kind: extra arguments after `--` for `herdr agent start`; replaces the built-in default" },
  // the board itself
  { key: "theme", default: "auto", doc: "the board and the review page use herdr's own colours and status marks. herdr's sidebar is drawn by the client with the config of the device it runs on, and herdr does not pass that on to the board. `auto`: when herdr's `config.toml` on this machine sets a theme (`[theme]`, with its custom colours), the board follows it as herdr resolves it; when it sets none, the board paints with the terminal's own colours, as herdr's `terminal` theme does, which fits whatever device you look from. `herdr` follows this machine's config exactly, Catppuccin by default: choose it if you run an unconfigured herdr on this very machine and want the board to match it; `terminal` always uses the terminal's colours; `dark` or `light` picks herdr's dark or light theme by hand. `ui.status_indicators` is always followed. A task whose reviewer is working is blue: the theme's `blue`, or a blue of the board's own where the theme's is too near another of its colours" },
  { key: "ownTerminal", default: true, doc: "the board always has the size of the herdr pane it runs in: another viewer attached straight to its terminal (`herdr terminal attach`, herdr's remote web UI) holds the terminal at its own size, so the board disconnects it. `false`: it stays, the board draws inside what both can see, says so, and disconnects nobody: turn the setting on again, or close that view, to get the size back" },
  // per task only
  { key: "conflictAuto", default: true, taskOnly: true, doc: "a conflict with main goes back to the task's agent by itself" },
];

const of = (pick) => SETTINGS.filter(pick);
export const DEFAULTS = Object.fromEntries(of((s) => !s.taskOnly).map((s) => [s.key, s.default]));
export const TASK_DEFAULTS = Object.fromEntries(of((s) => s.taskOnly).map((s) => [s.key, s.default]));
// Who does the work and how the review loop runs can also be chosen for one task. That wins over your default.
export const PER_TASK = of((s) => s.task || s.taskOnly).map((s) => s.key);
