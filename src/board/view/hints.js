// The hint line at the bottom of the board. A key's name and its usual words come from ../keys.js.
import * as G from "../../gate.js";
import { isAgent, failureFor, canSendError, inReview } from "./states.js";
import { currentReview } from "./review-words.js";
import { hint, name } from "../keys.js";
import { openSuggestions } from "../../store.js";

export class Hints {
  // What esc goes back from right now, with nothing typed: the whole task, then the filter, then the archive.
  // Nothing, where it would only show how the board closes.
  escStep() { return this.full ? "back to the list" : this.filter ? "clear the filter" : this.archiveView ? "back to the board" : ""; }
  // The hint line: what matters right now, the main thing first, at most four. Each one says what the key does and
  // to what: "this task" is the selected one. A hint is [key, words], and may go on: whether it stays when only one
  // fits, and shorter words for a window too narrow for the usual ones (layout.js). What the screen already says is not said again here (the text
  // box's own placeholder says what to type), and a key shows only where it does something.
  hints(r) {
    const more = hint("menu"), enter = name("enter"), esc = name("back"), tab = name("delegate"), put = [esc, "put away"], line = hint("newline"), arrows = [name("up"), name("down")].join(name("up").length + name("down").length > 2 ? " " : ""); // ↑↓
    // The chat's own key, only where it does something: while there is a message to show or hide. It outlasts the
    // other keys in a narrow window (layout.js) only while the message is hidden: that key is how you see a reply.
    const who = this.chatOf(r), up = !!who?.said && this.chatUp(who);
    const key = who?.said ? [hint("chatMessage", `${up ? "hide" : "show"} the latest message`)] : [];
    this.chatKey = up ? null : key[0] || null;
    if (this.ask) return [];
    if (this.closing) return [["", `Press ${name("close")} again to close the board`, false, `${name("close")} again closes the board`]];
    if (this.menu) return [[arrows, "pick a key"], [enter, "press it"], [esc, "close the menu"]];
    if (this.mode === "find") return [[enter, "keep the filter"], [esc, "cancel"]];
    const agentOn = !!r && isAgent(r);
    // While you type: what the keys do with your words. In a narrow window the new line goes first, and esc stays.
    if (this.value()) {
      const fresh = !!r && !r.host && ["todo", "progress"].includes(r.stage);
      if (this.reply && r) return [[enter, this.hasAgent(r) ? "send to this task's agent" : fresh ? "send, and start an agent on this task" : this.canDispatch || r.host ? "send to the Coordinator, about this task" : "add to this task's description", false, "send"], line, put];
      if (this.talksToCoord) return [[enter, "send to the Coordinator", false, "send"], [tab, "send, and put an agent on what it adds"], line, put];
      return [[enter, "add it as a task"], [tab, "add it and put an agent on it"], line, put];
    }
    const back = this.escStep() ? [[esc, this.escStep()]] : [];
    // The whole task: the arrows scroll it there, where it is longer than its place.
    const leave = this.full ? [...(this.panelLength > this.panelHeight ? [[arrows, "scroll the task"]] : []), ...back] : null;
    // Words on their way to another machine.
    if (this.job()) return [hint("stop", "stop sending this"), [enter, "take the words back to change"], ...(leave || [more])];
    if (!r) return [...back, ...key, more];
    // Who you talk to is space's to flip back, never esc's. That hint is marked: it is the one way back, so in a
    // window too narrow for two hints it stays and the main thing goes (layout.js).
    const tail = leave || [this.reply ? [...hint("talk", "back to the Coordinator"), true] : more], mid = leave ? [] : back;
    const failure = failureFor(r), rv = currentReview(r), open = hint("enter"), fix = hint("sendBack"), stop = hint("stop"), agent = hint("delegate");
    const reply = hint("talk", agentOn ? undefined : "talk about this task");
    const retry = hint("yes", r.stage === "failed" ? undefined : "tell this task's agent to try again");
    const asIs = hint("yes", "retry as it is"); // beside the key that has the agent fix it
    let main;
    if (r.archivedAt) main = [hint("archive"), hint("stop", "remove this task")];
    else if (inReview(r)) main = [[...hint("yes", "approve and merge this task"), false, "merge this task"], rv && G.sendable(rv) && hint("sendBack", "send the review to this task's agent"), reply];
    else if (r.stage === "approval" && r.syncBlocked) main = [reply, open];
    else if (r.stage === "approval" && r.state === "blocked") main = [failure?.agentCanFix && !failure.sentAt && fix, hint("yes", "retry the merge"), reply];
    else if (r.stage === "nosummary") main = [hint("sendBack", "tell this task's agent to continue"), hint("yes", "use its work as it is"), open];
    else if (failure?.agentCanFix) main = failure.sentAt && r.state === "working" ? [open, reply, stop] : [fix, r.stage === "failed" && asIs, reply];
    else if (failure) main = [(r.stage === "failed" || r.kind === "auth") && retry, reply, open];
    else if (r.state === "error" && canSendError(r)) main = [fix, r.stage === "failed" && asIs, reply];
    else if (agentOn && r.state === "blocked" && r.kind === "permission") main = [hint("yes", "say yes to this task's agent"), reply, open];
    else if (agentOn && r.state === "blocked") main = [r.kind === "question" ? hint("talk", "answer this task's agent") : reply, open];
    else if (agentOn && r.state === "working") main = [open, reply, stop];
    else if (agentOn) main = [open, reply];
    else if (r.state === "working") main = [agent, hint("stop", "put it back in to do")]; // your own task: nobody's agent to stop
    else main = [agent, reply];
    // While you talk to this task's agent, space is in the tail: it goes back to the Coordinator.
    main = main.filter((h) => h && !(this.reply && !r.archivedAt && h[0] === name("talk")));
    // The first hint that names it says whose agent, "this task's"; after that it is "the agent".
    let named = false;
    main = main.map(([k, d, ...rest]) => { const words = named ? d.replace("this task's agent", "the agent") : d; named ||= d.includes("this task"); return [k, words, ...rest]; });
    // A suggested task waits on this one: its key, when there is room. It never takes a hint's place.
    const shown = main.slice(0, 4 - tail.length - mid.length);
    const asked = !this.reply && r.title !== undefined && openSuggestions(r).length && shown.length + mid.length + tail.length < 4 ? [hint("suggested")] : [];
    return [...shown, ...asked, ...mid, ...key, ...tail];
  }
}
