// A line for a board that is running, from a command that has no screen of its own (the board key's action): left
// here for the board in one pane, which shows it on its message line within a second.
import path from "node:path";
import fs from "node:fs";
import * as S from "../store.js";
import { currentSocket, sessionName } from "../herdr.js";

const file = (socket) => path.join(S.dataDir(), `board-say-${sessionName(socket)}.json`);
const FRESH_MS = 15000;
// `to`: the herdr pane of the board that is to say it.
export function say(to, text, kind = "yellow", socket = currentSocket()) {
  if (to && text) { try { S.writeJson(file(socket), { to, text, kind, at: Date.now() }); } catch {} }
}
// What was left for the board in pane `me`: taken once. Another board's line is left for it; an old one is dropped.
export function heard(me, socket = currentSocket(), now = Date.now()) {
  const n = S.readJson(file(socket));
  if (!n) return null;
  const fresh = now - n.at < FRESH_MS;
  if (fresh && (!me || n.to !== me)) return null;
  try { fs.rmSync(file(socket), { force: true }); } catch {}
  return fresh && n.text ? { text: String(n.text), kind: String(n.kind || "yellow") } : null;
}
