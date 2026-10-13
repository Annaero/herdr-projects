#!/usr/bin/env node
// Measures the web board's chat box against the herdr web UI's own chat input, in a real browser: both are opened
// side by side at a phone's and a desktop's size, in dark and light, empty, with one line, with many lines and
// focused; their sizes, places and styles are read and the pixels of the message field and of the round Send are
// compared. It ends with 1 when the two differ in anything but what is the board's own (docs/web-chat-box.md).
// With --sending it also compares the two while a message is on its way. That sends for real: one line to the agent
// of --web-ui and one to the board, four times (so point it at a scratch herdr and a scratch board). Each message is
// held back for a moment on its way out, so that both boxes can be read while they wait for the answer.
// Not part of `npm run check`: it needs a running web UI, the board's front door in front of it and a browser.
//   node scripts/chat-box-match.js --web-ui <its address, on an agent's chat> --board <the front door's address>
//        --playwright <a folder with node_modules/playwright-core, the web UI's checkout has one>
//        [--out <folder for the pictures>] [--browser chromium|firefox|webkit] [--exe <the browser's program>]
//        [--sending]
/* global document, getComputedStyle, innerWidth, innerHeight, localStorage, Image */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const arg = (name, or = "") => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] || or : or; };
const ORIG = arg("web-ui"), BOARD = arg("board"), PW = arg("playwright"), OUT = arg("out", path.join(os.tmpdir(), "chat-box-match")), BROWSER = arg("browser", "chromium");
if (!ORIG || !BOARD || !PW) { console.error("usage: node scripts/chat-box-match.js --web-ui <url> --board <url> --playwright <folder> [--out <folder>] [--browser chromium|firefox|webkit] [--exe <program>]"); process.exit(2); }
const browsers = createRequire(path.join(path.resolve(PW), "x.js"))("playwright-core");

