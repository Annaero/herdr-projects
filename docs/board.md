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

While an agent works, the sentence is what it is doing. Around its turns the row says where it stands: `starting`
while the agent program comes up and has not begun (a new task never says anything else first), `about to continue`
when it has been sent something and has not picked it up yet, and `finishing` only when an agent that has worked has
stopped and the board is about to check its work.

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

`PR#18 ✓` means its checks pass, `✗` that they fail. A bare time is how long it has been working; `ago` is
since it stopped. A row never repeats what its heading says.

**The columns line up, whatever the width.** The columns on the right are laid out first, once for the whole list:
each has one place and one width on every row, so the bars, the percents, the minutes left, the `R#` tags, the PR numbers and the
times each stand under one another. The name and the sentence share what is left. When room is short, things give
way in a fixed order:

1. The sentence first (what the agent is doing, a question, how the review came out). It is cut, and with too
   little left to say anything it is not shown. It never takes room from a column and never moves one.
2. Then, only on a row whose name does not fit whole beside its columns, that row's columns, one at a time from the
   left: the bar, the percent with its minutes left, the `R#` tag, the PR number, and the time last. The columns a row keeps stay
   exactly where they are on the other rows. (No width takes the bars away by itself: a bar goes only for its
   own row's name. The word `ago` goes for the whole list at once, as soon as that lets some row keep a column
   other than its bar.)
3. The name last: it is cut only when nothing else is left on its row.

A row with no bar or PR of its own lets its words run on to its first column, not stop where another row's bar starts.

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
 ○ Coordinator  idle · claude · default model · default effort
 › file the undo task
 Filed proj/4: Add an undo. An agent is on it.
──────────────────────────────────────────────────────────────────────────────────────────────
❯ ask or tell it anything
──────────────────────────────────────────────────────────────────────────────────────────────
```

The chat's first line says who you talk to, and it is what herdr's sidebar says about that agent, drawn with the
board's own mark: the mark and colour of its state (the one its row has), its name in bold, and what it is doing now,
greyed. For a task's agent that is its row's sentence (the Watcher's "doing now" line, or where it stands when there
is none); for the Coordinator, where it stands and which program and model it runs on; for a task with no agent,
where your message goes. The name is never cut to make room: the status takes what is left and is cut with `…` (a
name longer than the window takes a second line; in a window too short for that, the draft keeps the line). The line
names no key: `Alt+C` is in the `?` menu and on the [keys](keys.md) page. The text box and its hints are never pushed off the window: the
chat gives way first. The
prompt is only `❯`. Under that line is the latest thing they said (their screen while a dialog is up). One key shows
and hides it, the same key both ways and the same for the Coordinator and a task's agent: `Alt+C` (on an empty text
box, like `Alt+P` for the side panel), and the board remembers which. Hidden, the line that says who you talk to stays, so a message is
never sent blind. Nothing else shows or hides it: `Esc` never does. A Coordinator that could not be started says why
even while the message is hidden; `Alt+C` puts that error away too, until the next one. The whole chat of a
task's agent is its own pane: `Enter`, with nothing typed, goes into it. Where the
Coordinator stands (starting, working, needs you, a new reply) is said on that first line and nowhere else.

**A board that looks cut off or half empty.** The board takes its pane's size back by itself within a few seconds:
the remote view described here is disconnected, and until then the board draws inside what herdr's window shows, so
its text box and hints are never cut off. What follows is what you see with the setting `ownTerminal` off, where the
view stays (the board has no key that disconnects it: closing that view, or turning the setting on, frees the
size). A remote view of the pane the board runs in (a `herdr terminal attach`,
which herdr's web UI starts for each pane it shows) sets that pane's size to its own and holds it for as long as it
runs, also after its browser tab is gone. herdr's own window then shows a cut-out of a board drawn for another size.
The board notices within ten seconds and says so on its first line, top left where a cut-out still shows it, with what frees the size first so a narrow window keeps it:

```
 ! Held at 435×58: kill 2884 frees it. Drawn for a remote view of this pane, so herdr's own window (184×78) shows it cut off or half empty · herdr terminal attach, open 40m
```

Closing that view, or stopping the process it names, gives the pane its own size back at once. The line is not shown
in the popup (which has no pane of its own), outside herdr, or in a tmux inside the pane.

While the text box holds text it owns the keyboard: only `Enter`, `Tab`, `Esc` and `Ctrl+C` act on the board, so no shortcut
fires in the middle of a draft. `Esc` puts a draft away; `Ctrl+Z` brings it back only to whoever it was for, so a reply
stays a reply. It never changes who you talk to: when the chat names somebody else, it says who the words were for
(the Coordinator: `Space` goes back to it; a task's agent: select that task, and `Space` if you talk to the
Coordinator), and the words stay put away until you are there.
