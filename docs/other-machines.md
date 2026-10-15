# Other machines

Every machine keeps its own tasks. `Alt+M` goes round: this machine, every machine, then each one by itself. Which
of these you look at is the first thing in the board's header, in the accent colour, and is never cut: `all machines:
otherbox`, or `only otherbox`. With every machine shown, each machine is a heading of its own, with its repos (or
its status groups) under it, and a row has its plain tag (`#1`): the heading above it names its machine ([list
headings](list-headings.md)). A machine's [automations](automations.md) come with its tasks, in the list's last
group: with every machine shown each row names its machine (`on otherbox`), and they are turned on and off, fired
and removed, and their settings changed, on the machine that has them.
Machines are found through herdr only: the ones you added with `herdr machine add` (or name them in `board.machines`);
with none, `Alt+M` says so. They are listed in the order of herdr's machines sidebar ([machine order](machine-order.md)).
There is no Tailscale discovery. The plugin's own commands on another machine still
travel over the plugin's own SSH connection, because herdr has no command that runs a plugin's commands there.
Each one needs, once:

```sh
# git, gh, the agent programs it will run, then:
git clone https://github.com/eliasstravik/herdr-projects && cd herdr-projects
herdr plugin link "$PWD"
sh bin/run.sh install             # gets the program and writes its launcher
```

and `herdr-projects` on the PATH of a login shell there (below). How the program is fetched and updated is in
[installing](install.md).

**The command must be found by a login shell that nobody types into.** The board asks another machine over SSH with
`$SHELL -lc 'herdr-projects remote list'`: a login shell, not an interactive one. A PATH that is only set for
interactive shells does not count: on many systems `~/.bashrc` stops at its "if not running interactively, return"
line, so a PATH set up below that line is not found. Set the PATH in the profile file instead (`~/.profile` or
`~/.bash_profile` for bash, `~/.zprofile` for zsh), or link the launcher into a folder a login shell already has
(`ln -s ~/.herdr-projects/data/bin/herdr-projects ~/.local/bin/`). The test, from the machine the board is on, ends with a line of JSON when all is well:

```sh
ssh <machine> 'exec $SHELL -lc "herdr-projects remote list"' | tail -c 200
```

What a shell's start-up files print around that line (a banner before it, a goodbye after it, anything on stderr)
does no harm, however much it is and also when it is JSON itself: the board reads the last line that is its own answer.

## When a machine does not answer

A machine whose tasks could not be read is never shown as one with no tasks. Where its tasks would be, on the terminal
board and the web board, one line says so with the reason: `vm-a: its tasks cannot be read: herdr-projects is not
found there.` In the every-machine view the other machines' tasks still show under it. On that machine's own board
(`Alt+M` goes round to it, also while it does not answer) the rest follows: what came back, what it means and what
to do; the web board keeps that behind "Why, and what to do". Where it is longer than the screen, the arrows scroll
it and a line says that there is more. The line stays where it is while the board asks again
every half minute; it is never repeated as a message. An action on a task of a machine that stopped answering says
why in its one message.

