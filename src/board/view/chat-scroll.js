// Scrolling the chat's message: which of its lines show while it is longer than its box, and the words that say so.
import { visibleWidth } from "@earendil-works/pi-tui";
import { name as keyName } from "../keys.js";

export class ChatScroll {
  // A message longer than its box shows `rows` of its `total` lines, from the line this answers. A new message starts
  // at its beginning: an answer is read from its first line down, and the box says there is more under it. Only a
  // screen (a dialog that is up, a program whose conversation cannot be read) starts at its end, where a terminal has
  // what is new. Where you scrolled to is kept for as long as the same message of the same chat shows: another
  // message (also one in the very same words: it is another turn), your own words in its place, or another chat
  // starts again.
  chatWindow(c, total, rows) {
    const key = [this.reply ? this.sel : "", c.mine ? "mine" : "", c.raw ? "" : c.turn || "", c.text].join("\n");
    if (this.chatAt?.key !== key) this.chatAt = { key, top: null };
    const last = Math.max(0, total - rows);
    const top = Math.max(0, Math.min(last, this.chatAt.top ?? (c.raw ? last : 0)));
    this.chatFit = { total, rows, top, above: top, below: last - top };
    return top;
  }
  // Scroll the message `by` lines (up when negative). Nothing but what shows changes: never the draft, never the task.
  scrollChat(by) {
    const f = this.chatFit;
    if (!f || f.total <= f.rows || !this.chatAt) return false;
    const last = f.total - f.rows, top = Math.max(0, Math.min(last, f.top + by));
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
