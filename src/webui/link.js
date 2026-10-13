// The one setup step: the web UI's shared link. The web UI does not share itself; its Phone setup shows the command
// (`tailscale serve --bg --https=<port> http://127.0.0.1:<its port>`) and then recognises its link by where that
// `tailscale serve` entry points: at its own port (its server/tailscale.ts, checked on 0.4.8). So the Board shows at
// that same link once the entry points at the front door instead, which passes everything on to the web UI.
// This file finds such entries, points them at the front door after a yes (`link`), and points them back (`unlink`):
// what it changed is written down (extras.json), and only an entry that still points at the front door is put back,
// to where the web UI listens now. Only a yes takes a link: one made for the web UI later is never taken by itself,
// so the two never pull one link back and forth. (The web UI no longer finds a link that points at the front door;
// phone.js tells its Phone setup that the link is still there.)
// Tailscale proxies to 127.0.0.1 only (1.102: another loopback address is refused as "unknown proxy destination").
// Private only: an entry that is open to the internet (Funnel) is never touched, and nothing here ever starts one.
import { execFile } from "node:child_process";
import * as X from "../extras.js";

const LOOPBACK = ["127.0.0.1", "localhost"];
const tailscale = (args) => new Promise((done, fail) => execFile("tailscale", args, { encoding: "utf8", timeout: 20000 }, (e, out) => (e ? fail(e) : done(out))));
const targetOf = (target) => { try { const u = new URL(target); return LOOPBACK.includes(u.hostname) && (u.pathname === "" || u.pathname === "/") ? { port: Number(u.port || (u.protocol === "https:" ? 443 : 80)) } : null; } catch { return null; } };
const urlOf = (host, port) => `https://${host}${port === 443 ? "" : `:${port}`}`;
// A port on this machine as a link's target.
export const addressOf = ({ port }) => `http://127.0.0.1:${port}`;
const same = (a, b) => !!a && !!b && a.port === b.port;

// Every HTTPS entry of `tailscale serve` whose root goes to a port on this machine: [{ host, https, to, funnel, url }].
// null: Tailscale did not say (not installed, not running, no answer), which is not the same as "there are none".
async function read(run) {
  let status;
  try { status = JSON.parse((await run(["serve", "status", "--json"])) || "{}") || {}; } catch { return null; }
  const out = [];
  for (const [hostPort, site] of Object.entries(status.Web || {})) {
    const at = hostPort.lastIndexOf(":"), host = hostPort.slice(0, at), https = Number(hostPort.slice(at + 1));
    if (!status.TCP?.[String(https)]?.HTTPS) continue;
    const to = targetOf(site?.Handlers?.["/"]?.Proxy);
    if (to) out.push({ host, https, to, funnel: !!status.AllowFunnel?.[hostPort], url: urlOf(host, https) });
  }
  return out;
}
export const entries = async (run = tailscale) => (await read(run)) || [];
const point = (run, https, to) => run(["serve", "--bg", `--https=${https}`, addressOf(to)]);
const recorded = () => (Array.isArray(X.extras().webUiLinks) ? X.extras().webUiLinks : []);
// Which entries are the front door's, and which go straight to the web UI. `webUi` and `door` are { host, port }.
const sort = (all, webUi, door) => {
  const ours = all.filter((e) => same(e.to, door));
  const straight = all.filter((e) => !same(e.to, door) && e.to.port === webUi.port);
  return { ours, direct: straight.filter((e) => !e.funnel), open: straight.filter((e) => e.funnel) };
};

// What there is to do: the web UI's links that do not go through the front door yet, and the ones that do.
export async function look({ webUi, door, run = tailscale }) {
  return sort(await entries(run), webUi, door || null);
}
// Points each of the web UI's private links at the front door, and writes down where the web UI is. Asked for
// before: the caller has the yes. Returns the links it now goes through.
export async function link({ webUi, door, run = tailscale }) {
  if (!webUi?.port || !door?.port) return [];
  const all = await read(run);
  if (!all) return []; // Tailscale did not say: what was written down stays as it is
  const { ours, direct } = sort(all, webUi, door);
  // Where each goes back to is where the web UI listens now, not where it did when the link was first taken; where
  // each points now is written down too, so it can be told later that a link is still the front door's.
  const rec = (https, host) => ({ https, host, was: webUi.port, now: addressOf(door) });
  const kept = recorded().filter((r) => ours.some((e) => e.https === r.https)).map((r) => rec(r.https, r.host));
  for (const e of direct) {
    await point(run, e.https, door);
    if (!kept.some((r) => r.https === e.https)) kept.push(rec(e.https, e.host));
  }
  X.note({ webUi: "yes", webUiLinks: kept });
  return [...ours, ...direct].map((e) => e.url);
}
// The front door moved (it could not have the port it had): each link that still points at where the front door was goes with it, and where it goes back to is where
// the web UI is now. `was`: where the front door was, for a link written down before that was kept with it.
export async function follow({ door, was = null, webUi, run = tailscale }) {
  const mine = recorded();
  if (!mine.length || !door?.port) return;
  const all = await read(run);
  if (!all) return;
  const next = [];
  for (const r of mine) {
    const e = all.find((x) => x.https === r.https), old = r.now || (was ? addressOf(was) : "");
    if (e && !same(e.to, door) && old && addressOf(e.to) === old) await point(run, r.https, door);
    next.push({ ...r, ...(webUi?.port ? { was: webUi.port } : {}), now: e && !same(e.to, door) && !(old && addressOf(e.to) === old) ? r.now : addressOf(door) });
  }
  X.note({ webUiLinks: next });
}
// Puts every link back at the web UI, where it still points at the front door: at where the web UI listens now
// (`webUi`), else where it was when last seen. Returns how many.
export async function unlink({ door, webUi, run = tailscale }) {
  const mine = recorded();
  if (!mine.length) return 0;
  const all = await read(run);
  if (!all) throw new Error("Tailscale did not answer, so the web UI's link was left as it is. Try again: herdr-superwork web-ui unlink");
  let n = 0;
  for (const r of mine) {
    const e = all.find((x) => x.https === r.https);
    if (e && same(e.to, door)) { await point(run, r.https, { port: webUi?.port || r.was }); n++; }
  }
  X.note({ webUiLinks: [] });
  return n;
}
