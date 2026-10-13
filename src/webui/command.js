// `herdr-superwork web-ui`: how the board in the herdr web UI stands, and the one setup step by hand.
//   web-ui           where the web UI is, whether the front door is up, and which links go through it
//   web-ui link      point the web UI's shared link at the front door (the yes the board asks for)
//   web-ui unlink    point it back; the board does not ask again (`web-ui link` does it later)
// `remove-extras` runs `leave`: the link goes back and the front door stops.
import * as S from "../store.js";
import * as X from "../extras.js";
import { serverInfo } from "../review-page.js";
import { webUi } from "./find.js";
import { doorFile, doorInfo, ensureDoor } from "./keep.js";
import * as L from "./link.js";

// What there is, in one look: the web UI, the front door, and the web UI's links.
export async function state({ run } = {}) {
  const to = webUi({ fresh: true }), door = doorInfo();
  const links = to ? await L.look({ webUi: to, door, ...(run ? { run } : {}) }) : { direct: [], open: [], ours: [] };
  return { webUi: to, door, links, answer: X.extras().webUi || "" };
}
// What the board asks about once: a private link of the web UI that does not go through the front door yet.
export async function offer({ run } = {}) {
  if (X.extras().webUi) return null;
  const st = await state({ run });
  return st.webUi && st.door && st.links.direct.length ? st : null;
}
// No: the link is left alone, and the board does not ask again.
export const decline = () => X.note({ webUi: "no" });
export async function linkNow({ run } = {}) {
  if (X.extras().webUi === "removed") X.note({ webUi: "" }); // asked for again
  const to = webUi({ fresh: true });
  if (!to) return { ok: false, msg: "The herdr web UI plugin is not installed (or `board.webUi` is `none`), so there is nothing to show the board in." };
  ensureDoor();
  const door = doorInfo();
  if (!door) return { ok: false, msg: "The front door is not up yet. Try again in a few seconds." };
  const urls = await L.link({ webUi: to, door, ...(run ? { run } : {}) });
  return { ok: true, urls, msg: urls.length ? `The Board is in the web UI at ${urls.join(", ")}. \`herdr-superwork web-ui unlink\` points it back.` : `The web UI has no private link yet. Make one with its own Phone setup; it then goes through the front door by itself. On this machine the Board is at ${L.addressOf(door)}/.` };
}
export async function unlinkNow({ run, answer = "no" } = {}) {
  const d = S.readJson(doorFile()) || {};
  let to = null;
  try { to = webUi({ fresh: true }); } catch {}
  X.note({ webUi: answer }); // first: whatever comes of the link, the front door must not take it again
  const n = await L.unlink({ door: d.port ? { port: d.port } : null, webUi: to || (d.to?.port ? d.to : null), ...(run ? { run } : {}) });
  return { ok: true, n, msg: n ? `The web UI's link points at the web UI again (${n} link${n === 1 ? "" : "s"}).` : "No link went through the front door." };
}
// Everything taken out: the link goes back, and the page server (the front door with it) stops. It is started
// again on demand, for evidence pages, and opens no front door while the answer is "removed".
export async function leave({ run } = {}) {
  const out = await unlinkNow({ run, answer: "removed" });
  const server = serverInfo();
  if (server) { try { process.kill(server.pid, "SIGTERM"); } catch {} }
  return out;
}
export async function main([what], { json = false } = {}) {
  if (what === "link") return linkNow();
  if (what === "unlink") return unlinkNow();
  if (what) return { ok: false, msg: "Usage: herdr-superwork web-ui [link|unlink]" };
  const st = await state();
  if (json) return { ok: true, ...st };
  const lines = [];
  lines.push(st.webUi ? `Web UI: found at http://${st.webUi.host}:${st.webUi.port}${st.webUi.version ? ` (herdr-web-ui ${st.webUi.version})` : ""}` : `Web UI: not found${S.setting("board.webUi") === "none" ? " (board.webUi is none)" : X.extras().webUi === "removed" ? " (taken out with remove-extras; `web-ui link` brings it back)" : ": the plugin devswha.herdr-web-ui is not installed in herdr"}`);
  lines.push(st.door ? `Front door: up at ${L.addressOf(st.door)}/ (this machine only)` : "Front door: not running");
  for (const e of st.links.ours) lines.push(`Link: ${e.url} goes through the front door: the Board is in the web UI there`);
  for (const e of st.links.direct) lines.push(`Link: ${e.url} goes straight to the web UI: no Board there (\`herdr-superwork web-ui link\`)`);
  for (const e of st.links.open) lines.push(`Link: ${e.url} is open to the internet (Funnel): the board never goes there`);
  if (st.webUi && !st.links.ours.length && !st.links.direct.length) lines.push("Link: the web UI has no private link yet (its own Settings → Phone makes one)");
  return { ok: true, msg: lines.join("\n") };
}
