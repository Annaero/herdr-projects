# Where things live

<!-- Made by `node scripts/docs.js` from the comment at the top of each file. Do not edit this page: change the
     file's own comment, then run the command again. -->

Which file holds what. Every line is the first sentence of the comment at the top of that file, so the page is
never edited by hand: `node scripts/docs.js` writes it, and the check fails when it is out of date. Where a new
thing goes is in [AGENTS.md](../AGENTS.md).

## `src/`

| File | Holds |
|---|---|
| `actions.js` | The exact actions of the board, also the subcommands any agent can run from its shell |
| `agents.js` | Everything agent-specific: the table of agent programs (agents/kinds.js), reading what they saved, starting them, and what is installed |
| `cli.js` | The one program |
| `coordinator.js` | The Coordinator: the agent behind the box at the bottom of the board |
| `delegate.js` | Delegating: a herdr worktree workspace, the repo's setup, then the agent in its root pane with the first prompt |
| `extras.js` | The two things the plugin writes outside its own folders, both consented and removable |
| `finish.js` | The finish line: commit, check, push, draft pull request, review, then the approval gate |
| `flow.js` | What the pieces share: reading herdr's view of a task, and sending text to its agent |
| `gate.js` | The gate |
| `helpers.js` | The hidden helper, as a hidden model call: the watcher (a status line and a progress guess for whatever is running; the board works out the minutes left) |
| `herdr-keys.js` | The keys herdr already uses, its own defaults and what the user's config.toml binds, and so which key the board may take: it never takes one that is in use, and says what that key does today |
| `herdr.js` | The only file that runs the herdr binary |
| `hook.js` | The event hook entry |
| `housekeeping.js` | The housekeeping pass |
| `jobs.js` | The detached runner's entry: `herdr-superwork run <job> <task id>` |
| `keeper.js` | The keeper: a small always-on background process that does what the open board's tick does, with no screen, so the board's information stays fresh and you are alerted with the board closed |
| `land.js` | Landing: bring the branch up to date with main in the task's own worktree, merge (through the pull request when there is one, else locally), then clean up |
| `remote.js` | Other machines |
| `review-page.js` | The evidence page |
| `runner.js` | Long jobs (delegate, finish line, land, restart) run in a detached runner so the board stays responsive and hook commands never hold herdr up |
| `state.js` | (herdr status, stage) -> what the board shows |
| `store.js` | Tasks on disk, locks and settings |
| `submit.js` | Making sure that what the board hands an agent is really taken: nothing is typed before the agent's program is up, and a prompt that was typed but not submitted gets its enter again |
| `sync.js` | Keeping a task's branch current with main, in the task's own worktree |
| `toml.js` | A TOML reader for herdr's config.toml: the whole format (v1.0, and the newer \e and \x escapes), so that whatever herdr accepts the plugin reads the same |
| `turn.js` | The agent's own turn-end report |

## `src/actions/`

| File | Holds |
|---|---|
| `archive.js` | Archive, restore, and clearing a task away for good |
| `filing.js` | Adding and editing a task: add, rename, describe, pin, and a report of where it stands |
| `finish-line.js` | The finish line's keys: approve, send the review or the failure back, finish anyway, retry |
| `shared.js` | What the actions share: the stages an agent holds a slot in, and an action's answer |
| `start.js` | Putting an agent on a task: the request, and starting queued tasks while slots are free |
| `suggestions.js` | Suggested tasks: work an agent or a reviewer came across that is not theirs to do |
| `talk.js` | Talking to a task's agent: a reply, what every human-started turn does to a task, stop |

## `src/agents/`

| File | Holds |
|---|---|
| `homes.js` | Where each agent program keeps its own settings and files |
| `installed.js` | What is installed on this machine, whether its turn-end hook can be used, and pre-trusting a repo |
| `kinds.js` | Everything agent-specific lives in this one table |
| `provider-error.js` | Provider errors: which ones pass by themselves, and which need the human |
| `read-turn.js` | Reading the end of a saved conversation, one reader per agent program: last message, error, tokens |
| `start.js` | The arguments an agent of a kind is started with, and whether it has a fast mode |

## `src/board/`

