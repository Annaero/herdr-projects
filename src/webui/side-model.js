// What stands beside the list on the web board: who the chat talks to and their latest message, the question the
// board asks, its message to you, the buttons for the selected task and the entries of its More menu. Every one is
// read from the board itself: the buttons are its hint line (view/hints.js), the menu its ? menu (view/menu.js), each
// with the key it presses, so the page offers what the terminal board offers, in the same words, at the same moment.
import * as K from "../board/keys.js";
import { isAgent } from "../board/view/states.js";
import { pieces, plain } from "./ink.js";
import { TERMINAL_ONLY } from "./web-view.js";

// A hint names its key; which key that is. (The two that answer a question are never on the hint line.)
const byName = () => new Map(K.KEYS.filter((k) => !["sayYes", "sayNo"].includes(k.id)).map((k) => [K.name(k.id), k.id]));
// The hint line as buttons: [{ id, label }]. A hint that names no single key of the board (the arrows) is left out.
export function buttonsOf(v, r, { typing = false } = {}) {
  const names = byName();
  let hints = [];
  if (typing) v.setValue("x");
  try { hints = v.hints(r) || []; } catch {} finally { if (typing) v.setValue(""); }
  return hints.map(([key, words]) => ({ id: names.get(key), label: String(words || "") })).filter((b) => b.id && b.label);
}
// (The chat's progress is sent as its numbers alone, the last of its forms: the page has a bar of its own.)
export function sideOf(v) {
  const r = v.current() || null;
  let who = null;
  try { who = v.chatOf(r); } catch {}
  const typing = buttonsOf(v, r, { typing: true });
  const place = (() => { try { return plain(v.boxLines(300, 3, r)[1] || "").replace(/^\s*❯\s?/, "").trim(); } catch { return ""; } })();
  return {
    chat: who ? { mark: pieces(who.mark)[0] || { t: "·" }, tag: who.tag || "", name: who.name, status: plain(who.status || ""), progress: plain((who.progress || []).at(-1) || ""), text: String(who.text || ""), parts: (who.parts || []).map((x) => ({ by: String(x.by || ""), text: String(x.text || ""), mine: !!x.mine, tone: x.tone || "", raw: !!x.raw })), raw: !!who.raw, mine: !!who.mine, tone: who.tone || "", note: who.note || "", toAgent: !!(v.reply && r), box: v.boxColor(r) } : null,
    ask: v.ask ? { q: String(v.ask.q || ""), detail: String(v.ask.detail || ""), danger: !!v.ask.danger, keys: (v.ask.keys || [["sayYes", "yes"], ["sayNo", "no"]]).map(([id, label]) => ({ id, label })) } : null,
    msg: v.msg ? { text: v.msg, kind: v.msgKind || "overlay0", n: v.msgN || 0 } : null,
    // With nothing typed: what can be done to the selected task now. `back` is the page's own Back while a task is open.
    actions: buttonsOf(v, r).filter((b) => !TERMINAL_ONLY.includes(b.id) && !(b.id === "back" && (v.full || v.autoOpen))),
    // With something typed: what enter and tab do with it.
    send: { enter: typing.find((b) => b.id === "enter")?.label || "", delegate: typing.find((b) => b.id === "delegate")?.label || "", place },
    // More: only what applies now and is not a button already, in the buttons' own words. A key with no button on
    // the page (the settings page, the terminal's size) has no entry; yes and send back are buttons when they apply.
    menu: (() => { try { return v.menuItems().filter((i) => !TERMINAL_ONLY.includes(i.id) && !!K.KEY[i.id]?.web && !["yes", "sendBack"].includes(i.id) && (i.id !== "undo" || !!v.draftAway || !!v.archiveUndo) && (!["stop", "archive", "pin"].includes(i.id) || !!r)).map((i) => ({ id: i.id, group: i.group, label: String(i.label || "") })); } catch { return []; } })(),
    flags: { automations: !!v.automationsView, archive: !!v.archiveView, byRepo: !!v.byRepo, allDone: !!v.allDone, scope: v.scope || "", reply: !!v.reply, open: !!(v.automationsView ? v.autoOpen : v.full), filter: v.filter || "" },
    // The selected task has an agent whose pane the web UI can show: on this machine, or on another of its PCs.
    canOpen: !!r && r.title !== undefined && !r.archivedAt && (r.host ? !!r.link?.pane : isAgent(r)),
    go: v.go || null,
  };
}
