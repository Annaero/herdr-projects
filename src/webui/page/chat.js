// The chat at the foot of the board: who it talks to (the Coordinator, or the selected task's agent), the newest
// thing said in that conversation under a line that names who said it (the agent, the reviewer while the task is
// under review, you), all of the conversation's words behind "Show all of it", and the box you type in. Who that is, what the box says while empty and what its buttons do with your
// words come from the board (webui/side-model.js). What you type stays in this tab until it is sent.
/* global sessionStorage, window, requestAnimationFrame */
import { h, markEl } from "./dom.js";

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const DRAFT = "sw-draft";
// What is kept is the draft with who it is for: words that came back after a reload without their recipient would be
// sent to whoever the page shows then.
const TO = "sw-draft-to";
const saved = () => { try { return sessionStorage.getItem(DRAFT) || ""; } catch { return ""; } };
const savedTo = () => { try { const x = JSON.parse(sessionStorage.getItem(TO) || "null"); return x && typeof x === "object" && typeof x.label === "string" ? { id: String(x.id || ""), reply: !!x.reply && !!x.id, scope: String(x.scope || ""), label: x.label, enter: String(x.enter || ""), delegate: String(x.delegate || "") } : null; } catch { return null; } };
const keep = (text, to = null) => { try { sessionStorage.setItem(DRAFT, text); if (text.trim() && to) sessionStorage.setItem(TO, JSON.stringify(to)); else sessionStorage.removeItem(TO); } catch {} };

