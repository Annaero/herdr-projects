// The ? menu: every key of the board in its three groups, plain, ctrl and alt, each line with its key. All of it
// comes from ../keys.js. A ctrl or alt line can be picked, which does what its key does.
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import * as K from "../keys.js";
import { AUTO_HELP } from "./automations.js";
import { AUTO_MARK, AUTO_OFF } from "./automation-rows.js";

export class Menu {
  // The lines that can be picked: every ctrl and alt key, as it stands for the selected task right now.
  menuItems() {
    const r = this.current();
    const a = this.auto();
    if (a) return this.autoMenuItems(a); // the keys that do something on an automation's row (automations.js)
    return K.KEYS.filter((k) => k.menu).map((k) => ({ id: k.id, group: k.group, key: K.name(k.id), label: k.menu(this, r), run: () => k.run(this, r) })).filter((i) => i.label); // a key that does nothing right now has no line
  }
  menuKey(data) {
    const items = this.menuItems(), m = this.menu;
    const enter = K.is(data, "enter");
    if (K.is(data, "back") || K.is(data, "close") || K.is(data, "menu")) { this.menu = null; return; }
    if (K.is(data, "up")) this.menuStep(-1);
    else if (K.is(data, "down")) this.menuStep(1);
    else if (K.is(data, "pageUp") || K.is(data, "pageDown")) { m.top = Math.max(0, Math.min(m.maxTop ?? 0, (m.top || 0) + (K.is(data, "pageUp") ? -1 : 1) * 8)); m.over = 0; m.follow = false; }
    // The menu opens with no line picked, so enter right after ? does nothing (it once approved a merge).
    else if (enter) { const pick = items[m.at]; if (!pick) return; this.menu = null; pick.run(); }
    // any other key is neither swallowed into an action nor closes the menu
  }
  // One line up (-1) or down (1): the pick moves and stays in view; past the last line, or above the first, what is
  // cut there scrolls into view a line at a time.
  // `over`: how far it is scrolled past the pick (below the last line: more than 0; above the first: less). Each
  // scrolls back, the way it came, before the pick moves again.
  menuStep(d) {
    const last = this.menuItems().length - 1, m = this.menu, over = m.over || 0;
    const scroll = () => { const to = (m.top || 0) + d; if (to < 0 || to > (m.maxTop ?? Infinity)) return; m.top = to; m.over = over + d; m.follow = false; };
    if (d > 0) { if (over < 0) scroll(); else if (m.at < last) { m.at++; m.follow = true; } else scroll(); }
    else if (over > 0) scroll(); else if (m.at > 0) { m.at--; m.follow = true; } else scroll();
  }
  // Every line whole: an explanation longer than the window wraps under itself, never cut. Where the menu is longer
  // than its room, its last line says how many lines are below (and its first, above).
  menuLines(width, h) {
    const t = this.theme, items = this.menuItems(), r = this.current(), m = this.menu;
    m.at = Math.max(-1, Math.min(m.at, items.length - 1));
    const auto = this.auto(); // on an automation's row a few plain keys do something else (automations.js)
    const plain = K.KEYS.filter((k) => k.group === "plain" && k.help).map((k) => [K.name(k.id, true), K.say((auto && AUTO_HELP[k.id]) || k.help)]);
    const col = Math.max(8, ...[...plain.map(([k]) => k), ...items.map((i) => i.key), "65% 2m left"].map((k) => visibleWidth(k) + 2)); // the widest key, or what stands in its place under "on a row"
    const room = Math.max(8, width - col - 4);
    // A key and what it does: the words wrap under their own start.
    const entry = (key, words, lead = "   ") => wrapTextWithAnsi(words, room).map((l, n) => lead + (n ? " ".repeat(col) : t.fg("text", key.padEnd(col))) + t.fg("overlay0", l));
    const title = " " + t.bold("Menu") + (r || auto ? t.fg("overlay0", `  for ${truncateToWidth(r ? this.nameSay(r, 60) : `the automation "${auto.name}"`, Math.max(8, width - 12), "…")}`) : "");
    const L = [];
    let picked = [0, 0];
    for (const [group, name] of K.GROUPS) {
      if (L.length) L.push("");
      L.push(" " + t.fg("subtext0", name));
      if (group === "plain") for (const [k, d] of plain) L.push(...entry(k, d));
      items.forEach((it, n) => {
        if (it.group !== group) return;
        if (n !== m.at) return L.push(...entry(it.key, it.label));
        const lines = wrapTextWithAnsi(it.label, room).map((l, at) => this.hl(` ${at ? " " : t.fg("accent", "❯")} ${at ? " ".repeat(col) : t.fg("text", it.key.padEnd(col))}${l}`, width));
        picked = [L.length, L.length + lines.length];
        L.push(...lines);
      });
    }
    // What a row shows: each mark in its colour with its word, the numbers on the right, and the tags.
    const marks = [["yellow", t.mark("working"), "an agent works"], ["review", t.mark("review"), "its reviewer works"], ["check", t.mark("board"), "the board works on it (starts, checks, merges)"], ["red", t.mark("blocked", "question"), "asks you"], ["red", t.mark("blocked", "permission"), "asks for your OK"], ["red", t.mark("blocked", "auth"), "needs a login"], ["red", t.mark("error"), "went wrong"], ["green", t.mark("ready"), "ready to approve"], ["teal", t.mark("done"), "done"], ["todo", t.mark("idle"), "to do"]];
    const legend = [];
    L.push("", " " + t.fg("subtext0", "on a row"));
    for (const [c, mark, words] of marks) L.push(`   ${t.fg(c, mark.padEnd(col))}${t.fg("overlay0", words)}`);
    L.push(`   ${t.fg("auto", AUTO_MARK.padEnd(col))}${t.fg("overlay0", `an automation (${AUTO_OFF} while it is off; the word after it says on or off)`)}`);
    L.push(...entry("65% 2m left", "how far it is, and the time left; the time after it is how long it has worked, or how long ago it stopped"));
    // What a row's review tag says: each state is named in its colour, the tag's own.
    const words = [["overlay0", "the review it is on or last had, coloured by where it stands:"], ["green", "passed,"], ["red", "failed,"], ["review", "the reviewer working"]].flatMap(([c, x]) => x.split(" ").map((w) => [c, w]));
    const lineW = (l) => l.reduce((n, [, w]) => n + w.length + 1, -1), pad = col + 3;
    legend.push([]);
    for (const w of words) { const l = legend.at(-1); if (l.length && pad + lineW(l) + 1 + w[1].length > width) legend.push([w]); else l.push(w); }
    L.push(...legend.map((l, n) => (n ? " ".repeat(pad) : `   ${t.fg("text", "R#2".padEnd(col))}`) + l.map(([c, w]) => t.fg(c, w)).join(" ")));
    L.push(...entry("PR#16", "its pull request: green when its checks pass, red when they fail"), ...entry("[auto]", "made by an automation; [research]: research only, nothing is merged"));
    // The window: the title stays, and the picked line stays in view while the pick moves.
    const space = Math.max(1, h - 1), cut = L.length > space, view = cut ? Math.max(1, space - 1) : space;
    let top = Math.max(0, Math.min(m.top || 0, L.length - view));
    if (m.follow && m.at >= 0) { if (picked[0] < top) top = picked[0]; if (picked[1] > top + view) top = picked[1] - view; }
    m.top = top; m.follow = false; m.maxTop = Math.max(0, L.length - view);
    const below = L.length - top - view, note = [below > 0 && `↓ ${below} more`, top > 0 && `↑ ${top} more`].filter(Boolean).join(" · ");
    return [title, ...L.slice(top, top + view), ...(cut ? [" " + t.fg("overlay0", note)] : [])];
  }
}
