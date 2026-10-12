// The text box you type in.
import { CURSOR_MARKER, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isAgent } from "./states.js";

export class TextBox {
  // The text box. Who gets your words is said by the chat's first line, right above it, never by the prompt.
  boxLines(width, maxRows, r) {
    const t = this.theme;
    const replying = this.mode !== "find" && this.reply && !!r;
    const label = (this.mode === "find" ? t.fg("subtext0", "find") + " " : "") + t.fg("accent", "❯");
    const lines = this.input.renderWithin(width, maxRows, label);
    if (this.value()) return lines;
    const place = this.mode === "find" ? "type to filter, archived tasks too"
      : replying ? (r.archivedAt ? "archived: read-only" : isAgent(r) ? (r.state === "blocked" && r.kind === "question" ? "your answer" : "your reply") : !r.host && ["todo", "progress"].includes(r.stage) ? "your message starts an agent on it" : "what should change?")
      : this.talksToCoord ? "ask or tell it anything" : "what's next?";
    // The placeholder never runs past the box: it is cut with … like any other greyed line.
    const shown = truncateToWidth(place, Math.max(1, width - visibleWidth(label) - 1), "…");
    lines[1] = `${label} ${this.focused ? CURSOR_MARKER : ""}${t.inverse(shown[0])}${t.fg("overlay0", shown.slice(1))}`;
    return lines;
  }
  // The text box with the chat open: one rounded box around the latest message, a blank line and the line you type
  // on. Nothing else is in it. With no message there is only the line you type on.
  chatBox(width, maxRows, r, message) {
    const t = this.theme, inner = width - 4;
    const edge = (s) => t.fg("overlay0", s);
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
