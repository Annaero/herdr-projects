# Older installs: herdr-superwork and herdr-projects 0.2

Two older programs may be on a machine when this version of herdr-projects first runs, and both use names this
version needs:

- **herdr-superwork**, the working title of this version, kept everything in `~/.herdr-superwork/` (tasks, settings,
  reports, the Coordinator's chat) and wrote `# >>> herdr-superwork …` blocks in herdr's config, a `herdr-superwork`
  how-to in each agent program's skills folder, and ran its own keeper and page server (with the web UI's front door).
- **herdr-projects 0.2** (the old Rust program, now on the `legacy` branch) kept its projects in `~/.herdr-projects/`,
  this version's home folder, its settings in `~/.config/herdr-projects/`, a file in herdr's state folder for the
  plugin, and changed herdr's config, the agent programs' settings (hooks) and their skills folders.

The first run of this version (any run: the board, a command, the hook herdr calls) takes both over by itself, and
says what it did once, in a line, on the terminal or on the board when it next opens. `herdr-projects doctor` looks
again at any time, takes over whatever is left, and says where things stand; `herdr-projects install` ends with the
same lines. Running either again changes nothing.

## herdr-projects 0.2: set aside, never mixed, never deleted

- **Its projects.** A `~/.herdr-projects` that holds the old version's projects (folders with a `PROJECT.md`) or its
  own files (`.ticker.log`, `.machines.json`, …) is renamed to `~/.herdr-projects-legacy`, whole and as it is. When
  this version's files are there too, only the old version's go, into that folder. Its ticker is asked to stop first,
  its own way (a `.ticker.stop` file), then with a signal; while it still runs nothing is moved, and the next run
  tries again. The old version finds its projects there again with `HERDR_PROJECTS_ROOT=~/.herdr-projects-legacy`.
- **Its settings** (`~/.config/herdr-projects`) go to `~/.config/herdr-projects-legacy`, and herdr's state folder for
  it (`~/.local/state/herdr/plugins/herdr-projects`, which this version shares by its id) to
  `…/herdr-projects-legacy`.
- **What would clash** is taken out, and only that: in herdr's config its key (the `herdr-projects.open-popup`
  action), its line in the tab bar (`… needs-you --line`) and its sidebar rows (the `$hp_…` tokens; where it had put
  one row in place of herdr's two, herdr's two come back); its hooks in Claude's, Codex's, Droid's, Gemini's and
  Copilot's settings (`… herdr-projects --root … hook --agent …`), each file backed up first
  (`<file>.bak-herdr-projects`); its `autoproject` skill links; and the `herdr-projects` link it put on your PATH when
  that points into herdr's plugins and not at this program. Every other line stays as it was.
- `HERDR_PROJECTS_ROOT` is read by the old version only: `doctor` says so when it is set.

## herdr-superwork: moved into ~/.herdr-projects, carried on

- **The folder.** `~/.herdr-superwork` becomes `~/.herdr-projects` in the same three whole steps as the one-time move
  of the home folder ([the home folder](home-folder.md)): no moment without either path, a run cut off is finished
  by the next. `~/.herdr-superwork` is left a link to the new folder, so an agent, a hook or a page that still holds
  an old path carries on; remove it once nothing started before the move still runs. A `~/.herdr-projects` with
  this version's files in it already is merged as that move merges (the newer of a file both have stays in use, the
  other goes to `set-aside/`). The old projects are set aside first: the two are never mixed.
- **The paths inside it.** What the board reads back (its `.json`, `.jsonl` and `.md` files in `data/` and
  `settings/`) has every path into `~/.herdr-superwork` made the same path into `~/.herdr-projects`, and the
  command agents were handed (`…/data/bin/herdr-superwork`) the new one (`…/data/bin/herdr-projects`). A repo's
  name in a task's id (`herdr-superwork/218`) is a name, not a path, and stays: tasks, keys (`HSW-218`) and history
  carry over as they are. Kept as it was: a task's artifacts, reports, the Coordinator's chat folder, the copies an
  older version kept (`data-0.2.0`), and the record of earlier moves. The old launcher, `data/bin/herdr-superwork`,
  now runs this program, for the agents that still use it.
- **The Coordinator's conversation** carries on: it is found by its id from the moved folder after its next
  restart, as after the first move.
- **Its processes.** Its keeper and its page server (with the web UI's front door) are stopped, only when the
  program they run is herdr-superwork's, and this version's are started. The front door opens on the port the old
  one had, so the web UI's shared link points at the new one without a change; a link that moved is brought along
  ([the board in the herdr web UI](web-ui.md)).
- **Its plugin**, when herdr still has `herdr-superwork` installed, is switched off (`herdr plugin disable`, not
  removed), so its hooks no longer run the old program on the moved board.
- **Its extras** become this version's: its marked blocks in herdr's config (`# >>> herdr-superwork key`,
  `… sidebar`) are replaced by this version's with the same key, a binding of a `herdr-superwork.<action>` names
  `herdr-projects.<action>` (the same action), its how-to folders are removed and this version's written. herdr's
  config is changed only after `herdr config check` accepts the result on a copy, backed up first, and put back when
  herdr rejects it; `doctor` says so and tries again. herdr's own config and state folders for the plugin are taken
  over into `herdr-projects`'.
- **A repo's own settings file**: a repo that still has only `.herdr-superwork.json` keeps its settings; the
  board reads that file until the repo has a `.herdr-projects.json`.

## Only the copy the board runs from

Like the one-time move, nothing of this is done by a copy of the program in a git worktree (an agent working on this
code), by the tests, or by `help`, `version` and `docs`.

## Undoing it

Stop the board. Rename the `-legacy` folders back for herdr-projects 0.2. For herdr-superwork: remove the link
`~/.herdr-superwork`, rename `~/.herdr-projects` back to it, and make `~/.herdr-projects` a link to it (the paths
written inside now name `~/.herdr-projects`). The backups of herdr's config and of the agents' settings are beside
them (`.bak-herdr-projects`), and `herdr plugin enable herdr-superwork` switches its plugin on again.
