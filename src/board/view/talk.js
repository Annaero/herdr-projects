// What a chat shows of a conversation: only its words. What a task's agent said, or its reviewer while the task is
// under review, and what was sent to it, each under a line that names whose words they are. Never the program's
// screen: no tool call, no spinner, no input box, no start screen. A program whose conversation cannot be read is
// the one exception, and then only the words on its screen show (agents/screen-text.js).
import * as F from "../../flow.js";
import * as S from "../../store.js";
import { screenText } from "../../agents.js";
import { brief } from "./words.js";
import { name as keyName } from "../keys.js";
import { COORDINATOR_TAB } from "../../coordinator/place.js";

const NAME = { agent: "Agent", reviewer: "Reviewer" };
// What was sent is a brief or a prompt, often long: its beginning stands for it.
const sent = (text) => brief(text, 600);
// Your own words stand once: where the conversation already ends with them, that part is yours.
export function withMine(parts, mine) {
  if (!mine) return parts;
  const said = parts.filter((p) => !p.note), last = said.at(-1), words = String(mine).trim();
  const same = last?.sent && (last.whole || last.text).includes(words.slice(0, 200));
  return [...(same ? said.slice(0, -1) : said), { by: "You", text: words, mine: true, sent: true }];
}
const talks = new WeakMap();
export class Talk {
  // A task's conversation: { who: "agent" | "reviewer", name, parts, dialog, raw }. `parts`, oldest first:
  // { by, text } and, for what was sent to it, `sent`. The last part may be a note of the board's own (`note`): that
  // nothing was said yet, or that a dialog on its screen waits for you and how to get to it.
  talk(r) {
    // Asked several times for one drawing of the board (the chat, its hints, the panel): read once for a row as loaded.
    const had = talks.get(r);
    if (had) return had;
    const k = this.talkNow(r);
    talks.set(r, k);
    return k;
  }
  talkNow(r) {
    let tk = null;
    if (r.host) tk = r.snap?.talk || null;
    else if (F.isAgentTask(r)) { try { tk = F.taskTalk(r); } catch {} }
    const who = tk?.who || F.talker(r), name = NAME[who];
    const parts = [];
    if (tk && !tk.readable) { const text = screenText(this.screen(r) || r.screen || ""); if (text) parts.push({ by: `${name}, on its screen now`, text, raw: true }); }
    else {
      const list = [...(tk?.list || [])];
      // No conversation to read (its file is gone, or its machine sends none): what the task itself kept.
      if (who === "agent" && r.said && !list.some((m) => m.who === "them")) list.push({ who: "them", text: String(r.said) });
      for (const m of list) parts.push(m.who === "them" ? { by: name, text: m.text } : { by: `To the ${who}`, text: sent(m.text), whole: m.text, sent: true });
    }
    const raw = parts.some((p) => p.raw);
    const dialog = who === "reviewer" ? r.stage === "reviewneeds" : r.stage === "working" && (r.host ? r.state === "blocked" : r.live?.status === "blocked");
    if (dialog) parts.push({ by: "", note: "dialog", tone: "yellow", text: who === "reviewer"
      ? `The reviewer shows a dialog on its screen that waits for your answer. ${keyName("enter")} opens the task's space: the reviewer is in its tab "${F.reviewerTab(S.reviewNumber(r))}".`
      : `The agent shows a dialog on its screen that waits for your answer: ${keyName("enter")} opens it.` });
    else if (!tk && r.host && who === "reviewer") parts.push({ by: "", note: "old", text: `The reviewer is at work. ${r.host} runs an older herdr-superwork, which does not send what its reviewer says: update it there.` });
    else if (!parts.some((p) => !p.sent)) parts.push({ by: "", note: "empty", text: who === "reviewer" || r.state === "working" ? `The ${who} has just started: nothing to show yet.` : `The ${who} has said nothing yet.` });
    return { who, name, parts, dialog, raw };
  }
  // The newest thing a task's agent (or its reviewer) said, for the task panel: { who, name, text, raw, note }.
  previewOf(r) {
    const k = this.talk(r), last = k.parts.filter((p) => !p.sent).at(-1);
    return { who: k.who, name: k.name, text: last?.text || "", raw: !!last?.raw, note: last?.note || "" };
  }
  // The Coordinator's conversation, in the same parts. `v`: what the board knows of it (coordinator/look.js).
  coordTalk(v, C) {
    const parts = (v.talk || []).map((m) => (m.who === "them" ? { by: "Coordinator", text: m.text } : { by: "You", text: sent(m.text), whole: m.text, sent: true }));
    if (!parts.some((p) => !p.sent) && v.said) parts.push({ by: "Coordinator", text: v.said });
    // A program whose conversation cannot be read: the words on its screen.
    if (!v.readable && v.status) { const text = screenText(C.screen(v)); return { parts: text ? [{ by: "Coordinator, on its screen now", text, raw: true }] : [], raw: !!text }; }
    if (v.state === "blocked") return { parts: [...parts, { by: "", note: "dialog", tone: "yellow", text: `The Coordinator shows a dialog on its screen that waits for your answer: it is in herdr's tab "${COORDINATOR_TAB}".` }], dialog: true };
    return { parts: withMine(parts, v.sent), mine: !!v.sent };
  }
}
