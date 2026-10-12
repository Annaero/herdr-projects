# Keys, questions and the ? menu

**The board asks before what cannot be undone**, always the same way, in a small box: `Merge PR#18?  y = yes ·
n = no`. `y` says yes, `n` or `Esc` says no, in upper or lower case; `Enter` never confirms, and no other key answers.
Merging and deleting a task ask; nothing else does. A result stays on screen until
your next key press, an error until `Esc` dismisses it.

**Closing the board takes `Ctrl+C` twice**, as leaving Claude Code does. The first one shows `Press ctrl+c
again to close the board` on the bottom line; `Ctrl+C` again while it shows (0.8 seconds, Claude Code's own wait)
closes, with a draft in the text box too. Any other key, or the wait running out, takes the hint away, and that key does what it always does.

The bottom line shows only what matters right now, the main thing first, at most four. Apart from `Enter`, `Tab`,
`Esc` and `Ctrl+C`, a key acts on the board only while the text box is empty: with a draft in it, the keys are the
draft's. The `?` menu shows the key of each of its lines beside it.

<!-- made:keys Made by `node scripts/docs.js` from src/board/keys.js. Do not edit between these two lines. -->
| Key | Does |
|---|---|
| `↑` `↓` | move between tasks |
| `PgUp` `PgDn` | ten tasks up or down |
| `Alt+↑` `Alt+↓` | to the first task of the group above or below |
| `Home` `End` | in the whole task, full screen: to its top or its end (`↑` `↓` and `PgUp` `PgDn` scroll it) |
| `Enter` | send what you typed; with nothing typed, open the task's agent: its real herdr pane. The board closes (the first few times it says how to get back); your key brings it back where you left it |
| `Shift+Enter` | a new line in what you are typing |
| `→` | open the selected task's agent, as `Enter` does with nothing typed |
| `Space` | flip who you talk to: the selected task's agent, and back to the Coordinator. The chat says who. Nothing else changes it: while it is a task's agent, moving with `↑` `↓` makes it the agent of the task you moved to. On a task with no agent, your message puts one on it |
| `Tab` | put an agent on the task. With text typed for the Coordinator: send it, and every task it files from that message gets an agent at once, with nothing more to confirm (a message that files nothing delegates nothing) |
| `Ctrl+A` | yes, to whatever the task waits for: approve the merge (it asks first), say yes to the agent, retry the step that went wrong as it stands, or take work that stopped without a summary as it is |
| `y` `n` | answer a question the board asks: `y` yes, `n` or `Esc` no. Only while a question is up; `Enter` never confirms |
| `Ctrl+R` | send it back: whatever went wrong (a failed check, a conflict, an error, a review with findings) goes to the task's agent to fix; a stopped agent is told to continue. `Ctrl+G` does the same |
| `Ctrl+X` | stop the agent. The selection stays on that row |
| `Ctrl+Y` | finish anyway: take a turn that stopped without a summary as finished work, and run the finish line on it |
| `Ctrl+F` | find |
| `Ctrl+E` | the whole task, full screen, and back to the list |
| `Alt+A` | archive the selected task, or restore it from the archive |
| `Ctrl+T` | pin the selected task to the top, or unpin it |
| `Delete` | delete the selected task (it asks first) |
| `Ctrl+Z` | undo: bring back a draft that was put away, or take the last archiving back |
| `Alt+H` | open the archive, and back to the board |
| `Ctrl+P` | the side panel, on or off (`Ctrl+B` is herdr's own prefix key, so this is the side panel's) |
| `Ctrl+S` | group the list by repo, or by state |
| `Ctrl+D` | show every done task, or only the latest |
| `Alt+C` | into the whole chat of whoever the chat talks to: the Coordinator's or the task agent's own pane. The board closes |
| `Alt+V` | show or hide the chat's latest message, the Coordinator's or a task agent's. The one key for it, both ways |
| `Alt+R` | restart the Coordinator: the same conversation, the program started again (it asks first) |
| `Alt+N` | start a new Coordinator, with a fresh conversation (it asks first) |
| `Ctrl+O` | other machines: this machine only, every machine, then each machine by itself. The `?` menu names each stop |
| `Ctrl+↓` `Ctrl+↑` | down to the words on their way to another machine, and back up to the list |
| `Alt+W` | disconnect another viewer that holds the board's terminal at its own size. Only while one does |
| `?` | a menu of everything else for the selected task, picked with `↑` `↓` and `Enter`: the whole task full screen, the side panel, archive, pin, delete, undo, the archive, group by repo, show all done, other machines, the Coordinator. Under them, the keys worth remembering and what a row's `R#2 ✓` review tag says; where the window is too short for all of it, `↓` on the menu's last line scrolls on down, and `↑` comes back |
| `Esc` | back, one step at a time, and nothing else: find is left, a draft is put away, then the whole task, the filter and the archive close. With none of those left it shows the same hint as `Ctrl+C`. It never shows or hides the chat, never changes who you talk to, and never closes the board by itself |
| `Ctrl+C` | twice: close the board, with text typed too: the draft is kept and is back when the board reopens |
<!-- /made:keys -->
