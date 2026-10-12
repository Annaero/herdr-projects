// A task's agent: what its pane shows, what it last said, and going into its real herdr pane.
import { spawnSync } from "node:child_process";
import * as F from "../../flow.js";
import * as R from "../../remote.js";
import * as D from "../../delegate.js";
import { herdr, inHerdr, readScreen } from "../../herdr.js";
import { adapter } from "../../agents.js";
import { reviewing } from "./states.js";

export class AgentPane {
  // What the agent's pane shows, read through herdr. A deep read is done once per completed turn and cached; while
  // the agent is busy only its visible screen is read, at most every two seconds.
  screen(r) {
    if (r.host) return String(r.snap?.screen || "");
    if (!F.isAgentTask(r) || !r.live || r.live.away || r.live.down || r.live.gone) return "";
    const status = r.live.status;
    const settled = status === "idle" || status === "done";
    const key = settled ? `deep:${r.live.agent?.completion_seq ?? r.live.agent?.state_change_seq ?? 0}` : "live";
    const hit = this.screens.get(r.id);
    if (hit && hit.key === key && (settled || Date.now() - hit.at < 2000)) return hit.text;
    let text = "";
    try { text = readScreen(herdr(r.link.socket), r.reviewer_pane || (reviewing(r) && r.link.reviewer?.pane) || r.link.pane, reviewing(r) && r.link.reviewer?.pane ? "working" : status); } catch {}
    text = text.split("\n").map((l) => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    this.screens.set(r.id, { key, at: Date.now(), text });
    return text;
  }
  lastSaid(r) { return String(r.said || ""); } // the agent's last message, read from its saved conversation (its closing note as the fallback)
  // What the Space preview shows: the agent's last message. Its raw screen instead, under "on its screen now", when
  // the agent kind has no reader, when herdr reports it blocked while its turn has not ended (a permission prompt or a
  // menu exists only on its screen), and whenever there is no message yet. Never empty.
  previewOf(r) {
    const said = this.lastSaid(r);
    const kind = r.agent || r.app;
    const dialog = r.stage === "working" && (r.host ? r.state === "blocked" : r.live?.status === "blocked");
    if (said && adapter(kind).readTurn && !dialog && !reviewing(r)) return { label: "last message", text: said };
    const screen = this.screen(r) || r.screen || "";
    return screen ? { label: "on its screen now", text: screen } : { label: said ? "last message" : "", text: said };
  }
  // Into the agent: its real herdr pane. Inside herdr the board exits (the popup closes); outside a herdr client
  // (plain SSH) the same terminal attaches to that one agent and the board returns when the attach ends.
  chat(r) {
    if (r.archivedAt) return this.openPanel();
    if (r.host) return this.remoteChat(r);
    if (!F.isAgentTask(r)) return this.flash("No agent has been on this yet. tab puts one on it.", "yellow");
    F.assertLive(r);
    const api = herdr(r.link.socket);
    // Its space may have been closed (archive closes it): reopen it from the worktree first.
    let pane;
    try { pane = D.reopen(r.id).pane; } catch (e) { return this.flash(e.message, "yellow"); }
    const hasAgent = !!api.agentGet(pane.pane_id);
    if (!inHerdr()) {
      if (!hasAgent) return this.flash("Its agent has exited. space and a reply starts it again.", "yellow");
      this.tui.stop();
      process.stdout.write("\x1b[2J\x1b[H");
      spawnSync(process.env.HERDR_BIN_PATH || "herdr", ["agent", "attach", pane.pane_id], { stdio: "inherit", env: { ...process.env, HERDR_SOCKET_PATH: r.link.socket } });
      this.tui.start(); this.tui.requestRender(true);
      return this.load();
    }
    // herdr cannot focus a bare pane by id: with no agent in it, focus its workspace and tab.
    if (hasAgent) api.agentFocus(pane.pane_id); else { api.workspaceFocus(pane.workspace_id); try { api.tabFocus(pane.tab_id); } catch {} }
    this.leave({ entered: r.id });
  }
  // The board closes when you open an agent. The first few times it says, for a moment, how to get back.
  leave(result) {
    const ms = Number(this.ctx.leaveMs) || 0;
    if (!ms || this.told >= 3) return this.done(result);
    this.told++; this.leaving = true; // nothing more is taken from the keyboard
    this.flash(`Opening the agent. ${this.ctx.boardKey || "herdr-superwork"} brings the board back.`, "green");
    this.tui.requestRender();
    setTimeout(() => this.done(result), ms);
  }
  remoteChat(r) {
    if (!r.link?.pane) return this.flash("No agent has been on this yet. tab puts one on it.", "yellow");
    const attach = (pane) => {
      const { command, args } = R.attachCommand(r.machine, pane);
      this.tui.stop();
      process.stdout.write("\x1b[2J\x1b[H");
      spawnSync(command, args, { stdio: "inherit" });
      this.tui.start(); this.tui.requestRender(true);
      this.pollRemotes(true);
    };
    // A machine on an older plugin sends no version and would not know "reopen": attach to what is there.
    if (!r.machine.version) { this.flash(`Update herdr-superwork on ${r.host}: it cannot reopen a closed space yet.`, "yellow"); return attach(r.link.pane); }
    // The owning machine reopens the task's space and restarts its exited agent in the same conversation, then we attach.
    this.flash(`${r.host}: opening…`);
    this.ssh(r.machine, "do", { action: "reopen", id: r.rid }, (j) => {
      if (!j || !j.ok) { this.flash(j ? j.msg : `${r.host} did not answer`, "red"); return this.tui.requestRender(); }
      if (!j.hasAgent) { this.flash(`${r.host}: its agent has exited and could not be restarted. space and a reply starts it again.`, "yellow"); return this.tui.requestRender(); }
      attach(j.pane || r.link.pane);
    }, 60000);
  }
}
