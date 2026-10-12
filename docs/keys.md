# Keys, questions and the ? menu

**The board asks before what cannot be undone**, always the same way, in a small box: `Merge PR#18?  y = yes ·
n = no`. `y` says yes, `n` or `Esc` says no, in upper or lower case; `Enter` never confirms, and no other key answers.
Merging and deleting a task ask; nothing else does by itself. (A [suggested task](suggestions.md) is asked about
only when you press its key, and its box has three answers: `y` makes it a task, `n` dismisses it, `Esc` leaves it
for later.) A result stays on screen until
your next key press, an error until `Esc` dismisses it.

**Closing the board takes `Ctrl+C` twice**, as leaving Claude Code does. The first one shows `Press ctrl+c
again to close the board` on the bottom line; `Ctrl+C` again while it shows (0.8 seconds, Claude Code's own wait)
closes, with a draft in the text box too. Any other key, or the wait running out, takes the hint away, and that key does what it always does.

**One rule for the keys: `Ctrl` does something; `Alt` only shows or hides a part of the screen, and never changes
anything.** The tables below are all the keys the board has. No other chord does anything, and no key of an earlier
version works as a second way to press one of these.

The `?` menu lists the same three groups, each line with its key. A `Ctrl` or `Alt` line can also be picked there,
which does what the key does: so a terminal that does not pass `Alt` on (a Mac terminal without "Option as Meta",
some phone keyboards) loses nothing.

The bottom line shows only what matters right now, the main thing first, at most four. Apart from `Enter`, `Tab`,
`Esc` and `Ctrl+C`, a key acts on the board only while the text box is empty: with a draft in it, the keys are the
draft's (`Ctrl+A` is "start of the line" there, not "archive").

Restarting the Coordinator, starting a new one and going into its whole chat are not on the board: see
[the Coordinator](coordinator.md).

<!-- made:keys Made by `node scripts/docs.js` from src/board/keys.js. Do not edit between these two lines. -->
**Plain keys**

| Key | Does |
|---|---|
| `↑` `↓` | move between tasks |
| `Enter` | send what you typed; with nothing typed, open the task's agent: its real herdr pane. The board keeps running in its own tab and is there as you left it; your key goes back to it |
| `Space` | flip who you talk to: the selected task's agent, and back to the Coordinator. The chat says who. Nothing else changes it: while it is a task's agent, moving with `↑` `↓` makes it the agent of the task you moved to. On a task with no agent, your message puts one on it |
| `Tab` | put an agent on the task. With text typed for the Coordinator: send it, and every task it adds from that message gets an agent at once, with nothing more to confirm (a message that adds no task delegates nothing) |
| `Esc` | back, one step at a time, and nothing else: find is left, a draft is put away, then the whole task, the filter and the archive close. With none of those left it shows the same hint as `Ctrl+C`. It never shows or hides the chat, never changes who you talk to, and never closes the board by itself |
| `?` | the menu: every key in these three groups, each line with its key. A ctrl or alt line can be picked with `↑` `↓` and `Enter`, which does what its key does. Under the keys, what a row's `R#2 ✓` review tag says; where the window is too short for all of it, `↓` on the last line scrolls on down, and `↑` on the first scrolls up |
| `y` `n` | answer a question the board asks: `y` yes, `n` or `Esc` no. Only while a question is up; `Enter` never confirms |

**`Ctrl`: does something**

| Key | Does |
|---|---|
| `Ctrl+L` | yes, to whatever the task waits for: approve the merge (it asks first), say yes to the agent, retry the step that went wrong as it stands, or take work that stopped without a summary as it is |
| `Ctrl+R` | send it back: whatever went wrong (a failed check, a conflict, an error, a review with findings) goes to the task's agent to fix; a stopped agent is told to continue |
| `Ctrl+X` | stop the agent, when one is running (working, starting, checking, under review, or waiting for your answer); the selection stays on that row. On a task with no agent running (idle, never started, stopped, finished, archived) it asks to remove the task instead: `y` removes it, its worktree too. A stop never goes on to that question by itself: removing takes a second `Ctrl+X`, and a `y` |
| `Ctrl+A` | archive the selected task, or restore it from the archive |
| `Ctrl+P` | pin the selected task to the top, or unpin it |
| `Ctrl+N` | suggested tasks: asks about the selected task's first open suggestion, or goes to the first task that has one. In that question `y` makes it a task, `n` dismisses it and `Esc` leaves it for later ([suggestions.md](suggestions.md)) |
| `Ctrl+Z` | undo: bring back a draft that was put away, or take the last archiving back |
| `Ctrl+F` | find |
| `Ctrl+C` | twice: close the board, with text typed too: the draft is kept and is back when the board reopens |

**`Alt`: only shows or hides**

| Key | Shows or hides |
|---|---|
| `Alt+C` | the chat's latest message, the Coordinator's or a task agent's. The one key for it, both ways |
| `Alt+P` | the side panel |
| `Alt+T` | the whole task, full screen, and back to the list |
| `Alt+A` | the archive, and back to the board |
| `Alt+S` | the list grouped by repo, or by status |
| `Alt+D` | every done task, or only the latest |
| `Alt+M` | other machines: this machine only, every machine, then each machine by itself |

**The text box's own** (not a key of the board, and not in the `?` menu)

| Key | Does |
|---|---|
| `Shift+Enter` | a new line in what you are typing. Like the cursor keys and backspace, it is the text box's own editing key, not a key of the board |
<!-- /made:keys -->
