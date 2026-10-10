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

Typing `herdr-superwork` in any pane opens the board. The first time it opens inside herdr it asks, once, whether
it may add two things to your herdr `config.toml` (each is your choice; the file is backed up first, each block
sits between two marker lines, and a change herdr rejects is rolled back):

- a key that opens the board (it suggests one herdr does not use; `prefix+w` is herdr's own workspace picker);
- sidebar rows, so herdr's sidebar shows each task's stage, its "doing now" line and its progress. herdr's default
  sidebar shows none of these: without the rows the plugin puts a short status into the agent's name instead
  (`review 1 · 4/5 · claude`), which works with no setup.

Nothing else is needed: no herdr integration, no hooks in your own agent settings. To add the blocks by hand instead:

```toml
[[keys.command]]
key = "prefix+a"
type = "plugin_action"
command = "herdr-superwork.open"

[ui.sidebar.agents]
rows = [["state_icon", "machine", "workspace", "tab"], ["agent", "state_text"], [{ token = "$summary", dim = true }, "$progress"]]

[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["branch", "git_status"], [{ token = "$summary", dim = true }]]
```

Optionally bind `herdr-superwork.approve-current` too: it approves the task that owns the focused pane, and does
nothing anywhere else.

**Before unlinking the plugin** run `herdr-superwork remove-extras`: herdr gives a plugin no uninstall hook, so this
is what takes the marked blocks out of `config.toml` and removes the how-to files (below).

Your running herdr server must be 0.9.3 or newer: an older server refuses the plugin until it is restarted.

## Using it

Type what needs doing and press `Enter`: the Coordinator files it as a task. `Tab` puts an agent on the selected
task. Nothing is edited by hand: to change a title, a description or a state, say so in the box or run the command.

| Key | Does |
|---|---|
| `Enter` / `→` | go into the task's agent: its real herdr pane. The board closes; your key brings it back where you left it |
| `Space` | preview the agent's last message, and reply without going in. It shows the agent's screen instead ("on its screen now") while a dialog is up, before any message, or when the conversation cannot be read. On a task with no agent, a reply puts one on it with your message |
| `Tab` | delegate the selected task (with text typed: file it and delegate it) |
| `Ctrl+A` | approve: finished work is merged, its worktree and branch removed |
| `Ctrl+R` | send an error back to the agent, tell a stopped agent to continue (also after you fixed a login), or send review findings (below 5/5) |
| `Ctrl+Y` | finish anyway, when the agent stopped without a summary |
| `Ctrl+G` | send failure details (a conflict, a failed check) to the task's own agent; never approves |
| `Ctrl+X` | stop the agent; twice on a non-working task deletes it (unsaved work is kept, and you are told where) |
| `Ctrl+E` / `Ctrl+B` | full details / hide or show the side panel |
| `Alt+A` / `Alt+H` / `Ctrl+Z` | archive or restore / the archive / undo the last archive |
| `Ctrl+T` `Ctrl+S` `Ctrl+F` `Ctrl+D` `Ctrl+O` | pin, group by repo, find, show all done, other machines |
| `?` | every key |

**Four roles.** The **Agent** does the work. The **Reviewer** attacks finished work. The **Watcher** is a small
model that writes the "doing now" line and guesses progress (it skips a look when the screen has not changed). The
**Coordinator** runs the box: it turns what you type into board commands. It defaults to the same program, model and
effort as the Agent and follows `agent` when you change that; set `coordinator`, `coordinatorModel`,
`coordinatorEffort` to choose otherwise. It must be limited to running `herdr-superwork` commands, which only Claude
Code can do today: with a Codex or pi agent the Coordinator is Claude Code on its own default model (the side panel
says which program runs the box), and with no Claude Code installed what you type is filed word for word.

**Every chat knows the board.** With `skill` on (the default) the plugin keeps a small how-to, a folder named
`herdr-superwork` holding `SKILL.md`, in each installed agent program's own skills folder (`~/.claude/skills`,
`~/.codex/skills`, `~/.pi/agent/skills`), so an ordinary chat can "file this on the board" without being told how.
It gives the command by its full path, so `npm link` is not needed. `herdr-superwork config skill off` removes
exactly what was written; a folder of that name the plugin did not write is left alone.

