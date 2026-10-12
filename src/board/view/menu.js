// The ? menu: lines you act from, and under them the few keys worth remembering.
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import * as A from "../../actions.js";
import { short, clean } from "./words.js";

// The keys worth remembering. Everything else is a line in the menu.
const KEYS = [
  ["↑ ↓", "move between tasks"], ["enter", "send, or open the agent"], ["space", "talk to this task's agent, or back to the Coordinator"], ["tab", "put an agent on it"],
  ["ctrl+a", "yes: approve, retry, continue"], ["y  n", "answer a question: y yes, n or esc no (enter never confirms)"], ["ctrl+r", "send it back to fix"], ["ctrl+x", "stop the agent"], ["ctrl+f", "find"], ["ctrl+p", "side panel, on or off"], ["ctrl+e", "the whole task, full screen"], ["?", "this menu"], ["esc", "one step back: a draft, find, the whole task, the filter, the archive"], ["ctrl+c", "twice: close the board"],
];

export class Menu {
  // Everything that is not one of the ten keys: a list to pick from, for the selected task. The old chord of each
  // line still works on the board, and is shown beside it.
  menuItems() {
    const r = this.current(), j = this.job();
    const it = [];
    const add = (label, key, run, on = true) => { if (on) it.push({ label, key, run }); };
    add(this.full ? "back to the list" : "show the whole task panel", "ctrl+e", () => (this.full ? this.foldPanel() : this.openPanel()), !!(r || j));
    add(r?.archivedAt ? "restore from the archive" : "archive", "alt+a", () => this.archiveSelected(r), !!r);
    add(r?.pinned ? "unpin" : "pin to the top", "ctrl+t", () => (r.host ? this.act(r, "pin") : this.try(() => A.pin(r.id))), !!r && !r.archivedAt);
    add("delete", "delete", () => this.remove(r), !!r);
    add(this.draftAway ? "bring back what you typed" : "undo the archive", "ctrl+z", () => this.undo(), !!this.draftAway || !!this.archiveUndo);
    add(this.archiveView ? "back to the board" : "open the archive", "alt+h", () => this.toggleArchive());
    add(this.side ? "hide the side panel" : "show the side panel", "ctrl+p", () => this.toggleSide(), !this.full);
    add(this.byRepo ? "group by state" : "group by repo", "ctrl+s", () => { this.byRepo = !this.byRepo; this.savePrefs(); this.load(); });
    add(this.allDone ? "show only the latest done" : "show all done", "ctrl+d", () => { this.allDone = !this.allDone; this.load(); });
    // The chat's own lines: for whoever it talks to now.
    const who = this.chatOf(r);
    add(this.reply && r ? "open this agent's chat" : "open the Coordinator's chat", "alt+c", () => this.openChat(), !!who?.enter);
    add(this.chatOpen ? "hide the latest message in the chat" : "show the latest message in the chat", "alt+v", () => this.toggleChat(), !!who?.said);
    add("restart the Coordinator", "alt+r", () => this.coordAct("restart"), !this.reply && this.canDispatch && this.coord.state !== "none");
    add("start a new Coordinator", "alt+n", () => this.coordAct("new"), !this.reply && this.canDispatch && this.coord.state !== "none");
    // Other machines: each stop by name, so nothing is cycled through blind.
    const far = Object.keys(this.remotes).filter((k) => this.remotes[k].ok).sort();
    const here = (s) => (this.scope === s ? " (now)" : "");
    add(`this machine only${here("")}`, "ctrl+o", () => this.setScope(""), this.all);
    add(`every machine${here("*")}`, this.all ? "" : "ctrl+o", () => this.setScope("*"), this.scope !== "*" && S.config().machines !== "off");
    for (const k of far) add(`only ${k}${here(k)}`, "", () => this.setScope(k), this.scope !== k);
    return it;
  }
  menuKey(data) {
    const items = this.menuItems();
    const enter = matchesKey(data, "return") || matchesKey(data, "enter");
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "?") { this.menu = null; return; }
    // Past the last line ↓ scrolls what is under the list into view (see menuLines); ↑ scrolls back first.
    if (matchesKey(data, "up")) { if (this.menu.more > 0) this.menu.more--; else this.menu.at = Math.max(0, this.menu.at - 1); }
    else if (matchesKey(data, "down")) { if (this.menu.at < items.length - 1) this.menu.at++; else this.menu.more = (this.menu.more || 0) + 1; }
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
    L.push("", " " + t.fg("subtext0", "keys"), ...KEYS.map(([k, d]) => `   ${t.fg("text", k.padEnd(8))}${t.fg("overlay0", d)}`));
    // What a row's review tag says: each state is named with its mark, in its colour. In a narrow window it wraps,
    // word by word, so none of the three is cut off.
    const words = [["overlay0", "the review it is on or last had:"], ["green", "✓ passed,"], ["red", "✗ failed,"], ["review", "no mark: running now"]].flatMap(([c, x]) => x.split(" ").map((w) => [c, w]));
    const legend = [[]], lineW = (l) => l.reduce((n, [, w]) => n + w.length + 1, -1), pad = 11;
    for (const w of words) { const l = legend.at(-1); if (l.length && pad + lineW(l) + 1 + w[1].length > width) legend.push([w]); else l.push(w); }
    L.push("", " " + t.fg("subtext0", "on a row"), ...legend.map((l, n) => (n ? " ".repeat(pad) : `   ${t.fg("text", "R#2".padEnd(8))}`) + l.map(([c, w]) => t.fg(c, w)).join(" ")));
    // The picked line stays in view on a short window. What is under the list (the keys, the review tag) is cut
    // there: ↓ on the menu's last line scrolls on down to it, a line at a time, and ↑ comes back the same way.
    const body = L.slice(1), from = first + this.menu.at < h ? 0 : first + this.menu.at - h + 1;
    const start = Math.min(Math.max(from, body.length - (h - 1)), from + (this.menu.more || 0));
    this.menu.more = start - from;
    return [L[0], ...body.slice(start)];
  }
}
