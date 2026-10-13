# herdr-superwork

A work board for [herdr](https://herdr.dev): one list of tasks, yours and delegated ones. Every delegated task runs
as an ordinary herdr agent in its own herdr space. The board is an overview and a remote control; herdr is the engine.

It is pi-work's board, rebuilt for herdr: the same screen and keys, but agents are real herdr
agents, their status is mirrored from herdr, and going into a task takes you to that agent's own terminal.

## Install

Linux. Needs herdr 0.9.3 or newer, Node 22.19+, `git`, `flock` (util-linux), and optionally `gh` (pull requests) and
`tailscale` (private review links).

```sh
cd herdr-superwork
npm install
npm link                          # puts `herdr-superwork` on your PATH (agents use it too)
herdr plugin link "$PWD"          # hooks, the popup and the actions
```

The first run, the blocks it can add to herdr's config, and taking the plugin out again: [installing](docs/install.md).

## Start

Type `herdr-superwork` in any pane: that opens the board. Type what needs doing and press `Enter`: that adds a task.
`Tab` puts an agent on the selected task. `?` shows everything else you can do.

## The pages

One page per topic, in [docs/](docs/):

- [Installing, the first run, and taking it out again](docs/install.md)
- [The board: the list and the chat](docs/board.md)
- [The board's size: what changes it, and how the board stands still](docs/board-size.md)
- [Colours: herdr's theme, and the box that says who you type to](docs/colours.md)
- [The task panel](docs/task-panel.md)
- [Keys, questions and the ? menu](docs/keys.md)
- [The mouse: the wheel, and selecting text](docs/mouse.md)
- [The Coordinator](docs/coordinator.md)
- [herdr's sidebar: a small copy of the board's rows](docs/sidebar.md)
- [Roles and commands](docs/roles-and-commands.md)
- [How work gets done](docs/how-work-gets-done.md)
- [An agent that waits for you is not finished](docs/waiting-for-you.md)
- [The Watcher: how often it looks, and what it costs](docs/watcher.md)
- [The check's progress: what the board shows, and how a check reports it](docs/check-progress.md)
- [A task's tabs in herdr: Agent, Reviewer #1](docs/tabs.md)
- [Several attempts, and one kept: best of three, a council](docs/attempts.md)
- [Handing text to an agent: typed is not sent](docs/handing-over.md)
- [A turn cut off by the provider](docs/provider-errors.md)
- [The gate](docs/gate.md)
- [Reports, and research-only tasks](docs/research.md)
- [Automations: tasks made on a schedule, or when something happens on the board](docs/automations.md)
- [Titles and their length limit](docs/titles.md)
- [Task numbers and repo keys: `#134`, `HSW-134`](docs/task-numbers.md)
- [Settings](docs/settings.md)
- [The home folder: where the board keeps its files](docs/home-folder.md)
- [Other machines](docs/other-machines.md)
- [The board in the herdr web UI](docs/web-ui.md)
- [The web board's chat box: the web UI's own, built again and measured](docs/web-chat-box.md)
- [What was checked on herdr 0.9.3](docs/checked-on-herdr.md)
- [Compared with pi-work](docs/compared-with-pi-work.md)

## Working on the code

[AGENTS.md](AGENTS.md) says where new things go; [where things live](docs/where-things-live.md) says which file
holds what; [tests](docs/testing.md) says how to run them.
