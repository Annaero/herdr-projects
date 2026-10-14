# Tests

A fake herdr and scripted fake agents: no model calls, no real board, no real herdr. The tests are in `tests/`, one
file per area, with what they share in `tests/common/`; small tests of one function sit beside it in `src/`
(`#[cfg(test)]`). What to run, and when, is in [AGENTS.md](../AGENTS.md); this page says how the command works and why.

## One command

Everything that runs tests uses the same command: you, an agent at work, the reviewer, and the board's own check
(`check` in [`.herdr-superwork.json`](../.herdr-superwork.json)). `npm test` is the same command; both run
`scripts/check.sh`, and nothing of Node is used but the name.

| To run | Command |
|---|---|
| Everything | `npm run check`, or `npm run check -- --all` |
| One area: its test files (`tests/board_panel.rs`, `tests/board_panel_*.rs`) | `npm run check board-panel`, `npm run check gate sync` |
| Only the tests whose names hold a word | `npm run check textbox` |
| Again, although it passed | add `--fresh` |

A name is first an area: `board-panel` (or `board_panel`) runs `tests/board_panel.rs` and every
`tests/board_panel_*.rs`. A name that is no area is matched against each test's own name, as `cargo test` matches it:
a test's function name in `tests/` (`the_hint_line_names_the_task_once_…`), and the module path of a test in `src/`.
`npm run check textbox` runs the tests that say `textbox`, wherever they are. A word that matches no test runs none,
and passes.

It does four things, in this order, and stops at the first that fails:

1. **Builds the program** with the `quick` profile (`Cargo.toml`): a build with few optimisations and no debug data,
   quick to build again after a small change. The release build, for the files people install, is another profile
   ([installing](install.md)).
2. **Writes the made tables** when they are out of date (`herdr-superwork docs`): the keys in `docs/keys.md`, the
   settings in `docs/settings.md`, and the map in your own folder. It says which it wrote: commit the tables.
3. **Checks the repo's own rules** (`herdr-superwork docs --guard`, which `tests/guard.rs` runs too): no source file
   past 300 lines, every source file starts with a comment that says what it holds, a key's chord written only in
   `src/board/keys.rs`, and no made table out of date.
4. **Runs the tests**: `cargo test`, with the names you gave.

The old program's check had to find names used and never defined, and which test files a change reached through its
imports. The compiler does the first now (such a file does not build), and a build is one whole: there are no
separate test files to pick.

### It remembers what passed

A run that passed is remembered for the exact code it passed on: the git tree of the folder as it stands
(uncommitted changes and new files included), the compiler's full version (`rustc -V`), and the names it was given.
Asked again for the same, the command answers at once (`The check already passed for this exact code.`) and runs
nothing. The results are kept outside the worktrees (`~/.cache/herdr-superwork-check`), so every worktree shares
them: the reviewer and the board's check, on the worker's commit, reuse the worker's passing run. Committing changes
no file, so it changes nothing here; any edit does.

A failed run is never remembered. A run with names is remembered as that run only: `npm run check textbox` passing
says nothing about the whole. `--fresh` runs regardless.

### Builds take turns

Cargo lets one build at a time use a folder's `target/`: a second one says `Blocking waiting for file lock` and goes
on when the first is done. Each worktree has a `target/` of its own, so this happens only within one folder. There
are no other turns and no slots: one run is one build and one `cargo test`, which runs the test files one after
another and the tests within a file side by side.

### It tells the board where it is

When the board runs the check it names a file in `HERDR_SUPERWORK_PROGRESS`, and the command writes its progress
there: which of its three steps it has done (`1/3 steps`), or that the answer was known at once. The board shows that
on the task: [the check's progress](check-progress.md).

### No budget

No test and no run has a time budget, and nothing is measured against the clock. The old check had budgets per
file and lowered its own priority, because every test file was a program of its own that started more programs; a
test here is a function in a test program, and the light ones start nothing. So: never wait for a quiet machine,
and never cut a test to fit a time.

## Light tests

What makes a test slow is starting programs and waiting. A new test does neither:

- **It calls the code**, in the test's own process. `world()` in `tests/common/mod.rs` gives it a board folder of its
  own, a git repo and a fake herdr. The board's code still builds the same herdr command and reads the same answer and
  exit status, but no program is started: `herdr::cli::set_fake` hands the call to the fake, which answers in the
  test's own thread. `gh` is faked the same way (`flow::git::set_fake_gh`, `tests/common/gh.rs`).
- **It does not sleep, and does not depend on the machine's speed.** `world()` sets the code's own waits to zero.
  The clock is `sw::clock`: `set` stands it at a moment and `advance` moves it on, on the test's thread only. A
  moment in the past or the future is written into the data, not waited for. Nothing compares against a duration it
  measured.
- **The board's background jobs run when the test says.** What would be a detached runner (delegating, the finish
  line, a merge) is put in a list instead (`HERDR_SUPERWORK_INLINE`), and `settle(id)` runs that list, then lets the
  hook look at the agent's pane, round after round until nothing moves. `settle_all(id)` does the same for a task
  done several times at once.