Commands: `add`, `list`, `report`, `describe`, `delegate`, `tell`, `stop`, `approve`, `review`, `retry`, `fix`,
`finish`, `details`, `pin`, `archive`, `restore`, `clear`, `config`, `remove-extras`; `herdr-superwork help` lists
them. An agent the board itself started may only run `add`, `list`, `details` and `report <its own task> --state
blocked` (its reviewer: `list` and `details`); the rest is refused with one line. That is a guard against mistakes,
not a security boundary.

## How work gets done

**Delegating.** In a git repo the plugin asks herdr for a worktree workspace (`herdr worktree create`), on its own
branch `work/<n>-<title>`, started from the remote's default branch (or your commit with `--base head`). The repo's
`setup` runs, then the agent starts in that workspace's root pane and gets the task and its rules. Outside git the
agent works in place in a plain herdr workspace. At most `max` (4) agents work at once; more wait their turn, and
tasks that wait for you hold no slot.

**Finished = the agent says its turn ended.** The plugin starts every agent itself, and at launch it passes a
turn-end hook on the command line (Claude Code: `--settings <a file in the task's own folder>`; Codex:
`-c notify=[…]`; pi: `-e <a one-file extension>`), a session id of its own choosing where the program takes one, and
the task's rules as a standing system prompt. Nothing is written to your own agent settings, and your own hooks keep
running. At each turn end the hook runs `herdr-superwork turn-ended` (silent, at most two seconds, protected by a
per-launch secret), and the finish line reads the end of that agent's saved conversation: its last message, an API or
login error, token use. With the board open or closed it then:

1. commits anything left over, brings the branch up to date with main in the task's own worktree (see "Staying
   current with main"), and runs the repo's `check` (a failure goes straight back to the agent, three tries);
2. pushes the branch and opens a draft pull request, when there is an `origin` remote and `gh`;
3. has a second agent review it adversarially, in a visible split of the same herdr space; it rates the work 1 to 5
   and brings evidence; whatever it changed is put back. A reviewer that ends its turn with no verdict fails the
   review at once, with its own error or last message. The board says which review a task is on (`review 1`,
   `review 2`, …) wherever its review state shows: the preview, the details, herdr's sidebar and the review page;
   on a row it is a small marker beside the PR number (`r1`, `r2`, …). The score on a row is green when the
   reviewer says merge and red when it says don't;
4. waits for your approval (`Ctrl+A`).

An error, a usage limit, a cut-off or a refusal is saved as "Agent stopped" with the real text; a login error makes
the task "Needs a login", and that comes first: older failure details are not sent and pull-request feedback does not
wake the agent until you have logged in and then replied, pressed `Ctrl+R` or typed in the agent's terminal. A turn
only blocks on you when the agent ran `report … --state blocked`; a final message that merely ends in a question
goes on to check and review, and you still approve at the end.

**Without a hook** (a crash, a program older than the adapter's minimum version, another agent kind, Codex when you
have your own `notify` configured, or a hook that failed three turns in a row) herdr's
status is only a guess from the screen, so "idle" alone never finishes a task. The turn counts as ended when the
saved conversation ends in a finished message or an error, or a closing note was written to
`.herdr-superwork/closing-<n>.md` (the rules still ask for one as the fallback). Otherwise the task is held as
"stopped without a summary": `Ctrl+R` tells the agent to continue, `Ctrl+Y` finishes anyway. Typing in the agent's own
terminal, or replying from the board, re-arms all of this: an approval is revoked, a pending auto-merge cancelled (a
cancellation that fails is saved as a visible failure), the old review marked stale.

**With the board closed** a small background process, the keeper (`herdr-superwork keeper`), does what the open
board's tick does: it polls pull requests, starts queued tasks, runs the Watcher, keeps herdr's sidebar labels
current. It raises no notification, pop-up or sound: what needs you is on the board and in herdr's sidebar. herdr
starts it with its server; any herdr event or
opening the board starts it again if it died; it replaces itself when the plugin is updated, and exits when herdr is
gone. It looks after this machine's tasks only. The sidebar shows only tasks with a live agent pane; the others
(queued, your own) are on the board only.

**Staying current with main** is the board's job, not the agent's: nothing in an agent's rules asks for it. Tasks
run in parallel and touch the same files, so the board itself fetches main and merges it into each task's branch, in
that task's own worktree:

