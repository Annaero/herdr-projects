// Who may use the board through the front door: only someone the web UI itself lets in. The front door keeps no
// token, no cookie and no list of devices. For every call of ours it asks the web UI, with the caller's own headers
// exactly as they came, whether that caller is logged in (its token and device gate: server/auth.ts and
// server/access.ts there). Anything but a plain yes is a no: no answer, an answer it cannot read, a web UI that is down.
// A call that changes something must also come from the same address as the page and carry a header of our own, as
// the web UI asks of its own controls (its server/machine-security.ts).
import { ask, without } from "./proxy.js";

// The web UI's own question about a request: open to all, cheap (it does not ask herdr), and it says who asks.
export const WHO = "/api/health?scope=bridge";
export const OUR_HEADER = "x-herdr-superwork";

// The caller's headers for a question of ours to the web UI, without what belongs to the caller's own body: a
// question has none.
export const callerHeaders = (req) => without(req.rawHeaders.slice(), "content-length", "content-type", "transfer-encoding", "expect", "connection", "upgrade", "accept-encoding", "if-none-match", "if-modified-since", "range");

// { ok, role } — role "drive" may change things, "watch" (a device paired to look only) may not.
export async function who(req, to) {
  const answer = await ask(to, { path: WHO, headers: callerHeaders(req) });
  if (!answer || answer.status !== 200) return { ok: false, why: answer ? "refused" : "down" };
  let auth;
  try { auth = JSON.parse(answer.body).auth; } catch { return { ok: false, why: "unreadable" }; }
  if (!auth || auth.authenticated !== true) return { ok: false, why: String(auth?.reason || "not logged in") };
  return { ok: true, role: auth.role === "watch" ? "watch" : auth.role === "drive" ? "drive" : "watch", via: String(auth.via || "") };
}

// The same rule the web UI holds its own controls to: a browser says where a request comes from (Sec-Fetch-Site, and
// Origin on anything that changes state), and a page of another site can send neither our header nor a matching
// Origin without a preflight nobody answers.
export function sameOrigin(req) {
  const h = req.headers;
  const site = h["sec-fetch-site"];
  if (site && site !== "same-origin") return false;
  const origin = h.origin;
  if (!origin) return !!site; // no Origin: only a browser that said "same-origin" itself
  try { return new URL(origin).host === h.host; } catch { return false; }
}
// A call the page makes with POST. It must come from the board's own page, whatever it does; one that changes a
// task also needs someone who may drive. `who` has already said the caller is logged in.
export const CHANGES = ["send", "set"]; // what a watching device may not do
// What a watching device may do too: its own selection and filter, and a key that only shows or hides (the worker
// lets it press no other: worker.js).
export const LOOKS = ["press", "pick", "find"];
export function mayCall(req, person, call) {
  if (req.headers[OUR_HEADER] !== "1" || !sameOrigin(req)) return { ok: false, status: 403, msg: "Use the board's own controls." };
  if (CHANGES.includes(call) && person.role !== "drive") return { ok: false, status: 403, msg: "This device can only watch." };
  return { ok: true };
}
