// The ? menu: lines you act from, and under them the few keys worth remembering.
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import * as A from "../../actions.js";
import { short, clean } from "./words.js";

// The keys worth remembering. Everything else is a line in the menu.
const KEYS = [
  ["↑ ↓", "move between tasks"], ["enter", "send, or open the agent"], ["space", "talk to this task's agent"], ["tab", "put an agent on it"],
  ["ctrl+a", "yes: approve, retry, continue"], ["y  n", "answer a question: y yes, n or esc no (enter never confirms)"], ["ctrl+r", "send it back to fix"], ["ctrl+x", "stop the agent"], ["ctrl+f", "find"], ["ctrl+p", "side panel, on or off"], ["ctrl+e", "the whole task, full screen"], ["?", "this menu"], ["esc", "one step back: the chat's message first"], ["ctrl+c", "twice: close the board"],
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
    if (matchesKey(data, "up")) this.menu.at = Math.max(0, this.menu.at - 1);
    else if (matchesKey(data, "down")) this.menu.at = Math.min(items.length - 1, this.menu.at + 1);
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
    // The picked line stays in view on a short window.
    const at = first + this.menu.at;
    return at < h ? L : [L[0], ...L.slice(at - h + 2)];
  }
}
