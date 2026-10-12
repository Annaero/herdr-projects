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
name, a sentence, then on the right the progress bar, the percent and the minutes left, the pull request, and the time:

```
 ready to approve
 ✓ Add an undo for clear  Fail · 1 critical, 1 major · 2nd review   PR#18 ✓ 12m ago
 working
 ◐ Tidy the first-run questions  Running the tests           ███░░░░░  40% 12m PR#17    5m
```

The row says how the review came out and a short tally of what it found (`Pass · 2 minor`, `Fail · 1 critical, 1 major`). Which review it was shows only from the second on. While the
reviewer works, the mark, the bar, the percent and the minutes left take a colour no other state uses: that alone says a review is
running, and the sentence says only what the reviewer is doing. `PR#18 ✓` means its checks pass, `✗` that they fail. A bare time is how long it has been working; `ago` is
since it stopped. A row never repeats what its heading says.

**One chat, at the bottom.** The text box is a chat, and it is the same chat whoever you talk to. One rule decides
who that is: press `Space` on a task and you talk to that task's agent; otherwise you talk to the Coordinator. Ask it
something, tell it to do something, or just say what needs doing.

```
──────────────────────────────────────────────────────────────────────────────────────────────
 ○ Coordinator  idle  claude · default model · default effort    alt+c open its chat · esc hide its message
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
prompt is only `❯`. Under that line is the latest thing they said (their screen while a dialog is up): `Alt+V` hides
it and shows it again, in a narrow window too (where the key does not fit beside the name, the hint line says it),
and the board remembers which. `Esc` hides it too, as its first step back (with nothing typed): while the message is up, `Esc` does only that, and the chat's line names `esc` as the key. A Coordinator that could not be started says why even while the message is hidden; `Esc` (or `Alt+V`) puts that error away too, until the next one. `Alt+C` goes into the whole chat of whoever it names. Where the
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
fires in the middle of a draft. `Esc` puts a draft away; `Ctrl+Z` brings it back to whoever it was for, so a reply
stays a reply.
