// The board takes its colours and status marks from herdr's own config, resolved the way herdr resolves them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseToml } from "../src/toml.js";
import { readHerdrConfig, resolve, parseColor, loadTheme, setTerminal, readAnswers, theme, pageTheme, apart, REVIEW_BLUE, REVIEW_APART, REVIEW_BESIDE, isBlue } from "../src/board/theme.js";

const cfg = (text) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hsw-theme-")), "config.toml"); fs.writeFileSync(f, text); return f; };

test("with no theme set, the board uses herdr's default: Catppuccin and dots", () => {
  const none = readHerdrConfig(cfg("onboarding = false\n[ui]\n"));
  const { name, palette, symbols } = resolve(none);
  assert.equal(name, "catppuccin"); assert.equal(symbols, false); assert.equal(resolve().name, "catppuccin");
  assert.equal(palette.accent, 0x89b4fa); assert.equal(palette.yellow, 0xf9e2af); assert.equal(palette.red, 0xf38ba8); assert.equal(palette.teal, 0x94e2d5); assert.equal(palette.green, 0xa6e3a1);
});

test("the board's own setting: the terminal's colours when herdr's config here sets no theme, herdr's theme when it does", () => {
  // herdr's client may run on another device with a config of its own: one here that sets no theme says nothing.
  const none = readHerdrConfig(cfg("onboarding = false\n[ui]\n"));
  for (const [c, want] of [[none, "auto"], [{}, "auto"], [{ theme: { name: "nord" } }, "terminal"], [{ theme: { name: "nord", auto_switch: true, dark_name: "dracula" } }, "terminal"]]) {
    const t = resolve(c, true, want);
    assert.equal(t.name, "terminal");
    assert.equal(t.palette.text, null); assert.equal(t.palette.yellow, parseColor("yellow")); assert.equal(t.palette.teal, parseColor("cyan")); assert.equal(t.palette.green, parseColor("green")); assert.equal(t.palette.red, parseColor("lightred"));
  }
  assert.equal(resolve({ theme: { custom: { red: "#010203" } } }, null, "terminal").palette.red, 0x010203); // custom colours apply to it, as in herdr
  // Any theme setting here is followed, as herdr follows it; "herdr" follows herdr's config with nothing set, too.
  for (const set of [{ theme: { custom: {} } }, { theme: { auto_switch: false } }, { ui: { accent: "red" } }]) assert.equal(resolve(set, null, "auto").name, "catppuccin");
  assert.equal(resolve({ theme: { name: "nord" } }, null, "auto").name, "nord"); assert.equal(resolve({ theme: { name: "gruvbox", auto_switch: true } }, true, "auto").name, "gruvbox-light");
  assert.equal(resolve(none, null, "herdr").name, "catppuccin"); assert.equal(resolve(none, null, "dark").name, "catppuccin"); assert.equal(resolve(none, null, "light").name, "catppuccin-latte");
});

test("the terminal says whether it is light or dark", () => {
  const said = readAnswers("\x1b]11;rgb:0d0d/1616/1c1c\x1b\\\x1b[?62;22c");
  assert.equal(said.light, false); assert.equal(said.done, true);
  assert.deepEqual(readAnswers("\x1b]11;rgb:ffff/ffff/ffff\x07"), { light: true, done: false });
  assert.deepEqual(readAnswers("\x1b]11;rgb:aa"), { light: null, done: false });
});

