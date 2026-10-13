# The board's size: what changes it, and how the board stands still

The board is drawn for the size of the terminal it runs in. This page says what changes that size, what does not, and
what the board does so that a change that lasts a moment is not seen.

Two things made the board's screen change for a moment and change back, and both were found by recording a real
board:

1. **The board loading its new version**, which happens when an agent finishes: see the next section. This is the
   one that is tied to agents.
2. **A second herdr window on the same session** taking the size and giving it back: see "What does change it".
   Nothing ties this one to agents starting or ending.

## The board loading its new version

An open board loads its new version by itself when the plugin's code changes under it. Where the plugin runs from
the checkout that tasks are merged into (`npm link` in the repo you work on with the board), that is every time a
task's work lands: when an agent finishes and its work is merged. The reload stopped the screen the usual way, which
leaves the full-screen view and prints the board once more on the plain screen under it; the new board then cleared
the view and drew. Recorded on a real terminal, a frame every 20 ms: the whole board one line off for 0.36 seconds,
then an empty screen for 0.09 seconds, then the board again.

**On the real board, as it happened** (2026-10-12, read from the board's own processes, the checkout's history and a
trace of the board's terminal size taken every 50 ms while it ran):

- Work landed in the plugin's checkout at 21:37:34, 21:40:44, 21:48:55, 22:07:47 and 22:10:46, and the board started
  itself again at 21:37:43, 21:40:59, 21:49:00, 22:07:56 and 22:11:07, nine to twenty-one seconds after each (it
  waits until the files have stopped changing). Every restart followed a merge. (After five restarts in a row a
  board stops restarting, so the merges after 22:11 restarted nothing.)
- The size trace was running over the third of these. The board's terminal, 141×46 before and after, was 140×46 from
  21:49:00.853 to 21:49:01.073: at the second the board restarted, five seconds after the merge. A herdr pane is one
  column narrower on the plain screen than in the full-screen view (the scrollbar), so that column is the board
  leaving the full-screen view. Nothing else changed the terminal's size in that trace while agents, reviewers and
  spaces came and went (ten of them).
- The same in a scratch herdr pane of the same size, 141×46, with the board as it was: its code changed, the board
  restarted, the terminal was 140×46 for 0.78 seconds with the board's first line blank, then 141×46 again. With
  this change: 141×46 throughout, and the board's lines never blank or moved.

Now the old board gives back the modes it took (keyboard, paste) but stays in the full-screen view with its last
frame up, and the new board, which is in that view already, neither enters it again nor clears it (herdr clears
the view on entering it a second time) and draws its first frame over the old one.
Recorded the same way: no frame between the two boards but the board itself. If the new board cannot start, the
terminal gets its plain screen back. (`src/board/reload-screen.js`.)

## What does not change it: agents starting and ending

Nothing the board starts opens on the board's own screen, takes its focus or takes room from its pane:

| Helper | Where it runs |
|---|---|
| A task's agent | a herdr space of its own (`herdr worktree create`, or `workspace create` outside git), opened with `--no-focus` |
| Its reviewer | a tab of its own in the task's space (`tab create --no-focus`, see [a task's tabs](tabs.md)); closed when the review ends |
| The Coordinator | a space of its own (`workspace create --no-focus`), closed when it is stopped |
| The Watcher | a hidden model call: no pane at all |

Measured on herdr 0.9.3 with a real board, a real agent, reviewer, Watcher and Coordinator:
through a task's whole life (start, review, approval, merge, its space closed) and a Coordinator started
and stopped, the board's terminal kept its size, herdr's layout for its pane did not change, and no row of the board
moved. (The reviewer was then still a pane split off the agent's pane; it has since moved to a tab of its own, which the same test covers.) On herdr a space opened without focus, a pane split off a pane in another space, an agent starting there and a
space closing do nothing to a pane in the space you look at. A test holds the plugin to it
(`test/board-still.test.js`): every space and pane it opens is opened with `--no-focus`, it never focuses anything
while a task runs, and it never splits or closes the board's own pane. Going into an agent on purpose (`Enter` on a
task) is the one thing that moves herdr's window, as before.

