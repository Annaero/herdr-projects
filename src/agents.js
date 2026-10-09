// Everything agent-specific lives in this one table. Every entry is optional and has a stated fallback, so any
// `herdr agent start --kind` value works as a worker or reviewer:
//   args      default arguments after `--` (full access, as pi-work's agents had)   none: the agent keeps its prompts
//   resume    arguments that reopen a conversation by id                           none: starts fresh
//   model     arguments that choose a model                                        none: the agent's default
//   effort    arguments that choose an effort level                                none: the agent's default
//   interrupt the key that stops a turn                                            none: esc
//   oneShot   a headless command for the hidden helpers                            none: cannot be a helper
//   allow     restrict a one-shot helper to herdr-superwork commands               none: cannot be the dispatcher
//   trust     mark a repo as trusted in the agent's own settings                   none: its trust dialog waits for you
// Flags were confirmed from each agent's own --help: claude 2.1, codex 0.160, pi 1.1.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./store.js";

const claudeFile = () => process.env.HERDR_SUPERWORK_CLAUDE_JSON || path.join(os.homedir(), ".claude.json");
const codexFile = () => process.env.HERDR_SUPERWORK_CODEX_TOML || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");

export const AGENTS = {
  claude: {
    args: ["--dangerously-skip-permissions"],
    resume: (id) => ["--resume", id],
    model: (m) => ["--model", m],
    effort: (e) => ["--effort", e],
    // The prompt goes in on stdin: --tools and --allowedTools take lists and would swallow a trailing prompt.
    oneShot: ({ model, prompt, allow, system }) => ({ command: "claude", stdin: prompt, args: ["-p", ...(model ? ["--model", model] : []), ...(system ? ["--append-system-prompt", system] : []), "--no-session-persistence", ...(allow ? ["--allowedTools", "Bash(herdr-superwork:*)"] : ["--tools", ""])] }),
    allow: true,
    // Claude keeps trust per repository root, in ~/.claude.json. Verified on 2.1.295: with the flag set, a brand-new
    // worktree of that repo starts without the "trust this folder?" dialog.
    trust(root) {
      const file = claudeFile();
      let j = {};
      try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") return false; } // unreadable: leave it alone
      if (j.projects?.[root]?.hasTrustDialogAccepted) return true;
      j.projects = { ...(j.projects || {}), [root]: { ...(j.projects?.[root] || {}), hasTrustDialogAccepted: true } };
      const tmp = `${file}.${process.pid}.sw.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(j, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, file);
      return true;
    },
  },
  codex: {
    // --no-daemon: a shared Codex background server of another version shows a restart dialog that herdr reads as
    // idle, so a prompt would be typed into it. Each agent runs on its own instead.
    args: ["--dangerously-bypass-approvals-and-sandbox", "--no-daemon"],
    resume: (id) => ["resume", id],
    model: (m) => ["-m", m],
    effort: (e) => ["-c", `model_reasoning_effort="${e}"`],
    oneShot: ({ model, prompt }) => ({ command: "codex", args: ["exec", "--skip-git-repo-check", "--ephemeral", "--color", "never", ...(model ? ["-m", model] : []), prompt] }),
    // Codex keeps trust per repository root, in ~/.codex/config.toml. A command-line override does not count
    // (verified on 0.160), so the table is appended to the file once.
    trust(root) {
      const file = codexFile();
      let text = "";
      try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (e.code !== "ENOENT") return false; }
      const head = `[projects.${JSON.stringify(root)}]`;
      if (text.includes(head)) return true; // already has an entry: trusted or deliberately not, either way not ours to change
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}\n${head}\ntrust_level = "trusted"\n`);
      return true;
    },
  },
  pi: {
    args: [], // pi never asks before running something
    resume: (id) => ["--session", id],
    model: (m) => (m.includes("/") ? ["--provider", m.slice(0, m.indexOf("/")), "--model", m.slice(m.indexOf("/") + 1)] : ["--model", m]),
    effort: (e) => ["--thinking", e],
    oneShot: ({ model, prompt, system }) => ({ command: "pi", args: ["-p", "--no-session", "--no-tools", "--no-skills", "--no-context-files", ...(model ? AGENTS.pi.model(model) : []), ...(system ? ["--append-system-prompt", system] : []), "--", prompt] }),
  },
};
export const adapter = (kind) => AGENTS[kind] || {};
// The arguments a worker or reviewer of this kind is started with.
export function startArgs(kind, { model, effort, resume } = {}) {
  const a = adapter(kind);
  const user = config().agentArgs?.[kind];
  return [
    ...(resume && a.resume ? a.resume(resume) : []),
    ...(Array.isArray(user) ? user : a.args || []),
    ...(model && a.model ? a.model(model) : []),
    ...(effort && a.effort ? a.effort(effort) : []),
  ];
}
export const fullAccess = (kind) => { const user = config().agentArgs?.[kind]; return (Array.isArray(user) ? user : adapter(kind).args || []).some((x) => /dangerously|bypass|yolo/i.test(x)) || kind === "pi"; };
export const interruptKey = (kind) => adapter(kind).interrupt || "esc";
// Best effort: a failure here only means the agent's own trust dialog shows, which the inbox handles.
export function preTrust(kind, root) {
  if (!config().trust || !adapter(kind).trust || !fullAccess(kind)) return false;
  try { return adapter(kind).trust(root); } catch { return false; }
}
