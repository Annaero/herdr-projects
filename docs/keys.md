# Keys, questions and the ? menu

**The board asks before what cannot be undone**, always the same way, in a small box: `Merge PR#18?  enter = yes ·
esc = no`. Merging, deleting a task and closing the board ask; nothing else does. A result stays on screen until
your next key press, an error until `Esc` dismisses it.

| Key | Does |
|---|---|
| `↑` `↓` | move between tasks |
| `Enter` | send what you typed; with nothing typed, open the task's agent: its real herdr pane. The board closes (the first few times it says how to get back); your key brings it back where you left it |
| `Space` | talk to this task's agent: the chat says so, and `Space` goes back to the Coordinator (so does `Esc`, once the chat's message is hidden). On a task with no agent, your message puts one on it |
| `Tab` | put an agent on the task. With text typed for the Coordinator: send it, and every task it files from that message gets an agent at once, with nothing more to confirm (a message that files nothing delegates nothing) |
| `Ctrl+A` | yes, to whatever the task waits for: approve the merge (it asks first), say yes to the agent, retry the step that went wrong as it stands, or take work that stopped without a summary as it is |
| `Ctrl+R` | send it back: whatever went wrong (a failed check, a conflict, an error, a review with findings) goes to the task's agent to fix; a stopped agent is told to continue |
| `Ctrl+X` | stop the agent. The selection stays on that row |
| `Ctrl+F` | find |
| `?` | a menu of everything else for the selected task, picked with `↑` `↓` and `Enter`: the whole task full screen, the side panel, archive, pin, delete, undo, the archive, group by repo, show all done, other machines, the Coordinator |
| `Esc` | back, one step at a time: a draft is put away, then the chat's latest message is hidden (the Coordinator's or a task agent's), then the open task, the filter and the archive close. Only with none of those left does it ask before the board closes |

The bottom line shows only what matters right now, the main thing first, at most four. The older chords still work
when the text box is empty, and the menu shows each beside its line: `Ctrl+E` the whole task, `Ctrl+P` the side panel, `Alt+A` archive or
restore, `Alt+H` the archive, `Ctrl+Z` undo, `Ctrl+T` pin, `Ctrl+S` group by repo, `Ctrl+D` all done, `Ctrl+O`
other machines, `Delete` delete, `Alt+C` the whole chat, `Alt+V` the latest message shown or hidden (`Esc` hides it too), `Alt+R` and `Alt+N` restart the
Coordinator or start a new one. (`Ctrl+B` is herdr's own prefix key, so the side panel's key is `Ctrl+P`.)
