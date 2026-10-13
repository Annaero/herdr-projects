// The one answer of the web UI that the front door corrects: how a phone can reach it (`GET /api/access`, what its
// Settings → Phone shows). The web UI finds its shared link by looking for a `tailscale serve` entry that points at
// its own port (its server/tailscale.ts). A link that goes through the front door points at the front door's port, so
// the web UI would say it has no link and offer the command for another one. The link is still its link: the answer
// is given the address it already has, and the offer of a second one is taken out. Everything else in the answer,
// and the answer itself whenever it cannot be read or already names a link, is passed on as it came.
import { without } from "./proxy.js";

export const isAccess = (req) => req.method === "GET" && String(req.url).split("?")[0] === "/api/access";
export const accessHeaders = (req) => without(req.rawHeaders.slice(), "accept-encoding");
// The answer with the link in it, or null when there is nothing to correct.
export function withLink(text, url) {
  if (!url) return null;
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  const t = j?.tailscale;
  if (!t || t.state !== "running" || t.serving_url) return null;
  return JSON.stringify({ ...j, tailscale: { ...t, serving_url: url, serve_command: null, serve_url: null } });
}
// Takes the web UI's answer and sends it on, corrected where there is something to correct; false: pipe it as it is.
export function sendAccess(answer, res, url) {
  if (!url || answer.statusCode !== 200 || !String(answer.headers["content-type"] || "").startsWith("application/json") || answer.headers["content-encoding"]) return false;
  const parts = [];
  let size = 0, gave = false;
  const asSent = (more = false) => { if (gave) return; gave = true; try { res.writeHead(answer.statusCode, answer.statusMessage, answer.rawHeaders); res.write(Buffer.concat(parts)); if (more) answer.pipe(res); else res.end(); } catch { res.destroy(); } };
  answer.on("data", (d) => { if (gave) return; size += d.length; parts.push(d); if (size > 65536) asSent(true); });
  answer.on("error", () => res.destroy());
  answer.on("end", () => {
    if (gave) return;
    try {
      const text = withLink(Buffer.concat(parts).toString("utf8"), url);
      if (text === null) return asSent();
      const body = Buffer.from(text, "utf8");
      gave = true;
      res.writeHead(200, answer.statusMessage, [...without(answer.rawHeaders.slice(), "content-length", "transfer-encoding", "etag"), "Content-Length", String(body.length)]);
      res.end(body);
    } catch { asSent(); }
  });
  return true;
}
