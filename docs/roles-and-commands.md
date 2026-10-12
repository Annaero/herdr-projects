# Roles and commands

**Four roles.** The **Agent** does the work. The **Reviewer** attacks finished work. The **Watcher** is a small
model that writes the "doing now" line and guesses one number: how far along the work is, in percent (it skips a look
when the screen has not changed). It is shown the task and its description, the last lines on the agent's screen, how
long the work has run and its own previous guess, which it keeps unless the screen gives a reason to change it. The
guess goes down as well as up: a failing test, a merge conflict or review findings to fix mean more work, so a lower
percent. The board works out the minutes left from that percent and the time spent: time spent × (100 − percent) ÷
percent, so 40 minutes in at 80% is 10 minutes left. The time spent counts from when the agent began on what you last
asked of it (or, while the Reviewer works, from the start of that review round), and the minutes are worked out anew
every second, so they keep moving between looks. Under 5% there is too little to go on and no minutes are shown. Your
own tasks are different: they show the `--progress` and `--eta` you give `report`, as given. The
**Coordinator** is the agent you talk to in the chat: one long-lived chat that turns what you type into board commands, and
can do whatever else an agent chat can. Like the Agent, it is Claude Code on its default model and effort unless you
say otherwise, whatever the Agent is set to: set `coordinator`, `coordinatorModel`, `coordinatorEffort` (any
`herdr agent start --kind` value), or pick one for a single use with `coordinator new --agent …`. A changed
default applies to the next new one; the chat says so. `coordinator off`, a program that is not installed, or no
running herdr: the chat says "New task", and what you type is filed word for word.

**Every chat knows the board.** With `skill` on (the default) the plugin keeps a small how-to, a folder named
`herdr-superwork` holding `SKILL.md`, in each installed agent program's own skills folder (`~/.claude/skills`,
`~/.codex/skills`, `~/.pi/agent/skills`), so an ordinary chat can "file this on the board" without being told how.
It gives the command by its full path, so `npm link` is not needed. `herdr-superwork config skill off` removes
exactly what was written; a folder of that name the plugin did not write is left alone.

Commands: `add`, `list`, `report`, `describe`, `delegate`, `tell`, `stop`, `approve`, `review`, `retry`, `fix`,
`finish`, `details`, `pin`, `archive`, `restore`, `clear`, `config`, `remove-extras`; `herdr-superwork help` lists
them. An agent the board itself started may only run `add`, `list`, `details` and `report <its own task> --state
blocked` (its reviewer: `list` and `details`); the rest is refused with one line. That is a guard against mistakes,
not a security boundary.
