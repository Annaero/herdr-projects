# The board in the herdr web UI

With the [herdr web UI](https://github.com/devswha/herdr-web-ui) plugin installed beside this one, the board is a
part of that web UI: a **Board** entry at the foot of its sidebar, at the same link, behind the same login. It does
what the terminal board does, with buttons and touch instead of keys, on a phone and on a desktop. Without the web UI
plugin nothing of this runs.

## Setting it up

1. Install both plugins. From then on a small **front door** of the board's own runs on this machine, in front of
   the web UI. It starts with herdr and is kept up by the keeper.
2. Share the web UI as it says itself (its Settings → Phone shows the `tailscale serve` command).
3. The board asks once, the next time you open it in the terminal: *Show this board in the herdr web UI?* **Yes**
   points the web UI's shared link at the front door; **no** leaves the link alone for good; **later** asks again the
   next time the board opens.

That one change is the whole setup. By hand, any time:

    herdr-superwork web-ui            how things stand: the web UI, the front door, which links go through it
    herdr-superwork web-ui link       point the web UI's shared link at the front door
    herdr-superwork web-ui unlink     point it back

`herdr-superwork remove-extras` points the link back too and stops the front door ([installing](install.md)). To turn
the whole thing off and keep the rest: `herdr-superwork set board.webUi none` ([settings](settings.md)); the front door
points the link back by itself and closes.

On the machine itself the Board is also at the front door's own address, which `web-ui` prints
(`http://127.0.0.1:7327/` unless that port was taken).

## Why a front door

The web UI has no place for an add-on (checked on herdr-web-ui 0.4.8). Its pages allow scripts and connections from
its own address only and may not be put in a frame (`server/static.ts` there), so the board has to come from the very
address the web UI comes from. Changing the web UI's files is no way either: its updater builds each release from the
official code and wants a clean checkout, so a patch would be wiped by every update and could block updating.

So the front door stands in front of it instead:

- **It passes every request on as it is**: pages, `/api/*`, the `/ws` socket, streams, ranged and ready-compressed
  files, the service worker. The same method, address and headers go in, in their own order and spelling; the same
  status, headers and bytes come out as they arrive. Only the two connection headers every HTTP hop writes for itself
  (`Connection`, `Keep-Alive`) are its own.
- **It adds one line to the web UI's page**: a script, from the same address, that puts the Board entry into the
  sidebar. Nothing else in the page changes, and its security policy stays as sent. A page that cannot be read is
  passed on as it is.
- **It corrects one answer**: what the web UI's Settings → Phone is told about its own link (`GET /api/access`).
  The web UI finds its link by looking for a `tailscale serve` entry that points at its own port. Through the front
  door the entry points at the front door's port, so the web UI would say it has no link and offer the command for a
  second one. The answer is given the link it already has. Anything else in it, and the answer itself whenever it
  already names a link or cannot be read, is passed on as it came.
- **It answers under one path the web UI does not use**, `/superwork/`: the board's page files and its calls.
- **A fault of the board never breaks the web UI.** Whatever goes wrong on the board's side, a request that is not
  the board's still goes through. The board's work is done in a thread of its own, so reading tasks never holds up a
  terminal's keystrokes on their way through.
- **It shows the herdr the web UI shows**, worked out as the web UI's own start does: the session that started both
  plugins comes first (herdr hands every plugin its socket), then a socket the web UI's settings name. Not always
  the default session.
- **It follows the web UI**: through its restarts and its own updates (it keeps its port), and to another port when
  it takes one. While the web UI is down its address answers "not answering right now" and the board lets nobody in.

The front door is part of the board's one page server (`herdr-superwork serve`, which also serves
[evidence pages](task-panel.md)): one long-lived process, not two. Its bookkeeping (its process, its port, where it
passes things on to) is `data/front-door.json` in [the home folder](home-folder.md). When the plugin is updated the
process hands over to a new one on the same port; a terminal open in the web UI reconnects by itself.

## Who gets in

The board is as protected as the web UI, by the web UI:

