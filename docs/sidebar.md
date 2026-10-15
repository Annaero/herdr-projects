# herdr's sidebar: a small copy of the board's rows

What herdr's sidebar says about an agent is what that task's row on the board says, in the same words, but only its
short marks and numbers: not the row's second line, what the agent says it does. One entry per live agent: a task's
agent, its reviewer while a review runs, and the Coordinator. A task nobody is on (to do, done and cleaned up) has no
pane in herdr and so no entry.

## The three rows of an entry

```
 ◐ HSW-152 Show automations in the m…      1. herdr's dot, the task's number and title
   agent · working · R#1 PR#113 · 6m       2. who is on it, where it stands, review round, pull request, tags, time
   8% 16m                                  3. the percent and the time to go
```

1. **herdr's dot, then the task's number and title**, as on the row: `HSW-152 …`, its repo's key and its number
   ([task numbers](task-numbers.md)). The number comes first and herdr cuts a row at its end, so a narrow
   sidebar cuts the title, never the number. The machine's name stands before it only where the sidebar shows more
   than one machine: that is herdr's own `machine` token.
2. **Who is on it and where it stands**, from the one list of status words (`crates/core/src/status_words.rs`):

   | The row on the board | Row 2 of the entry | |---|---| | `◐` the agent works | `agent · working` | | `◑` under
   review | `reviewer · under review` on the reviewer's entry, `agent · under review` on the agent's | | `◇` the board
   starts it, sets up, checks, pushes, merges, or waits on the way (its check's turn, its turn to merge, GitHub's
   checks) | `board · starting`, `board · setting up`, `board · checking`, `board · pushing`, `board · merging` | | `◌`
   waits for a free slot, `Q#2` | `queued`, and row 3 says `Q#2`: its place in the queue where a task at work has its
   percent | | `◌` queued after other tasks ([one task after another](after.md)) | `queued after SKL-6` | | `?` asks you | `asks you` | | `!` asks for your OK | `asks for your OK` | | the sign-in mark | `needs a
   login` | | `◆` passed, waits for your yes | `ready to approve` | | `!` its review failed | `review failed` | | `×`
   went wrong (a failure, a merge or a pull request that failed) | `went wrong` | | finished, but its branch cannot be
   brought up to date | `behind main` | | waits for you, with no kind (a reviewer's dialog, stopped without a summary) |
   `needs you` | | stopped, put back | `to do` | | done, while its space is still open | `done` |

   Somebody is named only while somebody is on it: a task that waits says what it waits for. Then the review round
   and the pull request as the row writes them (`R#1 PR#113`), the task's tags (`[research]`, `[auto]`), and last
   the row's time: `6m` for how long it has worked, `2m ago` for since when it waits. By the minute (`<1m` before
   the first): herdr shows what it was last told, and the board does not write to it every second. It stands last,
   so it is the first thing a narrow sidebar cuts.
3. **The row's numbers on the right, bare**: the percent (or the place in the queue) and the time to go, where the
   row shows them: `8% 16m`, `20h` from a thousand minutes on. Never the word `left`: the sidebar is narrow, and a
   number after a percent can only be the time to go. Not the row's second line: what the agent says it does
   (`Reading the list code`, the question itself) is on the board; row 2 already says where it stands, so the
   sidebar keeps to the short marks. Empty when the row has no numbers.

