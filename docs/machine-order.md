# Machine order

The board lists machines in the order of herdr's own machines sidebar (the **machines** panel on the left of the herdr
window): the machine headings in the list, the header's `all machines:` line, `Alt+M`'s round (this machine, every
machine, then each other one), the automations of every machine, and the same on the web board. Reorder the sidebar
and the board follows: another machine's at its next answer (a few seconds), this machine's own within a minute.

## Where herdr keeps that order

herdr's sidebar shows **Local** first, then the saved machines that are turned on, in the order of its list of saved
machines. That list lives on the computer the herdr window runs on (`herdr machine list --json` prints it in that
order, and says which machine the window shows now: `selected`). herdr itself has no command that changes the order:
a machine goes to the end when it is added; a plugin such as Reorder Machines, or an edit of herdr's list, moves it.

That list is often not on the machine the board runs on. With the herdr window on a laptop showing the board of a
Mac mini, the order that counts is the laptop's, and the Mac mini's own list (in the order its machines were added)
is another one.

## Which sidebar the board follows

Every machine sends its herdr list with its tasks. The board follows, in turn:

1. **The sidebar of a machine whose herdr window shows this machine now.** That machine is its own Local, so it comes
   first; this machine stands where that sidebar puts it.
2. **The one it followed before**, while that sidebar still has this machine (its window has moved on to another
   machine meanwhile). Which one that was is kept with the board's view, so it holds after the board closes; until
   that machine has answered again, the board uses this machine's own list.
3. **This machine's own herdr list**, with this machine (its Local) first.
4. **None** when no list can be read (an older herdr, or machines named by hand in `board.machines`): the board's old
   order, this machine first, then the others by name.

In another machine's list, this machine is the saved machine that connects to one of its names, in its own herdr
session: its host name (a `.local` one, as a Mac names itself, also without `.local`), or an address of one of its
network interfaces (a Tailscale address too). An SSH alias counts as the host it stands for in that machine's SSH
config (`ssh -G`, which that machine reads before it sends its list). A sidebar where this machine is not found that
way, or is turned off, is not followed: a machine the board does not know is never taken for this one. The others are matched to the board's machines by where they connect (the same host, port
and herdr session), else by name. Host names are compared whole: `build.prod.example` is never `build.dev.example`;
only a bare name matches the first part of a whole one (`mac-mini` and `mac-mini.tail1234.ts.net`), and this
machine's bare names are only the ones it has, never cut from its whole name.

## Machines the sidebar does not show

A machine the board knows that the sidebar it follows does not show (turned off there, or not saved there at all)
comes after the rest: this machine first, then by name. A machine that does not answer stays where herdr puts it, as
herdr keeps it in its sidebar too.

The web UI's Boards section lists the boards in this order too, this machine where the sidebar puts it, whatever
order the web UI keeps its PCs in ([web UI](web-ui.md)).

## A machine on an older program

A machine whose program is older than this order (the 0.3.0 release is) sends no herdr list with its tasks. The board
then asks that machine's herdr for it, over the same SSH, at each of its answers (`herdr machine list --json`), and
follows its sidebar all the same. Only an SSH alias in that list is not resolved there, so the entry that is this
machine must then name it by one of its own names or addresses; a newer program there resolves it. A machine whose
herdr gives no list (none found by a login shell there, or one older than its saved machines) is never the one
followed, and is placed as any other.
