// Scrolling the chat's message: which of its lines show while it is longer than its box, and the words that say so.
import { visibleWidth } from "@earendil-works/pi-tui";
import { name as keyName } from "../keys.js";

export class ChatScroll {
  // Which lines of a conversation show: `rows` of its `total` lines, from the line this answers. The box opens on the
  // newest thing said (`latest`: the line it starts on) and holds only that: an answer is read from its first line
  // down, and the box says there is more under it. What was said before is above it: the box says so on its top
  // edge, and the first scroll up opens it to the conversation, as many lines as it may have (`max`). Only a screen
  // (a program whose conversation cannot be read) starts at its end, where a terminal has what is new. Where you
  // scrolled to is kept for as long as the same message of the same chat shows: another message (also one in the
  // very same words: it is another turn), your own words in its place, or another chat starts again.
  chatWindow(c, total, max, latest = 0) {
    const key = [this.reply ? this.sel : "", c.mine ? "mine" : "", c.raw ? "" : c.turn || "", c.text].join("\n");
    if (this.chatAt?.key !== key) this.chatAt = { key, top: null };
    const open = c.raw || this.chatAt.top != null;
    const rows = Math.max(1, Math.min(max, open ? total : total - latest));
    const last = Math.max(0, total - rows);
    const top = Math.max(0, Math.min(last, this.chatAt.top ?? (c.raw ? last : latest)));
    this.chatFit = { total, rows, top, above: top, below: last - top, latest };
    return top;
  }
  // Scroll the message `by` lines (up when negative). Nothing but what shows changes: never the draft, never the task.
  // Down again from the end of a conversation that was opened closes it to its newest message.
  scrollChat(by) {
    const f = this.chatFit;
    if (!f || !this.chatAt) return false;
    const last = Math.max(0, f.total - f.rows);
    if (by > 0 && f.top >= last && f.latest > 0 && this.chatAt.top != null) { this.chatAt.top = null; return true; }
    if (f.total <= f.rows) return false;
    const top = Math.max(0, Math.min(last, f.top + by));
    this.chatAt.top = top;
    Object.assign(f, { top, above: top, below: last - top });
    return true;
  }
  // How far a key scrolls: half of what shows, so the line you were reading stays in view.
  chatPage() { return Math.max(1, Math.floor((this.chatFit?.rows || 2) / 2)); }
  // Is there more of the message than shows?
  get chatScrolls() { return !!this.chatFit && this.chatFit.total > this.chatFit.rows; }
  // The words on the box that say the message goes on, with the key that shows it, in `room` columns: the key goes
  // first where that does not fit, then the word, and the arrow last.
  moreWord(up, room) {
    const arrow = up ? "↑" : "↓", key = keyName(up ? "chatScrollUp" : "chatScrollDown");
    const word = [`${key} more ${arrow}`, `more ${arrow}`, arrow].find((w) => visibleWidth(w) <= room);
    return word ? this.theme.fg("overlay0", word) : "";
  }
}
