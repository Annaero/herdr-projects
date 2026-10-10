// The evidence page. A review publishes only the evidence its reviewer selected, behind one small, portable page.
// One small detached web server (127.0.0.1 only, started on demand, restarted if gone) serves the pages; with
// serve = "tailscale" the same server is also shared privately on the tailnet (tailscale serve, never funnel).
// It is the only long-lived process the plugin owns.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import * as S from "./store.js";
import { pageTheme } from "./board/theme.js";


export const REVIEW_FILE = "review.html";
const text = (v) => String(v ?? "").replace(/[\x00-\x1f\x7f]/g, " ").trim();
const escape = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function webURL(value) {
  const raw = String(value ?? "");
  if (/[\x00-\x20\x7f]/.test(raw)) return "";
  try { const u = new URL(raw); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : ""; } catch { return ""; }
}

// No directory sweep: scratch files, duplicate captures and unlisted logs stay out of the presentation.
export function selectEvidence(list, dir) {
  const selected = [], seen = new Set();
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || typeof a !== "object") continue;
    const caption = text(a.caption).slice(0, 160), detail = text(a.detail).slice(0, 600);
    const url = webURL(a.url);
    let item;
    if (url) item = { url, caption: caption || "Try the work", detail };
    else if (typeof a.file === "string" && a.file === path.basename(a.file) && !/[\\/\x00-\x1f\x7f]/.test(a.file) && !a.file.startsWith(".") && a.file !== REVIEW_FILE) {
      try { if (fs.lstatSync(path.join(dir, a.file)).isFile()) item = { file: a.file, caption: caption || a.file, detail }; } catch {}
    }
    if (!item) continue;
    const key = item.url || item.file;
    if (seen.has(key)) continue;
    seen.add(key); selected.push(item);
  }
  return selected;
}

const listHTML = (items) => `<ul>${items.map((s) => `<li>${escape(s)}</li>`).join("")}</ul>`;
const paragraphs = (value) => String(value ?? "").trim().split(/\n\s*\n/).filter(Boolean).map((s) => `<p class="preserve">${escape(s)}</p>`).join("");
function evidenceHTML(a, i, dir) {
  const href = a.url || `./${encodeURIComponent(a.file)}`;
  const ext = path.extname(a.file || "").toLowerCase();
  let media = "", kind = a.url ? "Try it" : "Evidence";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) {
    kind = "Screenshot";
    media = `<a class="capture" href="${escape(href)}"><img src="${escape(href)}" alt="${escape(a.caption)}" loading="lazy"></a>`;
  } else if ([".mp4", ".webm"].includes(ext)) {
    kind = "Recording";
    media = `<video controls preload="metadata" aria-label="${escape(a.caption)}"><source src="${escape(href)}">Your browser cannot play this recording. Use the link below.</video>`;
  } else if ([".txt", ".log", ".md", ".json"].includes(ext)) {
    kind = "Test / command output";
    // A bounded, escaped peek; the complete selected file is still one click away.
    const fd = fs.openSync(path.join(dir, a.file), "r");
    let preview;
    try { const b = Buffer.alloc(6001); const n = fs.readSync(fd, b, 0, b.length, 0); preview = b.subarray(0, Math.min(n, 6000)).toString("utf8") + (n > 6000 ? "\n… Open the full file for the rest." : ""); } finally { fs.closeSync(fd); }
    media = `<details><summary>Read output</summary><pre tabindex="0" role="region" aria-label="${escape(a.caption)} output">${escape(preview)}</pre></details>`;
  }
  return `<article id="evidence-${i + 1}" class="evidence"><div class="eyebrow">${String(i + 1).padStart(2, "0")} · ${kind}</div><h3>${escape(a.caption)}</h3>${a.detail ? `<p>${escape(a.detail)}</p>` : ""}${media}<p class="file-link"><a href="${escape(href)}" aria-label="${escape(`${a.url ? "Open preview" : "Open full file"}: ${a.caption}`)}"${a.url ? ' target="_blank" rel="noopener noreferrer"' : ""}>${a.url ? "Open preview" : "Open full file"} <span aria-hidden="true">↗</span></a></p></article>`;
}

