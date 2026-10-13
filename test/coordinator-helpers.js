// Shared by the Coordinator's tests (test/coordinator-*.test.js): a world with a Coordinator, and a board opened on it.
import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";

export const KEY = { enter: "\r", tab: "\t", esc: "\x1b", space: " ", "alt+c": "\x1bc", "alt+t": "\x1bt", "alt+v": "\x1bv", "alt+n": "\x1bn", "alt+r": "\x1br" };
// A world with a Coordinator: the default one is Claude Code on its defaults. Its folder and Claude's own files are the
// test's, and both programs count as installed without being run.
export async function coordWorld(settings = {}) {
  const w = await world({ settings: { "coordinator.agent": "claude", "review.when": "never", ...settings } });
  process.env.HERDR_SUPERWORK_COORDINATOR_DIR = path.join(w.base, "home"); fs.mkdirSync(process.env.HERDR_SUPERWORK_COORDINATOR_DIR);
  process.env.CLAUDE_CONFIG_DIR = path.join(w.base, "claude");
  S.writeJson(path.join(S.dataDir(), "versions.json"), Object.fromEntries(["claude", "codex"].map((k) => [k, { v: "9.9.9", at: Date.now(), found: true }])));
  const end = w.cleanup;
  w.cleanup = () => { delete process.env.HERDR_SUPERWORK_COORDINATOR_DIR; delete process.env.CLAUDE_CONFIG_DIR; end(); };
  w.agents = () => w.state().panes.filter((p) => p.agent);
  return w;
}
export function open(w, { rows = 34 } = {}) {
  const calls = [], closed = [];
  const tui = { terminal: { rows, columns: 120 }, requestRender() {}, stop() { calls.push("stop"); }, start() { calls.push("start"); } };
  const v = new View(tui, theme, (x) => closed.push(x), { cwd: w.root });
  clearInterval(v.timer);
  v.side = true; // the side panel is closed until asked for; these tests read it
  const screen = (width = 120) => v.render(width).map((l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, ""));
  const press = (...keys) => { for (const k of keys) v.handleInput(KEY[k] ?? k); };
  const type = (text) => { for (const ch of text) v.handleInput(ch); };
  const beat = () => { v.load(); v.syncCoord(); };
  return { v, tui: calls, closed, screen, press, type, beat, text: (width) => screen(width).join("\n") };
}
