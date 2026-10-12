# Tests

A fake herdr and scripted fake agents: no model calls, no real board, no real herdr. Everything is in `test/`.

## Running them

| To run | Command |
|---|---|
| Everything | `npm test` |
| One area | `npm test board-panel` |
| Several areas | `npm test sync gate` |

An area name stands for every `test/<name>*.test.js`: `board` is all eleven board files, `board-panel` is one, `sync`
is the three `sync-*` files. A file's own path works too (`npm test test/gate.test.js`). A name no file starts with is
an error that lists the areas. Which file tests what: the tables in [where things live](where-things-live.md).

## While you work, and before you finish

- **While working, run only the area you are changing**: `npm test <area>`. That is seconds. Do not run the whole
  suite after every edit.
- **Run the whole suite once, at the end**, before you finish: `npm test`. It is also the repo's check, so the board
  runs it again at the finish line.
- **A reviewer** runs the areas the change touches, and trusts the check for the rest.

## Slow test files

`npm test` ends with a `⚠ slow test files` note naming each file that took longer than 25 seconds. If a file you
changed is named there, fix it before you finish: split it by area into two files (files run side by side, tests in
one file run one after another), or make its tests cheaper. The time is the file's tests added up, by the clock, so
a machine busy with other work (several agents testing at once) stretches it: the note says so when the machine is
busy, and then `npm test <that file's area>` by itself shows the file's own time. `HERDR_SUPERWORK_TEST_SLOW_S=60 npm
test` sets another limit for one run.

What makes a test slow here is starting programs. Hence:

- **The fake herdr answers in the test's own process.** `world()` in `test/helpers.js` sets this up: the board's code
  still builds the same command and reads the same output and exit status, but no program is started. Starting node
  for each of a test's hundreds of herdr calls used to be nine tenths of the suite's time. A program the test starts
  itself (the command line, an agent's hook) still runs the fake as a real program, `test/bin/herdr`, and so does a
  test that asks for it with `world({ program: true })`. `test/fake-herdr.test.js` holds both ways to the same answers.
- **Call the code, do not start the command line**, unless the command line is what the test is about
  (`test/cli.test.js`).
- **Share set-up inside one test** rather than building a new world for every small assertion; a world is a git
  repo and a first commit.
- **Avoid real waiting.** `world()` sets the code's own waits to zero or a few milliseconds; keep any sleep a test
  adds as short as what it proves allows.
