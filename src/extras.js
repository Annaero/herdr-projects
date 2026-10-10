// The two things the plugin writes outside its own folders, both consented and removable:
//   1. a small how-to in each installed agent program's own skills folder (setting `skill`, default on), so any chat
//      knows the board without being told;
//   2. on a yes at the board's first run, marked blocks in herdr's config.toml: a key to open the board and the sidebar
//      rows that show the plugin's labels.
// `remove-extras` takes all of it out again. The plugin never edits a file, or a block, it did not write.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as S from "./store.js";
import { AGENTS, installed } from "./agents.js";

const stateFile = () => path.join(S.dataDir(), "extras.json");
export const extras = () => S.readJson(stateFile(), {}) || {};
const save = (patch) => { const next = { ...extras(), ...patch }; S.writeJson(stateFile(), next); return next; };

// ---- 1. the how-to ---------------------------------------------------------------------------------------------------
const NAME = "herdr-superwork";
export function skillText(shim) {
  return `---
name: ${NAME}
description: The human's work board in herdr. Use it when they ask to file, list, delegate, check or update a task on "the board", or to put an agent on something.
---

# herdr-superwork: the work board

The human keeps one list of tasks on a board. You can read and change it from your shell with this command (the
full path works even when it is not on your PATH):

    ${shim}

Every command accepts \`--json\`. Below, \`herdr-superwork\` stands for that path.

- \`herdr-superwork list\`: the tasks: id (\`<repo>/<number>\`), state (idle, working, blocked, done, error), who is on it, title.
  \`--query TEXT\` searches, \`--archived\` shows the archive, \`--all\` includes it.
- \`herdr-superwork add "<short title>" --desc "<full description>"\`: file a new task in the current repo
  (\`--repo <name or path>\` for another). Filing starts nothing. Add \`--delegate\` only if the human asked for an agent.
- \`herdr-superwork delegate <id>\`: put an agent on a task. It works in its own git worktree, as an ordinary herdr
  agent in its own herdr space. Options for this one task: \`--agent claude|codex|pi\`, \`--model\`, \`--effort\`,
  \`--reviewer <kind>|off\`, \`--no-worktree\` (work in the human's checkout), \`--base head\` (start from their current commit).
- \`herdr-superwork tell <id> "<text>"\`: send a message to a task's agent (on a task with no agent yet: starts one with it).
- \`herdr-superwork stop <id>\`: interrupt a task's agent.
- \`herdr-superwork report <id> --state <idle|working|done> [--msg "<one line>"] [--progress <0-100>]\`: say where one of
  the human's own tasks stands. \`--title\` renames it. \`herdr-superwork describe <id> "<text>"\` replaces its description.
- \`herdr-superwork approve <id>\`: merge finished work that waits for approval. Only when the human plainly says so.
- \`herdr-superwork review <id>\` sends the reviewer's findings back to the agent; \`retry <id>\` sends a saved error back;
  \`fix <id>\` sends failure details; \`details <id>\` reads them.
- \`herdr-superwork archive <id>\` hides a task and keeps everything; \`restore <id>\` brings it back; \`clear <id>\` deletes it
  (only when the human plainly asks).
- \`herdr-superwork config\` shows the settings; \`config <key> <value>\` changes one; \`config <key> <value> --id <id>\` sets it
  for one task.

If you are an agent the board itself started on a task, your rules were given to you at the start: you may only file
new tasks (\`add\`) and report yourself blocked (\`report <your id> --state blocked --kind question|permission|auth --msg "<why>"\`).
The board refuses your other commands: the human does those.
`;
}
// Each installed agent program's own user-level skills folder (confirmed for Claude Code, Codex and pi: a folder per
// skill holding SKILL.md). The plugin owns one folder there, named for itself, and records every path it wrote.
function skillTargets() {
  const dirs = process.env.HERDR_SUPERWORK_SKILL_DIRS;
  if (dirs !== undefined) return dirs.split(":").filter(Boolean).map((d) => ({ kind: path.basename(d), dir: path.join(d, NAME) }));
  return Object.entries(AGENTS).filter(([kind, a]) => a.skillDir && installed(kind)).map(([kind, a]) => ({ kind, dir: a.skillDir() && path.join(a.skillDir(), NAME) })).filter((x) => x.dir);
}
export function syncSkill(shim) { return S.withLock("extras", () => syncSkill0(shim), { waitMs: 15000 }); }
function syncSkill0(shim = path.join(S.dataDir(), "bin", NAME)) {
  if (process.env.HERDR_SUPERWORK_INLINE === "1" && process.env.HERDR_SUPERWORK_SKILL_DIRS === undefined) return []; // tests never write into real agent folders
  if (!S.config().skill) return removeSkill0();
  const wrote = new Set(extras().skillPaths || []);
  const text = skillText(shim);
  for (const { dir } of skillTargets()) {
    const file = path.join(dir, "SKILL.md");
    try {
      if (fs.existsSync(dir) && !wrote.has(dir)) continue; // a folder of that name that is not ours: left alone
      if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) { wrote.add(dir); continue; }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, text);
      wrote.add(dir);
    } catch {}
  }
  save({ skillPaths: [...wrote] });
  return [...wrote];
}
// Removes exactly what was written: the recorded folders, and only while they still hold just our file.
export function removeSkill() { return S.withLock("extras", removeSkill0, { waitMs: 15000 }); }
function removeSkill0() {
  const gone = [];
  for (const dir of extras().skillPaths || []) {
    try { const names = fs.readdirSync(dir); if (names.every((n) => n === "SKILL.md")) { fs.rmSync(dir, { recursive: true, force: true }); gone.push(dir); } } catch { gone.push(dir); }
  }
  save({ skillPaths: (extras().skillPaths || []).filter((d) => !gone.includes(d)) });
  return [];
}

