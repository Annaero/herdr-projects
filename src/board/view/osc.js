// The same tasks, told to the terminal (OSC 7501).
import * as S from "../../store.js";

const b64 = (s) => Buffer.from(String(s), "utf8").toString("base64");
export function osc(r) {
  const pairs = [`state=${r.state}`, `id=${r.id}`];
  if (r.kind) pairs.push(`kind=${r.kind}`);
  if (r.progress !== undefined) pairs.push(`progress=${r.progress}`);
  if (r.eta !== undefined) pairs.push(`eta=${r.eta}`);
  if (r.app && /^[A-Za-z0-9_.+-]{1,32}$/.test(r.app)) pairs.push(`app=${r.app}`);
  if (r.title) pairs.push(`title=${b64(S.oneLine(r.title, 192))}`);
  if (r.msg) pairs.push(`msg=${b64(S.oneLine(r.msg, 600))}`);
  return `\x1b]7501;${pairs.join(":")}\x1b\\`;
}
export const oscClear = (id) => `\x1b]7501;state=clear:id=${id}\x1b\\`;

export class Announce {
  // For a board run as a plain command: its tasks as OSC 7501 records on its own terminal. Output only: nothing
  // reads OSC 7501. (That a task newly needs you is `ring`, below.)
  // `board.notify: bell`: the terminal bell, once for each task that newly needs you, is ready to approve or failed
  // (notify.js notes those on the task). What was already so when the board opened rings nothing.
  ring() {
    const newest = Math.max(0, ...this.items.filter((r) => !r.host && !r.archivedAt).map((r) => r.notice?.at || 0));
    if (this.rang === undefined) this.rang = Date.now();
    if (newest <= this.rang) return;
    this.rang = newest;
    if (S.setting("board.notify") !== "bell") return;
    if (this.ctx.bell) this.ctx.bell(); else if (process.stdout.isTTY) process.stdout.write("\x07");
  }
  announce() {
    const local = this.items.filter((r) => !r.host && !r.archivedAt);
    if (process.env.HERDR_PLUGIN_ID || process.env.HERDR_SUPERWORK_PROGRAM_STATUS === "0") return;
    const next = new Map();
    for (const r of local) if (r.state !== "idle" && r.state !== "done") next.set(r.id, osc(r));
    let out = "";
    for (const [id, seq] of next) if (this.sent.get(id) !== seq) out += seq;
    for (const id of this.sent.keys()) if (!next.has(id)) out += oscClear(id);
    this.sent = next;
    if (out) process.stdout.write(out);
  }
}
