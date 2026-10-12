// The board's colours and status marks are herdr's own (verified against herdr 0.9.3: src/app/state.rs for the
// palettes, src/client/shell.rs for the marks). herdr does not hand its theme to plugins, so the board reads the same
// `[theme]` and `[ui]` settings herdr reads from its config.toml and resolves them the way herdr does.
// herdr's sidebar is painted by the client, with the config of the machine the client runs on; herdr passes neither
// that config nor its theme on to the server the board runs on. A theme set in this machine's config is a choice the
// board can follow. No theme set here says nothing: the client may be on another device with a theme of its own. The
// board then paints with the terminal's own colours (herdr's "terminal" theme), the one look that belongs on whatever
// screen shows it. The board's `theme` setting says otherwise by hand ("herdr": herdr's Catppuccin default).
// This default is the owner's decision (task 14), taken knowing its cost: someone who runs an unconfigured herdr on
// this very machine sees the terminal's colours on the board beside herdr's Catppuccin, until they set `theme herdr`.
import fs from "node:fs";
import { config } from "../store.js";
import { herdrConfig } from "../extras.js";
import { parseToml } from "../toml.js";

const TOKENS = ["accent", "panel_bg", "sidebar_bg", "active_row_bg", "selection_bg", "surface0", "surface1", "surface_dim", "overlay0", "overlay1", "text", "subtext0", "mauve", "green", "yellow", "red", "blue", "teal", "peach"];
// A colour is 0xRRGGBB, R (the terminal's own colour) or A + n (one of the terminal's 16 colours).
const R = null, A = -16;
// The lookup tables have no inherited keys: a theme or colour called "constructor" is simply unknown, as in herdr.
const table = (o) => Object.assign(Object.create(null), o);
const PALETTES = table({
  "catppuccin": [0x89b4fa, 0x181825, R, 0x1e1e2e, 0x313244, 0x313244, 0x45475a, 0x1e1e2e, 0x6c7086, 0x7f849c, 0xcdd6f4, 0xa6adc8, 0xcba6f7, 0xa6e3a1, 0xf9e2af, 0xf38ba8, 0x89b4fa, 0x94e2d5, 0xfab387],
  "catppuccin-latte": [0x1e66f5, 0xeff1f5, R, 0xe6e9ef, 0xbdd0f5, 0xccd0da, 0xbcc0cc, 0xe6e9ef, 0x9ca0b0, 0x8c8fa1, 0x4c4f69, 0x6c6f85, 0x8839ef, 0x40a02b, 0xdf8e1d, 0xd20f39, 0x1e66f5, 0x179299, 0xfe640b],
  "terminal": [A+4, R, R, A+8, R, R, A+8, A+8, A+7, A+15, R, A+7, A+7, A+2, A+3, A+9, A+4, A+6, A+3],
  "tokyo-night": [0x7aa2f7, 0x1a1b26, R, 0x232636, 0x2d3650, 0x24283b, 0x414868, 0x1a1b26, 0x565f89, 0x697196, 0xc0caf5, 0xa9b1d6, 0xbb9af7, 0x9ece6a, 0xe0af68, 0xf7768e, 0x7aa2f7, 0x7dcfff, 0xff9e64],
  "tokyo-night-day": [0x2e7de9, 0xe1e2e7, R, 0xd2d3da, 0xb6cae7, 0xc4c8da, 0xa8aecb, 0xd2d3da, 0x8990b3, 0x68709a, 0x3760bf, 0x6172b0, 0x7847bd, 0x587539, 0x8c6c3e, 0xf52a65, 0x2e7de9, 0x118c74, 0xb15c00],
  "dracula": [0xbd93f9, 0x282a36, R, 0x373c52, 0x463f5d, 0x44475a, 0x6272a4, 0x282a36, 0x6272a4, 0x828cb4, 0xf8f8f2, 0xd2d2dc, 0xff79c6, 0x50fa7b, 0xf1fa8c, 0xff5555, 0x8be9fd, 0x8be9fd, 0xffb86c],
  "nord": [0x88c0d0, 0x2e3440, R, 0x434c5e, 0x40505d, 0x3b4252, 0x434c5e, 0x2e3440, 0x4c566a, 0x646e82, 0xeceff4, 0xd8dee9, 0xb48ead, 0xa3be8c, 0xebcb8b, 0xbf616a, 0x81a1c1, 0x8fbcbb, 0xd08770],
  "gruvbox": [0xd79921, 0x282828, R, 0x323130, 0x4b3f27, 0x3c3836, 0x504945, 0x282828, 0x928374, 0xa89984, 0xebdbb2, 0xd5c4a1, 0xd3869b, 0xb8bb26, 0xfabd2f, 0xfb4934, 0x83a598, 0x8ec07c, 0xfe8019],
  "gruvbox-light": [0x076678, 0xfbf1c7, R, 0xf2e5bc, 0xebdbb2, 0xebdbb2, 0xd5c4a1, 0xf2e5bc, 0x928374, 0x7c6f64, 0x3c3836, 0x504945, 0x8f3f71, 0x79740e, 0xb57614, 0x9d0006, 0x076678, 0x427b58, 0xaf3a03],
  "one-dark": [0x61afef, 0x282c34, R, 0x313640, 0x334659, 0x2c313a, 0x3e4451, 0x282c34, 0x5c6370, 0x737a87, 0xabb2bf, 0x969ca8, 0xc678dd, 0x98c379, 0xe5c07b, 0xe06c75, 0x61afef, 0x56b6c2, 0xd19a66],
  "one-light": [0x4078f2, 0xfafafa, R, 0xd8dbe2, 0xcddbf8, 0xf0f0f1, 0xe5e5e6, 0xf5f5f6, 0xa0a1a7, 0x686b77, 0x383a42, 0x686b77, 0xa626a4, 0x50a14f, 0xc18401, 0xe45649, 0x4078f2, 0x0184bc, 0x986801],
  "solarized": [0x268bd2, 0x002b36, R, 0x164b57, 0x083e55, 0x073642, 0x586e75, 0x002b36, 0x586e75, 0x657b83, 0x93a1a1, 0x839496, 0xd33682, 0x859900, 0xb58900, 0xdc322f, 0x268bd2, 0x2aa198, 0xcb4b16],
  "solarized-light": [0x268bd2, 0xfdf6e3, R, 0xeee8d5, 0xc9dcdf, 0xeee8d5, 0x93a1a1, 0xeee8d5, 0x93a1a1, 0x586e75, 0x657b83, 0x839496, 0xd33682, 0x859900, 0xb58900, 0xdc322f, 0x268bd2, 0x2aa198, 0xcb4b16],
  "kanagawa": [0x7e9cd8, 0x1f1f28, R, 0x363646, 0x32384b, 0x2a2a37, 0x363646, 0x1f1f28, 0x727169, 0x87867d, 0xdcd7ba, 0xc8c3aa, 0x957fb8, 0x76946a, 0xc0a36e, 0xc34043, 0x7e9cd8, 0x7fb4ca, 0xffa066],
  "kanagawa-lotus": [0x4d699b, 0xf2ecbc, R, 0xd5cea3, 0xdcd5ac, 0xdcd5ac, 0xc9cbd1, 0xd5cea3, 0xa09cac, 0x8a8980, 0x545464, 0x43436c, 0x624c83, 0x6f894e, 0x77713f, 0xc84053, 0x4d699b, 0x4e8ca2, 0xcc6d00],
  "rose-pine": [0xc4a7e7, 0x191724, R, 0x26233a, 0x3b344b, 0x1f1d2e, 0x26233a, 0x26233a, 0x6e6a86, 0x908caa, 0xe0def4, 0xc8c5dc, 0xc4a7e7, 0x31748f, 0xf6c177, 0xeb6f92, 0x31748f, 0x9ccfd8, 0xea9a97],
  "rose-pine-dawn": [0x907aa9, 0xfaf4ed, R, 0xe3d9cf, 0xf2e9e1, 0xf2e9e1, 0xfffaf3, 0xf2e9e1, 0x9893a5, 0x797593, 0x464261, 0x797593, 0x907aa9, 0x286983, 0xea9d34, 0xb4637a, 0x286983, 0x56949f, 0xd7827e],
  "vesper": [0xffc799, 0x1a1a1a, R, 0x101010, 0x232323, 0x232323, 0x282828, 0x101010, 0x5c5c5c, 0x7e7e7e, 0xffffff, 0xa0a0a0, 0xffd1a8, 0x99ffe4, 0xffc799, 0xff8080, 0xb0b0b0, 0x66ddcc, 0xffc799],
});
// The names herdr accepts for each theme, and each theme's [dark, light] pair.
const ALIAS = table({ "catppuccin-mocha": "catppuccin", latte: "catppuccin-latte", light: "catppuccin-latte", tokyonight: "tokyo-night", "tokyo-day": "tokyo-night-day", "tokyonight-day": "tokyo-night-day", "gruvbox-dark": "gruvbox", onedark: "one-dark", onelight: "one-light", "solarized-dark": "solarized", lotus: "kanagawa-lotus", rosepine: "rose-pine", "rosepine-dawn": "rose-pine-dawn", dawn: "rose-pine-dawn" });
const PAIRS = [["catppuccin", "catppuccin-latte"], ["tokyo-night", "tokyo-night-day"], ["gruvbox", "gruvbox-light"], ["one-dark", "one-light"], ["solarized", "solarized-light"], ["kanagawa", "kanagawa-lotus"], ["rose-pine", "rose-pine-dawn"]];
const canonical = (name) => { const n = String(name ?? "").toLowerCase().replace(/[ _]/g, "-"); return PALETTES[n] ? n : ALIAS[n] || null; };
const siblings = (name) => PAIRS.find((p) => p.includes(canonical(name))) || [name, name];
const NAMED = table({ black: 0, red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, purple: 5, cyan: 6, gray: 7, grey: 7, darkgray: 8, darkgrey: 8, lightred: 9, lightgreen: 10, lightyellow: 11, lightblue: 12, lightmagenta: 13, lightcyan: 14, white: 15 });
// A colour as herdr's config writes it: #rrggbb, #rgb, rgb(r,g,b), a name, or reset. An unknown one is cyan, as in herdr.
export function parseColor(value) {
  const s = String(value).trim().toLowerCase();
  if (["reset", "default", "none", "transparent"].includes(s)) return R;
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return parseInt(m[1], 16);
  if ((m = /^#([0-9a-f]{3})$/.exec(s))) return parseInt(m[1].replace(/./g, "$&$&"), 16);
  if ((m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s)) && m.slice(1).every((n) => Number(n) < 256)) return (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]);
  return A + (NAMED[s] ?? 6);
}
// The terminal's 16 colours as xterm shows them: what a colour given by name looks like, as near as can be known.
const XTERM = [0x000000, 0xcd0000, 0x00cd00, 0xcdcd00, 0x0000ee, 0xcd00cd, 0x00cdcd, 0xe5e5e5, 0x7f7f7f, 0xff0000, 0x00ff00, 0xffff00, 0x5c5cff, 0xff00ff, 0x00ffff, 0xffffff];
// herdr's config.toml. A file herdr could not read either gives herdr's defaults.
export function readHerdrConfig(file = herdrConfig()) { try { return parseToml(fs.readFileSync(file, "utf8")); } catch { return {}; } }
// The palette and status marks herdr would use with this config. `light` is the terminal's appearance (true, false or
// null when unknown); `want` is the board's own `theme` setting: "herdr" resolves the config exactly as herdr does,
// "auto" does too when the config sets a theme and is the terminal's colours when it sets none, "terminal" is always
// herdr's "terminal" theme, "dark" and "light" pick herdr's dark or light theme by hand.
const THEME_KEYS = ["name", "dark_name", "light_name", "auto_switch", "custom"];
export function resolve(cfg = {}, light = null, want = "herdr") {
  const th = cfg.theme || {}, ui = cfg.ui || {};
  const unset = typeof ui.accent !== "string" && !THEME_KEYS.some((k) => Object.hasOwn(th, k));
  const terminal = want === "terminal" || (want === "auto" && unset);
  const manual = terminal ? "terminal" : typeof th.name === "string" ? th.name : "catppuccin";
  const [dark0, light0] = siblings(manual);
  const mode = terminal ? "" : want === "dark" || want === "light" ? want : th.auto_switch === true ? (light ? "light" : "dark") : "";
  const name = mode === "light" ? th.light_name || light0 : mode === "dark" ? th.dark_name || dark0 : manual;
  const base = PALETTES[canonical(name)] || PALETTES[mode === "light" ? "catppuccin-latte" : "catppuccin"];
  const palette = Object.fromEntries(TOKENS.map((k, i) => [k, base[i]]));
  const over = (t) => { for (const k of TOKENS) if (typeof t?.[k] === "string") palette[k] = parseColor(t[k]); };
  over(th.custom);
  if (typeof ui.accent === "string" && ui.accent !== "cyan" && typeof th.custom?.accent !== "string") palette.accent = parseColor(ui.accent); // herdr's older accent setting
  if (mode && th.auto_switch === true) over(th.custom?.[mode]);
  palette.review = reviewBlue(palette);
  return { name: canonical(name) || name, palette, symbols: ui.status_indicators === "symbols", dots: ui.status_indicators === "dots" };
}

