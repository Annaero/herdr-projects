// The whole screen: what goes where, and what gives way when the window is small.
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { herdr } from "../../herdr.js";
import { clean } from "./words.js";
import { WIDE, fitShown } from "./size.js";
import { name as keyName } from "../keys.js";

export class Layout {
  render(width) { return this.draw(width).map((l) => this.theme.line(l)); }
  draw(width) {
    const rows = this.tui.terminal.rows, f = fitShown({ cols: width, rows }, this.shown);
    this.off = f.held;
    // The line at the top (lookHeld) says the same with more: while it shows, this one is not needed.
    this.offNote = f.held && !this.held ? `Another viewer holds this terminal at ${width}×${rows}; herdr shows it at ${this.shown.cols - (this.shown.split ? 2 : 0)}×${this.shown.rows - (this.shown.split ? 2 : 0)}. ${this.takeFailed && this.ownsTerminal ? `Taking it back failed (${this.takeFailed}): trying again.` : "The ownTerminal setting, turned on, takes it back."}` : "";
    return this.pad(this.drawAt(f.cols, Math.max(8, f.rows)), Math.max(8, rows));
  }
  drawAt(width, rowsN) {
    this.width = width;
    const fit = (s) => truncateToWidth(s, width, "…", true);
    try {
      const t = this.theme;
      const r = this.current();
      if (this.pasteText) return this.pad(["", ...String(this.pasteText).split("\n").flatMap((l) => wrapTextWithAnsi(l, Math.max(10, width - 4))).map((l) => "  " + l), "", "  " + t.fg("overlay0", "any key continues")], rowsN).map(fit);
      if (this.setup) return this.setupLines(width, rowsN).map(fit);
      const selectedJob = this.jobs.findIndex((j) => j.id === this.sel);
      const jobLine = (j) => {
        const line = " " + (j.state === "error" ? t.fg("red", t.mark("error")) : t.fg("yellow", t.mark("working"))) + " " + clean(j.text) + (j.state === "error" ? t.fg("subtext0", `  ${clean(j.msg)}`) : "");
        return j.id === this.sel ? this.hl(line, width) : line;
      };
      // The chat: one line that says who you talk to and, under it, the text box. With the chat open that box is a
      // frame around their latest message and the line you type on. None of it pushes the box or its hints off-screen:
      // the message gives up lines first, and the line that says who you talk to goes last.
      const who = this.chatOf(r);
      const chat = this.chatLines(width, r, rowsN < 16);
      const headN = chat.length;
      const framed = !this.ask && this.chatUp(who) && !!who.said && width >= 8; // a frame only where there can be a message in it (and room for its two edges)
      // What just happened, on a line of its own: the hints below it stay readable.
      const stale = !this.stale ? "" : this.ctx.canReload === false ? "herdr-superwork was updated: close the board and open it again for the new version." : "herdr-superwork was updated: the new version loads when nothing is half typed.";
      const said = this.msg && !(this.offNote && this.msgKind !== "red") ? wrapTextWithAnsi(t.fg(this.msgKind, this.msg) + (this.msgKind === "red" ? t.fg("overlay0", `  (${keyName("back")})`) : ""), Math.max(10, width - 4)).slice(0, 3).map((l) => "  " + l) : this.offNote ? wrapTextWithAnsi(t.fg("yellow", this.offNote), Math.max(10, width - 4)).slice(0, 3).map((l) => "  " + l) : stale ? ["  " + t.fg("overlay0", stale)] : [];
      // The text box grows with a draft that wraps, up to half the window (and never past what the line that says who
      // you talk to leaves): a longer draft scrolls inside it, never off-screen.
      const boxRows = Math.min(rowsN - 4 - headN - (selectedJob >= 0 ? 1 : 0), Math.max(5, Math.floor(rowsN / 2)));
      let inputLines = this.ask ? this.askLines(width) : framed ? this.chatBox(width, boxRows, r, []) : this.boxLines(width, boxRows, r);
      // The message takes a third of the window at most, and only rows the list can spare: a longer one is cut with ….
      if (framed) {
        const spare = rowsN - inputLines.length - 1 - said.length - headN - 1 - Math.min(this.jobs.length, 1) - 2;
        const message = this.chatMessage(who, width - 4, Math.min(spare, Math.max(3, Math.min(8, Math.floor(rowsN / 3) - 2))));
        if (message.length) inputLines = this.chatBox(width, boxRows, r, message);
      }
      const extraRows = Math.max(0, rowsN - inputLines.length - 2 - said.length - headN);
      const lastJobTop = Math.max(0, this.jobs.length - extraRows);
      if (selectedJob < 0) this.jobTop = lastJobTop;
      else if (selectedJob < this.jobTop) this.jobTop = selectedJob;
      else if (selectedJob >= this.jobTop + extraRows) this.jobTop = selectedJob - extraRows + 1;
      this.jobTop = Math.max(0, Math.min(this.jobTop, lastJobTop));
      const jobs = extraRows ? this.jobs.slice(this.jobTop, this.jobTop + extraRows).map(jobLine) : [];
      // One greyed line that never runs off the screen: the main thing and the last one stay, what is between them
      // goes first, and of those the chat's own key last.
      const hintList = this.hints(r).filter(Boolean).slice(0, 5);
      const hintText = () => t.fg("overlay0", hintList.map(([k, d]) => [k, d].filter(Boolean).join(" ")).join(" · "));
      const giveUp = () => { const at = hintList.length - 2; return at > 1 && hintList[at] === this.chatKey ? at - 1 : at; };
      while (hintList.length > 2 && visibleWidth(hintText()) > width - 2) hintList.splice(giveUp(), 1);
      // Still too wide with two left: words that name no key ("type your reply") go before a key is cut.
      if (hintList.length === 2 && !hintList[0][0] && visibleWidth(hintText()) > width - 2) hintList.shift();
      const hints = hintText();
      // Whatever the window, the text box and its hints are whole: the chat, then the rows above it, give way.
      while (jobs.length + chat.length + inputLines.length + said.length + 1 > rowsN && (chat.length || jobs.length || said.length)) (chat.length ? chat.shift() : (jobs.length ? jobs : said).pop());
      const bottom = [...jobs, ...chat, ...inputLines, ...said, "  " + hints];
      // Top left, where a cut-out of the board still shows it.
      const held = rowsN - bottom.length > 3 ? this.heldLines(width) : [];
      const h = Math.max(1, rowsN - bottom.length - held.length);
      const shown = r || this.job();
      let top;
      if (this.menu) top = this.menuLines(width, h);
      else if (this.full && shown) top = this.fullPanel(shown, width, h);
      else if (width >= WIDE && this.side) {
        // The task panel on the right, while you have it open, on herdr's sidebar colour when the theme gives it one.
        const paneW = Math.max(38, Math.min(70, Math.floor(width * 0.38)));
        const listW = width - paneW - 3;
        const left = [...this.headLines(listW), ...this.listLines(listW, Math.max(1, h - 1))];
        const right = shown ? this.panel(shown, paneW, false, h) : ["", " " + t.fg("overlay0", "nothing selected.")];
        top = Array.from({ length: h }, (_, i) => truncateToWidth(left[i] ?? "", listW, "…", true) + " " + t.fg("surface_dim", "│") + t.under("sidebar_bg", truncateToWidth(" " + (right[i] ?? ""), paneW + 1, "…", true)));
      } else top = [...this.headLines(width), ...this.listLines(width, Math.max(1, h - 1))];
      return this.pad([...held, ...this.pad(top, h), ...bottom].slice(0, rowsN), rowsN).map(fit);
    } catch (e) {
      const out = [fit(" herdr-superwork view error: " + clean(e?.message)), fit(` press ${keyName("back")} to close`)];
      while (out.length < rowsN) out.push(fit(""));
      return out;
    }
  }
  pad(lines, n) { const out = lines.slice(0, n); while (out.length < n) out.push(""); return out; }
}
