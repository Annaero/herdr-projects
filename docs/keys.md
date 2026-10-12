# Keys, questions and the ? menu

**The board asks before what cannot be undone**, always the same way, in a small box: `Merge PR#18?  y = yes ·
n = no`. `y` says yes, `n` or `Esc` says no, in upper or lower case; `Enter` never confirms, and no other key answers.
Merging and deleting a task ask; nothing else does. A result stays on screen until
your next key press, an error until `Esc` dismisses it.

**Closing the board takes `Ctrl+C` twice**, as leaving Claude Code does. The first one shows `Press ctrl+c
again to close the board` on the bottom line; `Ctrl+C` again while it shows (0.8 seconds, Claude Code's own wait)
closes. Any other key, or the wait running out, takes the hint away, and that key does what it always does.

| Key | Does |
|---|---|
| `↑` `↓` | move between tasks |
| `Enter` | send what you typed; with nothing typed, open the task's agent: its real herdr pane. The board closes (the first few times it says how to get back); your key brings it back where you left it |
| `Space` | flip who you talk to: the selected task's agent, and back to the Coordinator. The chat says who. Nothing else changes it: while it is a task's agent, moving with `↑` `↓` makes it the agent of the task you moved to. On a task with no agent, your message puts one on it |
| `Tab` | put an agent on the task. With text typed for the Coordinator: send it, and every task it files from that message gets an agent at once, with nothing more to confirm (a message that files nothing delegates nothing) |
| `Ctrl+A` | yes, to whatever the task waits for: approve the merge (it asks first), say yes to the agent, retry the step that went wrong as it stands, or take work that stopped without a summary as it is |
| `y` `n` | answer a question the board asks: `y` yes, `n` or `Esc` no. Only while a question is up; `Enter` never confirms |
| `Ctrl+R` | send it back: whatever went wrong (a failed check, a conflict, an error, a review with findings) goes to the task's agent to fix; a stopped agent is told to continue |
| `Ctrl+X` | stop the agent. The selection stays on that row |
| `Ctrl+F` | find |
| `?` | a menu of everything else for the selected task, picked with `↑` `↓` and `Enter`: the whole task full screen, the side panel, archive, pin, delete, undo, the archive, group by repo, show all done, other machines, the Coordinator. Under them, the keys worth remembering and what a row's `R#2 ✓` review tag says; where the window is too short for all of it, `↓` on the menu's last line scrolls on down, and `↑` comes back |
| `Alt+V` | show or hide the chat's latest message, the Coordinator's or a task agent's. The one key for it, both ways |
| `Esc` | back, one step at a time, and nothing else: find is left, a draft is put away, then the whole task, the filter and the archive close. With none of those left it shows the same hint as `Ctrl+C`. It never shows or hides the chat, never changes who you talk to, and never closes the board by itself |
| `Ctrl+C` | twice: close the board. With text typed it does nothing (`Esc` puts the draft away first) |

The bottom line shows only what matters right now, the main thing first, at most four. The older chords still work
when the text box is empty, and the menu shows each beside its line: `Ctrl+E` the whole task, `Ctrl+P` the side panel, `Alt+A` archive or
restore, `Alt+H` the archive, `Ctrl+Z` undo, `Ctrl+T` pin, `Ctrl+S` group by repo, `Ctrl+D` all done, `Ctrl+O`
other machines, `Delete` delete, `Alt+C` the whole chat, `Alt+V` the latest message shown or hidden, `Alt+R` and `Alt+N` restart the
Coordinator or start a new one. (`Ctrl+B` is herdr's own prefix key, so the side panel's key is `Ctrl+P`.)
