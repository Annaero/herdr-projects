# herdr-superwork

A work board for [herdr](https://herdr.dev): one list of tasks, yours and delegated ones. Every delegated task runs
as an ordinary herdr agent in its own herdr space. The board is an overview and a remote control; herdr is the engine.

It is pi-work's board, rebuilt for herdr: the same screen and keys, but agents are real herdr
agents, their status is mirrored from herdr, and going into a task takes you to that agent's own terminal.

Linux. Needs herdr 0.9.3 or newer, Node 22.19+, `git`, `flock` (util-linux), and optionally `gh` (pull requests) and
`tailscale` (private review links).

## Install

```sh
cd herdr-superwork
npm install
npm link                          # puts `herdr-superwork` on your PATH (agents use it too)
herdr plugin link "$PWD"          # hooks, the popup and the actions
```

To open the board with a key, add this to your own herdr `config.toml` (the plugin never edits it):

```toml
[[keys.command]]
key = "prefix+w"
type = "plugin_action"
command = "herdr-superwork.open"
```

Typing `herdr-superwork` in any pane works without it. Optionally bind `herdr-superwork.approve-current` too: it
approves the task that owns the focused pane, and does nothing anywhere else.

Your running herdr server must be 0.9.3 or newer: an older server refuses the plugin until it is restarted.

## Using it

Type what needs doing and press `Enter`: a hidden helper files it as a task. `Tab` puts an agent on the selected
task. Nothing is edited by hand: to change a title, a description or a state, say so in the box or run the command.

| Key | Does |
|---|---|
| `Enter` / `→` | go into the task's agent: its real herdr pane. The board closes; your key brings it back where you left it |
| `Space` | preview what is on the agent's screen, and reply without going in |
| `Tab` | delegate the selected task (with text typed: file it and delegate it) |
| `Ctrl+A` | approve: finished work is merged, its worktree and branch removed |
| `Ctrl+R` | send an error back to the agent, tell a stopped agent to continue, or send review findings (below 5/5) |
| `Ctrl+Y` | finish anyway, when the agent stopped without a summary |
| `Ctrl+G` | send failure details (a conflict, a failed check) to the task's own agent; never approves |
| `Ctrl+X` | stop the agent; twice on a non-working task deletes it (unsaved work is kept, and you are told where) |
| `Ctrl+E` / `Ctrl+B` | full details / hide or show the side panel |
| `Alt+A` / `Alt+H` / `Ctrl+Z` | archive or restore / the archive / undo the last archive |
| `Ctrl+T` `Ctrl+S` `Ctrl+F` `Ctrl+D` `Ctrl+O` | pin, group by repo, find, show all done, other machines |
| `?` | every key |

Any agent can drive the board from its shell: `add`, `list`, `report`, `describe`, `delegate`, `tell`, `stop`,
`approve`, `review`, `retry`, `fix`, `finish`, `details`, `pin`, `archive`, `restore`, `clear`, `config`.
`herdr-superwork --skill` prints instructions an agent can load; `herdr-superwork help` lists the commands.

## How work gets done

**Delegating.** In a git repo the plugin asks herdr for a worktree workspace (`herdr worktree create`), on its own
branch `work/<n>-<title>`, started from the remote's default branch (or your commit with `--base head`). The repo's
`setup` runs, then the agent starts in that workspace's root pane and gets the task and its rules. Outside git the
agent works in place in a plain herdr workspace. At most `max` (4) agents work at once; more wait their turn, and
tasks that wait for you hold no slot.

**Finished = herdr says the agent stopped, and it left a closing note.** The rules tell the agent to write its
summary (or its question) to `.herdr-superwork/closing-<n>.md` before it stops. When herdr reports the agent idle,
a hook reads that note and runs the finish line, with the board open or closed:

1. commit anything left over, run the repo's `check` (a failure goes straight back to the agent, three tries);
2. push the branch and open a draft pull request, when there is an `origin` remote and `gh`;
3. a second agent reviews it adversarially, in a visible split of the same herdr space, rates it 1 to 5 and brings
   evidence; whatever it changed is put back;
4. the task waits for your approval (`Ctrl+A`). herdr's own sidebar shows `review 4/5` on that pane.

A stop with no closing note (you interrupted it, a usage limit, a crash) commits nothing and is held as "stopped
without a summary": `Ctrl+R` tells the agent to continue, `Ctrl+Y` finishes anyway. A note ending in a question
blocks on you. Typing in the agent's own terminal, or replying from the board, re-arms all of this: an approval is
revoked, a pending auto-merge cancelled, the old review marked stale.

**Approving** brings the branch up to date with main in the task's own worktree, re-checks and re-reviews if that
changed anything, then merges through the pull request (remembered when GitHub's checks are still running) or
locally, squashed by default. Conflicts are rolled back and saved; `Ctrl+G` hands them to the task's agent, and
`conflictAuto` per task does so by itself. A checkout with unsaved files is never forced.

**Agents run with full access by default**, as pi-work's did: `claude --dangerously-skip-permissions`,
`codex --dangerously-bypass-approvals-and-sandbox --no-daemon`. They can run anything as you without asking; the
rules and the review brief are guidance, not a sandbox. Change it per agent kind with `agentArgs`. So that a new
task does not wait behind a "trust this folder?" dialog, the plugin marks the task's repo as trusted in the agent's
own settings (`~/.claude.json`, `~/.codex/config.toml`) before starting it; `config trust off` stops that.

## Settings: two places

Facts about a repo live in `.herdr-superwork.json`, committed in that repo and read from the commit a worktree
started from, so an agent's branch cannot change the rules it is checked by:

```json
{ "setup": "npm ci", "check": "npm test", "land": "ask", "teardown": "docker compose down", "include": [".env"] }
```

Your own preferences live in `~/.config/herdr-superwork/config.json`; change them with
`herdr-superwork config <key> <value>` or by saying so in the box.

| Setting | Default | Means |
|---|---|---|
| `agent`, `model`, `effort` | `claude` | the working agent: any `herdr agent start --kind` value |
| `reviewer`, `reviewerModel`, `reviewerEffort` | `codex` | the reviewer; `off` for none |
| `helper`, `helperModel` | `claude`, `claude-haiku-5-5` | the hidden helper behind the watcher line and the box |
| `watcher` | `on` | the "doing now" line and progress guess, about every 15 seconds while a board is open |
| `review` | `repos` | what gets reviewed: `repos`, `all` or `none` |
| `artifacts`, `serve` | `true`, `tailscale` | evidence pages, linked privately on your tailnet (`local` for 127.0.0.1) |
| `reviewAuto`, `rounds` | `false`, `3` | send reviews below 5/5 back by themselves, at most this often |
| `worktree`, `base` | `auto`, `fresh` | `none`: work in your checkout; `head`: start from your commit |
| `pr`, `merge`, `cleanup` | `true`, `squash`, `true` | pull requests, how work lands, remove merged worktrees |
| `max` | `4` | agents working at once |
| `trust` | `true` | pre-trust a task's repo in the agent's own settings |
| `agentArgs` | full access | per agent kind: arguments after `--` for `herdr agent start` |
| `machines`, `remoteUser` | `auto` | other machines: herdr's saved machines, names, or `off` |
| `bell` | `true` | ring when something becomes blocked or done |

Per task (`--id <id>`, or options to `delegate`): `agent`, `model`, `effort`, `reviewer`, `reviewerModel`,
`reviewerEffort`, `watcher`, `review`, `reviewAuto`, `rounds`, `artifacts`, `serve`, `conflictAuto`.

Data lives in `~/.local/state/herdr-superwork` (`HERDR_SUPERWORK_DATA_DIR` overrides it): one folder per task with
`task.json`, `inbox.jsonl` and `artifacts/`.

## Other machines

Every machine keeps its own tasks. `Ctrl+O` goes round: this machine, every machine, then each one by itself.
Machines are the ones you added with `herdr machine add` (or name them in `machines`). Each one needs, once:

```sh
# Node 22.19+, git, gh, flock, the agent programs it will run, then:
git clone <this repository> && cd herdr-superwork && npm install
npm link
herdr plugin link "$PWD"
```

Actions on another machine's task run on that machine, over SSH. Going into one of its agents attaches your
terminal to that one agent there (`herdr agent attach`); `ctrl+b q` returns to the board. Work never moves between
machines.

## What was checked on herdr 0.9.3

| Fact | Result |
|---|---|
| Plugin event hooks fire on `pane.agent_status_changed` | yes; the event carries pane id, workspace id, status, agent |
| Popup panes; `HERDR_PLUGIN_CONTEXT_JSON` in a popup | yes; no pane id, but workspace, focused pane and its folder, worktree's repo root |
| `agent focus` from inside a popup holds after it closes | yes |
| `agent start`; `state_change_seq`, `completion_seq` in `agent get` | yes; `completion_seq` appears after the first finished turn |
| `agent_session` in `agent get` | only with herdr's own integration for that agent installed; without it a restarted agent starts fresh |
| Workspace and pane ids across a server restart | survive; `terminal_id` does not; agents are gone without an integration |
| Which event fires when an agent exits to its shell | `pane.agent_detected` (released) and a status change to `unknown` |
| A process spawned detached from a hook | survives the hook's exit; a 150-second hook was not cut off |
| `PATH` in hook-spawned processes | herdr's server environment, which can lack `~/.local/bin`: the plugin asks a login shell |
| `worktree create --cwd <repo>` with no workspace open for it | works; herdr also opens the repo itself as a workspace |
| Claude and Codex in a brand-new worktree with full access | both show a trust dialog, once per repository; pre-trusting removes it |
| Codex after a reply | reported `done` here; the closing note also covers `unknown` |
| `herdr machine list --json` exposing SSH targets | not verifiable here (no saved machines); the `machines` setting names them |

## Reduced from pi-work

- Tokens and context fullness: blank; no agent exposes them through herdr today.
- A worker waiting on a login shows "needs you": herdr reports `blocked` without a kind. An agent that runs
  `herdr-superwork report … --kind auth` gets the right kind.
- The watcher line pauses while you are inside an agent, because the board is closed then.
- With the board closed and no agent changing status, pull-request feedback is noticed at the next status change
  or when the board opens.
- Chat takeover is gone by design: you are simply in the agent's own terminal.

## Tests

`npm test`. A fake herdr binary and scripted fake agents: no model calls, no real board, no real herdr.
