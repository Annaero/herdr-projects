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
- `docs/archive/` holds one-off reports. Nothing there is kept up to date.

## Tests

- While you work, run only the tests of the area you are changing: `npm test <area>`, for example `npm test board-panel`
  or `npm test sync gate` (every `test/<area>*.test.js`). Do not run the whole suite after each edit.
- Run the whole suite once, at the end, before you finish: `npm test`.
- If `npm test` ends with a `⚠ slow test files` note naming a file you changed, split that file or make its tests
  cheaper before you finish.
- Reviewing: run the areas the change touches; the check has run the rest.

More in [docs/testing.md](docs/testing.md).
