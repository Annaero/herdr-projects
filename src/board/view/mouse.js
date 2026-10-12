// The mouse wheel: it scrolls the chat's message under the pointer and the whole-task page, and moves between tasks
// over the list. Nothing else of the mouse is the board's: selecting text and copying it are pi-tui's (main.js).

// Lines of text one step of the wheel scrolls.
const WHEEL = 2;

export class Mouse {
  // pi-tui hands every mouse event to the board, with the row the pointer is on. Only the wheel is taken.
  handleMouse(event) {
    if (event.type !== "wheel" || !event.wheelDelta) return undefined;
    try { this.wheel(event.y, event.wheelDelta); } catch (e) { this.flash(e.message, "red"); }
    return { handled: true, render: true };
  }
  // Over the chat it scrolls the message, also while you type. Anywhere else it does what ↑ and ↓ do, which is what
  // herdr made of the wheel before the board asked for the mouse: the whole-task page scrolls, the pick moves in the
  // menu, the selection in the list. A question, the first run and a paste keep the screen as it is.
  wheel(y, by) {
    if (this.leaving || this.setup || this.ask || this.pasteText) return;
    const d = by < 0 ? -1 : 1, [from, to] = this.chatRows || [0, 0];
    if (y >= from && y < to) return this.scrollChat(by * WHEEL);
    if (this.menu) return this.menuStep(d);
    if (this.full) return this.scrollPanelBy(by * WHEEL);
    this.stick = ""; this.move(d); this.syncReply();
  }
}
