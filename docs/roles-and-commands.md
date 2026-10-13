# Roles and commands

**Four roles.** The **Agent** does the work. The **Reviewer** attacks finished work. The **Watcher** is a small
model that writes the "doing now" line and guesses one number: how far along the work is, in percent (about once a minute, and it skips a look
when the screen has not changed: [the Watcher](watcher.md)). It is shown the task and its description, the last lines on the agent's screen, how
long the work has run and its own previous guess, which it keeps unless the screen gives a reason to change it. The
guess goes down as well as up: a failing test, a merge conflict or review findings to fix mean more work, so a lower
percent. The board works out the minutes left from that percent and the time spent: time spent × (100 − percent) ÷
percent, so 40 minutes in at 80% is 10 minutes left. The time spent counts from when the agent began on what you last
asked of it (or, while the Reviewer works, from the start of that review round), and the minutes are worked out anew
every second, so they keep moving between looks. Under 5% there is too little to go on and no minutes are shown. Your
own tasks are different: they show the `--progress` and `--eta` you give `report`, as given. The
**Coordinator** is the agent you talk to in the chat: one long-lived chat that turns what you type into board commands, and
can do whatever else an agent chat can. Like the Agent, it is Claude Code on its default model and effort unless you
say otherwise, whatever the Agent is set to: set `coordinator.agent` (`claude`, `codex` or `pi`, with a model after
a slash), `coordinator.effort`, `coordinator.fast`, `coordinator.access` and `coordinator.instructions`, or pick one
for a single use with `coordinator new --agent …`. A changed default applies to the next new one; the chat says so.
`coordinator.agent none`, a program that is not installed, or no
running herdr: the chat says "New task", and what you type is added word for word.

**Every chat knows the board.** The plugin keeps a small how-to, a folder named
`herdr-superwork` holding `SKILL.md`, in each installed agent program's own skills folder (`~/.claude/skills`,
`~/.codex/skills`, `~/.pi/agent/skills`), so an ordinary chat can "add this to the board" without being told how.
It gives the command by its full path, so `npm link` is not needed. `herdr-superwork remove-extras` removes
exactly what was written, and it is not written back; a folder of that name the plugin did not write is left alone.

Commands: `add`, `suggest`, `suggestions`, `accept`, `dismiss`, `list`, `report`, `describe`, `delegate`, `tell`, `stop`, `approve`, `review`, `retry`, `fix`,
`finish`, `details`, `pin`, `archive`, `restore`, `clear`, `set`, `unset`, `show`, `automations` ([automations](automations.md)), `machines` ([other machines](other-machines.md)), `remove-extras`; `herdr-superwork help` lists
them.

**Agents the board started: able, not nudged.** An agent or a reviewer the board itself started on a task can run
every one of these commands, as the Coordinator or an agent in your own shell can: `add` (also with `--delegate`),
`delegate`, `tell`, `stop`, `accept`, `dismiss`, `approve`, `archive`, `restore`, `clear`, `set`, `unset`, `describe` and
the rest. Nothing is refused and nothing is turned into something else. But their rules name none of these and
say plainly: do nothing to the board beyond your own task (reporting your own state, suggesting work you came
across) unless a human explicitly told you to. An explicit instruction in the task's own description, or in a
message from you, counts as being told, so a task that says "add a task for each failing page and delegate it" has
its agent do that. Work it merely comes across is still a [suggestion](suggestions.md) you accept or dismiss, never a
task, and a reviewer's `preexisting` finding still becomes one. That holds for its own task as well: its rules
tell it to report itself `blocked` and nothing else (the finish line marks its work done), but a `report` of
`done`, `idle` or `error` from it is taken like anyone's.

**What a command answers.** Each command answers in one line that starts with the task's id, in the same few plain
words everywhere (the board's own messages and the Coordinator's closing line use them too): `add` says **added**
(`proj/12: added`, or `proj/12: added, an agent is on it` with `--delegate`); `describe`, a new title and `report`
say **updated**, with what changed (`updated (description)`, `updated (title)`, `updated (done)` for a new state);
`delegate` says **started**; `clear` says **removed**; `archive` and `restore` say **archived** and **restored**;
`approve` says **approved**.