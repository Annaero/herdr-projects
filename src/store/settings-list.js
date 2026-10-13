// The settings, each one defined once: its name, its built-in value, what it may be, whether it is a work or a board
// setting, and what it means. Checking a value, the lookup, `show`, the task panel and the table in docs/settings.md
// are all made from this list. A new setting is one entry here, beside the ones of its area, then `node scripts/docs.js`.
//
// An entry:
//   name     its name everywhere: in config.json, on the command line, on a task
//   kind     "work": looked up task -> your entry for the repo -> you -> the repo's file -> built in
//            "board": yours only (everything under board., coordinator. and watcher.)
//            "repo": a fact about one repo, said for that repo only: your entry for the repo -> the repo's file -> built in
//   type     what a value is (store/settings/values.js): switch, choice, time, count, agent, effort, access, text,
//            list, machines, notify, key
//   builtin  what it is until somebody says otherwise
//   values   a choice's words
//   none     true: an agent setting that may be `none`
//   min      a count's smallest number
//   repo     true: one of the seven facts the repo's own committed file may hold
//   adds     true: its values add up across the places instead of the nearest one winning
//   label    its plain name, as the settings page of a task shows it before the name itself
//   means    a few words on what it does, said on the settings page beside what the selected row may be
//   doc      what it means, for docs/settings.md

// The five every role has. `who` is the role as a sentence names it.
const role = (name, who, builtin, kind, cap = name === "worker" ? "Agent's" : `${name[0].toUpperCase()}${name.slice(1)}'s`) => [
  { name: `${name}.agent`, label: `${cap} program`, kind, type: "agent", builtin: builtin.agent, none: name === "coordinator", doc: `${who}'s program: \`claude\`, \`codex\` or \`pi\`, with an optional model after a slash (\`codex/gpt-5.5\`). The model travels with the program, so one program's model is never handed to another${name === "coordinator" ? ". `none`: no Coordinator" : ""}${name === "reviewer" ? ". Not installed here: the worker's program reviews, on its own model, and the task says so" : ""}` },
  { name: `${name}.effort`, label: `${cap} effort`, kind, type: "effort", builtin: "default", doc: `${who}'s effort level: one its program accepts (checked against \`${name}.agent\`), or \`default\` for the program's own` },
  { name: `${name}.fast`, label: `${cap} fast mode`, kind, type: "switch", builtin: builtin.fast, doc: `${who} in its program's fast mode: a faster service tier that uses more of your allowance. Only Codex has one; for another program it does nothing, and \`show\` says so` },
  { name: `${name}.access`, label: `${cap} access`, kind, type: "access", builtin: "full", doc: `what ${who} may do without asking: \`full\` or \`ask\`. The board turns it into each program's own flags. \`ask\` is refused for a program that cannot ask (pi)` },
  { name: `${name}.instructions`, label: `${cap} instructions`, kind, type: "text", builtin: "none", adds: kind === "work", doc: `your own words for ${who}, added after the board's own fixed rules${kind === "work" ? ". They add up across the places, broadest first, and the agent is told that later ones win" : ""}` },
];

import { THEME_NAMES } from "../board/palettes.js";

