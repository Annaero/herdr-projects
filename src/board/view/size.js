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
    const at = this.termSize(); // an answer is about the terminal as it was when herdr was asked: after a size change, ask again
    paneShown(currentSocket(), this.ctx.pane, (shown) => { this.askingShown = false; if (this.disposed) return; if (at !== this.termSize()) return this.askShown(); this.seeShown(shown); });
  }
  termSize() { return `${this.tui.terminal.columns}x${this.tui.terminal.rows}`; }
  // What herdr shows of the pane, for the size the terminal has now. An answer given for another size says nothing
  // about this one: the open board draws on its whole terminal until herdr has answered again, and asks at once.
  shownNow() {
    if (!this.ctx.settleMs) return this.shown;
    const size = this.termSize();
    if (size !== this.drawnFor) { this.drawnFor = size; this.askShown(); }
    return this.shownFor === size ? this.shown : null;
  }
  // A terminal held shorter than the window cannot be drawn on below its last row: only herdr can give it its size
  // back, and only by disconnecting the other viewer (an attach is exclusive: herdr itself says "retry with
  // --takeover"). So the board does that by itself, every time it has seen the two disagree twice in a row (a resize
  // under way is not a second viewer): the board has the size of the pane it runs in, always. A try that failed is
  // made again at every look after it. This is fixed behaviour, not a setting.
  get ownsTerminal() { return true; }
  // An answer that disagrees with the terminal may be a size change under way, or an answer from before one that is
  // over (herdr's layout and the terminal's own size do not move in the same instant, and the answer takes a moment):
  // the open board draws for it only once herdr has said the same again after `settleMs`.
  seeShown(shown) {
    const held = fitShown({ cols: this.tui.terminal.columns, rows: this.tui.terminal.rows }, shown).held, key = JSON.stringify(shown), ms = Number(this.ctx.settleMs) || 0;
    if (key !== this.shownSeen) { this.shownSeen = key; this.shownSince = Date.now(); }
    const sure = !held || !ms || Date.now() - this.shownSince >= ms;
    const changed = sure && key !== JSON.stringify(this.shown);
    if (sure) { this.shown = shown; this.shownFor = this.termSize(); }
    if (changed && ms) this.sureFor = this.termSize(); // it has waited already: drawn for at once, at this terminal size (steady)
    this.offSeen = held ? (this.offSeen || 0) + 1 : 0;
    if (held && /^Another viewer held /.test(this.msg || "")) this.msg = ""; // it is back: that is no longer true
    if (!held && this.takes) { if (this.gaveUp) this.takes = 0; else this.tookBack(); } // after giving up, something else gave the size back
    if (sure && this.offSeen >= 2 && this.ownsTerminal && !this.gaveUp) this.takeBack();
    if (changed || held) this.tui.requestRender();
  }
  // Your window wins: the other viewer is disconnected, and herdr gives the terminal the size it shows it at. That
  // works on a viewer attached to this one terminal. A second herdr window on the whole session (another device, a
  // browser tab) is not one: herdr gives every pane the size of the window that was last typed in, and taking the
  // terminal changes nothing (checked on 0.9.3). So after two takes with the sizes still apart the board stops, says
  // what gives the size back, and takes again only once the two have agreed in between.
  get gaveUp() { return (this.takes || 0) >= 2; }
  takeBack() {
    const cols = this.tui.terminal.columns, rows = this.tui.terminal.rows, f = fitShown({ cols, rows }, this.shown);
    try {
      (this.ctx.takeTerminal || takeTerminal)(currentSocket(), this.ctx.pane, { cols: f.cols, rows: f.rows });
      this.offSeen = 0; this.takeFailed = ""; this.takes = (this.takes || 0) + 1; this.tookAt = `${cols}×${rows}`;
      if (!fitShown({ cols: this.tui.terminal.columns, rows: this.tui.terminal.rows }, this.shown).held) this.tookBack();
    } catch (e) {
      this.takeFailed = clean(e?.message || "herdr refused"); // said in the note, and tried again at the next look
    }
  }
  tookBack() { this.takes = 0; this.flash(`Another viewer held this terminal at ${this.tookAt}: it was disconnected, and your window has it again.`); }
  // A size that changes and is back within a moment (another herdr window on the session taking the size and giving
  // it back, a pane opening and closing beside the board) is not drawn for: the board keeps the screen it had, cut to
  // what the terminal has room for, and lays itself out again only when a new size has lasted `settleMs`. Every
  // change waits, also one right after another: a window being dragged is laid out for once a second, never per step.
  steady(want) {
    const ms = Number(this.ctx.settleMs) || 0, now = Date.now(), still = this.still;
    const sure = this.sureFor === this.termSize(); // what herdr shows has changed, confirmed: nothing more to wait for
    if (sure) this.sureFor = "";
    if (!ms || !still || sure || (still.cols === want.cols && still.rows === want.rows)) { this.still = want; this.movedAt = 0; return want; }
    if (!this.movedAt) {
      this.movedAt = now;
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => { if (!this.disposed) this.tui.requestRender(); }, ms + 20);
      this.settleTimer.unref?.();
    }
    if (now - this.movedAt < ms) return still;
    this.still = want; this.movedAt = 0;
    return want;
  }
  // The size warning: one line, and what frees the size comes first, because the right end is what a narrow window
  // or a cut-out loses.
  heldLines(width) {
    const d = this.held;
    if (!d) return [];
    const t = this.theme, who = d.by[0];
    // Taking the terminal changed nothing and no attach holds it: a second herdr window has the session at its size.
    const text = this.gaveUp && !who ? `Held at ${d.columns}×${d.rows}: a key typed in this window frees it. Another herdr window on this session (a second device, a browser tab) has it at its own size, so herdr's own window (${d.room.columns}×${d.room.rows}) shows the board cut off or half empty`
      : `Held at ${d.columns}×${d.rows}: ${who ? `kill ${who.pid}` : "closing its remote view"} frees it. `
      + `Drawn for a remote view of this pane, so herdr's own window (${d.room.columns}×${d.room.rows}) shows it cut off or half empty`
      + (who ? ` · herdr terminal attach, open ${age(who.seconds * 1000)}${d.by.length > 1 ? `, and ${d.by.length - 1} more` : ""}` : "");
    return [truncateToWidth(" " + t.fg("yellow", "! " + text), width, "…")];
  }
}