## What does change it

- **Another herdr window on the same session**: a second device, a second terminal, a browser tab. herdr 0.9.3 gives
  every pane the size of the window that was last typed in or resized. So with a phone and a desktop on one session
  the board's terminal goes back and forth between the two sizes: seen on a real board as 141×46 → 138×44 → 141×46
  within 0.6 seconds, and as 141×46 → 47×44 when a phone-sized window took the session. Each time the board changed
  shape and changed back. It is herdr's doing, for every pane, not only the board's: a key typed in the window you
  look at gives that window the size. It is not tied to agents: with a local and a remote window (`herdr --remote`)
  of different sizes on one scratch session, spaces, tabs and agents opened and closed in the background changed no
  pane's size, whichever window was typed in last. (Once, on the real board, the 0.6-second change came in the same
  half second as a reviewer starting; herdr's log shows that reviewer's pane spawned at the other window's size, so that window had the session at that moment.)
- **A viewer attached to the board's own terminal** (`herdr terminal attach`, which herdr's web UI starts for each
  pane it shows): it holds that one terminal at its size. [The board](board.md) says so and disconnects it.
- **A pane split off the board's own pane, or your own window resized.** By you: the plugin never does the first.

## A size that lasts a moment is not drawn for

A board laid out for another size and, a moment later, for its own again is what a glitch looks like: the side panel
goes and comes back, every row moves twice. So the open board waits:

- A new size has to last **one second** before the board lays itself out for it. Until then the screen stays exactly
  as it was, cut to the room the terminal has: columns go from the right and rows from the top, so the text box and
  its hints stay. A size that is back within the second leaves nothing changed.
- Every change waits, also one that comes right after another: a short change just after a lasting one is held the
  same way. A window you drag shows the screen as it was, cut, and is laid out for once a second, not at each step.
- herdr is asked what it shows of the board's pane, and answers a moment later. An answer that was given for a size
  the terminal no longer has is put aside and herdr is asked again; an answer that disagrees with the terminal is
  drawn for only when herdr says the same again a second later. (Before, such an answer was drawn for until the next
  one came, two seconds on.)

The cost: after you resize the window yourself, the board follows a second later, and while you drag, once a second.

## A second herdr window is not a viewer the board can disconnect

The board takes its terminal back from a viewer attached to it. Against a second herdr window
on the whole session that changes nothing: herdr puts the terminal back at the size of the window that was last
typed in. A real session's log showed the board taking its terminal 179 times in twelve minutes, every four seconds,
while a second window was on the session. Now it takes the terminal twice; when the sizes are still apart it stops,
and says what gives the size back:

```
 ! Held at 54×24: a key typed in this window frees it. Another herdr window on this session (a second device, a browser tab) has it at its own size, so herdr's own window (142×47) shows the board cut off or half empty
```

It tries again the next time the sizes come apart after having agreed. That the board keeps the size of
its own pane is fixed behaviour: there is no setting that turns it off.

## A view somebody is looking through keeps the terminal

One viewer is not disconnected: the board opened in the terminal view of herdr's web UI, in a browser or on a
phone. Disconnecting it only started a contest (seen on herdr-web-ui 0.4.8: the web UI reattached by itself, and the
two took the terminal from each other every four seconds, so the board could not be used there). Such a view is told
by its age: it was opened in the last twenty seconds, or it is back within twenty seconds of being disconnected.
Once taken for one, it stays one for as long as it runs. The board is then drawn for the whole terminal, as that view
has it, and its first line says so for whoever looks at herdr's own window meanwhile:

```
 Drawn for a remote view of this pane at 119×47 (herdr's web UI has it open): herdr's own window (184×78) shows a cut-out of it until that view is closed
```

When the view is closed the window has its terminal again. A view nobody looks through (an attach an old browser
left behind) is disconnected as before: it is old, and it does not come back. A view that was open before the board
started is disconnected once, comes back, and then stays.
