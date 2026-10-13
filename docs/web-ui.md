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
the whole thing off and keep the rest: `herdr-superwork config webUi off` ([settings](settings.md)); the front door
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
follows light and dark and every palette of the web UI by itself.

| On the terminal board | On the web board |
|---|---|
| the list, its groups, marks, progress, review and pull request tags | the same list; a pull request's tag is a link |
| moving between tasks | tap a task: it opens, whole |
| the task panel: status, what it needs from you, suggested tasks, description, reviews, evidence, what the agent said, settings, session | the open task, every part, evidence as links |
| the hint line: what can be done to the selected task now | the buttons at the top of the open task, in the same words |
| the `?` menu | **More…** (and `⋯` in the header): every other action, as it stands for the selected task |
| the chat, and who it talks to | the box at the foot; tap its first line to switch between the Coordinator and the task's agent |
| typing, then sending; sending and putting an agent on what is added | **Send**, and the second button beside it |
| a question (approve a merge, remove a task, a suggested task) | a sheet with the same answers |
| the board's message to you | a short notice above the chat; one that says something went wrong stays until dismissed |
| find, the archive, grouping by repo, all done tasks, other machines | the search button, and **Show** in More…; what is on shows as a chip under the header |
| going into a task's agent | **Open this task's agent**: the web UI's own view of that pane (chat, or the terminal when no agent is in it) |

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

## When the web UI changes

- **It updates itself**: nothing to do. The front door changes none of its files.
- **It was redesigned and the sidebar's foot is gone**: a small floating **Board** button shows instead, and says
  once why. The board itself is unchanged.
- **It gets an add-on slot of its own**: the front door can go. Until then, check these on a new version of the web
  UI: the sidebar foot (`.sidebar-footer`), the drawer's scrim (`.scrim.is-open`), its address parameters `ws`,
  `pane` and `view` (`src/lib/deepLink.ts`), `/api/health?scope=bridge` saying who asks, and that `/superwork/` is
  still free, and what `/api/access` says about its link (`server/tailscale.ts`).

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