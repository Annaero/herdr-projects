# Settings: one lookup

Every choice about how work happens is a setting, and every setting is looked up by one rule. A setting is either a
**work** setting (who works, where, how it is checked, how it lands) or a **board** setting (the board itself, the
Coordinator, the Watcher).

## The rule

1. A work setting is looked up in one order, and the nearest answer wins:
   **this task → your entry for this repo → you → the repo's own file → built in.**
   One function does this for every setting (`src/store/settings/lookup.js`); no setting has a lookup of its own.
2. A board setting is yours only: everything under `board.`, `coordinator.` and `watcher.`. Setting one on a task or
   for a repo is refused, and the answer says how to set it for yourself.
3. A setting is read when its step starts, and a step under way is never changed: the agent's settings at its next
   start, the review's at the next review, the merge's right before the merge.
4. A task in no repo skips the two repo places; `workspace.*`, `check.*` and `merge.*` do not apply to it, and `show`
   says so.

## The places

- **You**: `~/.herdr-superwork/settings/config.json` ([the home folder](home-folder.md)).
- **Your entry for a repo**: the `repos` section of that same file, keyed by the repo's name on the board.
- **This task**: saved on the task, only the settings that differ.
- **The repo's own file**: `.herdr-superwork.json`, committed in that repo. It may hold five facts only:
  `workspace.setup`, `workspace.include`, `workspace.teardown`, `check.command` and `check.timeout`. Anything else in
  it is refused and said on the task (a `Note` in the task panel, and `show <id>`). It is read from the commit the
  worktree started from, so code written by agents can never loosen a guard: it cannot switch on merging by itself,
  drop the review, or change the rules its own branch is checked by.

```json
{
  "review": { "rounds": 5, "mustFix": "critical" },
  "merge": { "by": "itself" },
  "board": { "agents": 10 },
  "repos": { "my-app": { "worker": { "agent": "codex/gpt-5.5" }, "merge": { "by": "you" } } }
}
```

```json
{ "workspace": { "setup": "npm ci", "include": [".env"], "teardown": "docker compose down" },
  "check": { "command": "npm test", "timeout": "20m" } }
```

A mistake in a file edited by hand is reported with the setting's name (`show`, and the task panel's `Note`); for
that one setting the next place down is used, and the board keeps running.

## Values

- A **switch** is `true` or `false`, in the file as real booleans. Typed, `yes`, `no`, `on` and `off` work too.
  Anything else is refused.
- A **choice** is one word from a list. "Off" is always the word `none`.
- A **time** carries a unit: `60s`, `15m`, `2h`.
- An **agent** is `claude`, `codex` or `pi`, with an optional model after a slash (`codex/gpt-5.5`). The model
  travels with the program, so a Claude model is never paired with Codex.
- `none` is a real answer, distinct from unset: a task can cancel its repo's setup with
  `set workspace.setup none --task <id>`.
- Instructions (`worker.instructions`, `reviewer.instructions`) add up across the places, broadest first, and the
  agent is told that later ones win; `none` in a place drops what the broader places said. Every other setting,
  lists included, is replaced by the nearest answer. Your words come after the board's own rules, which stay fixed:
  no pushing, the closing note, the shape of the reviewer's verdict.
- An unknown name or a wrong value is refused, with the nearest right one as a hint.

## Commands

```
herdr-superwork set <name> <value>                you
herdr-superwork set <name> <value> --repo <name>  your entry for that repo
herdr-superwork set <name> <value> --task <id>    one task
herdr-superwork unset <name>  [--repo … | --task …]   back to what it would be
herdr-superwork show                              your settings, the changed ones marked
herdr-superwork show <id>                         every value of one task, and the place it came from
herdr-superwork delegate <id> --reviewer.agent claude --merge.by itself
```

`delegate` takes any work setting for that task. A refused option changes nothing on the task.

In the board, `Ctrl+E` opens the selected task's settings: move to a row, `Enter` changes it, `*` marks the rows
that are this task's own and every other row names the place its value comes from, and `Ctrl+U` puts a row back
([the task panel](task-panel.md)).

