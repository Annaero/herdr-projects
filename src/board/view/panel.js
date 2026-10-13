// The task panel: beside the list and full screen. Its parts are in panel-status.js, panel-reviews.js and panel-settings.js.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { clean, age, idLabel, brief } from "./words.js";
import { isAgent, failureFor, reviewing, statusColor, underReview as reviewerAtWork } from "./states.js";
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
  foldPanel() { this.full = false; this.editing = null; this.panelTop = 0; this.load(); }
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
    // The settings page takes the panel's place while it is open (panel-edit.js), its selected row always on screen.
    const editing = this.editing?.id === r.id && r.title !== undefined;
    const lines = editing ? this.settingsPage(r, Math.min(width, READ)) : this.panel(r, Math.min(width, READ), true);
    this.panelHeight = Math.max(1, h - 2);
    this.panelLength = lines.length;
    if (editing) this.panelTop = Math.min(this.editLine, Math.max(this.panelTop, this.editLine - this.panelHeight + 1));
    this.panelTop = Math.max(0, Math.min(this.panelTop, Math.max(0, lines.length - this.panelHeight)));
    const end = Math.min(lines.length, this.panelTop + this.panelHeight);
    const left = " " + t.bold(editing ? "Settings" : "Task details") + t.muted(`  ${r.title === undefined ? idLabel(r.id) : this.idWords(r)}`), right = lines.length > this.panelHeight ? t.muted(`lines ${this.panelTop + 1}–${end} of ${lines.length} `) : "";
    return [left + " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(right))) + right, t.fg("surface1", "─".repeat(width)), ...lines.slice(this.panelTop, end)];
  }
  // The task panel. One shape, beside the list and full screen, and one form for every part: a bold headline on a
  // thin rule, then either facts (a greyed-out label on the left, its value on the right, every value starting in the
  // same column and wrapped under itself) or a text. An empty line stands between two parts and nowhere else. The
  // parts: the title, where it stands (`Status`), what it needs from you (its headline in the state's colour),
  // the description, the report, the reviews, what the agent said, and every setting. Beside the list (`fit` is
  // the height there) the description is short and only the latest review shows; full screen everything is whole,
  // with every review, the newest first.
  panel(r, width, full = false, fit = 0) {
    const p = panelKit(this.theme, width);
    const { t, w, room, dim, wrap, out, head, flow, fact, first, alert, parts, part, text, attempt } = p;

    if (r.title === undefined) { // words on their way to another machine
      const bad = r.state === "error";
      part(wrap(r.text || "").map((l) => t.bold(l)));
      part([head("Status"), ...fact("State", flow([bad ? t.fg("red", `${t.mark("error")} ${t.bold("could not be sent")}`) : t.fg("yellow", `${t.mark("working")} ${t.bold("on its way")}`), dim(`${age(Date.now() - (r.created || Date.now()))} ago`)])),
        ...fact("To", r.remote || "this machine"), ...(r.msg && !bad ? fact("Now", wrap(r.msg, room)) : [])]);
      if (r.msg && bad) alert("red", "Went wrong", r.msg);
      return out(["", ...parts.flatMap((s, n) => (n ? ["", ...s.lines] : s.lines))]);
    }
    const agent = isAgent(r), failure = failureFor(r), c = statusColor(r);
    const underReview = reviewerAtWork(r);
    const approval = r.state === "blocked" && r.stage === "approval";
    let cut = false; // beside the list: something is shorter here than on the full screen
    Object.assign(p, { r, width, full, agent, failure, c, underReview, approval });

    // Each part is drawn on its own (`attempt`): one that fails says so in its place and takes nothing else with it.
    const { title, top, told } = attempt("Status", () => this.panelStatus(p), null) || { title: part([t.bold(clean(r.title || "(no title)"))]), top: { lines: [], rows: {}, drop() {} }, told: "" };

    // The description: whole on the full screen, its first few hundred characters beside the list.
    const desc = this.desc(r).trim();
    const start = full ? desc : brief(desc, 400);
    if (start !== desc) cut = true;
    if (desc) text("Description", wrap(start), 2);

    attempt("Report", () => this.panelReport(p));
    if (attempt("Reviews", () => this.panelReviews(p))) cut = true;

    // What the agent said, or the reviewer while the task is under review: the newest words of its conversation
    // (talk.js), under a headline that names whose they are. Never its screen, but for a program that cannot be read.
    if (agent && !(r.state === "error" && r.stage !== "nosummary") && !this.chatShows(r)) attempt("The agent said", () => {
      const pv = this.previewOf(r), screen = pv.raw;
      const whole = (pv.note === "empty" && pv.who === "agent" ? "" : pv.text) || (approval ? r.summary : "") || "";
      const shown = full || screen ? whole : brief(whole, 400);
      if (shown !== whole) cut = true;
      if (whole && whole !== told) text(screen ? `On the ${pv.who}'s screen now` : pv.who === "reviewer" ? "The reviewer says" : "The agent said", wrap(shown), 1, screen ? "end" : "start");
    });

    const { settings, rows, table, cut: shorter } = attempt("Settings", () => this.panelSettings(p), null) || { settings: { lines: [] }, rows: [], table: () => [] };
    if (shorter) cut = true;

    let lead = [""], gap = true;
    const render = () => [...lead, ...parts.filter((s) => s.lines.length).flatMap((s, n) => (n && gap ? ["", ...s.lines] : s.lines))];
    if (full) return out(render());
    const more = dim(truncateToWidth(`${keyName("panel")} shows the whole task`, w, "…"));
    if (!fit || render().length + (cut ? 2 : 0) <= fit) return out([...render(), ...(cut ? ["", more] : [])]);
    // Too tall for its place beside the list. Nothing is cut in the middle of a line: whole lines and whole facts give
    // way, the least needed first, and the last line says where the rest is. First the empty line on top. Then the
    // long parts give up lines (what the agent said, the description, the review), each down to a
    // few lines; then all of them but the review go. Then the facts that are said elsewhere: the task's id and who is
    // on it, and the rows among the settings that are not settings. Then the settings, from the last, each one whole,
    // and their headline with the last of them. Only then is the review down to its one row.
    const space = Math.max(1, fit - 1);
    const over = () => render().length - space;
    const flexible = parts.filter((s) => s.at).sort((a, b) => a.pri - b.pri);
    if (over() > 0) lead = [];
    for (const s of flexible) if (over() > 0 && s.lines.length > s.min) s.lines = s.at(Math.max(s.min, s.lines.length - over()));
    for (const s of flexible) if (over() > 0 && !s.last) s.lines = s.at(0);
    if (over() > 0) top.drop("task", "who", "made", "next");
    let kept = rows;
    const redraw = () => { settings.lines = kept.length ? [head("Settings"), ...table(kept)] : []; };
    if (over() > 0 && settings.lines.length) { kept = rows.filter(([k]) => !NOT_SETTINGS.includes(k)); redraw(); }
    while (over() > 0 && kept.length && settings.lines.length) { kept = kept.slice(0, -1); redraw(); }
    for (const s of flexible) if (over() > 0 && s.last) s.lines = s.at(s.last);
    // A very short window. What it needs from you gives up lines, down to its first two. Then the empty lines between
    // the parts go, the Status headline, all but the first line of the title, and every other part but the review's
    // row; then the change, the review's row, and the title: the state, the progress and what the task is doing now
    // are the last to stay.
    for (const s of parts) if (over() > 0 && s.alert) s.lines = s.alert(Math.max(2, s.lines.length - over()));
    if (over() > 0) gap = false;
    if (over() > 0) top.drop("head");
    if (over() > 0) title.lines = [truncateToWidth(title.lines[0] || "", w, "…")];
    for (const s of parts) if (over() > 0 && ![title, top].includes(s) && !s.last) s.lines = [];
    if (over() > 0) top.drop("change");
    for (const s of parts) if (over() > 0 && s.last) s.lines = [];
    if (over() > 0) title.lines = [];
    // Shorter still, with what it is doing now on show: the last line goes, then the progress, then the state. A text
    // longer than the whole panel is the only one cut, and its last line says so.
    if (top.rows.now && over() > 0) {
      for (const k of ["progress", "state"]) if (render().length > fit) top.drop(k);
      if (render().length > fit) { top.rows.now = first(top.rows.now, fit); top.draw(); }
      return out(render());
    }
    const shown = render().slice(0, space);
    return out([...shown, ...(shown.length + 2 <= fit ? [""] : []), more]);
  }
}
