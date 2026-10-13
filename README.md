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

One page per topic, in [docs/](docs/): start with [the board](docs/board.md), [how work gets done](docs/how-work-gets-done.md)
and [settings](docs/settings.md).

## Working on the code

[AGENTS.md](AGENTS.md) says where new things go and how to run the tests; `node scripts/docs.js --where` prints
which file holds what.
