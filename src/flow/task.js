// A task's own places and its herdr: the closing note, the review folder, whether an agent is on it.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import { herdr } from "../herdr.js";

// What an agent writes for the board goes in the task's own folder inside the board's data folder, never into the
// folder it works in: a task that works in the home folder would write into the board's own home (docs/home-folder.md).
export const noteFile = (t) => path.resolve(S.dirOf(t.id), "closing-note.md");
export const reviewDir = (t) => path.resolve(S.dirOf(t.id), "review");
// Where older versions told agents to write: `<working folder>/.herdr-superwork/closing-<n>.md`. An agent started
// with that rule still writes there, so a note there is read until its task is done; a task first started by this
// version (`ownNote`) is never looked for there. Nothing is written there any more.
export const RULE_DIR = ".herdr-superwork";
export const oldNoteFile = (t) => path.join(S.cwdOf(t), RULE_DIR, `closing-${t.n}.md`);
const statOf = (file) => { try { const s = fs.statSync(file); return { mtime: s.mtimeMs, text: fs.readFileSync(file, "utf8").trim() }; } catch { return null; } };
// The closing note, wherever its agent was told to write it: the newer one when both places have one.
export function noteStat(t) {
  const now = statOf(noteFile(t)), old = t.ownNote ? null : statOf(oldNoteFile(t));
  return old && (!now || old.mtime > now.mtime) ? old : now;
}
// A task that was cleaned up leaves no note behind. In the old place only the note of a task that was told to write
// there is its own: a task this version started (`ownNote`) removes nothing from it. The old folder goes only when it
// is empty: whatever is in it is not the board's to remove (in the home folder it is the board's own home).
export function clearNotes(t) {
  for (const f of [noteFile(t), reviewDir(t), ...(t.ownNote ? [] : [oldNoteFile(t)])]) { try { fs.rmSync(f, { recursive: true, force: true }); } catch {} }
  try { fs.rmdirSync(path.join(S.cwdOf(t), RULE_DIR)); } catch {}
}
export const isAgentTask = (t) => !!t.link?.pane;
export const h = (t) => herdr(t.link?.socket || null);
