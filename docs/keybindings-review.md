# Keybindings review (task 29)

A proposal only. No key was changed.

## The short version

Your idea, turned around: **`ctrl` is for the selected task, `alt` is for the whole board and its Coordinator.**

Today's map is already close to this. Four keys move and one narrows (`alt+c`); the three you press most (`ctrl+a`, `ctrl+r`, `ctrl+x`) stay.

## The proposed rule

| Kind of key | Acts on | Keys |
|---|---|---|
| Plain keys | moving around and the text box | arrows, `enter`, `space`, `tab`, `esc`, `?`, `delete` |
| Keys every program shares | what they mean everywhere | `ctrl+c` close, `ctrl+z` undo, `ctrl+f` find |
| `ctrl` + letter | the selected task and its agent | approve, send back, stop, pin, archive, show it |
| `alt` + letter | the whole board, and the Coordinator | archive view, grouping, machines, Coordinator chat |
| Any key, while the text box holds text | the text itself | cursor, delete, undo (see "The text box" below) |

`alt` never acts on a task or its agent. That needs one change to hold: `alt+c` becomes Coordinator only (today it opens the task's agent after `space`). `alt+v` already fits: it flips one board-wide setting, "show the latest message under the chat line", saved once for the whole board. It sends nothing to an agent and changes nothing on a task.

One rule stays as it is and makes all of this safe: **while the text box holds text, only `enter`, `tab` and `esc` act on the board.** Every other key edits the text. So `ctrl+a` is "start of line" in a draft and "approve" on an empty box, and the two never collide.

## Why not your idea as written (`ctrl` = board, `alt` = agent)

1. **It puts the most important keys on the least reliable modifier.** Approve, send back and stop would become `alt+a`, `alt+r`, `alt+x`. `alt` is the modifier terminals handle worst:
   - Mac terminals type a symbol for Option+letter (`å`, `®`, `≈`) unless "Option as Meta" is switched on.
   - Phone and tablet terminals often have no `alt` key, or hide it.
   - A terminal in a browser tab on Windows or Linux loses many `alt`+letter keys to the browser's own menus.
   - `ctrl`+letter reaches the board in native terminal apps on every system. A terminal inside a browser tab is the exception for both modifiers (see "Terminals in a browser tab" below).
2. **Two letters would clash.** `alt+r` would mean both "send back" and "restart the Coordinator"; `alt+a` both "approve" and "archive".
3. **"Task" and "agent" cannot be split by key.** One key often does both: `ctrl+a` approves a merge (task) and says yes to a permission prompt (agent). To you a task and its agent are one thing, so they share one modifier.
4. **`ctrl` has almost no letters left.** 14 are in use and 6 cannot be used at all (see below). Everything board-wide cannot also fit there, which is why archive ended up on `alt+a` and `alt+h` in the first place.

Turned around, the rule keeps the frequent keys on `ctrl`, and puts only rare ones on `alt`. All `alt` keys are also lines in the `?` menu, so a terminal that drops `alt` loses nothing.

## Every key today, and what it would become

Bold rows change.

### Plain keys (no change)

| Key | What it does | Acts on |
|---|---|---|
| `↑` `↓` (also `shift+↑` `shift+↓`) | move between tasks | board |
| `PgUp` `PgDn` | move ten tasks; scroll the full-screen task | board / task panel |
| `Home` `End` | top or bottom of the full-screen task | task panel |
| `alt+↑` `alt+↓` | jump to the previous or next group | board |
| `ctrl+↑` `ctrl+↓` | into and out of the words on their way to another machine | board |
| `enter` | with text: send. Empty: open the task's agent | text box / task's agent |
| `→` | open the task's agent | task's agent |
| `space` | talk to this task's agent (again: back to the Coordinator) | text box |
| `tab` | put an agent on the task; with text: add it and start an agent | task |
| `shift+enter` | new line | text box |
| `delete` | delete the task (asks first) | task |
| `?` | the menu | board |
| `esc` | one step back: draft, the chat's latest message, open task, filter, archive; last step shows the `ctrl+c` hint | board |

Arrows always move, whatever is held with them, so `alt+↑` and `ctrl+↑` belong here.

### Shared keys (no change)

| Key | What it does |
|---|---|
| `ctrl+c` | close the board: twice, the first shows `Press ctrl+c again to close the board` for 0.8 seconds, as Claude Code does |
| `ctrl+z` | undo: bring back a draft, or undo the archive |
| `ctrl+f` | find |

### `ctrl`: the selected task

| Today | Proposed | What it does |
|---|---|---|
| `ctrl+a` | `ctrl+a` | yes: approve the merge, say yes to the agent, retry |
| `ctrl+r` | `ctrl+r` | send it back to the agent to fix |
| `ctrl+x` | `ctrl+x` | stop the agent |
| `ctrl+e` | `ctrl+e` | the whole task, full screen |
| `ctrl+p` | `ctrl+p` | the task's side panel, on or off |
| `ctrl+t` | `ctrl+t` | pin to the top |
| **`alt+a`** | **`ctrl+k`** | **archive or restore the task** ("keep") |
| `ctrl+g` | *removed* (decision 3) | a second, undocumented key for send back |
| `ctrl+y` | *removed* (decision 3) | finish anyway, only on a task that stopped without a summary; `ctrl+a` does the same there |

### `alt`: the whole board and the Coordinator

| Today | Proposed | What it does |
|---|---|---|
| `alt+h` | `alt+h` | open the archive, or go back to the board |
| **`ctrl+s`** | **`alt+s`** | **group by repo or by state** |
| **`ctrl+d`** | **`alt+d`** | **show all done, or only the latest** |
| **`ctrl+o`** | **`alt+o`** | **this machine, every machine, each one** |
| **`alt+c`**: opens the chat of whoever the chat line names (the Coordinator, or after `space` the task's agent) | **`alt+c`**: always the Coordinator's chat | `enter` and `→` already open the task's agent |
| `alt+v` | `alt+v` | board setting: show or hide the latest message under the chat line, whoever it is from |
| `alt+r` | `alt+r` | restart the Coordinator |
| `alt+n` | `alt+n` | start a new Coordinator |

### The text box (no change)

These come from the text editor the board uses. None of them changes. They act on the text, never on the board, a task or an agent.

With text in the box, every key below edits it. On an empty box the ones marked † are board keys instead today, and the ones marked ‡ become board keys with this proposal (tables above); the rest reach the editor exactly as they do with text. Cursor and delete keys then have nothing to act on. The ones that add or restore text still work from an empty box: typing, a paste, a new line, `shift+space`, and `ctrl+-`, which brings back text you just deleted (type a draft, `ctrl+u`, `ctrl+-`).

| Key | What it does |
|---|---|
| `←` `→`†, `ctrl+b`, `ctrl+f`† | one character left or right |
| `alt+←` `ctrl+←` `alt+b` | one word left |
| `alt+→` `ctrl+→` `alt+f` | one word right |
| `↑`† `↓`† | one line up or down |
| `home`†, `ctrl+a`† | start of the line |
| `end`†, `ctrl+e`† | end of the line |
| `PgUp`† `PgDn`†, `ctrl+PgUp` `ctrl+PgDn` | a page up or down in a long draft |
| `ctrl+]` then a character | jump forward to that character |
| `ctrl+alt+]` then a character | jump backward to that character |
| `backspace`, `shift+backspace` | delete the character before the cursor |
| `delete`†, `shift+delete`, `ctrl+d`† | delete the character under the cursor |
| `ctrl+w`, `alt+backspace` | delete the word before the cursor |
| `alt+d`‡, `alt+delete` | delete the word after the cursor |
| `ctrl+u` | delete to the start of the line |
| `ctrl+k`‡ | delete to the end of the line |
| `ctrl+y`† | put back what was last deleted |
| `alt+y` | cycle through earlier deletions |
| `ctrl+-` | undo the last edit |
| `shift+enter`, `alt+enter`, `ctrl+j` | new line |
| `shift+space` | a plain space (on an empty box too, where `space` alone is the board's "talk to this task's agent") |
| `ctrl+c` | nothing (with text it does not close the board; `esc` puts the draft away first) |
| paste | inserted as text; keys inside a paste never act on the board |
| `enter` `tab` `esc` | the only keys that still act on the board: send, send and start an agent, put the draft away |

After the change: `ctrl+d` and `ctrl+y` lose their † (no board meaning any more, decision 3 for `ctrl+y`). `alt+s` and `alt+o` are not editor keys at all, so they clash with nothing.

Two undo keys exist and stay apart: `ctrl+-` undoes an edit inside the draft, `ctrl+z` (empty box) brings back a draft you put away or undoes an archive.

### Menus and questions (no change)

| Where | Keys |
|---|---|
| The `?` menu | `↑` `↓` choose, `enter` runs the line, `esc` / `ctrl+c` / `?` close it |
| A question ("Merge?", "Delete?") | `y` yes, `n` / `esc` / `ctrl+c` no; `enter` never confirms |
| First-run setup | `1` `2` switch a choice, `k` type another key, `enter` save, `esc` ask next time |
| Find | every key types into the search; `enter` keeps the filter, `esc` leaves |

## What the rule had to work around

- **`ctrl` letters that can never be used:** `b` (herdr's prefix), `h` (backspace), `i` (tab), `j` (new line), `m` (enter), `v` (herdr's image paste on a remote session).
- **herdr's own keys:** all of them sit behind the `ctrl+b` prefix, so nothing else on the board clashes with herdr.
- **Text editing keys:** `ctrl+a/e/k/u/w/d/y/f/b` and `alt+b/f/d/y` all edit text, but only when the box holds text, where the board keys are off. No clash.
- **Terminals in a browser tab** (Windows, Linux, ChromeOS; on a Mac the browser's own shortcuts use `cmd`, so `ctrl`+letter passes through). This part is from the browsers' documented behaviour, not from a test on your devices:
  - *The browser's in an ordinary browser window, where a web page cannot take them:* `ctrl+t`, `ctrl+n`, `ctrl+w` (new tab, new window, close tab). Chromium does hand them to the page in fullscreen and in an installed app window, so a terminal used that way gets them. Of the board's keys only `ctrl+t` (pin) is in this group.
  - *The browser's unless the terminal page claims them first:* nearly every other `ctrl`+letter, among them `ctrl+r` (reload), `ctrl+f` (find in page), `ctrl+p` (print), `ctrl+l` and `ctrl+k` (address bar), `ctrl+s`, `ctrl+d`, `ctrl+o`, `ctrl+e`, `ctrl+u`, `ctrl+h`, `ctrl+j`. Whether the board gets them depends on the terminal client, so it has to be tried once per client. So no `ctrl` letter is a safe replacement for another one here.
  - `alt`+letter has the same problem (browser menus), with fewer clients claiming them.
- **The fallback that needs no modifier:** the `?` menu is driven by `?`, `↑` `↓` and `enter` only, which every client passes through. Checked in the code (`menuItems` in `src/board/view.js`): it has pin, archive, the task panel, the side panel, the archive view, grouping, all done, machines, undo, delete and the four Coordinator keys. It does **not** have approve (`ctrl+a`), send back (`ctrl+r`), stop (`ctrl+x`) or find (`ctrl+f`). Those four have no modifier-free path today (decision 4).

## Decisions for you

1. **Take the turned-around rule?** `ctrl` = this task, `alt` = whole board and Coordinator. I recommend yes. The alternative, your original direction, moves approve, send back and stop to `alt`.
2. **Should `alt+c` always mean the Coordinator?** Today, after `space`, `alt+c` opens the task's agent instead, which `enter` already does. I recommend Coordinator only: it is what makes "`alt` never touches a task" true. If you say no, the rule needs a written exception: "`alt+c` follows whoever the chat line names".
3. **Remove the two hidden keys?** `ctrl+g` (same as `ctrl+r`) and `ctrl+y` (same as `ctrl+a` on a task that stopped without a summary; on any other task it is refused, so it adds nothing). I recommend removing both.
4. **Add approve, send back, stop and find to the `?` menu?** I recommend yes. Then every action on the board can be reached with plain keys, whatever a browser or terminal swallows, and no key has to be moved for browser reasons. Pin stays on `ctrl+t`; in a browser tab on Windows or Linux it is reached through the menu. (This is the one behaviour change in this report that is not a key change.)
5. **Is `ctrl+k` fine for archive?** `a` is taken by approve. Other free letters: `l`, `u`, and after the moves `s`, `d`, `o`. In a browser-tab terminal all of them, `ctrl+k` included, depend on the client (see above), so none is safer than another there; the `?` menu is the path that always works.
6. **Does `alt` work on every device you use?** If one of them has no working `alt`, everything on it is still in the `?` menu, but the Coordinator's chat key would deserve a `ctrl` key of its own.
