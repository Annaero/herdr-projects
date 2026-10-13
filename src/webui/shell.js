// The one thing the front door changes in what the web UI sends: its page (the HTML shell) gets one line more, a
// script of ours that adds the Board to its menu. Everything else in the page, and every header that guards it (its
// Content-Security-Policy allows scripts from its own address only, which is where ours comes from), stays as sent.
// A page that cannot be read, is not the shell, or arrives compressed is passed on as it is.
import { without } from "./proxy.js";

export const BASE = "/superwork";
export const TAG = `<script type="module" src="${BASE}/page/start.js"></script>`;
const NOT_PAGES = ["/api/", "/assets/", "/icons/", `${BASE}/`];
const MAX = 2 << 20;

// Could this request be answered with the shell? The web UI sends it for every address that is not a file of its own.
export function mayBeShell(req) {
  if (req.method !== "GET") return false;
  const pathname = String(req.url).split("?")[0];
  if (pathname === "/ws" || NOT_PAGES.some((p) => pathname.startsWith(p))) return false;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !last.includes(".") || last.endsWith(".html");
}
// The request for it, asking for no compression: the page is read here, and is small.
export const shellHeaders = (req) => without(req.rawHeaders.slice(), "accept-encoding");

export function addScript(html) {
  if (html.includes(`${BASE}/page/start.js`)) return html;
  const at = html.lastIndexOf("</body>");
  return at < 0 ? null : html.slice(0, at) + TAG + html.slice(at);
}

// Takes the web UI's answer when it is the shell and sends it on with the script; false: not the shell, pipe it.
export function sendShell(answer, res) {
  const type = String(answer.headers["content-type"] || "");
  if (answer.statusCode !== 200 || !type.startsWith("text/html") || answer.headers["content-encoding"] || Number(answer.headers["content-length"] || 0) > MAX) return false;
  const parts = [];
  let size = 0, gave = false;
  // Whatever goes wrong from here, the visitor still gets the web UI's own page.
  const asSent = (more = false) => { if (gave) return; gave = true; try { res.writeHead(answer.statusCode, answer.statusMessage, answer.rawHeaders); res.write(Buffer.concat(parts)); if (more) answer.pipe(res); else res.end(); } catch { res.destroy(); } };
  answer.on("data", (d) => { if (gave) return; size += d.length; parts.push(d); if (size > MAX) asSent(true); }); // too long to be the shell: the rest goes straight on
  answer.on("error", () => res.destroy());
  answer.on("end", () => {
    if (gave) return;
    try {
      const html = addScript(Buffer.concat(parts).toString("utf8"));
      if (html === null) return asSent();
      const body = Buffer.from(html, "utf8");
      // Its length changed, and a saved copy must not be matched against the web UI's own.
      const headers = [...without(answer.rawHeaders.slice(), "content-length", "transfer-encoding", "etag", "last-modified", "accept-ranges"), "Content-Length", String(body.length)];
      gave = true;
      res.writeHead(200, answer.statusMessage, headers);
      res.end(body);
    } catch { asSent(); }
  });
  return true;
}
