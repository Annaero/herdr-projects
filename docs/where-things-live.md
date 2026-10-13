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
| `board-rule.js` | What an agent or a reviewer the board started is told about the board itself: able, not nudged |
| `check-progress.js` | The board's own check as a task shows it: the count its command reports, the wait for a turn, the minutes left, and saying so when it stands still |
| `cli.js` | The one program |
| `coordinator.js` | The Coordinator: the agent behind the box at the bottom of the board |
| `delegate.js` | Delegating: a herdr worktree workspace, the repo's setup, then the agent in its root pane with the first prompt |
| `extras.js` | The things the plugin writes outside its own folders, each consented and removable |
| `finish.js` | The finish line: commit, check, push, draft pull request, review, then the approval gate |
| `flow.js` | What the pieces share: reading herdr's view of a task, and sending text to its agent |
| `gate.js` | The gate |
| `helpers.js` | The hidden helper, as a hidden model call: the watcher (a status line and a progress guess for whatever is running; the board works out the minutes left) |
| `herdr-keys.js` | The keys herdr already uses, its own defaults and what the user's config.toml binds, and so which key the board may take: it never takes one that is in use, and says what that key does today |
| `herdr-socket.js` | herdr's socket, spoken to directly, for the two things its command line has not got (herdr 0.9.3): closing its popup (`popup.close`), and being told the moment another tab shows (`events.subscribe`) |
| `herdr.js` | The only file that runs the herdr binary |
| `hook.js` | The event hook entry |
| `housekeeping.js` | The housekeeping pass |
| `jobs.js` | The detached runner's entry: `herdr-superwork run <job> <task id>` |
| `keeper.js` | The keeper: a small always-on background process that does what the open board's tick does, with no screen, so the board's information stays fresh and you are alerted with the board closed |
| `land.js` | Landing: bring the branch up to date with main in the task's own worktree, merge (through the pull request when there is one, else locally), then clean up |
| `notify.js` | Telling you that a task needs you, is ready to approve, or failed: the `board.notify` setting |
| `remote.js` | Other machines |
| `research.js` | Reports and research-only tasks: a report never goes into the repo, and a task marked research only changes nothing in it |
| `review-page.js` | The evidence page |
| `runner.js` | Long jobs (delegate, finish line, land, restart) run in a detached runner so the board stays responsive and hook commands never hold herdr up |
| `state.js` | (herdr status, stage) -> what the board shows |
| `status-kept.js` | A working task's line while the Watcher has written none for this run: the last sentence it wrote, kept and said with its age, or "Just started" |
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
| `settings.js` | The settings' commands: set, unset and show, for you, for your entry for a repo, or for one task |
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
| `prompts.js` | What an agent was told: every prompt in its saved conversation, oldest first, where the program's file can be read |
| `provider-error.js` | Provider errors: which ones pass by themselves, and which need the human |
| `read-turn.js` | Reading the end of a saved conversation, one reader per agent program: last message, error, tokens |
| `screen-text.js` | The words on a program's screen, for a program whose saved conversation the board cannot read (agents/talk.js reads the others, and those never need this) |
| `start.js` | The arguments an agent of a kind is started with, and whether it has a fast mode |
| `talk.js` | The text of a saved conversation, one reader per agent program: what was said to the program and what it said back, oldest first |

## `src/automations/`

| File | Holds |
|---|---|
| `command.js` | `herdr-superwork automations …`: the commands |
| `cron.js` | A cron expression: five fields (minute, hour, day of the month, month, day of the week), read in this machine's time zone |
| `events.js` | What happens on the board that an automation can be fired by, and telling that it happened: a task was added, finished and waits for approval, failed its review, went wrong, needs you, was merged |
| `fire.js` | A firing: the board adds an ordinary task and puts an agent on it at once |
| `list.js` | The automations themselves: making one, changing its name, prompt or trigger, its own settings, on and off, removing it |
| `show.js` | An automation as it is shown, in the same words on the board's list, in its panel and on the command line: on or off, its trigger in plain words, its repo, the last firing (how long ago, and the task it made or… |
| `tick.js` | Who fires the automations: the keeper and an open board, by this one pass, once a second (keeper.js: tickOnce), so it works with the board closed |
| `told.js` | What a task an automation made is told |
| `triggers.js` | An automation's trigger, one of two kinds: a schedule, or something that happened on the board |