// "review" is the colour of a review that is running: a blue, so that green says only "passed" or "ready" and amber
// only "the agent works". Whatever paints "the reviewer is working" asks for it by that name: the row's mark, bar,
// percent and minutes left, and its R# tag. It is the theme's own `blue` where that one is a blue and told apart from all it
// sits beside: the green, the red of what failed, the agent's amber, the teal of herdr's own dot for done and idle,
// the two greys of muted text, plain text and the background. Many themes' blue is not (Dracula's is its teal, Rosé
// Pine's its green, Vesper's a grey, Catppuccin's a pale one near its muted text), and a colour of your own can be
// anything: then it is the first of the board's own blues that is told apart from them all, the first of which reads
// on a dark and on a light background alike; and where none is, the blue that is furthest from them.
export const REVIEW_BLUE = 0x3b82f6, REVIEW_APART = 60;
const REVIEW_BLUES = [REVIEW_BLUE, 0x1d4ed8, 0x93c5fd, 0x0000ff, 0x6366f1, 0x0ea5e9];
export const REVIEW_BESIDE = ["green", "red", "yellow", "teal", "subtext0", "overlay0", "text", "panel_bg"];
const rgb = (c) => [c >> 16, (c >> 8) & 255, c & 255];
// How far apart two colours look. One of the terminal's 16 is measured as xterm draws it; the terminal's own colour
// (text or background with none set) cannot be known, and counts as far.
const drawn = (c) => (c < 0 ? XTERM[c - A] : c);
export const apart = (a, b) => (a === b ? 0 : typeof a !== "number" || typeof b !== "number" ? Infinity : Math.hypot(...rgb(drawn(a)).map((x, i) => x - rgb(drawn(b))[i])));
// Is it a blue at all? By its hue, from the blue-green side of cyan to the edge of violet, and not a grey: a `blue`
// of your own that is really a green, a purple or a grey is not what "the reviewer is working" may be painted in.
export function isBlue(c) {
  if (typeof c !== "number") return false;
  const [r, g, b] = rgb(drawn(c)), spread = b - Math.min(r, g), hue = 60 * (4 + (r - g) / (spread || 1));
  return b > r && b > g && spread >= 40 && hue >= 185 && hue <= 255;
}
function reviewBlue(p) {
  const least = (c) => Math.min(...REVIEW_BESIDE.map((k) => apart(c, p[k])));
  const fits = (c) => isBlue(c) && least(c) >= REVIEW_APART;
  const any = () => { const all = []; for (const r of [0, 64, 128, 192]) for (const g of [0, 64, 128, 192]) for (const b of [160, 208, 255]) all.push((r << 16) | (g << 8) | b); return all.filter(isBlue); };
  return [p.blue, ...REVIEW_BLUES].find(fits) ?? any().reduce((best, c) => (least(c) > least(best) ? c : best));
}

