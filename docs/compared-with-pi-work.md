# Compared with pi-work

Back, in herdr's terms: the board is fresh while closed (the keeper); the board knows when and why an
agent or reviewer stopped without a note file (the turn-end hook); the task panel shows what the agent said; tokens and
context fullness (for a model whose window is known: Codex states it, Claude Code and pi do not, so those show
tokens only); the Coordinator; every chat knows the board; archive closes the space and a reply after restore resumes
the same conversation; a progress bar on your own tasks; a reply to a task with no agent starts one; a light palette.

Different by choice, or because herdr or an agent program cannot do it:

- No "2 blocked · 1 working" counter: herdr's sidebar is the closed-board view. It shows the plugin's labels only
  with the sidebar rows in herdr's config (offered at first run); otherwise a short status in the agent's name.
- No notifications: nothing pops up or sounds when a task needs you, with the board open or closed, and
  there is no bell. The board does not emit terminal status reports (OSC 7501) while closed.
- The sidebar shows only tasks with a live agent pane.
- The task panel shows the raw screen while an agent sits at a dialog that is not in its messages.
- A question does not pop open by itself: the row says so and the task panel reads it. Agents report only `blocked`, never their own progress.
- Agents the board starts may only file tasks and report themselves blocked.
- One Watcher model for everything; per task it is on or off.
- Hooks were verified on Claude Code 2.1.296, Codex 0.160.0 and pi 1.1.0, and those are the adapters' minimum
  versions: older programs run without the hook. Codex and pi were verified piece by piece (hook, file, resume), not
  through a whole delegated task.
- Other machines come from herdr only; no sub-tasks; nothing is migrated from pi-work; no chat takeover (you are in
  the agent's own terminal).
- If the keeper dies while nothing at all happens, pull-request polling waits for the next herdr event or board open.
