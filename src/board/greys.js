// The grey inks, quiet but always readable: the grey of greyed-out words, the grey of words that have to be read and
// the dim grey of "to do" each stand out from the background they are drawn on by a stated floor. The measure is the
// WCAG 2 contrast ratio. The floor is 4.5 to 1, what WCAG asks of text; where a theme's own plain text is so quiet
// that 4.5 would leave the grey less than 1.5 times dimmer than it, the floor comes down with it, and never under
// 3 to 1. A theme's grey that is under its floor is pulled towards the plain text colour, only as far as the floor.
// The background is the terminal's own where it said so (the board paints none), else the theme's. On the selected
// row, whose background is the theme's, a grey keeps 3 to 1, or as much of it as that row's own text has to give, and
// never by coming nearer to plain text than 1.3 times dimmer.
// The terminal's own colours cannot be measured unasked, and none of its ways to grey a word can be trusted: "bright
// black" is nearly the background on many dark schemes, "white" nearly the background on light ones, and the faint
// attribute halves a text colour that on a quiet scheme (Solarized) has no contrast to spare. So where the terminal
// told its text colour and its background, the grey is mixed from those two and measured like any other; and where
// it did not tell both, greyed words are the plain text colour, the one colour there that is known to be readable:
// a grey that must be dimmer than text cannot be chosen without knowing the text. "To do" is then told from a
// task's words by its heading and its mark.
import { R, A, TOKENS, PALETTES } from "./palettes.js";

export const FLOOR = 4.5, LEAST = 3, DIMMER = 1.5, TODO_DIMMER = 1.3;
export const TODO_APART = 60, TODO_BESIDE = ["green", "review"];
const GREYS = [0x808080, 0x6b7280, 0x555555, 0x9ca3af, 0xaaaaaa];
// The terminal's 16 colours as xterm shows them: what a colour given by name looks like, as near as can be known.
export const XTERM = [0x000000, 0xcd0000, 0x00cd00, 0xcdcd00, 0x0000ee, 0xcd00cd, 0x00cdcd, 0xe5e5e5, 0x7f7f7f, 0xff0000, 0x00ff00, 0xffff00, 0x5c5cff, 0xff00ff, 0x00ffff, 0xffffff];

