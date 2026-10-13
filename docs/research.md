# Reports, and research-only tasks

**A report never goes into the repo.** A report, a review or a research result is something an agent writes for you
to read. It is not part of the product, so it is never committed, in no folder. It is kept with the task and you get
a private link to it.

**A research-only task changes nothing in the repo.** Its whole result is a report, plus suggestions for the work
that should follow from it.

## Where a report goes

Every agent the board starts is told the same, in every repo:

- It writes the report into the task's own folder among the board's reports, `~/.herdr-superwork/reports/<repo>/<number>/`
  ([the home folder](home-folder.md)), as `index.html` (one page that stands by itself) or `report.md`. That folder
  is outside every repo, so the report cannot be committed by mistake, and it stays when the task's worktree goes.
- When the agent finishes, the board gives the report a link, served the way a review's evidence is: privately on
  your tailnet with `serve: tailscale`, on `127.0.0.1` with `serve: local` ([settings](settings.md)). The link opens
  `index.html` when there is one, else `report.html`, `report.md`, `README.md`, else the folder's first file.

The task panel shows the link under **Report**, beside the list and full screen (`Open report`; full screen also
the file's name and the link printed in full). `herdr-superwork details <id>` has it as `report`.

This holds for any task: a task that changes code and also wrote a report has both, its change in the pull request
and its report on the task.

## A research-only task

Mark a task as research only:

- when it is added: `herdr-superwork add "<title>" --research`. The Coordinator does this by itself when you plainly
  ask for research, a review or a report with nothing to be changed ("look into why the build is slow and tell me",
  "write me a report on …"). It does not when a change is wanted, and not when it cannot tell;
- later: `herdr-superwork delegate <id> --research` (`--no-research` turns it off again). It is a property of the
  task, not a [setting](settings.md): there is nothing to set as a default.

The row says `[research]` after the task's name. The task panel has a part **Research only** with the report's link
(or `No report yet`), and its settings say `Research  only · no change to the repo` where an ordinary task says how
it merges.

### What its agent is told

Change nothing in the repo: add, edit and delete no file, commit nothing. The result is a report, saved as above,
plus a suggestion on the task for each piece of work that should follow from it
([suggested tasks](suggestions.md)). The repo's check is not named to it: there is no change to check.

A task marked research only after its agent started is not told again by itself; the finish line below is what
holds either way, and its message says what to do.

### What the board does when it finishes

The board looks at the task's worktree and its branch: files that are not committed (new ones too), everything the
branch holds beyond the main it started from, and every commit on it, also one that changes no file and also a
merge. A worktree on another branch than its own counts as a change.

**Anything changed:**

- Nothing is committed, pushed, opened as a pull request or merged.
- The task goes back to its agent with the list of what changed, to move the result out of the repo and undo every
  change, the commits too.
- That is one round of the review loop. After `review.rounds` of them (3 by default) the task stops and waits for you. Its
  row says why: `Research only, but its agent changed the repo again after 3 rounds (2 changes in the repo): nothing
  was pushed, opened or merged`. From there you send it back once more (`ctrl+r`), or, if you want the change after
  all, delegate it again as an ordinary task (`herdr-superwork delegate <id> --no-research`).

**Nothing changed:**

- The branch is not brought up to date with main, the repo's check does not run, nothing is pushed and no pull
  request is opened.
- The reviewer reviews the report, unless the task has no review (`reviewer: off` or `review: none`). It is told
  that the task is research only: it reads the report and checks it against what was asked and against the code and
  the sources it speaks of. A change to the repo that it finds (a commit elsewhere, something pushed) is a critical
  finding, and so is a missing report. A review that fails the gate goes back to the agent like any other
  ([the gate](gate.md)).
- The task ends as **done**, with nothing to merge and its report's link on the task. With no report in the folder
  its line ends with `No report was found.`

A research-only task can never be merged: approving one is refused, and `merge.by: itself` passes it by.

### A task that works in your own checkout

A task in a repo always has a worktree of its own now. One that an older version started in your checkout (it had
`--no-worktree`), or one in a folder git cannot make a worktree of, has none, and what is changed in your checkout may be yours. So
the board writes down how the checkout stands when the agent starts: its commit, and every changed file with what it
holds, its mode and what is staged of it (the staged mode too). A file git was told not to look at (`assume-unchanged`,
`skip-worktree`) is read as well. When the task finishes, every file that reads differently from then, and every commit since, is a change, and
the task goes back as above. Its agent is told to undo only what it changed itself, file by file, and never to reset
or clean your checkout. A file you changed yourself while it worked is listed too: the board cannot tell whose it
was, so the agent says so and you retry, or delegate it again with `--no-research`.

Only a folder that is no repo at all, or a repo with no commit yet, is not looked at: there is nothing to compare, so there the agent's rules and
the reviewer are what hold.
