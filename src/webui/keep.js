// The front door's life. It runs inside the board's one page server (`herdr-superwork serve`, review-page.js), as a
// second listener there, so the plugin still owns one long-lived process and not two. It is up while the web UI
// plugin is installed (find.js), follows the web UI to another port, hands over to a new process when the plugin was
// updated, and stops cleanly. Its bookkeeping (its process, its port, where it passes things on to) is one file in the
// data folder: front-door.json. The keeper, herdr's start and the board opening all see to it that it is up.
import fs from "node:fs";
import path from "node:path";
import * as S from "../store.js";
import * as X from "../extras.js";
import { codeStamp } from "../keeper.js";
import { spawnLoose } from "../housekeeping.js";
import { inline } from "../runner.js";
import { ensureServer, serverInfo } from "../review-page.js";
import { webUi } from "./find.js";
import { createDoor } from "./door.js";
import * as L from "./link.js";

export const doorFile = () => path.join(S.dataDir(), "front-door.json");
export const doorInfo = () => { const d = S.readJson(doorFile()); return d && S.markerAlive(d) && d.port ? d : null; };
// The port it asks for the first time; after that the one it had, so the shared link keeps pointing at it.
const FIRST_PORT = 7327;
const off = () => process.env.HERDR_SUPERWORK_NO_SERVER === "1" || inline();

// Seen to from outside: the page server is started when the web UI is there and no front door answers. A page server
// from before the front door existed is told to go, and the next look starts today's.
export function ensureDoor() {
  if (off() || !webUi()) return false;
  if (doorInfo()) return true;
  // A page server that never wrote the front door's file is from before there was one: it goes, and the next look
  // starts today's. One that wrote it is today's, and opens its front door by itself.
  const old = serverInfo();
  if (old && !fs.existsSync(doorFile())) { try { process.kill(old.pid, "SIGTERM"); } catch {} return false; }
  if (old) return false;
  ensureServer();
  return !!doorInfo();
}

// The port it had may still be held for a moment by the process it takes over from; then the first one; then any.
function listen(server, wants) {
  return new Promise((done) => {
    let n = 0, tries = 0;
    const next = () => { const w = wants[n]; if (!w) return done(0); server.listen(w.port, "127.0.0.1"); };
    server.on("error", () => { if (server.listening) return; if (++tries < (wants[n]?.tries || 1)) return void setTimeout(next, 250); n++; tries = 0; next(); });
    server.once("listening", () => done(server.address().port));
    next();
  });
}

// In the page server's process: opens the front door while there is a web UI, and keeps looking. Never throws.
// `run`: a stand-in for the tailscale program (tests).
export function runDoor({ every = 30000, exit = (code) => process.exit(code), run } = {}) {
  const ts = run ? { run } : {};
  if (off()) return { stop() {}, tick: async () => {}, address: () => null };
  const stamp = codeStamp();
  let server = null, to = null, port = 0, lookedAt = 0, ending = false, linked = "";
  const saved = S.readJson(doorFile()) || {};
  const write = () => { try { S.writeJson(doorFile(), S.marker({ port, to: to ? { host: to.host, port: to.port } : null, version: S.VERSION })); } catch {} };
  const find = () => { lookedAt = Date.now(); try { to = webUi({ fresh: true }) || null; } catch { to = null; } return to; };
  // The board shows the herdr the web UI shows (find.js says which).
  const sameHerdr = () => { if (to?.socket) process.env.HERDR_SOCKET_PATH = to.socket; };
  const shut = () => { try { server?.close(); server?.closeAllConnections?.(); } catch {} server = null; linked = ""; };
  const close = async (undo, webUiWas) => {
    if (undo && port) { try { await L.unlink({ door: { port }, webUi: webUiWas, ...ts }); } catch {} }
    shut();
    try { S.writeJson(doorFile(), {}); } catch {}
  };
  const tick = async () => {
    if (ending) return;
    // The plugin was updated: a new process takes over, on the same port (the file keeps saying which).
    try { if (codeStamp() !== stamp) { ending = true; shut(); spawnLoose(["serve"]); return setTimeout(() => exit(0), 50); } } catch {}
    const before = to;
    find();
    if (!to && server) return close(true, before); // the web UI is gone, or the board in it was turned off: its link goes back
    if (!to) return;
    if (!server) {
      sameHerdr();
      const next = createDoor({ to: () => to, onDown: () => { if (Date.now() - lookedAt > 5000) find(); }, link: () => linked });
      const got = await listen(next, [...(port || saved.port ? [{ port: port || saved.port, tries: 12 }] : []), { port: FIRST_PORT }, { port: 0 }]);
      if (!got) return;
      server = next; port = got;
      write();
    } else if (before?.port !== to.port || before?.host !== to.host) write();
    // Its links are where it is, and go back to where the web UI is now: one that still points at where the front
    // door was is brought along. Which of the web UI's links goes through it is what phone.js tells the web UI.
    // A link made for the web UI later is left alone: taking it too would have the web UI's Phone setup make another.
    try {
      await L.follow({ door: { port }, was: saved.port && saved.port !== port ? { port: saved.port } : null, webUi: to, ...ts });
      linked = (await L.look({ webUi: to, door: { port }, ...ts })).ours.find((e) => !e.funnel)?.url || "";
    } catch {}
  };
  const timer = setInterval(() => void tick().catch(() => {}), every);
  timer.unref?.();
  void tick().catch(() => {});
  return { stop: async () => { ending = true; clearInterval(timer); await close(false); }, tick, address: () => server?.address() || null };
}
