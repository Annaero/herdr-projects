// The box at the bottom. pi-tui owns editing, word wrapping, Unicode cursor movement and undo; this adapter only
// keeps its viewport inside the board and expands pasted drafts visibly, as pi-work's did.
import { CURSOR_MARKER, Editor } from "@earendil-works/pi-tui";

export class DraftEditor extends Editor {
  hiddenAbove = 0; hiddenBelow = 0; viewportTop = 0; paste = undefined;
  constructor(tui, theme) {
    super(tui, { borderColor: (s) => theme.fg("surface1", s), selectList: { selectedPrefix: (s) => s, selectedText: (s) => s, description: (s) => s, scrollInfo: (s) => s, noMatch: (s) => s } });
    this.focused = true;
    this.disableSubmit = true; // only the board may dispatch or delegate
  }
  get isPasting() { return this.paste !== undefined; }
  handleInput(data) {
    // Use public insertion instead of the editor's collapsed large-paste markers. Buffer split terminal events so
    // pasted shortcuts never act on the board.
    if (this.paste !== undefined || data.includes("\x1b[200~")) {
      if (this.paste === undefined) {
        const start = data.indexOf("\x1b[200~");
        if (start > 0) super.handleInput(data.slice(0, start));
        this.paste = "";
        data = data.slice(start + 6);
      }
      this.paste += data;
      const end = this.paste.indexOf("\x1b[201~");
      if (end < 0) return;
      const text = this.paste.slice(0, end)
        .replace(/\x1b\[(\d+);5u/g, (m, code) => { const cp = Number(code); return cp >= 97 && cp <= 122 ? String.fromCharCode(cp - 96) : cp >= 65 && cp <= 90 ? String.fromCharCode(cp - 64) : m; })
        .replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "");
      const rest = this.paste.slice(end + 6);
      this.paste = undefined;
      this.insertTextAtCursor(text);
      if (rest) this.handleInput(rest);
      return;
    }
    super.handleInput(data);
  }
  renderTopBorder(width, hidden) { this.hiddenAbove = hidden; return super.renderTopBorder(width, hidden); }
  renderBottomBorder(width, hidden) { this.hiddenBelow = hidden; return super.renderBottomBorder(width, hidden); }
  renderWithin(width, maxBodyRows, accent) {
    const lines = super.render(Math.max(1, width - 2));
    const body = lines.slice(1, -1);
    const height = Math.max(1, maxBodyRows);
    const cursor = Math.max(0, body.findIndex((line) => line.includes(CURSOR_MARKER)));
    if (cursor < this.viewportTop) this.viewportTop = cursor;
    if (cursor >= this.viewportTop + height) this.viewportTop = cursor - height + 1;
    this.viewportTop = Math.max(0, Math.min(this.viewportTop, body.length - height));
    const visible = body.slice(this.viewportTop, this.viewportTop + height);
    return [super.renderTopBorder(width, this.hiddenAbove + this.viewportTop),
      ...visible.map((line, n) => (n === 0 ? accent("❯") + " " : "  ") + line),
      super.renderBottomBorder(width, this.hiddenBelow + body.length - this.viewportTop - visible.length)];
  }
}
