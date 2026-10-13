// The web board's chat box (src/webui/page/compose.js, compose.css): built as the herdr web UI builds its own chat
// input, from its CSS variables: the card and its parts, enter and shift+enter, the grip, both ways to send, no
// second send while one is on its way, who gets the words always said, and the version it was measured against.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// A stand-in for the browser's document: an element keeps its children and its listeners, so a test can press a key.
class El {
  constructor(tag) { this.tag = tag; this.nodeType = 1; this.kids = []; this.style = {}; this.dataset = {}; this.className = ""; this.hidden = false; this.value = ""; this.on = {}; this.attrs = {}; this.height = 44; this.disabled = false; this.rows = 0; this.maxLength = -1; this.title = ""; this.placeholder = "";
    this.classList = { toggle() {}, remove() {}, add() {} }; }
  append(...xs) { for (const x of xs) this.kids.push(x && x.nodeType ? x : String(x)); }
  replaceChildren(...xs) { this.kids = []; this.append(...xs); }
  addEventListener(name, fn) { (this.on[name] ||= []).push(fn); }
  removeEventListener() {} setAttribute(k, v) { this.attrs[k] = v; } focus() {}
  fire(name, e = {}) { const ev = { preventDefault() { ev.stopped = true; }, ...e }; for (const fn of this.on[name] || []) fn(ev); return ev; }
  getBoundingClientRect() { return { height: this.height }; }
  get textContent() { return this.kids.map((k) => (typeof k === "string" ? k : k.textContent)).join(""); }
  set textContent(v) { this.kids = [String(v)]; }
}
const NAMES = ["document", "window", "sessionStorage", "localStorage", "requestAnimationFrame", "getComputedStyle"];
async function page(run, { settings = null } = {}) {
  const had = Object.fromEntries(NAMES.map((n) => [n, globalThis[n]])), kept = settings ? { "herdr-web-ui:settings": JSON.stringify(settings) } : {};
  const store = { getItem: (k) => kept[k] ?? null, setItem: (k, v) => { kept[k] = String(v); }, removeItem: (k) => { delete kept[k]; } };
  Object.assign(globalThis, { document: { createElement: (tag) => new El(tag) }, window: { innerHeight: 800 }, sessionStorage: store, localStorage: store, requestAnimationFrame() {}, getComputedStyle: () => ({ minHeight: "44px" }) });
  try { await run(kept); } finally { Object.assign(globalThis, had); }
}
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the chat box's keys are the web UI's: enter sends, shift+enter is a new line, and its own Settings can turn that round", async () => {
  const { sendsOn } = await import("../src/webui/page/compose.js");
  const enter = { key: "Enter" };
  assert.equal(sendsOn(enter, true), true); assert.equal(sendsOn({ ...enter, shiftKey: true }, true), false); assert.equal(sendsOn({ key: "a" }, true), false);
  assert.equal(sendsOn({ ...enter, ctrlKey: true }, true), false); assert.equal(sendsOn({ ...enter, metaKey: true }, true), false);
  // a keyboard that composes letters keeps its enter (WebKit sends the committing one as key code 229)
  assert.equal(sendsOn({ ...enter, isComposing: true }, true), false); assert.equal(sendsOn({ ...enter, keyCode: 229 }, true), false);
  // "Enter sends" off in the web UI: ctrl or cmd with enter sends, a bare enter is a new line
  assert.equal(sendsOn(enter, false), false); assert.equal(sendsOn({ ...enter, ctrlKey: true }, false), true); assert.equal(sendsOn({ ...enter, metaKey: true }, false), true); assert.equal(sendsOn({ ...enter, ctrlKey: true, shiftKey: true }, false), false);
  await page(async () => { const { enterSends } = await import("../src/webui/page/compose.js"); assert.equal(enterSends(), false); }, { settings: { enterSends: false } });
  await page(async () => { const { enterSends } = await import("../src/webui/page/compose.js"); assert.equal(enterSends(), true); }); // nothing kept, or kept elsewhere: enter sends
});

