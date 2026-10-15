# Shorter checks on fix rounds

The board runs a repo's check every time an agent finishes: the first time, and again on every round after it, when
a review, a failed check or GitHub's checks sent the work back and the agent fixed it. A full check on each of those
rounds repeats what already passed, while GitHub runs the full suite on the pull request anyway, and the merge waits
for it. So a repo can name a shorter check for those later rounds: `check.again`, beside `check.command`.

```json
{ "check": { "command": "npm run check -- --all", "again": "npm run check -- --since $HERDR_SUPERWORK_CHECKED" } }
```

## When it runs

The full check (`check.command`) runs the first time a task finishes. The shorter one runs instead on a later round
of the same task, only when all of this holds; anything else, or anything the board cannot tell, runs the full
check:

- **The full check passed on this branch before**, with the same command (`check.command` changed since: the full
  one), and the branch still holds the commit it passed on. A branch the agent rebuilt (rebased, started again) does
  not, and runs the full check.
- **GitHub's checks guard the merge**: `merge.checks` is `github`, the task has its pull request (`merge.pr`), and a
  workflow of the branch runs for that pull request. Then the full suite runs on GitHub on the last commit, and
  nothing merges before it passed ([how work gets done](how-work-gets-done.md)). Without that, every round runs the
  full check: it is the only full run before the merge.

The shorter check is told the commit the full check last passed on, in `HERDR_SUPERWORK_CHECKED`, so that it can run
only what the change since then reaches. It is always that commit: a shorter check that passed does not move it, so
each round covers the whole change since the last full run, the earlier fix rounds' too. A full check that passes
(the first round, or a round where one of the rules above did not hold) moves it.

A failed shorter check goes back to the agent as a failed check always does, within `review.rounds`, with the command
that ran (the commit written in for the variable). The task's row says `Running the shorter check of a fix round`
while it runs. The reviewer is told which check passed on the commit it reviews, and that the full one runs on
GitHub before the merge.

`none`, the default: the full check every round, as before.

## What this repo's shorter check runs

`npm run check -- --since <commit>` builds the program, writes the made tables and checks the repo's rules as the
whole check does, then runs the tests beside the code and only the test files the change since that commit reaches
([testing](testing.md#the-shorter-check-of-a-fix-round)). Where it cannot tell what a change reaches, it runs every
test.
