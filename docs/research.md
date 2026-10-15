# Reports, and research-only tasks

**A report never goes into the repo.** A report, a review or a research result is something an agent writes for you
to read. It is not part of the product, so it is never committed, in no folder. It is kept with the task and you get
a private link to it.

**A research-only task changes nothing in the repo.** Its whole result is a report. Work that should follow from it is a short
**Also noticed** list in that report: nothing adds a task for it.

## Where a report goes

Every agent the board starts is told the same, in every repo:

- It writes the report into the task's own folder among the board's reports, `~/.herdr-projects/reports/<repo>/<number>/`
  ([the home folder](home-folder.md)), as `index.html` (one page that stands by itself) or `report.md`. That folder
  is outside every repo, so the report cannot be committed by mistake, and it stays when the task's worktree goes.
- When the agent finishes, the board gives the report a link, served the way a review's evidence is: privately on
  your tailnet with `serve: tailscale`, on `127.0.0.1` with `serve: local` ([settings](settings.md)). The link opens
  `index.html` when there is one, else `report.html`, `report.md`, `README.md`, else the folder's first file.

The task panel shows the link under **Report**, beside the list and full screen (`Open report`; full screen also
the file's name and the link printed in full). `herdr-projects details <id>` has it as `report`.

This holds for any task: a task that changes code and also wrote a report has both, its change in the pull request
and its report on the task.

## A research-only task

Research only is a [setting](settings.md) like every other: `research.only`, `true` or `false`, `false` built in.
(The name reads as what the board calls it everywhere, "research only", in the dotted style of `merge.by` and
`review.when`.) It is looked up as every setting is, nearest answer first: **the task → your entry for that repo →
you → the repo's own file → built in.**

- **One task**, when it is added: `herdr-projects add "<title>" --research`, which is short for
  `--research.only true`. The Coordinator does this by itself when you plainly ask for research, a review or a
  report with nothing to be changed ("look into why the build is slow and tell me", "write me a report on …"). It
  does not when a change is wanted, and not when it cannot tell.
- **One task**, later: `herdr-projects delegate <id> --research` (`--no-research` turns it off again), or
  `herdr-projects set research.only true --task <id>`, or its row on the task's settings page (`Research only`,
  with what it means): on the terminal board, and on the web Board under the open task (**All settings**).
  All of them write the same one setting on the task.
- **A whole repo, or everything of yours**: `herdr-projects set research.only true --repo <name>`, or without
  `--repo`. Every new task there is research only unless the task says otherwise (`--no-research`, or
  `set research.only false --task <id>`). The repo's own `.herdr-projects.json` may say it too:
  `{ "research": { "only": true } }`.
- **An [automation](automations.md)**: `--research` when it is made, or
  `set research.only true --automation <name>`. Each task it makes has it as its own.

`herdr-projects show <id>` lists it with the place its value came from (`this task`, `your entry for <repo>`,
`you`, `the repo's file`, `built in`), and `unset research.only` takes an answer away again.

The row says `[research]` after the task's name: on the board, in herdr's sidebar and on the web Board, for an
automation's task and for a task on another machine alike. The label comes from the setting, never from the title.
The task panel has a part **Research only** with the report's link (or `No report yet`), and its settings say
`Research  only · no change to the repo` where an ordinary task says how it merges.

### Changing it on a task that is under way

The setting is read at the moment the task's agent is started, as every setting is read when its step starts, and
the task keeps what it was started as until its next start. That is what the agent was told, what the finish line
holds it to, and what the label says. The moment is the start of the agent's program itself, not the request for it:
the task then has its worktree, so the repo's own file counts as the commit that worktree starts from has it, and
its setup has run.

- **A task that was not started yet, that waits for a free slot, or whose setup still runs**: the change counts at
  once, the row follows, and the agent starts as the setting says at that moment.
- **A task that was started** (working, stopped, waiting for you, failed): the change is saved and counts **from its
  next start**: delegate it again, and its agent is told the new rules. Until then `show <id>` and the settings page
  say so beside the value: `counts from its next start: this run is not research only`. A change of a default (for
  a repo, for you, in the repo's file) never changes a task that was started either.
- **Turning it on is refused** where it cannot be honoured, with the reason: once the task's agent has changed the
  repo (a file, a commit) or its pull request is open. A research-only task changes nothing, so that work would
  have to be thrown away; undo it or close the pull request first, or add a new task as research only. The same
  holds for a task that would start as research only by a default after it worked as an ordinary one: delegating
  it is refused until the task says what it is (`set research.only false --task <id>`).
- **Turning it off is never refused.** It counts from the next start, and from then on the task is an ordinary one.

A task that had the old `--research` mark from a version before this was a setting is research only still: the
mark is read as the task's own `research.only`, and a task that was started keeps what it was started as.

### What its agent is told

Change nothing in the repo: add, edit and delete no file, commit nothing. The result is a report, saved as above,
and the work that should follow from it is a short "Also noticed" list in that report: nothing else is done with
it, and the agent adds no task for it. The repo's check is not named to it: there is no change to check.

Saving the report finishes nothing: the agent may save it early and add to it while it still waits for your
answers, and you can open it meanwhile. The task is finished when its agent stops without saying that it waits
([An agent that waits for you is not finished](waiting-for-you.md)).

A task whose setting changed since its agent was started is told at its next start: that it is research only from
now on (or no longer is), with the rules as they are from there.

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
  all, delegate it again as an ordinary task (`herdr-projects delegate <id> --no-research`, which is
  `set research.only false --task <id>` and a start in one).

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

A research-only task can never be merged: approving one is refused, and `merge.by: itself` passes it by. To merge
its change after all, turn the setting off for the task and delegate it again.

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
