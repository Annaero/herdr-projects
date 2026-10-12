// The board's size: the window, what herdr shows of it, and another viewer holding the terminal at its own size.
import { truncateToWidth } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import { herdr, currentSocket, paneShown, takeTerminal } from "../../herdr.js";
import { lookHeld } from "../held.js";
import { clean, age } from "./words.js";

// The side panel fits from this width on, when you have it open (alt+p); below it the same panel opens full screen.
export const WIDE = 90;

// What the board may draw on: its terminal, cut down to what herdr shows of it. `shown` is herdr's size for the pane
// (see shownOf): the pane's outer rectangle, so beside other panes the borders come off it. Whether one more column
// goes to herdr's own edge is not told, so a terminal up to that wide is taken as fitting, and one that is held is
// drawn a column narrower. `held` says the terminal and what is shown disagree.
export function fitShown({ cols, rows }, shown) {
  if (!shown) return { cols, rows, held: false };
  const border = shown.split ? 2 : 0, most = { cols: shown.cols - border, rows: shown.rows - border }, inside = { cols: most.cols - 1, rows: most.rows };
  const over = cols > most.cols || rows > most.rows, under = cols < inside.cols || rows < inside.rows;
  return { cols: cols > most.cols ? Math.max(1, inside.cols) : cols, rows: rows > most.rows ? Math.max(1, inside.rows) : rows, held: over || under };
}

export class Size {
  // A remote view of this pane (a `herdr terminal attach`, as herdr's web UI starts) can hold its terminal at its own
  // size: the board is then drawn for that size and herdr's window shows a cut-out of it. Said only after two looks
  // in a row agree on the size, so a window that is being resized is never taken for one.
  lookHeld() {
    let now = null;
    try { now = lookHeld(herdr(currentSocket()), this.tui.terminal); } catch {}
    this.held = now && this.heldSeen === `${now.columns}x${now.rows}` ? now : null;
    this.heldSeen = now ? `${now.columns}x${now.rows}` : "";
  }
  // The terminal's size is the board's size, unless herdr shows this pane at another one: then something else that
  // looks at the same terminal holds its size (a second viewer attached to it), and herdr shows a cut-out of it from
  // the top left. The board draws inside what is shown, so nothing of it is cut off, and says what holds it.
  askShown() {
    if (!this.ctx.pane || this.askingShown) return;
    this.askingShown = true;
    paneShown(currentSocket(), this.ctx.pane, (shown) => { this.askingShown = false; if (!this.disposed) this.seeShown(shown); });
  }
  // A terminal held shorter than the window cannot be drawn on below its last row: only herdr can give it its size
  // back, and only by disconnecting the other viewer (an attach is exclusive: herdr itself says "retry with
  // --takeover"). So the board does that by itself, every time it has seen the two disagree twice in a row (a resize
  // under way is not a second viewer): the board has the size of the pane it runs in, always. A try that failed is
  // made again at every look after it. With `ownTerminal` off the viewer stays, and the board
  // only says what holds the terminal: no key disconnects anybody.
  get ownsTerminal() { return (this.ctx.ownTerminal ?? S.config().ownTerminal) !== false; }
  seeShown(shown) {
    const changed = JSON.stringify(shown) !== JSON.stringify(this.shown);
    this.shown = shown;
    const held = fitShown({ cols: this.tui.terminal.columns, rows: this.tui.terminal.rows }, shown).held;
    this.offSeen = held ? (this.offSeen || 0) + 1 : 0;
    if (held && /^Another viewer held /.test(this.msg || "")) this.msg = ""; // it is back: that is no longer true
    if (this.offSeen >= 2 && this.ownsTerminal) this.takeBack();
    if (changed || held) this.tui.requestRender();
  }
  // Your window wins: the other viewer is disconnected, and herdr gives the terminal the size it shows it at.
  takeBack() {
    const cols = this.tui.terminal.columns, rows = this.tui.terminal.rows, f = fitShown({ cols, rows }, this.shown);
    try {
      (this.ctx.takeTerminal || takeTerminal)(currentSocket(), this.ctx.pane, { cols: f.cols, rows: f.rows });
      this.offSeen = 0; this.takeFailed = "";
      this.flash(`Another viewer held this terminal at ${cols}×${rows}: it was disconnected, and your window has it again.`);
    } catch (e) {
      this.takeFailed = clean(e?.message || "herdr refused"); // said in the note, and tried again at the next look
    }
  }
  // The size warning: one line, and what frees the size comes first, because the right end is what a narrow window
  // or a cut-out loses.
  heldLines(width) {
    const d = this.held;
    if (!d) return [];
    const t = this.theme, who = d.by[0];
    const text = `Held at ${d.columns}×${d.rows}: ${who ? `kill ${who.pid}` : "closing its remote view"} frees it. `
      + `Drawn for a remote view of this pane, so herdr's own window (${d.room.columns}×${d.room.rows}) shows it cut off or half empty`
      + (who ? ` · herdr terminal attach, open ${age(who.seconds * 1000)}${d.by.length > 1 ? `, and ${d.by.length - 1} more` : ""}` : "");
    return [truncateToWidth(" " + t.fg("yellow", "! " + text), width, "…")];
  }
}
