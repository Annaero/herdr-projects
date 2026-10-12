# The Coordinator

**The Coordinator is one agent chat.** It is a single long-lived agent, not a call per instruction: everything
you type goes into the same conversation, so "delegate that one too" works, and it can ask you something back. Your
words reach it exactly as typed: which repo you were in and which task you had open are kept beside each message,
and the Coordinator asks for them itself (`herdr-superwork coordinator where` lists the last few messages, each with
its own).

**`Tab` means "and start it right away".** A message sent with `Tab` instead of `Enter` has every task the
Coordinator files from it delegated at once, however many there are, with nothing more to confirm. That does not
hang on the Coordinator remembering to look something up: the message carries one line under your words saying it
was sent with `Tab` (the chat on the board shows your words alone), and the board does it too: a task the
Coordinator files while it is still in the turn of a `Tab` message is delegated by `add` itself. A message that
files nothing (a question, a status check, a word about an existing task) delegates nothing extra, and one sent with
`Enter` is as before: its tasks are filed, and delegated only when you asked for that. From a shell,
`herdr-superwork coordinator tell <text> --delegate` is the same as `Tab`. A board opened from the Coordinator's own pane stays in the repo it was
last in: that pane's folder is nobody's repo. It is
an ordinary herdr agent in a space of its own (named "Coordinator"), in a folder of its own inside the board's data
folder (`HERDR_SUPERWORK_COORDINATOR_DIR` names another, which should be used for nothing else), started with the same
arguments as any working agent: all its tools, nothing held back. It is started by your first message and stays; when
its program exited or herdr restarted, your next message starts it again in the same conversation. The agent's own
new-chat command (`/clear`, `/new`) is followed: the chat and a restart go with the conversation it is in now.

On the board you talk to it through the chat and read its latest message there (`Alt+C` shows and hides it). For the
whole conversation, its dialogs, its slash commands and its menus you **go into it** in herdr, not from the board:
it is an ordinary agent in a space named "Coordinator", and the plugin action `herdr-superwork.coordinator` (bind a
key to it) goes straight to its pane from anywhere in herdr, starting it first when it is not running. From there
you get back to the board, or go anywhere else in herdr, the way you do from every other agent: your board key, or
`herdr-superwork`.

Restarting it (the same conversation) and starting a new one (a fresh conversation) are commands, not keys of the
board: `coordinator restart` and `coordinator new`. For a different one this once, use `coordinator new --agent …`
below: your default stays as it is. From a shell, or by asking it:
`herdr-superwork coordinator` (how it stands), `coordinator tell <text>`, `coordinator restart`,
`coordinator new [--agent KIND] [--model M] [--effort E]`, `coordinator stop`.