export const SETTINGS = [
  // who works, who reviews, who you talk to
  ...role("worker", "the working agent", { agent: "claude", fast: false }, "work"),
  ...role("reviewer", "the reviewer", { agent: "codex", fast: true }, "work"),
  ...role("coordinator", "the Coordinator, the agent you talk to in the chat", { agent: "claude", fast: false }, "board"),
  // the Watcher
  { name: "watcher.agent", label: "Watcher's program", kind: "board", type: "agent", builtin: "claude/claude-haiku-5-5", none: true, doc: "the Watcher: a small model behind the \"doing now\" line, the progress guess and the minutes left. `none`: none of the three. More: [the Watcher](watcher.md)" },
  { name: "watcher.every", label: "Watcher looks every", kind: "board", type: "time", builtin: "60s", doc: "the least time between two looks of the Watcher at one working agent. One hidden model call covers every agent whose look is due, one call runs at a time on the machine, a screen that has not changed costs none, and a busy machine is looked at up to five times less often" },
  // what the work is
  { name: "research.only", label: "Research only", kind: "work", type: "switch", builtin: false, repo: true, means: "its agent changes nothing in the repo; the result is a report, and nothing is pushed, opened or merged", doc: "research only: the task's agent changes nothing in the repo and its result is a report, with a private link. Nothing is committed, pushed, opened as a pull request or merged for it, and its row says `[research]`. Read when the agent starts: a change counts from the task's next start, and turning it on is refused once the agent has changed the repo or a pull request is open. `--research` and `--no-research` on `add` and `delegate` are short for it. More: [reports and research-only tasks](research.md)" },
  // where it works
  { name: "workspace.from", label: "Worktree starts from", kind: "work", type: "choice", values: ["main", "here"], builtin: "main", doc: "where a worktree starts: `main` (the remote's main branch, fetched first) or `here` (the commit your checkout is on)" },
  { name: "workspace.setup", label: "Set-up command", kind: "work", type: "text", builtin: "none", repo: true, doc: "a command run in the fresh worktree before the agent starts" },
  { name: "workspace.include", label: "Files copied in", kind: "work", type: "list", builtin: "none", repo: true, doc: "ignored files a fresh worktree lacks and gets a copy of (`.env`); `.worktreeinclude` in the repo names more" },
  { name: "workspace.teardown", label: "Teardown command", kind: "work", type: "text", builtin: "none", repo: true, doc: "a command run in the worktree before it is removed" },
  { name: "workspace.cleanup", label: "Clean up when done", kind: "work", type: "switch", builtin: true, doc: "remove a done task's space, worktree and branch" },
  // how it is checked
  { name: "check.command", label: "Check command", kind: "work", type: "text", builtin: "none", repo: true, doc: "the test command: the work only counts as done when it passes" },
  { name: "check.timeout", label: "Check may run for", kind: "work", type: "time", builtin: "15m", repo: true, doc: "how long the check may run before it is stopped and counts as failed" },
  { name: "review.when", label: "Review when", kind: "work", type: "choice", values: ["always", "repos", "never"], builtin: "repos", doc: "what gets a review when finished: `repos` (work in a repo), `always` (work outside one too) or `never`" },
  { name: "review.mustFix", label: "Send back from", kind: "work", type: "choice", values: ["critical", "major", "minor", "trivial"], builtin: "major", doc: "a finding that bad or worse fails the review. More: [the gate](gate.md)" },
  { name: "review.rounds", label: "Rounds by itself", kind: "work", type: "count", min: 0, builtin: 3, doc: "how many times work goes back to the agent by itself, for any one reason: findings, a failed check, a conflict with main, pull request feedback. `0`: nothing goes back by itself, and a failed review waits for you" },
  { name: "review.evidence", label: "Reviewer brings evidence", kind: "work", type: "switch", builtin: true, doc: "the reviewer brings evidence: screenshots, a recording, a link, test output" },
  // how it lands
  { name: "merge.by", label: "Merged by", kind: "work", type: "choice", values: ["you", "itself"], builtin: "you", doc: "`you`: finished work waits for your yes. `itself`: it merges the moment it may: its review passed, its checks pass, nothing conflicts. Read right before the merge, so a change counts for tasks under way. More: [the gate](gate.md#merging-by-itself)" },
  { name: "merge.method", label: "Merge method", kind: "work", type: "choice", values: ["squash", "merge", "rebase"], builtin: "squash", doc: "how approved work lands" },
  { name: "merge.pr", label: "Open a pull request", kind: "work", type: "switch", builtin: true, doc: "push the branch and open a draft pull request after the check passes" },
  // how its tasks are named
  { name: "repo.key", label: "Repo's short key", kind: "repo", type: "key", builtin: "none", repo: true, doc: "a short key for this repo's tasks, as `HSW` for herdr-superwork: 2 to 5 letters or digits, the first a letter, kept in capitals. With one, a task's tag on the board reads `HSW-134` instead of `#134`, and `HSW-134` (in any letter case) names the task wherever its id `herdr-superwork/134` does. `none`: no key. A key another repo already has is refused. More: [task numbers and keys](task-numbers.md)" },
  // the board (yours only)
  { name: "board.agents", label: "Agents at once", kind: "board", type: "count", min: 1, builtin: 4, doc: "how many agents work at once" },
  { name: "board.machines", label: "Other machines", kind: "board", type: "machines", builtin: "auto", doc: "other machines: `auto` (herdr's saved machines), names (`exedev@vm-a, vm-b`) or `none`" },
  { name: "board.open", label: "The board key opens", kind: "board", type: "choice", values: ["tab", "popup"], builtin: "tab", doc: "what the board key opens. `tab`: the board in a herdr tab of its own, which stays when you go into an agent; pressed on the board itself, the key takes you back to where you came from. `popup`: the board as herdr's popup, a framed window in the middle of herdr's screen, over whatever is there (in a window under 110 columns or 30 rows it takes the whole pane: a margin would cost half the board); the key again or `Esc` closes it, as its hint line says (`esc close`), it closes when you go into an agent, and it is never left behind on a tab. More: [the board](board.md)" },
  { name: "board.notify", label: "Tell me by", kind: "board", type: "notify", builtin: "none", doc: "when a task needs you, is ready to approve, or failed: `bell` rings the terminal bell, a command is run with `HERDR_SUPERWORK_ID`, `HERDR_SUPERWORK_TITLE` and `HERDR_SUPERWORK_EVENT` (`needs you`, `ready to approve` or `failed`) in its environment, `none` does neither" },
  { name: "board.webUi", label: "Board in the web UI", kind: "board", type: "choice", values: ["auto", "none"], builtin: "auto", doc: "the board inside the herdr web UI. `auto`: when the web UI plugin (`devswha.herdr-web-ui`) is installed, a small front door of the board's own runs in front of it and adds a Board entry to its menu; without that plugin nothing runs. `none`: never. More: [the board in the web UI](web-ui.md)" },
  { name: "board.theme", label: "Colours", kind: "board", type: "choice", values: ["herdr", "dark", "light", ...THEME_NAMES], builtin: "herdr", doc: "the board's colours. `herdr`: herdr's own theme, read from this machine's `config.toml` and resolved as herdr does, so with no theme set there it is herdr's default (Catppuccin); `dark` or `light` picks that theme's dark or light one by hand; the name of one of herdr's themes (`nord`, `gruvbox`, … and `terminal` for the terminal's own colours) is that theme whatever the config says, for a herdr opened from another machine whose config names another one. More: [colours](colours.md)" },
];

export const NAMES = SETTINGS.map((s) => s.name);
export const entryOf = (name) => SETTINGS.find((s) => s.name === name) || null;
export const WORK = SETTINGS.filter((s) => s.kind === "work").map((s) => s.name);
export const BOARD = SETTINGS.filter((s) => s.kind === "board").map((s) => s.name);
// The seven facts a repo's own committed file may hold, and no more.
export const REPO_FACTS = SETTINGS.filter((s) => s.repo).map((s) => s.name);
// These mean nothing for a task in no repo.
export const needsRepo = (name) => /^(workspace|check|merge)\./.test(name);
