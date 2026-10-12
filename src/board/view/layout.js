// The whole screen: what goes where, and what gives way when the window is small.
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { herdr } from "../../herdr.js";
import { clean } from "./words.js";
import { WIDE, fitShown } from "./size.js";

export class Layout {
  render(width) { return this.draw(width).map((l) => this.theme.line(l)); }
  draw(width) {
    const rows = this.tui.terminal.rows, f = fitShown({ cols: width, rows }, this.shown);
    this.off = f.held;
    // The line at the top (lookHeld) says the same with more: while it shows, this one is not needed.
    this.offNote = f.held && !this.held ? `Another viewer holds this terminal at ${width}×${rows}; herdr shows it at ${this.shown.cols - (this.shown.split ? 2 : 0)}×${this.shown.rows - (this.shown.split ? 2 : 0)}. ${this.takeFailed && this.ownsTerminal ? `Taking it back failed (${this.takeFailed}): trying again.` : "alt+w takes it back."}` : "";
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
      // The chat, above the text box: who you talk to and their latest message. It never pushes the box or its hints
      // off-screen: the message gives up lines first, and the line that says who you talk to goes last.
      const chat = this.chatLines(width, Math.max(3, Math.min(10, Math.floor(rowsN / 3) - 2)), r, rowsN < 16);
      const headN = chat.length ? this.chatHeadRows : 0;
      // The text box grows with a draft that wraps, up to half the window (and never past what the line that says who
      // you talk to leaves): a longer draft scrolls inside it, never off-screen.
      const inputLines = this.ask ? this.askLines(width) : this.boxLines(width, Math.min(rowsN - 4 - headN - (selectedJob >= 0 ? 1 : 0), Math.max(5, Math.floor(rowsN / 2))), r);
      const trimChat = (limit) => { if (chat.length > limit) chat.splice(limit > headN ? limit - 1 : limit, chat.length, ...(limit > headN ? [" " + t.fg("overlay0", "… alt+c: open its chat")] : [])); };
      // What just happened, on a line of its own: the hints below it stay readable.
      const stale = !this.stale ? "" : this.ctx.canReload === false ? "herdr-superwork was updated: close the board and open it again for the new version." : "herdr-superwork was updated: the new version loads when nothing is half typed.";
      const said = this.msg && !(this.offNote && this.msgKind !== "red") ? wrapTextWithAnsi(t.fg(this.msgKind, this.msg) + (this.msgKind === "red" ? t.fg("overlay0", "  (esc)") : ""), Math.max(10, width - 4)).slice(0, 3).map((l) => "  " + l) : this.offNote ? wrapTextWithAnsi(t.fg("yellow", this.offNote), Math.max(10, width - 4)).slice(0, 3).map((l) => "  " + l) : stale ? ["  " + t.fg("overlay0", stale)] : [];
      const extraRows = Math.max(0, rowsN - inputLines.length - 2 - said.length - headN);
      const lastJobTop = Math.max(0, this.jobs.length - extraRows);
      if (selectedJob < 0) this.jobTop = lastJobTop;
      else if (selectedJob < this.jobTop) this.jobTop = selectedJob;
      else if (selectedJob >= this.jobTop + extraRows) this.jobTop = selectedJob - extraRows + 1;
      this.jobTop = Math.max(0, Math.min(this.jobTop, lastJobTop));
      const jobs = extraRows ? this.jobs.slice(this.jobTop, this.jobTop + extraRows).map(jobLine) : [];
      trimChat(headN + Math.max(0, extraRows - jobs.length));
      // The hint line never runs off the screen: the main thing and the last one stay, what is between them goes first.
      const hintList = this.hints(r).filter(Boolean).slice(0, 4);
      const hintText = () => hintList.map(([k, d]) => [k && t.fg("text", k), d && t.fg("overlay0", d)].filter(Boolean).join(" ")).join(t.fg("overlay0", " · "));
      while (hintList.length > 2 && visibleWidth(hintText()) > width - 2) hintList.splice(hintList.length - 2, 1);
      const hints = hintText();
      // Whatever the window, the text box and its hints are whole: the chat, then the rows above it, give way.
      while (jobs.length + chat.length + inputLines.length + said.length + 1 > rowsN && (chat.length || jobs.length || said.length)) (chat.length ? chat : jobs.length ? jobs : said).pop();
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
      const out = [fit(" herdr-superwork view error: " + clean(e?.message)), fit(" press esc to close")];
      while (out.length < rowsN) out.push(fit(""));
      return out;
    }
  }
  pad(lines, n) { const out = lines.slice(0, n); while (out.length < n) out.push(""); return out; }
}
