# The home folder: where the board keeps its files

Everything the board keeps for you is in one folder, the same on every machine: `~/.herdr-superwork/`.

```
~/.herdr-superwork/
  settings/     config.json: your own preferences (docs/settings.md)
  data/         everything the board writes while it runs
    tasks/<repo>/<n>/        one folder per task: task.json, inbox.jsonl, artifacts/
    coordinator/<session>/   the Coordinator's saved state, and chat/, the folder it starts in
    bin/herdr-superwork      the command agents are handed, by its full path
    locks/ stamps/ *.json *.log   the board's own bookkeeping
  reports/      pages and reports an agent made for you that belong in no repo, one folder per task
  moved.json    written by the one-time move below: what was moved, from where
  set-aside/    only after a move that found a file in both places: the copy that was not kept in use
```

| To put somewhere else | Set |
|---|---|
| the whole folder | `HERDR_SUPERWORK_HOME` |
| only the data | `HERDR_SUPERWORK_DATA_DIR` |
| only the settings | `HERDR_SUPERWORK_CONFIG_DIR` |
| only the reports | `HERDR_SUPERWORK_REPORTS_DIR` |
| only the folder the Coordinator starts in | `HERDR_SUPERWORK_COORDINATOR_DIR` |

The `XDG_*` variables (`XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`) no longer choose a place. They are
read for one thing only: to find where an older version kept its files, for the move below.

## The same name in a repo is something else

A repo the board works in gets a `.herdr-superwork/` folder too (ignored by git): a task's closing note
(`closing-<n>.md`) and a review's files (`review-<n>/`) go there. Tasks whose repo is your home folder itself
write those into `~/.herdr-superwork/`, beside the folders above. That is where a `closing-1.md` in the home folder
comes from. The two never meet: the board's own folders are `settings`, `data`, `reports` and `set-aside`, a task's
files are `closing-<n>.md` and `review-<n>`. The board never clears the home folder, and neither the move nor
anything else touches a file there it did not write. `.herdr-superwork.json` (a repo's own settings) is a file of
another name.

## What stays outside it

- The how-to file in each agent program's own skills folder (`~/.claude/skills/herdr-superwork` and the others)
  and the marked blocks in herdr's `config.toml`: they have to be where those programs read them.
  `herdr-superwork remove-extras` takes them out ([installing](install.md)).
- The trust mark for a repo, in the agent program's own settings (`~/.claude.json`, `~/.codex/config.toml`).
- This repo's own test runner keeps what already passed in `~/.cache/herdr-superwork-check` ([tests](testing.md)).
  That is the cache of a tool for working on this code, not something the board keeps for you: it can be deleted
  at any time.

## Coming from an older version: the one-time move

Older versions kept the data in `~/.local/state/herdr-superwork`, the settings in `~/.config/herdr-superwork`, and
agents put reports in `~/.local/share/herdr-superwork-reports`. The first run of a new version moves all three into
`~/.herdr-superwork/` by itself: any run, the board, a command, or the hook herdr calls. It then says so once, in one
line, the first time you would see it (on the board when it opens, or after a command you typed):

    Moved the board's files into ~/.herdr-superwork: data (from ~/.local/state/herdr-superwork), settings (from
    ~/.config/herdr-superwork), reports (from ~/.local/share/herdr-superwork-reports). The old places are links to
    the new ones, so whatever is running carries on.

How it is safe:

- **Nothing is copied or deleted, and no old path is ever missing.** The old path is the folder itself, and then,
  in one step, a link to where the folder now is. Each folder goes in three steps, each of them whole or not done:
  two spare links are made (`<old>.moving` and the new place); the old folder and the spare link change places; the
  new place and the spare name change places. "Change places" is one call to the system (Linux `renameat2`, a Mac's
  `renamex_np`; `python3` makes the call, since Node cannot), so a command started at the old path at any moment
  finds its file. A run that was cut off is carried on by the next one from the shape it left, and a second run
  finds nothing to do. `moved.json` is written before the first step.
- **The old places become links to the new ones.** So everything that still holds an old path keeps working on the
  same files: a board or keeper that is still running the old code, the command path agents were handed
  (`~/.local/state/herdr-superwork/bin/herdr-superwork`), the hook settings of running agents, a task's saved
  artifacts, the page server. A lock is one file whichever path it is taken by, so the old and the new code still
  take turns. The links can be removed once nothing that was started before the move is still running; the board
  leaves them.
- **Data that is already in the new place is never written over.** What the new place holds is first put into the
  old folder (the one in use), then the folder moves as above. Whatever only one side has is kept. Of a file both
  have, the newer one stays in use and the other one is kept in `set-aside/`, and the line says how many.
- **Nobody's lock is taken from under it.** When both places have the same lock file, the one in the old place
  (the place in use) is the lock and is never replaced or removed: a process that holds it, or has opened it and
  is about to take it, still has the one real lock afterwards. The new place's copy goes, and only while nobody
  holds it; while one does, that folder is not moved now and a later run moves it. And the board itself, after it
  takes a lock, checks that what it holds is still the file at that path, and takes the one there when it is not.
- **A run never starts on an empty new place.** Whatever has not moved when a run begins (another run is still
  moving it after three seconds of waiting, a step failed, a lock in the new place was held) is used where it is, in the old
  place, for that run.
- **No way to change two paths in one step** (no `python3`, a system without that call), **or the old place is on
  another disk:** the folder stays where it is and the new place becomes a link to it. Still one folder to look
  in, still no moment without the old path, and the line says so.
- **A folder you named yourself stays.** With `HERDR_SUPERWORK_DATA_DIR` (or the settings or reports one) set to a
  place of your own, that part is not moved.
- **Only the copy the board runs from moves anything.** A second checkout of this code (a git worktree an agent
  works in, a copy under test) leaves the files alone and works on the board where it is.

**The Coordinator's conversation.** Its folder moves with the data (`data/coordinator/<session>/chat`), and a
Coordinator that is running stays in it. After its next restart it is in the same conversation: the board reopens
it by its id, and all three programs find a conversation by id from the moved folder (tried for real with Claude
Code 2.1.296, which keys its saved conversations by folder: `--resume` found it and went on in it; Codex and pi
keep theirs by date and by id). A program started before the move still knows its folder by the old path, and
saves a new chat (`/clear`, `/new`) under that one: the board looks there too, so it is followed as always.

## Undoing it

Stop the board, remove the three links, move `data`, `settings` and `reports` back to the old places, and run the
old version. Nothing else was changed.
