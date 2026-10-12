// What a typed key does, where the board's state decides it: a question, a draft, find, esc, enter, tab. Every
// other key, and every key's chord and name, is an entry in ../keys.js: a new key goes there, not here.
import * as K from "../keys.js";
import * as A from "../../actions.js";
import * as F from "../../flow.js";
import * as H from "../../helpers.js";
import { isAgent } from "./states.js";

// Closing takes ctrl+c twice, as leaving Claude Code does ("Press Ctrl-C again to exit", shown for 0.8s): this long
// the first one is remembered. Codex is no model here: it leaves on the first ctrl+c (its two-press code is off).
const CLOSE_WAIT = 800;
const READ_ONLY = () => `Archived tasks are read-only. ${K.name("archive")} restores.`;

export class Keys {
  handleInput(data) {
    try { this.handle(data); } catch (e) { this.flash(e.message, "red"); }
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
    if (again && K.is(data, "close")) return this.done(undefined);
    if (this.pasteText) { this.pasteText = ""; return; }
    const esc = K.is(data, "back"), close = K.is(data, "close"), tab = K.is(data, "delegate");
    // An error stays until esc dismisses it; anything else is gone with the next key.
    if (this.msg && this.msgKind === "red") { if (esc) { this.msg = ""; return; } } else this.msg = "";
    if (this.setup) return this.setupKey(data);
    const enter = data !== "\n" && K.is(data, "enter");
    if (this.ask) {
      const { yes } = this.ask;
      // y = yes, n or esc = no, in either case; enter never confirms.
      if (K.is(data, "sayYes")) {
        if (this.ask.valid) { try { this.load(); } catch {} if (!this.ask) return; } // the newest state decides, not the one drawn a second ago
        this.ask = null; return yes();
      }
      if (K.is(data, "sayNo") && this.ask.no) { const { no } = this.ask; this.ask = null; return no(); }
      if (esc || K.is(data, "sayNo") || close) this.ask = null;
      return; // a question takes its own keys, nothing else: no other key answers it or is typed into the text box
    }
    if (this.menu) return this.menuKey(data);
    this.stick = "";
    if (this.input.isPasting || data.includes("\x1b[200~")) { this.input.handleInput(data); if (this.mode === "find") this.load(); return; }
    const text = this.value().trim();
    const r = this.current();
    if (esc) {
      // One step back at a time, and nothing else: a draft is put away, not thrown away; then the whole task, the
      // filter and the archive close; the last step only shows how the board closes. esc never shows or hides the
      // chat and never changes who you talk to.
      if (this.mode !== "new") { this.mode = "new"; this.setValue(""); }
      else if (this.value()) { if (text) { this.draftAway = { text: this.value(), to: this.reply && r ? r.id : "" }; this.flash(`Put away. ${K.name("undo")} brings it back.`); } this.setValue(""); }
      else if (this.full) return this.foldPanel();
      else if (this.filter) this.filter = "";
      else if (this.archiveView) return this.toggleArchive();
      else return this.closeHint();
      return this.load();
    }
    if (this.mode === "find" && enter) { this.filter = text; this.mode = "new"; this.setValue(""); return this.load(); }
    // While the text box holds text it owns the keyboard: only enter, tab, esc and ctrl+c act on the board, so no
    // shortcut fires in the middle of a draft (ctrl+a is "start of line" there, not "archive"). ctrl+c twice closes with
    // a draft too: the draft is saved with the board and is back when it reopens.
    if (this.value() && !enter && !tab && !close) { this.input.handleInput(data); if (this.mode === "find") this.load(); return; }
    if (close) return this.closeHint();
    if (this.mode === "find") { if (!tab) { this.input.handleInput(data); this.load(); } return; }

    const j = this.job();
    if (j && !text) {
      // Words on their way to another machine: stop them, or take them back to change and send again.
      if (K.is(data, "stop")) return this.try(() => { H.stopDispatch(j); this.flash("Stopped.", "yellow"); });
      if (enter) { this.try(() => H.stopDispatch(j)); return this.setValue(j.text || ""); }
      if (tab) return;
    }
    if (enter) {
      if (!text) { if (r) this.chat(r); return; } // with nothing typed, enter opens the selected task's agent
      // Who gets it is who the chat names: the selected task's agent after space, the Coordinator otherwise (also
      // while no task is selected).
      if (this.reply && r?.archivedAt) return this.flash(READ_ONLY(), "yellow");
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
    if (tab) {
      if (text) { if ((this.reply && r) || this.mode !== "new") return; this.dispatch(text, true); return this.setValue(""); }
      if (r?.archivedAt) return this.flash(READ_ONLY(), "yellow");
      if (r && r.host) this.act(r, "delegate"); else if (r) this.try(() => { const t = A.delegate(r.id); this.flash(t.stage === "queued" ? `${r.id}: waiting for a free slot` : `${r.id}: an agent is on it`, "green"); });
      return;
    }
    // From here on the text box is empty.
    const scroll = K.is(data, "up") || K.is(data, "down");
    if (this.full && scroll) return this.scrollPanel(data);
    // Every other key is an entry in ../keys.js. One that is not the board's right now is typed into the text box.
    const key = K.typed(data, (k) => k.run);
    if (key && (!key.on || key.on(this, r))) return key.run(this, r);
    this.input.handleInput(data);
    if (this.mode === "find") this.load();
  }
  // The one key that changes who you talk to: the selected task's agent, and back to the Coordinator.
  flipReply(r) {
    if (!r) return;
    if (this.reply) { this.reply = false; this.panelTop = 0; return this.load(); }
    if (r.archivedAt) return this.flash(READ_ONLY(), "yellow");
    this.reply = true; this.replyId = r.id;
  }
  // The row moves to or from the top; the selection goes with it, so the same key again takes the pin back.
  pinTask(r) { if (r.archivedAt) return this.flash(READ_ONLY(), "yellow"); this.stick = r.id; return r.host ? this.act(r, "pin") : this.try(() => A.pin(r.id)); }
  toggleAllDone() { this.allDone = !this.allDone; return this.load(); }
  toggleByRepo() { this.byRepo = !this.byRepo; this.savePrefs(); return this.load(); }
}