- The front door keeps no token, no cookie and no list of devices. For every call of the board's it asks the web UI
  itself, with the caller's own headers exactly as they came, whether that caller is logged in (its token and device
  gate: `server/auth.ts`, `server/access.ts` there). Anything but a plain yes is a no: no answer, an answer it cannot
  read, a web UI that is down. Not logged in, nothing of the board can be read or changed.
- A call that changes something must come from the board's own page: the same origin, and a header of the board's
  own (`x-herdr-superwork`), which a page of another site cannot send. The web UI asks the same of its own controls.
- A device the web UI paired to *watch* can look at the board and change nothing: it can select, find, and show or
  hide; it cannot send, approve, stop or archive.
- The page's own files (scripts and styles) hold no task and are public, as the web UI's own files are.
- **Private only.** The front door listens on `127.0.0.1` and nowhere else. The only way to it from another device is
  the web UI's own private link (`tailscale serve`). A link that is open to the internet (Tailscale Funnel) is never
  pointed at it, and nothing here ever makes one.

## What the link step changes, and how it goes back

The web UI does not share itself: it shows the command and then recognises its link by where that `tailscale serve`
entry points. The board changes exactly that: each private HTTPS entry whose root goes to the web UI's port goes to
the front door's port instead. What it changed is written down (`data/extras.json`), and going back only touches an
entry that still points at the front door, and points it at where the web UI listens *now*, also when the web UI took
another port since. An entry for another app, one for a sub-path, and one that is open to the internet are never
touched.

**The two do not pull one link back and forth.** Only your yes (or `web-ui link`) takes a link. The front door never
takes one by itself afterwards. The web UI's Settings → Phone, opened at the link, keeps showing that link as its own
(the one corrected answer above). Its Phone setup run from herdr on the machine reads Tailscale itself, finds no
entry at its own port, and makes one more link on another port: that one goes straight to the web UI, is the one it
finds from then on, and is left alone. `herdr-superwork web-ui` lists both and says which has the Board.

The front door has a port of its own because Tailscale proxies to `127.0.0.1` only (checked on 1.102: a target on
the other loopback address is refused), so it cannot stand at the web UI's port number.

A browser that saved the web UI's page while the link went through the front door (the web UI's own offline copy)
still has the one script line in it after the link was pointed back: the script is then not found, nothing shows,
and the next load online replaces the copy.

## What the board looks like there

It is drawn with the web UI's own colours, type, sizes and spacing (its CSS variables, `DESIGN.md` there), so it
follows light and dark and every palette of the web UI by itself. The web UI does not read herdr's theme, so there
the Board matches herdr as the web shows it. A status is the web UI's own colour for it, a task nobody started is its
dim text colour, and the frame of the text field says who gets your words, as the terminal board's box does: the
plain text colour for the Coordinator, the task's status colour for its agent ([colours](colours.md)).

