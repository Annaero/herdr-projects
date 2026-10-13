# Review of every key hint (task 110)

A one-off report: what was changed and what was removed when every key hint on the board was reviewed, and why.
How the hint line works now is in [keys.md](../keys.md#the-hint-line).

## Changed

| Where | Was | Is | Why |
|---|---|---|---|
| Hint line, every task | `? more` | `? all keys` | "more" did not say more of what. |
| Hint line, a task with an agent | `enter open the agent` | `enter open this task's agent` | It did not say which agent. |
| Same | `space reply` | `space talk to the agent` (after a hint that named the task), `space talk to this task's agent` | "reply" did not say to whom, and the key does not send anything: it flips who the chat talks to. |
| A task with no agent | `space reply` | `space talk about this task` | There is no agent to reply to: the message starts one, or goes to the Coordinator about the task. |
| A task nobody started | `tab put an agent on it` | `tab put an agent on this task` | "it" was not named. |
| An agent asks a question | `space answer` | `space answer this task's agent` | Answer whom. |
| An agent asks for a permission | `ctrl+l say yes` | `ctrl+l say yes to this task's agent` | Yes to whom. |
| Ready to approve | `ctrl+l approve and merge` | `ctrl+l approve and merge this task` | Merge what. |
| Same | `ctrl+r send back` | `ctrl+r send the review to the agent` | It did not say what is sent, or to whom. |
| Something went wrong | `ctrl+r send it to the agent to fix` | `ctrl+r tell this task's agent to fix it` | Shorter, and names whose agent. |
| Same | `ctrl+l retry` | `ctrl+l retry as it is` beside the key that has the agent fix it; `ctrl+l retry the failed step` alone; `ctrl+l tell this task's agent to try again` for a login | Retry what, and how it differs from `ctrl+r`. |
| Stopped without a summary | `ctrl+r tell it to continue · ctrl+l use it as it is` | `ctrl+r tell this task's agent to continue · ctrl+l use its work as it is` | Two different "it" on one line. |
| An agent at work | `ctrl+x stop` | `ctrl+x stop the agent` | Stop what. |
| A task you marked as your own work | `ctrl+x stop` | `ctrl+x put it back in to do` | There is no agent to stop there: the key moves the task back. |
| The archive | `ctrl+a restore · ctrl+x remove` | `ctrl+a restore this task · ctrl+x remove this task` | Restore and remove what. |
| The chat's message | `alt+c hide the chat` / `show the chat` | `alt+c hide the latest message` / `show the latest message` | The chat is never hidden: only its latest message is. The `?` menu already said so. |
| The whole task | `↑↓ scroll · esc back` | `↑↓ scroll the task · esc back to the list` | Scroll what, back to where. `↑↓` now shows only while the task is longer than the window. |
| A filter that is kept | nothing | `esc clear the filter` | The key worked, and nothing said so; with nothing matching it was the only way out. |
| The `?` menu | `↑↓ pick · enter do it · esc close` | `↑↓ pick a key · enter press it · esc close the menu` | Pick what, do what. |
| A suggestion waits | `ctrl+n suggested task` | `ctrl+n see this task's suggestion` | It had no verb: it did not say what the key does. |
| Typing to the Coordinator | `enter send · tab send, and put an agent on it` | `enter send to the Coordinator · tab send, and put an agent on what it adds` | Send to whom; "it" was the tasks the Coordinator adds, not the message. |
| Typing to a task's agent | `enter send to its agent` | `enter send to this task's agent` | Same words as everywhere else. |
| Typing to a task with no agent | `enter start an agent with it` / `enter send` | `enter send, and start an agent on this task` / `enter send to the Coordinator, about this task` / `enter add to this task's description` | It now says where the words really go, in each of the three cases. |
| Typing with no Coordinator | `enter add a task · tab add it and start an agent` | `enter add it as a task · tab add it and put an agent on it` | The board's one verb for `tab` is "put an agent on". |
| Words on their way to another machine | `ctrl+x stop it · enter take it back to change` | `ctrl+x stop sending this · enter take the words back to change` | Two different "it". |
| An error on screen | `(esc)` | `(esc dismisses)` | A key alone is not a hint. |
| `?` menu | `send it back to the agent` | `send it back: tell the agent to fix it, or to continue` | The same words as the hint line. |
| `?` menu | `archive the task`, `remove the task`, `pin to the top`, `unpin` | `archive this task`, `remove this task`, `pin this task to the top`, `unpin this task` | The same words as the hint line; pin did not say what. |
| `?` menu, a task you marked as your own work | `stop the agent` | `put this task back in to do` | There is no agent there: the menu now says what the key does, as the hint line does. |
| `?` menu | `find` | `find: show only the tasks that match` | It did not say what find does. |
| `?` menu | `show the side panel`, `the whole task, full screen` | `show the side panel: this task, beside the list`, `show the whole task, full screen` | What the panel is; a verb. |
| `docs/keys.md` | `Ctrl+F`: "find"; `Alt+P`: "the side panel" | what find does and how to leave it; what the panel shows | Both rows said only the name. |

## Removed from the hint line

| Removed | Why |
|---|---|
| `type what needs doing` | The text box's own grey words say it, and so does the empty list. |
| `type your reply`, `type your answer` | The text box's grey words say `your reply`, `your answer`. |
| `↑ back to the list` (words on their way to another machine) | The arrows move the selection everywhere: it stated the obvious. |
| `↑↓ scroll the task` on a task that fits the window | The key does nothing there. |
| `alt+c hide the latest message` in a narrow window, first | Hiding a message is the least needed thing on the line; `?` has it. |

## What gives way in a narrow window

The first hint and the last one stay. Between them: the key that hides the message, then the rest from the last
back; the key that shows a hidden message outlasts them. While you type, `shift+enter new line` goes first. With room
for one hint it is the main thing; while you talk to a task's agent it is `space back to the Coordinator`.

Before, in a window too narrow for two hints the line was cut in the middle with `…`. Now a whole hint goes, and
the one that is left is said shorter where it is still too wide (`enter send`), down to about 34 columns.

## Ctrl does, Alt only shows or hides

- **`Ctrl+F` breaks it.** Find only changes which tasks the list shows, so by the rule it is an `Alt` key. It is
  left as it is (every program finds with it) and `docs/keys.md` now says so. Moving it to `Alt+F` is suggested to
  the human as a task of its own.
- **`Alt+M` is at the edge.** It only shows other machines, but while one machine is shown by itself, what you type
  goes to that machine's Coordinator. The chat says so; the key is left.
- Every other `Ctrl` key does something and every other `Alt` key only shows or hides. No hint says otherwise.

## Left as they were

`alt+t shows the whole task` and `ctrl+n makes it a task, or dismisses it` in the panel, `alt+u more ↑` /
`alt+j more ↓` on the chat's box, `y = yes · n = no` in a question, `Press ctrl+c again to close the board`,
`enter keep the filter · esc cancel`, `esc put away`, and the first run's own keys: each says what happens and to
what already.