const rgb = (c) => [c >> 16, (c >> 8) & 255, c & 255];
const real = (c) => typeof c === "number" && c >= 0;
// How far apart two colours look. One of the terminal's 16 is measured as xterm draws it; the terminal's own colour
// (text or background with none set) cannot be known, and counts as far.
const drawn = (c) => (c < 0 ? XTERM[c - A] : c);
export const apart = (a, b) => (a === b ? 0 : typeof a !== "number" || typeof b !== "number" ? Infinity : Math.hypot(...rgb(drawn(a)).map((x, i) => x - rgb(drawn(b))[i])));
const linear = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const light = (c) => { const [r, g, b] = rgb(c).map(linear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
// The WCAG 2 contrast ratio of two colours, 1 (the same) to 21 (black on white). Only of two real colours.
export function contrast(a, b) {
  if (!real(a) || !real(b)) return NaN;
  const [hi, lo] = [light(a), light(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
export const mix = (a, b, part) => rgb(a).reduce((all, x, i) => (all << 8) | Math.round(x + (rgb(b)[i] - x) * part), 0);
const pole = (bg) => (light(bg) < 0.18 ? 0xffffff : 0x000000);
// The floor on this background, beside this plain text colour.
export const floorOn = (bg, text) => (real(text) ? Math.max(LEAST, Math.min(FLOOR, contrast(text, bg) / DIMMER)) : FLOOR);
// The colour, or the nearest to it that meets the floor: pulled towards the plain text colour (towards black or
// white where that is not known, or is itself under the floor). A colour that cannot be measured is left as it is.
export function readable(c, bg, text, row = null) {
  if (!real(c) || !real(bg)) return c;
  const floor = floorOn(bg, text), ok = (x) => contrast(x, bg) >= floor;
  const onRow = real(row) ? Math.min(LEAST, real(text) ? contrast(text, row) / TODO_DIMMER : LEAST) : 0, both = (x) => ok(x) && (!onRow || (contrast(x, row) >= onRow && contrast(text, bg) / contrast(x, bg) >= TODO_DIMMER));
  const to = real(text) && ok(text) ? text : pole(bg);
  for (const fits of [both, ok]) for (let i = 0; i <= 32; i++) { const x = mix(c, to, i / 32); if (fits(x)) return x; }
  return to;
}
// A colour made quieter and still seen: halfway to the background, or as near to that as keeps it 3 to 1, what WCAG
// asks of a mark, on the selected row too where the colour itself has it. A colour that cannot be measured stays as it is.
export function quieter(c, bg, row = null) {
  if (!real(c) || !real(bg)) return c;
  const onRow = real(row) ? Math.min(LEAST, contrast(c, row)) : 0;
  for (let i = 16; i >= 0; i--) { const x = mix(c, bg, i / 32); if (contrast(x, bg) >= LEAST && (!onRow || contrast(x, row) >= onRow)) return x; }
  return c;
}
// The background the board is drawn on: the terminal's own where it told it, else the theme's.
export const groundOf = (p, seen) => (real(seen?.bg) ? seen.bg : p.panel_bg);
// The plain text colour: the theme's, or the terminal's own where it told it. Never a guess: a grey measured beside
// a guessed text colour can come out stronger than the real one.
const textOf = (p, seen) => (p.text !== R ? p.text : real(seen?.fg) ? seen.fg : R);
export const rowOf = (p) => (p.selection_bg === R ? p.active_row_bg : p.selection_bg);
// The theme's greys made readable, in place. The "terminal" theme's own greys are replaced as said above; a colour
// you named yourself is kept.
export function readableGreys(p, name, seen) {
  const bg = groundOf(p, seen), own = (k) => name === "terminal" && p[k] === PALETTES.terminal[TOKENS.indexOf(k)];
  const text = textOf(p, seen), known = real(seen?.bg) && real(text);
  for (const [k, part] of [["overlay0", 0.5], ["overlay1", 0.4], ["subtext0", 0.25]]) {
    p[k] = own(k) ? (known ? readable(mix(text, bg, part), bg, text) : R) : readable(p[k], bg, text, rowOf(p));
  }
}
// "todo" is the colour of a task nobody has started: a dim grey, so that it is never taken for plain text (a task's
// own words) nor for a state that has a colour. It is the theme's own grey for greyed-out words (`overlay0`, made
// readable) where that one meets the floor against the background, is 1.3 times dimmer than plain text or more (by
// the same contrast ratio) and is told apart from the green of "ready to approve" and the blue of "under review";
// else the theme's other grey, else the first of the board's greys that is. Where the text colour or the background is the terminal's own
// and was not told, it is the plain text colour: nothing dimmer is known to be readable there.
export function todoGrey(p, seen) {
  const bg = groundOf(p, seen), text = textOf(p, seen);
  if (!real(text) || !real(bg)) return R;
  const least = (c) => Math.min(...TODO_BESIDE.map((k) => apart(c, p[k])));
  const reads = (c) => contrast(c, bg) >= floorOn(bg, text) && contrast(text, bg) / contrast(c, bg) >= TODO_DIMMER;
  const all = [p.overlay0, p.overlay1, ...GREYS].filter(real).map((c) => readable(c, bg, text, rowOf(p)));
  // Readable and dimmer than text come first: where no grey is also far from all it sits beside, the furthest that is both.
  const furthest = (list) => list.reduce((best, c) => (least(c) > least(best) ? c : best));
  return all.find((c) => reads(c) && least(c) >= TODO_APART) ?? furthest(all.some(reads) ? all.filter(reads) : all);
}
