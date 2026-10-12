// The hint line at the bottom of the board.
import * as G from "../../gate.js";
import { isAgent, failureFor, canSendError, inReview } from "./states.js";
import { currentReview } from "./review-words.js";

export class Hints {
  // The hint line: what matters right now, the main thing first, at most four.
  hints(r) {
    const more = ["?", "more"];
    if (this.ask) return [];
    if (this.closing) return [["", "Press ctrl+c again to close the board"]];
    if (this.menu) return [["↑↓", "pick"], ["enter", "do it"], ["esc", "close"]];
    if (this.mode === "find") return [["enter", "keep the filter"], ["esc", "cancel"]];
    const agentOn = !!r && isAgent(r);
    if (this.value()) {
      if (this.reply && r) return [["enter", agentOn ? "send to its agent" : !r.host && ["todo", "progress"].includes(r.stage) ? "start an agent with it" : "send"], ["esc", "put away"], ["shift+enter", "new line"]];
      if (this.talksToCoord) return [["enter", "send"], ["tab", "send, and put an agent on it"], ["esc", "put away"], ["shift+enter", "new line"]];
      return [["enter", "add a task"], ["tab", "add it and start an agent"], ["esc", "put away"], ["shift+enter", "new line"]];
    }
    if (this.job()) return [["ctrl+x", "stop it"], ["enter", "take it back to change"], ["ctrl+↑", "back to the list"]];
    // While the chat's message is up, esc hides it (the chat says so beside the name): "back" is the press after.
    const up = this.previewOpen(r);
    if (!r) return [["", this.archiveView && !up ? "esc back to the board" : "type what needs doing"], ...(this.chatKeyHint ? [this.chatKeyHint] : []), more];
    const tail = this.full ? [["↑↓", "scroll"], ...(up ? [] : [["esc", "back"]])] : this.reply ? [up ? more : ["esc", "back"]] : [more];
    const failure = failureFor(r), rv = currentReview(r), reply = ["space", "reply"], open = ["enter", "open the agent"];
    let main;
    if (r.archivedAt) main = [["?", "restore or delete"], ...(this.archiveView && !this.full && !up ? [["esc", "back to the board"]] : [])];
    else if (inReview(r)) main = [["ctrl+a", "approve and merge"], rv && G.sendable(rv) && ["ctrl+r", "send back"], reply];
    else if (r.stage === "approval" && r.syncBlocked) main = [reply, open];
    else if (r.stage === "approval" && r.state === "blocked") main = [failure?.agentCanFix && !failure.sentAt && ["ctrl+r", "send it to the agent to fix"], ["ctrl+a", "retry the merge"], reply];
    else if (r.stage === "nosummary") main = [["ctrl+r", "tell it to continue"], ["ctrl+a", "use it as it is"], open];
    else if (failure?.agentCanFix) main = failure.sentAt && r.state === "working" ? [open, reply, ["ctrl+x", "stop"]] : [["ctrl+r", "send it to the agent to fix"], r.stage === "failed" && ["ctrl+a", "retry"], reply];
    else if (failure) main = [(r.stage === "failed" || r.kind === "auth") && ["ctrl+a", "retry"], reply, open];
    else if (r.state === "error" && canSendError(r)) main = [["ctrl+r", "send it to the agent to fix"], r.stage === "failed" && ["ctrl+a", "retry"], reply];
    else if (agentOn && r.state === "blocked" && r.kind === "permission") main = [["ctrl+a", "say yes"], reply, open];
    else if (agentOn && r.state === "blocked") main = [["space", r.kind === "question" ? "answer" : "reply"], open];
    else if (agentOn && r.state === "working") main = [open, reply, ["ctrl+x", "stop"]];
    else if (agentOn) main = [open, reply];
    else if (r.state === "working") main = [["tab", "put an agent on it"], ["ctrl+x", "stop"]];
    else main = [["tab", "put an agent on it"], reply];
    main = main.filter(Boolean);
    if (this.reply && !r.archivedAt) main = [["", agentOn && r.state === "blocked" && r.kind === "question" ? "type your answer" : "type your reply"], ...main.filter(([k]) => k !== "space")];
    const key = this.chatKeyHint ? [this.chatKeyHint] : [];
    // In a narrow window the hint line carries the chat's key: where it is esc, it stands last, as "esc back" does.
    return [...main.slice(0, 4 - tail.length - key.length), ...(up && key.length && this.full ? [...tail, ...key] : [...key, ...tail])];
  }
}