| The line says | What happened | What to do |
|---|---|---|
| cannot connect (its name is not known, connecting timed out, it refused the connection, there is no way to it from here), ssh could not connect | SSH never reached the machine | is it on and on the network; its name and port in `herdr machine list` or `board.machines` |
| its host key changed | the machine shows another key than the board saved for it | if it was set up again: `ssh-keygen -R <host> -f ~/.herdr-projects/data/known_hosts` (the board keeps its own list; with a port other than 22 the name is `'[<host>]:<port>'`, and the board's line gives it so) |
| it does not let the board in | no key that works, or it asks for a password: the board runs SSH in batch mode and cannot type one | `ssh-copy-id <machine>`, or load your key into the SSH agent the board runs under |
| herdr-projects is not found there, node is not found there, its node is too old | a login shell there does not find the program (exit 127), or finds an older version of it, which ran on Node, with no Node there or one older than 22 | the PATH of a login shell, as above; installing this version there needs no Node |
| it answered something else than the board's answer, it answered nothing, it answered with an error, it answered, but not with its tasks | the command ran and what it printed is not the board's list: an older plugin, a start-up file that prints and stops, an error | update herdr-projects there; run the test above to see all of it |
| it took too long | no answer within 20 seconds | the board asks again by itself; a start-up file that waits for something |

**The check you can run: `herdr-projects machines`.** It lists this machine and each other one: whether it answers,
its plugin version and how many tasks it has, or the reason and what to do, read by the same code as the board's
line. For this machine it runs the same login shell with a bare environment (the account, its shell and a short PATH,
which is what SSH gives), so you can see on the machine itself whether another one could ask it. `--json` gives the
same as data.

```
vm-home  this machine: a login shell (/bin/bash) finds herdr-projects 0.2.0
vm-a     answers · herdr-projects 0.2.0 · 136 tasks  (exedev@vm-a)
vm-b     does not answer: herdr-projects is not found there  (exedev@vm-b)
    A login shell on vm-b does not find `herdr-projects`.
    …
```

## What runs where

Actions on another machine's task run on that machine, over SSH. Going into one of its agents (`Enter`) first has
that machine reopen the task's space and restart an exited agent in the same conversation. In a herdr window, that
machine's herdr then puts the agent's pane in front, as `Enter` does with an agent of this machine, and the board
stays and says `vm-a: its agent is in front there. Pick vm-a in herdr's sidebar to go to it: “<its title>”; Local there brings you back here.`
herdr has no command that switches a window to another machine, so that one click in its machines sidebar is yours;
the agent is there when you do. **Local** in the sidebar (or `prefix+w` and a space of this machine) brings you back
to the board, as you left it. The board's own key does not while that machine is shown: herdr runs it there, so it
opens that machine's board. Outside a herdr client (plain SSH), and with a machine on an older plugin, your terminal
attaches to that one agent there instead (`herdr agent attach`); `ctrl+b q` returns to the board. A machine on an older plugin is
told apart by its missing version: its new fields stay blank and the board says "update herdr-projects on <machine>". Work never moves between
machines.

**Another machine's task has its chat too.** With each task someone is on, its machine sends the last few things
said in its conversation: its agent's, or its reviewer's while it is under review, read there from the program's
saved conversation. The chat and the task panel show them as they show this machine's own, under the same lines that
name who said them ([the board](board.md)). A machine on an older plugin sends none: its agent's last message still
shows, and for a reviewer the box says that the machine needs the update.

**So has its Coordinator.** While the board shows one other machine by itself, what you type goes to that machine's
Coordinator, and the chat shows that Coordinator's conversation: with its tasks the machine sends where its
Coordinator stands (`idle`, `working`, how many of your messages wait) and the last dozen things said, read there as
this machine's own are. The box shows them under the same lines (`Coordinator:`, `You:`) and scrolls back through them.
A machine with no Coordinator to run says so (what you type there is added as a task), and one on an older plugin
sends none: the box says that the machine needs the update.

**A task's work settings travel with it.** When you put an agent on another machine's task (or send that machine
words that add one), the machine you are on works out what you say for it, you and your entry for its repo, and
sends that along (kept on the task as what it carried, apart from anything else the task tracks): there it stands where that machine's own "you" would, under the task's own settings and above
the repo's file. `show <id>` there says `sent from <your machine>`. Board settings (how many agents at once, the
Watcher, the Coordinator) stay with each machine ([settings](settings.md)).

**In the herdr web UI.** The web Board shows other machines as `Alt+M` does, acts on their tasks, and opens their
agents in the web UI's own view of that machine, when the web UI has that machine as one of its PCs. The terminal
board works in the web UI's terminal view too, on this machine and on another. What works how, and what the board
says when something is missing: [the board in the herdr web UI](web-ui.md).
