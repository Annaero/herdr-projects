# A task's tabs in herdr

Every task an agent takes on has a herdr space of its own. Its helpers are laid out there as tabs:

- **`Agent`**: the tab the task's agent works in. It is named when the agent is started (the first time, after a
  restart, and when the board reopens a space that was closed).
- **`Reviewer #1`, `Reviewer #2`, …**: one tab per review, opened when the review starts and closed when it ends,
  whatever its result (also when you stop the task, and when a review is cut off and tried again). The number is the
  review round, the same one as the row's `R#2` tag. A reviewer is never a pane inside the agent's tab.

Opening a reviewer's tab changes nothing you look at: herdr is told not to focus it, so you stay where you are, and
as it is a tab of its own the agent's pane and the board keep their size. Go to the tab to watch the reviewer work;
the task panel and the chat preview show its screen meanwhile, as before.

The board finds each helper by its pane, not by its tab's name: renaming a tab yourself breaks nothing. What the task
keeps of a running reviewer (its tab and pane) is saved with the task, so a board that is restarted with a review
under way still reads its screen, takes its verdict and closes its tab; a tab left over from a review that was
interrupted is closed before the next one starts. A reviewer started by an older version of the board, as a pane in
the agent's tab, has that pane closed and nothing else. When the task is merged or archived its whole space is
closed, tabs and all.

The names and the code are in `src/flow/tabs.js`; what herdr does with tabs is in
[checked-on-herdr.md](checked-on-herdr.md).
