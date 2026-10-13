// The ? menu: every key of the board in its three groups, plain, ctrl and alt, each line with its key. All of it
// comes from ../keys.js. A ctrl or alt line can be picked, which does what its key does.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as K from "../keys.js";
import { clean } from "./words.js";

export class Menu {
  // The lines that can be picked: every ctrl and alt key, as it stands for the selected task right now.
  menuItems() {
    const r = this.current();
    if (this.automationsView) return this.autoMenuItems(); // the keys that do something in that list (automations.js)
    return K.KEYS.filter((k) => k.menu).map((k) => ({ id: k.id, group: k.group, key: K.name(k.id), label: k.menu(this, r), run: () => k.run(this, r) }));
  }
  menuKey(data) {
    const items = this.menuItems(), last = items.length - 1, m = this.menu;
    const enter = K.is(data, "enter");
    if (K.is(data, "back") || K.is(data, "close") || K.is(data, "menu")) { this.menu = null; return; }
    // On a short window ↓ past the last line scrolls what is under the list into view, and ↑ past the first what is
    // above it (see menuLines); each scrolls back before the pick moves again.
    if (K.is(data, "up")) this.menuStep(-1);
    else if (K.is(data, "down")) this.menuStep(1);
    else if (enter) { const pick = items[Math.min(m.at, last)]; this.menu = null; if (pick) pick.run(); }
    // any other key is neither swallowed into an action nor closes the menu
  }
  // One line up (-1) or down (1): the pick moves, and at either end what is cut there scrolls into view.
  menuStep(d) {
    const last = this.menuItems().length - 1, m = this.menu, more = m.more || 0;
    if (d < 0) { if (more > 0) m.more = more - 1; else if (m.at > 0) m.at--; else m.more = more - 1; }
    else if (more < 0) m.more = more + 1; else if (m.at < last) m.at++; else m.more = more + 1;
  }
  menuLines(width, h) {
    const t = this.theme, items = this.menuItems(), r = this.current();
    this.menu.at = Math.max(0, Math.min(this.menu.at, items.length - 1));
    const plain = this.automationsView ? this.autoPlainHelp() : K.KEYS.filter((k) => k.group === "plain" && k.help).map((k) => [K.name(k.id, true), K.say(k.help)]);
    const col = Math.max(8, ...[...plain.map(([k]) => k), ...items.map((i) => i.key)].map((k) => visibleWidth(k) + 2)); // 8 with the usual keys
    const cutTo = (d) => truncateToWidth(d, Math.max(8, width - col - 4), "…");
    const L = [" " + t.bold("menu") + (r ? t.fg("overlay0", `  for "${truncateToWidth(clean(r.title || r.id), Math.max(8, width - 16), "…")}"`) : ""), ""];
    let picked = 0;
    for (const [group, title] of K.GROUPS) {
      if (L.length > 2) L.push("");
      L.push(" " + t.fg("subtext0", title));
      if (group === "plain") L.push(...plain.map(([k, d]) => `   ${t.fg("text", k.padEnd(col))}${t.fg("overlay0", cutTo(d))}`));
      items.forEach((it, n) => {
        if (it.group !== group) return;
        if (n !== this.menu.at) return L.push(`   ${t.fg("text", it.key.padEnd(col))}${t.fg("overlay0", cutTo(it.label))}`);
        picked = L.length;
        L.push(this.hl(` ${t.fg("accent", "❯")} ${t.fg("text", it.key.padEnd(col))}${cutTo(it.label)}`, width));
      });
    }
    // What a row's review tag says: each state is named in its colour, the tag's own. In a narrow window it wraps,
    // word by word, so none of the three is cut off.
    const words = [["overlay0", "the review it is on or last had, coloured by where it stands:"], ["green", "passed,"], ["red", "failed,"], ["review", "the reviewer working"]].flatMap(([c, x]) => x.split(" ").map((w) => [c, w]));
    const legend = [[]], lineW = (l) => l.reduce((n, [, w]) => n + w.length + 1, -1), pad = col + 3;
    for (const w of words) { const l = legend.at(-1); if (l.length && pad + lineW(l) + 1 + w[1].length > width) legend.push([w]); else l.push(w); }
    L.push("", " " + t.fg("subtext0", "on a row"), ...legend.map((l, n) => (n ? " ".repeat(pad) : `   ${t.fg("text", "R#2".padEnd(col))}`) + l.map(([c, w]) => t.fg(c, w)).join(" ")));
    // The picked line stays in view on a short window. What is above the list (the plain keys) or under it (the
    // review tag) is cut there: ↓ on the last line scrolls on down to it, a line at a time, and ↑ on the first up.
    const body = L.slice(1), from = picked < h ? 0 : picked - h + 1;
    const start = Math.max(0, Math.min(Math.max(from, body.length - (h - 1)), from + (this.menu.more || 0)));
    this.menu.more = start - from;
    return [L[0], ...body.slice(start)];
  }
}
