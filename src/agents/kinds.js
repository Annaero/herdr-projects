// Everything agent-specific lives in this one table. Every entry is optional and has a stated fallback, so any
// `herdr agent start --kind` value works as a worker or reviewer:
//   args        default arguments after `--` (full access, as pi-work's agents had)  none: the agent keeps its prompts
//   resume      arguments that reopen a conversation by id                          none: starts fresh
//   model       arguments that choose a model                                       none: the agent's default
//   effort      arguments that choose an effort level                               none: the agent's default
//   fast        arguments that turn on the program's faster service tier            none: no fast mode, the setting does nothing
//   slow        arguments that turn that tier off, whatever else names one          none: nothing is passed
//   interrupt   the key that stops a turn                                           none: esc
//   oneShot     a headless command for the hidden helper (the Watcher)              none: cannot be the Watcher
//   trust       mark a repo as trusted in the agent's own settings                  none: its trust dialog waits for you
//   minVersion  the oldest program version its turn-end hook was verified on        older: runs without the hook
//   hookArgs    launch arguments that make it call `turn-ended` at every turn end   none: the closing note and herdr's status
//   sessionArgs launch arguments that choose the conversation's id                  none: the id comes from the hook or the file
//   standing    launch arguments that keep the rules in force for the whole session none: rules ride on every prompt
//   transcript  where a conversation is saved                                       none: nothing is read
//   latestSession the newest conversation saved in a folder since a time (the agent's own   none: the id chosen at launch
//               "new chat" command starts another one)
//   readTurn    the end of a saved conversation: last message, error, token use     none: blank on the board
//   skillDir    the program's own user-level skills folder                          none: no how-to is installed
// Verified on claude 2.1.296, codex 0.160.0, pi 1.1.0 (docs/checked-on-herdr.md).
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { claudeFile, codexFile, claudeHome, codexHome, piHome } from "./homes.js";
import { headOf, when, turn, readClaude, readCodex, readPi, findFile } from "./read-turn.js";

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const hookCommand = (h) => [h.shim, "turn-ended", "--id", h.id, "--role", h.role, "--token", h.token, ...(h.role === "reviewer" ? ["--round", String(h.round)] : [])];
const skillAt = (home) => (fs.existsSync(home) ? path.join(home, "skills") : null);

