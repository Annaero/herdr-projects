# Handing text to an agent

Everything the board gives an agent is typed into its box: the task at the start, your replies, review findings,
conflict and pull-request notices, "carry on" after a cut-off turn, the reviewer's brief, what you say to the
Coordinator. Typed is not sent. This page says how the board makes sure it was sent, and what you see when it was not.

## What went wrong

On a busy machine a task's text sat in its agent's box for twenty minutes while the board said "working". herdr
calls a program ready as soon as it is the pane's foreground process, which can be seconds before it has drawn
anything. The board typed the task at that moment. A program that is still starting keeps typed text for its box but
drops the enter that follows (herdr presses it 0.3 seconds after the text). Nothing was submitted, and nothing
noticed.

## What the board does now

1. **It waits until the program is up.** After starting an agent, the board looks at its pane until something has
   been drawn after the command that started it and the screen stands still for a moment, a minute at most. Then it
   types. A normal start costs about half a second more. This is the same for every kind of agent: it reads the
   pane, not anything of the program's own.
2. **It looks again after typing.** herdr's reading of the agent from just before the text went in is kept. An agent
   that works, has finished a turn, or has written to its saved conversation since has taken the text. One that sits
   at its prompt exactly as before has not: the board presses enter again, after 5 seconds, then 10, then 20. It
   never types the text a second time.
   A message typed while the agent is in the middle of a turn proves nothing by the agent working: it works either
   way. The board waits until the agent is at rest, and looks from there: an agent that took the message goes straight
   on with it, one that lost the enter sits at its prompt and gets it again. Until that is settled the turn that
   just ended is not sent to the finish line: it is not the answer to the message. From there the surest proof is
   the words standing in the agent's saved conversation. An agent that never takes the message is shown as not
   started like any other, and stays so until you retry or press enter. The Coordinator's messages are looked at
   the same way, on the board's tick.

   **A message the agent takes while it still works is delivered then.** A program that reads what was typed
   between two steps of its turn (Claude Code does) writes the words into its saved conversation at that moment, as
   a note of its own kind (`queued_command`), not as a prompt. The board looks for them there every few seconds
   while the agent works, and from then on the message is delivered: the turn's end, however much later, is the
   answer to it and goes to the finish line. The board reads back as far as the moment the text was typed, however
   long the conversation has grown since. It used to read only the last 768 KB: a message taken early in a long
   turn (3.5 MB before its end on one real task) was not found, enter was pressed three times into an empty box,
   and the task stood as "not started" with its work done and saved. A program's note that the words only wait in
   its queue is not counted: it has not read them yet.

   An agent herdr cannot classify (status `unknown`) is checked too: its counters and its saved conversation still
   say whether it moved.
3. **It says so.** While it waits, the task's row reads `Starting` (or `About to continue`), then `Has not started yet:
   pressing enter again`, never `working` or `finishing`. If the agent still sits there 40 seconds after the last
   enter, the task is shown as an error: **Not started: its instructions sit unsent in its box**.

## A task shown as not started

- **Retry** (the "yes" key on the board, or `herdr-superwork retry <id>`) ends the agent's program, starts it again
  in the same pane and hands it the same text, word for word. The program is ended first because its box may still
  hold the old text, and typing on top of it would send it twice.
- An agent whose program ends with typed text it never took is shown the same way, at once: the text went with the
  program. A late report of the turn it finished before that changes nothing; retry starts it again with the text.
- **Retry never ends a program that is alive and has the text.** When the words stand in the agent's saved
  conversation after all, retry only takes the error away: the same program, the same conversation, and a turn that
  ended meanwhile goes to the finish line. That holds for a task an older
  version of the board marked too: it wrote down when the agent came to rest, not when the text was typed, so for
  such a task the whole conversation of the running program is read.
- **Or go into the agent and press enter yourself.** The board sees it start and the error goes away.
- A reply from the board is typed into the same box and goes out together with what sat there. The board keeps both: if
  that does not start either, retry hands over all of it, in order.

The reviewer and the Coordinator are held to the same. A reviewer that never starts on its brief fails that review
("the reviewer did not start"), which retry runs again. Words the Coordinator did not take are named in its chat
("your message sits unsent in its box"); they are not typed again.

## The waits

| Variable | Default | What |
|---|---|---|
| `HERDR_SUPERWORK_READY_MS` | 60000 | the longest the board waits for a started program to draw its screen; 0 types at once |
| `HERDR_SUPERWORK_SUBMIT_MS` | 5000 | the wait before the first extra enter; each later wait is twice the one before |

The code is `src/submit.rs`; what was measured on real programs is in [what was checked](checked-on-herdr.md).
