# List headings: machines, repos and status groups, folded and unfolded

The task list stands under headings: a repo's name when it is grouped by repo (`Alt+S`), a status (`needs you`,
`working`, `to do`, `done` …) when it is grouped by status. With every machine shown (`Alt+M`, [other
machines](other-machines.md)) there is one level more: **a heading per machine**, with that machine's repos (or its
status groups) under it, and their tasks under those.

```
 ▾ vm-str ─────────────────────────────────────────────────────────
 ▾ herdr-projects · HSW
 ◐ HSW-151 Rewrite the board in Rust on Ratatui           47%   3h
 ○ HSW-179 Remove the "To: Coordinator" label          1h ago

 ▾ open-crm · CRM
 ○ CRM-4   Explore Open CRM as the next-gen CRM         9h ago

 ▸ vm-ssa  1 task ─────────────────────────────────────────────────
```

- **A machine's heading** is its name in bold, in the accent colour, with a rule to the edge of the list. This machine
  is named by its own name (its hostname). The machines come in the order of herdr's machines sidebar, this machine
  where it stands there ([machine order](machine-order.md)). A machine with no task in view has no heading; one whose tasks cannot be read says so above the list, as always.
- **A row never names its machine.** Its tag is the one it has on its own machine's board, the repo's key with the
  number (`HSW-151`, [task numbers](task-numbers.md)): the heading above it says whose it is. A repo's heading is its
  name with its key beside it, dimmed (`herdr-projects · HSW`), never `vm-str:herdr-projects`. The repo the board is
  in comes first on each machine.
- **On one machine** (this machine's board, or one other machine by itself) there is no machine heading: the list is
  as it always was.

## Folding

Every heading that folds has a **caret** in the marks' column, in the muted colour: `▾` open, `▸` folded. Its name
starts one cell after it, where a task's tag does. A heading that does not fold (the automations') has no caret, only
a blank where it would be, so every heading's name starts in the same column. On a narrow list the caret stays and the
heading is cut at the right edge.

The arrow keys stop on every heading as on a row, and a selected heading has the same bar and tint as a selected row.

- **`Enter` on a heading folds it**: its tasks hide and only the heading stays, its caret turned to `▸`, with how many
  tasks it holds (`▸ open-crm  4 tasks`). `Enter` again unfolds it. The hint line says which (`enter fold this repo`,
  `enter unfold this machine`, `enter fold this group`), and the `?` menu has it on the line of `enter`.
- **A machine folds whole**: all its repos and their tasks hide under its one line, which counts them all. Unfolded,
  its repos are as they were: one that was folded is still folded.
- It works the same grouped by repo and grouped by status, on one machine and on every machine. The two groupings
  keep their own folds: a repo folded by repo leaves its tasks in view when the list is grouped by status.
- A click on a heading folds and unfolds it too ([mouse](mouse.md)).

**What is folded is remembered**: it stays folded while the list refreshes, when you switch the grouping or the
machines and back, and **after the board is closed** (it is kept with the rest of the board's view, `view.json` in the
board's data folder; the popup has its own, as it has for its selection). The web board keeps its own folds the same
way, in its own file.

**What a fold never hides:**

- **A filter.** While find (`Ctrl+F`) or a kept filter is on, every task that matches shows, folded or not; the folds
  are back when the filter is cleared.
- **The selected task.** A task the selection is taken to from elsewhere (herdr's approve action, the popup opened
  from a task's pane), or the selected task when the list is laid out anew (another grouping, other machines): its
  machine and its group unfold, so the selected task is always in view.
- **The automations.** Their group is last and has no fold of its own.

A list longer than its room counts what it does not show on its last line (`↓ 11 more`); the tasks under a folded
heading are not in that count, since the heading already says how many it holds.

## The web board

The same headings, in the same order: each machine's name over its groups, with a line under it, each group with its
count. A tap on a heading (machine or group) folds and unfolds it; its caret says which way (`▾` open, `▸` folded),
and a folded heading's count is how many tasks it holds. A watching device may fold too: it only changes what that
page shows.
