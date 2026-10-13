// The board's side of the front door, in a thread of its own: reading tasks asks herdr, and asking herdr waits. Kept
// apart, that wait never holds up what passes through to the web UI (a terminal's keystrokes, a chat's stream).
// The door sends { n, client, call, args }; the answer is { n, ok, data } or { n, ok: false, msg }.
import { parentPort } from "node:worker_threads";
import { createHash } from "node:crypto";
import { KEY } from "../board/keys.js";
import { WebView } from "./web-view.js";
import { listOf } from "./list-model.js";
import { panelOf } from "./panel-model.js";
import { sideOf } from "./side-model.js";

// One board per browser that has it open; one nobody asked for in ten minutes is let go.
const views = new Map();
const IDLE = 10 * 60000;
export function viewOf(client, make = () => new WebView()) {
  const key = String(client || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "one";
  let x = views.get(key);
  if (!x) { x = { v: make(), at: 0 }; views.set(key, x); }
  x.at = Date.now();
  for (const [k, o] of views) if (k !== key && Date.now() - o.at > IDLE) { try { o.v.dispose(); } catch {} views.delete(k); }
  return x.v;
}
// Everything the page shows, and a short mark of it: a page that already has this one is told only that.
export function snapshot(v, have = "") {
  const r = v.current() || v.job() || null;
  const data = { list: listOf(v), panel: v.full ? panelOf(v, r) : null, ...sideOf(v) };
  const mark = createHash("sha1").update(JSON.stringify(data)).digest("base64url").slice(0, 16);
  return mark === have ? { same: true, mark } : { ...data, mark };
}
// The calls. `role` comes from the door (access.js): "drive" may change things, "watch" may only look.
export const CALLS = {
  board: { run: (v, a) => { v.look(); return snapshot(v, a.have); } },
  // A key that does something is for someone who may drive; one that only shows or hides is for a watcher too.
  press: { run: (v, a) => { const id = String(a.id || ""); if (a.role !== "drive" && KEY[id]?.group !== "alt") throw new Error("This device can only watch."); const out = v.press(id); return { ...snapshot(v), draft: out.draft }; } },
  send: { run: (v, a) => { if (a.role !== "drive") throw new Error("This device can only watch."); const out = v.send(a.text, !!a.delegate); return { ...snapshot(v), kept: out.kept }; } },
  // These two only change what this page looks at: its selection, its filter.
  pick: { run: (v, a) => { v.pick(String(a.id || ""), !!a.open); return snapshot(v); } },
  find: { run: (v, a) => { v.find(a.text); return snapshot(v); } },
};

parentPort?.on("message", (m) => {
  try {
    const call = CALLS[m.call];
    if (!call) throw new Error(`Unknown call ${m.call}`);
    parentPort.postMessage({ n: m.n, ok: true, data: call.run(viewOf(m.client), m.args || {}) });
  } catch (e) { parentPort.postMessage({ n: m.n, ok: false, msg: String((e && e.message) || e) }); }
});
