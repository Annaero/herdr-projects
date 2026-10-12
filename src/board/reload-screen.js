// A board that loads its new version keeps its screen: the old board's last frame stays until the new one has drawn over it.
//
// The board restarts itself when the plugin's code changes under it (main.js), which is every time a task's work is
// merged into the checkout the plugin runs from. Stopping the screen the usual way leaves the full-screen view and
// prints the board once more on the plain screen under it; the new board then clears and draws. Seen on a real
// terminal: the whole board one line off for a third of a second, then empty, then back. So for a reload the old
// board leaves everything but the full-screen view, and the new one enters it without clearing first.
const LEAVE = "\x1b[?1049l", ENTER = "\x1b[?1049h", CLEAR = "\x1b[2J";
const ENV = "HERDR_SUPERWORK_KEPT_SCREEN";

// Runs `stop` (the screen's own stop: keyboard and paste modes are given back) with what leaves the full-screen view
// held back. `out` is the terminal's stream.
export function stopKeepingScreen(stop, out = process.stdout) {
  const write = out.write;
  out.write = function (chunk, ...rest) {
    if (typeof chunk === "string" && chunk.includes(LEAVE)) { const cb = rest.find((x) => typeof x === "function"); if (cb) cb(); return true; }
    return write.call(this, chunk, ...rest);
  };
  try { stop(); } finally { out.write = write; }
}
// What the new board is started with, so that it knows the old one's frame is still up.
export const keptEnv = () => ({ [ENV]: "1" });
// In the new board, before its screen starts: it is in the full-screen view already, so the first time it would
// enter and clear it, it does neither. Its first frame is drawn whole, over what is there.
export function startOnKeptScreen(out = process.stdout, env = process.env) {
  if (env[ENV] !== "1") return false;
  delete env[ENV]; // its own next reload decides again
  const write = out.write;
  out.write = function (chunk, ...rest) {
    if (typeof chunk !== "string" || !chunk.includes(ENTER)) return write.call(this, chunk, ...rest);
    out.write = write;
    return write.call(this, chunk.replace(ENTER, "").replace(CLEAR, ""), ...rest); // entering again clears too (herdr 0.9.3): it is in that view already
  };
  return true;
}
// The new board could not be started, or died: the terminal gets its plain screen and its cursor back.
export const giveScreenBack = (out = process.stdout) => { try { out.write(`${LEAVE}\x1b[?25h`); } catch {} };
