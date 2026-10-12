// The whole screen: what goes where, and what gives way when the window is small.
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { herdr } from "../../herdr.js";
import { clean } from "./words.js";
import { WIDE, fitShown } from "./size.js";
import { name as keyName } from "../keys.js";

export class Layout {
  render(width) { return this.draw(width).map((l) => this.theme.line(l)); }
  draw(width) {
    const rows = this.tui.terminal.rows, shown = this.shownNow(), f = fitShown({ cols: width, rows }, shown);
    // A size that is back within a moment is not laid out for: the screen stays as it was, cut to what there is room
    // for. Rows go from the top, so the text box and its hints stay.
    const now = { cols: f.cols, rows: Math.max(8, f.rows) }, at = this.steady(now);
    if (at === now) {
      this.off = f.held;
      // The line at the top (lookHeld) says the same with more: while it shows, this one is not needed.
      this.offNote = f.held && !this.held ? `Another viewer holds this terminal at ${width}×${rows}; herdr shows it at ${shown.cols - (shown.split ? 2 : 0)}×${shown.rows - (shown.split ? 2 : 0)}. ${this.takeFailed && this.ownsTerminal ? `Taking it back failed (${this.takeFailed}): trying again.` : this.gaveUp && this.ownsTerminal ? "A key typed in this window takes it back: another herdr window (a second device, a browser tab) has this session at its own size." : "The ownTerminal setting, turned on, takes it back."}` : "";
    }
    const lines = this.drawAt(at.cols, at.rows);
    return this.pad(at === now ? lines : lines.slice(Math.max(0, lines.length - now.rows)).map((l) => truncateToWidth(l, now.cols, "")), Math.max(8, rows));
  }
  drawAt(width, rowsN) {
    this.width = width;
    const fit = (s) => truncateToWidth(s, width, "…", true);
    try {
      const t = this.theme;
      const r = this.current();
      if (this.pasteText) return this.pad(["", ...String(this.pasteText).split("\n").flatMap((l) => wrapTextWithAnsi(l, Math.max(10, width - 4))).map((l) => "  " + l), "", "  " + t.fg("overlay0", "any key continues")], rowsN).map(fit);
      if (this.setup) return this.setupLines(width, rowsN).map(fit);
      // What fails to draw says so in its own place, in one red line, and nothing else goes with it: the list stays
      // beside a failed panel, the text box and its hints under a failed page, and the page above a failed chat or
      // text box. (A part of the panel that fails takes only itself: `attempt` in panel-kit.js.) `or`: what stands
      // in for a value that is not lines.
      const failed = (what, e, room, lead = []) => [...lead, ...wrapTextWithAnsi(t.fg("red", `${t.mark("error")} ${what} could not be shown: ${clean(e?.message) || "unknown error"}`), Math.max(10, room - 2)).slice(0, 3).map((l) => " " + l)];
      const safe = (what, room, draw, lead) => { try { return draw(); } catch (e) { return failed(what, e, room, lead); } };
      const calm = (draw, or) => { try { return draw(); } catch { return or; } };
      const selectedJob = this.jobs.findIndex((j) => j.id === this.sel);
      const jobLine = (j) => {
        const line = " " + (j.state === "error" ? t.fg("red", t.mark("error")) : t.fg("yellow", t.mark("working"))) + " " + clean(j.text) + (j.state === "error" ? t.fg("subtext0", `  ${clean(j.msg)}`) : "");
        return j.id === this.sel ? this.hl(line, width) : line;
      };
      // The chat: one line that says who you talk to and, under it, the text box. With the chat open that box is a
      // frame around their latest message and the line you type on. None of it pushes the box or its hints off-screen:
      // the message gives up lines first, and the line that says who you talk to goes last.
      const who = calm(() => this.chatOf(r), null);
      const chat = safe("The chat", width, () => this.chatLines(width, r, rowsN < 16));
      const headN = chat.length;
      const framed = calm(() => !this.ask && this.chatUp(who) && !!who.said && width >= 8, false); // a frame only where there can be a message in it (and room for its two edges)
      // What just happened, on a line of its own: the hints below it stay readable.
      const stale = !this.stale ? "" : this.ctx.canReload === false ? "herdr-superwork was updated: close the board and open it again for the new version." : "herdr-superwork was updated: the new version loads when nothing is half typed.";
      const said = this.msg && !(this.offNote && this.msgKind !== "red") ? wrapTextWithAnsi(t.fg(this.msgKind, this.msg) + (this.msgKind === "red" ? t.fg("overlay0", `  (${keyName("back")})`) : ""), Math.max(10, width - 4)).slice(0, 3).map((l) => "  " + l) : this.offNote ? wrapTextWithAnsi(t.fg("yellow", this.offNote), Math.max(10, width - 4)).slice(0, 3).map((l) => "  " + l) : stale ? ["  " + t.fg("overlay0", stale)] : [];
      // The text box grows with a draft that wraps, up to half the window (and never past what the line that says who
      // you talk to leaves): a longer draft scrolls inside it, never off-screen.
      const boxRows = Math.min(rowsN - 4 - headN - (selectedJob >= 0 ? 1 : 0), Math.max(5, Math.floor(rowsN / 2)));
      let inputLines = safe("The text box", width, () => (this.ask ? this.askLines(width) : framed ? this.chatBox(width, boxRows, r, []) : this.boxLines(width, boxRows, r)));
      // The message takes the lines it needs: with its box up to two thirds of the window, and only rows the list can
      // spare (the list keeps its selected task in view). Under the whole task and the menu, which are there to be
      // read themselves, it keeps to a third. A longer one scrolls (chat-scroll.js).
      this.chatFit = null;
      let messageN = 0;
      if (framed) inputLines = safe("The chat", width, () => {
        let spare = rowsN - inputLines.length - 1 - said.length - headN - 1 - Math.min(this.jobs.length, 1) - 2, draftRows = inputLines.length - 2;
        // A tall draft never takes the message away: it gives rows back (and scrolls inside what it keeps) until three
        // lines of the message show. In a window too short even for that, the list keeps one row less for one line.
        const give = who.text ? Math.max(0, Math.min(draftRows - 1, 3 - spare)) : 0;
        draftRows -= give; spare += give;
        if (who.text && spare < 1) spare = Math.min(1, spare + 1);
        const most = this.full || this.menu ? Math.min(8, Math.floor(rowsN / 3) - 2) : Math.floor((rowsN * 2) / 3) - draftRows - 3;
        const message = this.chatMessage(who, width - 4, Math.min(spare, Math.max(3, most)));
        messageN = message.length;
        return messageN ? this.chatBox(width, draftRows, r, message) : inputLines;
      });
      const extraRows = Math.max(0, rowsN - inputLines.length - 2 - said.length - headN);
      const lastJobTop = Math.max(0, this.jobs.length - extraRows);
      if (selectedJob < 0) this.jobTop = lastJobTop;
      else if (selectedJob < this.jobTop) this.jobTop = selectedJob;
      else if (selectedJob >= this.jobTop + extraRows) this.jobTop = selectedJob - extraRows + 1;
      this.jobTop = Math.max(0, Math.min(this.jobTop, lastJobTop));
      const jobs = extraRows ? safe("What is on its way", width, () => this.jobs.slice(this.jobTop, this.jobTop + extraRows).map(jobLine)) : [];
      // One greyed line that never runs off the screen: the main thing and the last one stay, what is between them
      // goes first, and of those the chat's own key last.
      const hintList = calm(() => this.hints(r).filter(Boolean).slice(0, 5), [["", "the hints could not be shown"]]);
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
      const held = rowsN - bottom.length > 3 ? safe("Who holds the terminal", width, () => this.heldLines(width)) : [];
      const h = Math.max(1, rowsN - bottom.length - held.length);
      // Where the chat is on the screen, for the mouse wheel: from the line that says who you talk to, to its box's end.
      const chatTop = held.length + h + jobs.length;
      this.chatRows = messageN ? [chatTop, chatTop + chat.length + inputLines.length] : null;
      const shown = r || this.job();
      let top;
      if (this.menu) top = safe("The menu", width, () => this.menuLines(width, h), [""]);
      else if (this.full && shown) top = safe("The task details", width, () => this.fullPanel(shown, width, h), [""]);
      else if (width >= WIDE && this.side) {
        // The task panel on the right, while you have it open, on herdr's sidebar colour when the theme gives it one.
        const paneW = Math.max(38, Math.min(70, Math.floor(width * 0.38)));
        const listW = width - paneW - 3;
        const left = safe("The list", listW, () => [...this.headLines(listW), ...this.listLines(listW, Math.max(1, h - 1), width)], [""]);
        const right = shown ? safe("The task panel", paneW, () => this.panel(shown, paneW, false, h), [""]) : ["", " " + t.fg("overlay0", "nothing selected.")];
        top = Array.from({ length: h }, (_, i) => truncateToWidth(left[i] ?? "", listW, "…", true) + " " + t.fg("surface_dim", "│") + t.under("sidebar_bg", truncateToWidth(" " + (right[i] ?? ""), paneW + 1, "…", true)));
      } else top = safe("The list", width, () => [...this.headLines(width), ...this.listLines(width, Math.max(1, h - 1))], [""]);
      return this.pad([...held, ...this.pad(top, h), ...bottom].slice(0, rowsN), rowsN).map(fit);
    } catch (e) {
      const out = [fit(" herdr-superwork view error: " + clean(e?.message)), fit(` press ${keyName("back")} to close`)];
      while (out.length < rowsN) out.push(fit(""));
      return out;
    }
  }
  pad(lines, n) { const out = lines.slice(0, n); while (out.length < n) out.push(""); return out; }
}
