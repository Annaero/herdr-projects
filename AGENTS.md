# Working on herdr-superwork

Several agents change this repo at once. Before you add or change anything, look at the map: it says which file
holds what, so that two tasks do not edit the same file.

- `node scripts/docs.js --where` prints all of it; `node scripts/docs.js --where src/board/view` only that folder.
- It is also a page in your own folder, `docs/where-things-live.md`, written by the workspace setup and by
  `npm run check`. It is not in git: never commit it. The tests are one file per area: `ls test`.

## Where new things go

- **One area, one small file.** Put a change in the file of its area. A new area is a new file, not more lines at
  the end of an old one. A source file may not pass 300 lines (the check fails): split it by area into a folder of
  small files with the old file passing them on, as `src/finish.js` and `src/finish/` do.
- **Every source file starts with a comment that says what it holds.** The map is made from those comments.
- **A part of the board's screen is a file in `src/board/view/`** that names its part (`export const part = …`).
  `src/board/view.js` loads every such file: there is no list to add it to, and no import to write there.
- **A key is one entry in `src/board/keys.js`**: its chord, its name, what it does, its hint, its line in the `?`
  menu. The key handler, the menu, the hint line and `docs/keys.md` all read that list. Never write a key's name
  into a message: say `keyName("undo")`.
- **A setting is one entry in `src/store/settings-list.js`**: its default and what it means. Its row in the task
  panel is `src/board/view/panel-settings.js`.
- **In a list many tasks add to, one entry per line (or per block), placed beside the entries it belongs with**, never
  at the end: two additions at the end always conflict.
- **Never edit a made table by hand**: what is between the `made:` lines in `docs/keys.md` and `docs/settings.md`.
  Change the code; `npm run check` writes the table when it is out of date and says so (`node scripts/docs.js` does
  the same): commit what it wrote. A merge conflict in a made table is settled the same way: run the command, do not
  pick lines.
- **A task's words go in the `docs/` page of its own topic, and only there.** A new topic is a new page. A page that
  grows a second topic is split.
- **Do not touch `README.md` for feature work.** It is only what this is and how to install and start it. It has no
  list of pages: a new page is found in `docs/`.
- **A report, a review or a research result is never committed to the repo**, in no folder. It is kept in the task's
  own folder among the board's reports (`~/.herdr-superwork/reports/<repo>/<task number>/`, outside every repo) and
  shared as a private link by the board ([docs/research.md](docs/research.md)).

## Tests

One command runs tests, for everyone: `npm run check` (`npm test` is the same). Never start the tests another way
(`node --test`, a loop of your own): the command remembers what already passed for this exact code and for what is
installed, and shares that with the reviewer and the board.

- **While you work, run the tests of what you touched**: `npm run check`. It picks the test files your change reaches
  and answers at once when they already passed for this code. `npm run check board-panel` runs one area (every
  `test/board-panel*.test.js`), `npm run check gate sync` several. A run of 8 files or fewer starts at once.
- **The board runs the whole suite at the end**, when you finish: `npm run check -- --all`. Run that yourself at most
  once, last of all, when your task asks for it; never after each edit. The board's run then answers at once.
- **Never wait in a loop for the machine to be quiet**, and never look at the load before a run. A busy machine fails
  nothing: the whole suite has no time budget (its totals are only printed), and one file's clock budget stretches
  with the load. `waiting for a turn` means another whole run goes first: leave it, it starts by itself.
- A failed test is the only thing to fix. When one file is over its own budget the check names it: make its tests
  lighter or split the file; do not work around the budget.
- The check writes the made tables (`docs/keys.md`, `docs/settings.md`) when they are out of date and says so: commit
  them. `--fresh` runs again what already passed; you rarely need it.
- New tests are the light kind: they call the code in the test's own process (`world()` in `test/helpers.js`), start
  no program, and never sleep or depend on the machine's speed (move the clock: `fastClock`). A real program only when
  the program itself is what is tested, in a test whose name starts with `[real programs]`.
- A look at the real thing (a real terminal, a browser screenshot) only for a task that changes what the board looks
  like.

How it works, and why: [docs/testing.md](docs/testing.md). You do not need it to start.
