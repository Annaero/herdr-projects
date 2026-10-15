# One task after another: `--after`

A task can wait for other tasks to be **done**, and then start by itself. This is what a chain of work across repos
needs: change `gtm-skills` first, then take that into `gtm-agent`, then into the copies downstream, each its own task
with its own review and its own merge.

```sh
herdr-superwork add "Take the new skill in" --repo gtm-agent --after gtm-skills/12 --delegate
herdr-superwork delegate gtm-agent/4 --after gtm-skills/12,gtm-skills/13
```

**Done** is what the board calls done, however the task got there: its work merged, a research task finished with
its report, or a task marked done (`report <id> --state done`, with nothing merged). A task that was archived after
it was done still counts as done.

## While it waits

- Its row is under **to do** and says so: `starts after AGT-2`, or `starts after SKL-4, SKL-5` for several, naming
  the ones that are not done yet (by their key where the repo has one). The task panel has a `Starts after` line with
  each task (`(done)` beside those that are), `details` has an `after` part, and `list` says it beside the title. The
  web Board, another machine's board and the herdr sidebar show the same.
- It holds no agent slot (`board.agents`) and nothing runs for it: no worktree, no space, no agent.
- The ids may be tasks of **other repos**, any repo on this machine, and tasks of **other machines** the board knows
  (below).
- An id that does not exist is refused, and so is a wait in a circle (`a` waits for `b`, which waits for `a`): the
  answer shows the circle, `proj/1 → proj/3 → proj/2 → proj/1`, and nothing is changed. An `--after` that is refused
  on `add` adds no task.

## A task of another machine

A task can wait for tasks on any other machine the board knows (`board.machines`, or herdr's own list of machines:
[other-machines.md](other-machines.md)). Keys alone may clash across machines, so such a task is named by its machine
first: `vm-str:ELA-3`, `vm-str:ela/3` or `vm-str#3`. It is kept as `vm-str:ela/3`, and said as `vm-str:ELA-3` wherever
the board says what a task waits for (its row, its panel, `details`, `list`, another machine's board).

```sh
herdr-superwork delegate notably/3 --after vm-str:ELA-3
herdr-superwork add "Use the new API" --after vm-str:ELA-3,HSW-12 --delegate
```

- When the wait is set, the board asks that machine over the machine link whether the task is there: an unknown
  machine, a task that machine does not have, and a machine that does not answer right then are refused, and nothing is
  changed. A wait in a circle across machines is refused too: the board follows what the task there waits for in turn,
  on that machine and on any other one it names, back to this one. When that cannot be followed to its end (a machine
  on the way does not answer, or names a machine this board does not know), the wait is refused as well: a circle
  nobody saw would wait forever.
- While it waits, the waiting machine asks the other one about it by itself, every 15 seconds, in a job of its own (so
  a slow machine holds nothing else up). The other machine needs nothing but this version of herdr-superwork (an older
  one cannot answer, and is said so, with "update it there"): its own board does not need to be open.
- A machine that does not answer does not end the wait: the task goes on waiting and says so on its row,
  `starts after vm-str:ELA-3 · waiting for vm-str: not reachable since 10:42` (`details`: `after.notReachable`). Once it
  answers again, the line is the usual one.
- Done, failed, stopped, removed or archived without being done are what that machine says of its task, and do here
  what they do for a task of this machine: done counts, the others make the task wait for you with the reason
  (`vm-str:ELA-3 was stopped`).
- When the wait is over, its agent is told what that task did as for one of this machine (its closing note, pull
  request, merge commit or report, and which machine it was on), from what the other machine said last.

## When the wait is over

Once every task it waits for is done, the task goes on to a free slot by itself, like any delegated task. Its agent's
first prompt says what came before it, for each task it waited for: its id, title and repo, its closing note, and the
pull request and merge commit where its work merged, or the report's link where it was research. That is taken when the
wait ends and kept on the task (`details`: `after.handedOver`), so the other task's clean-up loses none of it.
A task done several times at once (`attempts.by`) hands the same to each attempt's agent.

## When it cannot go on by itself

If a task it waits for fails, is stopped, is removed, or is archived without being done, the waiting task does not
start: it waits for you under **needs you**, with the reason on its row (`gtm-skills/12 was archived without being
done`), and you are told as for any task that needs you (`board.notify`). Nothing of that is final: set the other task
going again, and once it is done the wait goes on by itself.

## Changing it, and starting early

- `herdr-superwork after <id> <id>[,<id>…]` sets what a task waits for: on one that waits, the new list counts from
  now (all done already: it starts); on one not delegated yet, it is kept for when it is. `after <id>` says what it
  waits for; `after <id> --clear` drops the wait, and a task that waited starts at once. `delegate <id> --after none`
  is the same as `--clear` while delegating.
- `delegate` on a task that waits says it still does, and how to go on: `delegate <id> --now` starts it without
  waiting (its agent is told the tasks were not all done, and what there is of them). On the board (and the web Board),
  the key that puts an agent on a task asks first: `Start HSW-4 "…" now?`.
- `stop <id>` on a task that waits stops the waiting: it is back to to do, and what it waits for is kept for its next
  delegation. A task that waits for that one is told it was stopped, as for any stopped task, until it is delegated
  again.
- A task an agent is on cannot be made to wait: the wait is before the start.

The Coordinator knows all of this: "then", "once that is merged", "after HSW-12", "after ELA-3 on vm-str" in what you
type to it becomes an `--after` on the task it adds or delegates.