test("herdr's theme name, aliases, custom colours, old accent setting and symbol marks are followed", () => {
  const c = readHerdrConfig(cfg(`[theme]\nname = "Tokyo Night" # mine\n[theme.custom]\nred = "#f00"\ngreen = "rgb(1, 2, 3)"\nteal = "lightblue"\npanel_bg = "reset"\n[ui]\nstatus_indicators = "symbols"\naccent = "magenta"\n[[keys.command]]\nname = "dracula"\n`));
  const { name, palette, symbols } = resolve(c);
  assert.equal(name, "tokyo-night"); assert.equal(symbols, true);
  assert.equal(palette.yellow, 0xe0af68); assert.equal(palette.red, 0xff0000); assert.equal(palette.green, 0x010203); assert.equal(palette.panel_bg, null);
  assert.equal(palette.teal, parseColor("lightblue")); assert.equal(palette.accent, parseColor("magenta"));
  assert.equal(resolve({ theme: { name: "no-such" } }).palette.accent, 0x89b4fa);
  // Names that every object happens to carry are unknown names: herdr's fallbacks, never a broken palette or colour.
  for (const odd of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const r = resolve({ theme: { name: odd, custom: { red: odd } }, ui: { status_indicators: odd } });
    assert.equal(r.palette.accent, 0x89b4fa, odd); assert.equal(r.palette.green, 0xa6e3a1, odd); assert.equal(r.palette.red, parseColor("cyan"), odd); assert.equal(r.symbols, false);
    assert.equal(theme.mark(odd), "·"); assert.equal(theme.fg(odd, "x"), "x"); assert.equal(theme.bg(odd, "x"), "x");
  }
  // Every colour name the board paints with is one of herdr's.
  const used = new Set(["view.js", "editor.js", "artifact-lines.js", ...fs.readdirSync(new URL("../src/board/view/", import.meta.url)).map((f) => `view/${f}`)].flatMap((f) => [...fs.readFileSync(new URL(`../src/board/${f}`, import.meta.url), "utf8").matchAll(/\b(?:fg|bg|under)\(([^,()]+),/g)].flatMap((m) => m[1].replace(/[!=]== "[^"]*"/g, "").match(/"[a-z0-9_]+"/g) || [])));
  const known = Object.keys(resolve().palette);
  assert.ok(used.size > 6); for (const name of used) assert.ok(known.includes(JSON.parse(name)), `${name} is not a herdr colour`);
});

test("green, red and plain are told apart in every theme, light and dark: a tag's colour alone says pass, fail or no result yet", () => {
  const names = ["catppuccin", "catppuccin-latte", "tokyo-night", "tokyo-night-day", "dracula", "nord", "gruvbox", "gruvbox-light", "one-dark", "one-light", "solarized", "solarized-light", "kanagawa", "kanagawa-lotus", "rose-pine", "rose-pine-dawn", "vesper"];
  const rgb = (c) => [c >> 16, (c >> 8) & 255, c & 255], apart = (a, b) => Math.hypot(...rgb(a).map((x, i) => x - rgb(b)[i]));
  for (const name of names) {
    const r = resolve({ theme: { name } }), p = r.palette; assert.equal(r.name, name);
    for (const [a, b] of [["green", "red"], ["green", "subtext0"], ["red", "subtext0"]]) assert.ok(apart(p[a], p[b]) >= 50, `${name}: ${a} and ${b} look alike`);
    assert.notEqual(p.overlay0, p.subtext0, `${name}: quiet and plain are one colour`);
  }
  // The terminal's own colours: three different ones of its sixteen.
  const term = resolve({}, null, "terminal").palette; assert.equal(new Set([term.green, term.red, term.subtext0]).size, 3);
});

test("light and dark: only when herdr switches by appearance, or the board's own setting picks one", () => {
  const manual = { theme: { name: "gruvbox" } };
  assert.equal(resolve(manual, true).name, "gruvbox");
  assert.equal(resolve(manual, true, "light").name, "gruvbox-light"); assert.equal(resolve({ theme: { name: "gruvbox-light" } }, null, "dark").name, "gruvbox");
  const auto = { theme: { name: "gruvbox", auto_switch: true, light_name: "rose-pine-dawn", custom: { accent: "#010101", light: { accent: "#020202" } } } };
  assert.equal(resolve(auto, false).name, "gruvbox"); assert.equal(resolve(auto, null).palette.accent, 0x010101);
  assert.equal(resolve(auto, true).name, "rose-pine-dawn"); assert.equal(resolve(auto, true).palette.accent, 0x020202);
});

test("herdr's config is read however it is written: tables, inline tables, dotted keys", () => {
  const want = { theme: { name: "nord", auto_switch: true, custom: { red: "#010203", accent: "#040506", light: { text: "#070809" } } }, ui: { status_indicators: "symbols" } };
  const pick = (c) => ({ theme: c.theme, ui: { status_indicators: c.ui?.status_indicators } });
  assert.deepEqual(pick(parseToml(`[theme]\nname = "nord"\nauto_switch = true\n[theme.custom]\nred = "#010203"\naccent = "#040506"\n[theme.custom.light]\ntext = "#070809"\n[ui]\nstatus_indicators = "symbols"\n`)), want);
  assert.deepEqual(pick(parseToml(`[theme]\nname = 'nord' # x\nauto_switch = true\ncustom = { red = "#010203", accent = "#040506", light = { text = "#070809" } } # y\n[ui]\nstatus_indicators = "symbols"\nrows = [["a", "b"]]\nn = 3\n`)), want);
  assert.deepEqual(pick(parseToml(`theme = { name = "nord", auto_switch = true, custom.red = "#010203", custom.accent = "#040506", custom.light.text = "#070809" }\nui.status_indicators = "symbols"\n`)), want);
  assert.deepEqual(pick(parseToml(`theme.name = "nord"\ntheme.auto_switch = true\ntheme.custom.red = "#010203"\n[theme.custom]\naccent = "#040506"\nlight.text = "#070809"\n[[keys.command]]\nname = "x"\n[ui]\nstatus_indicators = "symbols"\n`)), want);
  const { palette } = resolve(parseToml(`[theme]\ncustom = { red = "#010203", accent = "#040506" }\n`));
  assert.equal(palette.red, 0x010203); assert.equal(palette.accent, 0x040506);
});

test("the review page takes the same theme, and follows the browser where herdr follows the terminal", () => {
  assert.equal(pageTheme({}, "herdr"), ":root{color-scheme:dark;--bg:#181825;--ink:#cdd6f4;--muted:#a6adc8;--line:#45475a;--accent:#89b4fa;--well:#313244;--ok:#a6e3a1;--bad:#f38ba8}");
  assert.match(pageTheme({ theme: { name: "gruvbox-light", custom: { green: "#010203" } } }, "auto"), /^:root\{color-scheme:light;--bg:#fbf1c7;--ink:#3c3836;.*--ok:#010203;--bad:#9d0006\}$/);
  assert.match(pageTheme({ theme: { name: "gruvbox" } }, "light"), /^:root\{color-scheme:light;--bg:#fbf1c7;/);
  const both = pageTheme({ theme: { name: "nord", auto_switch: true, light_name: "one-light" } }, "auto");
  assert.match(both, /^:root\{color-scheme:dark;--bg:#2e3440;.*\}@media \(prefers-color-scheme:light\)\{:root\{color-scheme:light;--bg:#fafafa;.*\}\}$/);
  // Colours given by name are kept on the page too; only the terminal theme's own colours give way to the browser's.
  assert.match(pageTheme({ theme: { custom: { green: "red", accent: "lightmagenta", text: "reset" } } }, "auto"), /--ink:#cdd6f4;.*--accent:#ff00ff;.*--ok:#cd0000;--bad:#f38ba8\}$/);
  assert.match(pageTheme({ theme: { name: "terminal", custom: { green: "red" } } }, "auto"), /--ok:#cd0000;--bad:#f38ba8\}@media.*--ok:#cd0000;--bad:#d20f39\}\}$/);
  for (const [c, w] of [[{ theme: { name: "terminal" } }, "auto"], [{}, "auto"], [{ theme: { name: "nord" } }, "terminal"]]) assert.match(pageTheme(c, w), /--bg:#181825;.*prefers-color-scheme:light.*--bg:#eff1f5;--ink:#4c4f69;/); // the terminal's colours mean the browser's
});

test("the whole of TOML is read, so nothing herdr accepts is lost", () => {
  // An inline table with a number in it, multi-line and escaped strings: all valid for herdr.
  const c = parseToml(`ui = { sidebar_width = 30, status_indicators = "symbols", accent = "magenta" }\n[theme]\nname = """tokyo-\\\n   night"""\ndark_name = "dr\\u0061cula"\nlight_name = \'\'\'\none-light\'\'\'\n[theme.custom]\n"red" = "\\U00000023f00" # c\n`);
  assert.deepEqual(c, { ui: { sidebar_width: 30, status_indicators: "symbols", accent: "magenta" }, theme: { name: "tokyo-night", dark_name: "dracula", light_name: "one-light", custom: { red: "#f00" } } });
  const r = resolve(c);
  assert.equal(r.symbols, true); assert.equal(r.name, "tokyo-night"); assert.equal(r.palette.accent, parseColor("magenta")); assert.equal(r.palette.red, 0xff0000);
  assert.deepEqual(parseToml(`a = [1, 2.5, -3e2, 0xff, 1_000, # c\n  true, "x", { b.c = 'y' },\n]\nd = 1979-05-27T07:32:00Z\ne = 1979-05-27 07:32:00 # c\nf = """a""b"""""\ng = "a\\tb\\"c\\\\"\n[[k.cmd]]\nkey = "x"\n[k.cmd.sub]\nz = inf\n[[k.cmd]]\nkey = "y"\n[h."i.j"]\n'k l' = false\n`),
    { a: [1, 2.5, -300, 255, 1000, true, "x", { b: { c: "y" } }], d: "1979-05-27T07:32:00Z", e: "1979-05-27 07:32:00", f: 'a""b""', g: 'a\tb"c\\', k: { cmd: [{ key: "x", sub: { z: Infinity } }, { key: "y" }] }, h: { "i.j": { "k l": false } } });
  for (const bad of ['a = "x', "a = ", "a b = 1", "[t\na = 1", 'a = "\\q"', "a = 1 2", "a = {b = 1", "a = nope"]) assert.throws(() => parseToml(bad), /TOML/, bad);
  assert.deepEqual(readHerdrConfig(cfg("this is = not toml [")), {});
  // No key reaches the objects every other part of the program shares.
  const evil = parseToml(`[__proto__]\nstatus_indicators = "symbols"\npolluted = true\n[constructor.prototype]\npolluted = true\n[a]\n__proto__ = { polluted = true }\n__proto__.x.polluted = true\ntoString = "t"\n[[__proto__.list]]\npolluted = true\n[ui]\n"__proto__".accent = "red"\n`);
  assert.equal({}.polluted, undefined); assert.equal({}.status_indicators, undefined); assert.equal([].polluted, undefined); assert.equal(Object.prototype.list, undefined); assert.equal(typeof {}.toString, "function");
  assert.equal(Object.getPrototypeOf(evil), Object.prototype); assert.equal(Object.getPrototypeOf(evil.a), Object.prototype);
  assert.ok(Object.hasOwn(evil, "__proto__") && Object.hasOwn(evil.a, "__proto__") && evil.a.toString === "t");
  assert.equal(resolve(evil).symbols, false); assert.equal(resolve(evil).palette.accent, 0x89b4fa);
  const real = process.env.HOME && path.join(process.env.HOME, ".config", "herdr", "config.toml");
  if (real && fs.existsSync(real)) assert.doesNotThrow(() => parseToml(fs.readFileSync(real, "utf8")));
});

test("a review that is running is a blue of its own in every theme: the theme's blue where that is told apart, else the board's", () => {
  const names = ["catppuccin", "catppuccin-latte", "tokyo-night", "tokyo-night-day", "dracula", "nord", "gruvbox", "gruvbox-light", "one-dark", "one-light", "solarized", "solarized-light", "kanagawa", "kanagawa-lotus", "rose-pine", "rose-pine-dawn", "vesper"];
  const rgb = (c) => [c >> 16, (c >> 8) & 255, c & 255], own = [];
  for (const name of names) {
    const p = resolve({ theme: { name } }, null, "herdr").palette, [r, g, b] = rgb(p.review);
    assert.ok(p.review === p.blue || p.review === REVIEW_BLUE, name); if (p.review === p.blue) own.push(name);
    assert.ok(isBlue(p.review) && b > r && b > g, `${name}: it is a blue`);
    // Told apart from all it sits beside: passed and ready (green), failed (red), the agent working (amber), herdr's
    // own dot for done and idle (teal), muted text (both greys), plain text, and the background it is drawn on.
    for (const k of REVIEW_BESIDE) assert.ok(apart(p.review, p[k]) >= REVIEW_APART, `${name}: review and ${k} are ${Math.round(apart(p.review, p[k]))} apart`);
  }
  // The theme's own blue is taken where it fits, in light themes and dark ones; where it is the theme's teal, its
  // green, a grey or near its muted text, the board's blue stands in.
  assert.deepEqual(own, ["catppuccin-latte", "gruvbox-light", "one-light", "solarized", "solarized-light"]);
  for (const name of ["catppuccin", "dracula", "rose-pine", "rose-pine-dawn", "vesper"]) assert.equal(resolve({ theme: { name } }, null, "herdr").palette.review, REVIEW_BLUE, name);
  // The terminal's own colours: its blue, which is none of its green, its cyan and its greys.
  { const p = resolve({}, null, "auto").palette; assert.equal(p.review, -16 + 4); for (const k of ["green", "red", "yellow", "teal", "subtext0", "overlay0"]) assert.notEqual(p.review, p[k], k); }
  assert.equal(resolve({ theme: { custom: { blue: "#0000ff" } } }, null, "herdr").palette.review, 0x0000ff); // a blue of your own is followed
  assert.equal(resolve({ theme: { custom: { blue: "#a6e3a1" } } }, null, "herdr").palette.review, REVIEW_BLUE); // one that is the theme's green is not
  // Colours of your own cannot take the blue away: a blue that is the red of what failed, or the agent's amber, is not
  // followed; the board's blue is not used where it is your teal; and with every one of the board's blues taken, it is
  // still a blue told apart from all it sits beside.
  // Nor can a `blue` that is no blue: a pale green, a purple, a grey, an orange, in a dark theme, a light one and the terminal's.
  for (const name of ["catppuccin", "catppuccin-latte", "terminal"]) for (const custom of [{ blue: "#f38ba8" }, { blue: "#f9e2af" }, { blue: "#a6e3a1", teal: "#3b82f6" }, { blue: "#a6e3a1" }, { blue: "#8839ef" }, { blue: "#808080" }, { blue: "#fe640b" }, { blue: "green" }, { blue: "magenta" }, { blue: "#3b82f6", red: "#3b82f6" }, { teal: "#3b82f6", green: "#1d4ed8", red: "#93c5fd", yellow: "#0000ff", text: "#6366f1", subtext0: "#0ea5e9" }]) {
    const p = resolve({ theme: { name, custom } }, null, "herdr").palette, [r, g, b] = rgb(p.review < 0 ? 0x0000ee : p.review);
    assert.ok(isBlue(p.review) && b > r && b > g, `${name} ${JSON.stringify(custom)}: it is a blue`);
    for (const k of REVIEW_BESIDE) assert.ok(apart(p.review, p[k]) >= REVIEW_APART, `${name} ${JSON.stringify(custom)}: review and ${k} are ${Math.round(apart(p.review, p[k]))} apart`);
  }
  assert.equal(resolve({ theme: { name: "catppuccin", custom: { blue: "#f38ba8" } } }, null, "herdr").palette.review, REVIEW_BLUE);
  assert.notEqual(resolve({ theme: { name: "catppuccin", custom: { blue: "#a6e3a1", teal: "#3b82f6" } } }, null, "herdr").palette.review, REVIEW_BLUE);
  { const p = resolve({ theme: { name: "terminal", custom: { blue: "red" } } }, null, "herdr").palette; assert.notEqual(p.review, p.red); assert.equal(p.review, REVIEW_BLUE); } // the terminal's colours too
  for (const name of ["catppuccin-latte", "terminal"]) assert.equal(resolve({ theme: { name, custom: { blue: "#a6e3a1", teal: "#3b82f6" } } }, null, "herdr").palette.review, 0x1d4ed8, name); // a pale green is no blue, and the board's first blue is your teal
  for (const [c, yes] of [[0x3b82f6, true], [0x076678, true], [-16 + 4, true], [-16 + 12, true], [0xa6e3a1, false], [0x8839ef, false], [0xff00ff, false], [0xb0b0b0, false], [0x94e2d5, false], [-16 + 2, false], [null, false]]) assert.equal(isBlue(c), yes, String(c));
  // Painted, it is its own text: never the green of passed, the amber of the agent, the teal of done or a grey.
  if (!process.env.NO_COLOR) for (const light of [false, true]) { loadTheme(); setTerminal(light); for (const c of ["green", "red", "yellow", "teal", "subtext0", "overlay0"]) assert.notEqual(theme.fg("review", "R#2"), theme.fg(c, "R#2"), c); assert.notEqual(theme.fg("review", "R#2"), "R#2"); }
});

test("the board paints with what it read: true colour, the terminal's 16 colours, herdr's marks", () => {
  const old = process.env.HERDR_CONFIG_PATH, noColor = process.env.NO_COLOR;
  try {
    delete process.env.NO_COLOR;
    process.env.HERDR_CONFIG_PATH = cfg(`[theme]\nname = "terminal"\nauto_switch = true\nlight_name = "catppuccin-latte"\n[ui]\nstatus_indicators = "symbols"\n`);
    assert.equal(loadTheme(), true);
    assert.equal(theme.fg("red", "x"), "\x1b[91mx\x1b[39m"); assert.equal(theme.fg("green", "x"), "\x1b[32mx\x1b[39m"); assert.equal(theme.fg("text", "x"), "x");
    assert.equal(theme.fg("yellow", "x"), "\x1b[33mx\x1b[39m"); assert.equal(theme.line("a"), "a");
    assert.equal(theme.muted("x"), "\x1b[2m\x1b[37mx\x1b[39m\x1b[22m"); // this theme's grey is most terminals' text colour: greyed-out words are faint too
    assert.equal(theme.selected("x"), "\x1b[100mx\x1b[49m"); // no selection colour in this theme: herdr's active row colour
    assert.deepEqual(["working", "blocked", "done", "idle", "error"].map(theme.mark), ["◐", "×", "✓", "○", "✗"]);
    setTerminal(true);
    assert.equal(theme.fg("red", "x"), "\x1b[38;2;210;15;57mx\x1b[39m"); assert.equal(theme.selected("x"), "\x1b[48;2;189;208;245mx\x1b[49m");
    process.env.HERDR_CONFIG_PATH = cfg("");
    assert.equal(loadTheme(), false); // the terminal's own colours, whatever they are: nothing to ask
    // A symbol of its own for each state is the board's default: no two states are told apart by colour alone.
    assert.deepEqual(["working", "blocked", "done", "idle", "error"].map(theme.mark), ["◐", "×", "✓", "○", "✗"]);
    process.env.HERDR_CONFIG_PATH = cfg(`[ui]\nstatus_indicators = "dots"\n`); loadTheme(); // herdr's dots only when its config asks for them by name
    assert.deepEqual(["working", "blocked", "done", "idle", "error"].map(theme.mark), ["●", "●", "●", "○", "✗"]);
    process.env.HERDR_CONFIG_PATH = cfg(""); loadTheme();
    // No theme set here: the terminal's colours and its own text colour.
    assert.equal(theme.fg("yellow", "x"), "\x1b[33mx\x1b[39m"); assert.equal(theme.fg("teal", "x"), "\x1b[36mx\x1b[39m"); assert.equal(theme.line("a b"), "a b");
    process.env.HERDR_CONFIG_PATH = cfg(`[theme]\nname = "catppuccin"\n`);
    assert.equal(loadTheme(), false); // no auto_switch: nothing to ask
    assert.equal(theme.muted("x"), "\x1b[38;2;108;112;134mx\x1b[39m"); // a theme with a grey of its own: that grey
    assert.equal(theme.fg("nonesuch", "x"), "x"); assert.equal(theme.dim("x"), "\x1b[2mx\x1b[22m");
    assert.equal(theme.fg("yellow", "x"), "\x1b[38;2;249;226;175mx\x1b[39m");
    // Uncoloured text is herdr's text colour, and stays so after a coloured word; a background survives resets too.
    const text = "\x1b[38;2;205;214;244m";
    assert.equal(theme.line(`a ${theme.fg("red", "b")} c`), `${text}a \x1b[38;2;243;139;168mb\x1b[39m${text} c\x1b[39m`);
    assert.equal(theme.under("sidebar_bg", "x"), "x"); // Catppuccin leaves the sidebar on the terminal's background
    process.env.HERDR_CONFIG_PATH = cfg(`[theme]\ncustom = { text = "#010203", sidebar_bg = "#040506" }\n`);
    loadTheme();
    assert.equal(theme.line("a"), "\x1b[38;2;1;2;3ma\x1b[39m");
    assert.equal(theme.under("sidebar_bg", `a${theme.bg("surface0", "b")}c`), "\x1b[48;2;4;5;6ma\x1b[48;2;49;50;68mb\x1b[49m\x1b[48;2;4;5;6mc\x1b[49m");
    process.env.NO_COLOR = "1";
    assert.equal(theme.line(`a ${theme.fg("red", "b")}`), "a b"); assert.equal(theme.under("sidebar_bg", "x"), "x"); assert.equal(theme.selected("x"), "x"); assert.equal(theme.bold("x"), "x");
  } finally {
    for (const [k, v] of [["HERDR_CONFIG_PATH", old], ["NO_COLOR", noColor]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    loadTheme();
  }
});

test("the review tag's colours are told apart in every theme, light and dark: passed, failed, the reviewer on it, no review result", () => {
  const names = ["catppuccin", "catppuccin-latte", "terminal", "tokyo-night", "tokyo-night-day", "dracula", "nord", "gruvbox", "gruvbox-light", "one-dark", "one-light", "solarized", "solarized-light", "kanagawa", "kanagawa-lotus", "rose-pine", "rose-pine-dawn", "vesper"];
  const said = ["passed", "failed", "the reviewer on it", "no result"];
  for (const name of names) {
    const p = resolve({ theme: { name } }, null, "herdr").palette, four = [p.green, p.red, p.review, p.subtext0];
    assert.equal(new Set(four).size, 4, `${name}: four colours`);
    // A theme's own colours: no two of them are near each other (the terminal's 16 are its own to tell apart).
    if (four.every((c) => c >= 0)) for (const a of [0, 1, 2, 3]) for (const b of [0, 1, 2, 3].slice(a + 1)) assert.ok(apart(four[a], four[b]) >= REVIEW_APART, `${name}: ${said[a]} and ${said[b]} are ${Math.round(apart(four[a], four[b]))} apart`);
  }
  // Painted, they come out as four different texts.
  if (!process.env.NO_COLOR) for (const light of [false, true]) { setTerminal(light); assert.equal(new Set(["green", "red", "review", "subtext0"].map((c) => theme.fg(c, "R#2"))).size, 4); }
});
