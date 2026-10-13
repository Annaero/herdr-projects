# Other machines

Every machine keeps its own tasks. `Alt+M` goes round: this machine, every machine, then each one by itself.
Machines are found through herdr only: the ones you added with `herdr machine add` (or name them in `board.machines`);
with none, `Alt+M` says so. There is no Tailscale discovery. The plugin's own commands on another machine still
travel over the plugin's own SSH connection, because herdr has no command that runs a plugin's commands there.
Each one needs, once:

```sh
# Node 22.19+, git, gh, flock, the agent programs it will run, then:
git clone <this repository> && cd herdr-superwork && npm install
npm link
herdr plugin link "$PWD"
```

Actions on another machine's task run on that machine, over SSH. Going into one of its agents attaches your
terminal to that one agent there (`herdr agent attach`), after that machine has reopened the task's space and
restarted an exited agent in the same conversation; `ctrl+b q` returns to the board. A machine on an older plugin is
told apart by its missing version: its new fields stay blank and the board says "update herdr-superwork on <machine>". Work never moves between
machines.

**A task's work settings travel with it.** When you put an agent on another machine's task (or send that machine
words that add one), the machine you are on works out what you say for it, you and your entry for its repo, and
sends that along (kept on the task as what it carried, apart from anything else the task tracks): there it stands where that machine's own "you" would, under the task's own settings and above
the repo's file. `show <id>` there says `sent from <your machine>`. Board settings (how many agents at once, the
Watcher, the Coordinator) stay with each machine ([settings](settings.md)).
