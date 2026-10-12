// The first run: one screen asks what the plugin may add to herdr's settings.
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import * as X from "../../extras.js";
import { herdr, inHerdr } from "../../herdr.js";
import { short } from "./words.js";
import { name as keyName, is as isKey } from "../keys.js";

export class Setup {
  // The first run: one screen asks what the plugin may add to herdr's settings. Only inside herdr, only what is missing.
  startSetup() {
    if ((!inHerdr() && !process.env.HERDR_PLUGIN_ID) || process.env.HERDR_SUPERWORK_INLINE === "1") return;
    const o = this.ctx.offers ? this.ctx.offers() : X.offers();
    if (o.asked) return;
    if (!o.key && !o.sidebar) { X.answer({}); return; }
    this.setup = { file: o.file, typing: false, key: o.key ? { on: !!o.key.suggest, value: o.key.suggest || "", note: o.key.note || "" } : null, sidebar: o.sidebar ? { on: true } : null };
  }
  // Single keys: 1 and 2 switch a choice on or off, k types another key, enter saves both, esc asks again next time.
  setupKey(data) {
    const st = this.setup;
    const enter = isKey(data, "enter");
    const esc = isKey(data, "back") || isKey(data, "close");
    if (st.typing) {
      if (esc) { st.typing = false; return this.setValue(""); }
      if (!enter) return this.input.handleInput(data);
      const v = this.value().trim().toLowerCase();
      // A key herdr or the config already uses is refused here, with what it does today: it is never kept.
      const c = v ? (this.ctx.checkKey || X.checkKey)(v) : { ok: true };
      if (!c.ok) { this.setValue(""); return this.flash(c.msg, "red"); }
      st.typing = false; this.setValue(""); this.msg = ""; // a refusal shown for the last try is over
      if (v) { st.key.value = v; st.key.on = true; st.key.note = ""; }
      return;
    }
    if (esc) { this.setup = null; return this.flash("Asked again next time. Nothing was changed."); }
    if (data === "1" && st.key) { if (!st.key.value) { st.typing = true; return; } st.key.on = !st.key.on; return; }
    if (data === "2" && st.sidebar) { st.sidebar.on = !st.sidebar.on; return; }
    if ((data === "k" || data === "K") && st.key) { st.typing = true; this.setValue(""); return; }
    if (!enter) return;
    const add = this.ctx.addBlock || X.addBlock;
    const said = [];
    // Each choice is saved as soon as it is settled, so one that herdr refuses is the only one asked again.
    for (const what of ["key", "sidebar"]) {
      const c = st[what];
      if (!c) continue;
      if (!c.on) { X.answer(what === "key" ? { key: "no" } : { sidebarAnswer: "no" }); st[what] = null; continue; }
      const r = add(what, what === "key" ? c.value : undefined);
      if (!r.ok && !r.paste) return this.flash(r.msg, "red"); // refused: the screen stays, with the reason
      X.answer(what === "key" ? { key: r.ok ? c.value : "paste" } : { sidebarAnswer: r.ok ? "yes" : "paste" });
      st[what] = null;
      if (r.paste) this.pasteText = [this.pasteText, r.msg].filter(Boolean).join("\n\n");
      else said.push(what === "key" ? `${c.value} opens the board` : "herdr's sidebar shows each task's stage");
    }
    X.answer({});
    this.setup = null;
    this.flash(said.length ? `Added to ${short(st.file)}: ${said.join("; ")}. \`herdr-superwork remove-extras\` undoes it.` : "Nothing was added.", said.length ? "green" : "overlay0");
  }
  setupLines(width, rowsN) {
    const t = this.theme, st = this.setup;
    const wrap = (text, indent = "  ") => wrapTextWithAnsi(text, Math.max(10, width - 2 - indent.length)).map((l) => indent + l);
    const box = (on) => (on ? t.fg("green", "[x]") : t.fg("overlay0", "[ ]"));
    const L = ["", "  " + t.bold("herdr-superwork · first run"), "", ...wrap(t.fg("subtext0", "Two things the board can add to herdr's settings. Both are optional."))];
    if (st.key) L.push("", ...wrap(`${t.fg("accent", "1")}  ${box(st.key.on)} ${st.key.value ? `Open this board with ${t.bold(st.key.value)}, from anywhere in herdr` : "Open this board with a key of your own (1 or k: type it)"}`), ...(st.key.note ? wrap(t.fg("yellow", st.key.note), "         ") : []), ...(st.key.value ? wrap(t.fg("overlay0", "k: use another key"), "         ") : []));
    if (st.sidebar) L.push("", ...wrap(`${t.fg("accent", "2")}  ${box(st.sidebar.on)} Show each task's stage, and what it is doing, in herdr's sidebar`));
    L.push("", ...wrap(t.fg("overlay0", `Saved in ${short(st.file)} between two marker lines. The file is backed up first, and herdr-superwork remove-extras takes it all out again.`)), "");
    if (st.typing) L.push(`  ${t.fg("accent", "the key ❯")} ${this.value() || t.fg("overlay0", "for example prefix+a")}`, "", ...wrap(t.fg("overlay0", `${keyName("enter")} keeps it · ${keyName("back")} back`)));
    else L.push(...wrap(`${t.fg("text", "1 2")}${t.fg("overlay0", " on or off · ")}${t.fg("text", keyName("enter"))}${t.fg("overlay0", " save · ")}${t.fg("text", keyName("back"))}${t.fg("overlay0", " ask me next time")}`));
    if (this.msg) L.push("", ...wrap(t.fg(this.msgKind, this.msg)));
    return this.pad(L, rowsN);
  }
}
