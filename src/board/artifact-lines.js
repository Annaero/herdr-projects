// The evidence a review brought: which files and links count, and the lines each gets in the task panel.
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

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
// One piece of evidence, as lines without a margin: its name behind an arrow, wrapped whole, every line of it the
// link. `whole` (the full screen) adds what it is and the link printed in full: a popup may not pass clicks on.
// Nothing is cut: a long name, note or address goes on under itself.
export function artifactRows(t, a, room, whole = false) {
  const lines = (text) => wrapTextWithAnsi(clean(text), Math.max(1, room - 2));
  const url = String(a.link || a.url || "");
  const linked = /^https?:\/\//.test(url) && !/[\x00-\x20\x7f]/.test(url);
  // Never clean a completed OSC link: that would strip its escape sequence and break the click target.
  const name = lines(a.caption || a.file || "Open evidence").map((l, n) => (n ? "  " : t.fg("accent", "↗ ")) + (linked ? `\x1b]8;;${url}\x1b\\${t.underline(l)}\x1b]8;;\x1b\\` : l));
  return [...name, ...(whole ? [...(a.detail ? lines(a.detail) : []), ...(url ? lines(url) : [])].map((l) => "  " + t.muted(l)) : [])];
}
