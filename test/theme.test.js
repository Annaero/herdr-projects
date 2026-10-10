// The board takes its colours and status marks from herdr's own config, resolved the way herdr resolves them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseToml } from "../src/toml.js";
import { readHerdrConfig, resolve, parseColor, loadTheme, setLight, theme, pageTheme } from "../src/board/theme.js";

const cfg = (text) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hsw-theme-")), "config.toml"); fs.writeFileSync(f, text); return f; };

test("with no theme set, the board uses herdr's default: Catppuccin and dots", () => {
  const { name, palette, symbols } = resolve(readHerdrConfig(cfg("onboarding = false\n[ui]\n")));
  assert.equal(name, "catppuccin"); assert.equal(symbols, false);
  assert.equal(palette.accent, 0x89b4fa); assert.equal(palette.yellow, 0xf9e2af); assert.equal(palette.red, 0xf38ba8); assert.equal(palette.teal, 0x94e2d5); assert.equal(palette.green, 0xa6e3a1);
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
  const used = new Set(["view.js", "editor.js", "artifact-lines.js"].flatMap((f) => [...fs.readFileSync(new URL(`../src/board/${f}`, import.meta.url), "utf8").matchAll(/\b(?:fg|bg|under)\(([^,()]+),/g)].flatMap((m) => m[1].replace(/[!=]== "[^"]*"/g, "").match(/"[a-z0-9_]+"/g) || [])));
  const known = Object.keys(resolve().palette);
  assert.ok(used.size > 8); for (const name of used) assert.ok(known.includes(JSON.parse(name)), `${name} is not a herdr colour`);
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
  assert.equal(pageTheme({}, "auto"), ":root{color-scheme:dark;--bg:#181825;--ink:#cdd6f4;--muted:#a6adc8;--line:#45475a;--accent:#89b4fa;--well:#313244;--ok:#a6e3a1;--bad:#f38ba8}");
  assert.match(pageTheme({ theme: { name: "gruvbox-light", custom: { green: "#010203" } } }, "auto"), /^:root\{color-scheme:light;--bg:#fbf1c7;--ink:#3c3836;.*--ok:#010203;--bad:#9d0006\}$/);
  assert.match(pageTheme({ theme: { name: "gruvbox" } }, "light"), /^:root\{color-scheme:light;--bg:#fbf1c7;/);
  const both = pageTheme({ theme: { name: "nord", auto_switch: true, light_name: "one-light" } }, "auto");
  assert.match(both, /^:root\{color-scheme:dark;--bg:#2e3440;.*\}@media \(prefers-color-scheme:light\)\{:root\{color-scheme:light;--bg:#fafafa;.*\}\}$/);
  // Colours given by name are kept on the page too; only the terminal theme's own colours give way to the browser's.
  assert.match(pageTheme({ theme: { custom: { green: "red", accent: "lightmagenta", text: "reset" } } }, "auto"), /--ink:#cdd6f4;.*--accent:#ff00ff;.*--ok:#cd0000;--bad:#f38ba8\}$/);
  assert.match(pageTheme({ theme: { name: "terminal", custom: { green: "red" } } }, "auto"), /--ok:#cd0000;--bad:#f38ba8\}@media.*--ok:#cd0000;--bad:#d20f39\}\}$/);
  assert.match(pageTheme({ theme: { name: "terminal" } }, "auto"), /--bg:#181825;.*prefers-color-scheme:light.*--bg:#eff1f5;--ink:#4c4f69;/); // the terminal's colours mean the browser's
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

test("the board paints with what it read: true colour, the terminal's 16 colours, herdr's marks", () => {
  const old = process.env.HERDR_CONFIG_PATH, noColor = process.env.NO_COLOR;
  try {
    delete process.env.NO_COLOR;
    process.env.HERDR_CONFIG_PATH = cfg(`[theme]\nname = "terminal"\nauto_switch = true\nlight_name = "catppuccin-latte"\n[ui]\nstatus_indicators = "symbols"\n`);
    assert.equal(loadTheme(), true);
    assert.equal(theme.fg("red", "x"), "\x1b[91mx\x1b[39m"); assert.equal(theme.fg("green", "x"), "\x1b[32mx\x1b[39m"); assert.equal(theme.fg("text", "x"), "x");
    assert.equal(theme.selected("x"), "\x1b[100mx\x1b[49m"); // no selection colour in this theme: herdr's active row colour
    assert.deepEqual(["working", "blocked", "done", "idle", "error"].map(theme.mark), ["◐", "×", "✓", "○", "✗"]);
    setLight(true);
    assert.equal(theme.fg("red", "x"), "\x1b[38;2;210;15;57mx\x1b[39m"); assert.equal(theme.selected("x"), "\x1b[48;2;189;208;245mx\x1b[49m");
    process.env.HERDR_CONFIG_PATH = cfg("");
    assert.equal(loadTheme(), false);
    assert.deepEqual(["working", "blocked", "done", "idle", "error"].map(theme.mark), ["●", "●", "●", "○", "✗"]);
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
