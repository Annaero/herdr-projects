# The task panel

**The task panel** shows the selected task. Beside the list it is closed until you ask for it: `Alt+P` opens and
closes it (in a window of 90 columns or more), and your choice is remembered. Closed, each row has the whole width
for what it says. `Alt+T` shows the whole task full screen, and `Esc` or `Alt+T` leaves it. Opening or folding the whole panel
never changes who you talk to or whether the chat's message shows, and `Space` never opens or folds it, at any
width.

Both have the same parts, in the same order, and **one form for every part**:

- **A headline** in bold on a thin rule that runs to the edge. One that needs you is in its state's colour.
- **Facts are a label and its value**: the label greyed out on the left, the value on the right. Every value in the
  panel starts in the same column, so the eye runs down one line. A value longer than its line is wrapped under
  itself, between its facts where it has them (`12m ago` is never split).
- **A text** (the description, what the agent said) is plain lines under its headline.
- **An empty line stands between two parts**, and between two reviews on the full screen. Nowhere else.
- **Nothing is boxed, nothing sits behind a bar, and no fact is cut with `…`.** Where the panel is too short, whole
  lines and whole facts give way (below), and the last line says where the rest is.

```
 #84 Max length for task titles

 Status ─────────────────────────────────────────────
 State        ◆ ready to approve · 4th review · 2m ago
 On it        claude
 Change       PR#60 · 19 files, +340 −27

 Description ────────────────────────────────────────
 A task title should have a maximum length.

 Reviews · 4 ────────────────────────────────────────
 History      fail → no verdict → fail → pass
 Review 4     ✓ Pass · 1 minor · 11m ago
              The change meets the task. A title at
              the limit is kept whole.
 Evidence     ↗ Open review

 The agent said ─────────────────────────────────────
 Titles longer than 80 characters are cut between words.

 Settings ───────────────────────────────────────────
 all as usual · ctrl+e shows them
```

- **The title** is on top, by itself.
- **Status**, where it stands, one fact a row and always in this order: `State` (its mark and word, which review
  it is on, since when), `Progress` (the bar, its percent and the minutes left), `Now` (what the agent or the
  reviewer is doing right now, wrapped whole), `On it` (who), `Made by` (the [automation](automations.md) that made it, when one did), `Change` (the pull request, in the colour of its
  checks, and the size of the change; the number is a link, and full screen the address is printed too). A task
  nobody is on says what puts an agent on it (`Next`). The task is named as its row names it (`#84`, or `HSW-84`), in
  the title and in the heading of the whole-task page (`Task details  #84 "Max length for task titles"`); its id as
  a command takes it (`proj/84`) stands once, on the whole task, with the session.
- **What it needs from you** is a part of its own right under Status, its headline in red: `Asks you`, `Asks for
  your OK`, `Needs a login`, `Review failed` (what the review found, and what the two keys do: send it back, or merge
  anyway), or `Went wrong` with what failed, who can fix it, the `Next step` and the `Details`. A headline is never
  said again as the first line under it.
  `Behind main` and `Cut off` (the board tries again by itself) are the same part in their own colour, and an
  archived task says so there.
- **The description**: whole on the full screen, cut after about 400 characters beside the list.
- **The reviews**, as a history (below).
- **What the agent said**: the newest words of its conversation, never its program's screen (while you talk to
  its agent that is in the chat instead). While the task is under review the part is the reviewer's, and its
  headline says so: `The reviewer says`. When the review ends it is the agent's again. A dialog that is only on a
  program's screen is said there in a line, with the way to it; what the chat shows, and from where, is in
  [the board](board.md).
- **Settings**, what the task runs on. Beside the list only what is this task's own shows, each a row, and one
  line for the rest (`all as usual · ctrl+e shows them`): the same nine rows under every task took the place of the
  review's findings and the agent's words. The whole task has them all: the project, the worktree, the agent, the
  reviewer, when it is reviewed, what sends a review back and how many rounds, the evidence, and how it merges. A row
  that holds a choice made for this task is in the text colour and one that comes from somewhere else is quieter;
  a task's own choice is starred as well, and the worktree's folder is printed. A `Note` row says what the board
  could not use: a program that is not installed, something the repo's own file was refused, a mistake in your
  settings file.

## The settings page

`Ctrl+E` on a task opens its settings full screen: every work [setting](settings.md) by its plain label, its value,
the place the value comes from, and its name as a command takes it.

```
 Settings  #12 "Tidy the first-run questions"
 ────────────────────────────────────────────────────────────────────────────────
 Send back from: critical · [major] · minor · trivial

     Agent's program       claude    built in             worker.agent
   * Agent's effort        high      this task            worker.effort
     …
▌›   Send back from        major     built in             review.mustFix
     Rounds by itself      5         you                  review.rounds
     Merged by             itself    your entry for proj  merge.by
     Check command         npm test  the repo's file      check.command
```

- The line on top is the selected row's: what it may be. A choice lists its words with the one it is now marked; a
  switch reads `on · [off]`; anything typed says what to type (`a time, such as 90s or 15m`).
- A setting that cannot apply to this task is not offered: fast mode, for a program that has none (only Codex has
  one); a repo's setting, for a task in no repo. One that is this task's own all the same still shows, so that it can
  be put back.
- Only this page's keys act while it is open, and the hint line is its own ([keys](keys.md)).

