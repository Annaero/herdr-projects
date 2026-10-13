# Tests

A fake herdr and scripted fake agents: no model calls, no real board, no real herdr. Everything is in `test/`.

## One command

Everything that runs tests uses the same command: you, an agent at work, the reviewer, and the board's own check
(`check` in [`.herdr-superwork.json`](../.herdr-superwork.json)). `npm test` is the same command.

| To run | Command |
|---|---|
| The test files your change touches | `npm run check` |
| The whole suite | `npm run check -- --all` |
| One area, or several | `npm run check board-panel`, `npm run check sync gate` |
| Again, although it passed | add `--fresh` |

- **While you work: `npm run check`.** It compares the folder with where the branch left main (committed or not) and
  runs the test files that reach a changed file through their imports, or that name it, themselves or in any file they
  reach (a page a test reads, `package.json` that the code reads). A
  changed page no test reads runs only the guard (`test/guard.test.js`, which reads the whole repo and runs on any change). A changed file that is neither (a program a test starts, a recording) runs
  everything, and the first line says which file that was.
- **Once, at the end: `npm run check -- --all`.** The board runs the same at the finish line.
- **A reviewer runs `npm run check -- --all` as well**, and gets the worker's result (below). No second run of the suite.
- An area name stands for every `test/<name>*.test.js`: `board` is all the board files, `sync` the three `sync-*`
  files. A file's own path works too. A name no file starts with is an error that lists the areas. Which file tests
  what: the tables in [where things live](where-things-live.md).

Do not start tests another way (`node --test test/x.test.js`, a script of your own): that skips the things below.

### It remembers what passed

A test file that passed is remembered for the exact code it passed on: the git tree of the folder as it stands,
uncommitted changes and new files included. Asked again for the same code, the command answers at once
(`already passed for this exact code`) and runs nothing. The results are kept outside the worktrees
(`~/.cache/herdr-superwork-check`), so every worktree shares them: the reviewer and the board's check, on the worker's
commit, reuse the worker's passing run. Committing changes no file, so it changes nothing here; any edit does. A failed
test is never remembered. `--fresh` runs regardless.

### Runs take turns

One test run at a time on a machine (`HERDR_SUPERWORK_CHECK_SLOTS` for another number). The tests use every core, so
two runs side by side only make both slower. A run that finds the slot taken says `waiting for a turn` and starts when
it is free. If the code it was asked about passed in the meantime, it answers without running.

Turns go in order. A run that has to wait puts a file in the line (`queue/` beside the slots) and touches it while
it waits; it tries for a slot only when fewer runs came before it than there are slots. A run that went away stops
touching its file, and after five seconds it holds nobody up.

### It tells the board where it is

When the board runs the check it names a file in `HERDR_SUPERWORK_PROGRESS`, and the command writes its progress
there: how many runs are ahead while it waits, test files finished out of all of them while it runs (files that
passed before for this code count as finished), or that the answer was known at once. The board shows that on the
task as a bar, a percent and the minutes left: [the check's progress](check-progress.md). The command takes the
variable out of the environment before it starts the tests, so a test that runs a check of its own never writes
to the board's file. Run by hand, with no such file, it writes nothing (`test/check-report.js`).

### A run steps aside

A test run uses every core for ten to fifteen seconds. So that the board, the agents and what you type go first, the
command lowers its own priority before it starts the tests, and every program the tests start inherits it: niceness 5
(`NICE` in `test/check.js`; `HERDR_SUPERWORK_CHECK_NICE` for another level, `0` for none). Same tests, same results,
for everyone who runs the command; only who goes first changes. A run that was started lower still stays there. Where
the system cannot lower a priority, the run goes on as it was.

Why 5 and not the lowest: at 5 a test still gets a third of what a program at normal priority gets when both want the
same core, so a machine that is busy all the time slows the tests but never starves them. Measured on 8 cores, the
whole suite, time by the clock:

| Priority | Machine as it was (about eight agents at work) | And 8 more programs busy all the time |
|---|---|---|
| 0, as before | 13 to 15 s | 22 to 23 s |
| 5 | 12 to 15 s | 34 to 40 s |
| 10 | 15 s | 75 s |
| 19, the lowest | | not ended after 5 minutes |

How late a stand-in for the board (5 ms of work every 20 ms, at normal priority) finished its work during the run, 95
in 100 times: within 15 to 18 ms at 0, within 13 to 17 ms at 5; the worst case went from 40 to 56 ms to 30 to 36 ms. The gain is
small because the kernel already gives a program that mostly waits its turn quickly; what changes most is that agents
that work at the same time lose less to the tests.

Leaving two cores free on top of that was measured and not kept: the stand-in gained a few milliseconds more (within
10 to 14 ms), the run took about 2 s longer on the machine as it was and 41 to 47 s beside the 8 busy programs, and a
longer run keeps the one slot longer, so the others wait longer for their turn.

The budget stays fair: a run that steps aside gets less of a busy machine, and the clock's budget is stretched by
exactly that, the share other programs took while it ran. Beside the 8 busy programs no run at 5 was over its budget
by the clock. Processor time is not stretched, and a run that takes longer uses a little more of it (1 to 3 s on the
whole suite).

### The budget

The check fails, and names the file, when a test file costs more than:

| | One test file | The whole suite |
|---|---|---|
| Processor time (its own and that of the programs it starts) | 6 s | 60 s |
| Time by the clock | 6 s | 15 s |
| Programs started | 1000 | |

Processor time and the count of programs do not depend on how busy the machine is. Time by the clock does, so that
budget is stretched by how much of the machine other programs used during the run (and by how few cores it has); the
line says so when it was. A file
over its budget is not remembered as passed, so the next run measures it again; when the whole suite is over, nothing
of that run is remembered. The suite's time by the clock is measured when all of it runs in one go. The numbers are `BUDGET` in
`test/check.js`; the last line of a run shows what it cost.

Over budget: make the file's tests lighter (below), or split it by area into two files (files run side by side, the
tests in one file one after another). Do not raise the budget to get a change through.