| File | Holds |
|---|---|
| `artifact-lines.js` | The evidence a review brought: which files and links count, and the line each gets in the task panel |
| `editor.js` | The box at the bottom |
| `held.js` | Is the board's terminal sized by something other than herdr's own window? |
| `keys.js` | The board's keys, each one defined once: the ? menu, the hint line, the words that name a key and docs/keys.md are all made from this list |
| `main.js` | Opens the board: full screen in the current terminal, which in herdr is a pane, the plugin's own tab included |
| `place.js` | The board that is running in herdr: where it is, written down while it runs, so that opening the board from anywhere in herdr goes back to that one instead of starting a second one |
| `reload-screen.js` | A board that loads its new version keeps its screen: the old board's last frame stays until the new one has drawn over it |
| `tab.js` | The board's own tab: named `herdr-superwork` while the board is open full screen in a pane of herdr, and given the name it had before when the board closes |
| `theme.js` | The board's colours and status marks are herdr's own (verified against herdr 0.9.3: src/app/state.rs for the palettes, src/client/shell.rs for the marks) |
| `view.js` | The board: pi-work's screen, powered by herdr |

## `src/board/view/`

| File | Holds |
|---|---|
| `actions.js` | What you do to the selected task: yes, send back, stop, remove, undo, archive |
| `agent-pane.js` | A task's agent: what its pane shows, what it last said, and going into its real herdr pane |
| `ask.js` | The one question box: asking, what a merge question is about, and how it is drawn |
| `chat-scroll.js` | Scrolling the chat's message: which of its lines show while it is longer than its box, and the words that say so |
| `chat.js` | The chat at the bottom: who it talks to, the line that names them, and their latest message |
| `coordinator.js` | The Coordinator from the board: sending it your words, and counting a reply you can see as seen |
| `hints.js` | The hint line at the bottom of the board |
| `keys.js` | What a typed key does, where the board's state decides it: a question, a draft, find, esc, enter, tab |
| `layout.js` | The whole screen: what goes where, and what gives way when the window is small |
| `list.js` | The task list: which rows there are, which one is selected, the header line, and the list as drawn |
| `menu.js` | The ? menu: every key of the board in its three groups, plain, ctrl and alt, each line with its key |
| `mouse.js` | The mouse wheel: it scrolls the chat's message under the pointer and the whole-task page, and moves between tasks over the list |
| `osc.js` | The same tasks, told to the terminal (OSC 7501) |
| `panel-kit.js` | What every part of the task panel is drawn with: wrapped text, headlines, callouts, boxes, and the list of parts |
| `panel-reviews.js` | The reviews in the task panel: how each went, each one a box, and the evidence |
| `panel-settings.js` | The settings in the task panel: every setting this task runs on, and its agent's session |
| `panel-status.js` | The top of the task panel: the title, where the task stands under its Status headline, and what it needs from you |
| `panel.js` | The task panel: beside the list and full screen |
| `remotes.js` | Other machines: ask each for its board, send each action to the machine that owns the task, and whose board you see |
| `review-words.js` | A review in a few words: its result, its colour, which round it was |
| `row-fit.js` | What a section of the list shows when space is short: its rows give the same things up together, in one order |
| `row.js` | One row of the list: its mark, its name, what it says, and its columns on the right |
| `setup.js` | The first run: one screen asks what the plugin may add to herdr's settings |
| `size.js` | The board's size: the window, what herdr shows of it, and another viewer holding the terminal at its own size |
| `states.js` | Where a task stands, as the board sorts it: its group, its colour, whether an agent is on it, whether it waits for you |
| `suggestions.js` | Suggested tasks: work a reviewer or an agent came across outside its own task |
| `textbox.js` | The text box you type in |
| `words.js` | Small words and numbers the board's parts share: a time as "12m", a pull request as "PR#16", a long text cut short |

## `src/coordinator/`

