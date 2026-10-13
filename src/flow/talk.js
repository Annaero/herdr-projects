// A task's conversation as the board shows it: its agent's, or its reviewer's while the task is under review. Only
// the words (agents/talk.js): what was sent to the program and what it said. The same reading for this machine's
// board and for the one another machine asks for (remote.js).
import * as S from "../store.js";
import { talkOf, canReadTalk } from "../agents.js";
import { promptTail } from "./send.js";

const REVIEW = ["reviewing", "reviewneeds"];
// Whose conversation shows: "reviewer" from the moment a review starts until it ends, else "agent".
export const talker = (t) => (REVIEW.includes(t?.stage) ? "reviewer" : "agent");
// What the board adds to every prompt it sends (the closing-note rule) is not part of what was said.
const bare = (tail, text) => (tail && text.endsWith(tail) ? text.slice(0, -tail.length).trim() : text);
// { who: "agent" | "reviewer", kind, readable, list }. `readable`: the program's saved conversation can be read at
// all. `list`: [{ who: "you" | "them", text, at }], oldest first; empty while nothing was said yet. Each text is cut
// to `most` characters (what goes to another machine is kept small).
export function taskTalk(t, { keep = 12, most = 20000 } = {}) {
  const who = talker(t);
  const kind = who === "reviewer" ? t.link?.reviewer?.kind || "" : t.agent || "";
  // A reviewer that is not up yet has said nothing, whatever program it will be.
  if (who === "reviewer" && !kind) return { who, kind, readable: true, list: [] };
  if (!canReadTalk(kind)) return { who, kind, readable: false, list: [] };
  let cwd = ""; try { cwd = S.cwdOf(t); } catch {}
  const src = who === "reviewer" ? { session: t.reviewSession, cwd } : { file: t.transcript || null, session: t.session, cwd };
  const said = talkOf(kind, { ...src, keep }) || [];
  let tail = ""; if (who === "agent" && said.some((m) => m.who === "you")) { try { tail = promptTail(t); } catch {} }
  const list = said.map((m) => { const text = m.who === "you" ? bare(tail, m.text) : m.text; return { who: m.who, at: m.at, text: text.length > most ? `${text.slice(0, most)}…` : text }; });
  return { who, kind, readable: true, list };
}
