// The text box you type in.
import { CURSOR_MARKER, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isAgent, reviewing, statusColor } from "./states.js";
import { AGENT_TAB } from "../../flow/tabs.js";
import { COORDINATOR_TAB } from "../../coordinator/place.js";

// The grey words of an empty box that sends a message: they name who gets it, by the name of its tab. While a task is
// under review the chat shows its reviewer, and a message still goes to its agent (a reviewer takes none: it judges
// the work as it is), which ends the review: the words say both.
const sendTo = (who) => `Send message to ${who}`;

export class TextBox {
  // Who the box sends to, said by colour as well as in words: its frame and its prompt mark. To the Coordinator (and
  // wherever it sends to no task's agent: find, a new task, a task whose message goes to the Coordinator or into its
  // description) it is the theme's plain text colour. To a task's agent, and on a task whose message starts one, it
  // is that task's status colour, the very one its mark has in the list (states.js), so the box also says how the
  // task is doing and changes with it: the box and the mark are never two colours. The words say the same without
  // colour, and they are what tells the box of a task the board is checking (a plain light grey, near the plain text
  // colour) from the Coordinator's.
  boxColor(r) {
    if (this.mode === "find" || !this.reply || !r) return "text";
    return r.archivedAt || this.hasAgent(r) || (!r.host && !isAgent(r) && ["todo", "progress"].includes(r.stage)) ? statusColor(r) : "text";
  }
  // The text box. Its prompt is only ❯: who gets your words is said by its grey words while it is empty, and by the
  // chat's first line, right above it.
  boxLines(width, maxRows, r) {
    const t = this.theme;
    const replying = this.mode !== "find" && this.reply && !!r;
    const tone = this.input.tone = this.boxColor(r);
    const label = (this.mode === "find" ? t.fg("subtext0", "find") + " " : "") + t.fg(tone, "❯");
    const lines = this.input.renderWithin(width, maxRows, label);
    if (this.value()) return lines;
    const place = this.mode === "find" ? "type to filter, archived tasks too"
      : replying ? (r.archivedAt ? "archived: read-only" : isAgent(r) ? sendTo(AGENT_TAB) + (reviewing(r) ? ": it stops the review" : "") : !r.host && ["todo", "progress"].includes(r.stage) ? "your message starts an agent on it" : this.canDispatch || r.host ? sendTo(COORDINATOR_TAB) : "what should change?")
      : this.automationsView ? this.autoPlace() : this.talksToCoord ? sendTo(COORDINATOR_TAB) : "what's next?";
    // The placeholder never runs past the box: it is cut with … like any other greyed line.
    const shown = truncateToWidth(place, Math.max(1, width - visibleWidth(label) - 1), "…");
    lines[1] = `${label} ${this.focused ? CURSOR_MARKER : ""}${t.inverse(shown[0])}${t.muted(shown.slice(1))}`;
    return lines;
  }
  // The text box with the chat open: one rounded box around the latest message, a blank line and the line you type
  // on. Nothing else is in it. With no message there is only the line you type on.
  chatBox(width, maxRows, r, message) {
    const t = this.theme, inner = width - 4;
    const edge = (s) => t.fg(this.boxColor(r), s);
    const row = (l) => { const s = visibleWidth(l) > inner ? truncateToWidth(l, inner, "…") : l; return edge("│") + " " + s + " ".repeat(Math.max(0, inner - visibleWidth(s))) + " " + edge("│"); };
    const body = this.boxLines(inner, maxRows, r).slice(1, -1), { above, below } = this.input;
    // A draft longer than its rows says so on the box's own lines. So does a message longer than its rows, with the
    // key that shows the rest: `alt+u more ↑` on the box's top edge, `alt+j more ↓` at the right of the line under it.
    const f = message.length ? this.chatFit : null, up = f?.above ? this.moreWord(true, width - 6) : "", down = f?.below ? this.moreWord(false, inner) : "";
    const line = (n) => edge("─".repeat(Math.max(0, n)));
    const top = above && !message.length ? this.input.rule(width - 2, true) : up ? line(width - 5 - visibleWidth(up)) + ` ${up} ` + line(1) : line(width - 2);
    const gap = Math.max(0, inner - visibleWidth(down) - (down ? 1 : 0));
    const under = (above ? this.input.rule(gap, true) : " ".repeat(down ? gap : 0)) + (down ? " " + down : "");
    return [edge("╭") + top + edge("╮"), ...message.map(row), ...(message.length ? [row(under)] : []), ...body.map(row), edge("╰") + (below ? this.input.rule(width - 2, false) : line(width - 2)) + edge("╯")];
  }
}
