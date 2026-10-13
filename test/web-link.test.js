// The one setup step of the board in the herdr web UI: finding the web UI, pointing its shared link at the front
// door after a yes, pointing it back, and the terminal board asking once (Tailscale is a stand-in here)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world } from "./helpers.js";
import { open } from "./board-helpers.js";
import * as S from "../src/store.js";
import * as X from "../src/extras.js";
import * as L from "../src/webui/link.js";
import * as W from "../src/webui/command.js";
import { addressFrom, webUi } from "../src/webui/find.js";
import http from "node:http";
import { doorFile, doorInfo, runDoor } from "../src/webui/keep.js";

const HOST = "box.tail1.ts.net";
// One board for the file: every test starts from nothing written down about the web UI.
let w;
test.before(async () => { w = await world(); });
test.after(() => w.cleanup());
const fresh = () => X.note({ webUi: "", webUiLinks: [] });
// A stand-in for `tailscale serve`: its status as JSON, and `--bg --https=<port> <target>` changing where a port goes.
function tailnet(sites, funnel = []) {
  const web = Object.fromEntries(Object.entries(sites).map(([https, target]) => [`${HOST}:${https}`, { Handlers: { "/": { Proxy: target } } }]));
  const ran = [];
  const run = async (args) => {
    ran.push(args.join(" "));
    if (args.join(" ") === "serve status --json") return JSON.stringify({ TCP: Object.fromEntries(Object.keys(web).map((k) => [k.split(":").pop(), { HTTPS: true }])), Web: web, AllowFunnel: Object.fromEntries(funnel.map((p) => [`${HOST}:${p}`, true])) });
    const https = /^--https=(\d+)$/.exec(args[2] || "");
    if (args[0] === "serve" && args[1] === "--bg" && https) { web[`${HOST}:${https[1]}`] = { Handlers: { "/": { Proxy: args[3] } } }; return ""; }
    throw new Error(`unexpected: tailscale ${args.join(" ")}`);
  };
  return { run, ran, at: (https) => web[`${HOST}:${https}`].Handlers["/"].Proxy, changes: () => ran.filter((r) => r.startsWith("serve --bg")) };
}

const WEB = { host: "127.0.0.1", port: 7317 }, DOOR = { port: 7327 };

