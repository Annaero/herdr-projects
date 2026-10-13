// Shared by the board's tests (test/board-*.test.js): the keys, and a board opened on a test world.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { KEY as KEYS_BY_ID, name as keyName } from "../src/board/keys.js";

export const here = path.dirname(fileURLToPath(import.meta.url));
// Colours by the name the theme gives them, never by their numbers: `ink("red")` is what starts text painted in the
// theme's red, as the board would paint it now. A test that names a colour stays right when a theme's numbers change.
export const ink = (name) => theme.fg(name, "\0").split("\0")[0];
// The colour the word is painted in on a line: what `ink(name)` gives for it, or undefined for none.
export const inkAt = (out, word) => String(out).slice(0, String(out).indexOf(word)).match(/\x1b\[38;[\d;]+m(?!.*\x1b\[38)/s)?.[0];
// Keys by their name in the list of keys, never by their chord: `keyed(/{sendBack} sends it/)` is that pattern with
// each `{id}` replaced by what the board calls the key now (`ctrl+r`). A key moved in src/board/keys.js moves here too.
export const keyed = (re) => new RegExp(re.source.replace(/\{([A-Za-z]+)\}/g, (m, id) => (KEYS_BY_ID[id] ? keyName(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : m)), re.flags);
// Alt keys arrive as esc and then the letter: what a terminal sends without the kitty keyboard protocol.
export const KEY = {
  enter: "\r", tab: "\t", esc: "\x1b", space: " ", right: "\x1b[C", down: "\x1b[B", up: "\x1b[A",
  "ctrl+l": "\x0c", "ctrl+r": "\x12", "ctrl+x": "\x18", "ctrl+a": "\x01", "ctrl+p": "\x10", "ctrl+z": "\x1a", "ctrl+f": "\x06", "ctrl+c": "\x03",
  "alt+c": "\x1bc", "alt+u": "\x1bu", "alt+j": "\x1bj", "alt+p": "\x1bp", "alt+t": "\x1bt", "alt+a": "\x1ba", "alt+s": "\x1bs", "alt+d": "\x1bd", "alt+m": "\x1bm",
  // Keys the board had once, or never had: none of them does anything now.
  "ctrl+y": "\x19", "ctrl+e": "\x05", "ctrl+u": "\x15", "ctrl+t": "\x14", "ctrl+g": "\x07", "ctrl+s": "\x13", "ctrl+d": "\x04", "ctrl+o": "\x0f", "ctrl+b": "\x02",
  "alt+o": "\x1bo", "alt+v": "\x1bv", "alt+h": "\x1bh", "alt+r": "\x1br", "alt+n": "\x1bn", delete: "\x1b[3~",
};
// The side panel is closed until you ask for it; most of these tests read it, so they start with it open.
// `ctx` adds to what the board is opened with: `{ popup: true }` is the board in herdr's popup.
export function open(w, { rows = 34, side = true, ctx = {} } = {}) {
  let closed;
  const tui = { terminal: { rows, columns: 120 }, requestRender() {}, stop() {}, start() {} };
  const v = new View(tui, theme, (x) => { closed = x ?? null; }, { cwd: w.root, canReload: true, ...ctx });
  clearInterval(v.timer);
  v.side = side;
  const screen = (width = 120) => v.render(width).map((l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, ""));
  const press = (...keys) => { for (const k of keys) v.handleInput(KEY[k] ?? k); };
  const type = (text) => { for (const ch of text) v.handleInput(ch); };
  return { v, screen, press, type, closed: () => closed, text: (width) => screen(width).join("\n") };
}