**The reviewer's entry** names the task the same way and has `reviewer` as who. While a review runs the task has two
entries, and each names the agent it stands for: `reviewer · under review` is the reviewer's pane, `agent · under
review` the pane of the agent whose work is reviewed. The rest of their words is the same, and the dot of each is
its own.

**The Coordinator** is named `Coordinator` and stands as the line above the board's box says: `Coordinator · idle`,
`Coordinator · working`, `Coordinator · asks you`, with what waits to go in (`· 1 message waits to be sent`) and its
latest message under it. herdr's own words for it would be `sw-coordinator` and `done`.

**The spaces part** follows the same rule: a task's space is named with the task's number and title
(`HSW-152 Show automations…`), and under it stand the row's percent and time to go. A task that waits for you to
pick one of its attempts has none: its attempts' entries say `pick one`.

## What is herdr's own

- **The dot is herdr's**, in herdr's colours: its own reading of the pane (working, idle, done, blocked). The board
  writes no state to herdr. Telling herdr a task is blocked makes herdr stop watching the pane
  ([what was checked](checked-on-herdr.md)), so a task that asks you has herdr's done or idle dot, and the words
  beside it say exactly where it stands.
- **The cutting is herdr's.** herdr shares a row's width between its values and ends a cut one with `…`. At its
  default width of 26 cells a long row is cut; `sidebar_width = 36` under `[ui]` in herdr's
  config shows more. herdr keeps at most 80 characters of any value: a longer line is cut by the board, with `…`.

## How it gets there

The board keeps one writer for all of it (`crates/flow/src/flow/sidebar.rs`), and that writer has no words of its own:
it draws the task's row with the board's own code, without colours (`crates/flow/src/flow/sidebar_entry.rs`). Whoever
ticks, the keeper or an open board, writes an entry once a second when a word of it changed: as often as the board draws
its own rows again. Where a task comes to wait for you, goes wrong, is taken up again or ends, whatever did that writes
the entry at once, without waiting for the tick. The Watcher and the check only keep what they find on the task ([the
Watcher](watcher.md), [the check's progress](check-progress.md)); they write nothing to herdr themselves, so no two
writers fight over one line.

herdr keeps none of this when its server is started again. The board notices on its next tick, by herdr's own reading
of the pane (the shown name it wrote is gone), and writes every entry of that herdr again, whether a word changed
or not.

Nothing stale is left: what was written is replaced, never left to run out. A task that is stopped, done or moved on
gets its new words at once, or within the second; an entry goes with its pane (herdr drops what was written about a pane
that closed); and a task that is archived or removed while its pane lives on has the board's words taken off it.

It is written as herdr's display metadata (`herdr pane report-metadata`, `herdr workspace report-metadata` and the
space's name), from the source `plugin:herdr-projects`: row 2 is the agent's shown name, row 3 the token `progress`.
The token `summary` is only the Coordinator's: on a task's pane and space it is cleared, so a line an older version
wrote goes by itself.

## With and without the plugin's sidebar rows

herdr's default sidebar shows a space's name, the tab's name and the agent's shown name, and no custom token. So:

| | With the rows ([installing](install.md)) | herdr's default rows |
|---|---|---|
| Row 1 | `HSW-152 Show automations…` | `HSW-152 Show automations… · Agent`: the tab's name too |
| Row 2 | `agent · working · R#1 PR#113` | the same |
| Row 3 | `8% 16m` | not shown: herdr's default rows show no token |
| A space | its name, its branch, the percent and time to go | its name and its branch |

The plugin's rows hide the names of a task's own tabs (`Agent`, `Reviewer #1`): they say nothing the next row does
not. A tab of your own named exactly `Agent` is hidden on row 1 the same way. An agent that is not the board's keeps
herdr's own entry: its space, its tab, its name.

## What herdr 0.9.3 cannot do here

- **The Coordinator's first row reads `~ · Coordinator`**, not `Coordinator` alone. It lives in a tab of the home
  space, and a sidebar row can hide a value only by that value itself: hiding `~` would hide it for every agent of
  yours in the home space.
- **No mark of the board's own.** The row's `?`, `!`, `◑`, `◇`, `◌` and `◆` cannot be drawn: the icon of an entry is
  herdr's state icon, which only herdr's own five states have. The words carry it.
- **No colour by status.** herdr can colour a value by rules on its text, set in your config; the plugin's rows only
  dim the Coordinator's message, as the board greys it.
- **No bar.** The percent and the time to go are there; the row's bar is not.
- **Not in the collapsed sidebar or on a phone-width window.** Those keep herdr's own compact layouts, which
  sidebar rows do not change (herdr's configuration page says so; not tried here).
- **Another machine's tasks** are written by the plugin on that machine, into that machine's herdr. They show here
  when this herdr is connected to it and that machine runs this version of the plugin.
