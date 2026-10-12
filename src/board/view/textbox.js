// The text box you type in.
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
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
    lines[1] = `${label} ${this.focused ? CURSOR_MARKER : ""}${t.inverse(place[0])}${t.fg("overlay0", place.slice(1))}`;
    return lines;
  }
}