export function renderReviewPage({ id, round, title, description, summary, stat, head, pr, review, evidence, dir }) {
  const recommendation = review.recommend === true ? "Recommended" : review.recommend === false ? "Changes needed" : "No recommendation";
  const tone = review.recommend === false ? "warning" : review.recommend === true ? "success" : "";
  const checks = Array.isArray(review.checks) ? review.checks : [];
  const limitations = Array.isArray(review.limitations) ? review.limitations : [];
  const when = new Date(review.at).toISOString();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title || id)} — Review</title>
<style>
${pageTheme()}*{box-sizing:border-box}html{scroll-padding-top:6rem}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}a{color:var(--accent);text-underline-offset:.22em}a:hover{text-decoration-thickness:2px}a:focus-visible,summary:focus-visible,video:focus-visible{outline:3px solid var(--accent);outline-offset:5px}.skip{position:absolute;left:1rem;top:-6rem;z-index:2;padding:.6rem;background:var(--bg)}.skip:focus{top:1rem}.top{position:sticky;top:0;z-index:1;border-bottom:1px solid var(--line);background:var(--bg)}.top-inner{max-width:1100px;margin:auto;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}.brand{font-weight:600}.top nav{display:flex;gap:1.5rem}.top nav a{text-decoration:none;color:var(--muted);padding:.25rem 0}main{max-width:1100px;margin:auto;padding:3rem 2rem 4rem;isolation:isolate}h1,h2,h3{font-weight:600;line-height:1.25;text-wrap:balance}h1{font-size:clamp(1.8rem,4vw,2.7rem);letter-spacing:-.035em;max-width:26ch;margin:.75rem 0 1.2rem}h2{font-size:1.5rem;letter-spacing:-.02em;margin:0 0 1.25rem}h3{font-size:1.15rem;margin:.6rem 0 1rem}p{max-width:75ch;text-wrap:pretty}.eyebrow,.meta,.hint{color:var(--muted)}.meta{display:flex;gap:.5rem 1.2rem;flex-wrap:wrap}.meta code{font-size:.9em}.layout{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:3.5rem;margin-top:3rem}.content{min-width:0}section{padding:0 0 2.5rem;scroll-margin-top:1rem}section+section{padding-top:2.5rem;border-top:1px solid var(--line)}.preserve{white-space:pre-wrap}.verdict{padding:1.25rem;border:1px solid var(--line);border-radius:.6rem;align-self:start;background:var(--well)}.score{font-size:2.2rem;font-weight:600;font-variant-numeric:tabular-nums;margin:.4rem 0}.decision{font-weight:600}.decision.success{color:var(--ok)}.decision.warning{color:var(--bad)}.verdict p{margin:.6rem 0}.verdict a{display:inline-block;padding:.4rem 0}.evidence-list{display:grid;gap:1.5rem;margin-top:1.5rem}.evidence{border:1px solid var(--line);border-radius:.6rem;padding:1.5rem;min-width:0;scroll-margin-top:6rem}.evidence p{margin:.7rem 0}.capture{display:block}img,video{display:block;width:100%;max-height:460px;object-fit:contain;background:var(--well);border:1px solid var(--line);border-radius:.25rem}details{margin:1rem 0;background:var(--well);border-radius:.25rem;padding:.8rem 1rem}summary{cursor:pointer;color:var(--accent);padding:.25rem 0}pre{overflow:auto;max-height:24rem;font:14px/1.6 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.file-link{padding-top:.5rem}.evidence-nav{display:flex;flex-wrap:wrap;gap:.6rem 1.25rem;padding:0;list-style:none}.evidence-nav a{display:inline-block;padding:.25rem 0}li{margin:.5rem 0}.empty{color:var(--muted)}footer{border-top:1px solid var(--line);padding-top:1.5rem;color:var(--muted)}p,li,h1,h2,h3,a,code{overflow-wrap:anywhere}@media(max-width:760px){.top-inner{padding:.8rem 1.2rem;flex-wrap:wrap}.top nav{gap:1.3rem}main{padding:2rem 1.2rem 3rem}.layout{display:flex;flex-direction:column;gap:2rem;margin-top:2rem}.verdict{order:-1;width:100%}.evidence{padding:1.1rem}h1{font-size:1.9rem}}@media print{.top,.skip{display:none}.layout{display:block}.verdict{margin-bottom:2rem}details{display:block}section,.evidence{break-inside:avoid}}
</style></head><body><a class="skip" href="#overview">Skip to review content</a><header class="top"><div class="top-inner"><div class="brand">herdr-superwork <span class="hint">/ Review</span></div><nav aria-label="Review sections"><a href="#overview">Work</a><a href="#review">Review</a><a href="#evidence">Evidence</a></nav></div></header>
<main><div class="eyebrow">Review${round ? ` ${escape(round)}` : ""} · ${escape(id)}</div><h1>${escape(title || id)}</h1><div class="meta"><span><time datetime="${when}">${escape(when.replace("T", " · ").replace(/\.\d+Z$/, " UTC"))}</time></span>${head ? `<span>Commit <code>${escape(head.slice(0, 12))}</code></span>` : ""}${webURL(pr) ? `<a href="${escape(webURL(pr))}" target="_blank" rel="noopener noreferrer">Pull request ↗</a>` : ""}</div>
<div class="layout"><div class="content"><section id="overview"><h2>What changed</h2>${paragraphs(summary) || '<p class="empty">No work summary was supplied.</p>'}${stat ? `<details><summary>Change size</summary><pre tabindex="0" role="region" aria-label="Change size">${escape(stat)}</pre></details>` : ""}${description ? `<details><summary>Original request</summary>${paragraphs(description)}</details>` : ""}</section>
<section id="review"><h2>The review</h2>${paragraphs(review.text) || '<p class="empty">No review summary was supplied.</p>'}<h3>Findings</h3>${review.problems?.length ? listHTML(review.problems) : '<p class="empty">No problems reported by the reviewer.</p>'}<h3>What was checked</h3>${checks.length ? listHTML(checks) : '<p class="empty">The reviewer did not list individual checks. See the selected evidence below.</p>'}<h3>Limits &amp; unverified areas</h3>${limitations.length ? listHTML(limitations) : '<p class="empty">No limits were listed. This is not a claim of exhaustive coverage.</p>'}</section>
<section id="evidence"><h2>Selected evidence</h2><p class="hint">Only material chosen to help judge this work. Each item explains a result or gives you something to try; this is not a dump of every output.</p><ul class="evidence-nav" role="list">${evidence.map((a, i) => `<li><a href="#evidence-${i + 1}">${String(i + 1).padStart(2, "0")} · ${escape(a.caption)}</a></li>`).join("")}</ul><div class="evidence-list">${evidence.map((a, i) => evidenceHTML(a, i, dir)).join("")}</div></section></div>
<aside class="verdict" aria-label="Review verdict"><div class="eyebrow">Reviewer verdict${round ? ` · review ${escape(round)}` : ""}</div><div class="score">${escape(review.score)} <span class="hint">/ 5</span></div><p class="decision ${tone}">${recommendation}</p><p class="hint">The score and recommendation are the reviewer's judgement, not an approval.</p><a href="#review">Read findings ↓</a><br><a href="#evidence">See evidence ↓</a></aside></div><footer>Review of the work at the time shown above. Preview links may stop working when their servers stop. Approve or request changes from the work board.</footer></main></body></html>`;
}

