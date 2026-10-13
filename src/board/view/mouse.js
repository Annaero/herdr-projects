// The mouse wheel and the click: the wheel scrolls the chat's message under the pointer and the whole-task page, and
// moves between tasks over the list; a click on a row (a task's, an automation's) selects it. Nothing else of the mouse is the board's:
// selecting text and copying it are pi-tui's (main.js).

// Lines of text one step of the wheel scrolls.
const WHEEL = 2;

export class Mouse {
  // pi-tui hands every mouse event to the board, with the row the pointer is on. The wheel and a plain click are taken.
  handleMouse(event) {
    if (event.type === "click") { try { return this.click(event.x, event.y) ? { handled: true, render: true } : undefined; } catch { return undefined; } }
    if (event.type !== "wheel" || !event.wheelDelta) return undefined;
    try { this.wheel(event.y, event.wheelDelta); } catch (e) { this.flash(e.message, "red"); }
    return { handled: true, render: true };
  }
  // Over the chat it scrolls the message, also while you type. Anywhere else it does what ↑ and ↓ do, which is what
  // herdr made of the wheel before the board asked for the mouse: the whole-task page scrolls, the pick moves in the
  // menu, the selection in the list. A question, the first run and a paste keep the screen as it is.
  // While the box holds words, who they are for is locked (textbox.js writes it in the box): the wheel then moves
  // the view of the list and never the selection, so typed words cannot change who gets them.
  wheel(y, by) {
    if (this.leaving || this.setup || this.ask || this.pasteText) return;
    const d = by < 0 ? -1 : 1, [from, to] = this.chatRows || [0, 0];
    if (y >= from && y < to) return this.scrollChat(by * WHEEL);
    if (this.menu) return this.menuStep(d);
    if (this.full || this.autoOpen) return this.scrollPanelBy(by * WHEEL);
    if (this.locked()) { this.topFree = true; this.top = Math.max(0, this.top + d * WHEEL); return; }
    this.stick = ""; this.move(d); this.syncReply();
  }
  // Words in the box that would go to somebody: their recipient does not change until they are sent or put away.
  locked() { return this.mode === "new" && !!this.value().trim(); }
  // A click on a row of the list selects that task; on the selected one it does nothing more. Never while words
  // are in the box, a question is up, or another page shows. Answers whether the click was the board's.
  click(x, y) {
    if (this.leaving || this.setup || this.ask || this.pasteText || this.menu || this.full || this.autoOpen || !this.listAt) return false;
    const [top, wide] = this.listAt, id = x < wide ? (this.listIds || [])[y - top] : "";
    if (!id) return false;
    if (this.locked()) { if (id !== this.sel) this.flash("Send or put away what you typed first: a click does not change who gets it."); return true; }
    this.stick = ""; this.sel = id; this.load(); this.syncReply();
    return true;
  }
}