// The board marks each state with its own symbol (◐ × ✓ ○), so no two states are told apart by colour alone. Only a
// herdr config that asks for "dots" by name gets herdr's dots.
let cfg = {}, P = resolve().palette, symbols = true;
const marksOf = (r) => !r.dots;
const want = () => String(config().theme || "auto");
// Read herdr's theme. Answers whether the terminal has to be asked to finish it: for its appearance (herdr's auto_switch).
export function loadTheme(light = null) {
  cfg = readHerdrConfig();
  { const r = resolve(cfg, light, want()); P = r.palette; symbols = marksOf(r); }
  return ["auto", "herdr"].includes(want()) && cfg.theme?.auto_switch === true;
}
// What the terminal answered: its appearance.
export const setTerminal = (light) => { const r = resolve(cfg, light, want()); P = r.palette; symbols = marksOf(r); };
// Ask the terminal for its background (light, dark or null when it does not say). herdr answers for its panes with the
// colours of the terminal the client runs in. The question for the terminal's kind goes last: every terminal answers
// it, so no answer is waited for longer than the terminal takes to say that it has none.
const byte = (x) => parseInt(x.slice(0, 2).padEnd(2, x[0]), 16);
export function readAnswers(buf) {
  const bg = /\]11;rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i.exec(buf);
  return { light: bg ? isLight((byte(bg[1]) << 16) | (byte(bg[2]) << 8) | byte(bg[3])) : null, done: /\x1b\[\?[\d;]*c/.test(buf) };
}
export function askTerminal(ms = 250) {
  const fgbg = /;(\d+)$/.exec(process.env.COLORFGBG || "");
  const guess = fgbg ? [7, 15].includes(Number(fgbg[1])) : null;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve({ light: guess });
  return new Promise((resolve) => {
    let buf = "", done = false;
    const end = () => { if (done) return; done = true; clearTimeout(timer); process.stdin.off("data", on); try { process.stdin.setRawMode(false); } catch {} process.stdin.pause(); resolve({ light: readAnswers(buf).light ?? guess }); };
    const on = (d) => { buf += d; if (readAnswers(buf).done) end(); };
    const timer = setTimeout(end, ms);
    try { process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on("data", on); process.stdout.write("\x1b]11;?\x1b\\\x1b[c"); } catch { end(); }
  });
}
const plain = () => process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
const sgr = (c, bg) => (c < 0 ? String((c - A < 8 ? (bg ? 40 : 30) : (bg ? 92 : 82)) + (c - A)) : `${bg ? 48 : 38};2;${c >> 16};${(c >> 8) & 255};${c & 255}`);
// herdr's mark for each state (src/client/shell.rs, status_icon): its distinct symbols, or its dots when herdr's
// `ui.status_indicators` says "dots". A failure has no herdr state; it takes the cross herdr's own CLI prints.
const MARKS = table({ working: ["●", "◐"], blocked: ["●", "×"], done: ["●", "✓"], idle: ["○", "○"], unknown: ["·", "·"], error: ["✗", "✗"] });
export const theme = {
  fg(token, s) { const c = P[token]; return plain() || typeof c !== "number" ? String(s) : `\x1b[${sgr(c, false)}m${s}\x1b[39m`; },
  bg(token, s) { const c = P[token]; return plain() || typeof c !== "number" ? String(s) : `\x1b[${sgr(c, true)}m${s}\x1b[49m`; },
  // The row under the cursor, as herdr's sidebar paints it: selection_bg, or active_row_bg when the theme has none.
  selected(s) { return this.under(P.selection_bg === R ? "active_row_bg" : "selection_bg", s); },
  // A background that stays on through the colour resets inside `s`.
  under(token, s) { const on = this.bg(token, "\0").split("\0")[0]; return on ? this.bg(token, String(s).replace(/\x1b\[(?:0|49)?m/g, (m) => m + on)) : String(s); },
  // One finished line in herdr's text colour: whatever the board leaves uncoloured is herdr's `text`, not the terminal's.
  line(s) { const on = this.fg("text", "\0").split("\0")[0]; return on ? this.fg("text", String(s).replace(/\x1b\[(?:0|39)?m/g, (m) => m + on)) : String(s); },
  // Greyed-out words: a heading, a label, a row's status line. herdr's overlay0; where that is one of the terminal's
  // own 16 colours (the "terminal" theme, whose grey is most terminals' text colour) it is faint as well, so it never
  // reads as the text beside it.
  muted(s) { const c = P.overlay0; return typeof c === "number" && c >= 0 ? this.fg("overlay0", s) : this.dim(this.fg("overlay0", s)); },
  mark: (state) => (MARKS[state] || MARKS.unknown)[symbols ? 1 : 0],
  bold: (s) => (plain() ? String(s) : `\x1b[1m${s}\x1b[22m`),
  dim: (s) => (plain() ? String(s) : `\x1b[2m${s}\x1b[22m`),
  inverse: (s) => `\x1b[7m${s}\x1b[27m`,
  underline: (s) => `\x1b[4m${s}\x1b[24m`,
};

// The same theme for the review page, as CSS variables. A page has no terminal behind it: where herdr follows the
// terminal's appearance (auto_switch) or its colours (the "terminal" theme), the page follows the browser's instead.
const hex = (c) => "#" + c.toString(16).padStart(6, "0");
const isLight = (c) => 0.2126 * (c >> 16) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255) > 140;
function pageVars({ name, palette }, light) {
  // A named colour the user chose is kept. The "terminal" theme's own colours, and "reset", mean whatever the
  // terminal shows, which a page cannot know: those take Catppuccin's, dark or light.
  const own = (k) => { const c = palette[k]; return c === R || (name === "terminal" && c === PALETTES.terminal[TOKENS.indexOf(k)]) ? null : c < 0 ? XTERM[c - A] : c; };
  if (light === null) light = own("panel_bg") !== null ? isLight(own("panel_bg")) : own("text") !== null ? !isLight(own("text")) : false;
  const base = PALETTES[light ? "catppuccin-latte" : "catppuccin"];
  const v = (k) => hex(own(k) ?? base[TOKENS.indexOf(k)]);
  return `color-scheme:${light ? "light" : "dark"};--bg:${v("panel_bg")};--ink:${v("text")};--muted:${v("subtext0")};--line:${v("surface1")};--accent:${v("accent")};--well:${v("surface0")};--ok:${v("green")};--bad:${v("red")}`;
}
export function pageTheme(c = readHerdrConfig(), wanted = want()) {
  const one = resolve(c, null, wanted);
  const byHand = wanted === "dark" || wanted === "light";
  if (byHand || (c.theme?.auto_switch !== true && one.name !== "terminal")) return `:root{${pageVars(one, byHand ? wanted === "light" : null)}}`;
  return `:root{${pageVars(resolve(c, false, wanted), false)}}@media (prefers-color-scheme:light){:root{${pageVars(resolve(c, true, wanted), true)}}}`;
}
