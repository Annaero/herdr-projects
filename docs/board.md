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
 ○ Coordinator  idle
╭────────────────────────────────────────────────────────────────────────────────────────────╮
│ Filed proj/4: Add an undo. An agent is on it.                                              │
│                                                                                            │
│ ❯ ask or tell it anything                                                                  │
╰────────────────────────────────────────────────────────────────────────────────────────────╯
  type what needs doing · alt+c hide the chat · ? more
```

The chat is three things, and looks the same for the Coordinator and for a task's agent, at every window width:

- **One line that says who you talk to**: the board's own mark for where they stand (the mark the task's row has),
  the name in bold, and one greyed line: what the task's row says (the Watcher's "doing now" line) or where it stands,
  for the Coordinator `idle`, `working`, `needs you`, `new reply`, and how many of your messages still wait to be
  sent. It is cut with `…` where it does not fit; the name is never cut to make room for it (a name longer than the
  window takes a second line; in a window too short for that, the draft keeps the line). No program, model or effort
  is named there, and no keys. (One thing gets a greyed line of its own under it: a default that changed while a
  Coordinator runs, with the command that starts a new one on it.)
- **One rounded box**: their latest message in grey, an empty line, and the line you type on (the prompt is only
  `❯`). Nothing else is in it. A long message wraps; it takes at most eight lines, and only lines the list can spare,
  and is cut with `…` (an agent's message keeps its end, where it asks or concludes). While a dialog is up on their
  screen, the box shows that screen instead.
- **One greyed hint line under the box**, with only the keys that do something right now. While you type, it says
  what the keys do with your words (`enter send · tab send, and put an agent on it · esc put away · shift+enter new
  line`). In a narrow window the keys between the first and the last go first, the chat's own key last of them.

**What you just sent takes the message's place.** Send something and the box shows your words, in the bright text
colour, where the agent's message was, over an empty line to type on. The old message is never shown under them. When
the agent says something new, that takes their place, in grey (also when it answers in the very same words as before). For the Coordinator this holds when the board is
closed and opened again; for a task's agent, for as long as the board stays open.

```
 ○ Coordinator  idle
──────────────────────────────────────────────────────────────────────────────────────────────
❯ ask or tell it anything
──────────────────────────────────────────────────────────────────────────────────────────────
  type what needs doing · alt+c show the chat · ? more
```

One key shows and hides the message, the same key both ways and the same for the Coordinator and a task's agent:
`Alt+C` (on an empty text box, like `Alt+P` for the side panel); the hint line names it, and the board remembers
which. Hidden, there is only the line that says who you talk to and the line you type on, between two thin rules: a
message is never sent blind. Nothing else shows or hides it: `Esc` never does. A Coordinator that could not be
started says why even while the message is hidden; `Alt+C` puts that error away too, until the next one. The whole
chat of a task's agent is its own pane: `Enter`, with nothing typed, goes into it. Someone who has no message to show
(a task with no agent on it, the board with no Coordinator) gets the plain line between two rules, whether the chat is
hidden or not. The text box and its hints are never pushed off the window: the message gives way first. In a very
narrow window the box stays whole: the message wraps inside it, and a placeholder that does not fit is cut with `…`.

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