| On the terminal board | On the web board |
|---|---|
| the list, its groups, marks, progress, review and pull request tags | the same list; a pull request's tag is a link. The agent at work is a full dot, its reviewer the right half of one and the board's own steps the lower half: all three are drawn, at one size (as text the two half discs came out a third the size of the dot). Every other mark is the terminal board's own character (one cross, `✗`; `◆` ready to approve; `@` a sign-in), and the headings are written as the terminal writes them |
| moving between tasks | tap a task: it opens, whole. The selected row has a bar in its gutter as well as its tint, as on the terminal board |
| the task panel: status, what it needs from you, description, reviews, evidence, what the agent said, settings, session | the open task, every part, evidence as links |
| the hint line: what can be done to the selected task now | the buttons at the top of the open task, in the same words |
| the `?` menu | **More…** (and `⋯` in the header): only what applies now and is not a button already, in the buttons' own words (`Remove this task`, `Show every machine's tasks`). A key the page has no button for has no entry |
| the chat, and who it talks to | the box at the foot; tap its first line to switch between the Coordinator and the task's agent |
| the chat's box: the newest thing said, under a line that names who said it (the reviewer, while the task is under review) | the same words under the same line (`Reviewer:`, `Agent:`, `You:`), never the program's screen; **Show all of it** has the rest of the conversation, which `alt+u` scrolls to on the terminal |
| typing, then sending; sending and putting an agent on what is added | **Send**, and **Send + start** beside it, the same size |
| who typed words are for | locked when the first of them is typed and written over the box (`To: #34`, `To: Coordinator`): tapping another task meanwhile changes what you look at, never who gets the words; while the page shows somebody else the chip says so (`To: #1 · not who is shown above`) and the box's frame is the plain colour. Which machine's Coordinator is part of it: words typed for `vm-a`'s go to `vm-a` also after the view moved to another machine, and to nobody when `vm-a` is no longer reachable. The draft is kept with who it is for, so a reload of the page brings both back |
| a question (approve a merge, remove a task) | a sheet with the same words and answers; for a merge or a remove neither answer is the filled button, and after a failed review the yes reads **Merge anyway** |
| the board's message to you | a short notice above the chat; one that says something went wrong stays until dismissed |
| the automations: the last group of the list, one of them whole, on and off, fire now, remove | the same group at the foot of the list, on a phone and on a wide screen, its rows in the task rows' shape (the mark, the name, and under it the trigger, `on` or `off` and the next or last firing, all of it on any width, never clamped to two lines as what a task says is; one that is off is dimmed as a done task is). A row tapped open is the automation, whole, with the same buttons, each firing a link to its task; another machine's is named as its tasks are ([automations](automations.md)) |
| find, the archive, grouping by repo, all done tasks, other machines | the search button, and **Show** in More…; what is on shows as a chip under the header |
| going into a task's agent | **Open this task's agent**: the web UI's own view of that pane (chat, or the terminal when no agent is in it) |

