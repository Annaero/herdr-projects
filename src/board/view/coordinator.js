// The Coordinator from the board: sending it your words, and counting a reply you can see as seen.
import os from "node:os";
import * as S from "../../store.js";
import * as A from "../../actions.js";
import * as C from "../../coordinator.js";
import { name as keyName } from "../keys.js";
import { unanswered } from "../../remote/why.js";

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
      this.ssh(there, "dispatch", { text: words, delegate, settings: S.toSend(""), from: os.hostname(), about: about && about.host ? about.rid : undefined }, (j, why) => {
        try {
          if (!S.getDispatch(job.id)) return;
          if (j && j.ok) S.clearDispatch(job.id);
          else S.setDispatch(job.id, { state: "error", msg: j ? j.msg : unanswered(there.label, why) });
          this.pollRemotes(true); this.load(); this.tui.requestRender();
        } catch {}
      }, 150000);
      return this.load();
    }
    if (!this.canDispatch) { try { this.canDispatch = C.ready(); } catch {} } // it may have been turned on a moment ago
    if (!this.canDispatch) {
      // No Coordinator (it is off, its program is not installed, or herdr is not running): what you type is added as
      // a task, word for word.
      const about0 = about && !about.host ? about : null;
      if (about0) { A.describe(about0.id, `${about0.description ? `${about0.description}\n\n` : ""}${text}`); this.flash(`${about0.id}: updated (description)`, "green"); return this.load(); }
      const [title, ...restLines] = text.split("\n");
      const t = A.add(this.ctx.cwd, title, { description: restLines.join("\n") });
      if (delegate) A.delegate(t.id);
      this.flash(`${t.id}: added${delegate ? ", an agent is on it" : ""}`, "green");
      this.sel = t.id;
      return this.load();
    }
    C.send(this.ctx.cwd, text, { delegate, about: about ? about.id : null });
    this.load();
  }
  // Called on every beat and after every change: a reply you can see counts as seen.
  syncCoord() {
    const v = this.coord;
    if (v.unseen && !this.reply && this.chatOpen && !this.setup) { C.seen(v.unseen); this.coord = { ...v, unseen: "" }; }
    // While you talk to a task's agent the chat shows that agent: the Coordinator's reply is said once, in a line.
    else if (v.unseen && this.reply && this.toldReply !== v.unseen && !this.msg) { this.toldReply = v.unseen; this.flash(`The Coordinator replied. ${keyName("talk")} goes back to it.`, "green"); }
  }
  // With nothing of a task's open, your words go to a Coordinator: this machine's, or the one machine you look at.
  get talksToCoord() { return this.canDispatch || (!!this.scope && this.scope !== "*" && !!this.remotes[this.scope]); }
}
export const part = Coordinator; // what this file adds to the board: view.js loads every file here that names its part
