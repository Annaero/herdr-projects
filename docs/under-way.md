# What a key shows at once

A key that acts on a task shows that it did so the moment it is pressed, however long the work takes (a worktree to
set up, an agent to start, a process to stop, a merge, another machine to answer). The task's row takes the working
mark and says what is under way, in the working colour, where it says what it does (beside its name, or on its
second line); the task panel says it under Status, as `Now`:

| Key | Says |
|---|---|
| `Tab`, or a first reply to a task with no agent | `Starting…` |
| `Ctrl+X` on a running task | `Stopping…` |
| `Ctrl+X` and then `y` on one that does not run | `Removing…` |
| `Ctrl+L` | `Merging…` (after the `y`), `Approving…`, `Trying again…` or `Finishing as it is…`, as it is the yes to |
| `Ctrl+R` | `Sending back…` |
| `Ctrl+A`, `Ctrl+Z` | `Archiving…`, `Restoring…` |
| `Ctrl+P` | `Pinning…`, `Unpinning…` |
| `y` on the pick of an attempt | `Keeping attempt B…` |
| `Enter` with nothing typed | `Opening…` (until its pane is opened) |
| `Space`, `Tab`, `Ctrl+X` on an automation | `Turning on…`, `Turning off…`, `Firing…`, `Removing…` |

The words stay until the board has read the task again after the work ended: then the row is the task's own again,
in its real state. A read that had begun before the work ended does not count, so the row never flips back to how it
was for a moment. On another machine's task the words stay until that machine shows the task changed, or has answered
twice since (at most 15 seconds).

**When it did not work** the row says so in red, with the error mark: `Could not stop: …`, with why. The panel says
the same under `Now`, and the message line says it until `Esc`. The row is its own again after ten seconds, or when
`Esc` dismisses the error.

**The same key again while the work is under way does nothing**, so nothing is started twice: the message line says
`Still starting PRJ-12. One moment.` Words to the task's agent and going into its pane never wait, and leave
what the row says alone: the row keeps saying `Stopping…` until the stop itself is done.

A task whose row is not in view (one restored from the archive by `Ctrl+Z`) has it said on the message line instead:
`Restoring PRJ-12 "Fix the build"…`.
