// The web board and the web UI's machines: opening an agent that runs on another machine in the web UI's own view of
// that machine's pane, and showing the board of the machine the web UI is on. Which of the web UI's PCs is which of
// the board's machines is pcs.js; this file is what the web board does with it. Work never moves between machines:
// the other machine reopens its own task's space, and the page only goes to the web UI's link for that pane.
import * as R from "../remote.js";
import * as K from "../board/keys.js";
import { pcOf, machineOf } from "./pcs.js";

const RETRY = 10000;
// The board's machines, as it asks herdr for them (the answer comes at once).
const machines = () => { let list = []; try { R.machines((l) => { list = l; }); } catch {} return list; };

// What the front door passes with a call: the web UI's PCs as it last asked (null: it could not say), and the PC the
// page is on ("" for this machine). When the web UI goes to another PC, the board goes with it: that machine's board
// by itself, as alt+m shows it. Back on this machine it shows what it showed before. A PC the board has no machine
// for is said once; the board then stays on what it showed.
export function followWeb(v, { pcs, machine } = {}) {
  if (Array.isArray(pcs)) v.pcs = pcs;
  if (machine === undefined) return;
  const at = !machine || machine === "local" ? "" : String(machine);
  // On a PC the board knew no machine for: looked for again every few seconds (asking herdr starts a program), so
  // the board goes there by itself once the machine has been added.
  const again = at && v.strangerAt === at && Date.now() - (v.strangerTried || 0) >= RETRY;
  if (at === (v.webAt ?? "") && !again) return;
  // On another PC whose list has not come yet: asked again with the next call.
  const pc = at ? (v.pcs || []).find((p) => p.id === at) : null;
  if (at && !pc) return;
  v.webAt = at;
  if (v.strangerAt !== at) v.strangerAt = "";
  if (!at) { if (v.followed !== undefined) { const back = v.followed; v.followed = undefined; if (v.scope !== back) v.setScope(back); } return; }
  if (pc.local) return;
  const m = machineOf(pc, machines());
  if (!m) {
    v.strangerTried = Date.now();
    if (v.strangerAt === at) return; // said already
    v.strangerAt = at;
    // Not the board of the PC it was on before either: back to what it showed before it went anywhere.
    if (v.followed !== undefined) { const back = v.followed; v.followed = undefined; if (v.scope !== back) v.setScope(back); }
    return v.flash(`The web UI is on ${pc.name}, which the board knows no machine for: add it with herdr machine add (or name it in board.machines). The board shows what it showed before.`, "yellow");
  }
  v.strangerAt = "";
  if (v.followed === undefined) v.followed = v.scope;
  if (v.scope !== m.label) v.setScope(m.label);
}

// "Open this task's agent" for a task on another machine: that machine reopens the task's space and restarts an
// exited agent, as it does for the terminal board, and the page then goes to the web UI's view of that pane on that
// PC. When that cannot be, the board says which of the two programs is missing what.
export function webChat(v, r) {
  if (!r.link?.pane) return v.flash(`No agent has been on this yet. ${K.name("delegate")} puts one on it.`, "yellow");
  if (!v.pcs) return v.flash(`The web UI did not say which PCs it has (it may be an older one), so ${r.host}'s agent cannot be opened from here. In the web UI, pick it in the sidebar under ${r.host}.`, "yellow");
  const pc = pcOf(r.machine, v.pcs);
  if (!pc) return v.flash(`The web UI has no PC for ${r.host} (${r.machine?.target || "no address"}). Add it there (Settings → Remote PCs → Add PC), then open the agent again.`, "yellow");
  if (!pc.connected) return v.flash(`${pc.name} is not connected in the web UI${pc.state ? ` (${pc.state})` : ""}. Connect it there, then open the agent again.`, "yellow");
  const land = (pane, workspace, hasAgent) => {
    v.stick = r.id;
    v.go = { n: (v.go?.n || 0) + 1, machine: pc.id, pane, workspace: workspace || String(pane).split(":")[0], view: hasAgent ? "chat" : "terminal" };
  };
  // A machine on an older plugin sends no version and would not know "reopen": the pane it last named is opened.
  if (!r.machine.version) { v.flash(`Update herdr-superwork on ${r.host}: it cannot reopen a closed space yet.`, "yellow"); return land(r.link.pane, "", true); }
  v.flash(`${r.host}: opening…`);
  v.ssh(r.machine, "do", { action: "reopen", id: r.rid }, (j, why) => {
    if (!j || !j.ok) return v.flash(j ? j.msg : R.unanswered(r.host, why), "red");
    if (/^[^:]+: opening…$/.test(v.msg || "")) v.msg = "";
    land(j.pane || r.link.pane, j.workspace, j.hasAgent !== false);
  }, 60000);
}
