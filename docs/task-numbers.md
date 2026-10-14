# Task numbers and repo keys

Every task has an id, `herdr-superwork/134`: its repo's name on the board and its number in that repo. The board
shows the number on every row, and a repo can have a short key of its own so that a task can be called `HSW-134`.

## The tag on a row

```
 ready to approve
 ! #98  Add an undo for clear                                          R#2 PR#18 12m ago
        Fail · 1 critical, 1 major
 working
 ◐ #134 Tidy the first-run questions                  ███░░░░░ 40% 12m  R#1 PR#17  5m
        Running the tests
 to do
 ○ #9   Rename the hint line                                                      2h ago
```

- **Where.** Right of the status mark, left of the title: `#134`. With a key set for its repo it reads `HSW-134`.
- **Quiet.** It is in the theme's grey for greyed-out words, the same on every row and in every state, so the title
  is what you read first.
- **One column, and never far from the title.** There are never more than **3 empty columns** between a tag and its
  title: the one that parts them, and at most two more to line a shorter tag up. So the tags share one column and
  every title starts in the same place wherever that costs no more than this: `#9`, `#98` and `#134` above. The
  column is the tag width that lines up the most titles of the list (all its tasks, also the ones folded away, so it
  does not move as the list folds). Tags are written from the left, never moved to the right.
- **A tag that does not fit the column.** A rare longer tag runs on, and only its own title starts later. A tag more
  than two cells shorter than the column stands right before its own title. No tag can push the whole list's titles
  away:

  ```
   ○ #1   Tidy the first-run questions
   ○ #2   Rename the hint line
   ○ #140 Add an undo for clear
   ○ GT-1 A task of a repo with a short key
   ○ HSWXY-140 A task with a long key and a long number
  ```

  What a live task says, on its second line, starts under its own title, not under the tag.
- **Not the tags on the right.** `R#2` is the review round and `PR#18` the pull request: they sit at the right edge,
  in the colour of how the review and the checks went. The task's tag is at the left, grey, and has no letter before
  its `#`; with a key it has no `#` at all, which is why a key is joined with a dash.
- **Several repos in one list: the number, never the repo's name.** A tag is the number alone (`#12`), or the repo's
  key with it (`PW-12`), in every list. So a list that holds tasks of several repos can show two `#1`: that is
  accepted. To see which repo each task is in, group the list by repo (`Alt+S`, in the `?` menu as "group by repo:
  see which repo each task is in"; the "Group by repo" button on the web board): each group's heading names its repo.
  The whole task names the repo too, in its `Task id` row (`pi-work/12`), with the session. No key is ever made up
  by the board.
- **Other machines.** A task of another machine has the tag its own machine gives it (that machine's keys). Each
  machine counts its own tasks, so two machines can each have a `#1`: with every machine shown, each machine is a
  heading of its own and its tasks are under it ([list headings](list-headings.md)), so a row has the plain tag
  (`#1`, `HSW-1`), never its machine's name. The board's messages, the chat and the whole task, which have no heading
  above them, name it: `otherbox#1`. Find takes the number alone, without the machine.
- **When space runs out.** The tag is the last thing to go before the rest of a name: after what a row says, the bar,
  the word `ago`, the end of a long name, the percent with the minutes left, the `R#` tag with the pull request, and
  the time ([the board](board.md) has the whole order). It goes for the whole list at once, so the titles stay in one
  column: when the row with the widest tag would have fewer than 16 cells for its name with nothing else beside it
  (a list under about 25 columns). Because the column takes a few cells from every row, each of the other things gives way that many
  columns earlier than it did.
- **On a narrow screen** (under 80 columns), where a live row's name wraps, the lines of the name and of what the
  task says start under the title. So does the line of the bar: a row has one left edge.

## Everywhere else a task is named

| Where | What it shows |
|---|---|
| the list, the archive, find: one-, two- and three-line rows, of every group | the tag, as above |
| the task panel and the details page | the tag before the title, greyed; the heading says `Task details  HSW-134 "its title"`. The id itself (`herdr-superwork/134`) stands once, on the whole task, as `Task id` with the session: where a command needs it |
| the chat's line that names who you talk to | the tag between the mark and the task's name; a window too narrow to leave the status 20 cells goes without it |
| an automation's firings | `made HSW-140`, on the board and on the command line |
| the board's own messages | the tag and the title, in one form: `Archived HSW-134 "Fix the footer".`, `Pinned #14 "…" to the top.`, `Stopped #14 "…".`, `Removed …`; a message an action wrote with the id reads with the tag too (`#14: approved, merging`). Only a line that shows a command to run keeps the id the command takes. Pinning says so, and an action on another machine says what it is doing there (`Pinning #2 on otherbox…`), never a bare `…` |
| herdr's sidebar, and a pane's title | the task's space is named with the tag and the task's title (`#34 Add a file…`), which is the first row of its agent's entry ([herdr's sidebar](sidebar.md)); the pane's title is the same, so the web UI's sidebar reads `#34 Add a file…` too; a reviewer's pane is named the same way |
| the web board | the same tag on each row, in the same column and with the same limit on the space before a title; what a task says and its bar start under the title, not under the tag; a list too narrow to leave the widest tag's title 16 letters shows no tags, on every row at once; before the task's title when one is open, and in the chat's line |