export const AGENTS = {
  claude: {
    minVersion: "2.1.296",
    // A settings file of the task's own, added to the user's settings for this one launch (verified: the user's own
    // hooks still run). The hooks are asynchronous, so a slow or failing one never holds the agent's turn.
    hookArgs(h) {
      const command = hookCommand(h).map(shq).join(" ");
      const file = path.join(h.dir, `hook-${h.role}.json`);
      const one = [{ hooks: [{ type: "command", command, async: true }] }];
      fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: one, StopFailure: one } }), { mode: 0o600 });
      return ["--settings", file];
    },
    newSession: () => randomUUID(),
    sessionArgs: (id) => ["--session-id", id],
    // From a file: herdr refuses launch arguments that hold line breaks.
    standing: (text, dir) => { const f = path.join(dir, "rules.md"); fs.writeFileSync(f, text); return ["--append-system-prompt-file", f]; },
    transcript(session, cwd) {
      const real = (() => { try { return fs.realpathSync(cwd); } catch { return cwd; } })();
      const direct = path.join(claudeHome(), "projects", real.replace(/[^A-Za-z0-9]/g, "-"), `${session}.jsonl`);
      return fs.existsSync(direct) ? direct : findFile(path.join(claudeHome(), "projects"), (n) => n === `${session}.jsonl`, 1)[0] || null;
    },
    // /clear starts a new conversation file beside the old one (verified on 2.1.296).
    latestSession(cwd, since) {
      const real = (() => { try { return fs.realpathSync(cwd); } catch { return cwd; } })();
      // Only a chat of the interactive program itself: not a helper's side conversation (older versions kept those
      // as agent-*.jsonl beside it; now they sit in a subfolder) and not a headless run the agent made in its folder.
      const own = (f) => { try { const head = headOf(f, 65536); const entry = /"entrypoint":"([^"]*)"/.exec(head); return (!entry || entry[1] === "cli") && !/"isSidechain":true/.test(head.slice(0, head.indexOf("\n") < 0 ? undefined : head.indexOf("\n"))); } catch { return false; } };
      for (const f of findFile(path.join(claudeHome(), "projects", real.replace(/[^A-Za-z0-9]/g, "-")), (n) => /^[0-9a-f]{8}-[0-9a-f-]{27}\.jsonl$/.test(n), 0)) {
        try { if (fs.statSync(f).mtimeMs < since) return null; } catch { continue; } // newest first: nothing older counts
        if (own(f)) return path.basename(f, ".jsonl");
      }
      return null;
    },
    readTurn: readClaude,
    skillDir: () => skillAt(claudeHome()),
    args: ["--dangerously-skip-permissions"],
    resume: (id) => ["--resume", id],
    model: (m) => ["--model", m],
    effort: (e) => ["--effort", e],
    // The prompt goes in on stdin: --tools takes a list and would swallow a trailing prompt.
    // `lean` starts it with nothing of yours loaded (no MCP servers, plugins, hooks, skills or CLAUDE.md) and with the
    // helper's few words in place of Claude Code's own long instructions. Measured on 2.1.296, one Watcher call:
    // 0.9 s of processor time and 2.6 s in all, against 1.55 s and 5.1 s without. Logging in works as always.
    oneShot: ({ model, effort, prompt, system, lean }) => ({ command: "claude", stdin: prompt, args: ["-p", ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : []), ...(lean ? ["--safe-mode", "--strict-mcp-config", "--disable-slash-commands"] : []), ...(system ? [lean ? "--system-prompt" : "--append-system-prompt", system] : []), "--no-session-persistence", "--tools", ""] }),
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
    minVersion: "0.160.0",
    // Codex runs one `notify` program at each turn end, with a JSON argument. Given at launch it would replace one
    // the user configured, so a user who has one gets no hook (the hook-less route covers them).
    hookArgs(h) {
      try { if (/^\s*notify\s*=/m.test(fs.readFileSync(codexFile(), "utf8").split(/^\s*\[/m)[0])) return null; } catch {}
      return ["-c", `notify=${JSON.stringify(hookCommand(h))}`];
    },
    standing: (text) => ["-c", `developer_instructions=${JSON.stringify(text)}`],
    transcript: (session) => findFile(path.join(codexHome(), "sessions"), (n) => n.endsWith(`${session}.jsonl`))[0] || null,
    // Codex names its own conversations: without a hook, the one for this task is the file made after launch, in this
    // folder, whose prompts name this task and role. No match, or more than one: no session.
    findSession(cwd, since, needle) {
      const real = (() => { try { return fs.realpathSync(cwd); } catch { return cwd; } })();
      const hits = findFile(path.join(codexHome(), "sessions"), (n) => n.endsWith(".jsonl")).filter((f) => { try { return fs.statSync(f).mtimeMs >= since - 60000; } catch { return false; } }).filter((f) => {
        try { const head = fs.readFileSync(f, "utf8").slice(0, 400000); const meta = JSON.parse(head.slice(0, head.indexOf("\n"))); return meta.payload?.cwd === real && when(meta.timestamp) >= since - 5000 && head.includes(needle); } catch { return false; }
      });
      if (hits.length !== 1) return null;
      try { return JSON.parse(fs.readFileSync(hits[0], "utf8").split("\n")[0]).payload.id; } catch { return null; }
    },
    // /new starts a new conversation file (verified on 0.160.0). Newest first: the first one in this folder wins.
    latestSession(cwd, since) {
      const real = (() => { try { return fs.realpathSync(cwd); } catch { return cwd; } })();
      for (const f of findFile(path.join(codexHome(), "sessions"), (n) => n.endsWith(".jsonl"))) {
        try {
          if (fs.statSync(f).mtimeMs < since) return null; // sorted newest first: nothing older counts
          const head = fs.readFileSync(f, "utf8").slice(0, 400000); const meta = JSON.parse(head.slice(0, head.indexOf("\n") < 0 ? undefined : head.indexOf("\n")));
          // Only a chat of the interactive program itself. A helper agent it spawned has a conversation file of its
          // own in the same folder (verified on 0.160.0: "source" is then {"subagent": …} and "parent_thread_id" names
          // the main one), and so has a headless `codex exec` run there ("source": "exec").
          const p = meta.payload || {};
          if (p.cwd === real && p.id && !p.parent_thread_id && typeof (p.source ?? "cli") === "string" && p.source !== "exec") return p.id;
        } catch {}
      }
      return null;
    },
    readTurn: readCodex,
    skillDir: () => skillAt(codexHome()),
    // --no-daemon: a shared Codex background server of another version shows a restart dialog that herdr reads as
    // idle, so a prompt would be typed into it. Each agent runs on its own instead.
    args: ["--dangerously-bypass-approvals-and-sandbox", "--no-daemon"],
    resume: (id) => ["resume", id],
    model: (m) => ["-m", m],
    effort: (e) => ["-c", `model_reasoning_effort="${e}"`],
    // Codex's Fast mode. Verified on 0.160.0: with this override every request carries `service_tier: "priority"`
    // (none without it), for `codex`, `codex resume` and `codex exec` alike. A model that has no such tier drops it
    // with a warning and runs at normal speed.
    fast: () => ["-c", 'service_tier="fast"'],
    // The setting is the one switch. Off names the default tier, last on the line, so it wins over a tier in your own
    // `agentArgs` (in any spelling), in ~/.codex/config.toml or in a profile. Verified on 0.160.0: after a fast
    // override, `-c service_tier="default"` sends no tier and prints no warning.
    slow: () => ["-c", 'service_tier="default"'],
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
    minVersion: "1.1.0",
    // A one-file extension of the task's own: pi's settled event runs the same command, with the session file on stdin.
    hookArgs(h) {
      const file = path.join(h.dir, `hook-${h.role}.ts`);
      fs.writeFileSync(file, `import { spawn } from "node:child_process";
const cmd = ${JSON.stringify(hookCommand(h))};
export default function (pi: any) {
  pi.on("agent_settled", (_e: any, ctx: any) => {
    try {
      let file = ""; try { file = ctx?.sessionManager?.getSessionFile?.() || ""; } catch {}
      const c = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "ignore", "ignore"], detached: true });
      c.on("error", () => {}); c.stdin.on("error", () => {});
      c.stdin.end(JSON.stringify({ transcript_path: file })); c.unref();
    } catch {}
  });
}
`, { mode: 0o600 });
      return ["-e", file];
    },
    newSession: () => `sw-${randomUUID().slice(0, 13)}`,
    sessionArgs: (id) => ["--session-id", id],
    standing: (text, dir) => { const f = path.join(dir, "rules.md"); fs.writeFileSync(f, text); return ["--append-system-prompt", f]; }, // pi reads a file given here
    transcript: (session) => findFile(path.join(piHome(), "sessions"), (n) => n.endsWith(`_${session}.jsonl`), 1)[0] || null,
    // /new starts another session file in the same folder of sessions (verified on 1.1.0); its first line names the
    // working folder and the id. Newest first: the first one of this folder wins.
    latestSession(cwd, since) {
      const real = (() => { try { return fs.realpathSync(cwd); } catch { return cwd; } })();
      for (const f of findFile(path.join(piHome(), "sessions"), (n) => n.endsWith(".jsonl"), 1)) {
        try {
          if (fs.statSync(f).mtimeMs < since) return null;
          const head = headOf(f, 8192); const meta = JSON.parse(head.slice(0, head.indexOf("\n") < 0 ? undefined : head.indexOf("\n")));
          if (meta.type === "session" && meta.id && !meta.parentSession && (meta.cwd === real || meta.cwd === cwd)) return meta.id;
        } catch {}
      }
      return null;
    },
    readTurn: readPi,
    skillDir: () => skillAt(piHome()),
    args: [], // pi never asks before running something
    resume: (id) => ["--session-id", id],
    model: (m) => (m.includes("/") ? ["--provider", m.slice(0, m.indexOf("/")), "--model", m.slice(m.indexOf("/") + 1)] : ["--model", m]),
    effort: (e) => ["--thinking", e],
    oneShot: ({ model, prompt, system }) => ({ command: "pi", args: ["-p", "--no-session", "--no-tools", "--no-skills", "--no-context-files", ...(model ? AGENTS.pi.model(model) : []), ...(system ? ["--append-system-prompt", system] : []), "--", prompt] }),
  },
};
