// Shared by the board's tests (test/board-*.test.js): the keys, and a board opened on a test world.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const KEY = { enter: "\r", tab: "\t", esc: "\x1b", space: " ", right: "\x1b[C", down: "\x1b[B", up: "\x1b[A", "ctrl+a": "\x01", "ctrl+c": "\x03", "ctrl+e": "\x05", "ctrl+x": "\x18", "ctrl+t": "\x14", "ctrl+r": "\x12", "ctrl+y": "\x19", "ctrl+g": "\x07", "ctrl+z": "\x1a", "ctrl+b": "\x02", "ctrl+p": "\x10", "ctrl+f": "\x06", "ctrl+s": "\x13", "alt+a": "\x1ba", "alt+h": "\x1bh", "ctrl+d": "\x04", delete: "\x1b[3~" };
// The side panel is closed until you ask for it; most of these tests read it, so they start with it open.
export function open(w, { rows = 34, side = true } = {}) {
  let closed;
  const tui = { terminal: { rows, columns: 120 }, requestRender() {}, stop() {}, start() {} };
  const v = new View(tui, theme, (x) => { closed = x ?? null; }, { cwd: w.root, canReload: true });
  clearInterval(v.timer);
  v.side = side;
  const screen = (width = 120) => v.render(width).map((l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, ""));
  const press = (...keys) => { for (const k of keys) v.handleInput(KEY[k] ?? k); };
  const type = (text) => { for (const ch of text) v.handleInput(ch); };
  return { v, screen, press, type, closed: () => closed, text: (width) => screen(width).join("\n") };
}
