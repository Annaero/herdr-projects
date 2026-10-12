// Telling herdr's own sidebar where a task stands: the label on its pane.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as S from "../store.js";
import * as G from "../gate.js";
import { herdr } from "../herdr.js";
import { isAgentTask, h } from "./task.js";
import { board } from "./live.js";
import { real } from "./spaces.js";

// ---- telling herdr's own sidebar -------------------------------------------------------------------------------------
// While a task waits for approval its pane says so in herdr's sidebar, with no change to the client's herdr settings.
// herdr's default sidebar shows neither state labels nor custom tokens (verified on 0.9.3): only the agent's display
// name. So the label goes three ways: into the display name (shows with no setup), as a state label and as the
// `summary` token (both show once the sidebar rows from docs/install.md are in herdr's config). Once those rows are in
// this machine's config the display name is left alone: beside the state text it would say the label twice.
const sidebarFile = () => path.join(S.dataDir(), "sidebar.json");
export function labelPane(t, text) {
  if (!isAgentTask(t)) return;
  const api = h(t);
  const label = text ? String(text).slice(0, 40) : "";
  try { const seen = S.readJson(sidebarFile(), {}) || {}; seen[`${t.link.socket}|${t.link.pane}`] = label; for (const k of Object.keys(seen).slice(0, -400)) delete seen[k]; S.writeJson(sidebarFile(), seen); } catch {}
  // With the plugin's sidebar rows installed the state text sits beside the agent's name, so a renamed agent would
  // say the label twice on one line ("needs you · claude  needs you"): the name is left alone then.
  const rename = label && !sidebarRows() ? ["--display-agent", `${label} · ${t.agent || "agent"}`] : ["--clear-display-agent"];
  if (label) api.metadata(t.link.pane, ["--state-label", `idle=${label}`, "--state-label", `done=${label}`, "--state-label", `unknown=${label}`, "--state-label", `blocked=${label}`, ...rename]);
  else api.metadata(t.link.pane, ["--clear-state-labels", "--clear-display-agent"]);
  if (t.link.workspace && t.link.ownsWorkspace) { try { api.call(["workspace", "report-metadata", t.link.workspace, "--source", "plugin:herdr-superwork", ...(label ? ["--token", `summary=${label}`] : ["--clear-token", "summary"])]); } catch {} }
}
// Are the plugin's sidebar rows in herdr's config (the first run adds them, between its marker lines)?
let rowsSeen = { at: 0, on: false };
function sidebarRows() {
  if (process.env.HERDR_SUPERWORK_INLINE === "1" && process.env.HERDR_CONFIG_PATH === undefined) return false; // tests never read the real config
  const file = process.env.HERDR_CONFIG_PATH || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "herdr", "config.toml");
  if (Date.now() - rowsSeen.at > 5000 || rowsSeen.file !== file) { let on = false; try { on = fs.readFileSync(file, "utf8").includes("# >>> herdr-superwork sidebar"); } catch {} rowsSeen = { at: Date.now(), on, file }; }
  return rowsSeen.on;
}
// What herdr's sidebar says about a task: one of four labels, each saying what to do. The exact reason is on the
// board. Nothing while the agent simply works, or while the board is busy by itself: herdr's own status says that.
export function labelOf(t) {
  if (S.waitingOf(t)?.who === "agent") return ""; // the board tries again by itself: nothing for you to do
  const rv = S.currentReview(t);
  switch (t.stage) {
    case "approval": return t.mergeFailed || t.prFailure || t.prState === "failing" ? "failed" : t.syncBlocked ? "needs you" : rv && G.isTagged(rv) ? `approve? ${G.word(rv).toLowerCase()}` : rv && Number.isInteger(rv.score) ? `approve? ${rv.score}/5` : "approve?";
    case "asks": case "nosummary": case "reviewneeds": return "needs you";
    case "failed": return t.failure?.auth ? "needs you" : "failed";
    case "reviewing": return "reviewing";
  }
  return "";
}
// Keep every live pane's label current; writes only when the value for that pane id changed (a restored task's new
// pane therefore gets its label). Called by whoever ticks: the keeper, or the board when no keeper is alive.
export function syncSidebar(tasks) {
  const seen = S.readJson(sidebarFile(), {}) || {};
  for (const t of tasks) {
    if (!isAgentTask(t) || t.archivedAt || !t.live || t.live.gone || t.live.down || t.live.away) continue;
    const want = labelOf(t).slice(0, 40);
    if ((seen[`${t.link.socket}|${t.link.pane}`] ?? "") !== want) { try { labelPane(t, want); } catch {} }
  }
}