**Short form or id.** With a key, everything that names a task in words says the short form, the same everywhere:

| Where | With the key `HSW` |
|---|---|
| a command's answer and its error (`describe`, `delegate`, `archive`, …) | `HSW-134: updated (description)` |
| the board's messages, also what a command answered through the board | `HSW-135: restored` |
| what a task's agent is told about its own task | `its id on the work board is herdr-superwork/134; the human also calls it HSW-134, and every command takes that name too` |
| a pull request's body, and the commit the board makes | `Task: HSW-134 (herdr-superwork/134)` |

The id itself is kept where a program reads it, since it is the task's real name and the one that never changes:
`--json`, the list's first column (`herdr-superwork list`), branch names, folders and paths (an id inside a path is
never rewritten), and the commands an agent is given to run. Without a key nothing changes anywhere.

## A short key for a repo

`repo.key` is a setting ([settings](settings.md)) with a rule of its own, because it is a fact about one repo and
never about one task or about all repos:

**your entry for the repo → the repo's own file → none.**

```
herdr-superwork set repo.key HSW --repo herdr-superwork     your entry for that repo
herdr-superwork unset repo.key --repo herdr-superwork       back to the repo's file, or to none
herdr-superwork show --repo herdr-superwork                 what it is and where it comes from
```

or, to let it travel with the repo, in the repo's own `.herdr-superwork.json`:

```json
{ "repo": { "key": "HSW" } }
```

- A key is 2 to 5 letters or digits, the first a letter, and is kept and shown in capitals (`hsw` is saved as
  `HSW`). Anything else is refused with the reason. `PR` is refused: on a row it already means a pull request.
- It is refused on a task (`--task`) and for yourself (no `--repo`), with how to set it.
- **Two repos, one key: refused.** `set` refuses a key another repo already has and names that repo. A repo's own
  file can still bring a key another repo has (nobody is asked when a file changes): then your own entry wins over a
  file, and a key two repos say in the same kind of place counts for neither, and `show --repo` says so. So a key
  never names tasks of two repos.
- The repo's file is read as it is in the repo's folder now (your checkout), not from a task's branch.

## The key names the task

`HSW-134`, in any letter case, is accepted wherever an id is: every command (`details`, `delegate`, `tell`, `stop`,
`approve`, `review`, `retry`, `fix`, `finish`, `report`, `describe`, `pin`, `archive`, `restore`, `clear`,
`show`, `set … --task`), so "start HSW-134" is
`herdr-superwork delegate HSW-134`. The Coordinator's rules and the skill say so too.

The id keeps working and stays the task's real id: nothing is stored under a key. Changing or removing a key breaks
nothing; the old short name simply stops being understood, and the id never did.

## Finding a task

In find (`Ctrl+F` on the board, the search box on the web board), a task is found by its number and its tag as well
as by its words: `134`, `#134` and `hsw-134` all match it. What you type still filters as you type (`13` also shows
`#13` and `#135`); when it is exactly one task's number or tag, the selection goes to that task.
`herdr-superwork list --query` matches them the same way.
