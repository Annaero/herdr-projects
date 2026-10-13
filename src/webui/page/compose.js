// The box you type in, built as the herdr web UI builds its own chat input (its composer's card: Composer.tsx and
// Composer.css there), from the same CSS variables and none of its code: a card with the message as its first row,
// growing with the text, and one row of controls under it, who the words are for on the left and the round Send on
// the right. Its grip, its keys and its sizes are the web UI's (docs/web-chat-box.md says how that was measured).
// What it does with the words is chat.js's.
/* global window, localStorage, getComputedStyle */
import { h, icon } from "./dom.js";

// The web UI's own numbers: a key's step on the grip, how far a press must travel to be a drag, two taps that reset.
const STEP = 24, SLACK = { mouse: 3, touch: 10 }, TWICE = 350, MOST = 480, LONGEST = 20000;
const HEIGHT = "sw-box-height";
const savedHeight = () => { try { const n = Number(localStorage.getItem(HEIGHT)); return n > 0 ? n : null; } catch { return null; } };
const keepHeight = (n) => { try { if (n == null) localStorage.removeItem(HEIGHT); else localStorage.setItem(HEIGHT, String(n)); } catch {} };
// Enter sends and shift+enter is a new line, on a phone too, unless the web UI's own Settings → Chat says that
// enter is a new line (then ctrl or cmd with enter sends). Read from where the web UI keeps it; if it ever keeps it
// elsewhere, enter sends.
export const enterSends = () => { try { return JSON.parse(localStorage.getItem("herdr-web-ui:settings") || "{}").enterSends !== false; } catch { return true; } };
export const sendsOn = (e, enter = enterSends()) => e.key === "Enter" && !e.isComposing && e.keyCode !== 229 && !e.shiftKey && (enter ? !e.metaKey && !e.ctrlKey : !!(e.metaKey || e.ctrlKey));

// `onSend(delegate)`: send what the box holds (true: and put an agent on what it adds). `onInput()`: its words changed.
export function composeEl({ onSend, onInput }) {
  let manual = savedHeight(), tapped = 0;
  const box = h("textarea.sw-input", { rows: 1, maxLength: LONGEST, spellcheck: false, autocapitalize: "off", autocorrect: "off", "aria-label": "Message" });
  const grip = h("div.sw-grip", { tabIndex: 0, role: "separator", "aria-orientation": "horizontal", "aria-label": "Resize message box", title: "Drag to resize · double-click to reset" });
  const to = h("span.sw-to", { hidden: true });
  const also = h("button.sw-also", { type: "button", hidden: true }, "Send + start");
  const send = h("button.sw-action.sw-send", { type: "button", disabled: true, "aria-label": "Send message" }, icon("send"));
  const card = h("div.sw-card.sw-b-text", grip, box, h("div.sw-controls.sw-controls-left", to), h("div.sw-controls.sw-controls-right", also, send));
  // As tall as its words, up to ten lines (the styles' limit), then it scrolls; or the height set with the grip.
  const grow = () => {
    box.classList.toggle("is-sized", manual != null); grip.classList.toggle("is-sized", manual != null);
    if (manual != null) { box.style.height = `${manual}px`; return; }
    box.style.height = "auto"; box.style.height = `${box.scrollHeight}px`;
  };
  const floor = () => Math.round(parseFloat(getComputedStyle(box).minHeight)) || 44;
  const most = () => Math.max(floor(), Math.min(MOST, Math.round((window.visualViewport?.height || window.innerHeight) / 2)));
  // A grip height within the limits; at or under the automatic floor it is the automatic height again.
  const within = (n) => (n <= floor() ? null : Math.round(Math.min(most(), n)));
  const setHeight = (n, keep = true) => { manual = n; if (keep) keepHeight(n); grow(); };
  // Dragging the grip up grows the box. The pointer stays captured, so a finger may leave the grip.
  grip.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    e.preventDefault(); grip.setPointerCapture?.(e.pointerId);
    const slack = e.pointerType === "mouse" ? SLACK.mouse : SLACK.touch, from = box.getBoundingClientRect().height, y = e.clientY;
    let moved = false;
    const move = (m) => { if (!moved && Math.abs(m.clientY - y) < slack) return; moved = true; setHeight(within(from + y - m.clientY), false); };
    const end = (u) => {
      for (const [name, fn] of [["pointermove", move], ["pointerup", end], ["pointercancel", end]]) grip.removeEventListener(name, fn);
      if (moved) { tapped = 0; keepHeight(manual); } else if (u.type === "pointerup") { if (u.timeStamp - tapped < TWICE) { tapped = 0; setHeight(null); } else tapped = u.timeStamp; }
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", end); grip.addEventListener("pointercancel", end);
  });
  grip.addEventListener("keydown", (e) => {
    const now = manual ?? box.getBoundingClientRect().height, step = e.shiftKey ? STEP * 2 : STEP;
    if (e.key === "ArrowUp") setHeight(within(now + step)); else if (e.key === "ArrowDown") setHeight(within(now - step)); else if (e.key === "Home") setHeight(null); else return;
    e.preventDefault();
  });
  box.addEventListener("input", () => { onInput(); grow(); });
  box.addEventListener("keydown", (e) => { if (sendsOn(e)) { e.preventDefault(); onSend(false); } });
  // The board takes no files: one dropped on the box is not opened by the browser in the board's place.
  for (const name of ["dragover", "drop"]) card.addEventListener(name, (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
  send.addEventListener("click", () => onSend(false));
  also.addEventListener("click", () => onSend(true));
  window.addEventListener?.("resize", () => { if (manual != null && manual > most()) grow(); });
  return { el: h("div.sw-composer", { role: "group", "aria-label": "Message composer" }, card), card, box, to, send, also, grow };
}
