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
- The ids may be tasks of **other repos**, any repo on this machine. A task of another machine cannot be waited for:
  `--after otherbox#4` is refused with that reason.
- An id that does not exist is refused, and so is a wait in a circle (`a` waits for `b`, which waits for `a`): the
  answer shows the circle, `proj/1 → proj/3 → proj/2 → proj/1`, and nothing is changed. An `--after` that is refused
  on `add` adds no task.

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
  the key that puts an agent on a task asks first: `Start #4 "…" now?`.
- `stop <id>` on a task that waits stops the waiting: it is back to to do, and what it waits for is kept for its next
  delegation. A task that waits for that one is told it was stopped, as for any stopped task, until it is delegated
  again.
- A task an agent is on cannot be made to wait: the wait is before the start.

The Coordinator knows all of this: "then", "once that is merged", "after #12" in what you type to it becomes an
`--after` on the task it adds or delegates.
