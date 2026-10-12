# The board: the list and the chat

**The list.** One line of header, then the tasks in five groups, in the order they need you:

| Group | Holds |
|---|---|
| `needs you` | a question, something that went wrong, a merge that failed |
| `ready to approve` | finished, reviewed work that waits for your yes |
| `working` | an agent or the reviewer is on it |
| `to do` | nobody has started it |
| `done` | finished, newest first |

Done is history, so it is last: however long it grows, it never pushes the to-dos down. First what waits for you
(`needs you`, `ready to approve`), then what is being worked on (the agent, the reviewer, the board's check), then
`to do`, then `done`. A pinned task stays on top, above all of them. Grouped by repo (`Alt+S`) each repo's rows follow
the same order, so a repo's done rows are below its to-dos. Only the latest five done tasks show; the line that
counts the rest (`… 73 more (? shows all done)`) is under them, at the bottom, and `Alt+D` shows them all. `↑` and
`↓` follow the order shown, and changing the grouping keeps the selected task selected. The archive (`Alt+A`) is a
list of its own, newest first, and no part of this order.

Each state has a mark of its own (`◐` working, `×` needs you, `✗` went wrong, `✓` done or ready, `○` to do), so no
two are told apart by colour alone (herdr's `status_indicators = "dots"` brings its dots back). A row reads: the
name, then on the right two groups with a wider gap between them: the progress (the bar, the percent and the minutes
left), and then the review, the pull request and the time:

```
 ready to approve
 ✓ Add an undo for clear                                             R#2 PR#18 12m ago
   Fail · 1 critical, 1 major
 working
 ◐ Tidy the first-run questions                           ███░░░░░  40% 12m    R#1 PR#17    5m
   Running the tests
 done
 ✓ Blue while the reviewer works                                     R#1 PR#76  1h ago
```

**A live task's row is two lines.** Live is every task under `needs you`, `ready to approve` and `working`: an agent,
the reviewer or the board's own check is on it, or it waits for you. The first line is the mark, the name and the
columns. The second is what the task says, greyed, under the name and starting where the name starts: what it is
doing now, how its review came out with a short tally of what it found (`Pass · 2 minor`, `Fail · 1 critical, 1
major`, the result in its own colour), or what it waits for. While the reviewer works, it says only what the reviewer
is doing. In the all-machines view, where a machine's name sits before a task's, the second line still starts under
the task's name, right of the machine's. That line has the row's whole width, so it is rarely cut; one longer than the window is cut at its end with
`…`, never wrapped.

A done or to-do task has nothing to say and keeps one line, so that many of them show at once. (A to-do task that
carries a note says it after its name, on that one line.)

The second line is there from the start, so a row does not grow, and nothing under it moves, when its words arrive.
Until then a working task has a quiet `…` on it: its words are on their way. A task that waits for you with nothing
to say (ready to approve with no review) has an empty line: nothing is coming, and `…` would say something is.

The highlight of the selected task covers all its lines. `↑` and `↓` go task by task, never onto a second line.

**On a narrow screen a live task's row is three lines.** On a phone (about 50 columns) the name leaves no room
beside it, so the bar, the percent, the minutes left, the review tag and the pull request used to be hidden. Under 80
columns they have a line of their own, the third:

```
 working
 ◐ Third row line on narrow screens for progress
   Writing the tests for the third line
   █████░░░░░░░░░░░░░   35%  14m              9m
 ◐ Show progress while the board runs the check
   Reviewing progress display fix against earli…
   ███████████░░░░░░░   62%   4m  R#2 PR#82  38m
 ◐ Grey out review tag and time once merged
   …
                                             20s
```

- **Line 1** is the mark and the name, with the whole width: a name is cut only at the screen's edge.
- **Line 2** is what the task says, as on a wide screen.
- **Line 3** is, in this order, the bar, the percent, the minutes left, the `R#` tag, the pull request and the time,
  in their usual colours. It starts right of the mark and ends at the right edge (in the all-machines view too, where
  it does not move right under a machine's name: a long one would leave it no room). Each of them is as wide as the widest
  of its kind on the list, so they start under each other on every live row, and the bar takes all the room that is
  left: every bar is the same length, and the line fills the width. The time ends at the edge with the word `ago`
  or without it.
- A task with nothing to show yet (no progress, no review, no pull request) still has its time there, so every live
  row is the same height and nothing moves when its first percent arrives.
- Done and to-do rows stay one line, with their columns beside the name as before.

**Where it switches: 80 columns of screen.** At 80 a name of 40 cells (what a name keeps before a column goes,
below) sits beside every column at its widest: the mark (3), the name (40), the bar (8), the percent (4), the minutes
left (4), `R#12` (4), `PR#123` (6), the time (3) and the gaps between them (8). Narrower than that, line 1 always
goes without something, so the columns move down; from 80 on the row is the two lines it was, and nothing changes.
It is the screen's width that is counted, never the names or the numbers on it: all live rows switch together, and
no row changes height when a task is renamed or gets a pull request. And it is the whole screen, not the list: a
list made narrow by the task panel beside it, on a wide screen, keeps two-line rows (the panel shows the rest).

In a width too small even for the third line (under 38 columns with every column there) things go in this order:
the word `ago`, the bar, the `R#` tag with the pull request, the percent with the minutes left. The time stays.

**A list taller than the window.** The done rows give way first: the list shows the latest five of them, and when it
still does not fit, one fewer for each line it is short, down to the newest one (the line under them says how many
more there are, and `?` has the key that shows all of them). Then the to-dos, from the last one up, down to the
first, with a line under them that counts the rest (`… 4 more to do`). So the live tasks, which are the ones that
need your eye, stay on the screen, also on a phone where each takes three lines. The task you have selected is never
folded away, and nothing is while you search or have asked for all done.

A to-do that gave way is still one `↓` away: the arrow keys go through every to-do, and the ones that show are then
the ones that end at the selected task. To-dos give way only on a list that has live tasks: with none there is
nothing to keep in view, and the list scrolls as it always did, with no line spent on a count.

Only when the list is still too tall does it scroll, and then by whole rows: a row of two or three lines is never
shown in part. Its lines come into view together, and where only some would fit at the bottom those lines are left
empty. (In a list squeezed to a single line, the selected task shows its name.)

**Each colour has one meaning.** Amber: the agent is working. Blue: the reviewer is working. Green: it passed and is
ready for you. Red: it failed, or it needs you. For as long as the reviewer works, the row's mark, its bar, the
percent, the minutes left and the `R#` tag are blue, and so are the same things in the task panel, on the details
screen and on the chat line. So a blue `◐` with a bar says a review is running, an amber one that the agent is at
work, and a green `✓` that the task is ready for you. A group's heading keeps the colour of its group: a task under
review is filed under `working`.

The blue is the theme's own `blue` where that one is told apart from everything it sits beside: the theme's green,
its red, its amber, the light blue of herdr's own dot for done and idle (its `teal`), muted text, plain text and the
background. In many themes it is not (Dracula's blue is its teal, Rosé Pine's its green, Catppuccin's a pale one near
its muted text): there the board uses a blue of its own, `#3b82f6`, which reads on a dark and on a light background
alike. Colours you set yourself (`[theme.custom]`) are held to the same rule: a `blue` that is your red, or that is no
blue at all (a green, a purple, a grey), is not used,
and where the board's blue is too near one of your colours it takes another blue that is not. With the terminal's own
colours it is the terminal's blue.

`R#2` is the review the task is on, or the last one it had. It belongs to the pull request, not to the progress: it
sits one cell left of the `PR#`, and the tags end under each other down the list. Its colour says how that review
went, and it has no mark beside it: green, it passed; red, it failed, and it stays so while the agent fixes what
the review found; blue, the reviewer is on it right now, whatever the review before it said. The three are told apart
in the light themes and the dark ones alike. A review from before the gate goes by its advice. Once the task is
merged (through its pull request, or here on this machine with none) the tag goes quiet, the same grey as its merged `PR#` tag: nearly every done task passed its review, and a
column of green says nothing. One stays red: a task merged although its last review failed (you approved it anyway),
the only one worth noticing later. The task panel and the details page do the same with how each review went, and so
does the archive. A
task that was never reviewed has no tag. Every row that has had a review keeps it: under review, back with the
agent, waiting for your yes, done.

**When the window is narrow, rows hide the same things together.** What is shown is decided for one group at a time
(the rows under one heading: `working`, `done`, ...), never row by row: each thing is on every row of the group that
has it, or on none. So if one name under `working` leaves no room for a bar, no row under `working` has a bar. A
long name under `done` costs `working` nothing, and the columns still start at the same place down the whole list.
(On a screen under 80 columns a live row's columns are on its third line, above: what follows is then about the
one-line rows.)

Things give way in this order, first to last, and the name wins over all of them:

1. what one-line rows say after their name (a to-do task's note): each is cut to its own room, and when one of them
   has not even 20 cells (or its whole length, when that is less), none of the group's rows says anything. A live
   task's words are on its second line and take no part in this;
2. the bar;
3. the word `ago`, on the whole list at once since it sits right of every column: it goes when that keeps a column
   other than a bar, or cuts a name less, somewhere on the list;
4. the end of a name longer than 40 cells: it is cut with `…`, down to 40, before its group loses a column;
5. the percent and the minutes left, together;
6. the `R#` tag and the pull request, together: a review is never shown without its pull request, nor the other
   way round;
7. the time;
8. the rest of the name.

Step 4 is why one long title does not cost a whole group its columns: a title is at most 60 characters
([titles](titles.md)), so it loses a third at the very most, and a name of 40 cells or fewer is never cut while a
column shows. A name is never cut for a bar.

With what a live task says on a line of its own, its name is alone beside the columns, so they fit far more often: a
title is at most 60 characters, and from 110 columns on every live row has all of them, the bar too, whatever its
name (before, a bar needed a short name or a much wider window, and what the row said was nearly always cut). The
order above was looked at again with that in mind and is unchanged: the bar is still what a row can best do without,
since the percent beside it says the same.

What is shown does not jump as the numbers tick: the minutes left are counted at their widest, four cells, when
this is decided, so `9m` turning into `10m` hides nothing. They are never wider: from a thousand minutes on a row
shows them as hours (`17h`). A name is drawn in the room counted that way too, so it is not cut at another place
from one minute to the next.

`PR#18` is the pull request, and its colour says how its checks went, by the same rule as the `R#` tag and with
no mark beside it: green, they pass; red, they fail; plain, there is no result yet (they are running, or there are
none). A merged pull request goes quiet, grey like the time beside it: nothing there needs your eye, so a list of
done tasks is not a wall of green. The greens and reds are the theme's own, the ones the `R#` tag uses, and the
three are told apart in the light themes and the dark ones alike. The task panel and the details page colour it
the same way. A bare time is how long it has been working; `ago` is
since it stopped. On a finished task the time is quiet like its merged tags, in the very same grey: a done task has
nothing live about it, so its whole right-hand side (review tag, pull request, time) is quiet, and a bright colour
on the board means "this is happening now". That grey is the theme's own for greyed-out words, easy to read in the
light themes and the dark ones. The time of a task that is not done is drawn as it always was. A row never repeats what its heading says.

**While the board runs the check itself** (at the finish line, and again after a catch-up with main), the row shows
real progress, not the Watcher's guess: the bar and the percent are the count the check reports, the minutes left
come from how long its last full runs took on this machine. How a check reports, and what a repo's own check can
do: [the check's progress](check-progress.md).

```
 ◐ Add a greeting                                    █████░░░  65%  3m       9m
   running the check · tests 31 of 47
 ◐ Fix the footer                                                     6m       2m
   waiting for its turn · 2 ahead
```

- While it waits its turn (one test run at a time on a machine) the row says how many are ahead and shows the
  minutes, with no bar: nothing of its own moves yet.
- Code that passed already is answered at once: `the check already passed for this exact code`, no bar, and on it goes.
- A check that reports no count shows the time it has run against last time (`running the check · 2m of about 5m`),
  and never a percent.
- When nothing moves for far longer than a run takes, the row says so: `the check stands still · nothing finished for
  13m · tests 31 of 47`, `waiting for its turn unusually long · …`, `the check runs far longer than usual · …`.
- Its colour is its own: the mark, the bar, the percent and the minutes left are a plain light grey (the theme's
  `subtext0`) while the board checks, so the agent's amber, the reviewer's blue and the board's grey read apart.

The same line, bar, percent and minutes show in the task panel, on the details page, on the chat line and in
herdr's sidebar, and the rows of a section still give the same things up together.

On the chat line the bar, the percent and the minutes left stand right after the words, in the row's colour, for
the task whose agent you talk to, while the board runs its check. They are never cut: when the
line is short the words are cut first (down to twenty cells), then the bar goes, then the numbers.

**One chat, at the bottom.** The text box is a chat, and it is the same chat whoever you talk to. It always talks to
someone and always says who: the Coordinator, until `Space` (on an empty text box) flips it to the selected task's
agent; `Space` again flips it back. Ask it something, tell it to do something, or just say what needs doing.

The arrow keys only move the selection; they never change who you talk to. While you talk to a task's agent the
chat follows the selection: move to another task and you talk to that task's agent, with its latest message shown.
A task with no agent to talk to is still named, with where your message goes instead: it starts an agent on a task
that is to do, goes to the Coordinator about that task otherwise, and an archived task is read-only. With no task
selected (words on their way to another machine, an empty list) the chat names the Coordinator until a task is
selected again. If the task you talk to goes away (removed), you are back with the Coordinator, never on
to a neighbour's agent.

```
 ○ Coordinator  idle
╭────────────────────────────────────────────────────────────────────────────────────────────╮
│ Added proj/4: Add an undo. An agent is on it.                                              │
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
  `❯`). Nothing else is in it. A long message wraps, and the box grows with it: it takes the lines the message
  needs, up to two thirds of the window, and shrinks back for a short one. The list above gives up those rows and
  keeps the selected task in view. (Under the whole task, `Alt+T`, and the `?` menu, which are there to be read
  themselves, the message keeps to a third of the window.) While a dialog is up on their screen, the box shows that
  screen instead.
- **One greyed hint line under the box**, with only the keys that do something right now. While you type, it says
  what the keys do with your words (`enter send · tab send, and put an agent on it · esc put away · shift+enter new
  line`). In a narrow window the keys between the first and the last go first, the chat's own key last of them.

**A message longer than its box scrolls.** `Alt+U` scrolls it up and `Alt+J` down, half a box at a time (U sits
above J on the keyboard); the mouse wheel does the same with the pointer over the chat ([the mouse](mouse.md)). Both
work while you type, and neither touches the draft. The box says where there is more and names the key: `alt+u more
↑` on its top edge, `alt+j more ↓` at the right of the line under the message (in a narrow window only `more ↓`, then
only the arrow).

```
 ● Coordinator  idle
╭───────────────────────────────────────────────────────────────────────────── alt+u more ↑ ─╮
│ 3. The check fails on main too: it is not this task's change.                              │
│ 4. I filed proj/7 for it and put an agent on it.                                           │
│                                                                               alt+j more ↓ │
│ ❯ ask or tell it anything                                                                  │
╰────────────────────────────────────────────────────────────────────────────────────────────╯
```

A new message starts at its beginning: an answer is read from its first line down, and one key goes on from there
(started at its end, you would scroll up to find where it begins and then down again to read it). Only a screen, shown
while a dialog is up or for a program whose conversation cannot be read, starts at its end, where a terminal has what
is new. Where you scrolled to is kept while the same message of the same chat shows; a new message (also one in the
very same words as the last), your own words in its place, or another chat starts over.

A tall draft never takes the message away: in a window too small for both, the draft gives rows back and scrolls
inside what it keeps, so that three lines of the message stay (one, in a window of eight rows), and they still scroll.

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

**A board that looks cut off or half empty.** (What changes the board's size at all, and why a size that lasts a
moment is not drawn for: [the board's size](board-size.md).) The board takes its pane's size back by itself within a few seconds:
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
