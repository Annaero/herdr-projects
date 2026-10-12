# herdr-superwork

A work board for [herdr](https://herdr.dev): one list of tasks, yours and delegated ones. Every delegated task runs
as an ordinary herdr agent in its own herdr space. The board is an overview and a remote control; herdr is the engine.

It is pi-work's board, rebuilt for herdr: the same screen and keys, but agents are real herdr
agents, their status is mirrored from herdr, and going into a task takes you to that agent's own terminal.

Linux. Needs herdr 0.9.3 or newer, Node 22.19+, `git`, `flock` (util-linux), and optionally `gh` (pull requests) and
`tailscale` (private review links).

## Install

```sh
cd herdr-superwork
npm install
npm link                          # puts `herdr-superwork` on your PATH (agents use it too)
herdr plugin link "$PWD"          # hooks, the popup and the actions
```

Typing `herdr-superwork` in any pane opens the board. The first time it opens inside herdr it shows one screen with
two things it can add to your herdr `config.toml`. Each is your choice, answered with single keys: `1` and `2` switch
them on or off, `k` picks another key, `enter` saves, `esc` asks again next time. The file is backed up first, each
block sits between two marker lines, and a change herdr rejects is rolled back:

- a key that opens the board (it suggests one herdr does not use; `prefix+w` is herdr's own workspace picker);
- sidebar rows, so herdr's sidebar shows each task's stage, its "doing now" line, its progress and the minutes left. herdr's default
  sidebar shows none of these: without the rows the plugin puts a short status into the agent's name instead
  (`approve? pass · claude`), which works with no setup. With the rows in place the name is left alone, so the
  status is not said twice on one line.

Nothing else is needed: no herdr integration, no hooks in your own agent settings. To add the blocks by hand instead:

```toml
[[keys.command]]
key = "prefix+a"
type = "plugin_action"
command = "herdr-superwork.open"

[ui.sidebar.agents]
rows = [["state_icon", "machine", "workspace", "tab"], ["agent", "state_text"], [{ token = "$summary", dim = true }, "$progress", "$eta"]]

[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["branch", "git_status"], [{ token = "$summary", dim = true }]]
```

Optionally bind `herdr-superwork.approve-current` too: for the task that owns the focused pane it opens the board on
that task with the merge question up (`enter` = yes, `esc` = no), and does nothing anywhere else.

**Before unlinking the plugin** run `herdr-superwork remove-extras`: herdr gives a plugin no uninstall hook, so this
is what takes the marked blocks out of `config.toml` and removes the how-to files (below).

Your running herdr server must be 0.9.3 or newer: an older server refuses the plugin until it is restarted.

## Using it

Type what needs doing and press `Enter`: that adds a task. `Tab` puts an agent on the selected task. Nothing is
edited by hand: to change a title, a description or a state, say so in the text box or run the command.

**The list.** One line of header, then the tasks in five groups, in the order they need you:

| Group | Holds |
|---|---|
| `needs you` | a question, something that went wrong, a merge that failed |
| `ready to approve` | finished, reviewed work that waits for your yes |
| `working` | an agent or the reviewer is on it |
| `done` | finished, newest first |
| `to do` | nobody has started it |

Each state has a mark of its own (`◐` working, `×` needs you, `✗` went wrong, `✓` done or ready, `○` to do), so no
two are told apart by colour alone (herdr's `status_indicators = "dots"` brings its dots back). A row reads: the
name, a sentence, then on the right the progress bar, the percent and the minutes left, the pull request, and the time:

```
 ready to approve
 ✓ Add an undo for clear  Fail · 1 critical, 1 major · 2nd review   PR#18 ✓ 12m ago
 working
 ◐ Tidy the first-run questions  Running the tests           ███░░░░░  40% 12m PR#17    5m
```

The row says how the review came out and a short tally of what it found (`Pass · 2 minor`, `Fail · 1 critical, 1 major`). Which review it was shows only from the second on. While the
reviewer works, the mark, the bar, the percent and the minutes left take a colour no other state uses: that alone says a review is
running, and the sentence says only what the reviewer is doing. `PR#18 ✓` means its checks pass, `✗` that they fail. A bare time is how long it has been working; `ago` is
since it stopped. A row never repeats what its heading says.

**One chat, at the bottom.** The text box is a chat, and it is the same chat whoever you talk to. One rule decides
who that is: press `Space` on a task and you talk to that task's agent; otherwise you talk to the Coordinator. Ask it
something, tell it to do something, or just say what needs doing.

```
──────────────────────────────────────────────────────────────────────────────────────────────
 ○ Coordinator  idle  claude · default model · default effort    alt+c open its chat · esc hide its message
 › file the undo task
 Filed proj/4: Add an undo. An agent is on it.
──────────────────────────────────────────────────────────────────────────────────────────────
❯ ask or tell it anything
──────────────────────────────────────────────────────────────────────────────────────────────
```

The chat's first line says who you talk to, on the whole width of the window: the Coordinator, or the task by its
full name with where it stands and which agent is on it (a name longer than the window takes a second line; in a
window too short for that, the draft keeps the line). The text box and its hints are never pushed off the window: the
chat gives way first. The
prompt is only `❯`. Under that line is the latest thing they said (their screen while a dialog is up): `Alt+V` hides
it and shows it again, in a narrow window too (where the key does not fit beside the name, the hint line says it),
and the board remembers which. `Esc` hides it too, as its first step back (with nothing typed): while the message is up, `Esc` does only that, and the chat's line names `esc` as the key. A Coordinator that could not be started says why even while the message is hidden; `Esc` (or `Alt+V`) puts that error away too, until the next one. `Alt+C` goes into the whole chat of whoever it names. Where the
Coordinator stands (starting, working, needs you, a new reply) is said on that first line and nowhere else.

**A board that looks cut off or half empty.** The board takes its pane's size back by itself within a few seconds:
the remote view described here is disconnected, and until then the board draws inside what herdr's window shows, so
its text box and hints are never cut off. What follows is what you see with the setting `ownTerminal` off, where the
view stays and `Alt+W` disconnects it. A remote view of the pane the board runs in (a `herdr terminal attach`,
which herdr's web UI starts for each pane it shows) sets that pane's size to its own and holds it for as long as it
runs, also after its browser tab is gone. herdr's own window then shows a cut-out of a board drawn for another size.
The board notices within ten seconds and says so on its first line, top left where a cut-out still shows it, with what frees the size first so a narrow window keeps it:

```
 ! Held at 435×58: alt+w, or kill 2884 frees it. Drawn for a remote view of this pane, so herdr's own window (184×78) shows it cut off or half empty · herdr terminal attach, open 40m
```

Closing that view, or stopping the process it names, gives the pane its own size back at once. The line is not shown
in the popup (which has no pane of its own), outside herdr, or in a tmux inside the pane.

While the text box holds text it owns the keyboard: only `Enter`, `Tab` and `Esc` act on the board, so no shortcut
fires in the middle of a draft. `Esc` puts a draft away; `Ctrl+Z` brings it back to whoever it was for, so a reply
stays a reply.

**The task panel** shows the selected task. Beside the list it is closed until you ask for it: `Ctrl+P` opens and
closes it (in a window of 90 columns or more), and your choice is remembered. Closed, each row has the whole width
for what it says. `Ctrl+E` shows the whole task full screen (as does `Space` in a narrow window, with the chat set
to that task's agent). Opening or folding the whole panel never changes who you talk to: only `Space` does, at
every width.

Both have the same parts, in the same order, each standing on its own under a bold headline on a thin rule, with an
empty line between:

```
 Build a flying game
 ✓ ready to approve · 3rd review · claude · 2m ago · proj/12
 4 files, +120 −31 · PR#12 ✓

 Description ────────────────────────────────
 A little plane over endless sunny islands.

 Reviews · 3 ────────────────────────────────
 fail → no verdict → pass
 ╭─ Review 3 ────────────────────── 1m ago ─╮
 │ Pass · 2 minor                           │
 │ Works. Two small naming points are left. │
 ╰──────────────────────────────────────────╯

 The agent said ─────────────────────────────
 Built Skylark. All 42 tests pass.

 Settings ───────────────────────────────────
 Project      ~/dev/proj
 Agent        claude · opus · default effort
 …
```

- **Where it stands** comes first: the title, then the state with who is on it, since when and the task's id, then
  the size of the change and its pull request (its number is a link; full screen the address is printed too).
- **What it needs from you**, or what it is doing right now, sits behind a bar in its state's colour: the question,
  what went wrong and the next step, or the agent's current line.
- **The description**: whole on the full screen, cut after about 400 characters beside the list.
- **The reviews**, each one a box of its own (below).
- **What the agent said** (while you talk to its agent that is in the chat instead).
- **Every setting**, also one that is only your default: the project, the worktree, the agent, the reviewer, what
  gets reviewed, what sends a review back and how many rounds, the evidence, the watcher, conflict repair and
  permissions. Labels are greyed out; a setting chosen for this task is in the text colour and one that is only
  your default is quieter. Full screen a task's own choice is starred as well.

Full screen the text keeps to 100 columns, and a last part, **Session**, has the agent's context, its tokens and
where it runs in herdr. Beside the list, when anything is shorter than on the full screen, the last line says
`ctrl+e shows the whole task`. In a short window the long parts give up lines (what the agent said first, then the
description, then the review), every setting keeps to one line, and in the end the review is one line
(`Review 3  Pass · 2 minor`): no setting drops out of the side panel. Only a window with fewer lines than there
are settings cuts them, from the last; the title and the review's line stay. In a box too narrow for a review's
age and commit in its top edge, they are the box's first line.

**Every review is kept, and each is a box of its own.** Under the headline one line says how each went, oldest
first (`fail → no verdict → pass`). Beside the list the latest review follows: `Review 3` and its age in the box's
top edge, then the result with its tally, and its summary. The full screen has all of them, the newest first, each
in its box: the review's number, when, the commit, the result, the summary, each finding with its severity (one
that did not hold the work back is marked `not required` or `pre-existing`), what it checked and what it could not
verify. A review that gave no verdict has its box too, with why. A review from before the gate keeps its score and
its advice as they were (`4/5, says merge`). `herdr-superwork details <id>` prints the same list as `reviews`.

**The board asks before what cannot be undone**, always the same way, in a small box: `Merge PR#18?  enter = yes ·
esc = no`. Merging, deleting a task and closing the board ask; nothing else does. A result stays on screen until
your next key press, an error until `Esc` dismisses it.

| Key | Does |
|---|---|
| `↑` `↓` | move between tasks |
| `Enter` | send what you typed; with nothing typed, open the task's agent: its real herdr pane. The board closes (the first few times it says how to get back); your key brings it back where you left it |
| `Space` | talk to this task's agent: the chat says so, and `Space` goes back to the Coordinator (so does `Esc`, once the chat's message is hidden). On a task with no agent, your message puts one on it |
| `Tab` | put an agent on the task. With text typed for the Coordinator: send it, and every task it files from that message gets an agent at once, with nothing more to confirm (a message that files nothing delegates nothing) |
| `Ctrl+A` | yes, to whatever the task waits for: approve the merge (it asks first), say yes to the agent, retry the step that went wrong as it stands, or take work that stopped without a summary as it is |
| `Ctrl+R` | send it back: whatever went wrong (a failed check, a conflict, an error, a review with findings) goes to the task's agent to fix; a stopped agent is told to continue |
| `Ctrl+X` | stop the agent. The selection stays on that row |
| `Ctrl+F` | find |
| `?` | a menu of everything else for the selected task, picked with `↑` `↓` and `Enter`: the whole task full screen, the side panel, archive, pin, delete, undo, the archive, group by repo, show all done, other machines, the Coordinator |
| `Esc` | back, one step at a time: a draft is put away, then the chat's latest message is hidden (the Coordinator's or a task agent's), then the open task, the filter and the archive close. Only with none of those left does it ask before the board closes |

The bottom line shows only what matters right now, the main thing first, at most four. The older chords still work
when the text box is empty, and the menu shows each beside its line: `Ctrl+E` the whole task, `Ctrl+P` the side panel, `Alt+A` archive or
restore, `Alt+H` the archive, `Ctrl+Z` undo, `Ctrl+T` pin, `Ctrl+S` group by repo, `Ctrl+D` all done, `Ctrl+O`
other machines, `Delete` delete, `Alt+C` the whole chat, `Alt+V` the latest message shown or hidden (`Esc` hides it too), `Alt+R` and `Alt+N` restart the
Coordinator or start a new one. (`Ctrl+B` is herdr's own prefix key, so the side panel's key is `Ctrl+P`.)

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

## How work gets done

**Delegating.** In a git repo the plugin asks herdr for a worktree workspace (`herdr worktree create`), on its own
branch `work/<n>-<title>`, started from the remote's default branch (or your commit with `--base head`). The repo's
`setup` runs, then the agent starts in that workspace's root pane and gets the task and its rules. Outside git the
agent works in place in a plain herdr workspace. At most `max` (4) agents work at once; more wait their turn, and
tasks that wait for you hold no slot.

**Finished = the agent says its turn ended.** The plugin starts every agent itself, and at launch it passes a
turn-end hook on the command line (Claude Code: `--settings <a file in the task's own folder>`; Codex:
`-c notify=[…]`; pi: `-e <a one-file extension>`), a session id of its own choosing where the program takes one, and
the task's rules as a standing system prompt. Nothing is written to your own agent settings, and your own hooks keep
running. At each turn end the hook runs `herdr-superwork turn-ended` (silent, at most two seconds, protected by a
per-launch secret), and the finish line reads the end of that agent's saved conversation: its last message, an API or
login error, token use. With the board open or closed it then:

1. commits anything left over, brings the branch up to date with main in the task's own worktree (see "Staying
   current with main"), and runs the repo's `check` (a failure goes straight back to the agent, three tries);
2. pushes the branch and opens a draft pull request, when there is an `origin` remote and `gh`;
3. has a second agent review it adversarially, in a visible split of the same herdr space; it says what it found
   and brings evidence; whatever it changed is put back. A reviewer that ends its turn with no verdict fails the
   review at once, with its own error or last message. The board decides from the findings (see "The gate"): a
   review that fails goes straight back to the agent. The row says the result and a tally (`Pass · 2 minor`), and
   from the second review on which one it was (`· 2nd review`); the task panel has its summary, and every earlier
   review of the task;
4. waits for your approval (`Ctrl+A`).

### The gate

The reviewer describes; the board decides. The reviewer gives no score and no merge advice. Every round it answers
one fixed question, "Does the change do what the task asked?" (`meets`), and lists its findings. Each finding has a
severity, a subject, where it is, a proof (what the reviewer actually ran or saw) and whether it was there before
the task (`preexisting`). The severity says what the fault does:

| Severity | Means |
| --- | --- |
| `critical` | the work does not do what was asked, breaks something that worked, or risks security or data loss |
| `major` | a real fault in an unusual case; a claim that is not proven (a fix not shown to work, a test that cannot catch its bug); a document that states something false |
| `minor` | correct but could be better: wording, naming, a small inaccuracy, a narrow gap |
| `trivial` | a note; nothing to do |

The board then applies fixed rules to what came back:

- `meets: false` always counts as a critical finding, even with an empty list.
- A critical finding with an empty proof is treated as major.
- A pre-existing finding never sends the work back. Each is filed as a new task of its own (not delegated), once,
  however many rounds name it.
- The work **passes** when no finding of its own sits at or above the `gate` setting (`major` by default). A pass
  is what "may merge" means everywhere: a repo with `"land": "auto"` merges it, an approved merge that was repaired
  goes through, and the board says `Pass`.
- A **fail** goes back to the agent by itself, at most `rounds` times: the findings at or above the gate as
  required, the rest as optional. When the cap is reached and it still fails, it stops and waits for you.
- From the second round on the reviewer gets the earlier findings and only checks that each is fixed and that the
  fixes broke nothing. It may add a new finding only if it is critical, with proof; anything smaller it notices
  late is left out (a pre-existing fault is still filed). A reply from you starts a full review again.
- `gate off` sends nothing back by itself: findings wait for you (`Ctrl+R` sends them). The result shown and an
  automatic merge are then judged at `major`.

Findings below the gate still show on the review page, in the task panel and in a comment on the pull request,
marked as not required.

An error, a usage limit, a cut-off or a refusal is saved as "Agent stopped" with the real text; a login error makes
the task "Needs a login", and that comes first: older failure details are not sent and pull-request feedback does not
wake the agent until you have logged in and then replied, pressed `Ctrl+R` or typed in the agent's terminal. A turn
only blocks on you when the agent ran `report … --state blocked`; a final message that merely ends in a question
goes on to check and review, and you still approve at the end.

**Without a hook** (a crash, a program older than the adapter's minimum version, another agent kind, Codex when you
have your own `notify` configured, or a hook that failed three turns in a row) herdr's
status is only a guess from the screen, so "idle" alone never finishes a task. The turn counts as ended when the
saved conversation ends in a finished message or an error, or a closing note was written to
`.herdr-superwork/closing-<n>.md` (the rules still ask for one as the fallback). Otherwise the task is held as
"stopped without a summary": `Ctrl+R` tells the agent to continue, `Ctrl+Y` finishes anyway. Typing in the agent's own
terminal, or replying from the board, re-arms all of this: an approval is revoked, a pending auto-merge cancelled (a
cancellation that fails is saved as a visible failure), the old review marked stale.

**With the board closed** a small background process, the keeper (`herdr-superwork keeper`), does what the open
board's tick does: it polls pull requests, starts queued tasks, runs the Watcher, keeps herdr's sidebar labels
current. There are four labels, each saying what to do: `needs you` (a question, a login, a branch that could not be
brought up to date), `approve? pass` (or `approve? fail`), `reviewing` and `failed`; the exact reason is on the board. It raises no notification, pop-up or sound: what needs you is on the board and in
herdr's sidebar. herdr starts it with its server; any herdr event or
opening the board starts it again if it died; it replaces itself when the plugin is updated, and exits when herdr is
gone. An open board does the same: after an update it loads the new version by itself, in place, once nothing is half
typed. It looks after this machine's tasks only. The sidebar shows only tasks with a live agent pane; the others
(queued, your own) are on the board only.

**Staying current with main** is the board's job, not the agent's: nothing in an agent's rules asks for it. Tasks
run in parallel and touch the same files, so the board itself fetches main and merges it into each task's branch, in
that task's own worktree:

- *before review*: when an agent finishes, before the check and the review, so the reviewer sees the work as it
  will really land;
- *whenever main moves* (another task merged, a merge on GitHub, your own push; the remote is asked every two
  minutes): every task waiting for your approval is updated, and a task under review the moment its review ends;
- *after you approve*, once more, as the last safety net. It should rarely find anything.

A clean update is silent. If it changed the commit, the check runs again on the result; the review is repeated only
when the update touched a file the task itself changed. Otherwise the verdict you already have stands and the task
does not ask for your eyes again. A real conflict is rolled back at once (your branch and the task's are as they
were) and goes straight to the task's agent as a plain message: the conflicting files, the target commit, and that
it should resolve them in its own worktree and finish again. Until it has, the task is not waiting for approval: its
row says "resolving a conflict with main". After `rounds` repairs in a row that
still conflict, you are asked, with the details kept. `conflictAuto false` on a task keeps its conflicts for you to
send with `Ctrl+R`. Only a task at rest is ever updated: its worktree clean, on exactly the commit that was reviewed.
A fetch that fails is never taken for a sync: a finished turn is saved as "Could not synchronize main" instead of
going on to review (and as "Task is on the wrong branch" when its worktree has left the task's own branch). A waiting task whose main cannot be fetched, or that was not at rest when main moved, is held
as "behind main": its row says so, `Ctrl+A` is refused with the reason, and the board tries again
every minute until the branch really is up to date.
"Main" is where the task will land: the remote's main when it lands through a pull request; otherwise (no remote,
or `pr` off) the branch your checkout was on when the task first finished. For those, checking out another one
merges nothing into waiting tasks, and they are held as "behind main" until your checkout is back on it.

**Approving** makes that last sync, re-checks (and re-reviews, by the same rule) if it changed anything, then merges
through the pull request, only at the commit that was reviewed (when GitHub's checks are still running the board
remembers the approval and merges it itself once they pass; a commit pushed to the pull request meanwhile withdraws
it; on a repo with a merge queue the task waits until GitHub says the pull request is merged) or locally, squashed
by default. A
conflict found here goes back to the agent the same way, and the merge you approved is retried after its repair. A
checkout with unsaved files is never forced.

**When a task is done** (merged here or on GitHub, finished with nothing to merge, or called done by you) its space
leaves herdr's sidebar by itself, and its worktree and branch are removed. Work is never lost for it: a checkout
with unsaved files, or with work that was never merged, stays on disk with its branch, the task says where, and a
reply continues there; a space you are using again (a turn in the agent's own terminal, a command running in any of
its panes) is not closed (that includes a command a finished agent left running in the background), and neither is one herdr could not answer for or whose herdr session is not running (then nothing of
the task is touched): the clean-up is tried again by itself (about
every half minute, board open or closed) and happens once the space is free, after a turn of the agent only when
that has been quiet for ten minutes. Work that appeared meanwhile is kept. An agent herdr cannot place (status
"unknown") counts as at work until its screen has stood still for two minutes and its saved conversation ends in a
finished turn and nothing runs under the agent program (an agent of unknown status that keeps helper programs
running is therefore never closed by itself: archive or clear its task). A reply to work that was cleaned up starts a new round in a fresh worktree. herdr also opens
the repo itself as a space when it makes a repo's first worktree; that one is closed with the repo's last task
space, unless it was open before or you use it (a second pane or tab, an agent, a running command, or you are
looking at it). `cleanup` off keeps everything.

**Agents run with full access by default**, as pi-work's did: `claude --dangerously-skip-permissions`,
`codex --dangerously-bypass-approvals-and-sandbox --no-daemon`. They can run anything as you without asking; the
rules and the review brief are guidance, not a sandbox. Change it per agent kind with `agentArgs`. So that a new
task does not wait behind a "trust this folder?" dialog, the plugin marks the task's repo as trusted in the agent's
own settings (`~/.claude.json`, `~/.codex/config.toml`) before starting it; `config trust off` stops that.

## Settings: two places

Facts about a repo live in `.herdr-superwork.json`, committed in that repo and read from the commit a worktree
started from, so an agent's branch cannot change the rules it is checked by:

```json
{ "setup": "npm ci", "check": "npm test", "land": "ask", "teardown": "docker compose down", "include": [".env"] }
```

Your own preferences live in `~/.config/herdr-superwork/config.json`; change them with
`herdr-superwork config <key> <value>` or by saying so in the text box.

| Setting | Default | Means |
|---|---|---|
| `agent`, `model`, `effort` | `claude` | the working agent: any `herdr agent start --kind` value |
| `reviewer`, `reviewerModel`, `reviewerEffort` | `codex` | the reviewer; `off` for none. Not installed here: the agent's own kind reviews, on its default model, and the task says so |
| `coordinator`, `coordinatorModel`, `coordinatorEffort` | `claude`, its defaults | the Coordinator, the agent you talk to in the chat; `off` for none. For one use: `coordinator new --agent … --model … --effort …` |
| `watcherAgent`, `watcherModel` | `claude`, `claude-haiku-5-5` | the Watcher's small model (`helper`, `helperModel` are still read as these) |
| `watcher` | `on` | the "doing now" line, the progress guess and the minutes left worked out from it, a look about every 15 seconds per working agent, board open or closed |
| `skill` | `true` | keep the how-to in each agent program's skills folder |
| `ownTerminal` | `true` | the board always has the size of the herdr pane it runs in: another viewer attached straight to its terminal (`herdr terminal attach`, herdr's remote web UI) holds the terminal at its own size, so the board disconnects it. `false`: it stays, the board draws inside what both can see, says so, and alt+w disconnects it |
| `theme` | `auto` | the board and the review page use herdr's own colours and status marks. herdr's sidebar is drawn by the client with the config of the device it runs on, and herdr does not pass that on to the board. `auto`: when herdr's `config.toml` on this machine sets a theme (`[theme]`, with its custom colours), the board follows it as herdr resolves it; when it sets none, the board paints with the terminal's own colours, as herdr's `terminal` theme does, which fits whatever device you look from. `herdr` follows this machine's config exactly, Catppuccin by default: choose it if you run an unconfigured herdr on this very machine and want the board to match it; `terminal` always uses the terminal's colours; `dark` or `light` picks herdr's dark or light theme by hand. `ui.status_indicators` is always followed. A task under review takes the theme's mauve; where that looks like another state's colour (the terminal's colours, Vesper), it is the terminal's magenta, so review never shares a colour with to do, working or any other state |
| `review` | `repos` | what gets reviewed: `repos`, `all` or `none` |
| `artifacts`, `serve` | `true`, `tailscale` | evidence pages, linked privately on your tailnet (`local` for 127.0.0.1; also used, and said on the task, when Tailscale is not installed) |
| `gate`, `rounds` | `major`, `3` | what a review must clear: `critical`, `major`, `minor`, `trivial` or `off`. A finding that bad or worse sends the work back by itself, at most `rounds` times, and holds a merge; `off` sends nothing back by itself. `rounds` also caps conflict repairs. (`gate` replaces `reviewAuto`: a config that still has `reviewAuto: true` behaves as `gate: major`, `false` as `gate: off`) |
| `worktree`, `base` | `auto`, `fresh` | `none`: work in your checkout; `head`: start from your commit |
| `pr`, `merge`, `cleanup` | `true`, `squash`, `true` | pull requests, how work lands, remove a done task's space, worktree and branch |
| `max` | `4` | agents working at once |
| `trust` | `true` | pre-trust a task's repo in the agent's own settings |
| `agentArgs` | full access | per agent kind: arguments after `--` for `herdr agent start` |
| `machines`, `remoteUser` | `auto` | other machines: herdr's saved machines, names, or `off` |

Per task (`--id <id>`, or options to `delegate`): `agent`, `model`, `effort`, `reviewer`, `reviewerModel`,
`reviewerEffort`, `watcher`, `review`, `gate`, `rounds`, `artifacts`, `serve`, `conflictAuto` (on by default).

Data lives in `~/.local/state/herdr-superwork` (`HERDR_SUPERWORK_DATA_DIR` overrides it): one folder per task with
`task.json`, `inbox.jsonl` and `artifacts/`.

## Other machines

Every machine keeps its own tasks. `Ctrl+O` goes round: this machine, every machine, then each one by itself.
Machines are found through herdr only: the ones you added with `herdr machine add` (or name them in `machines`);
with none, `Ctrl+O` says so. There is no Tailscale discovery. The plugin's own commands on another machine still
travel over the plugin's own SSH connection, because herdr has no command that runs a plugin's commands there.
Each one needs, once:

```sh
# Node 22.19+, git, gh, flock, the agent programs it will run, then:
git clone <this repository> && cd herdr-superwork && npm install
npm link
herdr plugin link "$PWD"
```

Actions on another machine's task run on that machine, over SSH. Going into one of its agents attaches your
terminal to that one agent there (`herdr agent attach`), after that machine has reopened the task's space and
restarted an exited agent in the same conversation; `ctrl+b q` returns to the board. A machine on an older plugin is
told apart by its missing version: its new fields stay blank and the board says "update herdr-superwork on <machine>". Work never moves between
machines.

## What was checked on herdr 0.9.3

| Fact | Result |
|---|---|
| Plugin event hooks fire on `pane.agent_status_changed` | yes; the event carries pane id, workspace id, status, agent |
| Popup panes; `HERDR_PLUGIN_CONTEXT_JSON` in a popup | yes; no pane id, but workspace, focused pane and its folder, worktree's repo root |
| `agent focus` from inside a popup holds after it closes | yes |
| A second viewer on a pane's terminal (`herdr terminal attach`) | it sets the terminal's size; herdr then shows a cut-out of it from the top left. `pane layout` still gives the size herdr shows, so the board draws inside that and says what holds it; `terminal session control --takeover`, left at once, disconnects the other viewer and herdr sizes the terminal to the pane again: the board does it by itself (setting `ownTerminal`), or on alt+w. Nothing else gives the size back while the viewer is attached (a client resize, zoom, `control` without `--takeover`). Not in the popup: it has no pane id |
| `agent start`; `state_change_seq`, `completion_seq` in `agent get` | yes; `completion_seq` appears after the first finished turn |
| `agent_session` in `agent get` | only with herdr's own integration for that agent installed; without it a restarted agent starts fresh |
| Workspace and pane ids across a server restart | survive; `terminal_id` does not; agents are gone without an integration |
| Which event fires when an agent exits to its shell | `pane.agent_detected` (released) and a status change to `unknown` |
| A process spawned detached from a hook | survives the hook's exit; a 150-second hook was not cut off |
| `PATH` in hook-spawned processes | herdr's server environment, which can lack `~/.local/bin`: the plugin asks a login shell |
| `worktree create --cwd <repo>` with no workspace open for it | works; herdr also opens the repo itself as a workspace, which stays when the worktree is removed (so the plugin closes it) |
| Claude and Codex in a brand-new worktree with full access | both show a trust dialog, once per repository; pre-trusting removes it |
| Codex after a reply | reported `done` here; the closing note also covers `unknown` |
| `herdr machine list --json` exposing SSH targets | not verifiable here (no saved machines; it prints `[]`): name machines in the `machines` setting if `auto` finds none |

Checked on 2026-10-09 for the turn-end hook and the keeper (herdr 0.9.3, Claude Code 2.1.296, Codex 0.160.0, pi 1.1.0),
in a separate scratch herdr:

| Fact | Result |
|---|---|
| Claude `--settings <file with Stop and StopFailure hooks> --session-id <uuid>` through `herdr agent start` | fires at every turn end; the input names the session, the transcript file and the last message |
| `claude --settings` adds to the user's own hooks | yes: a project-level Stop hook and the flag's both ran (the user's own settings hold no hooks to lose) |
| A failing, noisy or slow hook | does not change the reply; a slow one delays the end of the turn unless marked `"async": true`, which the plugin does |
| Claude resumes a known session id (`--resume <id>`) | yes, same id and same file |
| Claude's conversation file | `~/.claude/projects/<folder>/<id>.jsonl`; a finished message has `stop_reason` `end_turn`, a pending one `tool_use`; an API or login error is an entry with `isApiErrorMessage` and `error` (`authentication_failed`, `model_not_found`); an interrupt (Esc) is a user entry "[Request interrupted by user]" and fires no hook; token use and model are on each message. Usage limit: not reproduced |
| Codex honours `-c notify=[…]` at launch | yes, headless and interactive; the JSON argument carries the thread id and last message. It also reports side conversations (its chat-naming one), which are told apart by their prompt. An interrupt fires nothing and is `turn_aborted` in the file. It would replace a `notify` of the user's, so a user who has one gets no hook |
| Codex's conversation file | `~/.codex/sessions/<date>/rollout-…-<id>.jsonl`: `task_complete` with the last message, `token_count` with the context window, `turn_context` with the model; `codex resume <id>` continues the same file |
| pi `-e <file>` | the extension receives `agent_settled`; the session file is `~/.pi/agent/sessions/<folder>/<time>_<id>.jsonl` with `stopReason` and `errorMessage` per message; `--session-id` creates or reopens an exact id |
| A launch flag for standing rules | Claude `--append-system-prompt-file`, pi `--append-system-prompt <file>`, Codex `-c developer_instructions=…`: all three kept a rule over the session. herdr refuses a launch argument that holds a line break, hence the files |
| User-level skills folders | `~/.claude/skills`, `~/.codex/skills`, `~/.pi/agent/skills` exist; Claude Code listed the plugin's how-to as a skill right after it was written |
| herdr's sidebar shows the plugin's pane and workspace metadata | **not by default.** State labels and `$summary` / `$progress` / `$eta` tokens show only when `[ui.sidebar.*] rows` in `config.toml` list them; only `--display-agent` shows with no setup. Hence the name fallback and the first-run offer |
| A new `[[keys.command]]` after `herdr server reload-config` | works without a restart. A broken file is reported as `failed` and herdr keeps the old config; a key bound twice is `partial`; `herdr config check` validates a candidate given by `HERDR_CONFIG_PATH` |
| herdr's config path and default keys | `~/.config/herdr/config.toml`; `herdr --default-config` lists the built-in keys (`prefix+w` is herdr's workspace picker; `prefix+a` is free) |
| What the terminal shows, inside herdr | the board asks the terminal for its background (OSC 11) and its 16 colours (OSC 4) when herdr's `theme.auto_switch` is on or the theme paints with the terminal's own colours; herdr answers for its panes with the colours of the terminal the client runs in. No answer (the scratch session has no real terminal behind it): dark, and xterm's colours. `theme light` chooses by hand |
| herdr's theme, for a plugin | not handed to plugins. The board reads the `[theme]` and `[ui]` tables herdr reads (with its own full TOML reader, `src/toml.js`) and resolves them as herdr 0.9.3 does (`src/app/state.rs` palettes, `src/client/shell.rs` marks: `●` working, blocked and done, `○` idle; `◐ × ✓ ○` with `status_indicators = "symbols"`). Text is herdr's `text` colour and the side panel sits on `sidebar_bg` when the theme sets one. The review page takes the theme in force when it is written; where herdr follows the terminal (`auto_switch`, the `terminal` theme) the page follows the browser's light or dark setting. A theme changed in herdr shows the next time the board opens. Marks, group headings, the bar and the percent take herdr's colour for the task's state (working `yellow`, blocked `red`, done `teal`, idle `green`); a task's title is always herdr's text colour, whatever its state; what its row says after the title, and every label in the task panel, is greyed out (`overlay0`, and faint as well in the `terminal` theme, whose grey is most terminals' text colour); the panel's headlines are bold text, its rules and review boxes are `surface1`, and a setting that is only your default is `subtext0`; text, secondary text, rules and the selected row are herdr's sidebar colours (`text`, `subtext0`, `overlay0`, `surface_dim`, `selection_bg`/`active_row_bg`). A review's score is `green` when the reviewer says merge and `red` when it says don't: the colour is the advice, there are no words for it |
| Who sets a pane's terminal size | herdr's own window, until a `herdr terminal attach` is on that terminal: the terminal then has the attach's size (93×33 became 200×50) and keeps it when herdr's window is resized; it is the window's again the moment the attach ends. herdr names no attached viewers anywhere. `pane layout --pane <id>` gives the pane's place in herdr's window: its terminal is that place less up to 3 columns and 2 rows (frame, scrollbar), or, for the zoomed pane (the layout's `focused_pane_id` when `zoomed`), the tab's whole `area` less the same. A second full herdr client changes the layout and the terminal together, so it is not mistaken for this |
| A long launch command through `herdr agent start` | herdr types it into the pane's shell, and a terminal takes at most 4096 bytes on one line: the Coordinator's rules inside Codex's `-c developer_instructions=…` arrived cut off, at a shell continuation prompt, and the start timed out. The flag now only points at a rules file (at first the rules also went in with the first message; since the box became a word-for-word passthrough they no longer do, and that has not been run against a real Codex yet): three new starts and two restarts of Codex in a row came up in about four seconds each, the restarts in the same conversation |
| The agent's own new-chat command (Claude Code `/clear`, Codex `/new`, pi `/new`) | each starts another conversation file for the same folder and leaves the first one as it was (pi: `<time>_<id>.jsonl`, whose first line names the working folder and the id; `--session-id` reopens it). The Coordinator has a folder nothing else chats in, so the newest conversation saved there since it began is the one it is in. Live, all three programs: "pineapple", new chat, "watermelon"; the board showed watermelon, and after a restart the agent still answered watermelon |
| Other conversations saved for the Coordinator's folder | a helper agent Codex spawns saves one of its own there, newer than the main one: its first line has `"source": {"subagent": …}` and `parent_thread_id` (seen in real files of 0.160.0); a headless `codex exec` has `"source": "exec"`. Claude Code keeps helpers' side conversations in a `subagents` subfolder, and each entry names its `entrypoint` (`cli` for the interactive program). Only a chat of the interactive program itself is taken for the Coordinator's |
| `herdr workspace create --env KEY=VALUE` | the agent started in that space has the variable: the Coordinator's commands reach a board kept in another data folder |
| The Coordinator on Claude Code and on Codex, live | Claude Code: started by the first message, more messages into the same conversation from the text box and from its own pane, a task filed in the named repo, and after a restart it still knew an earlier answer (`--resume`). Codex, as a one-off: one message, the task filed, its own conversation found from its folder and start time and its last message read. pi: started as the Coordinator, three messages, its own /new and a restart (above) |
| herdr's own remote commands for a saved machine | not testable (no saved machine): the plugin's SSH door keeps doing all of it |
| A keeper started from the startup hook | survives the hook and replaces itself on an update; "for hours" was not waited for, so hook events and the board also start it |

## Compared with pi-work

Back, in herdr's terms: the board is fresh while closed (the keeper); the board knows when and why an
agent or reviewer stopped without a note file (the turn-end hook); the task panel shows what the agent said; tokens and
context fullness (for a model whose window is known: Codex states it, Claude Code and pi do not, so those show
tokens only); the Coordinator; every chat knows the board; archive closes the space and a reply after restore resumes
the same conversation; a progress bar on your own tasks; a reply to a task with no agent starts one; a light palette.

Different by choice, or because herdr or an agent program cannot do it:

- No "2 blocked · 1 working" counter: herdr's sidebar is the closed-board view. It shows the plugin's labels only
  with the sidebar rows in herdr's config (offered at first run); otherwise a short status in the agent's name.
- No notifications: nothing pops up or sounds when a task needs you, with the board open or closed, and
  there is no bell. The board does not emit terminal status reports (OSC 7501) while closed.
- The sidebar shows only tasks with a live agent pane.
- The task panel shows the raw screen while an agent sits at a dialog that is not in its messages.
- A question does not pop open by itself: the row says so and the task panel reads it. Agents report only `blocked`, never their own progress.
- Agents the board starts may only file tasks and report themselves blocked.
- One Watcher model for everything; per task it is on or off.
- Hooks were verified on Claude Code 2.1.296, Codex 0.160.0 and pi 1.1.0, and those are the adapters' minimum
  versions: older programs run without the hook. Codex and pi were verified piece by piece (hook, file, resume), not
  through a whole delegated task.
- Other machines come from herdr only; no sub-tasks; nothing is migrated from pi-work; no chat takeover (you are in
  the agent's own terminal).
- If the keeper dies while nothing at all happens, pull-request polling waits for the next herdr event or board open.

## Tests

`npm test`. A fake herdr binary and scripted fake agents: no model calls, no real board, no real herdr.
