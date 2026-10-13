# Settings: two places

Facts about a repo live in `.herdr-superwork.json`, committed in that repo and read from the commit a worktree
started from, so an agent's branch cannot change the rules it is checked by:

```json
{ "setup": "npm ci", "check": "npm test", "land": "ask", "teardown": "docker compose down", "include": [".env"] }
```

`land` (`"ask"` or `"auto"`) is only that repo's default for the `autoMerge` setting below: it counts where you have
chosen nothing yourself, for the task or as a whole ([merging by itself](gate.md#merging-by-itself)).

Your own preferences live in `~/.herdr-superwork/settings/config.json` ([the home folder](home-folder.md)); change them with
`herdr-superwork config <key> <value>` or by saying so in the text box.

<!-- made:settings Made by `node scripts/docs.js` from src/store/settings-list.js. Do not edit between these two lines. -->
| Setting | Default | Per task | Means |
|---|---|---|---|
| `agent` | `claude` | yes | the working agent: any `herdr agent start --kind` value |
| `model` | the agent's own | yes | the working agent's model |
| `effort` | the agent's own | yes | the working agent's effort level |
| `fast` | `false` | yes | the working agent in its program's fast mode: a faster service tier that uses more of your allowance. Only Codex has one (`-c service_tier="fast"`, sent as the `priority` tier); for any other kind the setting does nothing, and `config` and the task panel say so. The setting is the one switch for a task's agent and reviewer: off starts Codex with `-c service_tier="default"` last, which wins over a tier in your own `agentArgs`, in `~/.codex/config.toml` or in a profile, so off is always normal speed |
| `reviewer` | `codex` | yes | the reviewer's agent kind; `off` for none. Not installed here: the agent's own kind reviews, on its default model, and the task says so |
| `reviewerModel` | the reviewer's own | yes | the reviewer's model |
| `reviewerEffort` | the reviewer's own | yes | the reviewer's effort level |
| `reviewerFast` | `true` | yes | the reviewer in its program's fast mode: a Codex reviewer runs in fast mode unless you turn this off. Does nothing for a reviewer of another kind. Expect a small gain: writing is about a fifth faster, but a review mostly runs commands and reads code (measured: 212 s against 226 s for the same commit) |
| `coordinator` | `claude` |  | the Coordinator, the agent you talk to in the chat: its own choice, as the agent's is; `off` for none. For one use: `coordinator new --agent … --model … --effort …` |
| `coordinatorModel` | the Coordinator's own |  | the Coordinator's model |
| `coordinatorEffort` | the Coordinator's own |  | the Coordinator's effort level |
| `watcherAgent` | `claude` |  | the Watcher: a small model behind the "doing now" line; any kind with a one-shot entry in `src/agents/kinds.js` (`helper` is still read as this) |
| `watcherModel` | `claude-haiku-5-5` |  | the Watcher's model (`helperModel` is still read as this) |
| `watcher` | `on` | yes | the "doing now" line, the progress guess and the minutes left worked out from it, board open or closed. `off`: none of the three |
| `watcherEvery` | `60` |  | seconds between two looks of the Watcher at one working agent, at the least. One hidden model call covers every agent whose look is due (an agent may wait up to half as long again for another to share the call), one call runs at a time on the machine, a screen that has not changed costs none, and a busy machine is looked at up to five times less often. The minutes left keep counting between looks. More: [the Watcher](watcher.md) |
| `review` | `repos` | yes | what gets reviewed when finished: `repos`, `all` or `none` |
| `gate` | `major` | yes | what a review must clear: `critical`, `major`, `minor`, `trivial` or `off`. A finding that bad or worse sends the work back by itself, at most `rounds` times, and holds a merge; `off` sends nothing back by itself. (`gate` replaces `reviewAuto`: a config that still has `reviewAuto: true` behaves as `gate: major`, `false` as `gate: off`) |
| `rounds` | `3` | yes | how many times agent and reviewer may go back and forth by themselves. Also caps conflict repairs |
| `artifacts` | `true` | yes | the reviewer brings evidence: screenshots, a recording, a link, test output |
| `serve` | `tailscale` | yes | how evidence pages are linked: `tailscale`, privately on your tailnet, or `local` for 127.0.0.1 (also used, and said on the task, when Tailscale is not installed) |
| `remerge` | `tests` |  | work that passed its review and then only took main in (conflict resolutions included): `tests` runs the check again and lets the review stand; `review` always reviews again. A task that merges by itself (`autoMerge`) is reviewed again where its agent had to resolve a conflict: there only the board's own clean merge of main lets the review stand |
| `worktree` | `auto` |  | `none`: agents work in your checkout |
| `base` | `fresh` |  | `head`: worktrees start from your current commit |
| `pr` | `true` |  | push the branch and open a draft pull request after the check passes |
| `merge` | `squash` |  | how approved work lands: `squash`, `merge` or `rebase` |
| `autoMerge` | the repo's `land`, else `false` | yes | `true`: a task merges by itself the moment it may: its review passed the gate, its checks pass, nothing conflicts. Main moving under it does not stop that: it catches up, is checked again and merges, one task at a time. `false`: it waits for your yes. Changing it counts from that moment, for tasks under way too. Never chosen by you: a repo whose `.herdr-superwork.json` says `"land": "auto"` merges by itself, every other repo asks. More: [the gate](gate.md#merging-by-itself) |
| `cleanup` | `true` |  | remove a done task's space, worktree and branch |
| `machines` | `auto` |  | other machines: `auto` (herdr's saved machines), names (`exedev@vm-a, vm-b`) or `off` |
| `remoteUser` | yours |  | the user to reach other machines as |
| `max` | `4` |  | agents working at once |
| `skill` | `true` |  | write a small how-to into each installed agent program's own skills folder, so any chat knows the board |
| `trust` | `true` |  | mark a new task's repo as trusted in the agent's own settings, so no dialog blocks the start |
| `agentArgs` | full access |  | per agent kind: extra arguments after `--` for `herdr agent start`; replaces the built-in default |
| `theme` | `auto` |  | the board and the review page use herdr's own colours and status marks. herdr's sidebar is drawn by the client with the config of the device it runs on, and herdr does not pass that on to the board. `auto`: when herdr's `config.toml` on this machine sets a theme (`[theme]`, with its custom colours), the board follows it as herdr resolves it; when it sets none, the board paints with the terminal's own colours, as herdr's `terminal` theme does, which fits whatever device you look from. `herdr` follows this machine's config exactly, Catppuccin by default: choose it if you run an unconfigured herdr on this very machine and want the board to match it; `terminal` always uses the terminal's colours; `dark` or `light` picks herdr's dark or light theme by hand. `ui.status_indicators` is always followed. A task whose reviewer is working is blue: the theme's `blue`, or a blue of the board's own where the theme's is too near another of its colours |
| `ownTerminal` | `true` |  | the board always has the size of the herdr pane it runs in: another viewer attached straight to its terminal (`herdr terminal attach`, herdr's remote web UI) holds the terminal at its own size, so the board disconnects it. `false`: it stays, the board draws inside what both can see, says so, and disconnects nobody: turn the setting on again, or close that view, to get the size back |
| `webUi` | `auto` |  | the board inside the herdr web UI. `auto`: when the web UI plugin (`devswha.herdr-web-ui`) is installed, a small front door of the board's own runs in front of it and adds a Board entry to its menu; without that plugin nothing runs. `off`: never. More: [the board in the web UI](web-ui.md) |
| `conflictAuto` | `true` | only | a conflict with main goes back to the task's agent by itself |
| `research` | `false` | only | `true`: the task is research only. Its agent changes nothing in the repo and its result is a report with a private link; nothing is pushed, opened as a pull request or merged for it, and a change in its worktree or on its branch goes back to its agent. Also `add --research`. More: [research-only tasks](research.md) |
<!-- /made:settings -->

"Per task": one task can have its own, with `--id <id>` or as an option to `delegate`; "only" exists per task only.

Data lives in `~/.herdr-superwork/data` (`HERDR_SUPERWORK_DATA_DIR` overrides it): one folder per task with
`task.json`, `inbox.jsonl` and `artifacts/`. Everything the board keeps, and how an older version's folders are
moved there by themselves: [the home folder](home-folder.md).
