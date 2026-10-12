# Settings: two places

Facts about a repo live in `.herdr-superwork.json`, committed in that repo and read from the commit a worktree
started from, so an agent's branch cannot change the rules it is checked by:

```json
{ "setup": "npm ci", "check": "npm test", "land": "ask", "teardown": "docker compose down", "include": [".env"] }
```

Your own preferences live in `~/.config/herdr-superwork/config.json`; change them with
`herdr-superwork config <key> <value>` or by saying so in the text box.

| Setting | Default | Means |
|---|---|---|
| `agent`, `model`, `effort` | `claude` | the working agent: any `herdr agent start --kind` value |
| `reviewer`, `reviewerModel`, `reviewerEffort` | `codex` | the reviewer; `off` for none. Not installed here: the agent's own kind reviews, on its default model, and the task says so |
| `coordinator`, `coordinatorModel`, `coordinatorEffort` | `claude`, its defaults | the Coordinator, the agent you talk to in the chat; `off` for none. For one use: `coordinator new --agent … --model … --effort …` |
| `watcherAgent`, `watcherModel` | `claude`, `claude-haiku-5-5` | the Watcher's small model (`helper`, `helperModel` are still read as these) |
| `watcher` | `on` | the "doing now" line, the progress guess and the minutes left worked out from it, a look about every 15 seconds per working agent, board open or closed |
| `skill` | `true` | keep the how-to in each agent program's skills folder |
| `ownTerminal` | `true` | the board always has the size of the herdr pane it runs in: another viewer attached straight to its terminal (`herdr terminal attach`, herdr's remote web UI) holds the terminal at its own size, so the board disconnects it. `false`: it stays, the board draws inside what both can see, says so, and alt+w disconnects it |
| `theme` | `auto` | the board and the review page use herdr's own colours and status marks. herdr's sidebar is drawn by the client with the config of the device it runs on, and herdr does not pass that on to the board. `auto`: when herdr's `config.toml` on this machine sets a theme (`[theme]`, with its custom colours), the board follows it as herdr resolves it; when it sets none, the board paints with the terminal's own colours, as herdr's `terminal` theme does, which fits whatever device you look from. `herdr` follows this machine's config exactly, Catppuccin by default: choose it if you run an unconfigured herdr on this very machine and want the board to match it; `terminal` always uses the terminal's colours; `dark` or `light` picks herdr's dark or light theme by hand. `ui.status_indicators` is always followed. A task under review takes the theme's `green`, the colour of what is ready to approve; a running review has no colour of its own |
| `review` | `repos` | what gets reviewed: `repos`, `all` or `none` |
| `artifacts`, `serve` | `true`, `tailscale` | evidence pages, linked privately on your tailnet (`local` for 127.0.0.1; also used, and said on the task, when Tailscale is not installed) |
| `gate`, `rounds` | `major`, `3` | what a review must clear: `critical`, `major`, `minor`, `trivial` or `off`. A finding that bad or worse sends the work back by itself, at most `rounds` times, and holds a merge; `off` sends nothing back by itself. `rounds` also caps conflict repairs. (`gate` replaces `reviewAuto`: a config that still has `reviewAuto: true` behaves as `gate: major`, `false` as `gate: off`) |
| `remerge` | `tests` | work that passed its review and then only took main in (conflict resolutions included): `tests` runs the check again and lets the review stand; `review` always reviews again |
| `worktree`, `base` | `auto`, `fresh` | `none`: work in your checkout; `head`: start from your commit |
| `pr`, `merge`, `cleanup` | `true`, `squash`, `true` | pull requests, how work lands, remove a done task's space, worktree and branch |
| `max` | `4` | agents working at once |
| `trust` | `true` | pre-trust a task's repo in the agent's own settings |
| `agentArgs` | full access | per agent kind: arguments after `--` for `herdr agent start` |
| `machines`, `remoteUser` | `auto` | other machines: herdr's saved machines, names, or `off` |

Per task (`--id <id>`, or options to `delegate`): `agent`, `model`, `effort`, `reviewer`, `reviewerModel`,
`reviewerEffort`, `watcher`, `review`, `gate`, `rounds`, `artifacts`, `serve`, `conflictAuto` (on by default).

Data lives in `~/.local/state/herdr-superwork` (`HERDR_SUPERWORK_DATA_DIR` overrides it): one folder per task with
`task.json`, `inbox.jsonl` and `artifacts/`.
