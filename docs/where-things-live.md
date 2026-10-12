# Where things live

Several agents work on this repo at once, each in its own worktree. Two tasks that change different things should
touch different files, so they merge without conflicts. This page says which file holds what, and where a new
feature of each kind goes. Keep it true: when you add a file, add its line here.

## Rules

- **One area, one file.** Put a change in the file of its area. If a file grows a second area, or passes about 250
  lines, split it rather than append to it.
- **Never append to the end of a shared list.** In a list that many tasks add to (the settings in `src/store/settings.js`,
  the `?` menu, the table in `docs/checked-on-herdr.md`), put the new line next to the lines it belongs with. Two
  tasks that both append at the end always conflict.
- **A new test goes in the test file of its area**, or in a new `test/<area>.test.js`. `npm test` runs every
  `test/*.test.js`. Never one catch-all test file.
- **A new feature's words go in its topic's page under `docs/`**, not in `README.md`: the README is only the
  introduction, the install steps and the list of pages.

## The board's screen: `src/board/`

`view.js` is small: the `View` class with its fields, its start-up, its once-a-second beat and its saved choices. The
rest of `View` is in `view/`, one file per area. Each file there is a class whose methods are copied onto `View` (the
loop at the end of `view.js`), so inside any of them `this` is the one `View`, and a method in one file calls a
method in another as `this.name()`. A new area is a new file there, added to that loop.

| To change | File in `src/board/view/` | Its tests |
|---|---|---|
| Which rows the list has, selection, the header line, the groups | `list.js` | `test/board-list.test.js` |
| One row: its mark, name, sentence, columns (bar, percent, review tag, PR, time) | `row.js` | `test/board-rows.test.js` |
| The chat: who it talks to, its first line, the latest message | `chat.js` | `test/coordinator-chat.test.js` |
| The text box and its placeholder | `textbox.js` (the editor itself: `../editor.js`) | `test/board-textbox.test.js` |
| A task agent's pane: its screen, its last message, going into it | `agent-pane.js` | `test/board-keys.test.js` |
| The Coordinator from the board: sending, going in, restart | `coordinator.js` | `test/coordinator-*.test.js` |
| The task panel: its order, the description, "the agent said", fitting a short window | `panel.js` | `test/board-panel.test.js` |
| The panel's top: title, where it stands, what it needs from you | `panel-status.js` | `test/board-panel.test.js` |
| Reviews in the panel | `panel-reviews.js` | `test/board-review.test.js` |
| The panel's settings and session rows (a new setting's row) | `panel-settings.js` | `test/board-review.test.js` |
| What the panel's parts are drawn with: headlines, boxes, callouts | `panel-kit.js` | |
| What a key does | `keys.js` | `test/board-keys.test.js` |
| The `?` menu and its list of keys | `menu.js` | `test/board-actions.test.js` |
| The hint line | `hints.js` | `test/board-panel.test.js` |
| A question the board asks (`y = yes · n = no`) | `ask.js` | `test/board-actions.test.js` |
| What an action does: yes, send back, stop, delete, undo, archive | `actions.js` | `test/board-actions.test.js`, `test/board-reply.test.js` |
| What goes where on the screen, and what gives way | `layout.js` | `test/board-layout.test.js` |
| The window's size, a terminal held by another viewer | `size.js` (and `../held.js`) | `test/board-size.test.js` |
| The first-run screen | `setup.js` | `test/board-setup.test.js` |
| Other machines on the board, whose board you see | `remotes.js` | `test/remote.test.js` |
| Tasks told to the terminal (OSC 7501) | `osc.js` | |
| A task's group and colour; whether it waits for you | `states.js` | |
| A review's result in words and colour; a row's `R#2 ✓` tag | `review-words.js` | `test/board-review.test.js` |
| Small shared words: ages, PR numbers, cut text | `words.js` | |

Colours and herdr's theme are `src/board/theme.js` (`test/theme.test.js`). Evidence lines are
`src/board/artifact-lines.js`.

## Everything behind the screen: `src/`

| To change | File |
|---|---|
| Settings and their defaults: yours, one task's own, the repo's file | `store/settings.js` |
| Tasks on disk: reading, listing, changing, creating | `store/tasks.js` |
| A task's reviews as saved: the current one, the round, the history | `store/reviews.js` |
| Saved failures and login failures | `store/failures.js` |
| The wait before a turn cut off by its provider is tried again | `store/retries.js` (which errors pass: `providerError` in `agents.js`; tests: `test/retry.test.js` on the recorded endings in `test/fixtures/endings/`) |
| An agent's inbox, instructions for a Coordinator | `store/inbox.js` |
| Git plumbing, repos and their names | `store/repos.js` |
| The data folder, reading and writing files, locks, the stages | `store/files.js` |
| Stamps, hook tokens, marks | `store/marks.js` |
| What a stage and herdr's status mean for the board | `state.js`, `flow.js` |
| Actions on a task (add, tell, approve, retry, archive) | `actions.js` |
| Starting an agent, its rules, its worktree | `delegate.js`, `agents.js` |
| The finish line: check, review, pull request | `finish.js` |
| What a review's findings decide | `gate.js` |
| Merging and staying current with main | `land.js`, `sync.js` |
| The Coordinator | `coordinator.js` |
| The keeper, the hook, cleanup | `keeper.js`, `hook.js`, `housekeeping.js` |
| Other machines | `remote.js` |
| The command line | `cli.js` |
| What the plugin adds to herdr's settings | `extras.js` |

`store.js` itself only passes these on, so the rest of the code still says `S.name`. A new kind of saved thing is a
new file in `store/`, with one line added to `store.js`.

## Tests: `test/`

One file per area, named after it: `board-*.test.js` for the screen (table above), `coordinator-*.test.js`,
`flow.test.js`, `gate.test.js`, `sync-*.test.js`, `remerge.test.js` (a review that stands after a merge of main), `store.test.js`, `theme.test.js`, `watcher.test.js`, `remote.test.js`, `cli.test.js`,
and the rest. Shared setup: `helpers.js` (a test world), `board-helpers.js` (a board opened on it),
`coordinator-helpers.js` (a world with a Coordinator).

## The pages: `docs/`

`README.md` lists them. One page per topic: `board.md`, `task-panel.md`, `keys.md`, `coordinator.md`,
`roles-and-commands.md`, `how-work-gets-done.md`, `gate.md`, `settings.md`, `other-machines.md`,
`checked-on-herdr.md`, `compared-with-pi-work.md`, `provider-errors.md`. A new key goes in `keys.md`, a new setting in `settings.md`, a
newly verified fact in `checked-on-herdr.md` beside the rows of its kind.