// ---- publishing ------------------------------------------------------------------------------------------------------
const serveFile = () => path.join(S.dataDir(), "serve.json");
const procStart = (pid) => { try { const s = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); return s.slice(s.lastIndexOf(")") + 2).split(" ")[19]; } catch { return null; } };
const serverAlive = (info) => !!info?.pid && S.pidAlive(info.pid) && (!info.start || procStart(info.pid) === info.start);
export function ensureServer() {
  let info = S.readJson(serveFile()) || {};
  if (serverAlive(info) && info.port) return info;
  const child = spawn(process.execPath, [S.BIN, "serve"], { detached: true, stdio: "ignore", env: process.env, cwd: S.dataDir() });
  child.on("error", () => {});
  child.unref();
  for (let i = 0; i < 40; i++) { S.sleepSync(100); info = S.readJson(serveFile()) || {}; if (info.pid === child.pid && info.port) break; }
  return info;
}
const tailscale = (args) => execFileSync("tailscale", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 });
// Share the local server on the tailnet, on an https port nothing else uses. Existing shares are never replaced.
function ensureTailscale(info) {
  let status = {};
  try { status = JSON.parse(tailscale(["serve", "status", "--json"]) || "{}"); } catch {}
  const used = Object.keys(status.TCP || {}).map(Number);
  const host = JSON.parse(tailscale(["status", "--json"])).Self.DNSName.replace(/\.$/, "");
  if (info.ts && info.ts.target === info.port && used.includes(info.ts.port)) return `https://${host}:${info.ts.port}`;
  if (info.ts?.port && used.includes(info.ts.port)) { try { tailscale(["serve", `--https=${info.ts.port}`, "off"]); } catch {} } // ours, pointing at an old port
  let port = 8750;
  while (used.includes(port)) port++;
  tailscale(["serve", "--bg", `--https=${port}`, `http://127.0.0.1:${info.port}`]);
  S.writeJson(serveFile(), { ...(S.readJson(serveFile()) || {}), ts: { port, target: info.port, host } });
  return `https://${host}:${port}`;
}
// Where a task's saved artifacts are served from. Falls back to local when Tailscale is absent or sharing fails.
export function artifactBase(id, serve) {
  if (process.env.HERDR_SUPERWORK_NO_SERVER === "1") return "";
  const info = ensureServer();
  if (!info.port) return "";
  const local = `http://127.0.0.1:${info.port}`;
  let base = local;
  if (serve === "tailscale") { try { base = ensureTailscale(info); } catch { base = local; } }
  return `${base}/${id}`;
}
export async function publishReview({ enabled, dir, listed, context, review, task, serve, onFallback }) {
  // Tailscale asked for but not installed here: a local link instead, said on the task.
  if (serve === "tailscale" && spawnSync("sh", ["-c", "command -v tailscale"], { stdio: "ignore" }).status !== 0) { serve = "local"; try { onFallback?.("review link is local: tailscale is not installed here"); } catch {} }
  if (!enabled) return [];
  const evidence = selectEvidence(listed, dir);
  if (!evidence.length) return []; // Do not manufacture a page for tiny changes with no useful evidence.
  fs.writeFileSync(path.join(dir, REVIEW_FILE), renderReviewPage({ ...context, review, evidence, dir }));
  let root = "";
  try { root = artifactBase(task.id, serve); } catch {} // Link sharing stays with the board, not with reviewer-authored HTML.
  return [{ file: REVIEW_FILE, caption: "Open review", detail: "Work · verdict · selected evidence", kind: "review", link: root ? `${root}/${REVIEW_FILE}` : path.join(dir, REVIEW_FILE) }];
}

