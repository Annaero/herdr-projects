// Is the board's terminal sized by something other than herdr's own window?
//
// Checked on herdr 0.9.3: a `herdr terminal attach` (herdr's remote web UI starts one per pane it shows) resizes the
// pane's terminal to its own size and holds it there for as long as it runs, also after its viewer has gone. herdr's
// window then shows a cut-out of that size: half empty, or with the right edge and the bottom rows missing. Resizing
// herdr's window does not take the size back; stopping the attach does, at once.
// herdr does not say who is attached. What it does say is where the pane sits in its own window (`pane layout`), and
// a pane's terminal is that place less its frame: up to 3 columns (borders, scrollbar) and 2 rows. A zoomed pane has
// the whole tab, and the others keep their place. A terminal of any other size is held by another view.
import { spawnSync } from "node:child_process";

const SLACK = { columns: 4, rows: 3 };
export function heldSize(term, layout, pane) {
  const rect = layout?.panes?.find((p) => p.pane_id === pane)?.rect;
  const columns = Number(term?.columns), rows = Number(term?.rows);
  if (!rect || !(columns > 0) || !(rows > 0)) return null;
  const fits = (r) => !!r && columns <= r.width && columns >= r.width - SLACK.columns && rows <= r.height && rows >= r.height - SLACK.rows;
  // Zooming a pane focuses it: the zoomed pane is the layout's focused one, and it has the tab, not its old place.
  const room = layout.zoomed && layout.focused_pane_id === pane && layout.area ? layout.area : rect;
  if (fits(room)) return null;
  return { columns, rows, room: { columns: room.width, rows: room.height } };
}
// The attach processes on this machine that hold a terminal, oldest first: { pid, seconds }.
const ps = () => { const r = spawnSync("ps", ["-eo", "pid=,etimes=,args="], { encoding: "utf8", timeout: 3000 }); return r.status === 0 ? r.stdout : ""; };
export function holders(terminalId, text = ps()) {
  if (!terminalId) return [];
  // Read as herdr reads it: its own options, with their values, may stand before the command or after it
  // (`herdr --session work terminal attach <id>`), and the terminal is the command's one plain argument. A session
  // that happens to be called `terminal`, or like this terminal, is a value and never taken for either.
  const VALUED = ["--session", "--machine", "--remote", "--remote-keybindings"];
  const attach = (args) => {
    const a = args.split(/\s+/);
    if (!/(^|\/)herdr$/.test(a[0])) return false;
    const plain = [];
    for (let n = 1; n < a.length; n++) { if (VALUED.includes(a[n])) n++; else if (!a[n].startsWith("-")) plain.push(a[n]); }
    return plain.length === 3 && plain[0] === "terminal" && plain[1] === "attach" && plain[2] === terminalId;
  };
  return String(text).split("\n").map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m) => m && attach(m[3]))
    .map((m) => ({ pid: Number(m[1]), seconds: Number(m[2]) })).sort((a, b) => b.seconds - a.seconds);
}
// One look, for the pane this process runs in. Null when nothing holds the size or when it cannot be known: outside
// herdr, in a popup (which has no pane), or inside a tmux of its own, whose size is tmux's.
export function lookHeld(h, term, env = process.env) {
  const pane = env.HERDR_PANE_ID;
  if (!pane || env.HERDR_ENV !== "1" || env.TMUX) return null;
  const held = heldSize(term, h.paneLayout(pane), pane);
  if (!held) return null;
  return { ...held, by: holders(h.paneGet(pane)?.terminal_id) };
}