**The page speaks web and fits a thumb.** No terminal key is named on it (a task's settings say the command that
changes one, not `ctrl+e`; a setting that is the task's own says so in words, not with a star). There is one back
arrow at a time: on a phone the open task's stands for the Board's. Nothing that is read is under 13 px, and
everything that is tapped is 40 px high at least. The header names the repo, with no folder path.

Every [key](keys.md) of the board is a button or a menu entry, except the ones that belong to a terminal: closing
the board's terminal, the `?` menu itself, scrolling and showing the chat's message, the side panel and the full
screen (the page scrolls, and shows the list and the task side by side when it is wide enough).

It stays fresh while it is open: it asks every two seconds and draws again only what changed. Each browser has its
own selection, question and message, so a phone and a desktop do not get in each other's way. What you type stays in
that browser tab until it is sent.

A task on [another machine](other-machines.md) shows and acts as on the terminal board. Its agent's pane is on that
machine: the board says so instead of opening it.

## The same code decides

The web board works nothing out again. On the server it *is* the terminal board, opened with no terminal
(`src/webui/web-view.js`): the same list, selection, questions and actions. A button presses the board's own key; what
is typed is sent as enter sends it. The row's mark, words and columns, the task panel's lines, the hint line and the
`?` menu are drawn by the board's own code through a theme that names each colour instead of painting it, and the page
gives each name a colour. So the two boards cannot disagree, and a change to the terminal board is a change to the web
board. A key's button has a name of its own in the board's words there (`web` in `src/board/keys.js`): "“Undo” brings
it back".

## Other machines

The web UI has machines of its own, its **PCs**: this one, and the ones added in its Settings → Remote PCs. The board
has herdr's saved machines ([other machines](other-machines.md)). The front door asks the web UI which PCs it has
(`GET /api/machines`, with your own login, nothing kept) and the board matches the two: by herdr's own id for the
saved machine where the web UI names it, else by where they connect (the same host, port and herdr session, and the
same user where both say one).

- **Every machine, or one.** `More` → **Other machines** goes round as `Alt+M` does on the terminal board: this
  machine, every machine, each one by itself. A chip says which, and takes you on. Every button works on another
  machine's task as on the terminal board, and what you type while one machine shows goes to that machine's
  Coordinator.
- **Open this task's agent** on another machine's task: that machine reopens the task's space and restarts an exited
  agent, as it does for the terminal board, and the page goes to the web UI's own view of that pane on that PC
  (`?machine=<its PC>&pane=…`). Work never moves: only the page does.
- **The board goes with the web UI.** Opened while the web UI shows a pane of another PC, the Board is that
  machine's board by itself. Back on a pane of this machine it shows what it showed before. A choice of your own
  stands while the web UI stays where it is.
- **What is missing is said, not hidden:** the web UI has no PC for that machine (add it in Settings → Remote PCs),
  the PC is not connected there, the web UI did not say which PCs it has (an older one), the other machine did not
  answer or runs a plugin too old to reopen a space (the pane it last named is opened, and the board says to update),
  or the web UI is on a PC the board knows no machine for (`herdr machine add`).

Each machine with both plugins also has a front door and a Board of its own, at its own web UI's link.

**When the web UI runs on one machine and the tasks are on another.** The Board is served by the machine the web
UI runs on, so that machine needs this plugin too, on this version, and it needs the other machine as one of herdr's
saved machines there (`herdr machine add`, or `board.machines`), reachable over SSH with `herdr-superwork` on its
path. The machine with the tasks needs no web UI and no front door. The Board then shows that machine's tasks when
the web UI is on one of its panes, or through `More` → **Other machines**. The terminal board that runs on the
machine with the tasks is that machine's own program: it is that machine's plugin that has to be on this version
for it to stay put in the web UI's terminal view.

## The terminal board in the web UI's terminal view

The terminal board is an ordinary pane, so the web UI shows it in its terminal view like any other, on this machine
and on its other PCs. Three things made it unusable there and are handled by the board ([its size](board-size.md),
[its keys](keys.md)):

- **It is not disconnected.** The web UI's view of a pane sets that pane's size. The board used to take its size
  back from every such view, the web UI reattached by itself, and the two took the terminal from each other every
  four seconds. A view somebody is looking through now keeps the terminal, and the board is drawn for it.
- **`Alt` keys and `Shift+Enter` work.** The web UI's terminal sends the old byte forms for them, and the board
  takes those too.
- **A phone's input line** sends an Enter of its own behind what you type. While a view of the pane is open, behind `?`, `y`, `n` or space that Enter
  is dropped, so `?` opens the menu and leaves it open.

| The key | In a desktop browser | On a phone |
|---|---|---|
| letters, `Enter`, `Tab`, `Esc`, arrows | typed | the input line and the key bar (`Esc` `Tab` `Enter` and the arrows) |
| `Ctrl` keys | typed. A browser keeps a few for itself (`Ctrl+N`, `Ctrl+T`, `Ctrl+W` in Chrome): pick that line in the `?` menu | `Ctrl` on the key bar, then the letter with direct typing on (the keyboard button); or the `?` menu |
| `Alt` keys | typed. On a Mac, Option types a character instead: pick the line in the `?` menu | `Alt` on the key bar, then the letter with direct typing on; or the `?` menu |
| `?` | typed | typed into the input line and sent |

**Going into an agent** from the terminal board there: for a task on this machine herdr's own window goes to the
agent, and the board says to pick it in the web UI's sidebar. For a task on another machine the board does not turn
its terminal into that agent's while the web UI shows it, and says where the agent is in the sidebar instead: the way
back is herdr's `ctrl+b q`, and the web UI's view of the pane takes that chord for itself, so the board would stay
inside the agent. The web Board's **Open this task's agent** is the way that works from a browser.

## When the web UI changes

- **It updates itself**: nothing to do. The front door changes none of its files.
- **It was redesigned and the sidebar's foot is gone**: a small floating **Board** button shows instead, and says
  once why. The board itself is unchanged.
- **It gets an add-on slot of its own**: the front door can go. Until then, check these on a new version of the web
  UI: the sidebar foot (`.sidebar-footer`), the drawer's scrim (`.scrim.is-open`), its address parameters `ws`,
  `pane` and `view` (`src/lib/deepLink.ts`), `/api/health?scope=bridge` saying who asks, and that `/superwork/` is
  still free, what `/api/access` says about its link (`server/tailscale.ts`), `/api/machines` naming each PC's
  `id`, `kind`, `target` and `state`, and its `machine` address parameter.

## Trying it against a copy

`HERDR_SUPERWORK_WEBUI=<port>` (or `host:port`) names a web UI that herdr does not list as a plugin, which is how a
copy of it is tried out with a scratch herdr and a scratch [home folder](home-folder.md). `off` there means none.

## Checked

On herdr-web-ui 0.4.8 with herdr 0.9.3, a real web UI behind the front door, in a browser at a phone's and a
desktop's size, in dark and light: its chat and terminal, files (also ranged), its service worker and manifest, its
push and update calls answer the same bytes through the front door as directly; the board lists, opens, sends, asks
and acts; a restart of the web UI is followed; the link step and its way back change only the web UI's own private
link, and its Settings → Phone, at the link, still names that link. Its self-update was not run for real: the front
door changes none of its files and keeps none of its state, and a restart is what an update ends in.

Checked on 2026-10-13, herdr-web-ui 0.4.8 with herdr 0.9.3, for other machines and the terminal view. Two separate
herdrs on one computer stood in for two machines: each with its own settings, state and board, both plugins
installed in each, the second reached only over SSH, saved in the first with `herdr machine add` and added in the
first web UI as a PC. A real browser went through the front door at a phone's (390×800) and a desktop's (1280×800)
size.

| What | Result |
|---|---|
| The web Board: every machine, one machine, back | the other machine's tasks show with its name; the chip says which |
| The web Board on another machine's task: pin, archive, undo, talk to its agent, approve and merge | each done on that machine (the merge at the phone's size); the answer shows on the board |
| What is typed while one machine shows | went to that machine's Coordinator, which added the task there |
| Open this task's agent, on another machine's task | landed in that agent's chat in the web UI, on that PC |
| The Board opened while the web UI shows a pane of the other PC | that machine's board by itself; back on this machine, what it showed before |
| The terminal board in the terminal view, before the change | the web UI's view and the board took the terminal from each other every four seconds, with a herdr window on the session and with none; no `Alt` key did anything |
| The terminal board there now, this machine's and the other PC's, desktop | stays; every `Alt` and `Ctrl` key, `?`, `Shift+Enter`, drafts, find, the arrows did what they do in a terminal |
| The same on the phone layout | `?` from the input line opens the menu and it stays open; the key bar's arrows move in it; `Alt` then `m` with direct typing shows every machine; a message from the input line reached the Coordinator |
| From the terminal board there: an agent put on the other machine's task with `Tab`, then into it with `Enter` | the agent started there. Going in showed its screen, and `ctrl+b q` did not come back: the web UI's own view detached instead. Hence the board no longer goes in from there |
| The mouse on the terminal board there (desktop) | the wheel over the list moves the selection a task a step; a drag over text is highlighted by the board; the selected row has its colour |
| The board as herdr's popup (`board.open popup`), in the terminal view | the popup is a pane the web UI lists: it stays, and `Alt+M`, `?` and `Shift+Enter` work in it as in the tab |
| The other machine on the plugin as it was before this change | Open this task's agent still lands in that agent's chat: its answer names no space, and a pane's id starts with its space's |
| The web UI's address with a PC and no pane (`?machine=<pc>#board`) | the web UI goes to a pane of this machine by itself, so the Board is this machine's: it follows a pane, not a bare PC |
| What a program gets from the terminal view | desktop: old bytes (`esc m` for `Alt+M`, `esc return` for `Shift+Enter`), also after it asked for the newer keyboard protocol; `ctrl+b` is held and sent with the next key. Phone: the input line sends the text, then a lone return 120 ms later, and ignores the key bar's `Ctrl` and `Alt`; the key bar and direct typing send the newer protocol's sequences. A click and the wheel arrive as mouse reports |

Not checked: a browser's own reserved keys (the test browser has none: `Ctrl+N` and the like are Chrome's known
ones), a Mac's Option key, the wheel over the chat and the mouse on a phone, a plugin so old that it sends no
version (its message is covered by a test only), a machine with no web UI or front door of its own, a web UI newer
than 0.4.8 that takes its PCs from herdr's own list, and real separate computers: everything above was two herdrs
on one computer.
