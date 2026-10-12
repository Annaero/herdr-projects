// Git plumbing, and repos: the first part of a task's id.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { dataDir, readJson, writeJson, withLock } from "./files.js";

// ---- git plumbing ---------------------------------------------------------------------------------------------------
export const gitOut = (cwd, args, opts = {}) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
export function gitRoot(folder) { for (let d = path.resolve(folder); ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, ".git"))) return d; if (d === path.dirname(d)) return path.resolve(folder); } }
// The primary checkout of a folder: for a linked worktree, the repo it belongs to.
export function primaryRoot(folder) {
  const root = gitRoot(folder);
  try {
    if (fs.statSync(path.join(root, ".git")).isFile()) {
      const common = gitOut(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      if (path.basename(common) === ".git") return path.dirname(common);
    }
  } catch {}
  return root;
}
export const isRepo = (folder) => fs.existsSync(path.join(gitRoot(folder), ".git"));
export function canWorktree(folder) { try { return fs.statSync(path.join(gitRoot(folder), ".git")).isDirectory(); } catch { return false; } }
export function branchOf(folder) {
  try {
    let git = path.join(folder, ".git");
    if (fs.statSync(git).isFile()) git = path.resolve(folder, fs.readFileSync(git, "utf8").replace(/^gitdir:\s*/, "").trim());
    const head = fs.readFileSync(path.join(git, "HEAD"), "utf8").trim();
    return head.startsWith("ref: refs/heads/") ? head.slice(16) : head.slice(0, 8);
  } catch { return ""; }
}

// ---- repos: the first part of a task's id ---------------------------------------------------------------------------
const reposFile = () => path.join(dataDir(), "repos.json");
export const knownRepos = () => readJson(reposFile(), {});
export function repoOf(folder) {
  const root = primaryRoot(folder);
  return withLock("repos", () => {
    const map = knownRepos();
    const real = (d) => { try { return fs.realpathSync(d); } catch { return d; } };
    let name = Object.keys(map).find((k) => map[k] === root || real(map[k]) === real(root));
    if (!name) {
      const base = path.basename(root).replace(/[^A-Za-z0-9_.+-]/g, "-").slice(0, 28) || "home";
      name = base;
      for (let n = 2; map[name] || name === "dispatch"; n++) name = `${base}-${n}`;
      map[name] = root; writeJson(reposFile(), map);
    }
    return { name, root };
  });
}
export const folderOf = (id) => knownRepos()[String(id).split("/")[0]] || os.homedir();
// Where a task's agent runs: its worktree when it has one, else the repo folder.
export const cwdOf = (t) => (t.worktree && fs.existsSync(t.worktree) ? t.worktree : folderOf(t.id));
// A repo given by its name on the board, or by a folder path ("~" is your home folder).
export function folderFor(ref, fallback) {
  const want = String(ref || "").trim();
  if (!want) return fallback;
  const map = knownRepos();
  const byName = Object.keys(map).find((k) => k.toLowerCase() === want.toLowerCase());
  if (byName) return map[byName];
  const dir = path.resolve(want.replace(/^~(?=\/|$)/, os.homedir()));
  if ((want.startsWith("/") || want.startsWith("~") || want.startsWith(".")) && fs.existsSync(dir)) return dir;
  for (const base of [...new Set([...Object.values(map).map((p) => path.dirname(p)), path.dirname(fallback || os.homedir()), path.join(os.homedir(), "dev"), os.homedir()])]) {
    const guess = path.join(base, want);
    if (fs.existsSync(guess) && fs.statSync(guess).isDirectory()) return guess;
  }
  throw new Error(`No repo or folder "${want}". Known repos: ${Object.keys(map).join(", ") || "none yet"}. A full path works too.`);
}