- *before review*: when an agent finishes, before the check and the review, so the reviewer sees the work as it
  will really land;
- *whenever main moves* (another task merged, a merge on GitHub, your own push; the remote is asked every two
  minutes): every task waiting for your approval is updated, and a task under review the moment its review ends;
- *after you approve*, once more, as the last safety net. It should rarely find anything.

A clean update is silent. If it changed the commit, the check runs again on the result; the review is repeated only
when the update touched a file the task itself changed. Otherwise the verdict you already have stands and the task
does not ask for your eyes again. A real conflict is rolled back at once (your branch and the task's are as they
were) and goes straight to the task's agent as a plain message: the conflicting files, the target commit, and that
it should resolve them in its own worktree and finish again. Until it has, the task is not waiting for approval: its
row says "resolving a conflict with main" and herdr's sidebar says "conflict". After `rounds` repairs in a row that
still conflict, you are asked, with the details kept. `conflictAuto false` on a task keeps its conflicts for you to
send with `Ctrl+G`. Only a task at rest is ever updated: its worktree clean, on exactly the commit that was reviewed.
A fetch that fails is never taken for a sync: a finished turn is saved as "Could not synchronize main" instead of
going on to review (and as "Task is on the wrong branch" when its worktree has left the task's own branch). A waiting task whose main cannot be fetched, or that was not at rest when main moved, is held
as "behind main": its row and herdr's sidebar say so, `Ctrl+A` is refused with the reason, and the board tries again
every minute until the branch really is up to date.
"Main" is where the task will land: the remote's main when it lands through a pull request; otherwise (no remote,
or `pr` off) the branch your checkout was on when the task first finished. For those, checking out another one
merges nothing into waiting tasks, and they are held as "behind main" until your checkout is back on it.

