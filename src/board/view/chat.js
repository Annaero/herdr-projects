// The chat at the bottom: who it talks to, the line that names them, and their latest message.
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import * as F from "../../flow.js";
import * as C from "../../coordinator.js";
import { herdr } from "../../herdr.js";
import { short, clean } from "./words.js";
import { isAgent, reviewing, groupOf, statusColor, reviewerWord } from "./states.js";
import { name as keyName } from "../keys.js";

export class Chat {
  // ---- the chat ---------------------------------------------------------------------------------------------------------
  // One chat at the bottom of the board, the same for everyone you can talk to. Who that is follows one rule: the
  // Coordinator, until space flips it to the selected task's agent (and space flips it back). Only its latest message
  // is drawn here, and one key (alt+v) shows and hides it, whoever it is from: the whole conversation is the agent's
  // own pane, which `openChat` goes into.
  // A start that failed says why even while the chat is hidden, so hiding it also puts that one error away: the
  // same error stays hidden, the next one shows again.
  toggleChat() {
    const c = this.chatOf(this.current());
    if (c?.always) { this.errHid = this.coord.error; this.chatOpen = false; } else this.chatOpen = !this.chatOpen;
    this.savePrefs(); this.syncCoord();
  }
  openChat() { const r = this.current(); return this.reply && r ? this.chat(r) : this.enterCoord(); }
  // A reply to this task goes to an agent of its own (not, with its task named, to the Coordinator).
  hasAgent(r) { return isAgent(r) && (!!r.host || F.isAgentTask(r) || F.cleanedUp(r)); }
  // The task panel leaves "The agent said" to the chat while the chat shows that same message.
  chatShows(r) { return !!r && this.reply && this.chatOpen && this.mode !== "find" && r.id === this.sel && !r.archivedAt && this.hasAgent(r); }
  // Who the chat talks to, as the chat draws it: a mark and a name, where they stand, and the latest thing they said.
  // The same shape for the Coordinator and for a task's agent. `enter`: there is a chat of theirs to go into.
  chatOf(r) {
    const t = this.theme;
    if (this.mode === "find") return null;
    if (this.reply && r) {
      const color = statusColor(r), toAgent = this.hasAgent(r);
      const word = r.archivedAt ? "archived" : reviewing(r) && r.state === "working" ? reviewerWord(r) : groupOf(r);
      const starts = !r.host && !isAgent(r) && ["todo", "progress"].includes(r.stage);
      const meta = r.archivedAt ? "read-only" : toAgent ? `its agent · ${clean(r.app || r.agent || "agent")}` : starts ? "no agent yet: your message starts one" : this.canDispatch || r.host ? "no agent on it: your message goes to the Coordinator, about this task" : "no agent on it: your message is added to its description";
      const pv = this.chatShows(r) ? this.previewOf(r) : null;
      return { mark: this.mark(r), color, name: clean(r.title || r.id), word, meta, label: pv?.text ? pv.label : "", text: pv?.text || "", raw: pv?.label === "on its screen now", notes: [], enter: toAgent && !r.archivedAt && (!!r.host || F.isAgentTask(r)), said: toAgent && !r.archivedAt };
    }
    const far = this.scope && this.scope !== "*" && this.remotes[this.scope] ? this.scope : "";
    if (far) return { mark: t.fg("overlay0", t.mark("unknown")), color: "overlay0", name: `Coordinator on ${far}`, word: "", meta: `what you type goes to ${far}`, label: "", text: "", notes: [] };
    // No Coordinator (it is off, its program is not installed, or herdr is not running): the same box files tasks.
    if (!this.canDispatch) return { mark: t.fg("overlay0", "+"), color: "overlay0", name: "New task", word: "", meta: "what you type is filed as a task, word for word", label: "", text: "", notes: [] };
    const v = this.coord;
    const fresh = !!v.unseen && !this.chatOpen;
    const color = fresh ? "green" : { working: "yellow", starting: "yellow", blocked: "red", idle: "green" }[v.state] || "overlay0";
    const word = v.error ? "could not be started" : fresh ? "new reply" : { none: "not started", starting: "starting", working: "working", blocked: "needs you", idle: "idle", exited: "stopped" }[v.state] || v.state;
    const mark = t.fg(v.error ? "red" : color, t.mark(v.error ? "error" : ["working", "starting"].includes(v.state) ? "working" : v.state === "blocked" ? "blocked" : v.state === "idle" ? "idle" : "unknown"));
    let label = "", text = "", tone = "";
    if (v.error) { text = `It could not be started: ${v.error}`; tone = "red"; }
    else if (v.state === "blocked") { label = "on its screen now"; text = C.screen(v) || `Something on its screen waits for you. ${keyName("chat")} opens its chat.`; }
    else if (v.said) { label = v.state === "working" ? "so far" : "last message"; text = v.said; }
    else {
      const on = v.status && (v.state === "working" || !v.readable) ? C.screen(v) : ""; // a program whose conversation cannot be read: its screen
      if (on) { label = "on its screen now"; text = on; }
      else { tone = "overlay0"; text = { none: "Ask or tell it anything: it starts with your first message, and stays.", starting: "Starting…", idle: "Ready. Ask or tell it anything.", exited: "Your next message starts it again, in the same conversation." }[v.state] || "Nothing said yet."; }
    }
    const notes = [];
    if (v.stale) notes.push(`your default is now ${C.describe(v.def)}: ${keyName("coordNew")} starts a new one on it`);
    for (const m of v.waiting || []) notes.push(`› ${clean(m)}  (waiting to be sent)`);
    if (!v.queue && v.last && v.state !== "none") notes.push(`› ${clean(v.last)}`);
    return { mark, color: v.error ? "red" : color, name: "Coordinator", word, meta: `${v.run ? C.describe(v.run) : "off"}${v.oneOff ? " (this one only)" : ""}`, label, text, tone, raw: label === "on its screen now", notes, enter: true, said: true, always: !!v.error && this.errHid !== v.error };
  }
  // The chat's first line names who you talk to, on the whole width: the name is never cut to make room for the rest.
  // What stands beside it goes first when the window is narrow: the keys, then the label, the program, the state.
  chatHead(c, width, tight = false) {
    const t = this.theme;
    const lead = " " + c.mark + " ", room = Math.max(1, width - visibleWidth(lead));
    const name = t.bold(c.name);
    const bits = [c.word && "  " + t.fg(c.color, c.word), c.meta && t.fg("overlay0", "  " + c.meta), c.label && this.chatOpen && t.fg("overlay0", "  · " + c.label)].filter(Boolean);
    // The chat's two keys, in full or in short. Where neither fits beside the name, the hint line below says alt+v.
    const up = this.chatOpen || c.always;
    const toggle = `${keyName("chatMessage")} ${up ? "hide" : "show"}`;
    const forms = [[c.enter && `${keyName("chat")} open its chat`, c.said && `${toggle} its message`], [c.enter && `${keyName("chat")} chat`, c.said && toggle]].map((f) => f.filter(Boolean).join(" · "));
    let keys = forms[0];
    const fits = (n, withKeys) => visibleWidth(name + bits.slice(0, n).join("")) + (withKeys && keys ? 3 + visibleWidth(keys) : 0) <= room;
    // The keys outlast the label and the program; the state outlasts the keys.
    let n = bits.length, showKeys = !!keys;
    while (n > 1 && !fits(n, true)) n--;
    if (!fits(n, true)) { keys = forms[1]; n = bits.length; while (n > 1 && !fits(n, true)) n--; }
    if (!fits(n, true)) { showKeys = false; n = bits.length; while (n && !fits(n, false)) n--; }
    this.chatKeyHint = c.said && !showKeys ? [keyName("chatMessage"), `${up ? "hide" : "show"} its message`] : null;
    // A name longer than the window takes a second line before it is cut (in a short window that line is the draft's).
    if (!fits(0, false) && tight) return [lead + truncateToWidth(name, room, "…")];
    if (!fits(0, false)) { const [a, b, more] = wrapTextWithAnsi(name, room); return [lead + a, ...(b ? ["   " + (more ? truncateToWidth(b, room - 1, "") + "…" : b)] : [])]; }
    const left = name + bits.slice(0, n).join("");
    return [lead + left + (showKeys ? " ".repeat(room - visibleWidth(left) - visibleWidth(keys) - 1) + t.fg("overlay0", keys) : "")];
  }
  // The chat above the text box: a rule, who you talk to, and (unless you hid it) the latest thing they said.
  chatLines(width, maxH, r, tight = false) {
    const t = this.theme, c = this.chatOf(r);
    this.chatKeyHint = null;
    if (!c) return [];
    const out = [t.fg("surface_dim", "─".repeat(width)), ...this.chatHead(c, width, tight)];
    this.chatHeadRows = out.length;
    if (!this.chatOpen && !c.always) return out; // a start that failed says why, hidden or not
    const wrapAll = (text) => String(text).split("\n").flatMap((l) => { const w = wrapTextWithAnsi(clean(l), Math.max(10, width - 2)); return w.length ? w : [""]; });
    const lines = c.text ? wrapAll(c.raw ? c.text : c.text.replace(/\*\*([^*\n]+)\*\*/g, "$1")) : [];
    return [...out, ...c.notes.map((n) => " " + t.fg("overlay0", n)), ...(lines.length > maxH ? [" " + t.fg("overlay0", "…")] : []), ...lines.slice(-maxH).map((l) => " " + (c.tone ? t.fg(c.tone, l) : l))];
  }
}
