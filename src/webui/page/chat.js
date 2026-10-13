// The chat at the foot of the board: who it talks to (the Coordinator, or the selected task's agent), their latest
// message, and the box you type in. Who that is, what the box says while empty and what its buttons do with your
// words come from the board (webui/side-model.js). What you type stays in this tab until it is sent.
/* global sessionStorage, window, requestAnimationFrame */
import { h, ink } from "./dom.js";

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const DRAFT = "sw-draft";
const saved = () => { try { return sessionStorage.getItem(DRAFT) || ""; } catch { return ""; } };
const keep = (text) => { try { sessionStorage.setItem(DRAFT, text); } catch {} };

// Built once, so the text box keeps its words and its cursor while the rest is drawn again.
export function chatEl({ onSend, onPress }) {
  let open = false, last = "";
  const box = h("textarea.sw-input", { rows: 1, "aria-label": "Message", enterKeyHint: "send", autocapitalize: "sentences" });
  box.value = saved();
  const grow = () => { box.style.height = "auto"; box.style.height = `${Math.min(box.scrollHeight, Math.round(window.innerHeight * 0.3))}px`; };
  const send = h("button.btn.btn-primary.sw-send", { type: "button" }, "Send");
  const also = h("button.btn.sw-send-also", { type: "button", hidden: true });
  const who = h("button.sw-who", { type: "button", title: "Change who you talk to" });
  const said = h("div.sw-said", { hidden: true });
  const more = h("button.btn.btn-ghost.sw-said-more", { type: "button", hidden: true, onclick: () => { open = !open; fit(); } });
  const note = h("p.sw-chat-note", { hidden: true });
  const fit = () => { said.classList.toggle("is-open", open); if (open) said.classList.remove("has-more"); more.textContent = open ? "Show less" : "Show all of it"; };
  const go = async (delegate) => {
    const text = box.value;
    if (!text.trim()) return;
    send.disabled = also.disabled = true;
    const kept = await onSend(text, delegate);
    send.disabled = also.disabled = false;
    if (!kept) { box.value = ""; keep(""); grow(); }
  };
  send.addEventListener("click", () => go(false));
  also.addEventListener("click", () => go(true));
  who.addEventListener("click", () => onPress("talk"));
  box.addEventListener("input", () => { keep(box.value); grow(); sync(); });
  // Enter sends where there is a keyboard with a shift key to make a new line; on a phone enter is a new line.
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); go(false); } });
  let labels = { enter: "", delegate: "" };
  const sync = () => { const typing = !!box.value.trim(); send.disabled = !typing; send.title = cap(labels.enter); also.hidden = !typing || !labels.delegate; also.textContent = cap(labels.delegate); };
  const el = h("footer.sw-chat", who, note, said, more, h("div.sw-compose", box, h("div.sw-send-row", also, send)));
  return {
    el,
    fill(text) { box.value = text; keep(text); grow(); sync(); box.focus(); },
    update(snap) {
      const c = snap.chat;
      el.hidden = !c;
      if (!c) return;
      who.replaceChildren(...[h(`span.sw-mark${c.mark.c ? `.sw-c-${c.mark.c}` : ""}`, { "aria-hidden": "true" }, c.mark.t), h("span.sw-who-name", c.name), h("span.sw-who-status", [c.status, c.progress].filter(Boolean).join("  ")),
        snap.list.selected && snap.panel?.task !== false ? h("span.sw-who-flip", c.toAgent ? "Talk to the Coordinator" : "Talk to this task's agent") : null].filter(Boolean)); // with nothing selected there is no such button: a bare null would be written out as the word
      who.disabled = !snap.list.selected;
      note.hidden = !c.note; note.textContent = c.note;
      if (c.text !== last) { last = c.text; open = false; said.replaceChildren(ink([{ t: c.text }])); said.scrollTop = 0; }
      said.hidden = !c.text;
      said.className = `sw-said${open ? " is-open" : ""}${c.mine ? " is-mine" : ""}${c.raw ? " is-raw" : ""}${c.tone ? ` sw-c-${c.tone}` : ""}`;
      fit();
      // Only where the message is longer than its few lines is there more to show (measured once it is laid out).
      const measure = () => { const over = !!c.text && (open || said.scrollHeight > said.clientHeight + 2); more.hidden = !over; said.classList.toggle("has-more", over && !open); };
      measure(); requestAnimationFrame(measure);
      box.placeholder = cap(snap.send.place || "");
      labels = snap.send;
      box.disabled = snap.role !== "drive";
      if (snap.role !== "drive") box.placeholder = "This device can only watch";
      grow(); sync();
    },
  };
}
