// The Coordinator from the board: sending it your words, going into its chat, restarting it.
import { spawnSync } from "node:child_process";
import * as S from "../../store.js";
import * as A from "../../actions.js";
import * as C from "../../coordinator.js";
import { herdr, currentSocket, inHerdr } from "../../herdr.js";

export class Coordinator {
  // What you typed, for the Coordinator: this machine's one long-lived agent. For another machine's, the words are a
  // row of their own until that machine has taken them, so you can select it and stop it.
  dispatch(text, delegate, about) {
    // Another machine's Coordinator: for a task of theirs you have open, or when you start with its name ("@vm-a fix the build").
    const named = text.match(/^@?([A-Za-z0-9_.-]+)[:\s]\s*([\s\S]+)$/);
    const there = about && about.host ? this.remotes[about.host] : (named && this.all && (text.startsWith("@") || text.slice(named[1].length, named[1].length + 1) === ":") ? this.remotes[named[1]] : null) || (about ? null : this.remotes[this.scope]) || null;
    if (there) {
      const words = (about && about.host) || !(named && this.remotes[named[1]] === there) ? text : named[2];
      const job = S.newDispatch(`@${there.label} ${words}`, { remote: there.label });
      this.ssh(there, "dispatch", { text: words, delegate, about: about && about.host ? about.rid : undefined }, (j) => {
        try {
          if (!S.getDispatch(job.id)) return;
          if (j && j.ok) S.clearDispatch(job.id);
          else S.setDispatch(job.id, { state: "error", msg: j ? j.msg : `${there.label} did not answer` });
          this.pollRemotes(true); this.load(); this.tui.requestRender();
        } catch {}
      }, 150000);
      return this.load();
    }
    if (!this.canDispatch) { try { this.canDispatch = C.ready(); } catch {} } // it may have been turned on a moment ago
    if (!this.canDispatch) {
      // No Coordinator (it is off, its program is not installed, or herdr is not running): what you type is filed as
      // a task, word for word.
      const about0 = about && !about.host ? about : null;
      if (about0) { A.describe(about0.id, `${about0.description ? `${about0.description}\n\n` : ""}${text}`); this.flash(`${about0.id}: added to its description`, "green"); return this.load(); }
      const [title, ...restLines] = text.split("\n");
      const t = A.add(this.ctx.cwd, title, { description: restLines.join("\n") });
      if (delegate) A.delegate(t.id);
      this.flash(`${t.id}: filed${delegate ? ", an agent is on it" : ""}`, "green");
      this.sel = t.id;
      return this.load();
    }
    C.send(this.ctx.cwd, text, { delegate, about: about ? about.id : null });
    this.load();
  }
  // Called on every beat and after every change: a reply you can see counts as seen, and you go into the
  // Coordinator's chat once the Coordinator you asked to go into is there.
  syncCoord() {
    const v = this.coord;
    if (v.unseen && !this.reply && this.chatOpen && !this.setup) { C.seen(v.unseen); this.coord = { ...v, unseen: "" }; }
    // While you talk to a task's agent the chat shows that agent: the Coordinator's reply is said once, in a line.
    else if (v.unseen && this.reply && this.toldReply !== v.unseen && !this.msg) { this.toldReply = v.unseen; this.flash("The Coordinator replied. space goes back to it.", "green"); }
    if (!this.going) return;
    if (v.status && v.pane) return this.enterCoord();
    if (v.error) { this.going = 0; return this.flash(`The Coordinator could not be started: ${v.error}`, "red"); }
    if (Date.now() - this.going > 90000) { this.going = 0; return this.flash("The Coordinator did not start. alt+c tries again.", "yellow"); }
    this.flash("Starting the Coordinator: its chat opens as soon as it is ready. esc stays on the board.", "yellow");
  }
  // Into the Coordinator: its real herdr pane, exactly as into a task's agent (`chat`). Inside herdr the board exits
  // and herdr shows its pane; outside a herdr client the same terminal attaches to it and the board returns when the
  // attach ends. Not running yet: it is started with nothing said, and you go in as soon as it is there.
  enterCoord() {
    if (!this.canDispatch) { try { this.canDispatch = C.ready(); } catch {} }
    try { this.coord = C.look(); } catch {}
    const v = this.coord;
    if (!(v.status && v.pane)) {
      if (!this.canDispatch && v.state === "none") return this.flash("No Coordinator here: it is off, its program is not installed, or herdr is not running.", "yellow");
      if (!this.going) { try { C.open(); } catch (e) { return this.flash(e.message, "red"); } this.going = Date.now(); this.load(); }
      return this.flash("Starting the Coordinator: its chat opens as soon as it is ready. esc stays on the board.", "yellow");
    }
    this.going = 0;
    if (!inHerdr()) {
      this.tui.stop();
      process.stdout.write("\x1b[2J\x1b[H");
      spawnSync(process.env.HERDR_BIN_PATH || "herdr", ["agent", "attach", v.pane], { stdio: "inherit", env: { ...process.env, HERDR_SOCKET_PATH: currentSocket() } });
      C.typedThere();
      this.tui.start(); this.tui.requestRender(true);
      return this.load();
    }
    C.focus(v);
    this.leave({ entered: "coordinator" });
  }
  // alt+r and alt+n ask first: either one ends what the Coordinator is doing right now.
  coordAct(what) {
    this.confirm(what === "new" ? `Start a new Coordinator on ${C.describe(C.choice())}? This conversation ends.` : "Restart the Coordinator? It keeps this conversation; what it is doing right now stops.", () => {
      if (what === "new") { C.fresh(null); this.flash("A new Coordinator is starting.", "green"); }
      else { C.restart(); this.flash("The Coordinator is restarting, in the same conversation.", "green"); }
      this.load();
    });
  }
  // With nothing of a task's open, your words go to a Coordinator: this machine's, or the one machine you look at.
  get talksToCoord() { return this.canDispatch || (!!this.scope && this.scope !== "*" && !!this.remotes[this.scope]); }
}
