# Installing, the first run, and taking it out again

Linux. Needs herdr 0.9.3 or newer, Node 22.19+, `git`, `flock` (util-linux), and optionally `gh` (pull requests) and
`tailscale` (private review links).

```sh
cd herdr-superwork
npm install
npm link                          # puts `herdr-superwork` on your PATH (agents use it too)
herdr plugin link "$PWD"          # hooks, the board's tab and the actions
```

Typing `herdr-superwork` in any pane opens the board. The first time it opens inside herdr it shows one screen with
two things it can add to your herdr `config.toml`. Each is your choice, answered with single keys: `1` and `2` switch
them on or off, `k` picks another key, `enter` saves, `esc` asks again next time. The file is backed up first, each
block sits between two marker lines, and a change herdr rejects is rolled back:

- a key that opens the board: it offers `prefix+a`, which herdr does not use itself. If your config already binds
  `prefix+a`, it offers the next free key (`prefix+y`, then `prefix+u`, `prefix+i`, `prefix+m`) and says why. A key
  that herdr binds by default, or that your config already binds, is never taken: the screen refuses it and says what
  the key does today (`prefix+w`, for one, is herdr's own workspace picker), for the offered key and for one you type
  with `k` alike, and however your config writes a binding (one key, a list of keys, the older `[keys.indexed]`). A key that is already set up for the board is left as it is;
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

A `[[keys.command]]` wins over herdr's own binding of the same key, without a warning: written by hand on a key
herdr uses, it switches herdr's action off (an early version of this page showed `prefix+w` here, which took away
herdr's workspace picker). `herdr --default-config` lists most of the keys herdr binds (not copy mode, `prefix+[`,
nor swapping panes, `prefix+shift+h` `j` `k` `l`); to move the board, change the `key`
line and run `herdr server reload-config`.

The key opens the board in a tab of its own. To have it open the board as a popup over the tab you are in, and
close it again: `herdr-superwork set board.open popup` ([the board](board.md)). The key itself stays as it is.

Optionally bind `herdr-superwork.approve-current` too: for the task that owns the focused pane it opens the board on
that task with the merge question up (`y` = yes, `n` or `esc` = no), and does nothing anywhere else.

**Before unlinking the plugin** run `herdr-superwork remove-extras`: herdr gives a plugin no uninstall hook, so this
is what takes the marked blocks out of `config.toml` and removes the how-to files (below). With the herdr web UI
plugin installed it also points that web UI's shared link back at the web UI and stops the board's front door
([the board in the herdr web UI](web-ui.md)).

Everything the board keeps for you is in one folder, `~/.herdr-superwork/`: [the home folder](home-folder.md).
Updating from a version that kept its files in `~/.local/state`, `~/.config` and `~/.local/share` needs nothing from
you: the first run moves them there and says so in one line.

Your running herdr server must be 0.9.3 or newer: an older server refuses the plugin until it is restarted.
