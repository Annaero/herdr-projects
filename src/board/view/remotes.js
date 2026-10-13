// Other machines: ask each for its board, send each action to the machine that owns the task, and whose board you see.
import os from "node:os";
import * as S from "../../store.js";
import * as R from "../../remote.js";
import { herdr } from "../../herdr.js";
import { name as keyName } from "../keys.js";
import { asRow } from "./states.js";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

export class Remotes {
  // ---- other machines: ask each for its board, and send each action to the machine that owns the task ----
  ssh(m, what, arg, cb, ms = 20000) { R.ask(m, what, arg, cb, ms); }
  pollRemotes(now = false) {
    if (Date.now() - this.machinesAt > 60000) {
      this.machinesAt = Date.now();
      R.machines((list) => {
        for (const m of list) if (!this.remotes[m.label]) this.remotes[m.label] = { ...m, items: [], ok: false, busy: false, failAt: 0 };
        for (const k of Object.keys(this.remotes)) if (!list.some((m) => m.label === k)) delete this.remotes[k];
        this.pollRemotes(true);
      });
    }
    for (const m of Object.values(this.remotes)) {
      if (m.busy || (!now && !m.ok && Date.now() - m.failAt < 30000)) continue; // one that does not answer is asked again later
      m.busy = true;
      this.ssh(m, "list", null, (j, why) => {
        m.busy = false;
        // One that did not answer is never an empty one: why it could not be read is kept, and shown where its tasks
        // would be (list.js: unreadLines).
        if (j && Array.isArray(j.tasks)) { m.ok = true; m.why = null; m.version = j.version || ""; m.items = j.tasks.map((x) => ({ ...asRow(x), id: `${m.label}:${x.id}`, rid: x.id, host: m.label, machine: m })); m.autos = this.farAutos(m, j.automations); }
        else { m.ok = false; m.failAt = Date.now(); m.items = []; m.autos = []; m.why = j ? R.notList(j, m) : why || R.unknown(m); }
        try { this.load(); } catch {} this.tui.requestRender();
      });
    }
  }
  // One of the few exact actions, on a task that lives on another machine.
  act(r, action, extra = {}, quiet = false, after) {
    // What is being done there, in words: never a bare "…".
    const doing = { pin: r.pinned ? "Unpinning" : "Pinning", archive: "Archiving", restore: "Restoring", delegate: "Putting an agent on", stop: "Stopping", clear: "Removing", approve: "Merging", set: "Changing a setting of" }[action] || "Sending to";
    if (!quiet) this.flash(`${doing} ${this.idSay(r)} on ${r.host}…`);
    // A task's work settings travel with it: what this machine says for it (you, and your entry for its repo) is
    // worked out here and sent along with whatever starts its agent. Board settings stay with each machine.
    const travel = ["delegate", "tell"].includes(action) ? { settings: S.toSend(String(r.rid).split("/")[0]), from: os.hostname() } : {};
    this.ssh(r.machine, "do", { action, id: r.rid, ...travel, ...extra }, (j, why) => {
      if (!quiet || !(j && j.ok)) this.flash(j ? j.msg : R.unanswered(r.host, why), j && j.ok ? "green" : "red");
      if (j && j.ok && (action === "archive" || action === "restore")) {
        r.archivedAt = action === "archive" ? Date.now() : null;
        if (action === "archive") this.archiveUndo = r;
        this.foldPanel();
      }
      after?.(!!j?.ok);
      this.pollRemotes(true); this.tui.requestRender();
    });
  }
  // Whose board: this machine, every machine you can reach, or one of them.
  setScope(to) {
    this.scope = to; this.savePrefs();
    if (this.all) { this.machinesAt = 0; this.pollRemotes(true); }
    // Machines are found through herdr only: with none saved, say how to add one.
    if (this.all && !Object.keys(this.remotes).length) { let none = false; R.machines((list) => { none = !list.length; }); if (none) { this.scope = ""; this.savePrefs(); this.flash(S.setting("board.machines") === "none" ? "Other machines are off (unset board.machines turns them on)." : "No other machines. Add one with: herdr machine add <name> <ssh target>  (or name them in the board.machines setting).", "yellow"); return this.load(); } }
    this.flash(this.scope === "" ? "This machine only." : this.scope === "*" ? "Every machine you can reach." : `Only ${this.scope}. What you type goes to ${this.scope}.`);
    return this.load();
  }
  // A machine that does not answer keeps its place in the round: its own board is where the reason is said in full.
  scopeNext() { let ring = [""]; try { ring = ["", "*", ...Object.keys(this.remotes).sort()]; } catch {} return ring[(ring.indexOf(this.scope) + 1) % ring.length] ?? ""; }
  nextScope() { return this.setScope(this.scopeNext()); }
  // The machines in view whose tasks could not be read (or have not come yet), each with why: what the list says
  // where their tasks would be.
  unread() {
    const all = !this.remotes ? [] : this.scope === "*" ? Object.values(this.remotes) : this.scope && this.remotes[this.scope] ? [this.remotes[this.scope]] : [];
    return all.filter((m) => !m.ok).map((m) => (m.why ? { machine: m.label, line: `${m.label}: its tasks cannot be read: ${m.why.line}.`, detail: [...(m.why.said ? ["What came back:", ...m.why.said.split("\n").map((l) => `  ${l}`), ""] : []), ...m.why.detail] } : { machine: m.label, line: `${m.label}: asking for its tasks…`, detail: [] }));
  }
  // As lines of the list: one short line per machine. On that machine's own board, where no task can show, the
  // whole of it follows: what happened, what to do, what came back.
  unreadLines(width) {
    const t = this.theme, whole = this.scope !== "*", out = [];
    const wrapped = (text, room) => { const x = wrapTextWithAnsi(text, Math.max(10, room)); return x.length ? x : [""]; };
    for (const u of this.unread()) {
      out.push(...wrapped(u.line + (u.detail.length && !whole ? ` More: ${keyName("scope")}.` : ""), width - 2).map((l) => " " + t.fg(u.detail.length ? "yellow" : "overlay0", l)));
      if (whole && u.detail.length) out.push("", ...u.detail.flatMap((l) => wrapped(l, width - 4)).map((l) => "   " + t.fg("subtext0", l)));
    }
    return out;
  }
}
export const part = Remotes; // what this file adds to the board: view.js loads every file here that names its part