- **It shares set-up inside one test** rather than building a new world for every small assertion; a world is a git
  repo and a first commit. `to_approval(&w, title)` is the scene most finish-line tests start from.
- **git is the one program still started**, because the board's work is git work. Ask for each fact once.

A world sets the process's environment, so the tests of one file that make a world take turns (a lock in
`tests/common/mod.rs`); the files run one after another.

### The stand-ins

- **The fake herdr** (`tests/common/herdr.rs`, with `panes.rs`, `agents.rs` and `worktrees.rs`): its whole world is
  one JSON record (spaces, tabs, panes, their agents, every call it was asked), which a test reads (`w.state()`,
  `calls(&w)`) or changes (`w.patch`, `set_status`). Its worktrees are made with git itself.
- **Scripted agents** (`tests/common/agents.rs`): a test gives each role its turns,
  `w.script(json!({"worker": [step, …], "reviewer": […], "picker": […], "coordinator": […]}))`. Each prompt plays
  the role's next step: it writes files, commits, and writes the closing note, the plan, the verdict or the
  comparison where the board tells an agent to. A step may end its turn with a recorded ending of a real agent's
  conversation (`tests/fixtures/endings`, `tests/common/endings.rs`) and run the agent's own turn-end report.
- **Notes written between the board's jobs.** A real agent writes its closing note after the board armed the turn
  it ends. The fake writes the notes of the turns that ended so far between the board's jobs (`flush()`, which
  `settle` calls), stamped after that moment, however slow the machine running the test.
- **The rows every screen test draws** (`tests/common/fixtures.rs`): one task in each state the board shows, with the
  long, wide and odd text that breaks a layout. A new state is one new row there, and every screen test draws it.

## Four kinds of tests

- **The board's state, updated.** `common::board::open(&w.root, rows)` opens the real board on a world, without a
  terminal: `press(&["alt+t", "esc", "ctrl+l"])` and `typed("…")` go through the board's one `update`, what they start
  runs at once, and `text()`, `screen(cols)`, `chat(cols)` and `draft(cols)` read the screen as plain text. Most
  tests of the board are of this kind.
- **Whole frames** (`tests/board_frames.rs`): the board drawn by the terminal drawer into cells, at ten sizes from
  10×8 to 200×60, each with the list, the task beside it, the whole task, the `?` menu and a draft. Each is compared
  with the frame kept in `tests/frames/`, once as text and once with each cell's colour as a letter (with a legend).
  A missing frame is written; `UPDATE_FRAMES=1` writes them all again, for a change to what the board looks like.
  Look at what changed before you commit it. Every frame also holds to the rules that need no picture: no line over
  the width, the hint line last.
- **The board as data for the web page** (`tests/web_board.rs`): `common::board::web(&w, call, args)` asks the web
  board what the page would ask, on the same world: the same list, groups, marks and words as the terminal board,
  and its buttons pressing the board's own keys.
- **A real terminal**, a few: `tests/real_terminal.rs` starts the built program in a pseudo-terminal and drives it
  as a terminal would: it starts and draws, takes a burst of keys, resizes cleanly, and on closing gives the
  terminal back exactly as it was.

A test never reads or writes your real board: `world()` gives it a home folder of its own (`HOME`,
`HERDR_SUPERWORK_HOME`), takes herdr's own variables (a pane's id, its socket), `TMUX` and `NO_COLOR` out of the
environment, and points herdr at a socket of its own. When you run the program by hand while working on it, set
`HERDR_SUPERWORK_HOME` to a scratch folder first: a new version may convert what it finds in the real one.

A real program is started only where the program itself is what is tested. Those tests say so in their name
(`real_programs_…`): the command line (`tests/cli.rs`), another machine's door (`tests/remote.rs`) and the real
terminal (`tests/real_terminal.rs`). They run the program cargo built for the tests, inside the test's world, with
no herdr to reach. A repo's own `setup`, `check` and `teardown` commands are shell commands by nature, and run as
such in the tests about them.

## Looking at the real thing

Tests read the board as text and as frames. A real terminal or a browser screenshot is only for a task that changes
what the board or the review page looks like; for any other task the tests are the evidence.