const SIZES = { desktop: { viewport: { width: 1280, height: 800 } }, phone: { viewport: { width: 390, height: 800 }, hasTouch: true, ...(BROWSER === "firefox" ? {} : { isMobile: true }) } };
const LONG = Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of a long draft that keeps going`).join("\n");
const STATES = { empty: { text: "" }, "one line": { text: "Add a dark mode to the settings page" }, "many lines": { text: LONG }, focused: { text: "Add a dark mode to the settings page", focus: true }, "focused, empty": { text: "", focus: true },
  ...(process.argv.includes("--sending") ? { sending: { text: "Add a dark mode to the settings page", focus: true, send: true } } : {}) };
// How long a message is held back on its way out, and whether one is being held now.
const HOLD = 4000, held = { on: false };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
// Each one's parts: the web UI's own class names on the left, the board's on the right.
const PARTS = { orig: { card: ".composer-surface", text: ".composer-text", send: ".composer-action", right: ".composer-controls-right" }, board: { card: ".sw-card", text: ".sw-input", send: ".sw-send", right: ".sw-controls-right" } };
// What may differ, because it is the board's own: the frame's colour (and so the ring drawn on focus), the second
// way to send beside the round button, and a stricter reset of the field's look.
const OWN = ["controls right", "card box-shadow", "field appearance"];

function measure(s) {
  const q = (x) => document.querySelector(x), card = q(s.card), text = q(s.text), send = q(s.send), c = card.getBoundingClientRect();
  const round = (n) => Math.round(n * 100) / 100;
  const box = (e) => { const b = e.getBoundingClientRect(); return [b.x - c.x, b.y - c.y, b.width, b.height].map(round).join(" "); };
  const style = (name, e, props, pseudo) => { const st = getComputedStyle(e, pseudo); return Object.fromEntries(props.map((k) => [`${name} ${k}`, st.getPropertyValue(k)])); };
  const glyph = send.querySelector("svg").getBoundingClientRect();
  return {
    values: {
      "card size": `${round(c.width)} ${round(c.height)}`, "card left and right gap": `${round(c.x)} ${round(innerWidth - c.right)}`, "card to the bottom": String(round(innerHeight - c.bottom)),
      "field box": box(text), "send box": box(send), "controls right": box(q(s.right)),
      ...style("card", card, ["background-color", "border-top-width", "border-radius", "box-shadow"]),
      ...style("field", text, ["font-family", "font-size", "font-weight", "line-height", "padding", "color", "min-height", "max-height", "background-color", "border-top-width", "outline-style", "resize", "appearance", "overflow-y", "scrollbar-width"]),
      "field placeholder colour": getComputedStyle(text, "::placeholder").color, "field scrolls": String(text.scrollHeight > text.clientHeight),
      ...style("send", send, ["width", "height", "opacity", "color", "border-radius"]), ...style("send circle", send, ["width", "height", "background-color"], "::before"),
      "send glyph": `${glyph.width} ${glyph.height}`, "send disabled": String(send.disabled),
    },
    clip: { x: Math.max(0, c.x - 16), y: Math.max(0, c.y - 24), width: Math.min(innerWidth, c.width + 32), height: c.height + 40 },
  };
}
// How many pixels of two pictures differ, and how many of those lie away from the card's two rounded top corners
// (where the frame, whose colour is the board's own, runs through the field's box).
async function pixels(urls) {
  const imgs = await Promise.all(urls.map((u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = u; })));
  if (imgs[0].width !== imgs[1].width || imgs[0].height !== imgs[1].height) return { sizes: `${imgs[0].width}x${imgs[0].height} and ${imgs[1].width}x${imgs[1].height}`, differ: -1, away: -1, of: 0 };
  const d = imgs.map((i) => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; });
  const w = imgs[0].width, corner = 52;
  let differ = 0, away = 0;
  for (let i = 0; i < d[0].length; i += 4) {
    if (Math.max(Math.abs(d[0][i] - d[1][i]), Math.abs(d[0][i + 1] - d[1][i + 1]), Math.abs(d[0][i + 2] - d[1][i + 2])) <= 2) continue;
    differ++;
    const x = (i / 4) % w, y = Math.floor(i / 4 / w);
    if (!(y < corner && (x < corner || x >= w - corner))) away++;
  }
  return { differ, away, of: d[0].length / 4 };
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await browsers[BROWSER].launch(arg("exe") ? { executablePath: arg("exe") } : {});
const rows = [], wrong = [];
for (const [size, opts] of Object.entries(SIZES)) for (const scheme of ["dark", "light"]) {
  const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 2, colorScheme: scheme });
  // The web UI's own theme setting, which both read.
  await ctx.addInitScript((t) => { try { localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ theme: t })); } catch {} }, scheme);
  // The web UI sends over its socket, the board with a call of its own: either is held back while `held.on`.
  await ctx.routeWebSocket(/\/ws(\?|$)/, (ws) => { const server = ws.connectToServer(); ws.onMessage((m) => { if (held.on) setTimeout(() => { try { server.send(m); } catch {} }, HOLD); else server.send(m); }); });
  await ctx.route("**/superwork/api/send*", async (r) => { if (held.on) await sleep(HOLD); await r.continue().catch(() => {}); });
  const pages = {};
  for (const [who, url] of [["orig", ORIG], ["board", BOARD]]) {
    const p = pages[who] = await ctx.newPage();
    await p.goto(url, { waitUntil: "networkidle" }); await p.waitForSelector(PARTS[who].card, { timeout: 20000 }); await p.waitForTimeout(1200);
  }
  for (const [state, st] of Object.entries(STATES)) {
    const got = {}, file = (who, part = "") => path.join(OUT, `${part ? `part-${part}-` : ""}${size}-${scheme}-${state.replace(/\W+/g, "-")}-${who}.png`);
    for (const who of ["orig", "board"]) {
      const p = pages[who], s = PARTS[who];
      await p.bringToFront(); await p.locator(s.text).fill(st.text);
      if (st.focus) await p.locator(s.text).focus(); else await p.evaluate(() => document.activeElement?.blur());
      await p.mouse.move(2, 2); await p.waitForTimeout(350);
      if (st.send) { held.on = true; await p.keyboard.press("Enter"); await p.waitForTimeout(500); }
      const m = await p.evaluate(measure, s);
      got[who] = m.values;
      // On its way: the words are still in the box and the button cannot be pressed. Anything else is not that moment.
      if (st.send) got[who]["while sending"] = await p.evaluate((x) => `words in the box: ${document.querySelector(x.text).value !== ""}, send disabled: ${document.querySelector(x.send).disabled}`, s);
      await p.screenshot({ path: file(who), clip: m.clip });
      for (const part of ["text", "send"]) await p.locator(s[part]).screenshot({ path: file(who, part) });
      if (st.send) { await p.waitForTimeout(HOLD + 1500); held.on = false; got[who]["after it went"] = await p.evaluate((x) => `words in the box: ${document.querySelector(x.text).value !== ""}`, s); }
    }
    const differs = Object.keys(got.orig).filter((k) => got.orig[k] !== got.board[k]);
    const cmp = await ctx.newPage(), px = {};
    for (const part of ["text", "send"]) px[part] = await cmp.evaluate(pixels, ["orig", "board"].map((who) => `data:image/png;base64,${fs.readFileSync(file(who, part)).toString("base64")}`));
    await cmp.close();
    const bad = differs.filter((k) => !OWN.includes(k)).map((k) => `${k}: ${got.orig[k]} | ${got.board[k]}`);
    if (st.send) for (const who of ["orig", "board"]) if (got[who]["while sending"] !== "words in the box: true, send disabled: true") bad.push(`${who === "orig" ? "the web UI's box" : "the board's box"} was not caught while sending (${got[who]["while sending"]})`);
    // With no words the two fields show a hint of their own, so only fields that hold the same words are compared.
    if (st.text && px.text.away !== 0) bad.push(`the field's pixels: ${px.text.sizes || `${px.text.away} differ away from the corners`}`);
    if (px.send.differ !== 0) bad.push(`the send button's pixels: ${px.send.sizes || `${px.send.differ} differ`}`);
    rows.push({ size, scheme, state, orig: got.orig, board: got.board, differs, pixels: px, bad });
    for (const b of bad) wrong.push(`${size}, ${scheme}, ${state}: ${b}`);
    console.log(`${bad.length ? "✖" : "✓"} ${size}, ${scheme}, ${state}: field ${px.text.differ} of ${px.text.of} pixels differ (${px.text.away} away from the corners), send ${px.send.differ} of ${px.send.of}${bad.length ? `\n    ${bad.join("\n    ")}` : ""}`);
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, "measured.json"), JSON.stringify(rows, null, 1));
console.log(wrong.length ? `\n${wrong.length} differences that are not the board's own. Pictures and numbers: ${OUT}` : `\nThe same, but for what is the board's own. Pictures and numbers: ${OUT}`);
process.exit(wrong.length ? 1 : 0);
