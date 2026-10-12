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
 ✓ Add an undo for clear  Fail · 1 critical, 1 major               R#2 ✗ PR#18 12m ago
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

**When the window is narrow, rows hide the same things together.** What is shown is decided for one group at a time
(the rows under one heading: `working`, `done`, ...), never row by row: each thing is on every row of the group that
has it, or on none. So if one name under `working` leaves no room for a bar, no row under `working` has a bar. A
long name under `done` costs `working` nothing, and the columns still start at the same place down the whole list.

Things give way in this order, first to last, and the name wins over all of them:

1. what the rows say: each is cut to its own room, and when one of them has not even 20 cells (or its whole
   length, when that is less), none of the group's rows says anything;
2. the bar;
3. the word `ago`, on the whole list at once since it sits right of every column: it goes when that keeps a column
   other than a bar, or cuts a name less, somewhere on the list;
4. the end of a name longer than 40 cells: it is cut with `…`, down to 40, before its group loses a column;
5. the percent and the minutes left, together;
6. the `R#` tag;
7. the pull request;
8. the time;
9. the rest of the name.

Step 4 is why one long title does not cost a whole group its columns: a title is at most 60 characters
([titles](titles.md)), so it loses a third at the very most, and a name of 40 cells or fewer is never cut while a
column shows. A name is never cut for a bar.

What is shown does not jump as the numbers tick: the minutes left are counted at their widest, four cells, when
this is decided, so `9m` turning into `10m` hides nothing. They are never wider: from a thousand minutes on a row
shows them as hours (`17h`). A name and what the row says are drawn in the room counted that way too, so neither
is cut at another place from one minute to the next.

`PR#18` is the pull request, and its colour says how its checks went, by the same rule as the `R#` tag and with
no mark beside it: green, they pass; red, they fail; plain, there is no result yet (they are running, or there are
none). A merged pull request goes quiet, grey like the time beside it: nothing there needs your eye, so a list of
done tasks is not a wall of green. The greens and reds are the theme's own, the ones the `R#` tag uses, and the
three are told apart in the light themes and the dark ones alike. The task panel and the details page colour it
the same way. A bare time is how long it has been working; `ago` is
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

**Going into an agent never ends the board.** `Enter` on a task, with nothing typed, moves herdr to that agent's
real pane; it is the same from the row, with the chat hidden, and while the chat talks to that agent. The board keeps
running: come back to it, or press the key you gave the board, and it is as you left it, the same repo, the same task
selected, the same filter and draft. While you are away the selection stays on that task, also when its agent stops or
finishes and the task moves to another group or no longer matches what you searched for (its row stays until you move
on).

The key opens the board in a herdr tab of its own, named `board`, in the space you are in, and from then on goes to
that running board from anywhere instead of opening a second one. A board you started yourself in a pane
(`herdr-superwork` typed there) is found the same way, and the key puts the keyboard on it also when an agent's pane
is split beside it in the same tab. Closing the board (`Ctrl+C` twice) closes its tab. Outside a herdr client (plain
SSH) the terminal becomes the agent's until you detach, and the board is back.

The board is not herdr's popup, and that is on purpose: a popup lies over every pane of its tab, so it has to close
to show an agent, and for as long as one exists, shown or hidden, no other plugin's popup can open. (Opened as a popup
by hand, `herdr plugin pane open ... --placement popup`, the board still works: it closes when you go into an agent
and reopens where you left it.)

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
outside herdr, in a tmux inside the pane, or in a popup (which has no pane of its own).

**The board's tab is named `herdr-superwork`.** Run `herdr-superwork` in a terminal inside herdr and the tab that
terminal is in gets that name for as long as the board is open, so you can tell it from your other tabs. Only that
one tab is renamed. When the board closes (also when it closes to take you into an agent) the tab gets back the name
it had before; a name you gave it yourself while the board was open is kept. A board that was killed leaves the
name, and the next board that opens and closes in that tab puts the old one back. Nothing is renamed in the popup
(it has no tab of its own), in the tab your board key opens (that one is named `board`, above), outside herdr, in a tmux inside the pane, or by a subcommand that opens no board (`add`,
`list`, `config` and the rest). The code is `src/board/tab.js`.

While the text box holds text it owns the keyboard: only `Enter`, `Tab`, `Esc` and `Ctrl+C` act on the board, so no shortcut
fires in the middle of a draft. `Esc` puts a draft away; `Ctrl+Z` brings it back only to whoever it was for, so a reply
stays a reply. It never changes who you talk to: when the chat names somebody else, it says who the words were for
(the Coordinator: `Space` goes back to it; a task's agent: select that task, and `Space` if you talk to the
Coordinator), and the words stay put away until you are there.