// ---- `herdr-superwork serve`: 127.0.0.1 only; serves nothing but artifacts folders ------------------------------------
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".json": "application/json", ".css": "text/css", ".js": "text/javascript", ".pdf": "application/pdf", ".log": "text/plain; charset=utf-8" };
export function serveMain() {
  const server = http.createServer((req, res) => {
    try {
      const parts = decodeURIComponent(new URL(req.url, "http://x").pathname).split("/").filter(Boolean);
      if (parts.length < 3 || parts.some((x) => x === ".." || x.startsWith("."))) { res.writeHead(404); return res.end("Not found"); }
      const base = S.artifactsDir(`${parts[0]}/${parts[1]}`);
      const file = path.join(base, ...parts.slice(2));
      if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      fs.createReadStream(file).pipe(res);
    } catch { res.writeHead(500); res.end("Error"); }
  });
  const prev = S.readJson(serveFile()) || {};
  const up = () => S.writeJson(serveFile(), { ...(S.readJson(serveFile()) || {}), pid: process.pid, start: procStart(process.pid), port: server.address().port });
  server.once("error", () => server.listen(0, "127.0.0.1", up)); // the old port is taken: any free one
  server.listen(prev.port || 0, "127.0.0.1", up);
  return new Promise(() => {}); // runs until the machine restarts; started again on demand
}
