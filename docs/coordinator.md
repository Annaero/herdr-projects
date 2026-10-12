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

On the board you talk to it through the chat and read its latest message there. For the whole conversation, its
dialogs, its slash commands and its menus you **go into it**, exactly as into any task's agent: `alt+c` leaves the
board and herdr shows the Coordinator's own pane (when it is not running it is started first, and you go in as soon
as it is there). From there you get back to the board, or go anywhere else in herdr, the way you do from every other
agent: your board key, or `herdr-superwork`. Outside a herdr client (plain SSH) the terminal attaches to it and the
board returns when the attach ends. To go into it from anywhere in herdr without the board, bind a key to the plugin
action `herdr-superwork.coordinator`.

While you talk to the Coordinator, `alt+r` restarts it in the same conversation and `alt+n` starts a new one with a
fresh conversation; both ask first, and like every shortcut they act only while the text box is empty. For a
different one this once, use `coordinator new --agent …` below: your default stays as it is. From a shell, or by asking it:
`herdr-superwork coordinator` (how it stands), `coordinator tell <text>`, `coordinator restart`,
`coordinator new [--agent KIND] [--model M] [--effort E]`, `coordinator stop`.
