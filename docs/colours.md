# Colours: herdr's theme, and the box that says who you type to

## The board is in herdr's theme

Everything the board draws is in the theme herdr itself shows, so the board and herdr never look like two programs
side by side. herdr does not hand its theme to a plugin, so the board reads what herdr reads: the `[theme]` and
`[ui]` tables of this machine's `~/.config/herdr/config.toml`, resolved as herdr resolves them (the theme's name
and its other names, `auto_switch` with `dark_name` and `light_name`, `[theme.custom]`, the older `ui.accent`).

- **No theme set there is herdr's default**, Catppuccin, exactly as herdr shows it then: the board never falls back
  to the terminal's own colours while herdr beside it shows its default.
- **`auto_switch`**: the board asks its terminal whether it is light or dark, as herdr does, and takes the theme's
  light or dark one.
- **The `terminal` theme** paints with the terminal's own sixteen colours, in herdr and on the board alike.
- A theme changed in herdr shows the next time the board opens. The popup, the task panel, the reply view and the
  review page take the same theme; another machine's tasks are drawn by this board, in this theme.

The [`board.theme` setting](settings.md) says otherwise by hand: `herdr` (the default, all of the above), `dark` or
`light` (that theme's dark or light one), or one of herdr's themes by its name: `catppuccin`, `catppuccin-latte`,
`terminal`, `tokyo-night`, `tokyo-night-day`, `dracula`, `nord`, `gruvbox`, `gruvbox-light`, `one-dark`,
`one-light`, `solarized`, `solarized-light`, `kanagawa`, `kanagawa-lotus`, `rose-pine`, `rose-pine-dawn`, `vesper`.

### What cannot be known

- **herdr opened from another machine (`herdr --remote`)**: herdr's screen is painted by its client, with the
  config of the machine the client runs on, and herdr passes neither that config nor its theme on to the server the
  board runs on. When that machine's config names another theme than this one's, herdr shows that theme around a
  board in this machine's. The board cannot see it. Set `board.theme` to that theme's name
  (`herdr-superwork set board.theme nord`), or give both machines the same `[theme]`. A plain `ssh` to this machine
  with herdr started here is not this case: client and server are then on one machine, and the board matches.
- **The web Board**: the herdr web UI does not read herdr's theme; it has colours of its own (its CSS variables,
  light and dark and its palettes). The Board there is drawn with those, so it matches what herdr looks like on the
  web, not what it looks like in a terminal ([the board in the web UI](web-ui.md)).

## A status is in herdr's own colour

A task's status is drawn in the colour herdr's sidebar and agent list use for that state, whatever else the theme
does: working is herdr's `yellow` (amber), blocked or failed its `red`, done its `teal`. The mark, the group's
heading, the bar, the percent and the minutes left take it.

The board keeps a colour of its own only for what herdr has no state for:

| State | Colour | Which one |
|---|---|---|
| under review | blue | the theme's `blue` where that is told apart from all it sits beside, else the board's `#3b82f6` ([the board](board.md)) |
| ready to approve | green | the theme's `green` |
| to do | dim grey | the theme's grey for greyed-out words (`overlay0`) where that is told apart from plain text, the green, the blue and the background; else another grey. With the terminal's own colours it is the terminal's bright black, since its white is most terminals' text colour |

The three are told apart from each other and from the plain text colour in every built-in theme (the tests measure
it). "To do" was once drawn in a colour that, with the terminal's own colours, looked like plain text: it is a dim
grey now, in the list (the heading and the `○` mark) and in the box alike. While the board runs its own check the
mark is a plain light grey, the theme's `subtext0` ([the check's progress](check-progress.md)).

## The box says who you type to

The text box sends either to the Coordinator or to the selected task's agent. Its frame (the rounded box, or the two
rules of the plain one) and its prompt mark `❯` say which, at a glance:

| The box sends to | Colour of its frame and `❯` |
|---|---|
| the Coordinator (also: a new task, find, a task whose message goes to the Coordinator or into its description) | the theme's plain text colour |
| a task's agent, or a task your message starts an agent on | that task's status colour, the very one its mark has in the list |

So an agent's box also says how its task is doing: amber while the agent works, red when it needs you, green when
it is ready to approve, blue under review, teal when done, dim grey for a task nobody started (and for an archived
one, which is read-only). It changes with the status, also while something is typed. It is the same wherever there
is such a box: under the list, in the reply view, under the task panel and full screen, in the popup, for this
machine's tasks and another machine's, and on the web Board, where the frame of the text field takes the colour.

**Colour is never the only clue.** The line above the box names who you talk to, the grey words in the empty box
say it (`Send message to Coordinator`, `Send message to Agent`, `your message starts an agent on it`), and while you
type the hint line does (`enter send to the Coordinator`, `enter send to this task's agent`). With `NO_COLOR` the
board draws no colour at all and reads as it always did; each state has a mark of its own too.

The box and the mark are never two colours. So while the board runs its own check on a task, whose mark is then a
plain light grey ([the check's progress](check-progress.md)), that task's agent's box is that grey too: near the
plain text colour, and the same as it on the web Board and with the terminal's own colours on a dark terminal. For
that while the words are what tells it from the Coordinator's box.

On the web Board, done is a teal of the board's own: the web UI has one colour for done, and that one is the green of
"ready to approve" there, so the two would be one colour.
