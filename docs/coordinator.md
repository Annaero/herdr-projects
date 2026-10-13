# The Coordinator

**The Coordinator is one agent chat.** It is a single long-lived agent, not a call per instruction: everything
you type goes into the same conversation, so "delegate that one too" works, and it can ask you something back. Your
words reach it exactly as typed: which repo you were in and which task you had open are kept beside each message,
and the Coordinator asks for them itself (`herdr-superwork coordinator where` lists the last few messages, each with
its own).

**`Tab` means "and start it right away".** A message sent with `Tab` instead of `Enter` has every task the
Coordinator adds from it delegated at once, however many there are, with nothing more to confirm. That does not
hang on the Coordinator remembering to look something up: the message carries one line under your words saying it
was sent with `Tab` (the chat on the board shows your words alone), and the board does it too: a task the
Coordinator adds while it is still in the turn of a `Tab` message is delegated by `add` itself. A message that
adds nothing (a question, a status check, a word about an existing task) delegates nothing extra, and one sent with
`Enter` is as before: its tasks are added, and delegated only when you asked for that. From a shell,
`herdr-superwork coordinator tell <text> --delegate` is the same as `Tab`. A board opened from the Coordinator's own pane stays in the repo it was
last in: that pane's folder is nobody's repo. It is
an ordinary herdr agent in a tab of its own, named `Coordinator`, in your home space (`~`; see below), in a folder
of its own inside the board's data
folder (`HERDR_SUPERWORK_COORDINATOR_DIR` names another, which should be used for nothing else: the board writes the Coordinator's rules there), started with the same
arguments as any working agent: all its tools, nothing held back. It is started by your first message and stays; when
its program exited or herdr restarted, your next message starts it again in the same conversation. The agent's own
new-chat command (`/clear`, `/new`) is followed: the chat and a restart go with the conversation it is in now.

**Its standing rules are a file in its folder.** What the Coordinator is and how it uses the board is written as
`AGENTS.md` in the folder it starts in (`~/.herdr-superwork/data/coordinator/<session>/chat`, see
[the home folder](home-folder.md)), and the program reads that file by itself at the start of every conversation.
So it still knows its rules after its own `/new` or `/clear`, after `coordinator restart` and `coordinator new`,
after `coordinator new --agent <another kind>` (the next program reads the same file), and when you start the
program in that folder by hand.

| Kind | Reads | So the board writes |
|---|---|---|
| Claude Code | `CLAUDE.md` (2.1.296 also reads an `AGENTS.md` beside it) | `AGENTS.md`, and a `CLAUDE.md` that only passes on to it (`@AGENTS.md`): the rules arrive once |
| Codex | `AGENTS.md` | `AGENTS.md` |
| pi | `AGENTS.md` | `AGENTS.md` |
| any other kind | not known | `AGENTS.md`, and one line before its first message that points at the file |

- **One way per kind, never two.** The Coordinator gets no launch flag for its rules any more (before: Claude's
  and pi's appended system prompt, Codex's `developer_instructions`). The file is the one way that works the same
  on every kind and outlives the program: a flag is gone when the process is, has to be passed again by whoever
  starts the program, and Codex's could not carry this much text on one launch line, so it only pointed at a file
  the Coordinator then had to remember to read. With the file in place a flag would tell it the same thing twice.
  A kind the board does not know may or may not read `AGENTS.md`, so that one alone also gets the pointing line.
- **Kept up to date.** The files are written again at every start and before every message, so new rules (a new
  version of the board) are in place under a Coordinator that is running: it reads them at its next new chat or
  restart.
- **Your own notes are kept.** The board owns only the block between its two marker lines. What you write above
  or below it in `AGENTS.md` or `CLAUDE.md` stays, and the Coordinator reads it too.
- A working agent or a reviewer is not told this way: it works in your repo, whose `AGENTS.md` is yours, so its
  rules still ride on its launch.

**What it says it did.** When it acted on the board, its message ends with one short line that names the ids in
plain words: added, updated (a title, a description, settings), removed, started an agent, approved, archived,
restored. For example "Added proj/12 and started an agent on it". The commands answer in the same words (see
[roles and commands](roles-and-commands.md)).

On the board you talk to it through the chat and read its latest message there (`Alt+C` shows and hides it). For the
whole conversation, its dialogs, its slash commands and its menus you **go into it** in herdr, not from the board:
it is an ordinary agent in the `Coordinator` tab of your home space, and the plugin action `herdr-superwork.coordinator` (bind a
key to it) goes straight to its pane from anywhere in herdr, starting it first when it is not running. From there
you get back to the board, or go anywhere else in herdr, the way you do from every other agent: your board key, or
`herdr-superwork`.

**Where it lives in herdr.** The Coordinator has no herdr space of its own in the sidebar: it is a tab named
`Coordinator` in the home space, the one herdr labels `~`. It is a whole tab, never a pane inside one of yours.

- **Found or started, from everywhere.** A message from the board in a pane, from the board in herdr's popup or from
  a shell (`coordinator tell`) goes to the Coordinator that is running. When none is (its program exited, its tab or
  the home space was closed, herdr restarted) the message starts it again in the same conversation, in a
  `Coordinator` tab of the home space. There is never a second one, and never a space made for it.
- **No home space on this machine?** One is made (at your home folder, as herdr would), then the tab is added.
- **Nothing you look at changes.** The tab, and a home space that had to be made, are opened without focus: you stay
  where you are, and as it is a tab of its own the board and every other tab keep their size and layout.
- **Which space is home.** The one labelled `~`. herdr labels a space after the folder its first tab is in, so the
  label changes when you go somewhere else in that tab: the board remembers the space the tab was last put in and
  uses that one when no space is labelled `~`. A task's space is never taken for it.
- **Its tab's name is yours to change.** The board finds the Coordinator by its pane, as it does a task's agent and
  reviewers ([A task's tabs](tabs.md)). When the board has lost track of it (its saved state is gone) it looks for
  the pane in the Coordinator's own folder, in whatever space that is and whatever the space is labelled: a
  Coordinator that runs there is the one your message goes to, in the conversation it is in, and an empty
  `Coordinator` tab left in that folder is taken up rather than a second one opened.
- **`coordinator stop`, `restart` and `new` close its tab**, never the home space around it.
- **Moving over from the old layout.** Before, the Coordinator had a space of its own named "Coordinator". One that
  still runs there is moved into the tab as it is: the same program, in the middle of whatever it was doing, with
  nothing restarted, and herdr closes the old space as its last pane leaves. That happens by itself within a minute
  of the update (the keeper or an open board does it), or at your next message if that comes first. On a herdr that
  will not move a pane, your next message closes its pane in the old space and starts it again in the tab, in the
  same conversation; `stop`, `restart` and `new` do the same. Only ever its own pane is closed: herdr closes the
  old space with its last pane, and if you put panes or tabs of your own in that space it stays open with those.

Restarting it (the same conversation) and starting a new one (a fresh conversation) are commands, not keys of the
board: `coordinator restart` and `coordinator new`. For a different one this once, use `coordinator new --agent …`
below: your default stays as it is. From a shell, or by asking it:
`herdr-superwork coordinator` (how it stands), `coordinator tell <text>`, `coordinator restart`,
`coordinator new [--agent KIND] [--model M] [--effort E]`, `coordinator stop`.
