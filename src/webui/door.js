// The front door: a small server in front of the herdr web UI. Every request goes through to the web UI as it is
// (proxy.js); the two things added are the board's own pages and calls, all under one path the web UI does not use
// (`/superwork/`), and one script line in the web UI's page (shell.js). A fault of ours never breaks the web UI:
// whatever goes wrong on the way to the board, a request that is not the board's is still passed through.
// It listens on 127.0.0.1 only (docs/web-ui.md).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { pass, passUpgrade, DOWN } from "./proxy.js";
import { BASE, mayBeShell, shellHeaders, sendShell } from "./shell.js";
import { who, mayCall, CHANGES, LOOKS } from "./access.js";
import { isAccess, accessHeaders, sendAccess } from "./phone.js";

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "page");
const TYPES = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const json = (res, status, body) => { const text = JSON.stringify(body); res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-length": Buffer.byteLength(text) }); res.end(text); };
const isOurs = (url) => { const p = String(url).split("?")[0]; return p === BASE || p.startsWith(`${BASE}/`); };

// The board's thread (worker.js), started when first asked and again after it has died.
function boardThread() {
  let worker = null, n = 0;
  const waiting = new Map();
  const start = () => {
    worker = new Worker(new URL("./worker.js", import.meta.url));
    worker.on("message", (m) => { const w = waiting.get(m.n); if (w) { waiting.delete(m.n); clearTimeout(w.timer); w.done(m); } });
    const gone = () => { worker = null; for (const [, w] of waiting) { clearTimeout(w.timer); w.done({ ok: false, msg: "The board stopped answering. Try again." }); } waiting.clear(); };
    worker.on("error", gone); worker.on("exit", gone);
    worker.unref();
  };
  return {
    call(client, call, args, ms = 30000) {
      return new Promise((done) => {
        try { if (!worker) start(); } catch (e) { return done({ ok: false, msg: String(e.message || e) }); }
        const id = ++n;
        waiting.set(id, { done, timer: setTimeout(() => { waiting.delete(id); done({ ok: false, msg: "The board took too long to answer." }); }, ms) });
        worker.postMessage({ n: id, client, call, args });
      });
    },
    stop() { try { worker?.terminate(); } catch {} },
  };
}

// A call's own words: a small JSON object, or null when it is not one.
function body(req, max = 256 * 1024) {
  return new Promise((done) => {
    const parts = [];
    let size = 0;
    req.on("data", (d) => { size += d.length; if (size > max) { done(null); req.destroy(); } else parts.push(d); });
    req.on("error", () => done(null));
    req.on("end", () => { try { const j = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}"); done(j && typeof j === "object" && !Array.isArray(j) ? j : null); } catch { done(null); } });
  });
}

// The page's own files: code and styles, no task in them, public as the web UI's own files are.
function sendPage(req, res, name) {
  const file = path.join(PAGE, name);
  if (!/^[a-z0-9-]+\.(js|css|svg)$/.test(name) || !fs.existsSync(file)) return json(res, 404, { ok: false, msg: "Not found" });
  const body = fs.readFileSync(file);
  res.writeHead(200, { "content-type": TYPES[path.extname(name)], "cache-control": "no-cache", "x-content-type-options": "nosniff", "content-length": body.length });
  res.end(req.method === "HEAD" ? undefined : body);
}

// `to()`: the web UI's address right now ({ host, port }), or null while there is none.
// `onDown()`: the web UI did not answer (it may have moved to another port). `link()`: the web UI's shared link that
// goes through this front door ("" when none does), for the one answer phone.js corrects.
export function createDoor({ to, board = boardThread(), onDown = () => {}, link = () => "" }) {
  async function ours(req, res) {
    const url = new URL(req.url, "http://door");
    const rest = url.pathname.slice(BASE.length + 1);
    if (rest.startsWith("page/") && ["GET", "HEAD"].includes(req.method)) return sendPage(req, res, rest.slice(5));
    if (!rest.startsWith("api/")) return json(res, 404, { ok: false, msg: "Not found" });
    // Everything from here is the board's own: only for someone the web UI lets in.
    const up = to();
    const person = up ? await who(req, up) : { ok: false, why: "down" };
    if (!person.ok) return json(res, person.why === "down" ? 503 : 401, { ok: false, msg: person.why === "down" ? "The herdr web UI is not answering." : "Log in to the herdr web UI first." });
    const client = url.searchParams.get("client") || "", call = rest.slice(4);
    const answer = (out) => json(res, out.ok ? 200 : 500, out.ok ? { ok: true, role: person.role, ...out.data } : { ok: false, msg: out.msg });
    if (req.method === "GET") {
      // The page's first question: am I let in? Nothing of the board is in the answer.
      if (call === "hello") return json(res, 200, { ok: true, role: person.role });
      if (call === "board") return answer(await board.call(client, "board", { have: url.searchParams.get("have") || "" }));
      return json(res, 404, { ok: false, msg: "Not found" });
    }
    if (req.method !== "POST" || ![...CHANGES, ...LOOKS].includes(call)) return json(res, 404, { ok: false, msg: "Not found" });
    const may = mayCall(req, person, call);
    if (!may.ok) return json(res, may.status, { ok: false, msg: may.msg });
    const args = await body(req);
    if (!args) return json(res, 400, { ok: false, msg: "The request could not be read." });
    return answer(await board.call(client, call, { ...args, role: person.role }));
  }
  const server = http.createServer((req, res) => {
    if (isOurs(req.url)) return void ours(req, res).catch(() => { try { json(res, 500, { ok: false, msg: "The board could not answer." }); } catch { res.destroy(); } });
    const up = to();
    if (!up) { res.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); return void res.end(DOWN); }
    try {
      if (mayBeShell(req)) return void pass(req, res, up, { headers: shellHeaders(req), onResponse: (answer) => sendShell(answer, res), onDown });
      if (isAccess(req) && link()) return void pass(req, res, up, { headers: accessHeaders(req), onResponse: (answer) => sendAccess(answer, res, link()), onDown });
    } catch {}
    pass(req, res, up, { onDown });
  });
  server.on("upgrade", (req, socket, head) => {
    const up = to();
    if (!up || isOurs(req.url)) return socket.destroy();
    passUpgrade(req, socket, head, up);
  });
  // A long upload and a stream that stays open are the web UI's to time out, not ours.
  server.requestTimeout = 0; server.timeout = 0; server.keepAliveTimeout = 65000;
  server.on("clientError", (e, socket) => { try { socket.destroy(); } catch {} });
  server.on("close", () => board.stop?.());
  return server;
}
