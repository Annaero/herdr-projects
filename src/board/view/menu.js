// The ? menu: lines you act from, and under them the few keys worth remembering. Both come from ../keys.js.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import * as K from "../keys.js";
import { short, clean } from "./words.js";

export class Menu {
  // Everything that is not one of the keys worth remembering: a list to pick from, for the selected task. Each line
  // is a key's own (its `menu` in ../keys.js); its chord still works on the board, and is shown beside it.
  menuItems() {
    const r = this.current(), j = this.job();
    const it = [];
    const add = (label, key, run, on = true) => { if (on) it.push({ label, key, run }); };
    for (const k of K.KEYS) { const label = k.menu?.(this, r, j); if (label) add(label, K.name(k.id), () => k.run(this, r)); }
    // Other machines: each stop by name, so nothing is cycled through blind.
    const far = Object.keys(this.remotes).filter((k) => this.remotes[k].ok).sort();
    const here = (s) => (this.scope === s ? " (now)" : "");
    add(`this machine only${here("")}`, K.name("scope"), () => this.setScope(""), this.all);
    add(`every machine${here("*")}`, this.all ? "" : K.name("scope"), () => this.setScope("*"), this.scope !== "*" && S.config().machines !== "off");
    for (const k of far) add(`only ${k}${here(k)}`, "", () => this.setScope(k), this.scope !== k);
    return it;
  }
  menuKey(data) {
    const items = this.menuItems();
    const enter = K.is(data, "enter");
    if (K.is(data, "back") || K.is(data, "close") || K.is(data, "menu")) { this.menu = null; return; }
    // Past the last line ↓ scrolls what is under the list into view (see menuLines); ↑ scrolls back first.
    if (K.is(data, "up")) { if (this.menu.more > 0) this.menu.more--; else this.menu.at = Math.max(0, this.menu.at - 1); }
    else if (K.is(data, "down")) { if (this.menu.at < items.length - 1) this.menu.at++; else this.menu.more = (this.menu.more || 0) + 1; }
    else if (enter) { const pick = items[Math.min(this.menu.at, items.length - 1)]; this.menu = null; if (pick) pick.run(); }
    // any other key is neither swallowed into an action nor closes the menu
  }
  // The ? menu: lines you act from, and under them the few keys worth remembering.
  menuLines(width, h) {
    const t = this.theme, items = this.menuItems(), r = this.current();
    this.menu.at = Math.max(0, Math.min(this.menu.at, items.length - 1));
    const kw = Math.max(...items.map((i) => visibleWidth(i.label))) + 3;
    const L = [" " + t.bold("menu") + (r ? t.fg("overlay0", `  for "${truncateToWidth(clean(r.title || r.id), Math.max(8, width - 16), "…")}"`) : ""), ""];
    const first = L.length;
    items.forEach((it, n) => { const line = ` ${n === this.menu.at ? t.fg("accent", "❯") : " "} ${it.label.padEnd(kw)}${t.fg("overlay0", it.key)}`; L.push(n === this.menu.at ? this.hl(line, width) : line); });
    const keys = K.remembered(), col = Math.max(8, ...keys.map(([k]) => visibleWidth(k) + 2)); // 8 with the usual keys
    L.push("", " " + t.fg("subtext0", "keys"), ...keys.map(([k, d]) => `   ${t.fg("text", k.padEnd(col))}${t.fg("overlay0", d)}`));
    // What a row's review tag says: each state is named with its mark, in its colour. In a narrow window it wraps,
    // word by word, so none of the three is cut off.
    const words = [["overlay0", "the review it is on or last had:"], ["green", "✓ passed,"], ["red", "✗ failed,"], ["review", "no mark: running now"]].flatMap(([c, x]) => x.split(" ").map((w) => [c, w]));
    const legend = [[]], lineW = (l) => l.reduce((n, [, w]) => n + w.length + 1, -1), pad = col + 3;
    for (const w of words) { const l = legend.at(-1); if (l.length && pad + lineW(l) + 1 + w[1].length > width) legend.push([w]); else l.push(w); }
    L.push("", " " + t.fg("subtext0", "on a row"), ...legend.map((l, n) => (n ? " ".repeat(pad) : `   ${t.fg("text", "R#2".padEnd(col))}`) + l.map(([c, w]) => t.fg(c, w)).join(" ")));
    // The picked line stays in view on a short window. What is under the list (the keys, the review tag) is cut
    // there: ↓ on the menu's last line scrolls on down to it, a line at a time, and ↑ comes back the same way.
    const body = L.slice(1), from = first + this.menu.at < h ? 0 : first + this.menu.at - h + 1;
    const start = Math.min(Math.max(from, body.length - (h - 1)), from + (this.menu.more || 0));
    this.menu.more = start - from;
    return [L[0], ...body.slice(start)];
  }
}
