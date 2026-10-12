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

Typing `herdr-superwork` in any pane opens the board. The first time it opens inside herdr it shows one screen with
two things it can add to your herdr `config.toml`. Each is your choice, answered with single keys: `1` and `2` switch
them on or off, `k` picks another key, `enter` saves, `esc` asks again next time. The file is backed up first, each
block sits between two marker lines, and a change herdr rejects is rolled back:

- a key that opens the board (it suggests one herdr does not use; `prefix+w` is herdr's own workspace picker);
- sidebar rows, so herdr's sidebar shows each task's stage, its "doing now" line, its progress and the minutes left. herdr's default
  sidebar shows none of these: without the rows the plugin puts a short status into the agent's name instead
  (`approve? pass · claude`), which works with no setup. With the rows in place the name is left alone, so the
  status is not said twice on one line.

Nothing else is needed: no herdr integration, no hooks in your own agent settings. To add the blocks by hand instead:

```toml
[[keys.command]]
key = "prefix+a"
type = "plugin_action"
command = "herdr-superwork.open"

[ui.sidebar.agents]
rows = [["state_icon", "machine", "workspace", "tab"], ["agent", "state_text"], [{ token = "$summary", dim = true }, "$progress", "$eta"]]

[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["branch", "git_status"], [{ token = "$summary", dim = true }]]
```

Optionally bind `herdr-superwork.approve-current` too: for the task that owns the focused pane it opens the board on
that task with the merge question up (`y` = yes, `n` or `esc` = no), and does nothing anywhere else.

**Before unlinking the plugin** run `herdr-superwork remove-extras`: herdr gives a plugin no uninstall hook, so this
is what takes the marked blocks out of `config.toml` and removes the how-to files (below).

Your running herdr server must be 0.9.3 or newer: an older server refuses the plugin until it is restarted.

## Using it

Type what needs doing and press `Enter`: that adds a task. `Tab` puts an agent on the selected task. Nothing is
edited by hand: to change a title, a description or a state, say so in the text box or run the command.

The rest is one page per topic:

- [The board: the list and the chat](docs/board.md): the list and its groups, the chat at the bottom, a board that looks cut off
- [The task panel](docs/task-panel.md): the side panel and the full-screen details, and how reviews show there
- [Keys, questions and the ? menu](docs/keys.md): every key, what the board asks before doing, the hint line
- [The Coordinator](docs/coordinator.md): the agent behind the chat, `Tab`, going into its pane
- [Roles and commands](docs/roles-and-commands.md): Agent, Reviewer, Watcher, Coordinator; the how-to skill; the command line
- [How work gets done](docs/how-work-gets-done.md): delegating, finishing, the keeper, staying current with main, approving, cleanup
- [The gate](docs/gate.md): what a review's findings decide: what goes back, what may merge
- [Settings: two places](docs/settings.md): the repo's file, your own settings, one task's own
- [Other machines](docs/other-machines.md): tasks on other machines, over SSH
- [What was checked on herdr 0.9.3](docs/checked-on-herdr.md): the table of facts verified against herdr and the agent programs
- [Compared with pi-work](docs/compared-with-pi-work.md): what came back, what is different, what is not there

## Working on the code

[Where things live](docs/where-things-live.md): which file holds what, and where a new feature of each kind goes.

## Tests

`npm test`. A fake herdr binary and scripted fake agents: no model calls, no real board, no real herdr.
