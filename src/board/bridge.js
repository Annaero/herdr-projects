// The Coordinator's real terminal, full screen inside the board. herdr streams one of its terminals to a controller
// (`herdr terminal session control`: rendered frames out, key presses in), so this is the agent's own chat and not a
// copy of it: its dialogs, its slash commands, its menus. The board's screen is stopped while it shows. The last row
// is the board's: it names the keys that bring the drawer down again, which are the only ones not passed on.
//
// Verified on herdr 0.9.3: a frame is {"type":"terminal.frame","full":bool,"bytes":<base64 ANSI>}, drawn with absolute
// cursor positions inside --cols x --rows; a full frame clears the screen; closing the controller's input detaches.
import { spawn } from "node:child_process";
import { matchesKey } from "@earendil-works/pi-tui";

export class Bridge {
  child = null; open = false; buf = "";
  // keys: [[key name, what it means]]; onKey(what) is called for those; onClose(reason) when herdr ends the stream.
  constructor({ socket, pane, footer, keys, onKey, onClose, io = {} }) {
    Object.assign(this, { socket, pane, footer, keys, onKey, onClose });
    this.stdin = io.stdin || process.stdin; this.stdout = io.stdout || process.stdout; this.spawn = io.spawn || spawn;
  }
  size() { return { cols: Math.max(20, this.stdout.columns || 80), rows: Math.max(4, (this.stdout.rows || 24) - 1) }; }
  start() {
    const { cols, rows } = this.size();
    const env = { ...process.env, HERDR_SOCKET_PATH: this.socket };
    for (const k of ["HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID", "HERDR_SESSION"]) delete env[k];
    this.child = this.spawn(process.env.HERDR_BIN_PATH || "herdr", ["terminal", "session", "control", this.pane, "--takeover", "--cols", String(cols), "--rows", String(rows)], { env, stdio: ["pipe", "pipe", "ignore"] });
    this.open = true;
    this.stdout.write("\x1b[?1049h\x1b[2J\x1b[H\x1b[?2004h"); // its own screen; pastes arrive marked, as the agent expects
    this.onData = (d) => this.key(d);
    this.onResize = () => { const s = this.size(); this.stdout.write("\x1b[2J"); this.say({ type: "terminal.resize", ...s }); this.drawFooter(); };
    try { this.stdin.setRawMode?.(true); } catch {}
    this.stdin.resume?.();
    this.stdin.on("data", this.onData);
    this.stdout.on?.("resize", this.onResize);
    this.child.stdout.on("data", (d) => this.frames(d));
    this.child.stdin.on("error", () => {});
    this.child.on("error", () => this.end("herdr could not show its terminal"));
    this.child.on("close", () => this.end("its terminal was closed or taken over elsewhere"));
    this.drawFooter();
  }
  say(cmd) { try { if (this.open) this.child.stdin.write(JSON.stringify(cmd) + "\n"); } catch {} }
  frames(d) {
    this.buf += d;
    for (let at; (at = this.buf.indexOf("\n")) >= 0;) {
      const line = this.buf.slice(0, at); this.buf = this.buf.slice(at + 1);
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (!this.open) return;
      if (j.type === "terminal.frame" && j.bytes) { this.stdout.write(Buffer.from(j.bytes, "base64")); if (j.full) this.drawFooter(); }
      else if (j.type === "terminal.closed") return this.end("its terminal was closed or taken over elsewhere");
    }
  }
  key(d) {
    const s = d.toString("utf8");
    for (const [k, what] of this.keys) if (matchesKey(s, k)) return this.onKey(what);
    // The agent's own screen has no scrollbar here: shift+PgUp/PgDn scroll herdr's view of it.
    const dir = matchesKey(s, "shift+pageUp") ? "up" : matchesKey(s, "shift+pageDown") ? "down" : "";
    if (dir) return this.say({ type: "terminal.scroll", direction: dir, lines: Math.max(1, Math.floor(this.size().rows / 2)) });
    this.say({ type: "terminal.input", bytes: Buffer.from(d).toString("base64") });
  }
  // The board's one row, below the agent's screen. Drawn around a saved cursor so the agent's cursor stays put.
  drawFooter() {
    if (!this.open) return;
    const { cols, rows } = this.size();
    let text = ""; try { text = this.footer(cols); } catch {}
    this.stdout.write(`\x1b7\x1b[${rows + 1};1H\x1b[0m\x1b[2K${text}\x1b[0m\x1b8`);
  }
  end(reason) { if (!this.open) return; this.stop(); this.onClose?.(reason); }
  // Give the terminal back to the board. The agent keeps running: only this view of it ends.
  stop() {
    if (!this.open) return;
    this.open = false;
    this.stdin.removeListener("data", this.onData);
    this.stdout.removeListener?.("resize", this.onResize);
    try { this.child.stdin.end(JSON.stringify({ type: "terminal.release" }) + "\n"); } catch {}
    const child = this.child;
    setTimeout(() => { try { child.kill("SIGTERM"); } catch {} }, 500).unref?.();
    try { this.stdin.setRawMode?.(false); } catch {}
    this.stdout.write("\x1b[?2004l\x1b[0m\x1b[?25h\x1b[?1049l");
  }
}
