// The chat at the bottom: who it talks to, the line that names them, and their latest message.
import { stripVTControlCharacters } from "node:util";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import * as F from "../../flow.js";
import * as C from "../../coordinator.js";
import * as S from "../../store.js";
import { adapter } from "../../agents.js";
import { clean } from "./words.js";
import { isAgent, reviewing, underReview, checking, standing, reviewerWord } from "./states.js";
import { partLines, partsText } from "./chat-text.js";
import { withMine } from "./talk.js";

// The fewest cells the status keeps when the progress stands beside it.
const CHAT_STATUS_MIN = 20;
export class Chat {
  // ---- the chat ---------------------------------------------------------------------------------------------------------
  // One chat at the bottom of the board, the same for everyone you can talk to. Who that is follows one rule: the
  // Coordinator, until space flips it to the selected task's agent (and space flips it back). It is one line that
  // says who you talk to and, under it, one box: their latest message, a blank line, the line you type on. One key
  // shows and hides the message, whoever it is from: the whole conversation is the agent's own pane (enter, with
  // nothing typed, goes into a task agent's).
  // A start that failed says why even while the chat is hidden, so hiding it also puts that one error away: the
  // same error stays hidden, the next one shows again.
  toggleChat() {
    const c = this.chatOf(this.current());
    if (c?.always) { this.errHid = this.coord.error; this.chatOpen = false; } else this.chatOpen = !this.chatOpen;
    this.savePrefs(); this.syncCoord();
  }
  // A reply to this task goes to an agent of its own (not, with its task named, to the Coordinator).
  hasAgent(r) { return isAgent(r) && (!!r.host || F.isAgentTask(r) || F.cleanedUp(r)); }
  // The task panel leaves "The agent said" to the chat while the chat shows that same message.
  chatShows(r) { return !!r && this.reply && this.chatOpen && !this.chatFolded && this.mode !== "find" && r.id === this.sel && !r.archivedAt && this.hasAgent(r) && !this.sentTo(r); }
  // What you just sent to a task's agent stands in the box until that agent says something new. It is remembered,
  // at the moment it is sent, with what the agent had last said and the turn it said it in: its next message takes
  // your words away again, also one in the very same words ("Done." twice), and also when the chat was showing
  // someone else in between. Nothing else does: a turn the task no longer knows (a new round starting) is no answer.
  noteSent(r, text) { let now = null; if (!r.host) { try { now = S.get(r.id); } catch {} } this.justSent.set(r.id, { text: String(text), over: this.turnMark(now || r) }); }
  turnMark(r) { const h = r.handled || {}; return { said: String(r.said || ""), turn: h.msg ?? null, comp: h.comp ?? null }; }
  sentTo(r) {
    const s = this.justSent.get(r.id);
    if (!s) return "";
    const now = this.turnMark(r), moved = (k) => now[k] != null && s.over[k] != null && now[k] !== s.over[k];
    // A program whose conversation cannot be read never says something new here: its screen shows instead.
    if (now.said !== s.over.said || moved("turn") || moved("comp") || !adapter(r.agent || r.app).readTurn) { this.justSent.delete(r.id); return ""; }
    return s.text;
  }
  // Who the chat talks to, as the chat draws it: a mark, a name, one greyed line on where they stand, and the latest
  // message. The same shape for the Coordinator and for a task's agent. `mine`: the message is your own, just sent.
  // `said`: they have a latest message to show or hide.
  chatOf(r) {
    const t = this.theme;
    if (this.mode === "find") return null;
    if (this.reply && r) {
      const toAgent = this.hasAgent(r);
      const word = r.archivedAt ? "archived" : underReview(r) ? reviewerWord(r) : standing(r);
      const starts = !r.host && !isAgent(r) && ["todo", "progress"].includes(r.stage);
      // With an agent on it: what the task's row says (the Watcher's "doing now" line), or where the task stands.
      const status = r.archivedAt ? "archived: read-only" : toAgent ? stripVTControlCharacters(this.sentence(r).text) || word : starts ? "no agent yet: your message starts one" : this.canDispatch || r.host ? "no agent on it: your message goes to the Coordinator, about this task" : "no agent on it: your message is added to its description";
      const said = toAgent && !r.archivedAt;
      // The conversation's own words (talk.js): the agent's, or the reviewer's while the task is under review.
      const k = said ? this.talk(r) : null;
      // A dialog on its screen, or a review of its work, outranks your own words: it is what there is to see now.
      const mine = said && !k.dialog && !reviewing(r) ? this.sentTo(r) : "";
      const parts = k ? withMine(k.parts, mine) : [], text = partsText(parts), raw = !!k?.raw;
      // A status line that only starts the message in the box under it says nothing: where the task stands instead.
      const echo = toAgent && status !== word && this.chatOpen && clean(parts.at(-1)?.text || "").startsWith(status.replace(/…$/, ""));
      // While the board runs its check, the check's progress as the row has it, in the row's colour: the bar, the percent and the minutes left; without the bar where that is too wide.
      const f = toAgent && checking(r) ? this.rowFields(r, Date.now()) : {};
      const progress = [[f.bar, f.percent, f.eta], [f.percent, f.eta]].map((cells) => cells.filter(Boolean).join(" ")).filter((p, n, all) => p && all.indexOf(p) === n);
      return { mark: this.mark(r), tag: this.numberTag(r), name: clean(r.title || r.id), status: t.muted(echo ? word : status), progress, text, parts, mine: !!mine, raw: raw && !mine, said, turn: JSON.stringify(this.turnMark(r)) };
    }
    const far = this.scope && this.scope !== "*" && this.remotes[this.scope] ? this.scope : "";
    if (far) return { mark: t.fg("overlay0", t.mark("unknown")), color: "overlay0", name: `Coordinator on ${far}`, status: t.muted(`what you type goes to ${far}`), text: "" };
    // No Coordinator (it is off, its program is not installed, or herdr is not running): the same box adds tasks.
    if (!this.canDispatch) return { mark: t.fg("overlay0", "+"), color: "overlay0", name: "New task", status: t.muted("added word for word"), text: "" };
    const v = this.coord;
    const fresh = !!v.unseen && !this.chatOpen;
    const color = fresh ? "green" : { working: "yellow", starting: "yellow", blocked: "red", idle: "green" }[v.state] || "overlay0";
    const word = v.error ? "could not be started" : fresh ? "new reply" : { none: "not started: your first message starts it", starting: "starting", working: "working", blocked: "needs you", idle: "idle", exited: "stopped: your next message starts it again" }[v.state] || v.state;
    const mark = t.fg(v.error ? "red" : color, t.mark(v.error ? "error" : ["working", "starting"].includes(v.state) ? "working" : v.state === "blocked" ? "blocked" : v.state === "idle" ? "idle" : "unknown"));
    const waiting = (v.waiting || []).length;
    const status = [word, waiting && `${waiting} ${waiting > 1 ? "messages wait" : "message waits"} to be sent`].filter(Boolean).join(" · ");
    // Rare, and too long for the status: a default that changed under a running Coordinator gets a line of its own.
    const note = v.stale ? `your default is now ${C.describe(v.def)}: herdr-superwork coordinator new starts a new one on it` : "";
    // Which program, model and effort it runs on is not said here: that is the Coordinator's own pane's to say.
    // Its conversation's own words, as a task's agent's (talk.js). A start that failed says why in their place.
    const k = v.error ? { parts: [{ by: "", text: `It could not be started: ${v.error}`, tone: "red" }] } : this.coordTalk(v, C);
    const text = partsText(k.parts), tone = v.error ? "red" : "", raw = !!k.raw, mine = !!k.mine;
    return { mark, color: v.error ? "red" : color, name: "Coordinator", status: t.muted(status), text, parts: k.parts, tone, raw, mine, note, said: true, turn: String(v.turn?.id || ""), always: !!v.error && this.errHid !== v.error };
  }
  // The line that says who you talk to is what herdr's sidebar says about that agent, with the board's own mark: the
  // mark, the name in bold, and what it is doing now, greyed (a review's verdict keeps its colour on the row, not
  // here). The name is never cut to make room: the status takes what is left and is cut with "…", however little
  // that is. The chat's keys are not named here: they are on the hint line under the box.
  chatHead(c, width, tight = false) {
    const t = this.theme;
    // A task's number stands before its name, greyed, as on its row (row-number.js); the narrowest windows go without it.
    const bare = " " + c.mark + " ", tagged = c.tag && width - visibleWidth(bare) - visibleWidth(c.tag) - 1 >= CHAT_STATUS_MIN;
    const lead = bare + (tagged ? t.muted(c.tag) + " " : ""), room = Math.max(1, width - visibleWidth(lead));
    const name = t.bold(c.name), nameW = visibleWidth(name);
    // A name longer than the window takes a second line before it is cut (in a short window that line is the draft's).
    if (nameW > room && tight) return [lead + truncateToWidth(name, room, "…")];
    if (nameW > room) { const [a, b, more] = wrapTextWithAnsi(name, room); return [lead + a, ...(b ? ["   " + (more ? truncateToWidth(b, room - 1, "") + "…" : b)] : [])]; }
    const left = room - nameW - 2;
    // The progress sits right after the status and is never cut: it shows whole, without its bar, or not at all.
    // The status keeps CHAT_STATUS_MIN cells beside it, or all it needs when that is less.
    const statusW = visibleWidth(c.status || ""), progress = (c.progress || []).find((p) => left - visibleWidth(p) - 2 >= Math.min(statusW, CHAT_STATUS_MIN)) || "";
    const forStatus = left - (progress ? visibleWidth(progress) + 2 : 0);
    return [lead + name + (c.status && forStatus >= 1 ? "  " + truncateToWidth(c.status, forStatus, "…") : "") + (progress ? "  " + progress : "")];
  }
  // Above the text box: an empty line (a short window has none to spare), then who you talk to, so the list never
  // runs into the name.
  chatLines(width, r, tight = false) {
    const c = this.chatOf(r);
    return c ? [...(tight ? [] : [""]), ...this.chatHead(c, width, tight), ...(c.note && !tight ? ["   " + this.theme.muted(truncateToWidth(c.note, Math.max(1, width - 3), "…"))] : [])] : [];
  }
  // Is the box open on the latest message? A start that failed says why, hidden or not.
  chatUp(c) { return !!c && (this.chatOpen || !!c.always); }
  // The conversation, wrapped to `width`, on at most `max` lines: each thing said under the line that names who said
  // it, their words in grey, your own in the bright colour. The box opens on the newest of them; what was said
  // before it is above, and a longer one scrolls (chat-scroll.js says from where, and how).
  chatMessage(c, width, max) {
    const t = this.theme;
    if (c && !c.text) this.chatAt = null; // nothing said in between: the same words after it are a new message
    if (!c?.text || max < 1) return [];
    // Their words have to be read: the brighter of the two greys (theme.js: soft). Who said them is the quiet one.
    const paint = (kind, l, p) => (kind === "by" ? t.muted(l) : p.tone ? t.fg(p.tone, l) : p.mine ? l : t.soft(l));
    const { lines, latest } = partLines(c.parts || [{ by: "", text: c.text, raw: c.raw, mine: c.mine, tone: c.tone }], Math.max(1, width), paint);
    const top = this.chatWindow(c, lines.length, max, latest);
    return lines.slice(top, top + this.chatFit.rows);
  }
}
