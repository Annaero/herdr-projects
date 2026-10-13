# Working on herdr-superwork

Several agents change this repo at once. Before you add or change anything, read
[docs/where-things-live.md](docs/where-things-live.md): it says which file holds what and where a new feature, its
tests and its words go, so that two tasks do not edit the same file.

## Where new things go

- **One area, one small file.** Put a change in the file of its area. A new area is a new file, not more lines at
  the end of an old one. A source file may not pass 300 lines (the check fails): split it by area into a folder of
  small files with the old file passing them on, as `src/finish.js` and `src/finish/` do.
- **Every source file starts with a comment that says what it holds.** `docs/where-things-live.md` is made from
  those comments.
- **A key is one entry in `src/board/keys.js`**: its chord, its name, what it does, its hint, its line in the `?`
  menu. The key handler, the menu, the hint line and `docs/keys.md` all read that list. Never write a key's name
  into a message: say `keyName("undo")`.
- **A setting is one entry in `src/store/settings-list.js`**: its default and what it means. Its row in the task
  panel is `src/board/view/panel-settings.js`.
- **In a list many tasks add to, one entry per line (or per block), placed beside the entries it belongs with**, never
  at the end: two additions at the end always conflict.
- **Never edit a made page by hand**: `docs/where-things-live.md`, and the tables between the `made:` lines in
  `docs/keys.md` and `docs/settings.md`. Change the code, run `node scripts/docs.js`, commit what it writes. The
  check fails when one is out of date (`node scripts/guard.js`). A merge conflict in a made page is settled the same
  way: run the command, do not pick lines.
- **A task's words go in the `docs/` page of its own topic, and only there.** A new topic is a new page. A page that
  grows a second topic is split.
- **Do not touch `README.md` for feature work.** It is only what this is, how to install and start it, and the list
  of pages; a new page adds one line to that list.
- **A report, a review or a research result is never committed to the repo**, in no folder. It is kept in the task's
  own folder among the board's reports (`~/.herdr-superwork/reports/<repo>/<task number>/`, outside every repo) and
  shared as a private link by the board ([docs/research.md](docs/research.md)).

## Tests

One command runs tests, for everyone: `npm run check` (`npm test` is the same). Never start the tests another way
(`node --test`, a loop of your own): the command remembers what already passed for this exact code, and makes test runs
on this machine take turns.

- While you work: `npm run check`. It runs only the test files your change touches, and answers at once when they
  already passed for this code. `npm run check board-panel` runs one area.
- Once, at the end, before you finish: `npm run check -- --all`, the whole suite. Not after each edit.
- Reviewing: `npm run check -- --all` too. For code the worker's run already passed, it answers at once: do not run the
  tests again some other way.
- New tests are the light kind: they call the code in the test's own process (`world()` in `test/helpers.js`), start
  no program, and never sleep or depend on the machine's speed (move the clock: `fastClock`). A real program only when
  the program itself is what is tested, in a test whose name starts with `[real programs]`.
- The check fails when a test file or the whole suite is over its budget, and names the file. Make its tests lighter
  or split the file; do not work around the budget.
- A look at the real thing (a real terminal, a browser screenshot) only for a task that changes what the board looks
  like.

More in [docs/testing.md](docs/testing.md).
