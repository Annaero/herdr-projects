// Telling herdr's own sidebar about a task: one entry per live agent, a small copy of the task's row on the board.
import path from "node:path";
import * as S from "../store.js";
import { herdr, currentSocket, sessionName } from "../herdr.js";
import { isAgentTask } from "./task.js";
import { saved } from "./live.js";
import { entryOf, reviewerEntry, taskName } from "./sidebar-entry.js";

// ---- telling herdr's own sidebar -------------------------------------------------------------------------------------
// An entry has three rows, the board row's three facts (sidebar-entry.js makes the words):
//   1. herdr's own dot, then the task's number and title. That is the name of the task's space, which the board
//      keeps as `#34 Add a file…` (the task's tab names, `Agent` and `Reviewer #1`, are hidden by the sidebar rows).
//   2. who is on it and where it stands, then the review round, the pull request and the tags: the agent's shown name.
//   3. the row's second line, then the percent and the time left: the pane's `summary` and `progress` tokens.
// herdr's default sidebar shows the first two (verified on 0.9.3: it shows no custom tokens). The third, and row 1
// without the tab's name, show once the sidebar rows from docs/install.md are in herdr's config. The dot is herdr's
// own reading of the pane: the board writes no state to herdr (docs/checked-on-herdr.md says why).
//
// This file is the only writer of a task's panes and space. The Watcher and the check keep what they find on the
// task; the board shows it on the row, and the row is what is written here: by whoever ticks, once a second
// (`syncSidebar`, which is also how often an open board draws its rows again), and at once where a task comes to
// wait for you, goes wrong, is taken up again or ends (`tellSidebar`). Written to stay, and written again only when
// a word changed; taken off again when the task is archived or removed while its pane lives on.
const sidebarFile = () => path.join(S.dataDir(), "sidebar.json");
const SOURCE = "plugin:herdr-superwork";
const token = (name, value) => (value ? ["--token", `${name}=${value}`] : ["--clear-token", name]);
// `eta` was a token of its own in older versions: it is now part of `progress` ("8% 16m left"), as the row writes it.
// Row 2 as herdr keeps it: where the task stands, then the row's time, last, so that it is the first thing cut.
export const shownName = (e) => [e.stands, e.age].filter(Boolean).join(" · ").slice(0, 80);
const paneArgs = (e, title) => ["--clear-state-labels", "--display-agent", shownName(e), ...(title ? ["--title", title] : []), ...token("summary", e.line), ...token("progress", e.progress), "--clear-token", "eta"];
const CLEAR = ["--clear-state-labels", "--clear-display-agent", "--clear-title", "--clear-token", "summary", "--clear-token", "progress", "--clear-token", "eta"];
// What a task's panes and space are to say: [key, what is written there, how].
function wanted(t, now) {
  const socket = t.link.socket, api = herdr(socket), e = entryOf(t, { now }), out = [];
  out.push([`e|${socket}|${t.link.pane}`, e, () => api.metadata(t.link.pane, paneArgs(e, e.name))]);
  const rv = t.link.reviewer?.pane;
  if (rv) { const r = reviewerEntry(t, { now }); out.push([`e|${socket}|${rv}`, r, () => api.metadata(rv, paneArgs(r, e.name))]); }
  // The task's space: its name is the task's number and title, and under it the row's second line. One writer.
  const ws = t.link.ownsWorkspace && t.link.workspace;
  if (ws) {
    out.push([`n|${socket}|${ws}`, e.name, () => api.call(["workspace", "rename", ws, e.name]) || true]);
    out.push([`w|${socket}|${ws}`, [e.line, e.progress], () => api.call(["workspace", "report-metadata", ws, "--source", SOURCE, ...token("summary", e.line), ...token("progress", e.progress)]) || true]);
  }
  return out;
}
// What was written, by where: `e` a task's pane, `n` its space's name, `w` its space's tokens, `c` the Coordinator's pane.
const read = () => { const all = S.readJson(sidebarFile(), {}) || {}; return Object.fromEntries(Object.entries(all).filter(([k]) => /^[enwc]\|/.test(k))); };
// Writes what changed, and remembers what herdr took: what it did not take (herdr gone for a moment) is written
// again by the next tick that reads the pane alive.
function write(list, seen) {
  let changed = false;
  for (const [key, value, how] of list) {
    const sig = JSON.stringify(value);
    if (seen[key] === sig) continue;
    try { if (!how()) continue; } catch { continue; }
    seen[key] = sig; changed = true;
  }
  return changed;
}
const told = (t) => isAgentTask(t) && !t.archivedAt;
// Did herdr lose what was written to a pane? `have`: herdr's own reading of the pane (`pane list`, `agent get`), which
// carries the shown name it was given (checked on 0.9.3). Written, by the cache, and no longer there: herdr was
// started again since, and a pane starts with nothing. The cache alone would never write the same words again.
const forgotten = (sig, have) => !!sig && !!have && !have.display_agent && !!JSON.parse(sig).stands;
// A task that just changed, said in herdr's sidebar at once, by whoever changed it: by what was saved, with no look
// at herdr (the next tick, within a second, reads herdr too). Never throws: a sidebar is a convenience.
export function tellSidebar(t, now = Date.now()) {
  try {
    if (!t || !told(t)) return;
    const seen = read();
    if (write(wanted(saved(t), now), seen)) S.writeJson(sidebarFile(), seen);
  } catch {}
}
// Keeps every live pane of one herdr session current: the tasks as that session sees them (flow/live.js: boardFor).
// Called by whoever ticks: the keeper, or the board when no keeper is alive. A pane that is no longer a live task's
// (archived, removed, its reviewer gone) has what the board wrote taken off, once.
export function syncSidebar(tasks, { socket = tasks.find((t) => t.live && !t.live.away)?.link?.socket || currentSocket(), now = Date.now() } = {}) {
  const seen = read(), list = [];
  let down = false, lost = false;
  // A task's attempts have panes of their own (attempts.js): each has an entry like a task's. A task that waits for
  // your pick has no pane yet: its space says so.
  const all = tasks.flatMap((t) => [t, ...(t.tries || []).filter((c) => !c.chosen).map((c) => ({ ...c, parentStage: t.stage }))]);
  for (const t of tasks) if (t.stage === "pick" && !isAgentTask(t) && t.link?.workspace && t.link.socket === socket && !t.archivedAt) list.push([`w|${socket}|${t.link.workspace}`, [t.note, ""], () => herdr(socket).call(["workspace", "report-metadata", t.link.workspace, "--source", SOURCE, ...token("summary", t.note), ...token("progress", "")]) || true]);
  for (const t of all) {
    if (!isAgentTask(t) || t.link.socket !== socket) continue;
    if (t.live?.down) down = true;
    if (!told(t) || !t.live || t.live.gone || t.live.down || t.live.away) continue;
    if (forgotten(seen[`e|${socket}|${t.link.pane}`], t.live.pane)) lost = true;
    try { list.push(...wanted(t, now)); } catch {}
  }
  // herdr restarted: it kept none of what was written, so all of it is written again, whether a word changed or not.
  if (lost && S.due(`sidebar-again-${sessionName(socket)}`, 10000)) for (const key of Object.keys(seen)) if (key.split("|")[1] === socket) delete seen[key];
  let changed = write(list, seen) || lost;
  if (!down) {
    const keep = new Set(list.map(([key]) => key)), api = herdr(socket);
    for (const key of Object.keys(seen)) {
      const [kind, at, id] = key.split("|");
      if (at !== socket || keep.has(key) || kind === "c") continue;
      if (kind === "e") api.metadata(id, CLEAR);
      if (kind === "w") { try { api.call(["workspace", "report-metadata", id, "--source", SOURCE, "--clear-token", "summary", "--clear-token", "progress"]); } catch {} }
      delete seen[key]; changed = true;
    }
  }
  if (changed) { try { S.writeJson(sidebarFile(), seen); } catch {} }
}
// The name a task's space is opened under: what its row starts with.
export const spaceLabel = (t) => taskName(t);
// The same for a pane that is no task's: the Coordinator's (coordinator/sidebar.js). `entry` as sidebar-entry.js makes it.
export function tellPane(socket, pane, entry, have = null) {
  try {
    const seen = read();
    if (forgotten(seen[`c|${socket}|${pane}`], have)) delete seen[`c|${socket}|${pane}`];
    if (write([[`c|${socket}|${pane}`, entry, () => herdr(socket).metadata(pane, paneArgs(entry, entry.name))]], seen)) S.writeJson(sidebarFile(), seen);
  } catch {}
}
// What `tellSidebar` says of a task: its entry by what was saved alone.
export const entryNow = (t, now = Date.now()) => entryOf(saved(t), { now });