// Built once, so the text box keeps its words and its cursor while the rest is drawn again.
export function chatEl({ onSend, onPress }) {
  // `to`: who the words in the box are for, taken when the first of them is typed and kept until they are sent or
  // cleared: { id, reply, label, enter, delegate }. Tapping another task meanwhile changes what you look at, not this.
  let open = false, last = "", to = null, now = null, tone = "text";
  const box = h("textarea.sw-input", { rows: 1, "aria-label": "Message", enterKeyHint: "send", autocapitalize: "sentences" });
  box.value = saved();
  if (box.value.trim()) to = savedTo(); // a reload brings the words back with who they were for
  const grow = () => { box.style.height = "auto"; box.style.height = `${Math.min(box.scrollHeight, Math.round(window.innerHeight * 0.3))}px`; };
  const send = h("button.btn.btn-primary.sw-send", { type: "button" }, "Send");
  const also = h("button.btn.sw-send-also", { type: "button", hidden: true }, "Send + start");
  const chip = h("div.sw-to", { hidden: true });
  const who = h("button.sw-who", { type: "button", title: "Change who you talk to" });
  const said = h("div.sw-said", { hidden: true });
  const more = h("button.btn.btn-ghost.sw-said-more", { type: "button", hidden: true, onclick: () => { open = !open; fit(); } });
  const note = h("p.sw-chat-note", { hidden: true });
  let parts = [];
  // One thing said: who said it, in words, then the words. Closed, the box holds the newest; open, all of them.
  const partEl = (p) => h(`div.sw-turn${p.mine ? ".is-mine" : ""}${p.raw ? ".is-raw" : ""}${p.tone ? `.sw-c-${p.tone}` : ""}`, p.by ? h("div.sw-by", `${p.by}:`) : null, h("div.sw-turn-text", p.text));
  const fit = () => {
    said.classList.toggle("is-open", open); if (open) said.classList.remove("has-more"); more.textContent = open ? "Show less" : "Show all of it";
    said.replaceChildren(...(open ? parts : parts.slice(-1)).map(partEl));
    if (open) said.scrollTop = said.scrollHeight;
  };
  const go = async (delegate) => {
    const text = box.value;
    if (!text.trim()) return;
    send.disabled = also.disabled = true;
    const kept = await onSend(text, delegate, to ? { id: to.id, reply: to.reply, scope: to.scope || "" } : null);
    send.disabled = also.disabled = false;
    if (!kept) { box.value = ""; to = null; keep(""); grow(); }
    sync();
  };
  send.addEventListener("click", () => go(false));
  also.addEventListener("click", () => go(true));
  who.addEventListener("click", () => onPress("talk"));
  box.addEventListener("input", () => { sync(); keep(box.value, to); grow(); });
  // Enter sends where there is a keyboard with a shift key to make a new line; on a phone enter is a new line.
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); go(false); } });
  let labels = { enter: "", delegate: "" };
  // The first word typed locks who the draft is for, as the box then says; an empty box lets it go again.
  const sync = () => {
    const typing = !!box.value.trim();
    if (!typing) to = null; else if (!to && now) to = { ...now };
    const l = to || labels;
    // Where the page now shows somebody else (another task, another machine's Coordinator), the chip says that the
    // words are not for them: the line above the box names who is shown, the chip who gets the words.
    const moved = !!to && !!now && (to.id !== now.id || to.reply !== now.reply || (to.scope || "") !== (now.scope || ""));
    // The frame's colour says who the box sends to: with a draft locked to somebody the page no longer shows (or
    // before the page knows who it shows, right after a reload), it is the plain one, never the open task's colour.
    box.className = `sw-input sw-b-${to && (moved || !now) ? "text" : tone}`;
    chip.hidden = !to; chip.textContent = to ? `To: ${to.label}${moved ? " · not who is shown above" : ""}` : "";
    send.disabled = !typing; send.title = cap(l.enter); also.hidden = !typing || !l.delegate; also.title = cap(l.delegate);
  };
  const el = h("footer.sw-chat", who, note, said, more, chip, h("div.sw-compose", box, h("div.sw-send-row", also, send)));
  return {
    el,
    fill(text) { box.value = text; to = null; sync(); keep(text, to); grow(); box.focus(); },
    update(snap) {
      const c = snap.chat;
      el.hidden = !c;
      if (!c) return;
      // Only what there is: replaceChildren would write a missing part out as the word "null".
      who.replaceChildren(...[markEl(c.mark.t, c.mark.c), c.tag ? h("span.sw-id", c.tag) : null, h("span.sw-who-name", c.name), h("span.sw-who-status", [c.status, c.progress].filter(Boolean).join("  ")),
        snap.list.selected && snap.panel?.task !== false ? h("span.sw-who-flip", c.toAgent ? "Talk to the Coordinator" : "Talk to this task's agent") : null].filter(Boolean));
      who.disabled = !snap.list.selected;
      note.hidden = !c.note; note.textContent = c.note;
      const fresh = c.text !== last;
      if (fresh) { last = c.text; open = false; parts = c.parts && c.parts.length ? c.parts : c.text ? [{ by: "", text: c.text, mine: c.mine, raw: c.raw, tone: c.tone }] : []; }
      said.hidden = !c.text;
      said.className = `sw-said${open ? " is-open" : ""}`;
      if (fresh) { fit(); said.scrollTop = 0; }
      // Only where the message is longer than its few lines is there more to show (measured once it is laid out).
      const measure = () => { const over = !!c.text && (open || parts.length > 1 || said.scrollHeight > said.clientHeight + 2); more.hidden = !over; said.classList.toggle("has-more", over && !open); };
      measure(); requestAnimationFrame(measure);
      // The box's frame says who gets your words, as on the terminal board: the plain text colour for the Coordinator,
      // the task's status colour for its agent.
      tone = c.box || "text"; // (drawn by `sync`, below, once who is shown now is known)
      box.placeholder = cap(snap.send.place || "");
      labels = snap.send;
      // Who a draft started now would be for: the task whose agent the chat names, or the Coordinator.
      // (Which machine's Coordinator, too: the view it was typed in is part of who it is for.)
      now = { id: c.toAgent ? snap.list.selected : "", reply: !!c.toAgent, scope: snap.flags?.scope || "", label: c.toAgent ? c.tag || c.name : c.name, enter: snap.send.enter, delegate: snap.send.delegate };
      box.disabled = snap.role !== "drive";
      if (snap.role !== "drive") box.placeholder = "This device can only watch";
      grow(); sync();
      if (to) keep(box.value, to); // locked just now (words that were there before the board answered): kept with them
    },
  };
}