test("the chat box is the web UI's card: the message first, one row of controls under it, the grip on its top edge, and no control the board cannot serve", async () => {
  await page(async (kept) => {
    const { composeEl } = await import("../src/webui/page/compose.js");
    const sent = []; let typed = 0;
    const c = composeEl({ onSend: (delegate) => sent.push(delegate), onInput: () => typed++ });
    const card = c.el.kids[0], classes = (el) => el.kids.map((k) => k.className);
    assert.equal(c.el.className, "sw-composer"); assert.deepEqual(classes(card), ["sw-grip", "sw-input", "sw-controls sw-controls-left", "sw-controls sw-controls-right"]);
    assert.deepEqual(classes(card.kids[2]), ["sw-to"]); assert.deepEqual(classes(card.kids[3]), ["sw-also", "sw-action sw-send"]);
    assert.equal(c.box.tag, "textarea"); assert.equal(c.box.rows, 1); assert.equal(c.box.maxLength, 20000); assert.equal(c.send.disabled, true); assert.equal(c.also.hidden, true);
    assert.doesNotMatch(read("src/webui/page/compose.js"), /type: "file"|Attach|Stop agent/, "no attach, no stop: the board has neither, and shows no dead control");
    // Enter sends; shift+enter is left to the field; the second button sends and starts.
    assert.equal(c.box.fire("keydown", { key: "Enter" }).stopped, true); assert.equal(c.box.fire("keydown", { key: "Enter", shiftKey: true }).stopped, undefined);
    c.also.fire("click"); c.send.fire("click"); assert.deepEqual(sent, [false, true, false]);
    c.box.fire("input"); assert.equal(typed, 1);
    // The grip, by keys: up grows the box a line, shift two, home gives the height back to the words; the height is kept.
    const grip = card.kids[0];
    grip.fire("keydown", { key: "ArrowUp" }); assert.equal(c.box.style.height, "68px"); assert.equal(kept["sw-box-height"], "68");
    grip.fire("keydown", { key: "ArrowUp", shiftKey: true }); assert.equal(c.box.style.height, "116px");
    for (let i = 0; i < 30; i++) grip.fire("keydown", { key: "ArrowUp" }); assert.equal(c.box.style.height, "400px", "never over half the window");
    grip.fire("keydown", { key: "Home" }); assert.equal(kept["sw-box-height"], undefined);
    // A drag: up grows it; a press that does not travel sets nothing; two taps give the height back.
    c.box.height = 44; grip.fire("pointerdown", { clientY: 500, pointerType: "mouse" }); grip.fire("pointermove", { clientY: 499 }); assert.equal(kept["sw-box-height"], undefined);
    grip.fire("pointermove", { clientY: 400 }); grip.fire("pointerup", { type: "pointerup", timeStamp: 10 }); assert.equal(kept["sw-box-height"], "144");
    // A file dropped on the box is not opened by the browser in the board's place.
    assert.equal(card.fire("drop", { dataTransfer: { types: ["Files"] } }).stopped, true); assert.equal(card.fire("drop", { dataTransfer: { types: ["text/plain"] } }).stopped, undefined);
  });
});