## The list

<!-- made:settings Made by `node scripts/docs.js` from src/store/settings-list.js. Do not edit between these two lines. -->
| Setting | Built in | Can be said by | Means |
|---|---|---|---|
| `worker.agent` | `claude` | task, repo entry, you | the working agent's program: `claude`, `codex` or `pi`, with an optional model after a slash (`codex/gpt-5.5`). The model travels with the program, so one program's model is never handed to another |
| `worker.effort` | `default` | task, repo entry, you | the working agent's effort level: one its program accepts (checked against `worker.agent`), or `default` for the program's own |
| `worker.fast` | `false` | task, repo entry, you | the working agent in its program's fast mode: a faster service tier that uses more of your allowance. Only Codex has one; for another program it does nothing, and `show` says so |
| `worker.access` | `full` | task, repo entry, you | what the working agent may do without asking: `full` or `ask`. The board turns it into each program's own flags. `ask` is refused for a program that cannot ask (pi) |
| `worker.instructions` | `none` | task, repo entry, you | your own words for the working agent, added after the board's own fixed rules. They add up across the places, broadest first, and the agent is told that later ones win |
| `reviewer.agent` | `codex` | task, repo entry, you | the reviewer's program: `claude`, `codex` or `pi`, with an optional model after a slash (`codex/gpt-5.5`). The model travels with the program, so one program's model is never handed to another. Not installed here: the worker's program reviews, on its own model, and the task says so |
| `reviewer.effort` | `default` | task, repo entry, you | the reviewer's effort level: one its program accepts (checked against `reviewer.agent`), or `default` for the program's own |
| `reviewer.fast` | `true` | task, repo entry, you | the reviewer in its program's fast mode: a faster service tier that uses more of your allowance. Only Codex has one; for another program it does nothing, and `show` says so |
| `reviewer.access` | `full` | task, repo entry, you | what the reviewer may do without asking: `full` or `ask`. The board turns it into each program's own flags. `ask` is refused for a program that cannot ask (pi) |
| `reviewer.instructions` | `none` | task, repo entry, you | your own words for the reviewer, added after the board's own fixed rules. They add up across the places, broadest first, and the agent is told that later ones win |
| `coordinator.agent` | `claude` | you only | the Coordinator, the agent you talk to in the chat's program: `claude`, `codex` or `pi`, with an optional model after a slash (`codex/gpt-5.5`). The model travels with the program, so one program's model is never handed to another. `none`: no Coordinator |
| `coordinator.effort` | `default` | you only | the Coordinator, the agent you talk to in the chat's effort level: one its program accepts (checked against `coordinator.agent`), or `default` for the program's own |
| `coordinator.fast` | `false` | you only | the Coordinator, the agent you talk to in the chat in its program's fast mode: a faster service tier that uses more of your allowance. Only Codex has one; for another program it does nothing, and `show` says so |
| `coordinator.access` | `full` | you only | what the Coordinator, the agent you talk to in the chat may do without asking: `full` or `ask`. The board turns it into each program's own flags. `ask` is refused for a program that cannot ask (pi) |
| `coordinator.instructions` | `none` | you only | your own words for the Coordinator, the agent you talk to in the chat, added after the board's own fixed rules |
| `watcher.agent` | `claude/claude-haiku-5-5` | you only | the Watcher: a small model behind the "doing now" line, the progress guess and the minutes left. `none`: none of the three. More: [the Watcher](watcher.md) |
| `watcher.every` | `60s` | you only | the least time between two looks of the Watcher at one working agent. One hidden model call covers every agent whose look is due, one call runs at a time on the machine, a screen that has not changed costs none, and a busy machine is looked at up to five times less often |
| `workspace.from` | `main` | task, repo entry, you | where a worktree starts: `main` (the remote's main branch, fetched first) or `here` (the commit your checkout is on) |
| `workspace.setup` | `none` | task, repo entry, you, repo file | a command run in the fresh worktree before the agent starts |
| `workspace.include` | `none` | task, repo entry, you, repo file | ignored files a fresh worktree lacks and gets a copy of (`.env`); `.worktreeinclude` in the repo names more |
| `workspace.teardown` | `none` | task, repo entry, you, repo file | a command run in the worktree before it is removed |
| `workspace.cleanup` | `true` | task, repo entry, you | remove a done task's space, worktree and branch |
| `check.command` | `none` | task, repo entry, you, repo file | the test command: the work only counts as done when it passes |
| `check.timeout` | `15m` | task, repo entry, you, repo file | how long the check may run before it is stopped and counts as failed |
| `review.when` | `repos` | task, repo entry, you | what gets a review when finished: `repos` (work in a repo), `always` (work outside one too) or `never` |
| `review.mustFix` | `major` | task, repo entry, you | a finding that bad or worse fails the review. More: [the gate](gate.md) |
| `review.rounds` | `3` | task, repo entry, you | how many times work goes back to the agent by itself, for any one reason: findings, a failed check, a conflict with main, pull request feedback. `0`: nothing goes back by itself, and a failed review waits for you |
| `review.evidence` | `true` | task, repo entry, you | the reviewer brings evidence: screenshots, a recording, a link, test output |
| `merge.by` | `you` | task, repo entry, you | `you`: finished work waits for your yes. `itself`: it merges the moment it may: its review passed, its checks pass, nothing conflicts. Read right before the merge, so a change counts for tasks under way. More: [the gate](gate.md#merging-by-itself) |
| `merge.method` | `squash` | task, repo entry, you | how approved work lands |
| `merge.pr` | `true` | task, repo entry, you | push the branch and open a draft pull request after the check passes |
| `board.agents` | `4` | you only | how many agents work at once |
| `board.machines` | `auto` | you only | other machines: `auto` (herdr's saved machines), names (`exedev@vm-a, vm-b`) or `none` |
| `board.notify` | `none` | you only | when a task needs you, is ready to approve, or failed: `bell` rings the terminal bell, a command is run with `HERDR_SUPERWORK_ID`, `HERDR_SUPERWORK_TITLE` and `HERDR_SUPERWORK_EVENT` (`needs you`, `ready to approve` or `failed`) in its environment, `none` does neither |
| `board.webUi` | `auto` | you only | the board inside the herdr web UI. `auto`: when the web UI plugin (`devswha.herdr-web-ui`) is installed, a small front door of the board's own runs in front of it and adds a Board entry to its menu; without that plugin nothing runs. `none`: never. More: [the board in the web UI](web-ui.md) |
| `board.theme` | `auto` | you only | the board's colours. `auto`: herdr's theme when this machine's `config.toml` sets one, else the terminal's own colours; `herdr` follows this machine's config exactly; `terminal` always uses the terminal's colours; `dark` or `light` picks herdr's dark or light theme by hand |
<!-- /made:settings -->

## Other machines

A task's work settings travel with it: the machine you are on works out what you say for it (you, and your entry
for its repo) and sends that along with whatever starts its agent. Board settings stay with each machine
([other machines](other-machines.md)).

## What is fixed

These are not settings: a task in a repo always works in a git worktree of its own, never in your checkout; the
board always keeps the size of its own pane; evidence links are shared privately on your tailnet when Tailscale is
installed and on 127.0.0.1 when it is not; the how-to for agents and the trust mark for a task's repo are written;
a conflict with main goes back to the task's agent by itself (within `review.rounds`); a passed review still stands
after a clean catch-up with main when the check passes; only your own comments on a pull request (the logged-in
GitHub user's) wake its agent. A task being research only is a property of the task
([research-only tasks](research.md)), not a setting.

## Coming from the old names

The first run of this version converts your `config.json` and every task's own settings by itself, once, and keeps
the old file beside the new one as `config.old.json`. A task under way keeps the choices it had.

Data lives in `~/.herdr-superwork/data` (`HERDR_SUPERWORK_DATA_DIR` overrides it): one folder per task with
`task.json`, `inbox.jsonl` and `artifacts/`. Everything the board keeps: [the home folder](home-folder.md).
