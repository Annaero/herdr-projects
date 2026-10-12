# The check's progress: what the board shows, and how a check reports it

The board runs a repo's `check` itself: at the finish line when the agent says it is done, and again after a
catch-up with main before a merge ([how work gets done](how-work-gets-done.md)). While it does, the task shows where
the check is, everywhere a task's progress shows: its row, the task panel, the details page, the chat line and herdr's
sidebar. Nothing shown is a guess. The Watcher is not asked.

## What the task shows

| The check | The line | Bar and percent | Minutes left |
|---|---|---|---|
| runs, and reports a count | `running the check · tests 31 of 47` | the count: 31 of 47 is 65% | how long full runs took here, less the time spent |
| waits for its turn | `waiting for its turn · 2 ahead` | none | the runs ahead, then its own |
| answers at once: this code passed before | `the check already passed for this exact code` | none | none |
| runs, and reports nothing | `running the check · 2m of about 5m` | none | what it took before, less the time spent |
| reports nothing, and never ran here before | `running the check · 2m` | none | none |

- **The percent** is only ever the count: finished out of total. It is 100% only when all are finished.
- **The minutes left** come from the last runs of the same command in the same repo on this machine that ran in
  full and passed: the middle one of the last five, so one slow run on a busy machine does not move it. A run that
  had part of its work done before it began is given that share of a full run. Once a run is past its usual time,
  the minutes follow its own pace so far (and are left out while under a twentieth is done). With no run timed
  yet they follow its own pace too. They are never under a minute while work is left.
- **Waiting**: the minutes are one usual run for each run ahead, less the time since the line last moved, and then
  the check's own run. Without a timed run there are none.
- **Standing still.** When nothing has moved for three times as long as a full run takes (never under three
  minutes; ten minutes where no run was timed), the row says so instead of looking frozen:
  `the check stands still · nothing finished for 13m · tests 31 of 47` (the bar stays, the minutes go), or
  `waiting for its turn unusually long · nothing moved for 13m · 2 ahead`. A check whose count is complete and
  which still does not end says `the check has not ended · all finished 16m ago · tests 47 of 47`. A check that reports nothing cannot be
  seen standing still, only running long: past three times its usual time (and at least ten minutes past it) the
  row says `the check runs far longer than usual · 16m, usually 2m`.
- **The colour.** The mark, the bar, the percent and the minutes left are a plain light grey while the board
  checks: the theme's `subtext0`, under the name `check`. Amber is the agent's, blue is the reviewer's,
  and grey is the board's own step. It is brighter than the greyed words beside it and it has no hue.

## How a check reports its progress

The board gives the check command one more variable: `HERDR_SUPERWORK_PROGRESS`, the name of a file. The check
writes where it is to that file, as often as it likes, each time the whole file anew. The board reads it once a
second. A check that writes nothing still works: it gets the time-only line above.

One line, either JSON or plain words:

| Written | Means |
|---|---|
| `{"done": 31, "total": 47, "unit": "tests"}` | 31 of 47 are finished. `unit` is the word shown before the count; leave it out for none |
| `31/47` or `31 of 47 tests` | the same, for a shell script |
| `{"done": 45, "total": 50, "before": 40}` | 40 of them were finished before this run began (they passed earlier and did not run again): the run is timed as a part of a full one |
| `{"state": "waiting", "ahead": 2}` | it has not started: two runs go first |
| `{"state": "known"}` | answered at once, nothing run: this exact code passed before |

A shell check, for example:

```sh
n=0; total=$(ls tests/*.sh | wc -l)
for t in tests/*.sh; do sh "$t" || exit 1; n=$((n+1)); [ -n "$HERDR_SUPERWORK_PROGRESS" ] && echo "$n/$total tests" > "$HERDR_SUPERWORK_PROGRESS"; done
```

Rules the board holds to: a line it cannot read changes nothing; `done` past `total` is `total`; the file is the
board's own, in the task's folder, and is removed when the check ends. Write it in one go (write a file beside it
and rename it, or one short `echo`): the board may read at any moment. Whether the check passed is its exit
status, as ever, never what it wrote.

This repo's own check reports this way: [tests](testing.md).
