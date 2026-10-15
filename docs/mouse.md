# The mouse

The board asks the terminal for the mouse, for two things: the wheel, and a click on a task's row or a heading.

**The wheel.** With the pointer over the chat (the line that says who you talk to, and its box) it scrolls a message
that is longer than its box, two lines a step, faster when you spin it. It does so while you type too, and never
touches the draft. Anywhere else it does what `↑` and `↓` do: on the whole-task page (`Alt+T`) the page scrolls, two
lines a step and with a draft in the text box too; in the `?` menu the pick moves; over the list the selection moves
a task a step. A question, the first-run screen and a paste on show keep the screen as it is.

While the text box holds words, the wheel over the list moves the view only, never the selection: who the words are for
is locked (the hint line under the box says who: `enter send to HSW-34's agent`), and a turn of the wheel must not send
an answer to another task's agent. The next key brings the view back to the selected task.

**A click on a task's row selects it**, as `↑` and `↓` would; on the selected one it does nothing more, and every
action is still a key. With words in the box a click selects nothing and the board says why (`Send or put away what
you typed first`). **A click on a heading folds it**, or unfolds it, as `Enter` on it does ([list
headings](list-headings.md)). A click anywhere else (the header, the chat, the task panel) is not the board's.

**Selecting and copying.** A program that asks for the mouse gets all of it: herdr, and a terminal outside herdr, then
no longer select text in the board themselves. So the board does it (its own selection,
`crates/board/src/board/run/mouse.rs`, the same on every terminal): drag over text and it is highlighted; let go and it
is copied to the clipboard. A double click selects a word, a click anywhere takes the highlight away. The copy goes out
as the terminal's clipboard code (OSC 52), which herdr passes on, with its `copied to clipboard` note.

What changes for you:

- **Dragging selects and copies as before**, but it is the board that draws the highlight, not herdr. It selects what
  is on the board's own screen, line by line, a box's edges included, as herdr's selection of a pane did.
- **herdr's settings for its own selection no longer apply in the board's pane**: `copy_on_select = false` (keep the
  selection until `Ctrl+C`) is not followed there, the board always copies when you let go.
- **The terminal's own selection** (the one that crosses herdr's sidebar and panes) is where it was: herdr already
  holds the mouse of the terminal it runs in, so it takes the terminal's own modifier, as everywhere in herdr
  (`Shift` and drag in most terminals; `Option` in iTerm2, `Fn` in macOS Terminal).
- **Links.** The pull request and the evidence links are written as terminal links (OSC 8), and clicking one is the
  terminal's to do (`Cmd` and click on a Mac). That is unchanged: the terminal sees herdr's hold on the mouse, which
  was there before, not the board's. A plain click on a link now reaches the board, which does nothing with it.
- **The wheel over the list moves the selection**, as it did: herdr turned the wheel into `↑` and `↓` for a
  full-screen program that had not asked for the mouse.
- **A terminal that copies nothing on OSC 52** (macOS Terminal; a tmux without `set-clipboard on`) shows the
  highlight and copies nothing. herdr's own copy goes out the same way, so a terminal that copied from herdr copies
  from the board; where neither does, the terminal's own selection, with its modifier, is the way.

**Why not only the wheel.** Terminals have no way to ask for the wheel alone. Without the mouse, herdr sends the
wheel as `↑` and `↓`, with no word on where the pointer is: the board could not tell a turn over the chat from one
over the list.

**In the popup.** The board asks for the mouse the same way and draws the same there. It was tried for real in a
pane of herdr 0.9.3 and in the popup the board key opens (`board.open`: herdr's own popup), where the wheel arrives
with its position as in any pane ([what was checked](checked-on-herdr.md)). A drag that selects and copies was not
tried in the popup.

The two keys that scroll the chat without a mouse, `Alt+U` and `Alt+J`, are in [the keys](keys.md); how the chat
grows and where a message starts is in [the board](board.md).