## `src/board/`

| File | Holds |
|---|---|
| `artifact-lines.js` | The evidence a review brought: which files and links count, and the lines each gets in the task panel |
| `editor.js` | The box at the bottom |
| `held.js` | Is the board's terminal sized by something other than herdr's own window? |
| `keys.js` | The board's keys, each one defined once: the ? menu, the hint line, the words that name a key and docs/keys.md are all made from this list |
| `main.js` | Opens the board: full screen in the current terminal, which in herdr is a pane, the plugin's own tab included |
| `place.js` | The board that is running in herdr: where it is, written down while it runs, so that opening the board from anywhere in herdr goes back to that one instead of starting a second one |
| `popup.js` | The board as a popup, for whoever chose it (`board.open`: popup): herdr's own popup, a framed window in the middle of herdr's screen that takes the keyboard and the mouse while it shows, as herdr's menu does |
| `reload-screen.js` | A board that loads its new version keeps its screen: the old board's last frame stays until the new one has drawn over it |
| `say.js` | A line for a board that is running, from a command that has no screen of its own (the board key's action): left here for the board in one pane, which shows it on its message line within a second |
| `tab.js` | The board's own tab: named `herdr-superwork` while the board is open full screen in a pane of herdr, and given the name it had before when the board closes |
| `theme.js` | The board's colours and status marks are herdr's own (verified against herdr 0.9.3: src/app/state.rs for the palettes, src/client/shell.rs for the marks) |
| `view.js` | The board: pi-work's screen, powered by herdr |

## `src/board/view/`

| File | Holds |
|---|---|
| `actions.js` | What you do to the selected task: yes, send back, stop, remove, undo, archive |
| `agent-pane.js` | A task's agent: what its pane shows, and going into its real herdr pane |
| `ask.js` | The one question box: asking, what a merge question is about, and how it is drawn |
| `automation-panel.js` | One automation, whole: beside the list and full screen |
| `automations.js` | The automations, a list of their own behind its key, as the archive is: one row per automation (on or off, its name, its trigger in plain words, its repo, the last firing, the next one for a schedule), and what the… |
| `chat-scroll.js` | Scrolling the chat's message: which of its lines show while it is longer than its box, and the words that say so |
| `chat-text.js` | A conversation's text as the lines of a box: each thing said under a line that names who said it, wrapped to the box, with markdown read as text (a list item's next lines stand under its words, code keeps its lines,… |
| `chat.js` | The chat at the bottom: who it talks to, the line that names them, and their latest message |
| `coordinator.js` | The Coordinator from the board: sending it your words, and counting a reply you can see as seen |
| `hints.js` | The hint line at the bottom of the board |
| `keys.js` | What a typed key does, where the board's state decides it: a question, a draft, find, esc, enter, tab |
| `layout.js` | The whole screen: what goes where, and what gives way when the window is small |
| `list.js` | The task list: which rows there are, which one is selected, the header line, and the list as drawn |
| `menu.js` | The ? menu: every key of the board in its three groups, plain, ctrl and alt, each line with its key |
| `mouse.js` | The mouse wheel: it scrolls the chat's message under the pointer and the whole-task page, and moves between tasks over the list |
| `osc.js` | The same tasks, told to the terminal (OSC 7501) |
| `panel-edit.js` | The settings page: every work setting of the selected task by its name, its value and the place it comes from |
| `panel-kit.js` | What every part of the task panel is drawn with: wrapped text, headlines, label-and-value rows, and the list of parts |
| `panel-report.js` | The report in the task panel: that a task is research only, and the link to the report its agent wrote |
| `panel-reviews.js` | The reviews in the task panel: how each went, each one under its own label, and the evidence |
| `panel-settings.js` | The settings in the task panel: what this task runs on, in a few rows, and its agent's session |
| `panel-status.js` | The top of the task panel: the title, where the task stands under its Status headline, and what it needs from you |
| `panel.js` | The task panel: beside the list and full screen |
| `place.js` | Where this board is, and what follows from it: the popup keeps its own selection, filter and draft apart from a board in a tab, it opens on the task you were looking at, its own key closes it, and a line left for this… |
| `remotes.js` | Other machines: ask each for its board, send each action to the machine that owns the task, and whose board you see |
| `review-words.js` | A review in a few words: its result, its colour, which round it was |
| `row-fit.js` | What a section of the list shows when space is short: its rows give the same things up together, in one order |
| `row-number.js` | A task's number on its row: the quiet tag between the mark and the title, `#134`, or `HSW-134` where its repo has a short key (store/keys.js) |
| `row-tall.js` | A live task's third line on a narrow screen: the bar, the percent, the minutes left, the review tag, the pull request and the time, which have no room beside the name there |
| `row-wrap.js` | A row on a narrow screen, wrapped instead of cut: a live task's name and what it says take up to two lines each, and the selected task's name as many as it needs |
| `row.js` | One row of the list: its mark, its number (row-number.js), its name, its columns on the right and, for a live task, a second line that says what it does (a third on a narrow screen: row-tall.js, where long ones wrap:… |
| `setup.js` | The first run: one screen asks what the plugin may add to herdr's settings |
| `size.js` | The board's size: the window, what herdr shows of it, and another viewer holding the terminal at its own size |
| `states.js` | Where a task stands, as the board sorts it: its group, its colour, whether an agent is on it, whether it waits for you |
| `suggestions.js` | Suggested tasks: work a reviewer or an agent came across outside its own task |
| `talk.js` | What a chat shows of a conversation: only its words |
| `textbox.js` | The text box you type in |
| `web-ui.js` | The board inside the herdr web UI, asked about once: with that plugin installed and its link shared, the board asks whether the link may go through its front door, which is what puts the Board into the web UI… |
| `words.js` | Small words and numbers the board's parts share: a time as "12m", a pull request as "PR#16", a long text cut short |

## `src/coordinator/`

| File | Holds |
|---|---|
| `look.js` | What the board shows of the Coordinator: its state, latest message and screen; going into its chat |
| `place.js` | Where the Coordinator lives in herdr: a tab of its own, named `Coordinator`, in the home space (`~`); one still in the space of its own it had before is moved there |
| `pump.js` | The pump: the detached job that starts the Coordinator and types into it, one at a time per herdr session |
| `requests.js` | Requests to the Coordinator: written down here (send, restart, new, stop, open), carried out by the pump |
| `rules.js` | The Coordinator's standing rules: what they say, and the files in its folder that every conversation reads them from |
| `state.js` | The Coordinator's saved state (one file per herdr session) and the folder it chats in |
| `who.js` | Who the Coordinator is: the agent kind, model and effort chosen for it, and whether it can run here |

## `src/delegate/`

| File | Holds |
|---|---|
| `worktree.js` | Where a task's worktree starts and what a fresh one is given: the commit it branches from, a free branch name, the files it gets a copy of |

## `src/finish/`

| File | Holds |
|---|---|
| `auto-merge.js` | Auto-merge, the setting: a task that may merge does so by itself while `merge.by` is `itself`, and waits for you while it is `you` |
| `check-run.js` | Running the repo's check with its progress shown: the file the command reports to, what is kept on the task while it runs, and telling herdr's sidebar |
| `faults.js` | Faults a reviewer found that were there before the task: suggested to the human, never added as tasks, and what the next reviewer is told is known already |
| `line.js` | The line: a repo's tasks merge one at a time |
| `old-holds.js` | Approval holds an older version left behind: tasks owing you a yes although you never stepped into them |
| `pipeline.js` | The pipeline: commit, bring main in, set up, check, push, pull request, review, then wait for approval |
| `recover-job.js` | A finished turn re-armed by mistake: hand the task to the human as stopped without a summary |
| `research.js` | A research-only task at the finish line: a change in the repo goes back to its agent, and every task's report is kept |
| `review-brief.js` | What the reviewer is told, and reading the verdict it writes back |
| `review.js` | The reviewer: a visible herdr agent in a tab of its own in the task's space |
| `shared.js` | The finish line's shared pieces: the approval question's words, and marking a task as failed |
| `sync-job.js` | Main moved while a task waits for approval: bring its branch up to date and check it again |
| `turn-ended.js` | The finish runner: an agent's turn ended |
| `waiting.js` | An agent that stopped to wait for the human: the end of that turn is not a finish, so no check, no review, no push and no merge follow it |

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
| `talk.js` | A task's conversation as the board shows it: its agent's, or its reviewer's while the task is under review |
| `task.js` | A task's own places and its herdr: the closing note, the review folder, whether an agent is on it |

## `src/remote/`

| File | Holds |
|---|---|
| `check.js` | `herdr-superwork machines`: the check you can run |
| `why.js` | Why another machine's tasks could not be read, and what to do about it |

## `src/store/`

| File | Holds |
|---|---|
| `automations.js` | Automations on disk: the list (a saved task plus a trigger, each), every firing written down, and which board events were seen already |
| `check-runs.js` | How long a repo's check took the last few times it ran in full on this machine: what its minutes left are worked out from |
| `failures.js` | Failures: workflow diagnostics that live beside the task |
| `files.js` | Where the board keeps things, reading and writing files, and locks |
| `inbox.js` | Text on its way: an agent's inbox, and instructions for a Coordinator |
| `keys.js` | A repo's short key (`repo.key`: `HSW` for herdr-superwork) and what it does to a task's name: its tag reads `HSW-134` instead of `#134`, and `HSW-134` names the task wherever its id does |
| `marks.js` | Small shared files: stamps, hook tokens, turn-ended events, marks |
| `move-home.js` | The one-time move into the one home folder: what an older version kept in ~/.local/state, ~/.config and ~/.local/share is moved into ~/.herdr-superwork by the first run of this code, by itself, and each old place… |
| `repos.js` | Git plumbing, and repos: the first part of a task's id |
| `retries.js` | A turn cut off by a passing provider error: the board waits, then tries again by itself (docs/how-work-gets-done.md) |
| `reviews.js` | A task's reviews: the current one, which round, and every one it had |
| `settings-list.js` | The settings, each one defined once: its name, its built-in value, what it may be, whether it is a work or a board setting, and what it means |
| `settings.js` | Settings as saved and read: yours, your entry for a repo, one task's own, and the repo's file |
| `suggestions.js` | Suggested tasks |
| `tasks.js` | Tasks on disk: reading, listing, changing, creating, and finding one by what it is called (its id, its number, its repo's key) |
| `titles.js` | A title's one length limit, and how a longer one is shortened without losing what it said |

## `src/store/settings/`

| File | Holds |
|---|---|
| `change.js` | Changing a setting: `set` and `unset`, for you, for your entry for a repo, or for one task |
| `lookup.js` | The one lookup |
| `migrate.js` | The one-time move from the old settings: a run of this code that finds your file in the old shape converts your config.json (a copy of the old file is kept beside it as config.old.json), each task's own settings and… |
| `places.js` | The places a setting can be said in, as they are on disk: your file (with your entry for each repo in it), a task's own, and the repo's own committed file |
| `show.js` | `show`: every setting, its value and the place it came from, for you or for one task; and what is wrong in a file somebody edited by hand |
| `values.js` | What a setting's value may be: a typed or hand-written value is checked against its entry in settings-list.js and comes back as the board keeps it, or is refused with the nearest right one as a hint |

## `src/watcher/`

| File | Holds |
|---|---|
| `one.js` | One Watcher call at a time on the whole machine: the turn is a small file in the data folder, so an open board and a keeper that tick at the same moment cannot both start one |
| `pace.js` | The Watcher's pace: how often it looks, how much it gives way when the machine is busy, and which screens count as changed |
| `prompt.js` | What the Watcher is asked and how its answer is read: one prompt for every agent in the call, one line and one percent each |

## `src/webui/`

| File | Holds |
|---|---|
| `access.js` | Who may use the board through the front door: only someone the web UI itself lets in |
| `automations-model.js` | The automations for the web board: the list and one automation, whole, in the shapes the page already draws a task list and a task in (list-model.js, panel-model.js) |
| `command.js` | `herdr-superwork web-ui`: how the board in the herdr web UI stands, and the one setup step by hand |
| `door.js` | The front door: a small server in front of the herdr web UI |
| `find.js` | The herdr web UI plugin (devswha.herdr-web-ui): whether it is installed in this herdr, and the address its server listens on |
| `ink.js` | The board's own drawing code, used for a web page: a theme that marks text with the name of its colour instead of a terminal's colour codes, and the reading of such text into pieces a page can draw ({ t: text, c:… |
| `keep.js` | The front door's life |
| `link.js` | The one setup step: the web UI's shared link |
| `list-model.js` | The task list for the web board: the groups and rows the terminal board shows, in its order, each row with the mark, the words, the columns and the colours the board's own row code gives it (view/row.js through a web… |
| `panel-model.js` | The task panel for the web board |
| `pcs.js` | The web UI's own machines (its "PCs": this one and the ones added in its Settings → Remote PCs) and the board's (herdr's saved machines, remote.js): which is which |
| `phone.js` | The one answer of the web UI that the front door corrects: how a phone can reach it (`GET /api/access`, what its Settings → Phone shows) |
| `proxy.js` | Passing a request through to the web UI untouched: the same method, address and headers in, the same status, headers and bytes out, as they come (a stream stays a stream, a ranged or ready-compressed answer is not… |
| `shell.js` | The one thing the front door changes in what the web UI sends: its page (the HTML shell) gets one line more, a script of ours that adds the Board to its menu |
| `side-model.js` | What stands beside the list on the web board: who the chat talks to and their latest message, the question the board asks, its message to you, the buttons for the selected task and the entries of its More menu |
| `web-pcs.js` | The web board and the web UI's machines: opening an agent that runs on another machine in the web UI's own view of that machine's pane, and showing the board of the machine the web UI is on |
| `web-view.js` | The board with no terminal: the same View the terminal board is (its list, its selection, its questions, its actions, its words), opened for a web page |
| `worker.js` | The board's side of the front door, in a thread of its own: reading tasks asks herdr, and asking herdr waits |

## `src/webui/page/`

| File | Holds |
|---|---|
| `board.js` | The board over the web UI's page: its frame (the header, the list, one task, the chat), asking the board for what to show, and sending it what you do |
| `chat.js` | The chat at the foot of the board: who it talks to (the Coordinator, or the selected task's agent), the newest thing said in that conversation under a line that names who said it (the agent, the reviewer while the task… |
| `dom.js` | The page's few tools: making elements, drawing the board's coloured pieces of text, and calling the front door |
| `list.js` | The task list as the page draws it: the groups under their headings and one row per task |
| `panel.js` | One task, whole: its title, the buttons for what can be done to it now, and the task panel's parts (status, what it needs from you, suggested tasks, description, reviews, evidence, what the agent said, settings, session) |
| `sheets.js` | What comes up over the board: the question it asks (approve a merge, remove a task, make a suggestion a task), the More menu with every other action, and the board's short message to you |
| `start.js` | The script the front door adds to the herdr web UI's page |

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
| [automations.md](automations.md) | Automations: tasks made on a schedule, or when something happens on the board |
| [board-size.md](board-size.md) | The board's size: what changes it, and how the board stands still |
| [board.md](board.md) | The board: the list and the chat |
| [check-progress.md](check-progress.md) | The check's progress: what the board shows, and how a check reports it |
| [checked-on-herdr.md](checked-on-herdr.md) | What was checked on herdr 0.9.3 |
| [compared-with-pi-work.md](compared-with-pi-work.md) | Compared with pi-work |
| [coordinator.md](coordinator.md) | The Coordinator |
| [gate.md](gate.md) | The gate |
| [handing-over.md](handing-over.md) | Handing text to an agent |
| [home-folder.md](home-folder.md) | The home folder: where the board keeps its files |
| [how-work-gets-done.md](how-work-gets-done.md) | How work gets done |
| [install.md](install.md) | Installing, the first run, and taking it out again |
| [keys.md](keys.md) | Keys, questions and the ? menu |
| [mouse.md](mouse.md) | The mouse |
| [other-machines.md](other-machines.md) | Other machines |
| [provider-errors.md](provider-errors.md) | A turn cut off by the provider |
| [research.md](research.md) | Reports, and research-only tasks |
| [roles-and-commands.md](roles-and-commands.md) | Roles and commands |
| [settings.md](settings.md) | Settings: one lookup |
| [suggestions.md](suggestions.md) | Suggested tasks |
| [tabs.md](tabs.md) | A task's tabs in herdr |
| [task-numbers.md](task-numbers.md) | Task numbers and repo keys |
| [task-panel.md](task-panel.md) | The task panel |
| [testing.md](testing.md) | Tests |
| [titles.md](titles.md) | Titles |
| [waiting-for-you.md](waiting-for-you.md) | An agent that waits for you is not finished |
| [watcher.md](watcher.md) | The Watcher: how often it looks, and what it costs |
| [web-ui.md](web-ui.md) | The board in the herdr web UI |
| [where-things-live.md](where-things-live.md) | Where things live |

## The tests: `test/`

One file per area, named after it; `npm run check <area>` runs every `test/<area>*.test.js` ([testing.md](testing.md)).

| File | Tests |
|---|---|
| `auto-merge.test.js` | The merge.by setting: a green task merges by itself, the repo's own file can never switch that on, and a change counts for tasks already under way |
| `automations.test.js` | Automations: a schedule read from plain words or cron, a board event, a firing that makes a task and starts it with the automation's own settings, and the guards: one at a time, no loops, a runaway turned off, a missed… |
| `board-actions.test.js` | What you do to a task: approve and merge, the ? menu, stop or remove, retry |
| `board-chat-scroll.test.js` | The chat's message when it is long: the box grows with it, it scrolls with two keys and the mouse wheel, and the box says where there is more |
| `board-chat.test.js` | The chat's box: the latest message, an empty line, the line you type on |
| `board-evidence.test.js` | The task details of a reviewed task with evidence, and what the board shows when a part of it fails to draw |
| `board-helpers.js` | Shared by the board's tests (test/board-*.test.js): the keys, and a board opened on a test world |
| `board-hints.test.js` | The hint line: each hint says what the key does and to what, a key shows only where it does something, and what gives way in a narrow window |
| `board-keys.test.js` | The board's keys, and the text box owning the keyboard |
| `board-layout.test.js` | The whole screen: the chat pinned to the bottom, through a resize |
| `board-list.test.js` | The task list: the header, the groups, the done list |
| `board-needs.test.js` | A task that waits for you says what it needs: its mark (? an answer, ! a yes or no, ⚷ a sign-in) and the words beside it, on a row, in the task panel, in the chat and on the web board; never the look of one that went… |
| `board-order.test.js` | The order of the list: what waits for you, then what is being worked on, then to do, and done last |
| `board-panel.test.js` | The task panel: beside the list and full screen |
| `board-reply.test.js` | Replying to a task's agent: who gets your words, and words put away |
| `board-review.test.js` | Reviews as the board shows them: on a row and in the task panel |
| `board-row-fit.test.js` | What the rows of a section show when space is short: the same things on every row, given up together in one order |
| `board-row-tall.test.js` | A live task's row on a narrow screen: its third line (the bar, the percent, the minutes left, the review tag, the pull request, the time), the width where it switches, the highlight, scrolling, and the to-dos giving… |
| `board-row-wrap.test.js` | Rows on a narrow screen wrap instead of being cut: a live task's name and what it says take up to two lines each, the selected task's name as many as it needs, one-line rows go without their time, and the highlight,… |
| `board-rows.test.js` | One row of the list: its name, what it says, its columns |
| `board-settings.test.js` | The settings page of a task: every work setting by its name with the place it comes from, moving to a row, changing it, the mark on the rows that are the task's own, and the one key that puts a row back |
| `board-setup.test.js` | The first run, and the board loading its new version |
| `board-size.test.js` | A terminal held at another size than herdr shows |
| `board-stay.test.js` | Going into an agent never ends the board: in a pane of its own it runs on, and opening the board goes back to it |
| `board-still.test.js` | The board stands still: a size that changes for a moment, a second herdr window on the session, agents starting and ending, its own reload |
| `board-tab.test.js` | The board's own tab: named herdr-superwork while the board is open in a pane, its old name back when it closes |
| `board-talk.test.js` | What a chat shows of a conversation: only its words, whoever said them |
| `board-textbox.test.js` | The text box: wrapping, growing, scrolling, editing keys |
| `check-progress.test.js` | The board's own check as a task shows it: a true count from the command, the wait for a turn, the minutes left from earlier runs, an answer known at once, a check that stands still, and a colour of its own |
| `check-report.js` | What the test command tells whoever started it, and the line of runs waiting for a turn |
| `check.js` | The one test command: `npm run check` (`npm test` is the same) |
| `check.test.js` | The test command (test/check.js): which files it runs, what it remembers, how runs take turns, and its budget |
| `cleanup-late-work.test.js` |  |
| `cleanup-owed.test.js` |  |
| `cleanup-retry.test.js` |  |
| `cleanup-space.test.js` |  |
| `cli.test.js` | The command line |
| `closing-note.test.js` | Where an agent writes for the board: the task's own folder in the board's data folder, never the folder it works in; the old place is still read for agents started with the old rule; a cleaned-up task leaves no note… |
| `coordinator-chat.test.js` | The Coordinator's chat: one long-lived agent behind the box, and its latest message shown or hidden |
| `coordinator-helpers.js` | Shared by the Coordinator's tests (test/coordinator-*.test.js): a world with a Coordinator, and a board opened on it |
| `coordinator-messages.test.js` | What you say to the Coordinator is never lost: dialogs, failed starts, stop, on and off |
| `coordinator-place.test.js` | Where the Coordinator lives: a tab named Coordinator in the home space, found or started again, and moved over from the space of its own it had before |
| `coordinator-restart.test.js` | The Coordinator's conversation: restart, new, the agent's own new-chat command, its default program, and its standing rules, read from its folder through all of them |
| `fake-gh.js` | A stand-in for gh |
| `fake-helper.js` | A stand-in for the hidden helper model |
| `fake-herdr.js` | A stand-in for the herdr binary, for tests: no server, no terminals, no model calls |
| `fake-herdr.test.js` | The fake herdr itself: tests call it in their own process, programs they start run it as a program |
| `fast.test.js` | Fast mode: the `fast` and `reviewerFast` settings, and what an agent or reviewer is started with |
| `flow.test.js` |  |
| `gate.test.js` | The gate: tagged findings in, a fixed rule decides what goes back and what may merge |
| `guard.test.js` | The repo's own rules are part of the check: no source file past its size, no name used and never defined, no made page out of date (scripts/guard.js) |
| `helpers.js` | Shared test setup: a temporary board, a fake herdr and scripted fake agents |
| `herdr-keys.test.js` | The key that opens the board: prefix+a is offered, and a key herdr or the user's config already uses is never taken |
| `home-folder.test.js` | The one home folder: where things are kept by default, and the one-time move of an older version's folders into it (old layout in, new layout out; twice; cut off; with new data there already) |
| `keys-list.test.js` | The keys list is the one place a key is defined: moving a key there moves it in the handler, the ? menu, the hints and the messages, with no other file changed |
| `lifecycle.test.js` |  |
| `merge.test.js` |  |
| `notify.test.js` | The board.notify setting: a task that needs you, is ready to approve or failed rings the bell on an open board or runs your command, once per event; `none`, the built-in value, does neither |
| `plain-words.test.js` | The board's plain words: a task is added, updated, removed, started, archived, restored |
| `pull-requests.test.js` |  |
| `rearm.test.js` |  |
| `remerge.test.js` | Work that passed its review and then only took main in is not reviewed again: the tests run on the merged result and the review stands |
| `remote-why.test.js` | Other machines that do not answer: why not, for each kind of failure, on both boards and in `herdr-superwork machines` |
| `remote.test.js` | Other machines: the door, actions where the task lives, the SSH line |
| `research.test.js` | Reports and research-only tasks: a report never goes into the repo, a research-only task that changed the repo is sent back and never pushed or merged, one that changed nothing ends as done with its report's link, and… |
| `retry.test.js` | A turn cut off by the model's provider: recognised from the agent's own conversation file, retried by the board when the error is one that passes, and never taken for a finished turn or a review |
| `settings-move.test.js` | The one-time move from the old settings: your config.json, each task's own settings and what it took from its repo's file become the new names, once; the old file is kept beside the new one; tasks under way keep their… |
| `settings.test.js` | The settings' one rule: the order of the places, the repo file's six facts, board settings refused on a task, instructions adding up, `none` against unset, what a value may be, a mistake made by hand, and a refused… |
| `status-kept.test.js` | A working task's line before the Watcher's first look of a run: the last sentence kept with its age, or "Just started", never a bare "…" |
| `store.test.js` |  |
| `submit.test.js` | Text handed to an agent is really submitted: nothing is typed before a slow-starting program has drawn its screen, an enter that was lost is pressed again (the text is never typed twice), and an agent that still does… |
| `suggestions.test.js` | Suggested tasks: nothing adds a task by itself |
| `sync-conflict.test.js` | Conflicts with main are caught before review, not after approval: the board brings every task's branch up to date by itself, and the agent hears about it only when there is a real conflict |
| `sync-merge.test.js` | Conflicts with main are caught before review, not after approval: the board brings every task's branch up to date by itself, and the agent hears about it only when there is a real conflict |
| `sync-remote.test.js` | Conflicts with main are caught before review, not after approval: the board brings every task's branch up to date by itself, and the agent hears about it only when there is a real conflict |
| `tabs.test.js` | A task's tabs in its herdr space: the agent's tab is named Agent, each reviewer has a tab of its own |
| `task-numbers.test.js` | A task's number on its row (`#134`), a repo's short key (`repo.key`: `HSW-134`), and naming a task by it: the tag's one column, what it gives way to, the three tags side by side, several repos in one list, find, and… |
| `theme.test.js` | The board takes its colours and status marks from herdr's own config, resolved the way herdr resolves them |
| `titles.test.js` | A title's length limit: one number, the same for a task typed, renamed, suggested, or made from a reviewer's finding |
| `turns.test.js` |  |
| `waiting.test.js` | An agent that stopped to wait for the human is waiting, not finished: no check, no review, no merge follow |
| `watcher-pace.test.js` | The Watcher's pace: how often it looks, what it skips, one call at a time, and giving way on a busy machine |
| `watcher.test.js` | The hidden helper: the watcher's line and guess |
| `web-board.test.js` | The web board's data: the same list, panel, buttons, questions and words the terminal board has, read from the board's own code, and a button that presses the board's own key |
| `web-door.test.js` | The front door of the herdr web UI: everything passes through as it is, the page gets one script line, and the board's own calls are only for someone the web UI lets in (a stand-in web UI answers here, in this process) |
| `web-link.test.js` | The one setup step of the board in the herdr web UI: finding the web UI, pointing its shared link at the front door after a yes, pointing it back, and the terminal board asking once (Tailscale is a stand-in here) |
