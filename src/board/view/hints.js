// The hint line at the bottom of the board. A key's name and its usual words come from ../keys.js.
import * as G from "../../gate.js";
import { isAgent, failureFor, canSendError, inReview } from "./states.js";
import { currentReview } from "./review-words.js";
import { hint, name } from "../keys.js";

export class Hints {
  // The hint line: what matters right now, the main thing first, at most four.
  hints(r) {
    const more = hint("menu"), enter = name("enter"), esc = name("back"), tab = name("delegate"), put = [esc, "put away"], line = hint("newline"), arrows = [name("up"), name("down")].join(name("up").length + name("down").length > 2 ? " " : ""); // ↑↓
    if (this.ask) return [];
    if (this.closing) return [["", `Press ${name("close")} again to close the board`]];
    if (this.menu) return [[arrows, "pick"], [enter, "do it"], [esc, "close"]];
    if (this.mode === "find") return [[enter, "keep the filter"], [esc, "cancel"]];
    const agentOn = !!r && isAgent(r);
    if (this.value()) {
      if (this.reply && r) return [[enter, agentOn ? "send to its agent" : !r.host && ["todo", "progress"].includes(r.stage) ? "start an agent with it" : "send"], put, line];
      if (this.talksToCoord) return [[enter, "send"], [tab, "send, and put an agent on it"], put, line];
      return [[enter, "add a task"], [tab, "add it and start an agent"], put, line];
    }
    if (this.job()) return [hint("stop", "stop it"), [enter, "take it back to change"], hint("jobUp")];
    if (!r) return [["", this.archiveView ? `${esc} back to the board` : "type what needs doing"], more];
    // esc leaves the whole task; who you talk to is space's to flip back.
    const tail = this.full ? [[arrows, "scroll"], hint("back")] : this.reply ? [hint("talk", "back to the Coordinator")] : [more];
    const failure = failureFor(r), rv = currentReview(r), reply = hint("talk"), open = hint("enter"), fix = hint("sendBack"), retry = hint("yes"), stop = hint("stop"), agent = hint("delegate");
    let main;
    if (r.archivedAt) main = [hint("menu", "restore or delete"), ...(this.archiveView && !this.full ? [[esc, "back to the board"]] : [])];
    else if (inReview(r)) main = [hint("yes", "approve and merge"), rv && G.sendable(rv) && hint("sendBack", "send back"), reply];
    else if (r.stage === "approval" && r.syncBlocked) main = [reply, open];
    else if (r.stage === "approval" && r.state === "blocked") main = [failure?.agentCanFix && !failure.sentAt && fix, hint("yes", "retry the merge"), reply];
    else if (r.stage === "nosummary") main = [hint("sendBack", "tell it to continue"), hint("yes", "use it as it is"), open];
    else if (failure?.agentCanFix) main = failure.sentAt && r.state === "working" ? [open, reply, stop] : [fix, r.stage === "failed" && retry, reply];
    else if (failure) main = [(r.stage === "failed" || r.kind === "auth") && retry, reply, open];
    else if (r.state === "error" && canSendError(r)) main = [fix, r.stage === "failed" && retry, reply];
    else if (agentOn && r.state === "blocked" && r.kind === "permission") main = [hint("yes", "say yes"), reply, open];
    else if (agentOn && r.state === "blocked") main = [hint("talk", r.kind === "question" ? "answer" : "reply"), open];
    else if (agentOn && r.state === "working") main = [open, reply, stop];
    else if (agentOn) main = [open, reply];
    else if (r.state === "working") main = [agent, stop];
    else main = [agent, reply];
    main = main.filter(Boolean);
    if (this.reply && !r.archivedAt) main = [["", agentOn && r.state === "blocked" && r.kind === "question" ? "type your answer" : "type your reply"], ...main.filter(([k]) => k !== name("talk"))];
    return [...main.slice(0, 4 - tail.length), ...tail];
  }
}
