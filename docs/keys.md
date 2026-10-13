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

One key bends the rule: `Ctrl+F` (find) only changes which tasks the list shows, so by the rule it would be an `Alt`
key. It is the key every program finds with, and it is left where it is. `Alt+M` only shows other machines, but
while one machine is shown by itself, what you type goes to that machine's Coordinator: the chat says so.

The `?` menu lists the same three groups, each line with its key. A `Ctrl` or `Alt` line can also be picked there,
which does what the key does: so a terminal that does not pass `Alt` on (a Mac terminal without "Option as Meta",
some phone keyboards) loses nothing. In the terminal view of herdr's web UI the `Alt` keys and `Shift+Enter` arrive
in the old byte form and are taken as such, and the Enter a phone's input line adds behind `?`, `y`, `n` or space is
dropped ([the web UI](web-ui.md)).

Apart from `Enter`, `Tab`,
`Esc` and `Ctrl+C`, a key acts on the board only while the text box is empty: with a draft in it, the keys are the
draft's (`Ctrl+A` is "start of the line" there, not "archive"). The two keys that scroll the chat's message, `Alt+U`
and `Alt+J`, are the one exception: they only show more of it, so they work while you type and leave the draft alone.

## The hint line

The bottom line shows only what matters right now, the main thing first, at most four hints for the selected task.
`?` lists every key; the hint line is not a list.

- **A hint says what the key does and to what.** "This task" is the selected one: `enter open this task's agent`,
  `tab put an agent on this task`, `ctrl+l approve and merge this task`. Whose agent is said once on the line; after
  that it is `the agent` (`space talk to the agent · ctrl+x stop the agent`). The same action has the same words
  on the hint line and in the `?` menu.
- **A key is named only where it does something.** `esc` is there with what it goes back from (`esc back to the
  list`, `esc clear the filter`, `esc back to the board` in the archive) and not where it would only show how the
  board closes. `↑↓ scroll the task` shows on the whole task only while it is longer than the window. `alt+c` shows
  only while there is a message to show or hide. `ctrl+x` says what it would do here: `stop the agent`, `remove this
  task`, or, on a task you marked as your own work, `put it back in to do`.
- **What the screen already says is not said again.** The text box's own grey words say who gets your message (`Send message
  to Agent`, `Send message to Coordinator`), so the line does not.
- **While you type**, it says where `Enter` sends your words: `enter send to the Coordinator`, `enter send to this
  task's agent`, `enter send, and start an agent on this task`, `enter add it as a task`.

| Where | The hint line |
|---|---|
| A task nobody started | `tab put an agent on this task · space talk about this task · ? all keys` |
| An agent at work | `enter open this task's agent · space talk to the agent · ctrl+x stop the agent · ? all keys` |
| An agent asks you something | `space answer this task's agent · enter open the agent · ? all keys` |
| Ready to approve | `ctrl+l approve and merge this task · ctrl+r send the review to the agent · space talk to the agent · ? all keys` |
| Something went wrong | `ctrl+r tell this task's agent to fix it · ctrl+l retry as it is · space talk to the agent · ? all keys` |
| Stopped without a summary | `ctrl+r tell this task's agent to continue · ctrl+l use its work as it is · enter open the agent · ? all keys` |
| Talking to a task's agent | `enter open this task's agent · ctrl+x stop the agent · space back to the Coordinator` |
| Typing to the Coordinator | `enter send to the Coordinator · tab send, and put an agent on what it adds · shift+enter new line · esc put away` |
| The whole task | `… · ↑↓ scroll the task · esc back to the list` |
| The archive | `ctrl+a restore this task · ctrl+x remove this task · esc back to the board · ? all keys` |
| The automations | `space turn this automation off · tab run it now · ctrl+x remove it · enter open it · esc back to the board` |
| One automation, whole | `↑↓ pick a firing · enter go to its task · space turn this automation off · tab run it now · esc back to the list` |
| Find | `enter keep the filter · esc cancel` |
| The `?` menu | `↑↓ pick a key · enter press it · esc close the menu` |
| Words on their way to another machine | `ctrl+x stop sending this · enter take the words back to change · ? all keys` |

**In a narrow window the line never runs off the screen: whole hints give way.** The first one (the main thing) and
the last one (`? all keys`, or the way back) stay. Between them, `alt+c hide the latest message` goes first, then
the others from the last back; `alt+c show the latest message` outlasts those, because it is how you see a reply.
While you type, `shift+enter new line` goes first and `esc put away` stays. With room for only one hint it is the
main thing, except while you talk to a task's agent: there `space back to the Coordinator` stays, the one way back.
Where the window is too narrow even for that one hint, it is said shorter, not cut: `enter send`, `ctrl+l merge this
task`, `its agent` for `this task's agent`. That holds down to about 34 columns.

A question the board asks has its keys in its own box (`y = yes · n = no`), and the hint line is empty meanwhile. An
error stays on screen with `(esc dismisses)` after it.

**The key that opens the board is herdr's, not the board's**: it is a line in herdr's `config.toml`, offered at the
[first run](install.md) as `prefix+a`. The board never takes a key herdr binds itself (`prefix+w` is herdr's
workspace picker) or one your config already binds: it refuses it and says what the key does today.

Pressed again, the board key takes you back: on the board in its tab, to the pane you came from; with
`board.open` set to `popup`, it closes the popup ([the board](board.md)). herdr gives a popup every key, so there
the board reads that key itself, from herdr's `config.toml`: herdr's prefix key and then the key.

