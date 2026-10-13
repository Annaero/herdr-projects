// A title's one length limit, and how a longer one is shortened without losing what it said. Every title the board
// saves (typed, renamed, or given by an agent) goes through here.
import { createRequire } from "node:module";

// 60 cells of the screen (60 letters; a wide character, as in Chinese or an emoji, takes two): what a row of the
// list has for a title in a 120-column window with the task panel open (the list gets 72 cells, the mark and the time column take the rest), and what herdr's sidebar is given of it as the label
// of the task's space. A title that fits is read whole in both places.
export const TITLE_MAX = 60;

const clean = (text) => String(text ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
const chars = (text) => Array.from(text);
// How many cells of the screen a text takes: the board's own measure (the library its rows are drawn with), so a
// title that is within the limit here is within it on the row, whatever it is written in. Plain ASCII is one cell
// a letter and loads nothing: the library is only loaded for a title that has something else in it.
const require = createRequire(import.meta.url);
let measure;
// Where the library cannot be loaded this way (a Node before 22.12, older than the library itself supports), the
// count is one that is never too low, so the limit still holds on the row: an accent that joins its letter is none,
// a letter below U+1100 (Latin, Greek, Cyrillic, Arabic...) is one, anything shown as an emoji (it is followed by
// U+FE0F) and everything from U+1100 up is two. It may cut a title of narrow characters from up there sooner than needed.
export const roughWidth = (text) => chars(String(text ?? "")).reduce((n, c, k, all) => n + (/^[\u0300-\u036f\u200b-\u200d\ufe00-\ufe0f]$/.test(c) ? 0 : all[k + 1] === "\ufe0f" || c.codePointAt(0) >= 0x1100 ? 2 : 1), 0);
export function titleWidth(text) {
  const t = String(text ?? "");
  if (/^[\x20-\x7e]*$/.test(t)) return t.length;
  if (measure === undefined) { try { measure = require("@earendil-works/pi-tui").visibleWidth; } catch { measure = null; } }
  return measure ? measure(t) : roughWidth(t);
}
// The start of a text that takes at most `max` cells, never cut inside one written character (a letter and its
// marks, an emoji made of several).
const parts = (text) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((x) => x.segment);
const start = (text, max, width) => { let out = ""; for (const c of parts(text)) { if (width(out + c) > max) break; out += c; } return out; };

// A title of at most `max` cells. One that fits is kept as it is. A longer one loses the full stop that ends
// it when that is all it takes; otherwise it is cut at the end of a word and ends in "…". `width`: only a test
// gives another measure.
export function shortTitle(text, max = TITLE_MAX, width = titleWidth) {
  const fits = (x, room) => width(x) <= room;
  const full = clean(text);
  if (fits(full, max)) return full;
  const bare = full.replace(/[.!]+$/, "");
  if (fits(bare, max)) return bare;
  const head = start(full, max - 1, width), space = head.search(/\s\S*$/);
  // A word boundary, unless the cut would then throw away over half the room (one very long word).
  const kept = /^\s/.test(full.slice(head.length)) || width(head.slice(0, Math.max(0, space))) < max / 2 ? head : head.slice(0, space);
  return kept.replace(/[\s,;:.!?(\[{"'`–—-]+$/, "") + "…";
}

const flat = (text) => String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
// A title and a description as they are saved. When the title had to be cut, its full text is the description's
// first paragraph (unless the description says it already): nothing that was written is lost. `cut` says it was.
export function titled(title, description = "") {
  const full = clean(title), short = shortTitle(full), text = String(description || "").trim();
  const cut = short.endsWith("…") && short !== full;
  return { title: short, full, cut, description: cut && !flat(text).includes(flat(full)) ? [full, text].filter(Boolean).join("\n\n") : text };
}
// What whoever gave a too long title is told, so that they can give a better one. "" when it fitted.
export const titleNote = (given) => { const t = titled(given); return t.cut ? ` The title was over ${TITLE_MAX} characters, so it was shortened to "${t.title}" and the full text was kept in the description. Rename it if a better short title exists.` : ""; };
// What the instructions say of a title, in one place: the Coordinator's rules and the board's how-to.
export const TITLE_RULE = `at most ${TITLE_MAX} characters`;
