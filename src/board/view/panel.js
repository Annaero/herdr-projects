// The task panel: beside the list and full screen. Its parts are in panel-status.js, panel-reviews.js and panel-settings.js.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { short, clean, age, idLabel, bar, brief } from "./words.js";
import { isAgent, failureFor, reviewing, statusColor } from "./states.js";
import { WIDE } from "./size.js";
import { panelKit } from "./panel-kit.js";
import { name as keyName, is as isKey } from "../keys.js";

// The rows among a task's settings that are not settings: in a window too short for all of them, these go first.
const NOT_SETTINGS = ["Branch", "Note"];
// The widest the task details are drawn full screen: text wider than this is hard to read.
const READ = 100;

export class Panel {
  // The side panel, on demand. Your choice is remembered.
  toggleSide() {
    this.side = !this.side; this.savePrefs();
    if (this.side && this.width < WIDE) return this.flash(`The side panel needs a wider window. ${keyName("panel")} shows the task full screen.`, "yellow");
    this.flash(this.side ? `Side panel on. ${keyName("side")} hides it.` : `Side panel off. ${keyName("side")} shows it.`);
  }
  // Only the whole panel goes: who the chat talks to is space's to change, never the panel's.
  foldPanel() { this.full = false; this.panelTop = 0; this.load(); }
  openPanel() { const r = this.current(); if (!r && !this.job()) return this.flash("Select a task first."); this.full = true; this.panelTop = 0; }
  desc(r) { return String(r.description || ""); }
  scrollPanel(data) { this.scrollPanelBy(isKey(data, "up") ? -1 : 1); }
  scrollPanelBy(by) {
    const last = Math.max(0, this.panelLength - this.panelHeight);
    this.panelTop = Math.max(0, Math.min(last, this.panelTop + by));
  }
  // The task details, full screen: the same parts as beside the list, each whole, and every review the task had.
  // Text keeps to a width that reads well, however wide the window is.
  fullPanel(r, width, h) {
    const t = this.theme;
    const lines = this.panel(r, Math.min(width, READ), true);
    this.panelHeight = Math.max(1, h - 2);
    this.panelLength = lines.length;
    this.panelTop = Math.max(0, Math.min(this.panelTop, Math.max(0, lines.length - this.panelHeight)));
    const end = Math.min(lines.length, this.panelTop + this.panelHeight);
    const left = " " + t.bold("Task details") + t.muted(`  ${idLabel(r.id)}`), right = lines.length > this.panelHeight ? t.muted(`lines ${this.panelTop + 1}–${end} of ${lines.length} `) : "";
    return [left + " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(right))) + right, t.fg("surface1", "─".repeat(width)), ...lines.slice(this.panelTop, end)];
  }
  // The task panel. One shape, beside the list and full screen, in parts that each stand on their own: the title and
  // where it stands (under `Status`), what it needs from you (behind a bar in its state's colour), the description, the reviews (each
  // one a box), what the agent said, and every setting. A part starts with a bold headline on a thin rule; labels are
  // greyed out and a setting that is only your default is quieter than one chosen for this task. Beside the list
  // (`fit` is the height there) the description is short and only the latest review shows; the long parts give up
  // lines to the height, never a setting. Full screen everything is whole, with every review, the newest first.
  panel(r, width, full = false, fit = 0) {
    const p = panelKit(this.theme, width);
    const { t, w, dim, wrap, out, head, flow, first, callout, parts, part, text, attempt } = p;

    if (r.title === undefined) { // words on their way to another machine
      const bad = r.state === "error";
      part([...wrap(r.text || ""), ...flow([bad ? t.fg("red", `${t.mark("error")} ${t.bold("could not be sent")}`) : t.fg("yellow", `${t.mark("working")} ${t.bold("on its way")}`), dim(r.remote ? `to ${r.remote}` : "on this machine"), dim(`${age(Date.now() - (r.created || Date.now()))} ago`)])]);
      if (r.msg) part(callout(bad ? "red" : "yellow", bad ? "Went wrong" : "Now", r.msg));
      return out(["", ...parts.flatMap((s, n) => (n ? ["", ...s.lines] : s.lines))]);
    }
    const agent = isAgent(r), failure = failureFor(r), c = statusColor(r);
    const underReview = reviewing(r) && r.state === "working";
    const approval = r.state === "blocked" && r.stage === "approval";
    let cut = false; // beside the list: something is shorter here than on the full screen
    Object.assign(p, { r, width, full, agent, failure, c, underReview, approval });

    // Each part is drawn on its own (`attempt`): one that fails says so in its place and takes nothing else with it.
    const { title, top, stand, told } = attempt("Status", () => this.panelStatus(p), null) || { title: part([t.bold(clean(r.title || "(no title)"))]), top: { lines: [] }, stand: [], told: "" };
    if (attempt("Suggestions", () => this.panelSuggestions(p))) cut = true;

    // The description: whole on the full screen, its first few hundred characters beside the list.
    const desc = this.desc(r).trim();
    const start = full ? desc : brief(desc, 400);
    if (start !== desc) cut = true;
    if (desc) text("Description", wrap(start), 2);
    else if (!agent && !r.archivedAt && r.state === "idle") part(wrap(`No agent is on this yet. ${keyName("delegate")} puts one on it.`).map((l) => dim(l)), { pri: 1, min: 1, at: () => [] });

    if (attempt("Reviews", () => this.panelReviews(p))) cut = true;

    // What the agent said: its last message, or its screen while a dialog or a review is on it.
    if (agent && !(r.state === "error" && r.stage !== "nosummary") && !this.chatShows(r)) attempt("The agent said", () => {
      const pv = this.previewOf(r), screen = pv.label === "on its screen now";
      const whole = pv.text || (approval ? r.summary : "") || "";
      const shown = full || screen ? whole : brief(whole, 400);
      if (shown !== whole) cut = true;
      if (whole && whole !== told) text(screen ? "On its screen now" : "The agent said", wrap(shown), 1, screen ? "end" : "start");
    });

    const { settings, rows, table } = attempt("Settings", () => this.panelSettings(p), null) || { settings: { lines: [] }, rows: [], table: () => [] };

    let lead = [""], gap = true;
    const render = () => [...lead, ...parts.filter((s) => s.lines.length).flatMap((s, n) => (n && gap ? ["", ...s.lines] : s.lines))];
    if (full) return out(render());
    const more = dim(truncateToWidth(`${keyName("panel")} shows the whole task`, w, "…"));
    if (!fit || render().length + (cut ? 2 : 0) <= fit) return out([...render(), ...(cut ? ["", more] : [])]);
    // Too tall for its place beside the list. The status and what the task is doing now stay whole, and no setting
    // goes: the long parts give up lines, the least needed first (what the agent said, the description, the review,
    // what it needs from you), each down to a few lines; then every setting keeps to one line; then the long parts
    // go altogether, the review down to one line. The last line says where the rest is.
    const space = Math.max(1, fit - 1);
    const over = () => render().length - space;
    const flexible = parts.filter((s) => s.at).sort((a, b) => a.pri - b.pri);
    for (const s of flexible) if (over() > 0 && s.lines.length > s.min) s.lines = s.at(Math.max(s.min, s.lines.length - over()));
    if (over() > 0) settings.lines = [head("Settings"), ...table(rows, 1)];
    for (const s of flexible) if (over() > 0) s.lines = s.at(s.last || 0);
    // A very short window. Before any setting goes: the empty lines, the two headlines, all but the first line of
    // the title, every other part but the review's one line, and the rows that are not settings. Then the settings
    // go, from the last, then the size of the change and its pull request, the review's line, and the title: the
    // state's line with its progress and what the task is doing now are the last to stay.
    if (over() > 0) lead = [];
    if (over() > 0) gap = false;
    if (over() > 0) settings.lines.shift();
    if (over() > 0) top.lines.shift();
    if (over() > 0) title.lines = [truncateToWidth(t.bold(clean(r.title || "(no title)")), w, "…")];
    for (const s of parts) if (over() > 0 && ![title, top, settings].includes(s) && !s.last && !s.keep) s.lines = [];
    if (over() > 0) settings.lines = table(rows.filter(([k]) => !NOT_SETTINGS.includes(k)), 1);
    if (over() > 0) settings.lines = settings.lines.slice(0, Math.max(0, settings.lines.length - over()));
    if (over() > 0) top.lines = stand;
    for (const s of parts) if (over() > 0 && s.last) s.lines = [];
    if (over() > 0) title.lines = [];
    // Shorter still, with what it is doing now on show: the last line goes, then the status from its last line,
    // then the word Now. A text longer than the whole panel is the only one cut, and its last line says so.
    const now = parts.find((s) => s.keep);
    if (now && over() > 0) {
      while (render().length > fit && top.lines.length) top.lines.pop();
      if (render().length > fit) now.lines = now.lines.length - 1 <= fit ? now.lines.slice(1) : first(now.lines, fit);
      return out(render());
    }
    return out([...render().slice(0, space), more]);
  }
}
