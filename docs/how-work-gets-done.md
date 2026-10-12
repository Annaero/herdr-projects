# How work gets done

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
   and brings evidence; whatever it changed is put back. A reviewer that finishes its turn with no verdict fails the
   review at once, with its last message; one whose turn was ended by its provider is tried again by the board
   (see [A turn cut off by the provider](provider-errors.md)). The board decides from the findings (see [The gate](gate.md)): a
   review that fails goes straight back to the agent. The row says the result and a tally (`Pass · 2 minor`), and
   its `R#2 ✓` tag which review it was and, by its mark, how it went; the task panel has its summary, and every earlier
   review of the task;
4. waits for your approval (`Ctrl+L`).

**Without a hook** (a crash, a program older than the adapter's minimum version, another agent kind, Codex when you
have your own `notify` configured, or a hook that failed three turns in a row) herdr's
status is only a guess from the screen, so "idle" alone never finishes a task. The turn counts as ended when the
saved conversation ends in a finished message or an error, or a closing note was written to
`.herdr-superwork/closing-<n>.md` (the rules still ask for one as the fallback). Otherwise the task is held as
"stopped without a summary": `Ctrl+R` tells the agent to continue, `Ctrl+L` takes the work as it is. Typing in the agent's own
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

A clean update is silent. If it changed the commit, the check runs again on the result. The review is not repeated
when taking main in is all that happened to work that already passed (below), or when the update touched none of
the files the task itself changed: the verdict you already have stands and the task does not ask for your eyes
again. A real conflict is rolled back at once (your branch and the task's are as they
were) and goes straight to the task's agent as a plain message: the conflicting files, the target commit, and that
it should resolve them in its own worktree and finish again. Until it has, the task is not waiting for approval: its
row says "resolving a conflict with main". After `rounds` repairs in a row that
still conflict, you are asked, with the details kept. `conflictAuto false` on a task keeps its conflicts for you to
send with `Ctrl+R`. Only a task at rest is ever updated: its worktree clean, on exactly the commit that was reviewed.
A fetch that fails is never taken for a sync: a finished turn is saved as "Could not synchronize main" instead of
going on to review (and as "Task is on the wrong branch" when its worktree has left the task's own branch). A waiting task whose main cannot be fetched, or that was not at rest when main moved, is held
as "behind main": its row says so, `Ctrl+L` is refused with the reason, and the board tries again
every minute until the branch really is up to date.
"Main" is where the task will land: the remote's main when it lands through a pull request; otherwise (no remote,
or `pr` off) the branch your checkout was on when the task first finished. For those, checking out another one
merges nothing into waiting tasks, and they are held as "behind main" until your checkout is back on it.

**A review that passed is not repeated for a merge of main.** When the last review of the work passed and the only
thing that changed since the commit it looked at is main being merged in, the board runs the repo's `check` on the
result instead of a full new review. Tests pass: the task goes on to approval or the merge, as a pass. Tests fail:
the failure goes back to the agent, as a failed check always does, and its fix is reviewed. The rule for "only the
merge of main" is fixed and checked in git, from the commit the reviewer looked at to the branch as it stands:

1. every commit since is a merge commit with two parents, the branch as it was and a commit of main. An ordinary
   commit on top, a rebase or another branch merged in is new work;
2. each of those merges is exactly what git makes of its two parents by itself. Only the files git could not merge
   (the conflicts) may differ, because resolving them is what the merge needed. One other file touched in the merge
   commit is new work.

So a conflict the agent resolved in its merge commit, touching only the conflicting files, keeps the review; the
agent is told this with the conflict. Anything else is reviewed as before, and so is everything the board cannot
read for sure: a last review that failed or gave no verdict, work outside a worktree. A repo with no `check` has
no tests to prove a merge into the task's own files, so there this rule does not apply: a review stands only when
a clean update touched none of the files the task changed (the narrower rule above), and the task then says `no
check is set` instead of `tests pass`. The task says plainly what happened: its message reads `Re-merged with main,
tests pass, review 2 still stands`, the box of that review carries the same line (with when, and how often), the
row keeps showing the review that passed (`Pass · 2nd review`), and `details` lists each time under that review as
`kept`. `herdr-superwork config remerge review` turns this off: every update from main that changed the commit is
then reviewed again, also one that touched other files only.

**Approving** makes that last sync, re-checks (and re-reviews, by the same rules) if it changed anything, then merges
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
