// Other machines: ask each for its board, send each action to the machine that owns the task, and whose board you see.
import os from "node:os";
import * as S from "../../store.js";
import * as R from "../../remote.js";
import { herdr } from "../../herdr.js";
import { asRow } from "./states.js";

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
      this.ssh(m, "list", null, (j) => {
        m.busy = false;
        if (j && Array.isArray(j.tasks)) { m.ok = true; m.version = j.version || ""; m.items = j.tasks.map((x) => ({ ...asRow(x), id: `${m.label}:${x.id}`, rid: x.id, host: m.label, machine: m })); }
        else { m.ok = false; m.failAt = Date.now(); m.items = []; }
        try { this.load(); } catch {} this.tui.requestRender();
      });
    }
  }
  // One of the few exact actions, on a task that lives on another machine.
  act(r, action, extra = {}, quiet = false, after) {
    if (!quiet) this.flash(`${r.host}: …`);
    // A task's work settings travel with it: what this machine says for it (you, and your entry for its repo) is
    // worked out here and sent along with whatever starts its agent. Board settings stay with each machine.
    const travel = ["delegate", "tell"].includes(action) ? { settings: S.toSend(String(r.rid).split("/")[0]), from: os.hostname() } : {};
    this.ssh(r.machine, "do", { action, id: r.rid, ...travel, ...extra }, (j) => {
      if (!quiet || !(j && j.ok)) this.flash(j ? j.msg : `${r.host} did not answer`, j && j.ok ? "green" : "red");
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
  nextScope() { let ring = [""]; try { ring = ["", "*", ...Object.keys(this.remotes).filter((k) => this.remotes[k].ok).sort()]; } catch {} return this.setScope(ring[(ring.indexOf(this.scope) + 1) % ring.length] ?? ""); }
}
