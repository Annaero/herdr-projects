// Telling herdr's own sidebar where a task stands: the label and the line on its pane, and the task's name.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as S from "../store.js";
import * as G from "../gate.js";
import { herdr } from "../herdr.js";
import { isAgentTask, h } from "./task.js";
import { board } from "./live.js";
import { real } from "./spaces.js";
import { sidebarWords } from "../status-words.js";

// ---- telling herdr's own sidebar -------------------------------------------------------------------------------------
// While a task waits for you its pane says so in herdr's sidebar, in the words the board's own State line uses
// (status-words.js), with no change to the client's herdr settings. herdr's default sidebar shows neither state
// labels nor custom tokens (verified on 0.9.3): only the agent's display name. So the label goes three ways: into
// the display name (shows with no setup), as a state label, and, with what the task says, as the `summary` token,
// which has a row of its own and so is never cut short (both show once the sidebar rows from docs/install.md are in
// herdr's config). The task is named there as on the board: `#34`, or `HSW-34` where its repo has a key.
//
// The `summary`, `progress` and `eta` tokens of a pane have three writers: the Watcher while an agent works
// (helpers.js) and the check while it runs (finish/check-run.js), both with a time to live of three minutes, and
// this file. Checked on herdr 0.9.3: a token goes when its time is up, but nothing took it away sooner, so a task
// that had stopped working kept its last working line ("Just started") for up to three minutes; and on the space,
// the label (written to stay) and the Watcher's line (written to run out) were one token, so whichever came last
// stood. Now a task that leaves working has those tokens taken off or replaced here, at once.
const sidebarFile = () => path.join(S.dataDir(), "sidebar.json");
const TOKENS = ["summary", "progress", "eta"];
const clearTokens = TOKENS.flatMap((name) => ["--clear-token", name]);
const key = (t) => `${t.link.socket}|${t.link.pane}`;
const remember = (t, value) => { try { const seen = S.readJson(sidebarFile(), {}) || {}; seen[key(t)] = value; for (const k of Object.keys(seen).slice(0, -400)) delete seen[k]; S.writeJson(sidebarFile(), seen); } catch {} };
// `text`: where the task stands (empty or null: its agent works, or it is no longer the board's to label). `line`: what it says.
export function labelPane(t, text, line = "") {
  if (!isAgentTask(t)) return;
  const api = h(t);
  const label = text ? String(text).slice(0, 40) : "", said = label ? String(line || "").slice(0, 200) : "";
  remember(t, label ? `${label}|${said}` : "");
  const tag = S.tagOf(t.id) || t.id;
  // With the plugin's sidebar rows installed the state text sits beside the agent's name, so the name is the
  // task's alone; without them the name is all that shows, and carries the label too.
  const name = ["--display-agent", label && !sidebarRows() ? `${tag} · ${label}` : tag];
  // What it says has a row of its own, whole; with nothing to say that row shows where it stands.
  const tokens = label ? ["--token", `summary=${said || label}`, "--clear-token", "progress", "--clear-token", "eta"] : clearTokens;
  if (label) api.metadata(t.link.pane, ["--state-label", `idle=${label}`, "--state-label", `done=${label}`, "--state-label", `unknown=${label}`, "--state-label", `blocked=${label}`, ...name, ...tokens]);
  else api.metadata(t.link.pane, ["--clear-state-labels", ...name, ...tokens]);
  if (t.link.workspace && t.link.ownsWorkspace) { try { api.call(["workspace", "report-metadata", t.link.workspace, "--source", "plugin:herdr-superwork", ...(label ? ["--token", `summary=${said ? `${label} · ${said}` : label}`] : ["--clear-token", "summary"])]); } catch {} }
}
// A task's panes by its name: the pane's title and the agent's shown name are the task's tag and title, so herdr's
// sidebar and the web UI's read `#34 Add a file…` and not the agent's inner name (`sw-repo-34`). Once per pane.
function namePanes(t, seen) {
  const tag = S.tagOf(t.id) || t.id, title = `${tag} ${S.oneLine(t.title || "", 60)}`.trim(), api = h(t);
  for (const [pane, shown, name] of [[t.link.pane, title, tag], [t.link.reviewer?.pane, `${tag} review ${S.reviewNumber(t) || ""}`.trim(), `${tag} reviewer`]]) {
    const k = `name|${t.link.socket}|${pane}`;
    if (!pane || seen[k] === shown) continue;
    try { api.metadata(pane, ["--title", shown, ...(pane === t.link.pane ? [] : ["--display-agent", name])]); seen[k] = shown; } catch {}
  }
}
// Are the plugin's sidebar rows in herdr's config (the first run adds them, between its marker lines)?
let rowsSeen = { at: 0, on: false };
function sidebarRows() {
  if (process.env.HERDR_SUPERWORK_INLINE === "1" && process.env.HERDR_CONFIG_PATH === undefined) return false; // tests never read the real config
  const file = process.env.HERDR_CONFIG_PATH || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "herdr", "config.toml");
  if (Date.now() - rowsSeen.at > 5000 || rowsSeen.file !== file) { let on = false; try { on = fs.readFileSync(file, "utf8").includes("# >>> herdr-superwork sidebar"); } catch {} rowsSeen = { at: Date.now(), on, file }; }
  return rowsSeen.on;
}
// What herdr's sidebar says about a task: where it stands, in the board's own words. Nothing while the agent simply
// works, or while the board is busy by itself: herdr's own status says that.
export const labelOf = (t) => sidebarWords(t).label;
export const lineOf = (t) => sidebarWords(t).line;
// A task's pane labelled with where it stands now. `or`: the words for a task whose stage has none of its own.
export function labelTask(t, or = "") { const w = sidebarWords(t); labelPane(t, w.label || or, w.line); }
// The stages in which somebody's working line is the pane's to show: the Watcher's, or the check's.
const WORKING = ["working", "checking", "starting", "setup", "pushing", "merging", "queued"];
// Keep every live pane's label current; writes only when the value for that pane id changed (a restored task's new
// pane therefore gets its label). Called by whoever ticks: the keeper, or the board when no keeper is alive.
// A task that neither works nor has a label (stopped, done, put back) has its working line taken off once: "idle".
export function syncSidebar(tasks) {
  const seen = S.readJson(sidebarFile(), {}) || {}, names = { ...seen };
  for (const t of tasks) {
    if (!isAgentTask(t) || t.archivedAt || !t.live || t.live.gone || t.live.down || t.live.away) continue;
    const { label, line } = sidebarWords(t), want = label ? `${label.slice(0, 40)}|${line.slice(0, 200)}` : WORKING.includes(t.stage) ? "" : "idle";
    if ((seen[key(t)] ?? "") !== want) { try { labelPane(t, label, line); if (want === "idle") remember(t, "idle"); } catch {} }
    try { namePanes(t, names); } catch {}
  }
  // The names are kept in the same file: read again, so the labels written a line above are not lost.
  try { const now = S.readJson(sidebarFile(), {}) || {}; let changed = false; for (const [k, v] of Object.entries(names)) if (k.startsWith("name|") && now[k] !== v) { now[k] = v; changed = true; } if (changed) S.writeJson(sidebarFile(), now); } catch {}
}