Restarting the Coordinator, starting a new one and going into its whole chat are not on the board: see
[the Coordinator](coordinator.md).

<!-- made:keys Made by `node scripts/docs.js` from src/board/keys.js. Do not edit between these two lines. -->
**Plain keys**

| Key | Does |
|---|---|
| `↑` `↓` | move between tasks |
| `Enter` | send what you typed; with nothing typed, open the task's agent: its real herdr pane. The board keeps running in its own tab and is there as you left it; your key goes back to it (as a popup it closes, and your key opens it again where it was) |
| `Space` | flip who you talk to: the selected task's agent, and back to the Coordinator. The chat says who. Nothing else changes it: while it is a task's agent, moving with `↑` `↓` makes it the agent of the task you moved to. On a task with no agent, your message puts one on it |
| `Tab` | put an agent on the task. With text typed for the Coordinator: send it, and every task it adds from that message gets an agent at once, with nothing more to confirm (a message that adds no task delegates nothing) |
| `Esc` | back, one step at a time, and nothing else: find is left, a draft is put away, then the whole task, the filter and the archive close. With none of those left it shows the same hint as `Ctrl+C`; the board as a popup (`board.open`) closes on it. It never shows or hides the chat and never changes who you talk to |
| `?` | the menu: every key in these three groups, each line with its key. A ctrl or alt line can be picked with `↑` `↓` and `Enter`, which does what its key does. Under the keys, what a row's `R#2` review tag and its colour say; where the window is too short for all of it, `↓` on the last line scrolls on down, and `↑` on the first scrolls up |
| `y` `n` | answer a question the board asks: `y` yes, `n` or `Esc` no. Only while a question is up; `Enter` never confirms |

**`Ctrl`: does something**

| Key | Does |
|---|---|
| `Ctrl+L` | yes, to whatever the task waits for: approve the merge (it asks first), say yes to the agent, retry the step that went wrong as it stands, or take work that stopped without a summary as it is |
| `Ctrl+R` | send it back: whatever went wrong (a failed check, a conflict, an error, a review with findings) goes to the task's agent to fix; a stopped agent is told to continue |
| `Ctrl+X` | stop the agent, when one is running (working, starting, checking, under review, or waiting for your answer); the selection stays on that row. On a task with no agent running (idle, never started, stopped, finished, archived) it asks to remove the task instead: `y` removes it, its worktree too. A task you marked as your own work in progress has no agent to stop: there the key puts it back in to do. A stop never goes on to that question by itself: removing takes a second `Ctrl+X`, and a `y` |
| `Ctrl+A` | archive the selected task, or restore it from the archive |
| `Ctrl+P` | pin the selected task to the top, or unpin it |
| `Ctrl+E` `Ctrl+U` | the selected task's settings, full screen: every work setting by its name, its value, and the place it comes from (this task, your entry for its repo, you, the repo's file, built in). `↑` `↓` move to a row; `Enter` changes it (a switch or a choice goes to its next value, anything else is typed and saved with `Enter`); rows that are this task's own are marked `*`. `Ctrl+U` puts the selected row back to what it would be without this task's own answer. `Esc` or `Ctrl+E` again goes back ([settings.md](settings.md)) |
| `Ctrl+N` | suggested tasks: asks about the selected task's first open suggestion, or goes to the first task that has one. In that question `y` makes it a task, `n` dismisses it and `Esc` leaves it for later ([suggestions.md](suggestions.md)) |
| `Ctrl+Z` | undo: bring back a draft that was put away, or take the last archiving back |
| `Ctrl+F` | find: type, and the list shows only the tasks that match, archived ones too. `Enter` keeps the filter, `Esc` leaves find; `Esc` on the list clears a filter that is kept |
| `Ctrl+C` | twice: close the board, with text typed too: the draft is kept and is back when the board reopens |

**`Alt`: only shows or hides**

| Key | Shows or hides |
|---|---|
| `Alt+C` | the chat's latest message, the Coordinator's or a task agent's. The one key for it, both ways |
| `Alt+U` `Alt+J` | more of a chat message that is longer than its box: `Alt+U` scrolls it up, `Alt+J` down, half a box at a time, also while you type. The box says where there is more, and names the key (`alt+u more ↑`, `alt+j more ↓`). The mouse wheel does the same with the pointer over the chat ([mouse.md](mouse.md)) |
| `Alt+P` | the side panel: the selected task, beside the list |
| `Alt+T` | the whole task, full screen, and back to the list |
| `Alt+A` | the archive, and back to the board |
| `Alt+O` | the automations, and back to the board: tasks made on a schedule or when something happens on the board, in a list of their own. There `↑` `↓` move between them, `Enter` opens the selected one (its prompt, its trigger, its settings, its firings: `↑` `↓` pick a firing and `Enter` goes to the task it made), `Space` turns it on or off, `Tab` fires it now, `Ctrl+X` removes it (it asks first) and `Ctrl+E` opens its settings, as a task's. What you type goes to the Coordinator, which makes and rewords them ([automations.md](automations.md)) |
| `Alt+S` | the list grouped by repo, or by status |
| `Alt+D` | every done task, or only the latest |
| `Alt+M` | other machines: this machine only, every machine, then each machine by itself |

**The text box's own** (not a key of the board, and not in the `?` menu)

| Key | Does |
|---|---|
| `Shift+Enter` | a new line in what you are typing. Like the cursor keys and backspace, it is the text box's own editing key, not a key of the board |
<!-- /made:keys -->
