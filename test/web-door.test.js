// The front door of the herdr web UI: everything passes through as it is, the page gets one script line, and the
// board's own calls are only for someone the web UI lets in (a stand-in web UI answers here, in this process)
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import zlib from "node:zlib";
import { createDoor } from "../src/webui/door.js";
import { addScript, mayBeShell, TAG } from "../src/webui/shell.js";
import { sameOrigin } from "../src/webui/access.js";
import { withLink } from "../src/webui/phone.js";

const SHELL = '<!doctype html><html><head><title>herdr web ui</title></head><body><div id="root"></div></body></html>';
const CSP = "default-src 'self'; script-src 'self'; frame-ancestors 'none'";
const listen = (server) => new Promise((done) => server.listen(0, "127.0.0.1", () => done(server.address().port)));
// A stand-in for the web UI: its shell for any page, a token cookie as its login, and a few answers to compare.
async function standIn() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, raw: req.rawHeaders.slice() });
    const cookie = String(req.headers.cookie || "");
    const role = /token=watch/.test(cookie) ? "watch" : /token=good/.test(cookie) ? "drive" : "";
    if (req.url.startsWith("/api/health")) return res.end(JSON.stringify({ ok: true, auth: role ? { required: false, authenticated: true, via: "token", role } : { required: true, authenticated: false, reason: "token_required" } }));
    if (req.url === "/api/stream") { res.writeHead(200, { "content-type": "text/event-stream", "X-Odd-Case": "Kept" }); res.write("data: one\n\n"); return void setTimeout(() => res.end("data: two\n\n"), 30); }
    if (req.url === "/api/echo") { const parts = []; req.on("data", (d) => parts.push(d)); return void req.on("end", () => { res.writeHead(201, { "content-type": "application/octet-stream", "set-cookie": ["a=1", "b=2"] }); res.end(Buffer.concat(parts)); }); }
    if (req.url === "/assets/app.js") { const body = zlib.gzipSync("console.log(1)"); res.writeHead(req.headers.range ? 206 : 200, { "content-type": "text/javascript", "content-encoding": "gzip", "content-length": body.length, "cache-control": "public, max-age=31536000, immutable", etag: '"abc"' }); return res.end(body); }
    if (req.url === "/packed") { const body = zlib.gzipSync(SHELL); res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" }); return res.end(body); }
    if (req.url.startsWith("/api/access")) { res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); return res.end(JSON.stringify({ port: 7317, tailscale: req.url.includes("stopped") ? { state: "stopped", dns_name: null, serving_url: null, serve_command: null, serve_url: null } : { state: "running", dns_name: "box.ts.net", serving_url: req.url.includes("has") ? "https://box.ts.net:8443" : null, serve_command: "tailscale serve --bg --https=8443 http://127.0.0.1:7317", serve_url: "https://box.ts.net:8443" } })); }
    if (req.url === "/nobody") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<p>no closing tag"); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "content-security-policy": CSP, etag: '"shell"' });
    res.end(SHELL);
  });
  server.on("upgrade", (req, socket) => { socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"); socket.on("data", (d) => socket.write(`echo:${d}`)); });
  return { server, seen, port: await listen(server) };
}
async function setup({ board, link } = {}) {
  const up = await standIn();
  const calls = [];
  const fake = board || { call: async (client, call, args) => { calls.push({ client, call, args }); return { ok: true, data: { did: call } }; } };
  let to = { host: "127.0.0.1", port: up.port };
  const door = createDoor({ to: () => to, board: fake, ...(link ? { link } : {}) });
  const port = await listen(door);
  // Every connection is ended with the test, a socket that was upgraded too, so nothing outlives it.
  const open = new Set();
  for (const server of [door, up.server]) server.on("connection", (s) => { open.add(s); s.on("close", () => open.delete(s)); });
  const ask = (path, o = {}) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual", headers: { connection: "close", ...(o.headers || {}) }, ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== "headers")) });
  return { up, calls, port, ask, gone: () => { to = null; }, moved: (p) => { to = { host: "127.0.0.1", port: p }; }, close: () => { door.close(); up.server.close(); for (const s of open) s.destroy(); } };
}
const PAGE = { "x-herdr-superwork": "1", "sec-fetch-site": "same-origin", "content-type": "application/json" };

test("the front door passes every request through as it is: status, headers, a stream, an upload, compressed bytes, a socket", async () => {
  const d = await setup();
  try {
    // a stream arrives as it is sent, with its headers in their own spelling
    const stream = await d.ask("/api/stream");
    assert.equal(stream.headers.get("content-type"), "text/event-stream"); assert.equal(stream.headers.get("x-odd-case"), "Kept");
    assert.equal(await stream.text(), "data: one\n\ndata: two\n\n");
    // an upload goes up whole, and the answer's status and its two cookies come back
    const sent = Buffer.from("x".repeat(70000));
    const echo = await d.ask("/api/echo", { method: "POST", body: sent, headers: { "content-type": "application/octet-stream", "x-herdr-machine": "1" } });
    assert.equal(echo.status, 201); assert.deepEqual(echo.headers.getSetCookie(), ["a=1", "b=2"]); assert.equal((await echo.arrayBuffer()).byteLength, sent.length);
    // the web UI sees the caller's own headers, in their own spelling: nothing added, nothing dropped
    const raw = d.up.seen.find((s) => s.url === "/api/echo").raw;
    assert.ok(raw.includes("x-herdr-machine") && raw[raw.indexOf("host") + 1] === `127.0.0.1:${d.port}`); assert.ok(!raw.some((h) => /^x-forwarded|^via$|^forwarded$/i.test(h)));
    // a ready-compressed file is not unpacked or packed again, and a ranged request is asked for as a range
    const asset = await new Promise((done) => http.get({ host: "127.0.0.1", port: d.port, path: "/assets/app.js", headers: { "accept-encoding": "gzip", range: "bytes=0-9" } }, (res) => { const parts = []; res.on("data", (x) => parts.push(x)); res.on("end", () => done({ res, body: Buffer.concat(parts) })); }));
    assert.equal(asset.res.statusCode, 206); assert.equal(asset.res.headers["content-encoding"], "gzip"); assert.equal(asset.res.headers.etag, '"abc"'); assert.equal(zlib.gunzipSync(asset.body).toString(), "console.log(1)");
    assert.equal(d.up.seen.find((s) => s.url === "/assets/app.js").raw.includes("range"), true);
    // a socket upgrade is two pipes
    const said = await new Promise((done) => { const s = net.connect(d.port, "127.0.0.1", () => s.write("GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")); let all = ""; s.on("data", (x) => { all += x; if (all.includes("101") && !all.includes("echo:")) s.write("hi"); if (all.includes("echo:hi")) { s.destroy(); done(all); } }); });
    assert.match(said, /^HTTP\/1\.1 101 /); assert.match(said, /echo:hi$/);
  } finally { d.close(); }
});

test("the web UI's page gets one script line and nothing else changes; what is not the page is left alone", async () => {
  const d = await setup();
  try {
    const page = await d.ask("/?pane=w1%3Ap1", { headers: { accept: "text/html", "accept-encoding": "gzip" } });
    const html = await page.text();
    assert.equal(html, SHELL.replace("</body>", `${TAG}</body>`));
    assert.equal(page.headers.get("content-security-policy"), CSP); assert.equal(page.headers.get("cache-control"), "no-cache");
    assert.equal(page.headers.get("content-length"), String(Buffer.byteLength(html))); assert.equal(page.headers.get("etag"), null); // its length changed, and so did what a saved copy is compared with
    assert.equal(d.up.seen.at(-1).raw.some((h) => h.toLowerCase() === "accept-encoding"), false); // the page is asked for unpacked, since it is read here
    // a page that arrives packed after all, and one with no place for the line, go on exactly as sent
    const packed = await new Promise((done) => http.get({ host: "127.0.0.1", port: d.port, path: "/packed" }, (res) => { const parts = []; res.on("data", (x) => parts.push(x)); res.on("end", () => done(Buffer.concat(parts))); }));
    assert.equal(zlib.gunzipSync(packed).toString(), SHELL);
    assert.equal(await (await d.ask("/nobody")).text(), "<p>no closing tag");
    // the line is added once, and only where a page can be
    assert.equal(addScript(addScript(SHELL)), addScript(SHELL)); assert.equal(addScript("<p>"), null);
    const may = (method, url) => mayBeShell({ method, url });
    assert.deepEqual([may("GET", "/"), may("GET", "/anything/deep?x=1"), may("GET", "/index.html")], [true, true, true]);
    assert.deepEqual([may("POST", "/"), may("GET", "/api/session"), may("GET", "/ws"), may("GET", "/assets/a.js"), may("GET", "/sw.js"), may("GET", "/manifest.webmanifest"), may("GET", "/superwork/page/start.js")], [false, false, false, false, false, false, false]);
  } finally { d.close(); }
});

test("the board's calls are as protected as the web UI's own: nothing without its login, no change from another page or a watching device", async () => {
  const d = await setup();
  try {
    // the page's own files hold no task and are public, as the web UI's are
    const js = await d.ask("/superwork/page/start.js"); assert.equal(js.status, 200); assert.match(js.headers.get("content-type"), /^text\/javascript/);
    assert.equal((await d.ask("/superwork/page/..%2Fdoor.js")).status, 404); assert.equal((await d.ask("/superwork/page/nope.js")).status, 404);
    // not logged in: nothing of the board, read or changed, and the board is never even asked
    for (const [path, o] of [["/superwork/api/board", {}], ["/superwork/api/hello", {}], ["/superwork/api/press", { method: "POST", headers: PAGE, body: '{"id":"yes"}' }], ["/superwork/api/send", { method: "POST", headers: { ...PAGE, cookie: "token=wrong" }, body: '{"text":"x"}' }]]) assert.equal((await d.ask(path, o)).status, 401, path);
    assert.equal(d.calls.length, 0);
    // logged in: the web UI was asked with the caller's own cookie, and the board answers
    const board = await d.ask("/superwork/api/board?client=abc&have=m1", { headers: { cookie: "token=good" } });
    assert.deepEqual(await board.json(), { ok: true, role: "drive", did: "board" }); assert.deepEqual(d.calls.at(-1), { client: "abc", call: "board", args: { have: "m1" } });
    assert.ok(d.up.seen.some((s) => s.url === "/api/health?scope=bridge" && s.raw.includes("token=good")));
    // a change needs the board's own header and the same origin, as the web UI's controls do
    const post = (headers, call = "send", body = '{"text":"hello"}') => d.ask(`/superwork/api/${call}?client=abc`, { method: "POST", headers: { cookie: "token=good", ...headers }, body });
    assert.equal((await post({ "content-type": "application/json", "sec-fetch-site": "same-origin" })).status, 403); // no header of ours
    assert.equal((await post({ ...PAGE, "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await post({ "x-herdr-superwork": "1", origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ "x-herdr-superwork": "1" })).status, 403); // no word on where it comes from
    assert.equal(d.calls.filter((c) => c.call === "send").length, 0);
    const ok = await post(PAGE); assert.equal(ok.status, 200); assert.deepEqual(d.calls.at(-1), { client: "abc", call: "send", args: { text: "hello", role: "drive" } });
    assert.equal((await post({ "x-herdr-superwork": "1", origin: `http://127.0.0.1:${d.port}` })).status, 200);
    // the role is the web UI's word, never the caller's: a device paired to watch cannot send, whatever it claims
    const watch = await d.ask("/superwork/api/send", { method: "POST", headers: { ...PAGE, cookie: "token=watch" }, body: '{"text":"x","role":"drive"}' }); assert.equal(watch.status, 403);
    const look = await d.ask("/superwork/api/pick", { method: "POST", headers: { ...PAGE, cookie: "token=watch" }, body: '{"id":"a/1","role":"drive"}' }); assert.equal(look.status, 200); assert.equal(d.calls.at(-1).args.role, "watch");
    // what is not a call is not found, and a body that is not JSON is refused
    assert.equal((await d.ask("/superwork/api/clear", { method: "POST", headers: { ...PAGE, cookie: "token=good" }, body: "{}" })).status, 404);
    assert.equal((await post(PAGE, "send", "not json")).status, 400);
    assert.deepEqual([sameOrigin({ headers: { "sec-fetch-site": "same-origin" } }), sameOrigin({ headers: { "sec-fetch-site": "none" } }), sameOrigin({ headers: {} }), sameOrigin({ headers: { origin: "http://a:1", host: "a:1" } }), sameOrigin({ headers: { origin: "http://a:1", host: "b:1" } })], [true, false, false, true, false]);
  } finally { d.close(); }
});

test("a fault of ours never breaks the web UI, and a web UI that is down is said plainly", async () => {
  const d = await setup({ board: { call: async () => { throw new Error("boom"); } } });
  try {
    // the board fails: its own call says so, and the web UI's page and calls go through as before
    assert.equal((await d.ask("/superwork/api/board", { headers: { cookie: "token=good" } })).status, 500);
    assert.match(await (await d.ask("/")).text(), /<div id="root">/); assert.equal((await d.ask("/api/stream")).status, 200);
    // the web UI does not answer: its own calls say so, and the board lets nobody in meanwhile
    const free = await new Promise((done) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => done(p)); }); });
    d.moved(free);
    const down = await d.ask("/api/session"); assert.equal(down.status, 502); assert.match(await down.text(), /not answering/);
    assert.equal((await d.ask("/superwork/api/board", { headers: { cookie: "token=good" } })).status, 503);
    d.gone();
    assert.equal((await d.ask("/")).status, 502); assert.equal((await d.ask("/superwork/api/hello", { headers: { cookie: "token=good" } })).status, 503);
  } finally { d.close(); }
});

test("the web UI's Phone setup still knows its link when the link goes through the front door, and is not offered a second one", async () => {
  let linked = "";
  const d = await setup({ link: () => linked });
  try {
    const access = async (q = "") => { const r = await d.ask(`/api/access${q}`, { headers: { cookie: "token=good", "accept-encoding": "gzip" } }); return { json: await r.json(), cache: r.headers.get("cache-control") }; };
    // no link goes through the front door: the web UI's answer is passed on as it is
    assert.deepEqual((await access()).json.tailscale, { state: "running", dns_name: "box.ts.net", serving_url: null, serve_command: "tailscale serve --bg --https=8443 http://127.0.0.1:7317", serve_url: "https://box.ts.net:8443" });
    // its link goes through the front door: the web UI finds none that points at its own port and would offer the
    // command for another; the answer names the link it has, and offers none
    linked = "https://box.ts.net";
    const told = await access();
    assert.deepEqual(told.json, { port: 7317, tailscale: { state: "running", dns_name: "box.ts.net", serving_url: "https://box.ts.net", serve_command: null, serve_url: null } }); assert.equal(told.cache, "no-store");
    // a link the web UI finds itself, and Tailscale not running, are its own to say
    assert.equal((await access("?has")).json.tailscale.serving_url, "https://box.ts.net:8443"); assert.equal((await access("?stopped")).json.tailscale.state, "stopped"); assert.equal((await access("?stopped")).json.tailscale.serving_url, null);
    assert.equal(withLink("not json", linked), null); assert.equal(withLink("{}", linked), null);
  } finally { d.close(); }
});
