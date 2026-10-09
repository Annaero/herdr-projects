import { truncateToWidth } from "@earendil-works/pi-tui";

const clean = (v) => String(v ?? "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
// Keep every distinct target; only exact duplicates are removed.
export function reviewArtifacts(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((a) => {
    if (!a || typeof a !== "object") return false;
    const key = a.link || a.url || a.file;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
// One row can be kept visible even when there is no room for a whole evidence section.
export function artifactLine(t, a, width) {
  const name = truncateToWidth(clean(a.caption || a.file || "Open evidence"), Math.max(1, width - 3), "…");
  const url = String(a.link || a.url || "");
  const linked = /^https?:\/\//.test(url) && !/[\x00-\x20\x7f]/.test(url);
  // Never clean a completed OSC link: that would strip its escape sequence and break the click target.
  return " " + t.fg("accent", "↗ ") + (linked ? `\x1b]8;;${url}\x1b\\${t.underline(name)}\x1b]8;;\x1b\\` : name);
}
// Spaced, scrollable evidence for full details. The link is also printed in full: a popup may not pass clicks on.
export function artifactLines(t, artifacts, width, heading) {
  const items = reviewArtifacts(artifacts);
  if (!items.length) return [];
  const w = Math.max(1, width - 3);
  const lines = ["", " " + t.fg("muted", truncateToWidth(heading || "Review evidence", Math.max(1, width - 1), "…"))];
  for (const [i, a] of items.entries()) {
    if (i) lines.push("");
    lines.push(artifactLine(t, a, width));
    if (a.detail) lines.push("   " + t.fg("dim", truncateToWidth(clean(a.detail), w, "…")));
    const url = String(a.link || a.url || "");
    if (url) lines.push("   " + t.fg("dim", truncateToWidth(clean(url), w, "…")));
  }
  lines.push("");
  return lines;
}
