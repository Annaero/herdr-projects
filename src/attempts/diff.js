// An attempt's change as a page of its own: the whole diff as text, kept in the attempt's folder on the board and
// served like a review's evidence, so each attempt in the task panel has a link to what it changed.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import { artifactBase } from "../review-page.js";

export const DIFF_FILE = "diff.txt";
// Returns what the attempt remembers ({ file, link }), or null when there is nothing to show.
export function keepDiff(t, range) {
  if (!t.worktree || !range) return null;
  try {
    const text = S.gitOut(t.worktree, ["diff", "--stat", "--patch", range], { maxBuffer: 64 * 1024 * 1024 });
    if (!text.trim()) return null;
    const file = path.join(S.artifactsDir(t.id), DIFF_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `Attempt ${t.letter} of ${t.attemptOf}: ${t.title}\nBranch ${t.branch}, ${range}\n\n${text}\n`);
    let root = "";
    try { root = artifactBase(t.id) || ""; } catch {}
    return { file, link: root ? `${root}/${DIFF_FILE}` : file };
  } catch { return null; }
}