- `↑` `↓` move to a row (here they do not move between tasks).
- `Enter` changes the row, for this task only: a switch or a choice goes to its next value and is saved at once;
  anything else is typed in the box at the bottom (it starts empty; the page says the value it has now) and saved
  with `Enter` (`Esc` leaves it as it was). A value that
  is refused says why, with the nearest right one, and changes nothing.
- `*` marks the rows that are this task's own. Every other row names the place its value comes from: your entry
  for the repo, you, the repo's file, or built in.
- `Ctrl+U` puts the selected row back to what it would be without this task's own answer.
- `Esc`, or `Ctrl+E` again, goes back to the task.

Board settings are yours only and are not on this page (`herdr-superwork show`). A task on another machine is
changed there; an archived task's settings can be read, not changed.

Full screen the text keeps to 100 columns, and a last part, **Session**, has the agent's context, its tokens and
where it runs in herdr. Beside the list, when anything is shorter than on the full screen, the last line says
`alt+t shows the whole task`.

**In a panel too narrow for a value beside its label** (under about 30 columns), the label is a line of its own and
its value is under it, indented. Nothing is cut there either.

**In a short window whole lines give way, the least needed first.** The state and the `Now` text stay whole, and
what the task needs from you outlasts every setting:

1. The empty line on top. Then the long parts give up lines: what the agent said first, then
   the description, then the review (its summary, then `History` and `Evidence`), each down to a few lines. A text
   that lost lines ends in ` …`.
2. Those parts go, all but the review, which keeps its row and one line of its summary.
3. The facts that are said elsewhere: `Task`, `On it` and `Made by`, and the rows among the settings that are not settings.
4. The settings, from the last, each one whole. Their headline goes with the last of them.
5. The review is down to its one row (`Review 3  ✓ Pass · 2 minor`), and what it needs from you gives up lines.
6. The empty lines between the parts, the `Status` headline, the title's second line; then `Change`, the review's
   row and the title.

What is left then is the state, the progress and the `Now` text. With no room for those and the last line
(`alt+t shows the whole task`), that line goes, then the progress, then the state: the text itself is the last to
stay. Only a text longer than the whole panel is cut, and its last line ends in `…`.

**Every review is kept, and the reviews read as a history.** `History` says how each went, oldest first
(`fail → no verdict → pass`). A review is a row under its own name: a mark and its result (`✓ Pass · 2 minor`,
`✗ Fail · 1 critical`, `– No verdict`; the colour only repeats the mark), when, and under them its summary. Beside
the list the latest one shows, with the first piece of `Evidence` (its name, wrapped whole). Whenever the full
screen has more of a review (a longer summary, findings, what it checked, more evidence or its address), the last
line says so. The full screen has all of them, the newest
first, each with its commit and, as facts of their own, its `Findings` (how bad each is in a column of its own:
`critical`, `major`, `minor`; one that did not hold the work back is marked `not required` or `pre-existing`), what
it `Checked` and what it left `Unverified`. A review that gave no verdict has its row too, with why. A review from
before the gate keeps its score and its advice as they were (`4/5, says merge`), and its `Problems`. A review that
still stood after main was merged in says so under its result. Full screen each piece of **evidence** is under
its own `Evidence` headline: its name, what it is and its address printed in full, each wrapped under itself and
never cut. `herdr-superwork details <id>` prints the same list
as `reviews`.

## Why it looks like this

The panel shows one issue and the history that comes in under it, which is what an issue or pull request page
shows. The form was taken from what already works for that, and fitted to a terminal's text cells:

| From | Taken | Left out, and why |
|---|---|---|
| GitHub's pull request page | A status first, then the checks and reviews summed up as rows of mark, name and result; what blocks the merge named right under the status; the timeline newest-relevant first. | Avatars, badges as coloured pills, a column on the side: no room and no pixels. |
| `gh pr view`, `gh pr status`, `gh pr checks` | Label-and-value rows for the facts; one line per run with its mark, result and age; a result said in words with the colour only repeating it. | Its dot-separated one-liner (`Checks passing - Approved`): that is what the old top of the panel was. |
| lazygit, gh-dash | One accent per state, quiet labels, the selected thing's detail beside the list and whole on its own screen. | Boxes around every pane and tabs inside the detail: a box costs two columns and two lines of a 38-column panel. |
| CodeRabbit, Greptile, Cursor Bugbot | Findings by severity in a column of their own; a verdict line before the detail; what changed since the last round as a history line. | Emoji badges, a score out of five for new reviews (the gate's pass or fail says more), collapsed sections. |
| The `/ui` skill's guidelines | Labels quieter than values in a list of facts; the lightest separation that works (space, then a rule, never a card by default); numbers that line up. | Everything about pixels, radii and shadows. |
| `tui-design` skills on skills.sh | Stable places for the same fact in every state; a mark or a word beside every colour; narrow, ordinary and wide widths each tried; give way by priority instead of cutting. | Borders for emphasis, and their palettes: the board keeps herdr's. |

**A part that fails to draw takes only itself.** Its headline stays, with one red line under it
(`✗ This part could not be shown: …` and the error): every other part of the panel is there, and every key works.
The same holds for each section of the screen: the list, the panel, the task details, the menu, the chat, the text
box, the hints. One that fails is that red line in its place, and the others stay. Only a failure outside all of
these replaces the board with `view error`.