Where it stands (8 cores, a quiet machine): 40 files, 170 tests, about 8 s by the clock, 40 s of processor time, 7000
programs started (nearly all of them git). Before the tests were made light, on the same machine: 19 s by the clock,
69 s of processor time, 20 600 programs.

## Names used and never defined

The check fails when a file uses a name it neither defines nor imports (`artifactLines(...)` with no import: what is
left behind when code moves to another file), and names the file and the line. Such a fault is otherwise found only
when that line runs. It is part of the guard (`test/guard.test.js`), so it runs on any change, over every file in
`src`, `bin` and `scripts` (a test file runs from top to bottom in every check, which finds the same there); by hand:
`node scripts/names.js`. It reads each file with the parser and the scope reading that eslint's `no-undef` rule is
built on (`espree`, `eslint-scope`), without the linter around them, which took three times the processor time; the
two are the repo's only development dependencies (`npm ci` installs them).

## Light tests

What makes a test slow here is starting programs and waiting. A new test does neither:

- **It calls the code**, in the test's own process. `world()` in `test/helpers.js` gives it a board of its own, a git
  repo and a fake herdr. The board's code still builds the same herdr command and reads the same output and exit
  status, but no program is started: the fake answers in this process, and so do the things that used to be a program
  per call (locks, the agent's own turn-end report, the list of a process's children, the version of an agent program, `gh`: `test/fake-gh.js`).
- **It does not sleep, and does not depend on the machine's speed.** `world()` sets the code's own waits to zero. For
  code that waits, `fastClock(t)` gives a clock that only moves when told to: `await clock(settle(id))` runs the code
  with its timers firing at once, `clock.tick(ms)` moves time by hand. A moment in the past or the future is written
  into the data (`t.tidy.still.at -= 3600000`), not waited for. Nothing compares against a duration it measured.
- **It shares set-up inside one test** rather than building a new world for every small assertion; a world is a git
  repo and a first commit. `toApproval(w)` is the scene most finish-line tests start from.
- **git is the one program still started**, because the board's work is git work. Ask for each fact once.

A test run never reads or writes your real board: the command gives the whole run an empty home folder of its own
(`HERDR_SUPERWORK_HOME`), so a test with no board of its own, and any program a test starts, stays out of
`~/.herdr-superwork`. When you run the program by hand while working on it, set `HERDR_SUPERWORK_HOME` to a scratch
folder first: a new version may convert what it finds in the real one.

A real program is started only where the program itself is what is tested. Those tests say so in their name
(`[real programs]`): the command line (`test/cli.test.js`), the fake herdr as a program (`test/fake-herdr.test.js`),
the check command and its slots (`test/check.test.js`), the kernel lock (`test/store.test.js`). A repo's own `setup`,
`check` and `teardown` commands are shell commands by nature, and run as such in the tests about them. `world({ program: true })`
runs the fake herdr as the program `test/bin/herdr`; a program a test starts itself (the command line) always does.

## Looking at the real thing

Tests read the board as text. A real terminal or a browser screenshot is only for a task that changes what the board
or the review page looks like; for any other task the tests are the evidence.
