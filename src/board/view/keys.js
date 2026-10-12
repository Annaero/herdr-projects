// What every key does. A new key goes here, and gets a line in the ? menu (menu.js).
import { matchesKey } from "@earendil-works/pi-tui";
import * as A from "../../actions.js";
import * as F from "../../flow.js";
import * as H from "../../helpers.js";
import { isAgent } from "./states.js";

// Closing takes ctrl+c twice, as leaving Claude Code does ("Press Ctrl-C again to exit", shown for 0.8s): this long
// the first one is remembered. Codex is no model here: it leaves on the first ctrl+c (its two-press code is off).
const CLOSE_WAIT = 800;

export class Keys {
  handleInput(data) {
    try { if (this.off && matchesKey(data, "alt+w")) this.takeBack(); else this.handle(data); } catch (e) { this.flash(e.message, "red"); }
    this.syncReply();
    this.tui.requestRender();
  }
  // Closing the board is not a question: the first ctrl+c (or the last esc) shows a hint where the key hints are,
  // and ctrl+c again while it shows closes. Any other key, or a short wait, and the board carries on as before.
  closeHint() {
    this.closeSoon();
    this.closing = setTimeout(() => { this.closing = null; if (!this.disposed) this.tui.requestRender(); }, CLOSE_WAIT);
    this.closing.unref?.();
  }
  closeSoon() { clearTimeout(this.closing); this.closing = null; }
  handle(data) {
    if (this.leaving) return;
    if (data === "\x1b\x1b") data = "\x1b"; // esc tapped twice arrives as one read: it is still esc
    // ctrl+c while the hint shows closes the board; any other key takes the hint away and then does what it always does.
    const again = !!this.closing;
    this.closeSoon();
    if (again && matchesKey(data, "ctrl+c")) return this.done(undefined);
    if (this.pasteText) { this.pasteText = ""; return; }
    const esc = matchesKey(data, "escape");
    // An error stays until esc dismisses it; anything else is gone with the next key.
    if (this.msg && this.msgKind === "red") { if (esc) { this.msg = ""; return; } } else this.msg = "";
    if (this.setup) return this.setupKey(data);
    const enter = data !== "\n" && (matchesKey(data, "return") || matchesKey(data, "enter"));
    if (this.ask) {
      const { yes } = this.ask;
      // y = yes, n or esc = no, in either case; enter never confirms.
      const letter = (c) => data === c || data === c.toUpperCase() || matchesKey(data, c) || matchesKey(data, `shift+${c}`);
      if (letter("y")) {
        if (this.ask.valid) { try { this.load(); } catch {} if (!this.ask) return; } // the newest state decides, not the one drawn a second ago
        this.ask = null; return yes();
      }
      if (esc || letter("n") || matchesKey(data, "ctrl+c")) this.ask = null;
      return; // a question takes its own keys, nothing else: no other key answers it or is typed into the text box
    }
    if (this.menu) return this.menuKey(data);
    this.stick = "";
    // A draft owns the chat's keys too, wherever it is going: alt+c, alt+v, alt+r and alt+n act only on an empty text box.
    if (!!this.value() && ["alt+c", "alt+v", "alt+r", "alt+n"].some((k) => matchesKey(data, k))) return this.input.handleInput(data);
    // alt+c: into the whole chat of whoever the chat talks to (the board closes). alt+v: its latest message, shown or
    // hidden: the one key for that, the same both ways and whoever the chat talks to.
    if (matchesKey(data, "alt+c")) return this.openChat();
    if (matchesKey(data, "alt+v")) return this.toggleChat();
    if (this.going && (esc || matchesKey(data, "ctrl+c"))) { this.going = 0; return this.flash("Stayed on the board. The Coordinator keeps starting."); }
    if (!this.reply && this.canDispatch && (matchesKey(data, "alt+r") || matchesKey(data, "alt+n"))) return this.coordAct(matchesKey(data, "alt+n") ? "new" : "restart");
    if (this.input.isPasting || data.includes("\x1b[200~")) { this.input.handleInput(data); if (this.mode === "find") this.load(); return; }
    const text = this.value().trim();
    const r = this.current();
    if (esc) {
      // One step back at a time, and nothing else: a draft is put away, not thrown away; then the whole task, the
      // filter and the archive close; the last step only shows how the board closes. esc never shows or hides the
      // chat and never changes who you talk to.
      if (this.mode !== "new") { this.mode = "new"; this.setValue(""); }
      else if (this.value()) { if (text) { this.draftAway = { text: this.value(), to: this.reply && r ? r.id : "" }; this.flash("Put away. ctrl+z brings it back."); } this.setValue(""); }
      else if (this.full) return this.foldPanel();
      else if (this.filter) this.filter = "";
      else if (this.archiveView) return this.toggleArchive();
      else return this.closeHint();
      return this.load();
    }
    if (this.mode === "find" && enter) { this.filter = text; this.mode = "new"; this.setValue(""); return this.load(); }
    // While the text box holds text it owns the keyboard: only enter, tab, esc and ctrl+c act on the board, so no
    // shortcut fires in the middle of a draft (ctrl+a is "start of line" there, not "merge"). ctrl+c twice closes with
    // a draft too: the draft is saved with the board and is back when it reopens.
    if (this.value() && !enter && !matchesKey(data, "tab") && !matchesKey(data, "ctrl+c")) { this.input.handleInput(data); if (this.mode === "find") this.load(); return; }
    if (matchesKey(data, "ctrl+c")) return this.closeHint();
    if (this.mode === "find") { if (!matchesKey(data, "tab")) { this.input.handleInput(data); this.load(); } return; }

    const j = this.job();
    if (j && !text) {
      // Words on their way to another machine: stop them, or take them back to change and send again.
      if (matchesKey(data, "ctrl+x")) return this.try(() => { H.stopDispatch(j); this.flash("Stopped.", "yellow"); });
      if (enter || matchesKey(data, "right")) { this.try(() => H.stopDispatch(j)); return this.setValue(j.text || ""); }
      if (matchesKey(data, "tab")) return;
    }
    if (enter) {
      if (!text) { if (r) this.chat(r); return; } // with nothing typed, enter opens the selected task's agent
      // Who gets it is who the chat names: the selected task's agent after space, the Coordinator otherwise (also
      // while no task is selected).
      if (this.reply && r?.archivedAt) return this.flash("Archived tasks are read-only. ? has restore.", "yellow");
      if (this.reply && r && r.id !== this.replyId) return this.flash("The task you were replying to is gone. Nothing was sent.", "yellow");
      // A reply to one of this machine's tasks that never had an agent starts one with that message.
      const fresh = this.reply && r && !r.host && !r.archivedAt && !F.isAgentTask(r) && ["todo", "progress"].includes(r.stage);
      if (fresh) { if (!this.try(() => { const out = A.tell(r.id, text); this.flash(out.msg, "green"); })) return; }
      // (Work that ended and was cleaned up has no terminal left: the reply starts a new round.)
      else if (this.reply && r && isAgent(r) && (r.host || F.isAgentTask(r) || F.cleanedUp(r))) {
        // Busy/refused replies keep the draft; only a successful send clears it.
        if (r.host) { this.act(r, "tell", { text }, false, (ok) => { if (ok && this.sel === r.id && this.value().trim() === text) this.setValue(""); }); return; }
        if (!this.try(() => { const out = A.tell(r.id, text); this.flash(out.msg, out.msg.startsWith("queued") ? "yellow" : "green"); })) return;
      } else this.dispatch(text, false, this.reply && r ? r : undefined);
      return this.setValue("");
    }
    if (matchesKey(data, "tab")) {
      if (text) { if ((this.reply && r) || this.mode !== "new") return; this.dispatch(text, true); return this.setValue(""); }
      if (r?.archivedAt) return this.flash("Archived tasks are read-only. ? has restore.", "yellow");
      if (r && r.host) this.act(r, "delegate"); else if (r) this.try(() => { const t = A.delegate(r.id); this.flash(t.stage === "queued" ? `${r.id}: waiting for a free slot` : `${r.id}: an agent is on it`, "green"); });
      return;
    }
    // From here on the text box is empty.
    const scroll = ["up", "down", "pageUp", "pageDown", "home", "end"].find((k) => matchesKey(data, k));
    if (this.full && scroll) return this.scrollPanel(data);
    if (matchesKey(data, "ctrl+down") || matchesKey(data, "ctrl+up")) {
      const d = matchesKey(data, "ctrl+down") ? 1 : -1;
      const at = this.jobs.findIndex((x) => x.id === this.sel);
      if (at < 0) { if (d > 0 && this.jobs.length) { this.back = this.sel; this.sel = this.jobs[0].id; } else if (d > 0) this.flash("Nothing is on its way to another machine."); return; }
      const to = at + d;
      if (to < 0) { this.sel = this.back || ""; this.load(); return; }
      this.sel = this.jobs[Math.min(this.jobs.length - 1, to)].id;
      return;
    }
    if (matchesKey(data, "alt+up")) return this.jump(-1);
    if (matchesKey(data, "alt+down")) return this.jump(1);
    if (matchesKey(data, "up") || matchesKey(data, "shift+up")) return this.move(-1);
    if (matchesKey(data, "down") || matchesKey(data, "shift+down")) return this.move(1);
    if (matchesKey(data, "pageUp")) return this.move(-10);
    if (matchesKey(data, "pageDown")) return this.move(10);
    if (data === "?") { this.menu = { at: 0 }; return; }
    if (matchesKey(data, "ctrl+f")) { this.mode = "find"; this.full = false; this.setValue(this.filter); return; }
    if (data === " ") {
      if (!r) return;
      // The one key that changes who you talk to: the selected task's agent, and back to the Coordinator.
      if (this.reply) { this.reply = false; this.panelTop = 0; return this.load(); }
      if (r.archivedAt) return this.flash("Archived tasks are read-only. ? has restore.", "yellow");
      this.reply = true; this.replyId = r.id;
      return;
    }
    if (matchesKey(data, "right") && r) return this.chat(r);
    if (matchesKey(data, "ctrl+a")) return r ? this.yes(r) : undefined;
    if (matchesKey(data, "ctrl+r") || matchesKey(data, "ctrl+g")) return r ? this.sendBack(r) : undefined;
    if (matchesKey(data, "ctrl+x")) return r ? this.stop(r) : undefined;
    // The quiet extras: every one of them is also a line in the ? menu.
    if (matchesKey(data, "ctrl+y") && r) { if (r.host) return this.act(r, "finish"); return this.try(() => { const out = A.finishAnyway(r.id); this.flash(out.msg, "green"); }); }
    if (matchesKey(data, "ctrl+e")) return this.full ? this.foldPanel() : this.openPanel();
    if (matchesKey(data, "ctrl+p")) return this.full ? undefined : this.toggleSide();
    if (matchesKey(data, "alt+h")) return this.toggleArchive();
    if (matchesKey(data, "alt+a")) return r ? this.archiveSelected(r) : this.flash("Select a task to archive or restore.");
    if (matchesKey(data, "ctrl+z")) return this.undo();
    if (matchesKey(data, "delete")) return r ? this.remove(r) : undefined;
    if (matchesKey(data, "ctrl+t") && r) { if (r.archivedAt) return this.flash("Archived tasks are read-only. ? has restore.", "yellow"); return r.host ? this.act(r, "pin") : this.try(() => A.pin(r.id)); }
    if (matchesKey(data, "ctrl+o")) return this.nextScope();
    if (matchesKey(data, "ctrl+d")) { this.allDone = !this.allDone; return this.load(); }
    if (matchesKey(data, "ctrl+s")) { this.byRepo = !this.byRepo; this.savePrefs(); return this.load(); }
    this.input.handleInput(data);
    if (this.mode === "find") this.load();
  }
}
