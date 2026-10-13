// Where a task's worktree starts and what a fresh one is given: the commit it branches from, a free branch name, the
// files it gets a copy of.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as S from "../store.js";
import * as F from "../flow.js";

export const slugOf = (title) => String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
// `workspace.from` is "main" (the default): the remote's default branch, fetched first if the repo has not been fetched in a day (5 seconds
// at most, never asking for a password). With no remote, or with "here": your checkout's current commit.
export function baseRef(root, from) {
  if (from !== "here") {
    try {
      if (F.hasOrigin(root)) {
        let age = Infinity;
        try { age = Date.now() - fs.statSync(path.join(root, ".git", "FETCH_HEAD")).mtimeMs; } catch {}
        if (age > 24 * 3600 * 1000) { try { execFileSync("git", ["fetch", "origin"], { cwd: root, stdio: "ignore", timeout: 5000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -oBatchMode=yes" } }); } catch {} }
        for (const ref of ["origin/HEAD", "origin/main", "origin/master"]) { try { S.gitOut(root, ["rev-parse", "--verify", `refs/remotes/${ref}`]); return ref; } catch {} }
      }
    } catch {}
  }
  return "HEAD";
}
// herdr checks out an existing branch of that name and ignores --base, so the name must be free first.
export function freeBranch(root, t) {
  const slug = slugOf(t.title);
  const stem = `work/${t.n}${slug ? `-${slug}` : ""}`;
  let branch = stem;
  for (let i = 2; ; i++) { try { S.gitOut(root, ["rev-parse", "--verify", `refs/heads/${branch}`]); branch = `${stem}-${i}`; } catch { break; } }
  return branch;
}
// Keep the folder older versions had agents write notes into out of the repo's status, for agents still running with
// that rule, without touching a committed file. The exclude file is shared by all of the repo's worktrees.
export function excludeRuleDir(root) {
  try {
    // In a plain checkout the file is where it always is; only a worktree or another layout is asked of git.
    const own = path.join(root, ".git", "info");
    const file = fs.existsSync(own) ? path.join(own, "exclude") : path.resolve(root, S.gitOut(root, ["rev-parse", "--git-path", "info/exclude"]));
    const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (cur.split("\n").some((l) => l.trim() === `${F.RULE_DIR}/`)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${cur.endsWith("\n") || !cur ? "" : "\n"}${F.RULE_DIR}/\n`);
  } catch {}
}
// Ignored files a fresh worktree lacks (.env and the like): copy those named by `include` and by .worktreeinclude.
export function copyIncludes(root, dir, include) {
  const patterns = [...(include || [])];
  try { patterns.push(...fs.readFileSync(path.join(root, ".worktreeinclude"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))); } catch {}
  if (!patterns.length) return;
  const res = patterns.map((g) => new RegExp("^" + g.replace(/^\//, "").replace(/\/$/, "").split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"));
  let ignored = [];
  try { ignored = S.gitOut(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"]).split("\n").filter(Boolean); } catch {}
  for (const entry of ignored) {
    const rel = entry.replace(/\/$/, "");
    if (rel.startsWith(F.RULE_DIR) || !res.some((re) => re.test(rel) || re.test(path.basename(rel)))) continue;
    try { fs.cpSync(path.join(root, rel), path.join(dir, rel), { recursive: true }); } catch {}
  }
}

