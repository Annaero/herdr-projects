# Titles

**A title is at most 60 characters.** One limit, the same wherever a title is made or changed: a task you type
in the box, `add` and `report --title`. The number is `TITLE_MAX` in `src/store/titles.rs`, and nothing else knows it.

## Why 60

A row of the list has about that much for a title: in a 120-column window with the task panel open the list is 72
cells wide, and the mark and the time take the rest. It is also what herdr's sidebar is given, after the task's number, as the name of a
task's space. A title that fits is read whole in both places; a sentence of 100 characters filled the row and
pushed out what the row says about the task.

## A title that is too long

It is never refused, and nothing it said is lost:

- It is cut at the end of a word and ends in `…`: `After the startup dialog handoff, finish jobs wrongly mark…`.
  One long word with nowhere to cut is cut where the room ends. A title that is only too long by the full stop
  that ends it loses the full stop.
- Its full text becomes the first paragraph of the description, above what the description already said. A
  description that says it already is left as it is.
- The command says so, with the number: `proj/12: added The title was over 60 characters, so it was shortened to
  "…" and the full text was kept in the description. Rename it if a better short title exists.`

Shortening rather than refusing, everywhere: a task an agent adds for you is not lost over its title, and the
command's answer says what to do about it.

What is counted is room on the screen, the way the rows count it: a letter of most alphabets is one, a wide
character (Chinese, Japanese, Korean, an emoji) takes two cells and counts as two, so 30 of those fill a title. A
title at the limit takes 60 cells whatever it is written in: the count is made by the same measure the rows are
drawn with, so the two cannot disagree.

## Who is told

So that titles are written to fit, not cut:

- The Coordinator's rules give the limit where they say how to add a task and how to rename one.
- The board's how-to (`SKILL.md`) gives it where it says how to add a task.

## Titles from before the limit

They are left as they are: nothing rewrites the tasks already saved. The list cuts a long title to
the row with `…` as it always did, and the limit applies the next time such a title is changed (rename it and the
new one follows the rule).
