// Passing a request through to the web UI untouched: the same method, address and headers in, the same status,
// headers and bytes out, as they come (a stream stays a stream, a ranged or ready-compressed answer is not re-made),
// and a socket upgrade (`/ws`) as two pipes. Nothing is added, renamed or dropped on the way: the web UI decides who
// is let in from the very headers a proxy in front sends (docs/web-ui.md), so they must arrive as they were sent.
import http from "node:http";
import net from "node:net";

// One kept-open connection pool to the web UI: a page load is dozens of requests.
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

// The headers as they came, name by name in their own order and spelling (a flat [name, value, …] list).
const rawOf = (message) => message.rawHeaders.slice();
export const without = (raw, ...names) => { const out = []; for (let i = 0; i < raw.length; i += 2) if (!names.includes(raw[i].toLowerCase())) out.push(raw[i], raw[i + 1]); return out; };
const bad = (res, text) => { try { if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); res.end(text); } catch {} };
export const DOWN = "The herdr web UI is not answering right now. It is started again by herdr; reload in a moment.\n";

// One request, as it is. `headers`: other headers to send instead (the shell's request asks for no compression).
// `onResponse(up)`: take the answer instead of piping it; return false to have it piped as always.
export function pass(req, res, to, { headers, onResponse, onDown } = {}) {
  const up = http.request({ host: to.host, port: to.port, method: req.method, path: req.url, headers: headers || rawOf(req), agent, setHost: false }, (answer) => {
    try { if (onResponse && onResponse(answer) !== false) return; } catch {}
    res.writeHead(answer.statusCode, answer.statusMessage, rawOf(answer));
    res.flushHeaders();
    answer.pipe(res);
    answer.on("error", () => res.destroy());
  });
  up.on("error", () => { bad(res, DOWN); try { onDown?.(); } catch {} });
  // Whoever goes first takes the other with it: a closed tab ends the web UI's stream, and the other way round.
  res.on("close", () => { if (!res.writableFinished) up.destroy(); });
  req.on("aborted", () => up.destroy());
  req.pipe(up);
  return up;
}

// A socket upgrade: the request line and headers are written out again as they came, then bytes go both ways.
export function passUpgrade(req, socket, head, to) {
  const up = net.connect(to.port, to.host);
  const end = () => { try { socket.destroy(); } catch {} try { up.destroy(); } catch {} };
  up.on("error", end); socket.on("error", end);
  up.on("close", end); socket.on("close", end);
  up.on("connect", () => {
    const raw = rawOf(req);
    let text = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < raw.length; i += 2) text += `${raw[i]}: ${raw[i + 1]}\r\n`;
    up.write(text + "\r\n");
    if (head && head.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
}

// A small request of our own to the web UI, answered whole: { status, headers, body } or null when it does not answer.
export function ask(to, { method = "GET", path, headers = [], max = 1 << 20 }, ms = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const end = (v) => { if (!done) { done = true; resolve(v); } };
    const up = http.request({ host: to.host, port: to.port, method, path, headers, agent, setHost: false, timeout: ms }, (answer) => {
      const parts = [];
      let size = 0;
      answer.on("data", (d) => { size += d.length; if (size > max) { up.destroy(); return end(null); } parts.push(d); });
      answer.on("end", () => end({ status: answer.statusCode, headers: answer.headers, body: Buffer.concat(parts).toString("utf8") }));
      answer.on("error", () => end(null));
    });
    up.on("timeout", () => { up.destroy(); end(null); });
    up.on("error", () => end(null));
    up.end();
  });
}