| File | Holds |
|---|---|
| `look.js` | What the board shows of the Coordinator: its state, latest message and screen; going into its chat |
| `place.js` | Where the Coordinator lives in herdr: a tab of its own, named `Coordinator`, in the home space (`~`); one still in the space of its own it had before is moved there |
| `pump.js` | The pump: the detached job that starts the Coordinator and types into it, one at a time per herdr session |
| `requests.js` | Requests to the Coordinator: written down here (send, restart, new, stop, open), carried out by the pump |
| `rules.js` | The Coordinator's standing rules: what it is told once, for the whole conversation |
| `state.js` | The Coordinator's saved state (one file per herdr session) and the folder it chats in |
| `who.js` | Who the Coordinator is: the agent kind, model and effort chosen for it, and whether it can run here |

## `src/finish/`

| File | Holds |
|---|---|
| `auto-merge.js` | Auto-merge, the setting: a task that may merge does so by itself while `autoMerge` is on, and waits for you while it is off |
| `faults.js` | Faults a reviewer found that were there before the task: suggested to the human, never added as tasks, and what the next reviewer is told is known already |
| `pipeline.js` | The pipeline: commit, bring main in, set up, check, push, pull request, review, then wait for approval |
| `recover-job.js` | A finished turn re-armed by mistake: hand the task to the human as stopped without a summary |
| `review-brief.js` | What the reviewer is told, and reading the verdict it writes back |
| `review.js` | The reviewer: a visible herdr agent in a tab of its own in the task's space |
| `shared.js` | The finish line's shared pieces: the approval question's words, and marking a task as failed |
| `sync-job.js` | Main moved while a task waits for approval: bring its branch up to date and check it again |
| `turn-ended.js` | The finish runner: an agent's turn ended |

## `src/flow/`

| File | Holds |
|---|---|
| `git.js` | Git and GitHub helpers used by more than one step: the pull request, its checks, a task's change |
| `handled-turn.js` | A turn that is already handled: the same turn seen again, and a task re-armed for a turn that never came |
| `live.js` | Live readings: a task as herdr sees it right now, and the board's list made from them |
| `send.js` | Sending text to an agent: delivering or queueing it, the closing-note rule, the command's path, a cut-off turn tried again |
| `sidebar.js` | Telling herdr's own sidebar where a task stands: the label on its pane |
| `spaces.js` | herdr spaces the board opened and owes closing: a repo's own space, a done task's clean-up, spaces left over |
| `tabs.js` | A task's tabs in its herdr space: the agent's tab is named `Agent`, and each reviewer has a tab of its own, named after its review round |
| `task.js` | A task's own places and its herdr: the closing note, the review folder, whether an agent is on it |

## `src/store/`

| File | Holds |
|---|---|
| `failures.js` | Failures: workflow diagnostics that live beside the task |
| `files.js` | Where the board keeps things, reading and writing files, and locks |
| `inbox.js` | Text on its way: an agent's inbox, and instructions for a Coordinator |
| `marks.js` | Small shared files: stamps, hook tokens, turn-ended events, marks |
| `repos.js` | Git plumbing, and repos: the first part of a task's id |
| `retries.js` | A turn cut off by a passing provider error: the board waits, then tries again by itself (docs/how-work-gets-done.md) |
| `reviews.js` | A task's reviews: the current one, which round, and every one it had |
| `settings-list.js` | The settings, each one defined once: its name, its default, whether one task can have its own, and what it means |
| `settings.js` | Settings as saved and read: yours, one task's own, and the repo's file |
| `suggestions.js` | Suggested tasks |
| `tasks.js` | Tasks on disk: reading, listing, changing, creating |
| `titles.js` | A title's one length limit, and how a longer one is shortened without losing what it said |

## `src/watcher/`

| File | Holds |
|---|---|
| `one.js` | One Watcher call at a time on the whole machine: the turn is a small file in the data folder, so an open board and a keeper that tick at the same moment cannot both start one |
| `pace.js` | The Watcher's pace: how often it looks, how much it gives way when the machine is busy, and which screens count as changed |
| `prompt.js` | What the Watcher is asked and how its answer is read: one prompt for every agent in the call, one line and one percent each |

## `bin/`

| File | Holds |
|---|---|
| `herdr-superwork.js` | Argument routing only: everything lives in src/ |
| `run.sh` | herdr starts plugin commands with its server's environment, which may not have the user's PATH |

## `scripts/`