**Approving** makes that last sync, re-checks (and re-reviews, by the same rule) if it changed anything, then merges
through the pull request (remembered when GitHub's checks are still running) or locally, squashed by default. A
conflict found here goes back to the agent the same way, and the merge you approved is retried after its repair. A
checkout with unsaved files is never forced.

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
| `reviewer`, `reviewerModel`, `reviewerEffort` | `codex` | the reviewer; `off` for none. Not installed here: the agent's own kind reviews, on its default model, and the task says so |
| `coordinator`, `coordinatorModel`, `coordinatorEffort` | same as the agent | who runs the box |
| `watcherAgent`, `watcherModel` | `claude`, `claude-haiku-5-5` | the Watcher's small model (`helper`, `helperModel` are still read as these) |
| `watcher` | `on` | the "doing now" line and progress guess, about every 15 seconds per working agent, board open or closed |
| `skill` | `true` | keep the how-to in each agent program's skills folder |
| `theme` | `auto` | the board and the review page use herdr's own colours and status marks. herdr's sidebar is drawn by the client with the config of the device it runs on, and herdr does not pass that on to the board. `auto`: when herdr's `config.toml` on this machine sets a theme (`[theme]`, with its custom colours), the board follows it as herdr resolves it; when it sets none, the board paints with the terminal's own colours, as herdr's `terminal` theme does, which fits whatever device you look from. `herdr` follows this machine's config exactly, Catppuccin by default: choose it if you run an unconfigured herdr on this very machine and want the board to match it; `terminal` always uses the terminal's colours; `dark` or `light` picks herdr's dark or light theme by hand. `ui.status_indicators` is always followed |
| `review` | `repos` | what gets reviewed: `repos`, `all` or `none` |
| `artifacts`, `serve` | `true`, `tailscale` | evidence pages, linked privately on your tailnet (`local` for 127.0.0.1; also used, and said on the task, when Tailscale is not installed) |
| `reviewAuto`, `rounds` | `false`, `3` | send reviews below 5/5 back by themselves, at most this often; `rounds` also caps conflict repairs |
| `worktree`, `base` | `auto`, `fresh` | `none`: work in your checkout; `head`: start from your commit |
| `pr`, `merge`, `cleanup` | `true`, `squash`, `true` | pull requests, how work lands, remove merged worktrees |
| `max` | `4` | agents working at once |
| `trust` | `true` | pre-trust a task's repo in the agent's own settings |
| `agentArgs` | full access | per agent kind: arguments after `--` for `herdr agent start` |
| `machines`, `remoteUser` | `auto` | other machines: herdr's saved machines, names, or `off` |

Per task (`--id <id>`, or options to `delegate`): `agent`, `model`, `effort`, `reviewer`, `reviewerModel`,
`reviewerEffort`, `watcher`, `review`, `reviewAuto`, `rounds`, `artifacts`, `serve`, `conflictAuto` (on by default).

Data lives in `~/.local/state/herdr-superwork` (`HERDR_SUPERWORK_DATA_DIR` overrides it): one folder per task with
`task.json`, `inbox.jsonl` and `artifacts/`.

## Other machines

Every machine keeps its own tasks. `Ctrl+O` goes round: this machine, every machine, then each one by itself.
Machines are found through herdr only: the ones you added with `herdr machine add` (or name them in `machines`);
with none, `Ctrl+O` says so. There is no Tailscale discovery. The plugin's own commands on another machine still
travel over the plugin's own SSH connection, because herdr has no command that runs a plugin's commands there.
Each one needs, once:

```sh
# Node 22.19+, git, gh, flock, the agent programs it will run, then:
git clone <this repository> && cd herdr-superwork && npm install
npm link
herdr plugin link "$PWD"
```

Actions on another machine's task run on that machine, over SSH. Going into one of its agents attaches your
terminal to that one agent there (`herdr agent attach`), after that machine has reopened the task's space and
restarted an exited agent in the same conversation; `ctrl+b q` returns to the board. A machine on an older plugin is
told apart by its missing version: its new fields stay blank and the board says "update herdr-superwork on <machine>". Work never moves between
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
| `herdr machine list --json` exposing SSH targets | not verifiable here (no saved machines; it prints `[]`): name machines in the `machines` setting if `auto` finds none |

Checked on 2026-10-09 for the turn-end hook and the keeper (herdr 0.9.3, Claude Code 2.1.296, Codex 0.160.0, pi 1.1.0),
in a separate scratch herdr:

| Fact | Result |
|---|---|
| Claude `--settings <file with Stop and StopFailure hooks> --session-id <uuid>` through `herdr agent start` | fires at every turn end; the input names the session, the transcript file and the last message |
| `claude --settings` adds to the user's own hooks | yes: a project-level Stop hook and the flag's both ran (the user's own settings hold no hooks to lose) |
| A failing, noisy or slow hook | does not change the reply; a slow one delays the end of the turn unless marked `"async": true`, which the plugin does |
| Claude resumes a known session id (`--resume <id>`) | yes, same id and same file |
| Claude's conversation file | `~/.claude/projects/<folder>/<id>.jsonl`; a finished message has `stop_reason` `end_turn`, a pending one `tool_use`; an API or login error is an entry with `isApiErrorMessage` and `error` (`authentication_failed`, `model_not_found`); an interrupt (Esc) is a user entry "[Request interrupted by user]" and fires no hook; token use and model are on each message. Usage limit: not reproduced |
| Codex honours `-c notify=[…]` at launch | yes, headless and interactive; the JSON argument carries the thread id and last message. It also reports side conversations (its chat-naming one), which are told apart by their prompt. An interrupt fires nothing and is `turn_aborted` in the file. It would replace a `notify` of the user's, so a user who has one gets no hook |
| Codex's conversation file | `~/.codex/sessions/<date>/rollout-…-<id>.jsonl`: `task_complete` with the last message, `token_count` with the context window, `turn_context` with the model; `codex resume <id>` continues the same file |
| pi `-e <file>` | the extension receives `agent_settled`; the session file is `~/.pi/agent/sessions/<folder>/<time>_<id>.jsonl` with `stopReason` and `errorMessage` per message; `--session-id` creates or reopens an exact id |
| A launch flag for standing rules | Claude `--append-system-prompt-file`, pi `--append-system-prompt <file>`, Codex `-c developer_instructions=…`: all three kept a rule over the session. herdr refuses a launch argument that holds a line break, hence the files |
| User-level skills folders | `~/.claude/skills`, `~/.codex/skills`, `~/.pi/agent/skills` exist; Claude Code listed the plugin's how-to as a skill right after it was written |
| herdr's sidebar shows the plugin's pane and workspace metadata | **not by default.** State labels and `$summary` / `$progress` tokens show only when `[ui.sidebar.*] rows` in `config.toml` list them; only `--display-agent` shows with no setup. Hence the name fallback and the first-run offer |
| A new `[[keys.command]]` after `herdr server reload-config` | works without a restart. A broken file is reported as `failed` and herdr keeps the old config; a key bound twice is `partial`; `herdr config check` validates a candidate given by `HERDR_CONFIG_PATH` |
| herdr's config path and default keys | `~/.config/herdr/config.toml`; `herdr --default-config` lists the built-in keys (`prefix+w` is herdr's workspace picker; `prefix+a` is free) |
| What the terminal shows, inside herdr | the board asks the terminal for its background (OSC 11) and its 16 colours (OSC 4) when herdr's `theme.auto_switch` is on or the theme paints with the terminal's own colours; herdr answers for its panes with the colours of the terminal the client runs in. No answer (the scratch session has no real terminal behind it): dark, and xterm's colours. `theme light` chooses by hand |
| herdr's theme, for a plugin | not handed to plugins. The board reads the `[theme]` and `[ui]` tables herdr reads (with its own full TOML reader, `src/toml.js`) and resolves them as herdr 0.9.3 does (`src/app/state.rs` palettes, `src/client/shell.rs` marks: `●` working, blocked and done, `○` idle; `◐ × ✓ ○` with `status_indicators = "symbols"`). Text is herdr's `text` colour and the side panel sits on `sidebar_bg` when the theme sets one. The review page takes the theme in force when it is written; where herdr follows the terminal (`auto_switch`, the `terminal` theme) the page follows the browser's light or dark setting. A theme changed in herdr shows the next time the board opens. Marks, group headings, the bar and the percent take herdr's colour for the task's state (working `yellow`, blocked `red`, done `teal`, idle `green`); a task's own words (its title and what it says) are always herdr's text colours, whatever its state; text, secondary text, rules and the selected row are herdr's sidebar colours (`text`, `subtext0`, `overlay0`, `surface_dim`, `selection_bg`/`active_row_bg`). A review's score is `green` when the reviewer says merge and `red` when it says don't: the colour is the advice, there are no words for it |
| Limiting Codex or pi to one command | no flag found: neither can be the Coordinator |
| herdr's own remote commands for a saved machine | not testable (no saved machine): the plugin's SSH door keeps doing all of it |
| A keeper started from the startup hook | survives the hook and replaces itself on an update; "for hours" was not waited for, so hook events and the board also start it |

## Compared with pi-work

Back, in herdr's terms: the board is fresh while closed (the keeper); the board knows when and why an
agent or reviewer stopped without a note file (the turn-end hook); `Space` shows what the agent said; tokens and
context fullness (for a model whose window is known: Codex states it, Claude Code and pi do not, so those show
tokens only); the Coordinator; every chat knows the board; archive closes the space and a reply after restore resumes
the same conversation; a progress bar on your own tasks; a reply to a task with no agent starts one; a light palette.

Different by choice, or because herdr or an agent program cannot do it:

- No "2 blocked · 1 working" counter: herdr's sidebar is the closed-board view. It shows the plugin's labels only
  with the sidebar rows in herdr's config (offered at first run); otherwise a short status in the agent's name.
- No notifications: nothing pops up or sounds when a task needs you, with the board open or closed, and
  there is no bell. The board does not emit terminal status reports (OSC 7501) while closed.
- The sidebar shows only tasks with a live agent pane.
- `Space` shows the raw screen while an agent sits at a dialog that is not in its messages.
- A question does not pop open by itself: the row says so and `Space` reads it. `Ctrl+G` on an agent's own "I'm
  stuck" is refused when there is no saved failure. Agents report only `blocked`, never their own progress.
- Agents the board starts may only file tasks and report themselves blocked.
- Only Claude Code can be the Coordinator. One Watcher model for everything; per task it is on or off.
- Hooks were verified on Claude Code 2.1.296, Codex 0.160.0 and pi 1.1.0, and those are the adapters' minimum
  versions: older programs run without the hook. Codex and pi were verified piece by piece (hook, file, resume), not
  through a whole delegated task.
- Other machines come from herdr only; no sub-tasks; nothing is migrated from pi-work; no chat takeover (you are in
  the agent's own terminal).
- If the keeper dies while nothing at all happens, pull-request polling waits for the next herdr event or board open.

## Tests

`npm test`. A fake herdr binary and scripted fake agents: no model calls, no real board, no real herdr.