// ---- 2. herdr's config.toml ------------------------------------------------------------------------------------------
// Where herdr's config is (verified on 0.9.3: $HERDR_CONFIG_PATH, else <XDG config>/herdr/config.toml).
export const herdrConfig = () => process.env.HERDR_CONFIG_PATH || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "herdr", "config.toml");
const herdrBin = () => process.env.HERDR_BIN_PATH || "herdr";
const BEGIN = (what) => `# >>> herdr-superwork ${what} (added by the herdr-superwork plugin; \`herdr-superwork remove-extras\` removes it)`;
const END = (what) => `# <<< herdr-superwork ${what}`;
const BLOCKS = {
  key: (key) => `[[keys.command]]\nkey = "${key}"\ntype = "plugin_action"\ncommand = "herdr-superwork.open"\ndescription = "work board"`,
  sidebar: () => `[ui.sidebar.agents]\nrows = [["state_icon", "machine", "workspace", "tab"], ["agent", "state_text"], [{ token = "$summary", dim = true }, "$progress"]]\n\n[ui.sidebar.spaces]\nrows = [["state_icon", "workspace"], ["branch", "git_status"], [{ token = "$summary", dim = true }]]`,
};
export const blockText = (what, arg) => `${BEGIN(what)}\n${BLOCKS[what](arg)}\n${END(what)}`;
const read = () => { try { return fs.readFileSync(herdrConfig(), "utf8"); } catch { return ""; } };
const has = (text, what) => text.includes(BEGIN(what));
// The keys herdr binds by default, from `herdr --default-config` (commented `# action = "key"` lines under [keys]).
export function defaultKeys() {
  const r = spawnSync(herdrBin(), ["--default-config"], { encoding: "utf8", timeout: 8000 });
  if (r.status !== 0) return null;
  const keys = new Set();
  const part = (String(r.stdout).split(/^\[keys\]/m)[1] || "").split(/^\[(?!\[)/m)[0];
  for (const m of part.matchAll(/^#\s*[a-z_]+\s*=\s*"([^"]+)"/gm)) if (m[1]) { keys.add(m[1].toLowerCase()); const r9 = /^(.*)1\.\.9$/.exec(m[1]); if (r9) for (let i = 1; i <= 9; i++) keys.add(`${r9[1]}${i}`.toLowerCase()); }
  return keys;
}
const boundKeys = (text) => new Set([...text.matchAll(/^\s*(?:key|[a-z_]+)\s*=\s*"((?:prefix\+|ctrl\+|alt\+|shift\+|cmd\+|super\+)[^"]+|f\d+)"/gim)].map((m) => m[1].toLowerCase()));
// What the first run can offer, given what herdr's config already holds.
export function offers() {
  const text = read(), x = extras();
  const defaults = defaultKeys();
  const taken = new Set([...(defaults || []), ...boundKeys(text)]);
  const suggest = defaults ? ["prefix+a", "prefix+y", "prefix+u", "prefix+i", "prefix+m"].find((k) => !taken.has(k)) || "" : "";
  return {
    file: herdrConfig(), asked: !!x.asked,
    key: !/command\s*=\s*"herdr-superwork\.open"/.test(text) && x.key !== "no" ? { suggest, taken } : null,
    sidebar: !/^\s*\[ui\.sidebar/m.test(text) && x.sidebarAnswer !== "no" ? {} : null,
  };
}
export const answer = (patch) => save({ asked: true, ...patch });
// Add one marked block. The edit is checked on a copy first, the file is backed up, and herdr is told to reload; if
// herdr rejects the result the backup comes back and herdr reloads again. Returns { ok, msg, paste? }.
export function addBlock(what, arg) {
  const file = herdrConfig();
  const text = read();
  if (has(text, what)) return { ok: true, msg: "already there" }; // never added twice
  const block = blockText(what, arg);
  if (what === "key") {
    const key = String(arg || "").trim().toLowerCase();
    if (!/^[a-z0-9+_.-]+$/.test(key)) return { ok: false, msg: `"${arg}" is not a key herdr understands. Try something like prefix+a.` };
    const d = defaultKeys();
    if (boundKeys(text).has(key)) return { ok: false, msg: `${key} is already bound in ${S.tilde(file)}. Choose another.` };
    if (d && d.has(key)) return { ok: false, msg: `herdr itself uses ${key}. Choose another.` };
  }
  const next = `${text}${text && !text.endsWith("\n") ? "\n" : ""}\n${block}\n`;
  const paste = `Could not change ${S.tilde(file)}. Add this to it yourself, then run: herdr server reload-config\n\n${block}`;
  // Validate a candidate before touching the real file.
  const cand = path.join(S.dataDir(), `config-candidate-${process.pid}.toml`);
  try {
    fs.mkdirSync(S.dataDir(), { recursive: true }); fs.writeFileSync(cand, next);
    const c = spawnSync(herdrBin(), ["config", "check"], { encoding: "utf8", timeout: 8000, env: { ...process.env, HERDR_CONFIG_PATH: cand } });
    if (c.status !== 0 || !/ok/i.test(String(c.stdout))) return { ok: false, msg: `herdr would reject that: ${S.oneLine(String(c.stdout || c.stderr), 300)}` };
  } catch {} finally { try { fs.rmSync(cand, { force: true }); } catch {} }
  const backup = `${file}.bak-herdr-superwork`;
  const existed = fs.existsSync(file);
  try {
    if (existed && fs.lstatSync(file).isSymbolicLink()) return { ok: false, msg: paste, paste: block }; // a managed link: not ours to rewrite
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (existed) fs.copyFileSync(file, backup);
    fs.writeFileSync(file, next);
  } catch { return { ok: false, msg: paste, paste: block }; }
  const reload = () => { const r = spawnSync(herdrBin(), ["server", "reload-config"], { encoding: "utf8", timeout: 15000 }); try { const j = JSON.parse(r.stdout).result; return { status: j.status, why: (j.diagnostics || []).join("; ") }; } catch { return { status: r.status === 0 ? "applied" : "unknown", why: String(r.stderr || r.stdout).trim() }; } };
  const r = reload();
  const bad = r.status === "failed" || (r.status === "partial" && what === "key" && r.why.toLowerCase().includes(String(arg).toLowerCase()));
  if (bad) {
    try { if (existed) fs.copyFileSync(backup, file); else fs.rmSync(file, { force: true }); } catch {}
    reload();
    return { ok: false, msg: `herdr rejected the change, so your settings were put back as they were. It said: ${S.oneLine(r.why, 300)}` };
  }
  if (what === "sidebar") save({ sidebar: true });
  return { ok: true, msg: r.status === "unknown" ? `Added. herdr could not be asked to reload (${S.oneLine(r.why, 120)}): restart herdr or run herdr server reload-config.` : "Added." };
}
// An earlier version offered to turn on herdr's notification pop-ups. The plugin raises none now, so the block it
// wrote for that is taken out again, at herdr's start and when the board opens.
export function removePopups() {
  if (process.env.HERDR_SUPERWORK_INLINE === "1" && process.env.HERDR_CONFIG_PATH === undefined) return false; // tests never touch the real config
  try { if (fs.lstatSync(herdrConfig()).isSymbolicLink()) return false; } catch { return false; } // a managed link: not ours to rewrite unasked
  return S.withLock("extras", () => removeBlocks("popups"), { waitMs: 15000 });
}
export function removeBlocks(what = "[^\\n]*") {
  const file = herdrConfig();
  const text = read();
  if (!new RegExp(`^# >>> herdr-superwork ${what}`, "m").test(text)) return false;
  const next = text.replace(new RegExp(`\\n?# >>> herdr-superwork ${what}[^\\n]*\\n[\\s\\S]*?# <<< herdr-superwork ${what}[^\\n]*\\n?`, "g"), "\n").replace(/\n{3,}/g, "\n\n");
  try { fs.copyFileSync(file, `${file}.bak-herdr-superwork`); fs.writeFileSync(file, next); } catch { return false; }
  spawnSync(herdrBin(), ["server", "reload-config"], { encoding: "utf8", timeout: 15000 });
  return true;
}
// Everything the plugin wrote outside its own folders, taken out, and nothing written back at the next start. herdr
// gives a plugin no uninstall hook, so the README says to run this before unlinking.
export function removeExtras() {
  const blocks = removeBlocks();
  removeSkill();
  S.setConfig("skill", "false");
  save({ asked: true, key: "no", sidebarAnswer: "no", sidebar: false });
  return { blocks, skill: "off" };
}
