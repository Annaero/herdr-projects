// The Coordinator's saved state (one file per herdr session) and the folder it chats in.
import path from "node:path";
import * as S from "../store.js";
import { currentSocket, sessionName } from "../herdr.js";

export const dirOf = (socket) => path.join(S.dataDir(), "coordinator", sessionName(socket));
const fileOf = (socket) => path.join(dirOf(socket), "state.json");
export const get = (socket = currentSocket()) => S.readJson(fileOf(socket)) || null;
export function change(socket, fn) {
  return S.withLock(`coordinator:${sessionName(socket)}`, () => {
    const c = get(socket) || { queue: [] };
    if (fn(c) === false) return c;
    S.writeJson(fileOf(socket), c);
    return c;
  }, { waitMs: 5000 });
}
// Where it runs: a folder of its own (HERDR_SUPERWORK_COORDINATOR_DIR names another, which should be used for nothing
// else). It is one agent for the whole board, whichever repo the board was opened in, and a folder nothing else
// chats in is how its conversation is told from any other: the newest one saved there is the one it is in, also
// after its own "new chat" command (/clear, /new).
export const home = (socket = currentSocket()) => process.env.HERDR_SUPERWORK_COORDINATOR_DIR || path.join(dirOf(socket), "chat");
