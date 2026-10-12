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
