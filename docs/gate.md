# The gate

The reviewer describes; the board decides. The reviewer gives no score and no merge advice. Every round it answers
one fixed question, "Does the change do what the task asked?" (`meets`), and lists its findings. Each finding has a
severity, a subject, where it is, a proof (what the reviewer actually ran or saw) and whether it was there before
the task (`preexisting`). The severity says what the fault does:

| Severity | Means |
| --- | --- |
| `critical` | the work does not do what was asked, breaks something that worked, or risks security or data loss |
| `major` | a real fault in an unusual case; a claim that is not proven (a fix not shown to work, a test that cannot catch its bug); a document that states something false |
| `minor` | correct but could be better: wording, naming, a small inaccuracy, a narrow gap |
| `trivial` | a note; nothing to do |

The board then applies fixed rules to what came back:

- `meets: false` always counts as a critical finding, even with an empty list.
- A critical finding with an empty proof is treated as major.
- A pre-existing finding never sends the work back, and never becomes a task by itself. Each is a
  [suggestion](suggestions.md) on the task, once, however many rounds or other tasks' reviews name it: you make it
  a task or dismiss it.
- The work **passes** when no finding of its own sits at or above the `gate` setting (`major` by default). A pass
  is what "may merge" means everywhere: a repo with `"land": "auto"` merges it, an approved merge that was repaired
  goes through, and the board says `Pass`.
- A **fail** goes back to the agent by itself, at most `rounds` times: the findings at or above the gate as
  required, the rest as optional. When the cap is reached and it still fails, it stops and waits for you.
- From the second round on the reviewer gets the earlier findings and only checks that each is fixed and that the
  fixes broke nothing. It may add a new finding only if it is critical, with proof; anything smaller it notices
  late is left out (a pre-existing fault is still suggested). A reply from you starts a full review again.
- `gate off` sends nothing back by itself: findings wait for you (`Ctrl+R` sends them). The result shown and an
  automatic merge are then judged at `major`.

Findings below the gate still show on the review page, in the task panel and in a comment on the pull request,
marked as not required.

An error, a usage limit, a cut-off or a refusal is saved as "Agent stopped" with the real text (an error of the
provider that passes by itself is retried first: [A turn cut off by the provider](provider-errors.md)); a login error makes
the task "Needs a login", and that comes first: older failure details are not sent and pull-request feedback does not
wake the agent until you have logged in and then replied, pressed `Ctrl+R` or typed in the agent's terminal. A turn
only blocks on you when the agent ran `report … --state blocked`; a final message that merely ends in a question
goes on to check and review, and you still approve at the end.
