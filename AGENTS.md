# Working on herdr-superwork

Several agents change this repo at once. Before you add or change anything, read
[docs/where-things-live.md](docs/where-things-live.md): it says which file holds what and where a new feature, its
tests and its words go, so that two tasks do not edit the same file.

## Tests

- While you work, run only the tests of the area you are changing: `npm test <area>`, for example `npm test board-panel`
  or `npm test sync gate` (every `test/<area>*.test.js`). Do not run the whole suite after each edit.
- Run the whole suite once, at the end, before you finish: `npm test`.
- If `npm test` ends with a `⚠ slow test files` note naming a file you changed, split that file or make its tests
  cheaper before you finish.
- Reviewing: run the areas the change touches; the check has run the rest.

More in [docs/testing.md](docs/testing.md).
