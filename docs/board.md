# The board: the list and the chat

**The list.** One line of header, then the tasks in five groups, in the order they need you:

| Group | Holds |
|---|---|
| `needs you` | a question, something that went wrong, a merge that failed |
| `ready to approve` | finished, reviewed work that waits for your yes |
| `working` | an agent or the reviewer is on it |
| `done` | finished, newest first |
| `to do` | nobody has started it |

Each state has a mark of its own (`◐` working, `×` needs you, `✗` went wrong, `✓` done or ready, `○` to do), so no
two are told apart by colour alone (herdr's `status_indicators = "dots"` brings its dots back). A row reads: the
name, a sentence, then on the right the progress bar, the percent and the minutes left, the review, the pull request, and the time:

```
 ready to approve
 ✓ Add an undo for clear  Fail · 1 critical, 1 major             R#2 ✗ PR#18 ✓ 12m ago
 working
 ◐ Tidy the first-run questions  Running the tests           ███░░░░░  40% 12m R#1   PR#17    5m
```

The row says how the review came out and a short tally of what it found (`Pass · 2 minor`, `Fail · 1 critical, 1 major`). While the
reviewer works, the mark, the bar, the percent and the minutes left are the green of `ready to approve` (the same holds in the task panel, on the details screen and on the chat line): a green `◐` with a bar says a review is running, a green `✓` that it is ready for you,
and the sentence says only what the reviewer is doing.

`R#2` is the review the task is on, or the last one it had, in a column of its own left of the pull request. A mark
beside it, like the pull request's, says how that review went, and the colour repeats it: `R#2 ✓` in green, it
passed; `R#2 ✗` in red, it failed, and it stays so while the agent fixes what the review found; `R#2` with no mark,
in the row's review colour, the reviewer is on it right now: that colour is now a green too, so the mark is what
tells a running review from one that passed. A review from before the gate goes by its advice. A
task that was never reviewed has no tag. Every row that has had a review keeps it: under review, back with the
agent, waiting for your yes, done.

A window too narrow for a row's name takes that row's columns away one at a time, so the name stays readable: the
bar, the word `ago`, the minutes left, the percent, the `R#` tag, the pull request and, last, the time.

`PR#18 ✓` means its checks pass, `✗` that they fail. A bare time is how long it has been working; `ago` is
since it stopped. A row never repeats what its heading says.

**One chat, at the bottom.** The text box is a chat, and it is the same chat whoever you talk to. It always talks to
someone and always says who: the Coordinator, until `Space` (on an empty text box) flips it to the selected task's
agent; `Space` again flips it back. Ask it something, tell it to do something, or just say what needs doing.

The arrow keys only move the selection; they never change who you talk to. While you talk to a task's agent the
chat follows the selection: move to another task and you talk to that task's agent, with its latest message shown.
A task with no agent to talk to is still named, with where your message goes instead: it starts an agent on a task
that is to do, goes to the Coordinator about that task otherwise, and an archived task is read-only. With no task
selected (words on their way to another machine, an empty list) the chat names the Coordinator until a task is
selected again. If the task you talk to goes away (deleted, cleared), you are back with the Coordinator, never on
to a neighbour's agent.

```
──────────────────────────────────────────────────────────────────────────────────────────────
 ○ Coordinator  idle  claude · default model · default effort    alt+c open its chat · alt+v hide its message
 › file the undo task
 Filed proj/4: Add an undo. An agent is on it.
──────────────────────────────────────────────────────────────────────────────────────────────
❯ ask or tell it anything
──────────────────────────────────────────────────────────────────────────────────────────────
```

The chat's first line says who you talk to, on the whole width of the window: the Coordinator, or the task by its
full name with where it stands and which agent is on it (a name longer than the window takes a second line; in a
window too short for that, the draft keeps the line). The text box and its hints are never pushed off the window: the
chat gives way first. The
prompt is only `❯`. Under that line is the latest thing they said (their screen while a dialog is up). One key shows
and hides it, the same key both ways and the same for the Coordinator and a task's agent: `Alt+V` (on an empty text
box, like `Ctrl+P` for the side panel), in a narrow window too (where the key does not fit beside the name, the
hint line says it), and the board remembers which. Hidden, the line that says who you talk to stays, so a message is
never sent blind. Nothing else shows or hides it: `Esc` never does. A Coordinator that could not be started says why
even while the message is hidden; `Alt+V` puts that error away too, until the next one. `Alt+C` goes into the whole
chat of whoever it names. Where the
Coordinator stands (starting, working, needs you, a new reply) is said on that first line and nowhere else.

**A board that looks cut off or half empty.** The board takes its pane's size back by itself within a few seconds:
the remote view described here is disconnected, and until then the board draws inside what herdr's window shows, so
its text box and hints are never cut off. What follows is what you see with the setting `ownTerminal` off, where the
view stays and `Alt+W` disconnects it. A remote view of the pane the board runs in (a `herdr terminal attach`,
which herdr's web UI starts for each pane it shows) sets that pane's size to its own and holds it for as long as it
runs, also after its browser tab is gone. herdr's own window then shows a cut-out of a board drawn for another size.
The board notices within ten seconds and says so on its first line, top left where a cut-out still shows it, with what frees the size first so a narrow window keeps it:

```
 ! Held at 435×58: alt+w, or kill 2884 frees it. Drawn for a remote view of this pane, so herdr's own window (184×78) shows it cut off or half empty · herdr terminal attach, open 40m
```

Closing that view, or stopping the process it names, gives the pane its own size back at once. The line is not shown
in the popup (which has no pane of its own), outside herdr, or in a tmux inside the pane.

While the text box holds text it owns the keyboard: only `Enter`, `Tab` and `Esc` act on the board, so no shortcut
fires in the middle of a draft. `Esc` puts a draft away; `Ctrl+Z` brings it back only to whoever it was for, so a reply
stays a reply. It never changes who you talk to: when the chat names somebody else, it says who the words were for
(the Coordinator: `Space` goes back to it; a task's agent: select that task, and `Space` if you talk to the
Coordinator), and the words stay put away until you are there.
