// herdr's socket, spoken to directly, for the two things its command line has not got (herdr 0.9.3): closing its
// popup (`popup.close`), and being told the moment another tab shows (`events.subscribe`). One JSON line asks, one
// answers; a subscription keeps its connection and gets a line per event. Everything else goes through herdr.js.
import net from "node:net";
import { spawnSync } from "node:child_process";
import { HerdrError, currentSocket } from "./herdr.js";

// A request has to be answered before the caller goes on, and node has no socket that waits: a second node asks.
const ASK = `const c = require("node:net").connect(process.argv[1], () => c.write(process.argv[2] + "\\n"));
let out = ""; c.on("data", (d) => { out += d; if (out.includes("\\n")) { process.stdout.write(out.split("\\n")[0]); c.destroy(); } });
c.on("error", (e) => { process.stderr.write(String(e.code || e.message)); process.exitCode = 1; });`;
// One request: its result, or what herdr refused it with (`e.code`: "popup_not_open"). Tests answer for herdr
// themselves (`globalThis.__swHerdr.ask`), as they do for its command line.
export function ask(method, params = {}, socket = currentSocket()) {
  const own = globalThis.__swHerdr;
  let r;
  if (own?.ask) r = own.ask(method, params, socket);
  else r = spawnSync(process.execPath, ["-e", ASK, socket, JSON.stringify({ id: "herdr-superwork", method, params })], { encoding: "utf8", timeout: 5000 });
  let j = null;
  try { j = JSON.parse(String(r.stdout || r.stderr).trim().split("\n").pop()); } catch {}
  if (j?.error) throw new HerdrError(j.error.code || "failed", j.error.message, [method]);
  if (!j || r.error || r.status) throw new HerdrError("no_server", String(r.stderr || r.error?.message || "herdr did not answer"), [method]);
  return j.result ?? j;
}
// herdr's popup, whoever opened it. False when none was open.
export function popupClose(socket = currentSocket()) {
  try { ask("popup.close", {}, socket); return true; } catch (e) { if (e.code === "popup_not_open") return false; throw e; }
}
// The same question without waiting for it: `cb(result)`, or `cb(null)` when herdr does not answer or refuses.
export function askSoon(method, params, cb, socket = currentSocket()) {
  let out = "", done = false;
  const end = (v) => { if (!done) { done = true; try { c.destroy(); } catch {} cb(v); } };
  let c = null;
  try {
    c = net.connect(socket, () => c.write(`${JSON.stringify({ id: "herdr-superwork", method, params })}\n`));
    c.on("data", (d) => { out += d; if (out.includes("\n")) { try { end(JSON.parse(out.split("\n")[0]).result || null); } catch { end(null); } } });
    c.on("error", () => end(null)); c.on("close", () => end(null));
    c.unref();
  } catch { end(null); }
}
// Told each time herdr shows another tab (a tab of this space, or another space's): `on(tab id)`. `started`: called
// once herdr has taken the subscription, so that what happened before it can be asked for. Answers what stops it. A
// connection that fails or ends is left at that: there is nothing to tell any more.
export function onTabShown(on, socket = currentSocket(), started = () => {}) {
  let c = null, rest = "";
  try {
    c = net.connect(socket, () => c.write(`${JSON.stringify({ id: "herdr-superwork", method: "events.subscribe", params: { subscriptions: [{ type: "tab.focused" }] } })}\n`));
    c.on("data", (d) => {
      const lines = (rest + d).split("\n"); rest = lines.pop();
      for (const line of lines) {
        try {
          const j = JSON.parse(line);
          if (j.event === "tab_focused" && j.data?.tab_id) on(String(j.data.tab_id));
          else if (j.result?.type === "subscription_started") started();
        } catch {}
      }
    });
    c.on("error", () => {});
    c.unref();
  } catch {}
  return () => { try { c?.destroy(); } catch {} };
}
