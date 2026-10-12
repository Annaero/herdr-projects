# Suggested tasks

**Nothing files a task by itself.** A task appears on the board only when you ask for it: you type it, you tell the
Coordinator, or you accept a suggestion.

An agent or a reviewer often comes across work that is not part of the task it is on: a test that was already
flaky, a bug elsewhere, a follow-up. It may not do that work, and it may not file it. It raises a **suggestion**
instead, which is saved on the task it was working on:

- A reviewer's finding marked `preexisting` (it was there before the change) becomes one. It never holds the work
  back ([the gate](gate.md)). If the board is too busy to save it, it waits and tries again; one that still could
  not be saved reads `not suggested: the board could not save it` in the review, and the board
  saves it by itself as soon as it can (on its regular pass, and at every later review), whether or not a reviewer
  names it again.
- An agent runs `herdr-superwork suggest "<short title>" --desc "<what and why>" --from <its task>`. An agent's
  `add` does the same: it is a suggestion, never a task.

## Where you see them

Quietly, and only when you look. Nothing opens, asks or moves by itself, and no task changes its state or its group.

- The board's top line counts them: `2 suggested tasks (ctrl+n)`.
- The task that raised them lists them in its panel, under **Suggested tasks**, each with who raised it and what
  it says (where it is, what was seen): its first lines beside the list, all of it full screen (`Alt+T`).
- When the selected task has one and the hint line has room, it shows `ctrl+n suggested task`.

```
 Suggested tasks · 2 ────────────────────────
 • The cleanup retry test fails under load
   from the reviewer · 3m ago
   Where: test/cleanup-retry.test.js:52
   What the reviewer saw: 2 of 5 runs failed …
 • Dates are parsed as text
   from the agent · 1h ago
 ctrl+n makes one a task, or dismisses it
```

## Deciding

`Ctrl+N` (also a line in the `?` menu) asks about the selected task's first open suggestion; on a task with none it
goes to the first task that has one.

```
 ? Suggested by the reviewer (1 of 2): "The cleanup retry test fails under load". Make it a task?
   Where: test/cleanup-retry.test.js:52
   Severity: minor
   What the reviewer saw: 2 of 5 runs failed on main too.
   y = make it a task · n = dismiss · esc = later
```

The question shows what the suggestion says under its title (its first eight lines; the full-screen panel has all
of it), so you decide on the details, not on a title.

- `y`: it becomes a task in the same repo, with the suggestion's details as its description. Nobody is put on it;
  `Tab` does that.
- `n`: dismissed. It is kept on the task (the full-screen panel shows it, greyed), so it is not suggested again.
- `Esc`: later. It stays open.

Then the same task's next one is asked. From a shell, or through the Coordinator when you tell it to:
`herdr-superwork suggestions [<id>]` lists the open ones, `accept <id> [S1]` and `dismiss <id> [S1]` decide one.
An agent the board started cannot accept or dismiss. Two yeses to one suggestion at the same moment (two boards,
or a board and a shell) make one task: the second is told it was made already. A yes that could not be written
down (the task was busy) makes no task, so trying again never makes a second one. And when you filed the same work
yourself after it was suggested, yes makes no second task: it says `Already a task: proj/12`.

## The same thing is suggested once

Five reviews of five tasks that all trip over one flaky test raise one suggestion, not five. Before a suggestion is
added, the board looks through its repo for the same work:

- a suggestion on any task that is still open, or that you dismissed;
- a task that is not done and not archived (also one made from an accepted suggestion).

If it finds one, nothing is added. The finding in the review says where it is (`pre-existing, suggested as a task`
or `pre-existing, task proj/12`), and an agent is told `Already suggested (S1 on proj/7)`.

Two descriptions are taken for the same work when their titles (for a [shortened title](titles.md), the whole
sentence it stands for) are made of mostly the same telling words, or share
a fair part of them and name the same file (line numbers aside). Words that say the same count as one (`drops`,
`loses`, `omits`; `last`, `final`; `importer`, `importing`), so `The importer drops the last row` and `Importing
loses the final row of the file` are one. Words that say the opposite make two (`the first row`, `the last row`;
`importer`, `exporter`). And the findings of one review are never merged with each other: a reviewer lists one fault
each, so each is its own suggestion with its own details. So `The cleanup retry test fails in both the full
suite and an isolated run` and `The existing clean-up test fails intermittently in the full suite`, both about
`test/cleanup-retry.test.js`, are one. Another fault in the same file, in other words, is another suggestion. And
when both name their files and share none, they are two things whatever the words: the same sentence about
`import-csv.js` and about `import-json.js` is two suggestions (an agent names its file in `--desc`, a reviewer in
the finding's place; both are read). It is
a guess, so two more things back it up: every reviewer is given the list of what is suggested already and told not
to report it again in any words, and an agent is told to look at `suggestions` and `list` first.

A task that is done or archived holds nothing back: the same thing found after it is news. Deleting a task deletes
its suggestions with it.
