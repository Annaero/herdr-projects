// The board's colours and status marks are herdr's own (verified against herdr 0.9.3: src/app/state.rs for the
// palettes, src/client/shell.rs for the marks). herdr does not hand its theme to plugins, so the board reads the same
// `[theme]` and `[ui]` settings herdr reads from its config.toml and resolves them the way herdr does: with no theme
// set there it is herdr's default, Catppuccin, exactly as herdr shows it, so the two never look like two programs.
// One case cannot be known: herdr's screen is painted by its client with the config of the machine the client runs
// on, and herdr passes neither that config nor its theme on to the server the board runs on. A herdr opened from
// another machine (`herdr --remote`) whose config names another theme therefore shows that theme around a board in
// this machine's. The board's `theme` setting says the theme by hand then: any of herdr's themes by its name.
// The board's own colours are only those for what herdr has no state for: "review" (a blue), "todo" (a dim grey) and
// the green of finished work that waits for a yes, which is the theme's own green. The greys are herdr's, made
// readable where they are too near the background (greys.js).
import fs from "node:fs";
import { setting } from "../store.js";
import { herdrConfig } from "../extras.js";
import { parseToml } from "../toml.js";
import { TOKENS, R, A, table, PALETTES, canonical, siblings } from "./palettes.js";
import { XTERM, apart, readableGreys, todoGrey, groundOf, rowOf, quieter } from "./greys.js";
export { apart, TODO_APART, TODO_BESIDE } from "./greys.js";

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
// herdr's config.toml. A file herdr could not read either gives herdr's defaults.
export function readHerdrConfig(file = herdrConfig()) { try { return parseToml(fs.readFileSync(file, "utf8")); } catch { return {}; } }
// The palette and status marks herdr would use with this config. `light` is the terminal's appearance (true, false or
// null when unknown); `want` is the board's own `theme` setting: "herdr" resolves the config exactly as herdr does
// ("auto", its name before, is the same), "dark" and "light" pick herdr's dark or light theme by hand, and the name
// of one of herdr's themes ("nord", "terminal" for the terminal's own colours) is that theme whatever the config names.
// `seen` is what the terminal told of its own colours ({ fg, bg }, askTerminal): the greys are measured against them.
const named = (want) => (["herdr", "auto", "dark", "light"].includes(want) ? null : canonical(want));
export function resolve(cfg = {}, light = null, want = "herdr", seen = null) {
  const th = cfg.theme || {}, ui = cfg.ui || {};
  const manual = named(want) || (typeof th.name === "string" ? th.name : "catppuccin");
  const [dark0, light0] = siblings(manual);
  const mode = named(want) ? "" : want === "dark" || want === "light" ? want : th.auto_switch === true ? (light ? "light" : "dark") : "";
  const name = mode === "light" ? th.light_name || light0 : mode === "dark" ? th.dark_name || dark0 : manual;
  const base = PALETTES[canonical(name)] || PALETTES[mode === "light" ? "catppuccin-latte" : "catppuccin"];
  const palette = Object.fromEntries(TOKENS.map((k, i) => [k, base[i]]));
  const over = (t) => { for (const k of TOKENS) if (typeof t?.[k] === "string") palette[k] = parseColor(t[k]); };
  over(th.custom);
  if (typeof ui.accent === "string" && ui.accent !== "cyan" && typeof th.custom?.accent !== "string") palette.accent = parseColor(ui.accent); // herdr's older accent setting
  if (mode && th.auto_switch === true) over(th.custom?.[mode]);
  readableGreys(palette, canonical(name), seen);
  palette.review = reviewBlue(palette);
  // The board's own check is neither the agent's nor the reviewer's: a neutral light grey, herdr's subtext0, brighter
  // than the greyed words beside it and with no hue of its own.
  palette.check = palette.subtext0;
  palette.todo = todoGrey(palette, seen);
  palette.auto = autoPurple(palette);
  return { name: canonical(name) || name, palette, ground: groundOf(palette, seen), symbols: ui.status_indicators === "symbols", dots: ui.status_indicators === "dots" };
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
const drawn = (c) => (c < 0 ? XTERM[c - A] : c);
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

// "auto" is the colour of an automation: its heading in the list, the mark of its rows, the `[auto]` tag of a task it
// made. No task's state has it, so nothing of an automation is taken for "needs you", "ready", "working", "under
// review", "to do" or "done", nor for plain or greyed words. It is the theme's own `mauve`, which no status uses,
// where that one is a purple (from violet to pink) and told apart from all of those and from the background. Some
// themes' is not (Vesper's is its amber, Nord's, Kanagawa's and Rosé Pine's sit on their greys): then it is the
// first of the board's own purples that is, the darker ones first on a light background. Among the terminal's own
// 16 colours it is the terminal's magenta, so it follows the terminal as the rest of that theme does.
export const AUTO_APART = 40, AUTO_BESIDE = ["red", "green", "yellow", "teal", "review", "todo", "text", "subtext0", "overlay0", "panel_bg"];
const PURPLES = [0xa855f7, 0xc084fc, 0x7c3aed, 0x6d28d9, 0xd946ef];
export function isPurple(c) {
  if (typeof c !== "number") return false;
  const [r, g, b] = rgb(drawn(c)), max = Math.max(r, g, b), spread = max - Math.min(r, g, b);
  const hue = (60 * (max === r ? ((g - b) / (spread || 1)) % 6 : max === g ? (b - r) / (spread || 1) + 2 : (r - g) / (spread || 1) + 4) + 360) % 360;
  return g < r && g < b && spread >= 30 && hue >= 250 && hue <= 345;
}
function autoPurple(p) {
  const least = (c) => Math.min(...AUTO_BESIDE.map((k) => apart(c, p[k])));
  const fits = (c) => isPurple(c) && least(c) >= AUTO_APART;
  if (fits(p.mauve)) return p.mauve;
  if ([p.mauve, p.text].some((c) => typeof c !== "number" || c < 0) && fits(A + 5)) return A + 5;
  const own = typeof p.panel_bg === "number" && p.panel_bg >= 0 && isLight(p.panel_bg) ? [...PURPLES.slice(2), ...PURPLES] : PURPLES;
  return own.find(fits) ?? own.reduce((best, c) => (least(c) > least(best) ? c : best));
}

// The board marks each state with its own symbol (◐ ✗ ✓ ○, ◑ while the reviewer works, ◒ for the board's own steps; a task that waits for you says what it needs: ? ! @, and finished work that is ready for your yes is ◆), so no two states are told apart by colour alone. Only a
// herdr config that asks for "dots" by name gets herdr's dots.
let cfg = {}, P = resolve().palette, ground = resolve().ground, symbols = true, told = null;
const marksOf = (r) => !r.dots;
const want = () => String(setting("board.theme"));
// Read herdr's theme. Answers whether the terminal has to be asked to finish it: for its appearance (herdr's auto_switch).
export function loadTheme(light = null) {
  cfg = readHerdrConfig();
  { const r = resolve(cfg, light, want(), told); P = r.palette; ground = r.ground; symbols = marksOf(r); }
  return !named(want()) && !["dark", "light"].includes(want()) && cfg.theme?.auto_switch === true;
}
// What the terminal answered: its appearance, and its own text and background colours where it told them.
export const setTerminal = (light, seen = null) => { told = seen; const r = resolve(cfg, light, want(), seen); P = r.palette; ground = r.ground; symbols = marksOf(r); };
// Ask the terminal for its text colour and its background (light, dark or null when it does not say). herdr answers for its panes with the
// colours of the terminal the client runs in. The question for the terminal's kind goes last: every terminal answers
// it, so no answer is waited for longer than the terminal takes to say that it has none.
const byte = (x) => parseInt(x.slice(0, 2).padEnd(2, x[0]), 16);
export function readAnswers(buf) {
  const said = (n) => { const m = new RegExp(`\\]${n};rgb:([0-9a-f]+)/([0-9a-f]+)/([0-9a-f]+)`, "i").exec(buf); return m ? (byte(m[1]) << 16) | (byte(m[2]) << 8) | byte(m[3]) : null; };
  const fg = said(10), bg = said(11);
  return { light: bg === null ? null : isLight(bg), fg, bg, done: /\x1b\[\?[\d;]*c/.test(buf) };
}
export function askTerminal(ms = 250) {
  const fgbg = /;(\d+)$/.exec(process.env.COLORFGBG || "");
  const guess = fgbg ? [7, 15].includes(Number(fgbg[1])) : null;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve({ light: guess, fg: null, bg: null });
  return new Promise((resolve) => {
    let buf = "", done = false;
    const end = () => { if (done) return; done = true; clearTimeout(timer); process.stdin.off("data", on); try { process.stdin.setRawMode(false); } catch {} process.stdin.pause(); const a = readAnswers(buf); resolve({ light: a.light ?? guess, fg: a.fg, bg: a.bg }); };
    const on = (d) => { buf += d; if (readAnswers(buf).done) end(); };
    const timer = setTimeout(end, ms);
    try { process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on("data", on); process.stdout.write("\x1b]10;?\x1b\\\x1b]11;?\x1b\\\x1b[c"); } catch { end(); }
  });
}
const plain = () => process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
const sgr = (c, bg) => (c < 0 ? String((c - A < 8 ? (bg ? 40 : 30) : (bg ? 92 : 82)) + (c - A)) : `${bg ? 48 : 38};2;${c >> 16};${(c >> 8) & 255};${c & 255}`);
// herdr's mark for each state (src/client/shell.rs, status_icon): its distinct symbols, or its dots when herdr's
// `ui.status_indicators` says "dots". A failure has no herdr state; it takes the cross herdr's own CLI prints.
// The reviewer at work and the board's own steps have none either: they take the working mark turned another way
// (◑ the reviewer, ◒ the board), and the agent's keeps herdr's.
// A blocked task is not a failed one, so it never takes a cross: its mark says what it needs from you (NEEDS), and
// `!` where that is not known. Finished work that passed and waits for your yes to merge has a mark of its own, a
// filled diamond in green (row.js): an exclamation mark reads as "something is wrong", and nothing is.
export const MARK_STATES = ["working", "review", "board", "ready", "blocked", "done", "idle", "unknown", "error"], NEED_KINDS = ["question", "permission", "auth"]; // every state and need that has a mark
const MARKS = table({ working: ["●", "◐"], review: ["●", "◑"], board: ["●", "◒"], ready: ["◆", "◆"], blocked: ["!", "!"], done: ["●", "✓"], idle: ["○", "○"], unknown: ["·", "·"], error: ["✗", "✗"] });
// What a blocked task needs, by its kind (OSC 7501): an answer, a yes or no, or a sign-in. All three are characters
// every font has (the sign-in was a key, U+26B7, which many fonts lack and some draw two cells wide).
// herdr's dots have one dot for every blocked pane; the board says what is needed with them too, as a dot cannot.
const NEEDS = table({ question: ["?", "?"], permission: ["!", "!"], auth: ["@", "@"] });
export const theme = {
  fg(token, s) { const c = P[token]; return plain() || typeof c !== "number" ? String(s) : `\x1b[${sgr(c, false)}m${s}\x1b[39m`; },
  bg(token, s) { const c = P[token]; return plain() || typeof c !== "number" ? String(s) : `\x1b[${sgr(c, true)}m${s}\x1b[49m`; },
  // The row under the cursor, as herdr's sidebar paints it: selection_bg, or active_row_bg when the theme has none.
  selected(s) { return this.under(P.selection_bg === R ? "active_row_bg" : "selection_bg", s); },
  // A background that stays on through the colour resets inside `s`.
  under(token, s) { const on = this.bg(token, "\0").split("\0")[0]; return on ? this.bg(token, String(s).replace(/\x1b\[(?:0|49)?m/g, (m) => m + on)) : String(s); },
  // One finished line in herdr's text colour: whatever the board leaves uncoloured is herdr's `text`, not the terminal's.
  line(s) { const on = this.fg("text", "\0").split("\0")[0]; return on ? this.fg("text", String(s).replace(/\x1b\[(?:0|39)?m/g, (m) => m + on)) : String(s); },
  // Greyed-out words: a heading, a label, a row's status line. herdr's overlay0, made readable (greys.js). Never the
  // faint attribute: how faint that is, and whether it still reads, is the terminal's to say.
  muted(s) { return this.fg("overlay0", s); },
  // The second grey, for words that have to be read: a live row's second line, the chat's message, the keys on the
  // hint line. herdr's subtext0, brighter than `muted` (overlay0), which is kept for what may be missed: times,
  // counts, tags, the words between two hints. Both are herdr's own.
  soft(s) { return this.fg("subtext0", s); },
  // A colour made quieter, for a mark that is finished with: measured, so it is still seen (greys.js: quieter). The
  // faint attribute is not used for it: how faint that is, is the terminal's to say.
  quiet(token, s) { const c = quieter(P[token], ground, rowOf(P)); return plain() || typeof c !== "number" || c === P[token] ? this.fg(token, s) : `\x1b[${sgr(c, false)}m${s}\x1b[39m`; },
  mark: (state, kind) => ((state === "blocked" && NEEDS[kind]) || MARKS[state] || MARKS.unknown)[symbols ? 1 : 0],
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
  const own = (k) => { const c = palette[k]; return typeof c !== "number" || (name === "terminal" && c === PALETTES.terminal[TOKENS.indexOf(k)]) ? null : c < 0 ? XTERM[c - A] : c; };
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
