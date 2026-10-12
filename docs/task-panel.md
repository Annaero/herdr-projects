# The task panel

**The task panel** shows the selected task. Beside the list it is closed until you ask for it: `Ctrl+P` opens and
closes it (in a window of 90 columns or more), and your choice is remembered. Closed, each row has the whole width
for what it says. `Ctrl+E` shows the whole task full screen, and `Esc` leaves it. Opening or folding the whole panel
never changes who you talk to or whether the chat's message shows, and `Space` never opens or folds it, at any
width.

Both have the same parts, in the same order, each standing on its own under a bold headline on a thin rule, with an
empty line between:

```
 Build a flying game
 ✓ ready to approve · 3rd review · claude · 2m ago · proj/12
 4 files, +120 −31 · PR#12 ✓

 Description ────────────────────────────────
 A little plane over endless sunny islands.

 Reviews · 3 ────────────────────────────────
 fail → no verdict → pass
 ╭─ Review 3 ────────────────────── 1m ago ─╮
 │ Pass · 2 minor                           │
 │ Works. Two small naming points are left. │
 ╰──────────────────────────────────────────╯

 The agent said ─────────────────────────────
 Built Skylark. All 42 tests pass.

 Settings ───────────────────────────────────
 Project      ~/dev/proj
 Agent        claude · opus · default effort
 …
```

- **Where it stands** comes first: the title, then the state with who is on it, since when and the task's id, then
  the size of the change and its pull request (its number is a link; full screen the address is printed too).
- **What it needs from you**, or what it is doing right now, sits behind a bar in its state's colour: the question,
  what went wrong and the next step, or the agent's current line.
- **The description**: whole on the full screen, cut after about 400 characters beside the list.
- **The reviews**, each one a box of its own (below).
- **What the agent said** (while you talk to its agent that is in the chat instead).
- **Every setting**, also one that is only your default: the project, the worktree, the agent, the reviewer, what
  gets reviewed, what sends a review back and how many rounds, the evidence, the watcher, conflict repair and
  permissions. Labels are greyed out; a setting chosen for this task is in the text colour and one that is only
  your default is quieter. Full screen a task's own choice is starred as well.

Full screen the text keeps to 100 columns, and a last part, **Session**, has the agent's context, its tokens and
where it runs in herdr. Beside the list, when anything is shorter than on the full screen, the last line says
`ctrl+e shows the whole task`. In a short window the long parts give up lines (what the agent said first, then the
description, then the review), every setting keeps to one line, and in the end the review is one line
(`Review 3  Pass · 2 minor`): no setting drops out of the side panel. Only a window with fewer lines than there
are settings cuts them, from the last; the title and the review's line stay. In a box too narrow for a review's
age and commit in its top edge, they are the box's first line.

**Every review is kept, and each is a box of its own.** Under the headline one line says how each went, oldest
first (`fail → no verdict → pass`). Beside the list the latest review follows: `Review 3` and its age in the box's
top edge, then the result with its tally, and its summary. The full screen has all of them, the newest first, each
in its box: the review's number, when, the commit, the result, the summary, each finding with its severity (one
that did not hold the work back is marked `not required` or `pre-existing`), what it checked and what it could not
verify. A review that gave no verdict has its box too, with why. A review from before the gate keeps its score and
its advice as they were (`4/5, says merge`). `herdr-superwork details <id>` prints the same list as `reviews`.
