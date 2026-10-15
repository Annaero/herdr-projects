# herdr-projects

A work board for [herdr](https://herdr.dev): one list of tasks, yours and delegated ones. Every delegated task runs
as an ordinary herdr agent in its own herdr space. The board is an overview and a remote control; herdr is the engine.

It is pi-work's board, rebuilt for herdr: the same screen and keys, but agents are real herdr
agents, their status is mirrored from herdr, and going into a task takes you to that agent's own terminal.

## Install

Linux or macOS (x86_64 or aarch64). Needs herdr 0.9.3 or newer, `git`, `curl` or `wget`, and optionally `gh` (pull
requests) and `tailscale` (private review links). The board is one program: no Node, no npm.

```sh
git clone https://github.com/eliasstravik/herdr-projects && cd herdr-projects
herdr plugin link "$PWD"          # hooks, the popup and the actions
sh bin/run.sh install             # gets the program, writes its launcher, says how to put it on your PATH
```

The plugin downloads the program for your platform from the project's GitHub releases; `herdr-projects update`
fetches a newer one. To build it yourself instead: `cargo build --release`. The first run, the blocks it can add to
herdr's config, updating, and taking the plugin out again: [installing](docs/install.md).

## Start

Type `herdr-projects` in any pane (its launcher on your PATH), or run the plugin's action "Open the work board":
that opens the board. Type what needs doing and press `Enter`: that adds a task.
`Tab` puts an agent on the selected task. `?` shows everything else you can do.

## The pages

One page per topic, in [docs/](docs/): start with [the board](docs/board.md), [how work gets done](docs/how-work-gets-done.md)
and [settings](docs/settings.md).

## Working on the code

[AGENTS.md](AGENTS.md) says where new things go and how to run the tests; `herdr-projects docs --where` prints
which file holds what.
