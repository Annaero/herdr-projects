# What to learn from Capy and the other coding agents (task 109)

A one-off report, written on 13 October 2026. Nothing in the product changed. Every recommendation below is a
suggestion on task 109 for you to accept or dismiss; none was built and none was added as a task.

## The short version

herdr-superwork is already stricter than most of what is out there on the part that matters most: a fixed check, an
adversarial reviewer with proof, a gate, one reviewed commit that merges, and main kept current by the board. None of
the tools below does all of that. Where they are ahead is around the edges: they keep going when a limit is hit, they
show real progress instead of a guess, they let you try the running result with one click, and they waste fewer
review rounds on findings that are wrong.

The ranked list:

| # | Recommendation | Kind | Work | How sure |
|---|---|---|---|---|
| 1 | [Carry on by itself when a usage limit resets](#1-carry-on-by-itself-when-a-usage-limit-resets) | change | small | high |
| 2 | [Progress from the agent's own to-do list, not a guess](#2-progress-from-the-agents-own-to-do-list-not-a-guess) | change, and remove | medium | fairly high |
| 3 | [Let the agent contest a finding, and let you dismiss one](#3-let-the-agent-contest-a-finding-and-let-you-dismiss-one) | add | medium | fairly high |
| 4 | [Say when an agent has gone quiet](#4-say-when-an-agent-has-gone-quiet) | add | small | medium |
| 5 | [A private link to a task's running app](#5-a-private-link-to-a-tasks-running-app) | add | medium | fairly high |
| 6 | [Remove what is only there for older versions](#6-remove-what-is-only-there-for-older-versions) | remove | small to medium | fairly high |
| 7 | [A task that waits for another task](#7-a-task-that-waits-for-another-task) | add | medium | medium |
| 8 | [Tasks that come back on a schedule](#8-tasks-that-come-back-on-a-schedule) | add | medium | medium to low |
| 9 | [A sandbox choice for agents](#9-a-sandbox-choice-for-agents) | change | medium to large | medium |
| 10 | [A token limit per task](#10-a-token-limit-per-task) | add | small | medium to low |
| 11 | [Plan first, for big tasks](#11-plan-first-for-big-tasks) | add | small to medium | medium to low |
| 12 | [The change itself on the review page](#12-the-change-itself-on-the-review-page) | add | small to medium | medium |
| 13 | [Merge several green tasks in one go](#13-merge-several-green-tasks-in-one-go) | change | large | low |

After the list: [what is popular and we should not copy](#popular-and-not-for-us),
[each tool question by question](#each-tool-question-by-question), and
[what we already have](#what-we-already-have-so-it-is-not-suggested).

## Who was looked at, and why those

The list was made from the web on 13 October 2026, not from memory. These are all the sources it came from, and
what each was used for:

| Source | Opened and read? | Used for |
|---|---|---|
| [Ramp: coding agents by companies that pay for them, October 2026](https://ramp.com/vendors/categories/code-ai) | search summary only | Claude Code 87%, Codex 40%, Cursor 35%; Codex "the fastest growing vendor" |
| [Morph: scored leaderboard of coding agents, 6 October 2026](https://www.morphllm.com/best-ai-coding-agents-2026) | search summary only | which coding agents lead the benchmarks (Claude Code, Codex) |
| [Pinggy: top five CLI coding agents, 10 October 2026](https://pinggy.io/blog/top_cli_based_ai_coding_agents/) | search summary only | OpenCode as the most starred open coding agent |
| [OpenAlternative: thirteen orchestrators compared, updated 13 September 2026](https://openalternative.co/blog/best-ai-coding-agent-orchestrators) | read | the names of the orchestrators and their star counts in September |
| [gittrend: top trending GitHub repos, October 2026](https://gittrend.io/monthly/2026-10) | read | what is trending now: Orca is #23 with 90.8k stars, OpenRig #57 with 7.3k |
| Round-ups by [Tembo](https://www.tembo.io/blog/ai-agent-orchestration-tools), [Verdent](https://www.verdent.ai/guides/multi-agent-coding-tools), [amux](https://amux.io/blog/best-multi-agent-orchestrators-2026/), [Parallel Code](https://parallelcode.app/blog/multi-agent-coding-tools-2026/) and [Nimbalyst](https://nimbalyst.com/blog/best-git-worktree-tools-ai-coding-2026/) | search summary only | more names (Conductor, Vibe Kanban, Claude Squad). Each is written by a tool's maker, so none was used to rank anything |

"Search summary only" means the page's figures were read from the search engine's summary of it and the page itself
was not opened: take those numbers as a pointer, not as checked. No source measures which tool is rising fastest
this month, so this report does not say so of any. Where the table below gives a star count or a place on a list,
it names the list it is from. Gas Town, Devin, Amp
and Factory are in neither list: they are here because they are the known examples of their kind, which is a
judgement and not a measurement.

| Tool | Kind | Why it is here | Read |
|---|---|---|---|
| [Capy](https://capy.ai/) | cloud orchestrator | asked for by name | its docs: [threads](https://docs.capy.ai/quickstart), [review](https://docs.capy.ai/review), [pull requests](https://docs.capy.ai/pull-requests), [environment](https://docs.capy.ai/environment), [models](https://docs.capy.ai/models-and-pricing), [automations](https://docs.capy.ai/automations) |
| [Claude Code](https://code.claude.com/docs/en/agent-teams) | coding agent | most used ([87% of companies that pay for one, says Ramp](https://ramp.com/vendors/categories/code-ai)) | the agent teams page, in full |
| [Codex](https://learn.chatgpt.com/docs/cloud) | coding agent | second most used; Ramp calls it the fastest growing vendor | the cloud page and the [app page](https://learn.chatgpt.com/docs/app) |
| [Cursor](https://cursor.com/docs/cloud-agent) | coding agent | third most used | the cloud agents page |
| [Devin](https://docs.devin.ai/get-started/devin-intro) | cloud agent | the known "send it away" agent | the intro, [session tools](https://docs.devin.ai/work-with-devin/devin-session-tools), [confidence ratings](https://cognition.com/blog/devin-2-1) |
| [Amp](https://ampcode.com/manual) | coding agent | in OpenAlternative's thirteen; strong opinions on what to leave out | the manual's first page |
| [Factory](https://docs.factory.com/cli/features/missions) | cloud agent | "Missions": one goal split into up to 500 features | its Missions page; [Sacra](https://sacra.com/research/factory) second-hand |
| [Orca](https://www.onorca.dev) | orchestrator | the most starred orchestrator in both lists: 66k in September (OpenAlternative), 90.8k and #23 in October (gittrend) | home page |
| [Conductor](https://www.conductor.build/docs/concepts/workflow) | orchestrator | named in the round-ups as the polished one for Claude Code (closed source, so no star count) | docs: workflow |
| [Vibe Kanban](https://vibekanban.com/docs/llms.txt) | orchestrator, a board | the nearest thing to our board | the list of its doc pages |
| [T3 Code](https://t3.codes) | orchestrator | 22k stars in September (OpenAlternative), 24k on its own page | home page |
| [Superset](https://superset.sh) | orchestrator | 14k stars in September (OpenAlternative) | home page |
| [Paseo](https://paseo.sh) | orchestrator, a daemon | 17k stars in September (OpenAlternative); runs with no window open, as our keeper does | home page |
| [Omnigent](https://omnigent.ai) | meta-harness | 9.8k stars in September (OpenAlternative); the only one about rules and limits | home page |
| [Gas Town](https://github.com/steveyegge/gastown) | meta-harness | the one that merges by itself, with roles for watching agents (18.3k stars on its page) | its README |
| [OpenRig](https://github.com/mvschwarz/openrig) | meta-harness | on gittrend's October list (#57, 7.3k stars); names herdr as a way to show its agents | its README |
| [GitHub Copilot cloud agent and Agent HQ](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent) | coding agent, and a meta-harness | GitHub's own agent, and its control room for other makers' agents | the docs page; Agent HQ from [news](https://venturebeat.com/ai/githubs-agent-hq-aims-to-solve-enterprises-biggest-ai-coding-problem-too) only |

Named in the round-ups and not read further: OpenCode, Emdash, Jean, Synara, Claude Squad, dmux, pi.

**How far to trust this.** Each tool was read from its own pages, which sell it. Nothing was installed or tried.
Where a page did not say how something works, this report says "not stated" and does not guess. Star counts
differ between sources, so each is given with where it is from.

## How they compare with us, question by question

The short form first; [each tool by itself](#each-tool-question-by-question) is further down.

| Question | What the others do | What we do |
|---|---|---|
| How work is given | A chat per task (Capy, Cursor, Codex, T3), a board of issues (Vibe Kanban, Orca), a boss agent you talk to (Gas Town's Mayor, Capy's Captain); also from Slack, Linear, GitHub issues, a schedule or a webhook (Capy, Cursor, Paseo, Superset) | You type it, or tell the Coordinator. Nothing else adds a task |
| How it is split | A boss agent splits it and hands the parts to workers (Capy, Devin, Factory, Gas Town, Claude's agent teams, with tasks that wait for each other) | The Coordinator adds several tasks; no task waits for another |
| Where agents run | A cloud machine each (Capy, Cursor, Codex, Devin, Amp), or a git worktree each on your machine (Orca, Conductor, Vibe Kanban, T3, Superset, Paseo) | A herdr worktree space each, with full access |
| How progress shows | The agent's own to-do list, its commands and the growing change (Capy); a one-line status and the time (Orca); screenshots and video (Cursor) | A "doing now" line and a guessed percent and minutes left; real counts while the check runs |
| How work is checked | A review agent that comments on the pull request (Capy, Cursor, Devin, Conductor); the tests in the cloud; you reading the change | The repo's check, then an adversarial reviewer with proof, then a gate with fixed rules |
| How it is merged | You merge the pull request. Only Gas Town merges by itself, in batches | You say yes, or it merges by itself when green, one task at a time, only the reviewed commit |
| How you are asked | Three states (working, waiting on something outside, needs you) and a phone notification (Capy, Amp, Orca, Paseo) | `needs you` on the board and in herdr's sidebar; no notification, by choice |
| Many agents, many machines | Cloud machines without end (Capy), other machines over SSH (Orca, Superset), a daemon with a phone app (Paseo) | Four at once by default; other machines through herdr |
| Models and settings | A model per chat, cheaper ones for simple parts (Capy, Amp), spending limits (Omnigent, Cursor, Devin) | Agent, model and effort per task; tokens shown; no limit |
| The interface | A desktop or web app with a list on the left and the chat and the change on the right; most have a phone app | A terminal board inside herdr |

## The recommendations

### 1. Carry on by itself when a usage limit resets

- **From:** [Capy](https://docs.capy.ai/models-and-pricing) has a setting for what happens when a subscription runs
  out ("Ask me", "Ask before Capy credits", "Keep going"). [Orca](https://www.onorca.dev) shows how much of each
  subscription is used and swaps accounts.
- **What:** Today a usage limit goes to you at once and the task stops ([provider errors](../provider-errors.md)).
  The agent's error says when the limit resets. The board could keep the task under `working` with `usage limit,
  carries on at 15:00`, and tell the agent to carry on at that time, exactly as it already does for a dropped
  connection. Queued tasks for that agent kind would wait for the same moment instead of starting and failing.
- **Why:** With several agents on one subscription this is the stop you hit most, often at night. Today every
  stopped task waits for you to press a key, for something that needs no decision.
- **Work:** Small. The waiting and the "carry on" turn exist; what is new is reading the reset time and a longer wait.
- **How sure:** High that it helps. Medium that the reset time can always be read: where it cannot, ask as today.
- **Where it would not fit:** Switching to another agent program in the middle of a task, which
  [Synara](https://www.trysynara.com) is listed as doing, is not recommended: it was not read closely, and a
  conversation rarely moves whole from one program to another.

### 2. Progress from the agent's own to-do list, not a guess

- **From:** [Capy](https://docs.capy.ai/quickstart) shows the agent's "todo list in the thread pane, the commands it
  runs, the diff as it grows". Claude's [agent teams](https://code.claude.com/docs/en/agent-teams) and Devin's
  progress tab do the same. No page read for this report shows a guessed percent or minutes left for an agent's work.
- **What:** Claude Code and Codex both keep a list of steps and tick them off, and it is in the saved conversation
  the board already reads. Show `step 3 of 7` and the step's own words as the "doing now" line, and build the bar
  from that count. Keep the Watcher only for an agent that keeps no list. Drop the minutes left for agents: keep
  them where they are measured (the check).
- **Why:** The board already says of the check that "nothing shown is a guess". The agent's row is the opposite: a
  small model reads thirty lines of screen and names a percent, and minutes are worked out from it. A real count is
  truer, costs no model call, and moves the moment a step is done.
- **Work:** Medium: read the list for two agent programs, a fallback, and the words in four places.
- **How sure:** Fairly high. The risk: agents write uneven lists (two steps, or twenty), so the bar is a count and
  not a measure of time. That is still more honest than a guess.
- **Where it would not fit:** Whether pi keeps such a list was not checked; an agent with none stays on the Watcher.

### 3. Let the agent contest a finding, and let you dismiss one

- **From:** [Capy's review](https://docs.capy.ai/review): the working agent "marks false positives irrelevant",
  findings marked so "are never re-flagged", and "you can override any triage decision".
- **What:** Today a failed review goes back and the agent can only fix. Give it a second answer for each finding:
  "this is not a fault, because …". The next reviewer judges the reason: it holds, and the finding is closed for
  good; it does not, and the finding stands. And give you one key on the full-screen review to dismiss a single
  finding, so the rest still goes back.
- **Why:** An adversarial reviewer is sometimes wrong. An agent that cannot say so "fixes" what was right, which
  costs a round and can make the work worse. Your only tool today is to approve everything as it is.
- **Work:** Medium: the agent's rules, the reviewer's brief, one more state for a finding, one key.
- **How sure:** Fairly high that it saves rounds. The risk is an agent that contests everything; the reviewer
  deciding, not the agent, guards against that.

### 4. Say when an agent has gone quiet

- **From:** [Gas Town](https://github.com/steveyegge/gastown) has a role for it (the Witness) and a list of problem
  agents: stalled, dead, "hooked work with no progress for a long time", each with a key to nudge it.
- **What:** The board already does this for the check (`the check stands still · nothing finished for 13m`). Do
  the same for an agent that herdr calls working while its screen and its saved conversation have not moved for,
  say, twenty minutes: the row says `quiet for 24m`, in its own colour. No automatic nudge at first.
- **Why:** A hung command or a dialog nobody saw looks exactly like work today. With four agents you notice; with
  more you do not.
- **Work:** Small: the board already compares screens for the Watcher.
- **How sure:** Medium. A long build is also quiet, so the wording must not cry wolf. Gas Town's three layers of
  watchdogs are far more than we need.

### 5. A private link to a task's running app

- **From:** [Capy](https://docs.capy.ai/environment) (a start-up entry with a port is "published as a preview"),
  [Conductor](https://www.conductor.build/docs/concepts/workflow) (a Run button), Vibe Kanban (a built-in preview
  browser), [Cursor](https://cursor.com/docs/cloud-agent) (you take over the agent's desktop to try it).
- **What:** One more line in a repo's `.herdr-superwork.json`: `"run": "npm run dev"` and its port. One key on a
  task starts it in that task's worktree, in a tab of its own, and shares it privately on your tailnet, the way
  review evidence is shared already. The link is in the task panel; it stops when the task is done.
- **Why:** You work from other devices. Today, trying a task's result before saying yes means going into its
  worktree and starting things by hand. The reviewer's screenshots show what the reviewer chose to show.
- **Work:** Medium: the setting, a tab, a free port per task, the link, the clean-up.
- **How sure:** Fairly high for repos with something to look at; no use for the others (this repo is one of them).
- **Where it would not fit:** Capy's snapshots and machine sizes solve a cloud problem we do not have.

### 6. Remove what is only there for older versions

- **From:** [Amp](https://ampcode.com/manual) says it plainly: it removes what the team does not use and makes "no
  legacy or backward-compatibility commitments".
- **What:** The board has one user and one install, and carries a fair amount of code for its own past: the
  `reviewAuto`, `helper`, `helperModel` and `bell` settings still read; `"land": "auto"` beside `autoMerge`;
  reviews "from before the gate" with their score and advice (in four files); `src/finish/old-holds.js`; the move
  of the Coordinator from its old space; a reviewer left as a pane by an older version; GitHub's auto-merge
  switched off for old tasks. Check once that nothing on the board still needs each, then remove them and their
  words in the docs.
- **Why:** Each is a branch every later change has to keep working, and a paragraph the docs spend on something
  that cannot happen again (`docs/gate.md` has a long one about holds left by an older version).
- **Work:** Small to medium, in several small pieces.
- **How sure:** Fairly high. One real cost: the oldest done tasks were reviewed before the gate and would show
  their old review without its score, or not at all.

### 7. A task that waits for another task

- **From:** Claude's [agent teams](https://code.claude.com/docs/en/agent-teams) ("a pending task with unresolved
  dependencies cannot be claimed until those dependencies are completed"),
  [Capy's stacked pull requests](https://docs.capy.ai/pull-requests), Gas Town's convoys.
- **What:** `delegate 13 --after 12`, or "do this once that one is merged" to the Coordinator. The task sits in
  `to do` as `waits for proj/12` and starts by itself, from the new main, when 12 is merged.
- **Why:** Work that builds on other work is delegated in order by hand today, or started too early and then
  repaired by conflict. It also lets the Coordinator split one request into steps safely.
- **Work:** Medium.
- **How sure:** Medium. It is the simple form on purpose: no stacked pull requests (a task on top of an unmerged
  one), which would break "main is where the task lands" and the rule that only a reviewed commit merges.

### 8. Tasks that come back on a schedule

- **From:** [Capy's automations](https://docs.capy.ai/automations), Superset, Paseo, Codex and Cursor all have
  them: "nightly dependency check", "fix docs after a merge", "fix main when its tests fail".
- **What:** A task with a rule: every night, or every Monday. When it is due, a fresh copy is added and delegated;
  the keeper already runs with the board closed.
- **Why:** Chores nobody types: dependency updates, a weekly look for dead code, the docs check.
- **Work:** Medium.
- **How sure:** Medium to low. "Nothing adds a task by itself" is a rule here, and a schedule bends it, even though
  you set it. It also spends your allowance while you are away. Triggers from Slack, webhooks or GitHub events are
  for teams and are not recommended at all.

### 9. A sandbox choice for agents

- **From:** [Omnigent](https://omnigent.ai) (a sandbox that limits files and network and keeps credentials away
  from the agent, so that "YOLO mode" is safer); Capy, Cursor, Codex and Devin run every agent on its own machine;
  Capy's reviewer has "read-only credentials, pushes disabled".
- **What:** Agents run with full access as you, and the docs say the rules are "guidance, not a sandbox". Add a
  setting that starts an agent in its own program's sandbox (both Claude Code and Codex have one): it may write
  only in its worktree and the task's folder. And start the reviewer that way always, since it should change nothing.
- **Why:** A wrong `rm`, or a web page that tells an agent what to do, reaches everything you can reach.
- **Work:** Medium to large. A worktree's git data lives in the main checkout, and the board's own commands write
  to its data folder, so the allowed places have to be worked out and tried per agent program.
- **How sure:** Medium. On a throw-away machine like this one the gain is small; on your own laptop it is large.
  So a setting, not a new default.

### 10. A token limit per task

- **From:** Omnigent's spend caps and its "detect tool-call retry loops";
  [Cursor](https://cursor.com/docs/cloud-agent) asks for a spend limit before the first cloud agent; Capy shows
  each thread's cost.
- **What:** The board already counts a task's tokens. Add a setting, per task too: past so many tokens the agent
  is stopped and the task asks you (`used 12M tokens, carry on?`).
- **Why:** An agent in a loop burns the allowance all the others need, and nothing stops it today.
- **Work:** Small.
- **How sure:** Medium to low: it has not been shown to happen here, and recommendation 4 catches the other kind of
  stuck. Showing cost in money is not recommended: on a subscription it is a made-up number.

### 11. Plan first, for big tasks

- **From:** Claude's agent teams (a teammate plans read-only until its plan is approved), Vibe Kanban's planning
  profiles, [Devin](https://cognition.com/blog/devin-2-1) (it says how sure it is after planning and asks when it
  is not), Factory's milestones.
- **What:** A per-task setting. The agent first writes what it will do and stops; you read it in the task panel
  and say yes or reply. Then it works as usual.
- **Why:** A wrong idea of the task is found today only after the work, the check and a review.
- **Work:** Small to medium.
- **How sure:** Medium to low. It adds a stop that needs you, the very thing the board tries to have fewer of. Off
  by default, and worth it only for large tasks.

### 12. The change itself on the review page

- **From:** Orca ("drop markdown comments on any diff line, batch them, ship them back to the agent"), Conductor,
  Vibe Kanban, Superset and T3 Code all put the change beside the chat.
- **What:** The review page lists findings and evidence but not the change. Add it, file by file, with each finding
  shown at its line. Read-only.
- **Why:** You approve from a phone. Today the change is one more place to go (GitHub).
- **Work:** Small to medium.
- **How sure:** Medium. Comments on lines, the popular part, are **not** recommended: a comment on the pull request
  on GitHub already wakes the task's agent, so that road exists.

### 13. Merge several green tasks in one go

- **From:** Gas Town's Refinery: it takes all the finished work together, runs the tests once on the lot, merges
  if they pass, and if they fail finds the one that broke them.
- **What:** Our line merges one task, then brings the next up to date and runs the check again, and so on.
- **Why:** With ten green tasks and a check of a few minutes, the line takes half an hour.
- **Work:** Large, in the most delicate code there is.
- **How sure:** Low. "Only the reviewed commit merges" would no longer hold as plainly, and the check here now
  answers at once for code it has seen. Worth it only if the line is ever really the wait.

## Popular, and not for us

- **A boss agent that spawns workers that spawn workers** (Capy's Captain, Devin's child sessions, Factory's
  Missions, Gas Town). Claude's own page warns that it costs far more, that the lead "decides the team is finished
  before all tasks are complete" and that two workers on one file overwrite each other. Our tasks are each
  checked, reviewed and merged on their own, which is the safer form. Task 2 on the board already asks about scale.
- **Phone notifications** (Orca, Amp, Paseo, T3, Cursor). The most common feature of all, and removed here on
  purpose (task 8). Nothing new argues against that choice.
- **A phone or web app.** Task 108 is already on the board.
- **One prompt to five agents, keep the best** (Orca, Conductor). Task 1 is already on the board. Their pages
  say little about how the winner is picked, which is the hard part.
- **A cloud machine per agent, snapshots, machine sizes.** They fix the cloud's slow start. herdr and worktrees
  have none.
- **Tasks from Slack, Linear or a webhook.** Team features. The Coordinator can already read a GitHub issue with
  `gh` and add it when you say so.
- **Review rules in the repo** (Capy reads a `## Reviews` part of `AGENTS.md`). Our reviewer is an ordinary agent
  in the repo and reads `AGENTS.md` anyway.
- **Voice, checkpoints and roll-back, a built-in browser, a marketplace of plugins.** Either herdr's business, or
  git's.

## Each tool, question by question

The same nine questions for every tool looked at, answered only from the pages named in the table at the top.
"Not stated" means those pages do not say; it does not mean the tool cannot do it.

The questions: **Given** (how work is given and split into tasks), **Runs** (how agents are started and kept
apart), **Progress** (how it is shown), **Checked** (how work is reviewed and checked), **Merged**, **You** (how
you stay in control and are asked), **Scale** (many agents and machines), **Models** (how settings and models are
chosen), **Looks** (the interface).

### Capy

- **Given:** A chat ("thread") per task, started from the web or desktop app, by naming it in Slack, from a Linear
  issue or over the API; also from a schedule, a webhook or a GitHub or Slack event. "Use one thread per task." A
  thread's agent may start sub-agents of its own; work on top of an unmerged pull request becomes a stacked one.
- **Runs:** It "boots a machine with your repos checked out": a cloud machine per thread, built from the repo's
  setup scripts, restored from a snapshot in one or two seconds. Its welcome page also says agents can run on your
  laptop with your own subscriptions; how is not stated.
- **Progress:** The agent's to-do list, the commands it runs and the change as it grows. A thread is `active`,
  `waiting` (on something outside) or `needs attention`.
- **Checked:** A review agent on the pull request (off, once, or at every push), on a machine of its own with
  read-only access. A finding has a category, a severity and a confidence. A failed CI check wakes the thread,
  which fixes and pushes again; the thread sorts the findings and fixes the severe ones.
- **Merged:** You merge the pull request; the merge wakes the thread to wrap up. Merging by itself: not stated.
- **You:** It stops for you when it is done or "genuinely blocked". A new message steers it at its next step, or
  waits until it finishes. You can overrule how any finding was sorted.
- **Scale:** One machine per thread, billed by the hour. How many at once: its listing says 25, its own comparison
  page says no limit.
- **Models:** A model, an effort and a fast mode per thread; sub-agents may be given cheaper or stronger ones. Your
  own subscriptions or keys first, then Capy's credits, with a setting for what happens when one runs out.
- **Looks:** A web and desktop app: the thread, with a pane beside it for the to-do list, the machine and the pull
  request.

### Claude Code (agent teams)

- **Given:** You tell one session, the lead, in plain words. It makes a shared list of tasks, which may wait for
  each other, and teammates take them or are given them.
- **Runs:** Each teammate is a Claude Code session of its own with its own context, on your machine. The page
  gives them no folder of their own: "two teammates editing the same file leads to overwrites."
- **Progress:** A panel of teammates under the prompt, the task list on a key, or one pane per teammate in tmux.
- **Checked:** Nothing built in. Hooks can refuse a task marked done or a teammate going idle; you can ask for
  reviewer teammates.
- **Merged:** Not stated.
- **You:** You can talk to any teammate. Their permission questions come up in the lead's session. A teammate's
  plan is approved by the lead's session itself, without you.
- **Scale:** One machine, one team per session, no teams inside teams; three to five teammates advised. The page
  warns of far higher token use, and of a lead that decides too early that all is done.
- **Models:** A model per teammate, named in your words or in a role's definition; the effort is the lead's.
- **Looks:** The terminal. Experimental and off by default.

### Codex

- **Given:** A chat per task, from the app, the CLI or the web; scheduled tasks. Splitting: not stated.
- **Runs:** In the cloud, each task in a workspace of its own made from a published environment (repos, setup,
  whether it may reach the internet). In the desktop app: not stated on the pages read.
- **Progress:** A list of chats with their status. More: not stated.
- **Checked:** You "inspect changed files and check results". A code review page exists and was not read.
- **Merged:** You commit or open a pull request from the task. Merging: not stated.
- **You:** You ask for follow-up changes. How it asks you: not stated.
- **Scale:** "Parallel cloud environments", which run while your computer sleeps. Limits: not stated.
- **Models:** Not stated on the pages read.
- **Looks:** A desktop app for macOS, Windows and Linux, the CLI and the web.

### Cursor (cloud agents)

- **Given:** From the phone app, the web, the desktop app, Slack, Linear, a comment `@cursor` on a GitHub issue or
  pull request, or the API. Splitting: not stated.
- **Runs:** A cloud machine per agent with the repos, secrets and start-up commands, on a branch of its own. The
  environment comes from a snapshot or a Dockerfile; outgoing network can be limited.
- **Progress:** The conversation, and "artifacts": screenshots, videos and logs of what changed and how it was
  verified. You can take over the agent's desktop to try the result.
- **Checked:** By those artifacts and by you. Its review bot was not on the page read.
- **Merged:** It produces "merge-ready PRs". Merging: not stated.
- **You:** Follow-up messages; taking over the desktop; a spending limit asked for at first use. Notifications
  through Slack.
- **Scale:** Not stated.
- **Models:** A model per agent, billed at that model's price.
- **Looks:** A web page of agents, the desktop app and a phone app.

### Devin

- **Given:** From the web app, Slack or Teams, a Linear or Jira ticket, the CLI or the API. Its advice is to split
  hard work yourself. Child sessions run by a parent Devin are described second-hand only.
- **Runs:** Not stated on the pages read.
- **Progress:** A progress tab: every shell command, edit and browser step, each opening the tool it happened in.
- **Checked:** Its advice is to make a task easy to verify ("checking that CI passes"). Work comes back as a draft
  pull request. Devin Review is a separate tool for reading pull requests.
- **Merged:** Not stated.
- **You:** You take over its editor, shell or browser (pause it first); side chats ask it something without
  stopping it. It says how sure it is at the start and after planning, and asks when it is not (from 2025).
- **Scale:** "Many tasks in parallel"; limits not stated.
- **Models:** Not stated.
- **Looks:** A web app with an editor, a shell and a browser; a CLI; Slack.

### Amp

Only its first manual page could be read: the next one asked for a login.

- **Given:** A thread. "Puck" is a tool that "launches and coordinates agents for you"; how is not stated.
- **Runs:** An "orb", a cloud machine per thread with your code and tools set up; or the CLI on your machine.
- **Progress, Checked, Merged, Scale:** Not stated.
- **You:** The apps notify you when a thread is ready for your next message.
- **Models:** Amp picks: several models, "each for the tasks it handles best".
- **Looks:** Web, macOS and phone apps and a CLI, all on the same threads.

### Factory (Missions)

- **Given:** `/missions` and a goal. It asks you questions, then writes a plan of features grouped into
  milestones (for 1 to 500 features), which you approve.
- **Runs:** Not stated on its page (second-hand: cloud computers that keep their state between sessions).
- **Progress:** "Mission Control" shows which features are being worked on.
- **Checked:** It tests each feature against the running app as a user would, and corrects itself; that needs a
  scripted way to drive the app.
- **Merged:** Not stated.
- **You:** You shape and approve the plan; during a run you can pause it, say what is wrong, or change direction.
- **Scale:** "Workers", how many at once not stated; whether working in parallel is needed at all is listed as an
  open question.
- **Models:** Not stated.
- **Looks:** Its CLI, or the Factory app.

### Orca

- **Given:** A Tasks view, also fed from GitHub and Linear; a worktree is opened from a task. One prompt can go
  to several agents at once. Splitting: not stated.
- **Runs:** A git worktree per task; also on another machine over SSH.
- **Progress:** A side list of projects, worktrees and their agents, each with a short status line and the time
  it has run; a session can read "awaiting permission".
- **Checked:** By you: comments on lines of the change, sent to the agent as one batch; CI shown in the app.
- **Merged:** You open, review and approve pull requests in the app. The steps: not stated.
- **You:** A phone app with agent status; a user quote mentions a notification when an agent finished.
- **Scale:** Other machines over SSH. Limits: not stated.
- **Models:** 27 agent programs on your own subscriptions; shows how much of each is used and swaps accounts.
- **Looks:** A desktop app for macOS, Windows and Linux, and phone apps.

### Conductor

- **Given:** You break the work down; one workspace per piece that can ship by itself.
- **Runs:** A worktree and a branch per workspace. Mac only.
- **Progress:** Not stated on the page read.
- **Checked:** A diff viewer whose line comments are attached to your next message; a `Review` action runs an
  agent review; a Checks tab lists git status, CI, deployments, comments and to-dos.
- **Merged:** You open the pull request and merge "once the PR is approved, checks pass, comments are resolved,
  and todos are complete", then archive the workspace.
- **You:** You drive every step. How it asks you: not stated.
- **Scale:** Not stated.
- **Models:** Claude Code, Codex, Cursor or OpenCode per workspace.
- **Looks:** A Mac app.

### Vibe Kanban

Read from its overview and the list of its doc pages only.

- **Given:** Issues on a board (or a list); a workspace is made when work starts. Sub-issues: none found.
- **Runs:** A workspace per piece of work, over several repos. Whether that is a worktree: not confirmed.
- **Progress:** The board's columns, and a logs panel per workspace.
- **Checked:** By you: the change with line comments sent to the agent, and a built-in preview browser.
- **Merged:** Pull request, merge and rebase from the app.
- **You:** Notification preferences exist; what they do was not read.
- **Scale:** A hosted version for teams; limits not stated.
- **Models:** Ten agent programs; saved profiles (planning mode, model, permissions) chosen when work starts.
- **Looks:** A web app started with `npx vibe-kanban`; a VS Code extension.

### T3 Code

- **Given:** A thread per piece of work. Splitting: not stated.
- **Runs:** A branch per thread, on your machine.
- **Progress:** Not stated.
- **Checked:** By you, reading the change beside the thread.
- **Merged:** One button commits, pushes and opens the pull request; draft and stacked ones too. Merging: not
  stated.
- **You:** Phone apps "to monitor and direct agent work".
- **Scale:** Not stated.
- **Models:** Six agent programs on your own subscriptions; the model can be changed in the middle of a thread.
- **Looks:** A desktop app and phone apps: the thread beside the change.

### Superset

- **Given:** A workspace per task; recurring "automations"; a CLI, an SDK and an MCP server.
- **Runs:** A worktree and a branch per task; other machines added as hosts.
- **Progress:** Agents grouped by state: working, blocked, waiting on you; "In Progress", "Ready for Review".
- **Checked:** By you, in views of the change where you comment and approve.
- **Merged:** After your approval; the steps are not stated.
- **You:** The states above. Notifications: not stated.
- **Scale:** Hosts over SSH. Limits: not stated.
- **Models:** Any agent program.
- **Looks:** A Mac desktop app (Linux experimental).

### Paseo

- **Given:** Per agent, from any of its clients; from GitHub, Slack or Discord through its hub; schedules; an SDK
  (its example gives every open issue marked "ready" to an agent of its own).
- **Runs:** A daemon on any machine runs the agent programs installed there; a worktree per agent if you ask.
- **Progress:** A side list grouped as "Ready to review", "Working" and "Done".
- **Checked:** Not stated.
- **Merged:** Its demo shows an agent opening a pull request. Merging: not stated.
- **You:** A phone app said to do all the desktop does; voice; plugins that can answer permission questions.
- **Scale:** A daemon per machine, reached directly, through its relay or your own tunnel.
- **Models:** Whatever the installed programs offer, on your own logins.
- **Looks:** Desktop, web, phone and CLI.

### Omnigent

- **Given:** A session with an agent; built-in ones include a coding orchestrator; your own are written in YAML.
- **Runs:** A "runner" wraps any agent in a sandbox that limits files and network and keeps credentials away from
  it, on your machine or on rented ones (Modal, Daytona).
- **Progress, Checked, Merged:** Not stated.
- **You:** Rules ("policies") that can demand your approval for file and shell actions, raise things by risk,
  cap spending and catch an agent retrying the same call. A live session can be shared by its address.
- **Scale:** A server with shared history, and runners.
- **Models:** Routed by policy.
- **Looks:** Terminal, web, desktop, phone and an API. It calls itself alpha.

### Gas Town

- **Given:** You tell the "Mayor", an agent that splits the request into work items, bundles them into a
  "convoy" and hands each to a worker.
- **Runs:** A worktree per worker that survives a crash, each worker in a tmux session.
- **Progress:** A feed, a web dashboard, the convoy's list, and a view of problem agents (stalled, dead, no
  progress for long).
- **Checked:** The "Refinery" runs the checks on a batch of finished work. A reviewing agent: not stated.
- **Merged:** By itself: the Refinery merges a batch that passes, and when one fails it finds which piece broke
  it and merges the rest.
- **You:** Agents escalate with a severity, up a chain of supervising agents to you; one key nudges an agent,
  another hands its work to a fresh one.
- **Scale:** A watching agent per repo and one across repos. How many agents: not stated on its page.
- **Models:** Claude Code, Copilot, Codex or Gemini.
- **Looks:** A CLI over tmux, and a web dashboard.

### OpenRig

- **Given:** You tell a lead agent the outcome; it works with agents in fixed roles ("seats"). A bounded task can
  go straight to a builder and waits in its queue.
- **Runs:** A tmux session per agent. Folders of their own: not stated.
- **Progress:** A table and a graph of every seat: its program, model, context and state.
- **Checked:** Reviewer seats check exactly what a builder produced; its "factory" team has two reviewers.
- **Merged:** Not stated.
- **You:** You can go into any agent's session; a guard holds automatic messages to a seat you are typing in;
  decisions that need you are brought back to you.
- **Scale:** A team can grow and shrink while it runs. Limits: not stated.
- **Models:** Claude Code, Codex or both.
- **Looks:** A CLI and a terminal screen; it names herdr as one way to see the agents' terminals together.

### GitHub Copilot cloud agent, and Agent HQ

- **Given:** From an agents panel, a chat, or an issue or pull request. One repo, one branch and one pull request
  per task; "break complex work into smaller tasks" yourself. Also on schedules and repo events.
- **Runs:** A short-lived cloud environment with access to that one repo.
- **Progress:** Session logs of what it did and used; you can chat with it during a run.
- **Checked:** It runs tests and linters there; Copilot's code review reads the pull request, when asked or always.
- **Merged:** Not stated.
- **You:** You steer a running session, ask for changes or carry on yourself; an owner can turn it off per repo.
- **Scale:** Agent HQ's "mission control" for many agents, other makers' included, is known here from news of
  its announcement only; what of it exists today was not confirmed.
- **Models:** Depends on where the task was started.
- **Looks:** GitHub's own pages, its CLI, and Slack or Teams.

## What we already have, so it is not suggested

A failed pull-request check, a requested change or a new comment wakes the agent. A review after the first only
looks at what was sent back. Findings have a severity and a proof, and an unproven one counts for less (Capy's
"confirmed" and "investigate"). Evidence with screenshots and links (Cursor's "artifacts"). A turn cut off by the
provider is tried again. Work goes on with the board closed. Other machines. A model and effort per task.
Merging by itself, which among those read only Gas Town also describes.

Two things from this research belong to tasks already on the board rather than to new ones: settings that do
something for one agent program only (`fast`, `reviewerFast`) are for task 107, and "the Coordinator picks a
cheaper model for a simple task", as Capy and Amp do, is for task 106.