test("the web UI's private link goes through the front door after a yes, follows it, and goes back to where the web UI is: nothing else is touched", async () => {
  try {
    fresh();
    const ts = tailnet({ 443: "http://127.0.0.1:7317", 8443: "http://127.0.0.1:3000", 10000: "http://localhost:7317/", 9000: "http://127.0.0.1:7317/sub", 7000: "http://127.0.0.1:7317" }, [7000]);
    // what there is: two private links of the web UI, one open to the internet, and others that are not its
    let seen = await L.look({ webUi: WEB, door: DOOR, run: ts.run });
    assert.deepEqual([seen.direct.map((e) => e.url), seen.open.map((e) => e.https), seen.ours], [[`https://${HOST}`, `https://${HOST}:10000`], [7000], []]);
    assert.deepEqual(ts.changes(), []); // looking changes nothing
    // yes: both private links point at the front door, and where each was and is now is written down
    const urls = await L.link({ webUi: WEB, door: DOOR, run: ts.run });
    assert.deepEqual(urls, [`https://${HOST}`, `https://${HOST}:10000`]);
    assert.deepEqual([ts.at(443), ts.at(10000)], ["http://127.0.0.1:7327", "http://127.0.0.1:7327"]);
    assert.deepEqual([ts.at(8443), ts.at(9000), ts.at(7000)], ["http://127.0.0.1:3000", "http://127.0.0.1:7317/sub", "http://127.0.0.1:7317"]); // another app's, a sub-path, and the one on the internet: left alone
    assert.deepEqual([X.extras().webUi, X.extras().webUiLinks], ["yes", [{ https: 443, host: HOST, was: 7317, now: "http://127.0.0.1:7327" }, { https: 10000, host: HOST, was: 7317, now: "http://127.0.0.1:7327" }]]);
    assert.ok(ts.changes().every((c) => /^serve --bg --https=\d+ http:\/\/127\.0\.0\.1:7327$/.test(c)) && !ts.ran.some((r) => /funnel/.test(r)));
    // again changes nothing. A link made for the web UI later (its Phone setup makes one when it finds none) is
    // not taken by itself: only a yes takes a link, so the two never pull one back and forth
    let n = ts.changes().length; await L.link({ webUi: WEB, door: DOOR, run: ts.run }); assert.equal(ts.changes().length, n);
    await ts.run(["serve", "--bg", "--https=10001", "http://127.0.0.1:7317"]); n = ts.changes().length;
    await L.follow({ door: DOOR, webUi: WEB, run: ts.run }); assert.equal(ts.changes().length, n); assert.equal(ts.at(10001), "http://127.0.0.1:7317"); // what the front door does by itself
    seen = await L.look({ webUi: WEB, door: DOOR, run: ts.run }); assert.deepEqual([seen.ours.map((e) => e.https), seen.direct.map((e) => e.https)], [[443, 10000], [10001]]);
    // the front door could not have its port again: its links go with it, and only its links
    const DOOR2 = { port: 7400 };
    await L.follow({ door: DOOR2, webUi: WEB, run: ts.run });
    assert.deepEqual([ts.at(443), ts.at(10000), ts.at(10001), ts.at(8443)], ["http://127.0.0.1:7400", "http://127.0.0.1:7400", "http://127.0.0.1:7317", "http://127.0.0.1:3000"]);
    n = ts.changes().length; await L.follow({ door: DOOR2, webUi: WEB, run: ts.run }); assert.equal(ts.changes().length, n);
    // the web UI took another port meanwhile: the way back is to where it is now, never to the port it left
    const MOVED = { host: "127.0.0.1", port: 17317 };
    await L.follow({ door: DOOR2, webUi: MOVED, run: ts.run }); assert.deepEqual(X.extras().webUiLinks.map((r) => r.was), [17317, 17317]);
    // back: each link points at the web UI again; one somebody pointed elsewhere meanwhile is not the board's to put back
    await ts.run(["serve", "--bg", "--https=10000", "http://127.0.0.1:5555"]);
    assert.equal(await L.unlink({ door: DOOR2, webUi: MOVED, run: ts.run }), 1);
    assert.deepEqual([ts.at(443), ts.at(10000)], ["http://127.0.0.1:17317", "http://127.0.0.1:5555"]); assert.deepEqual(X.extras().webUiLinks, []);
    assert.equal(await L.unlink({ door: DOOR2, webUi: MOVED, run: ts.run }), 0);
    // the same when the move is only seen by a later yes, and the web UI cannot be found at the time of going back:
    // linked at 7317, the web UI then at 17317, back goes to 17317
    const t2 = tailnet({ 443: "http://127.0.0.1:7317" });
    await L.link({ webUi: WEB, door: DOOR, run: t2.run }); await L.link({ webUi: MOVED, door: DOOR, run: t2.run });
    assert.equal(X.extras().webUiLinks[0].was, 17317);
    assert.equal(await L.unlink({ door: DOOR, run: t2.run }), 1); assert.equal(t2.at(443), "http://127.0.0.1:17317");
    // a link written down by a version that did not keep where it pointed is followed from where the front door was
    const t3 = tailnet({ 443: "http://127.0.0.1:7327", 444: "http://127.0.0.1:7327" });
    X.note({ webUiLinks: [{ https: 443, host: HOST, was: 7317 }] }); await L.follow({ door: DOOR2, was: DOOR, webUi: WEB, run: t3.run });
    assert.deepEqual([t3.at(443), t3.at(444)], ["http://127.0.0.1:7400", "http://127.0.0.1:7327"]);
    // Tailscale that does not answer is not "no links": what was written down is kept, and a link is not called put back
    const dead = async () => { throw new Error("no tailscale"); };
    assert.deepEqual(await L.entries(dead), []);
    X.note({ webUiLinks: [{ https: 443, host: HOST, was: 7317 }] });
    assert.deepEqual(await L.link({ webUi: WEB, door: DOOR, run: dead }), []); assert.equal(X.extras().webUiLinks.length, 1);
    await assert.rejects(L.unlink({ door: DOOR, run: dead }), /Tailscale did not answer/); assert.equal(X.extras().webUiLinks.length, 1);
  } finally { fresh(); }
});