test("the chat box says who gets the words while it is empty too, and sends once: a second enter while the first is on its way does nothing", async () => {
  await page(async () => {
    const { chatEl } = await import("../src/webui/page/chat.js");
    const calls = []; let done;
    const chat = chatEl({ onSend: (...a) => { calls.push(a); return new Promise((ok) => { done = ok; }); }, onPress() {} });
    const card = chat.el.kids.at(-1).kids[0], box = card.kids[1], chip = card.kids[2].kids[0], [also, send] = card.kids[3].kids;
    const snap = (c, selected = "") => ({ chat: { mark: { t: "+" }, status: "idle", progress: "", text: "", note: "", ...c }, list: { selected }, panel: null, send: { enter: "send to the Coordinator", delegate: "send, and put an agent on what it adds", place: "ask the Coordinator" }, role: "drive" });
    chat.update(snap({ name: "Coordinator" }));
    assert.equal(chip.hidden, false); assert.equal(chip.textContent, "To: Coordinator"); assert.equal(chip.className, "sw-to"); assert.equal(send.disabled, true); assert.equal(also.hidden, true); assert.equal(box.placeholder, "Ask the Coordinator");
    chat.update(snap({ name: "Coordinator on vm-a" })); assert.equal(chip.textContent, "To: Coordinator on vm-a"); // the machine, where another one's shows
    chat.update(snap({ name: "Coordinator" }));
    box.value = "Add a dark mode"; box.fire("input");
    assert.equal(chip.className, "sw-to is-locked"); assert.equal(send.disabled, false); assert.equal(send.title, "Send to the Coordinator"); assert.equal(also.hidden, false); assert.equal(also.title, "Send, and put an agent on what it adds");
    box.fire("keydown", { key: "Enter" });
    assert.equal(send.disabled, true); assert.equal(also.disabled, true); assert.equal(box.value, "Add a dark mode", "the words stay until the board has them");
    box.fire("keydown", { key: "Enter" }); send.fire("click"); also.fire("click"); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["Add a dark mode", false, { id: "", reply: false, scope: "" }]);
    done(false); await new Promise((ok) => setImmediate(ok));
    assert.equal(box.value, ""); assert.equal(chip.textContent, "To: Coordinator"); assert.equal(chip.className, "sw-to");
    // Kept by the board (it could not be sent): the words stay, and can be sent again, the other way too.
    box.value = "Again"; box.fire("input"); also.fire("click"); assert.equal(calls[1][1], true); done(true); await new Promise((ok) => setImmediate(ok));
    assert.equal(box.value, "Again"); assert.equal(send.disabled, false);
    // A device that can only watch types nothing.
    chat.update({ ...snap({ name: "Coordinator" }), role: "watch" }); assert.equal(box.disabled, true); assert.equal(box.placeholder, "This device can only watch");
  });
});

test("the chat box's styles are written from the web UI's variables, hide every look of the browser's own, and name the version they were measured against", () => {
  const css = read("src/webui/page/compose.css"), doc = read("docs/web-chat-box.md"), rule = (sel) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] || "";
  for (const v of ["--bg-elevated", "--radius-2xl", "--shadow-card", "--hairline", "--chat-w"]) assert.ok(rule(".sw-card").includes(`var(${v}`), `the card uses ${v}`);
  for (const v of ["--space-4", "--space-5", "--fs-input", "--fs-chat", "--chat-scale", "--lh-base", "--text-strong", "--font-ui"]) assert.ok(rule(".sw-input").includes(`var(${v}`), `the field uses ${v}`);
  const field = rule(".sw-input");
  for (const part of ["resize: none", "appearance: none", "-webkit-appearance: none", "border: 0", "outline: 0", "box-shadow: none", "background: transparent", "scrollbar-width: thin", "max-height: 10lh"]) assert.ok(field.includes(part), `the field has ${part}`);
  assert.match(css, /\.sw-input::-webkit-scrollbar-button[^{]*\{ display: none;/, "no scroll arrows"); assert.match(css, /\.sw-input:focus, \.sw-input:focus-visible \{ outline: 0;/);
  assert.match(rule(".sw-send"), /var\(--primary,/); assert.match(rule(".sw-action"), /var\(--space-8,/); assert.match(css, /@media \(pointer: coarse\) \{[^@]*\.sw-action \{ width: var\(--touch-target/);
  // Nothing of the web UI's own built files is loaded or named: only its variables.
  assert.doesNotMatch(css + read("src/webui/page/compose.js"), /\.composer-|\/assets\//);
  // The version is said in one way in both places, and the page says how to measure again.
  const version = /Measured against herdr-web-ui ([\d.]+)/.exec(css)?.[1];
  assert.ok(version, "the styles say which version they were measured against"); assert.ok(doc.includes(`herdr-web-ui ${version}`), "docs/web-chat-box.md names the same version"); assert.match(doc, /node scripts\/chat-box-match\.js/); assert.match(doc, /--sending/);
  // The measuring script has every state the page says it compares, the moment of sending among them.
  const script = read("scripts/chat-box-match.js"); for (const state of ["empty", '"one line"', '"many lines"', "focused", '"focused, empty"', "sending"]) assert.ok(script.includes(`${state}: {`), `the script measures ${state}`);
  assert.ok(read("src/webui/page/start.js").includes('["board", "compose"]'), "the page loads the box's styles");
});
