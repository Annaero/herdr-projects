# Titles

**A title is at most 60 characters.** One limit, the same wherever a title is made or changed: a task you type
in the box, `add`, `report --title`, an agent's `suggest`, a reviewer's finding that becomes a suggestion, and the
task made when you accept one. The number is `TITLE_MAX` in `src/store/titles.js`, and nothing else knows it.

## Why 60

A row of the list has about that much for a title: in a 120-column window with the task panel open the list is 72
cells wide, and the mark and the time take the rest. It is also what herdr's sidebar is given as the label of a
task's space. A title that fits is read whole in both places; a sentence of 100 characters filled the row and
pushed out what the row says about the task.

## A title that is too long

It is never refused, and nothing it said is lost:

- It is cut at the end of a word and ends in `…`: `After the startup dialog handoff, finish jobs wrongly mark…`.
  One long word with nowhere to cut is cut where the room ends. A title that is only too long by the full stop
  that ends it loses the full stop.
- Its full text becomes the first paragraph of the description, above what the description already said. A
  description that says it already is left as it is.
- The command says so, with the number: `proj/12: filed The title was over 60 characters, so it was shortened to
  "…" and the full text was kept in the description. Rename it if a better short title exists.`

Shortening rather than refusing, everywhere, because one path cannot refuse: a reviewer's finding is saved by the
board with nobody there to ask again. So every path does the same thing.

What is counted is room on the screen, the way the rows count it: a letter of most alphabets is one, a wide
character (Chinese, Japanese, Korean, an emoji) takes two cells and counts as two, so 30 of those fill a title. A
title at the limit takes 60 cells whatever it is written in: the count is made by the same measure the rows are
drawn with, so the two cannot disagree. On a Node older than 22.12 (older than the board's screen library supports)
that measure cannot be loaded where titles are saved. The count used there is never too low, so the title still
fits: an emoji and every character from U+1100 up counts as two, which can cut a title of narrow characters from
that range a little sooner than needed.

## Who is told

So that titles are written to fit, not cut:

- The Coordinator's rules give the limit where they say how to file a task and how to rename one.
- An agent's rules give it where they say how to suggest a task, and so does the board's how-to (`SKILL.md`).
- The reviewer is asked for a `title` on each finding beside its `subject`: the sentence says what is wrong, the
  title is its name on the board in a few words. A [suggestion](suggestions.md) made from a finding takes that
  title; a finding without one gets its sentence, shortened as above.

## What a short title stands for

A task or a suggestion whose title is a short form of a longer sentence keeps the sentence too, as its `subject`,
and as the first line of what it says. Whether the board
[knows the work already](suggestions.md#the-same-thing-is-suggested-once) is decided by that sentence, not by the
few words shown. The same fault under another short title is still one suggestion; and two sentences that start
with the same 60 characters and end differently (`… before the user responds`, `… after the user responds`) are two
things, though their shortened titles read the same. A task made from a suggestion carries the sentence on, and a
rename to a title that fits drops it. The sentence is kept whole, however long it is.

## Titles from before the limit

They are left as they are: nothing rewrites the tasks and suggestions already saved. The list cuts a long title to
the row with `…` as it always did, and the limit applies the next time such a title is changed (rename it and the
new one follows the rule). An old suggestion with a long title, accepted now, becomes a task with a shortened one.
