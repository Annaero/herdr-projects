# A turn cut off by the provider

A turn can end because the model's provider failed, not because the agent
finished: the model is at capacity, the servers are overloaded, a rate limit, a dropped connection. The agent's own
saved conversation records that error for the turn (Codex: the `error` on `task_complete`; Claude Code: an entry
with `isApiErrorMessage`; pi: a message with `stopReason` `error`), and the board reads it there. Such a turn is
neither finished nor failed:

- *The reviewer.* The board closes it, waits, and starts the review again: after 1, 2, 4 and 8 minutes, so five
  tries over fifteen minutes. Meanwhile the row says why and when (`reviewer's model is at capacity, trying again in
  2m`). A review that was cut off is not a review: it uses up none of the task's `rounds`, has no number (the next
  one that runs is still the "1st") and is not in the list of reviews. If the last try is cut off too, the task
  fails with the real reason and the provider's own words (`Review failed: the reviewer's model is at capacity,
  still after 5 tries over 15m. Its error: Selected model is at capacity…`), and `Ctrl+Y` reviews again.
- *The working agent.* The same waits, and then the board tells the agent to carry on where it left off, as a turn
  of the plugin's own: counters and an approved merge survive it. The row stays under `working` and says
  `agent's connection dropped, trying again in 2m`. The cut-off is saved under the wait, so a reply, `Ctrl+R` or
  `Ctrl+Y` does it right away, and stopping the task ends the wait. After the last try the task is "Agent stopped"
  with the real reason, as before. A reply starts the count again. An agent whose program exited with the error is started again in
  the same conversation and told the same.

Errors that waiting cannot fix are never retried and go to you at once, as before: a login, a model that
does not exist or is not offered, a usage limit, a request the provider refuses, and any error the board does not
recognise. A reviewer that hits one fails the review with "the reviewer stopped:" and the error; that too is no
review on the list. The agent program's own code for the error decides where it gives one (Codex's
`codex_error_info`, Claude Code's `error` and HTTP status); otherwise its words do.

The waits are fixed. What was seen in real conversation files is in [checked-on-herdr.md](checked-on-herdr.md); the
code is `providerError` in `src/agents/provider-error.js` (which errors pass), `src/store/retries.js` (the wait) and
`src/finish/turn-ended.js` and `src/finish/review.js` (the retries); the tests are `test/retry.test.js`, on recorded endings in `test/fixtures/endings`.