| File | Holds |
|---|---|
| `docs.js` | The pages made from the code: `node scripts/docs.js` writes them, `node scripts/docs.js --check` only says which are out of date (the check does that too: scripts/guard.js) |
| `guard.js` | The repo's own rules, checked: no source file past its size, no name used and never defined, and no made page out of date |
| `names.js` | Names used but never defined: a function called in a file that neither declares nor imports it (what is left behind when code moves to another file) |

## The pages: `docs/`

| Page | About |
|---|---|
| [board-size.md](board-size.md) | The board's size: what changes it, and how the board stands still |
| [board.md](board.md) | The board: the list and the chat |
| [checked-on-herdr.md](checked-on-herdr.md) | What was checked on herdr 0.9.3 |
| [compared-with-pi-work.md](compared-with-pi-work.md) | Compared with pi-work |
| [coordinator.md](coordinator.md) | The Coordinator |
| [gate.md](gate.md) | The gate |
| [handing-over.md](handing-over.md) | Handing text to an agent |
| [how-work-gets-done.md](how-work-gets-done.md) | How work gets done |
| [install.md](install.md) | Installing, the first run, and taking it out again |
| [keys.md](keys.md) | Keys, questions and the ? menu |
| [mouse.md](mouse.md) | The mouse |
| [other-machines.md](other-machines.md) | Other machines |
| [provider-errors.md](provider-errors.md) | A turn cut off by the provider |
| [roles-and-commands.md](roles-and-commands.md) | Roles and commands |
| [settings.md](settings.md) | Settings: two places |
| [suggestions.md](suggestions.md) | Suggested tasks |
| [tabs.md](tabs.md) | A task's tabs in herdr |
| [task-panel.md](task-panel.md) | The task panel |
| [testing.md](testing.md) | Tests |
| [titles.md](titles.md) | Titles |
| [watcher.md](watcher.md) | The Watcher: how often it looks, and what it costs |
| [where-things-live.md](where-things-live.md) | Where things live |

## The tests: `test/`

One file per area, named after it; `npm run check <area>` runs every `test/<area>*.test.js` ([testing.md](testing.md)).

