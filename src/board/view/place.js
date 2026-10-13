// Where this board is, and what follows from it: the popup keeps its own selection, filter and draft apart from a
// board in a tab, it opens on the task you were looking at, and a line left for this board by the board key is shown.
import fs from "node:fs";
import path from "node:path";
import * as S from "../../store.js";
import { taskAt } from "../popup.js";
import { heard } from "../say.js";
import { name as keyName } from "../keys.js";

export class Place {
  // What the board was like when it last closed. The popup has a file of its own: a board may run in a tab at the
  // same time, and each keeps its own selection and its own words. The first popup starts from the tab's view,
  // without its draft.
  readPrefs() {
    const tab = path.join(S.dataDir(), "view.json");
    if (!this.ctx.popup) { this.prefs = tab; return S.readJson(tab) || {}; }
    this.prefs = path.join(S.dataDir(), "view-popup.json");
    const own = S.readJson(this.prefs);
    if (own) return own;
    const { draft, away, ...rest } = S.readJson(tab) || {};
    return rest;
  }
  // The popup opens wherever you are, and what you type is sent from the repo of that place. Words left in the box
  // when it closed were typed for the repo it was in then: while they are there the board stays in that repo, and
  // says so, so that enter never sends them from another one.
  keepDraftHome(prefs) {
    if (String(prefs.draft || "").trim()) this.toRepoOf(String(prefs.cwd || ""));
  }
  // The same for words that were put away: brought back, the board goes to the repo they were typed for.
  // (`away.cwd`: where that was; words put away since this board opened were typed where it is.)
  awayHome(d) { if (!d.to) this.toRepoOf(String(d.cwd || "")); }
  toRepoOf(was) {
    if (!this.ctx.popup || !was || was === this.ctx.cwd) return;
    // Its folder is gone (removed, or moved): there is no repo to stay in, so the board says where the words go now.
    if (!fs.existsSync(was)) return this.flash(`What you typed was for ${path.basename(was)}, a folder that is gone. Sent now, it goes from ${path.basename(this.ctx.cwd)}; ${keyName("back")} puts it away.`, "yellow");
    let same = false;
    try { same = S.repoOf(was).name === S.repoOf(this.ctx.cwd).name; } catch {}
    this.ctx.cwd = was;
    try { this.repo = S.repoOf(was); } catch {}
    if (!same) this.flash(`What you typed was for ${path.basename(was)}, so the board is there now. Once it is sent or put away, it opens where you are.`, "yellow");
  }
  // The popup opens on the task that belongs to where you are: the one whose agent, or reviewer, runs in the pane
  // you opened it from. Its row stays while you look at it, also when the filter would hide it. A view of one other
  // machine only, left from last time, would hide it too (and the chat would talk to that machine): this machine's
  // tasks are shown instead. A view of every machine has it and is kept.
  openWhereYouAre() {
    if (!this.ctx.popup || !this.ctx.from) return;
    const t = taskAt(this.ctx.from);
    if (!t || t.archivedAt) return;
    this.sel = t.id; this.stick = t.id;
    if (this.scope && this.scope !== "*") this.scope = "";
  }
  // A line the board key left for this board (../say.js), on the message line.
  hear() {
    const n = heard(this.ctx.ownPane);
    if (n) { this.flash(n.text, n.kind); this.tui.requestRender(); }
  }
}
