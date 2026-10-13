# An agent that waits for you is not finished

An agent that stops because it needs you (a question, a permission, a sign-in) is **waiting, not finished**. Nothing
that follows a finish happens then: no check, no review, no push, no pull request, no merge, no "done". The task's
row says what it needs, with its mark (`?`, `!` or the sign-in mark), and stays there until you answer.

This holds for an ordinary task and for a [research-only](research.md) one, however many times in a row the agent
asks (an interview of fifteen questions is fifteen waits and no review), and whether or not a report or a closing
note is there already.

## How an agent says it

There are two ways for an agent to stop, and the board tells them apart by one thing only:

| It means | What it does | What follows |
|---|---|---|
| **I am waiting for you** | runs `herdr-superwork report <id> --state blocked --kind <question\|permission\|auth> --msg "<why>"`, then stops | nothing: the task waits for your answer |
| **I am finished** | stops, with a short summary | the finish line: check, review, your approval ([how work gets done](how-work-gets-done.md)) |

The board cannot read a question out of a last message, a report or a closing note. An agent that asks in plain
words and stops is taken as finished, and its work is checked and reviewed as it stands. So the rules every agent
gets say so in as many words:

- that command is the only way to say "I am waiting";
- it holds for **one stop**: your answer arrives as the agent's next message and ends the wait, so an agent that asks
  again runs the command again, every time, also for each question of an interview;
- a stop without it means finished, whatever the last message, the report or the closing note says;
- it is never run to put off the review of finished work.

The command answers the agent with the same: `Reported: you are waiting, not finished, so no check and no review
follow this stop.`

## A report saved early

A research-only task's result is a report, and saving it finishes nothing. An agent may save an interim report,
add to it, and go on asking. While the task waits the report already has its link (the task panel's **Report**),
so you can read what it has so far. The task is finished when its agent stops without saying that it waits.

## What the board holds on to

The agent says that it waits in the turn it then ends. The end of that turn reaches the board twice, in no fixed
order: herdr sees the agent's pane at rest, and the agent's own turn-end report starts the finish line. So the
board does not go by who saw the end first. It goes by the turn itself, read from the agent's saved conversation:

- a turn that **began before** the agent said it waits, and ended after, is the turn it waits in. Its end is not a
  finish, also when herdr had taken a flicker of the agent's status for a new turn meanwhile; the task is put back
  to waiting, with the kind and the words the agent gave;
- a turn that **began after** it (you replied from the board, or typed in the agent's own terminal) is your answer
  being worked on. Its end is a finish like any other, unless the agent says again that it waits.

That is also why asking cannot be used to dodge a review: a task that waits is never done, pushed or merged, and
the first turn that ends without the command is checked and reviewed as ever.

Only the end of a saved conversation is read as a rule. A very long turn (a large tool result, hours of work) has
its prompt further back: then the whole file is read for it, that once.

Where the saved conversation cannot be read at all, a task that still says it waits goes on waiting: the board does
not guess a finish. Reply from the board and the next turn is judged as ever.

## A review that is already running

When a task turns out to be waiting while its review runs (its agent said so in a turn that began after the
review did), the review is **stopped**: the reviewer's tab is closed, no verdict is kept, nothing goes back to the
agent as a failed round, and no round is counted. A review of work whose agent still waits for an answer says
nothing you could use. The work is reviewed when it is finished.

A review that ran because an agent asked in plain words, without the command, is a real review of what was there:
it is kept and shown. Reply to the agent and the round counter starts again.