| File | Tests |
|---|---|
| `auto-merge.test.js` | The autoMerge setting: a green task merges by itself, your choice wins over the repo's "land", and a change counts for tasks already under way |
| `board-actions.test.js` | What you do to a task: approve and merge, the ? menu, stop or remove, retry |
| `board-chat-scroll.test.js` | The chat's message when it is long: the box grows with it, it scrolls with two keys and the mouse wheel, and the box says where there is more |
| `board-chat.test.js` | The chat's box: the latest message, an empty line, the line you type on |
| `board-evidence.test.js` | The task details of a reviewed task with evidence, and what the board shows when a part of it fails to draw |
| `board-helpers.js` | Shared by the board's tests (test/board-*.test.js): the keys, and a board opened on a test world |
| `board-keys.test.js` | The board's keys, and the text box owning the keyboard |
| `board-layout.test.js` | The whole screen: the chat pinned to the bottom, through a resize |
| `board-list.test.js` | The task list: the header, the groups, the done list |
| `board-panel.test.js` | The task panel: beside the list and full screen |
| `board-reply.test.js` | Replying to a task's agent: who gets your words, and words put away |
| `board-review.test.js` | Reviews as the board shows them: on a row and in the task panel |
| `board-row-fit.test.js` | What the rows of a section show when space is short: the same things on every row, given up together in one order |
| `board-rows.test.js` | One row of the list: its name, what it says, its columns |
| `board-setup.test.js` | The first run, and the board loading its new version |
| `board-size.test.js` | A terminal held at another size than herdr shows |
| `board-stay.test.js` | Going into an agent never ends the board: in a pane of its own it runs on, and opening the board goes back to it |
| `board-still.test.js` | The board stands still: a size that changes for a moment, a second herdr window on the session, agents starting and ending, its own reload |
| `board-tab.test.js` | The board's own tab: named herdr-superwork while the board is open in a pane, its old name back when it closes |
| `board-textbox.test.js` | The text box: wrapping, growing, scrolling, editing keys |
| `check.js` | The one test command: `npm run check` (`npm test` is the same) |
| `check.test.js` | The test command (test/check.js): which files it runs, what it remembers, how runs take turns, and its budget |
| `cleanup-late-work.test.js` |  |
| `cleanup-owed.test.js` |  |
| `cleanup-retry.test.js` |  |
| `cleanup-space.test.js` |  |
| `cli.test.js` | The command line |
| `coordinator-chat.test.js` | The Coordinator's chat: one long-lived agent behind the box, and its latest message shown or hidden |
| `coordinator-helpers.js` | Shared by the Coordinator's tests (test/coordinator-*.test.js): a world with a Coordinator, and a board opened on it |
| `coordinator-messages.test.js` | What you say to the Coordinator is never lost: dialogs, failed starts, stop, on and off |
| `coordinator-place.test.js` | Where the Coordinator lives: a tab named Coordinator in the home space, found or started again, and moved over from the space of its own it had before |
| `coordinator-restart.test.js` | The Coordinator's conversation: restart, new, the agent's own new-chat command, its default program |
| `fake-helper.js` | A stand-in for the hidden helper model |
| `fake-herdr.js` | A stand-in for the herdr binary, for tests: no server, no terminals, no model calls |
| `fake-herdr.test.js` | The fake herdr itself: tests call it in their own process, programs they start run it as a program |
| `fast.test.js` | Fast mode: the `fast` and `reviewerFast` settings, and what an agent or reviewer is started with |
| `flow.test.js` |  |
| `gate.test.js` | The gate: tagged findings in, a fixed rule decides what goes back and what may merge |
| `guard.test.js` | The repo's own rules are part of the check: no source file past its size, no name used and never defined, no made page out of date (scripts/guard.js) |
| `helpers.js` | Shared test setup: a temporary board, a fake herdr and scripted fake agents |
| `herdr-keys.test.js` | The key that opens the board: prefix+a is offered, and a key herdr or the user's config already uses is never taken |
| `keys-list.test.js` | The keys list is the one place a key is defined: moving a key there moves it in the handler, the ? menu, the hints and the messages, with no other file changed |
| `lifecycle.test.js` |  |
| `merge.test.js` |  |
| `plain-words.test.js` | The board's plain words: a task is added, updated, removed, started, archived, restored |
| `pull-requests.test.js` |  |
| `rearm.test.js` |  |
| `remerge.test.js` | Work that passed its review and then only took main in is not reviewed again: the tests run on the merged result and the review stands |
| `remote.test.js` | Other machines: the door, actions where the task lives, the SSH line |
| `retry.test.js` | A turn cut off by the model's provider: recognised from the agent's own conversation file, retried by the board when the error is one that passes, and never taken for a finished turn or a review |
| `store.test.js` |  |
| `submit.test.js` | Text handed to an agent is really submitted: nothing is typed before a slow-starting program has drawn its screen, an enter that was lost is pressed again (the text is never typed twice), and an agent that still does… |
| `suggestions.test.js` | Suggested tasks: nothing adds a task by itself |
| `sync-conflict.test.js` | Conflicts with main are caught before review, not after approval: the board brings every task's branch up to date by itself, and the agent hears about it only when there is a real conflict |
| `sync-merge.test.js` | Conflicts with main are caught before review, not after approval: the board brings every task's branch up to date by itself, and the agent hears about it only when there is a real conflict |
| `sync-remote.test.js` | Conflicts with main are caught before review, not after approval: the board brings every task's branch up to date by itself, and the agent hears about it only when there is a real conflict |
| `tabs.test.js` | A task's tabs in its herdr space: the agent's tab is named Agent, each reviewer has a tab of its own |
| `theme.test.js` | The board takes its colours and status marks from herdr's own config, resolved the way herdr resolves them |
| `titles.test.js` | A title's length limit: one number, the same for a task typed, renamed, suggested, or made from a reviewer's finding |
| `turns.test.js` |  |
| `watcher-pace.test.js` | The Watcher's pace: how often it looks, what it skips, one call at a time, and giving way on a busy machine |
| `watcher.test.js` | The hidden helper: the watcher's line and guess |