test("the web UI is found from its own settings; the command says how things stand, and remove-extras takes the link out", async () => {
  try {
    fresh();
    // where it listens: its PORT, else the port a start of it settled on, else its default; `.env` wins over `env`
    const dir = path.join(w.base, "webui-config"), state = path.join(w.base, "webui-state"); fs.mkdirSync(dir); fs.mkdirSync(state);
    const env = { HERDR_WEB_STATE_DIR: state };
    assert.deepEqual([addressFrom(dir, env).host, addressFrom(dir, env).port], ["127.0.0.1", 7317]);
    fs.writeFileSync(path.join(state, "plugin-port"), "17317\n"); assert.equal(addressFrom(dir, env).port, 17317);
    fs.writeFileSync(path.join(dir, "env"), "# mine\nPORT=8000\nHERDR_WEB_TOKEN=secret\n"); assert.equal(addressFrom(dir, env).port, 8000);
    // which herdr it shows, as the web UI's own start works it out: the socket of the session that started it (herdr
    // hands every plugin HERDR_SOCKET_PATH) comes first, also when its settings name another with HERDR_SOCKET; the
    // settings' socket counts only where no session's is given
    const named = { ...env, HERDR_SOCKET_PATH: "/tmp/named-session/herdr.sock" };
    assert.equal(addressFrom(dir, named).socket, "/tmp/named-session/herdr.sock"); assert.equal(addressFrom(dir, env).socket, "");
    fs.writeFileSync(path.join(dir, ".env"), 'PORT="8100"\nHERDR_SOCKET=/tmp/other.sock\n');
    assert.deepEqual([addressFrom(dir, named).port, addressFrom(dir, named).socket, addressFrom(dir, env).socket], [8100, "/tmp/named-session/herdr.sock", "/tmp/other.sock"]);
    assert.equal(addressFrom(dir, { ...env, HERDR_SOCKET: "/tmp/env.sock" }).socket, "/tmp/other.sock"); // its settings are laid over its environment
    fs.appendFileSync(path.join(dir, ".env"), "HERDR_SOCKET_PATH=/tmp/set.sock\n"); assert.equal(addressFrom(dir, named).socket, "/tmp/set.sock");
    fs.writeFileSync(path.join(dir, ".env"), 'PORT="8100"\nHERDR_SOCKET=/tmp/other.sock\n');
    // not installed: nothing to stand in front of, and the command says so
    assert.equal(webUi({ fresh: true }), null); assert.equal(await W.offer(), null);
    assert.match((await W.main([])).msg, /^Web UI: not found: the plugin devswha\.herdr-web-ui is not installed in herdr\nFront door: not running$/);
    assert.match((await W.linkNow()).msg, /not installed/);
    // installed in herdr: found from herdr's list of plugins and that plugin's own config folder; turned off there, it is not
    const real = globalThis.__swHerdr.run;
    let enabled = true;
    globalThis.__swHerdr.run = (args, e) => (args[0] !== "plugin" ? real(args, e) : { status: 0, stderr: "", stdout: args[1] === "list" ? JSON.stringify({ result: { plugins: [{ plugin_id: "other" }, { plugin_id: "devswha.herdr-web-ui", enabled, version: "0.4.8", plugin_root: "/p" }] } }) : `${dir}\n` });
    const savedEnv = process.env.HERDR_WEB_STATE_DIR; process.env.HERDR_WEB_STATE_DIR = state;
    assert.deepEqual(webUi({ fresh: true }), { host: "127.0.0.1", port: 8100, socket: w.socket, root: "/p", version: "0.4.8" });
    assert.match((await W.main([])).msg, /^Web UI: found at http:\/\/127\.0\.0\.1:8100 \(herdr-web-ui 0\.4\.8\)\nFront door: not running/);
    enabled = false; assert.equal(webUi({ fresh: true }), null);
    globalThis.__swHerdr.run = real; if (savedEnv === undefined) delete process.env.HERDR_WEB_STATE_DIR; else process.env.HERDR_WEB_STATE_DIR = savedEnv;
    // installed (named by hand here), the front door up, a link that goes straight to the web UI: that is what is asked about
    process.env.HERDR_SUPERWORK_WEBUI = "7317";
    S.writeJson(doorFile(), S.marker({ port: 7327 }));
    const ts = tailnet({ 443: "http://127.0.0.1:7317" });
    // (a web UI with no link of its own yet: said, with where the Board is on this machine; a yes all the same)
    assert.match((await W.linkNow({ run: tailnet({}).run })).msg, /has no private link yet.*http:\/\/127\.0\.0\.1:7327\//); X.note({ webUi: "" });
    const offer = await W.offer({ run: ts.run }); assert.deepEqual(offer.links.direct.map((e) => e.url), [`https://${HOST}`]);
    const linked = await W.linkNow({ run: ts.run }); assert.equal(linked.msg, `The Board is in the web UI at https://${HOST}. \`herdr-superwork web-ui unlink\` points it back.`);
    assert.equal(await W.offer({ run: ts.run }), null); // answered: not asked again
    // off by the setting: there is no web UI to stand in front of
    S.setConfig("webUi", "off"); assert.equal(webUi({ fresh: true }), null); S.setConfig("webUi", "auto"); assert.equal(webUi({ fresh: true }).port, 7317);
    // remove-extras: the link goes back, and the front door stays away until it is asked for again
    const left = await W.leave({ run: ts.run }); assert.equal(left.n, 1); assert.equal(ts.at(443), "http://127.0.0.1:7317");
    assert.equal(X.extras().webUi, "removed"); assert.equal(webUi({ fresh: true }), null); assert.match((await W.main([])).msg, /taken out with remove-extras/);
    await W.linkNow({ run: ts.run }); assert.equal(X.extras().webUi, "yes"); assert.equal(ts.at(443), "http://127.0.0.1:7327");
  } finally { delete process.env.HERDR_SUPERWORK_WEBUI; fresh(); }
});

test("the terminal board asks once whether the web UI's link may go through the front door: yes does it, no is for good, later asks next time", async () => {
  try {
    const did = [];
    const st = { links: { direct: [{ url: `https://${HOST}` }] } };
    const stub = (offer) => ({ offer: async () => offer, linkNow: async () => { did.push("link"); return { ok: true, msg: "The Board is in the web UI." }; }, decline: () => did.push("no") });
    const tick = () => new Promise((r) => setImmediate(r));
    delete process.env.HERDR_SUPERWORK_INLINE; // the question is the open board's own, as the first run's is
    // nothing to ask about: no question
    let s = open(w, { ctx: { webUi: stub(null), offers: () => ({ asked: true }) } }); s.v.askWebUi(); await tick(); assert.equal(s.v.ask, null);
    // a link that goes straight to the web UI: asked, with what it means; later puts it away for this board
    s = open(w, { ctx: { webUi: stub(st), offers: () => ({ asked: true }) } }); s.v.askWebUi(); await tick();
    assert.equal(s.v.ask.q, "Show this board in the herdr web UI?"); assert.match(s.v.ask.detail, new RegExp(`The web UI's link \\(https://${HOST}\\) then goes through a small front door`));
    assert.match(s.text(), /y = yes · n = no · esc = later/);
    s.press("esc"); assert.equal(s.v.ask, null); s.v.askWebUi(); await tick(); assert.equal(s.v.ask, null); assert.deepEqual(did, []);
    // no: written down, never asked again; yes: done, and the board says where the Board is
    s = open(w, { ctx: { webUi: stub(st), offers: () => ({ asked: true }) } }); s.v.askWebUi(); await tick(); s.press("n"); assert.deepEqual(did, ["no"]); assert.match(s.text(), /Left as it is/);
    s = open(w, { ctx: { webUi: stub(st), offers: () => ({ asked: true }) } }); s.v.askWebUi(); await tick(); s.press("y"); await tick(); assert.deepEqual(did, ["no", "link"]); assert.match(s.text(), /The Board is in the web UI\./);
  } finally { process.env.HERDR_SUPERWORK_INLINE = "1"; }
});

test("the page server's front door: up while there is a web UI, on this machine only, its bookkeeping in the data folder, and closed cleanly", async () => {
  // a stand-in web UI, named by hand; the front door runs in this process, as it does in the page server's
  const up = http.createServer((req, res) => { if (req.url.startsWith("/api/health")) return res.end('{"ok":true,"auth":{"required":true,"authenticated":false}}'); res.writeHead(200, { "content-type": "text/html" }); res.end("<html><body>web ui</body></html>"); });
  await new Promise((r) => up.listen(0, "127.0.0.1", r));
  const env = { HERDR_SUPERWORK_INLINE: process.env.HERDR_SUPERWORK_INLINE, HERDR_SUPERWORK_NO_SERVER: process.env.HERDR_SUPERWORK_NO_SERVER };
  delete process.env.HERDR_SUPERWORK_INLINE; delete process.env.HERDR_SUPERWORK_NO_SERVER; process.env.HERDR_SUPERWORK_WEBUI = String(up.address().port);
  let door;
  try {
    fresh(); fs.rmSync(doorFile(), { force: true });
    const ts = tailnet({});
    door = runDoor({ every: 3600000, run: ts.run });
    for (let n = 0; n < 200 && !door.address(); n++) await new Promise((r) => setImmediate(r));
    const at = door.address(), file = S.readJson(doorFile());
    assert.equal(at.address, "127.0.0.1"); // this machine only
    assert.deepEqual([file.pid, file.port, file.to], [process.pid, at.port, { host: "127.0.0.1", port: up.address().port }]); assert.equal(doorInfo().port, at.port);
    const page = await fetch(`http://127.0.0.1:${at.port}/`, { headers: { connection: "close" } });
    assert.equal(await page.text(), '<html><body>web ui<script type="module" src="/superwork/page/start.js"></script></body></html>');
    assert.equal((await fetch(`http://127.0.0.1:${at.port}/superwork/api/board`, { headers: { connection: "close" } })).status, 401);
    // a link that was given to it and still points at it: the web UI's Phone setup is told that link, and turning
    // the board in the web UI off points it back before the front door closes
    await ts.run(["serve", "--bg", "--https=443", `http://127.0.0.1:${up.address().port}`]); await L.link({ webUi: { port: up.address().port }, door: { port: at.port }, run: ts.run });
    assert.equal(ts.at(443), `http://127.0.0.1:${at.port}`);
    // the board in the web UI is turned off: the front door closes by itself, and says so in its bookkeeping
    S.setConfig("webUi", "off"); await door.tick();
    assert.equal(door.address(), null); assert.deepEqual(S.readJson(doorFile()), {}); assert.equal(doorInfo(), null); assert.equal(ts.at(443), `http://127.0.0.1:${up.address().port}`);
    // on again: it is back on the port it had, so a link that points at it still does
    S.setConfig("webUi", "auto"); await door.tick(); assert.equal(door.address().port, at.port);
    await door.stop(); assert.equal(door.address(), null); assert.deepEqual(S.readJson(doorFile()), {});
  } finally { try { await door?.stop(); } catch {} delete process.env.HERDR_SUPERWORK_WEBUI; Object.assign(process.env, env); up.close(); up.closeAllConnections(); }
});
