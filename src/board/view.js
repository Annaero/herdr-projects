// The board: pi-work's screen, powered by herdr. Every row is one task. Type to file one, Tab to put an agent on it.
// Layout and selection rules follow pi-work's view; what differs is forced by "powered by herdr": going into a
// task focuses its agent's real pane (the board exits), and the preview reads that pane through herdr.
import { CURSOR_MARKER, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as S from "../store.js";
import * as A from "../actions.js";
import * as F from "../flow.js";
import * as H from "../helpers.js";
import * as R from "../remote.js";
import { herdr, currentSocket, inHerdr, readScreen, sessionName } from "../herdr.js";
import { housekeeping } from "../housekeeping.js";
import { fullAccess, adapter } from "../agents.js";
import { keeperAlive, tickOnce, codeStamp } from "../keeper.js";
import * as X from "../extras.js";
import * as D from "../delegate.js";
import { DraftEditor } from "./editor.js";
import { lookHeld } from "./held.js";
import { artifactLine, artifactLines, reviewArtifacts } from "./artifact-lines.js";
import * as C from "../coordinator.js";

// The groups, in the order they need you. A task's state stays herdr's; the group is how the board files it.
const GROUPS = ["needs you", "ready to approve", "working", "done", "to do"];
// herdr's own colour for each state (its status_color), with two of the board's own: finished work that waits for a
// yes is green, and a task nobody has started is grey.
const GROUP_COLOR = { "needs you": "red", "ready to approve": "green", working: "yellow", done: "teal", "to do": "overlay0" };
const MARK_STATES = ["working", "error", "done"];
// The side panel fits from this width on, when you have it open (ctrl+p); below it the same panel opens full screen.
const WIDE = 90;
const isAgent = (r) => !!r.agent && !["todo", "progress"].includes(r.stage);
const failureFor = (r) => (r.stage === "nosummary" ? null : A.failureOf(r));
const canSendError = (r) => !!r && !r.host ? A.canSendError(r) : !!r && (r.stage === "nosummary" || (r.stage === "failed" && !r.failure?.auth));
// Finished work that waits for the one yes that merges it. A merge that failed, a branch behind main, or a pull
// request whose checks fail is not ready: it needs you instead.
const inReview = (r) => r.state === "blocked" && r.kind === "permission" && r.stage === "approval" && !r.mergeFailed && !r.syncBlocked && !r.prFailure && r.prState !== "failing";
const reviewing = (r) => r.state !== "done" && (r.stage === "reviewing" || r.stage === "reviewneeds");
const needsYou = (r) => r.state === "blocked" || r.state === "error";
const groupOf = (r) => (inReview(r) ? "ready to approve" : needsYou(r) ? "needs you" : r.state === "working" ? "working" : r.state === "done" ? "done" : "to do");
// The mark, the bar and the percent take the colour of the task's group; a task's own words (its title and what it
// says) stay in herdr's text colours whatever its state. While the reviewer works they are a colour no other state uses.
const statusColor = (r) => (r.archivedAt ? "overlay0" : reviewing(r) && r.state === "working" ? "review" : GROUP_COLOR[groupOf(r)]);
// The reviewer's advice is said in words; the score's colour only repeats it.
const scoreColor = (r, rv) => (rv.recommend === true ? "green" : rv.recommend === false ? "red" : "subtext0");
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
// Nothing on the first review; from the second on, in words: "2nd review".
const roundWords = (r) => (S.reviewRound(r) >= 2 ? `${ordinal(S.reviewRound(r))} review` : "");
const currentReview = (r) => S.currentReview(r);
// Strip only board-generated review metadata; task descriptions and agent wording stay intact.
const reviewNote = (r) => (isAgent(r) ? String(r.msg || "").replace(/^(Approve to merge\?\s*)?Reviewed [1-5]\/5(?:, says (?:don't )?(?:merge|accept))?\.\s*/, "$1") : r.msg);
// One review in a few words: "4/5 yes" in a list of them, "4/5, says merge" on its own. The colour repeats the advice.
const verdict = (t, e, long = false) => (e.error ? t.fg("red", long ? "failed, no verdict" : "failed") : t.fg(e.recommend === true ? "green" : e.recommend === false ? "red" : "subtext0", `${e.score}/5`) + (e.recommend === true ? (long ? ", says merge" : " yes") : e.recommend === false ? (long ? ", says don't merge" : " no") : ""));
// A long text's beginning, for the panel beside the list: cut between words, a few lines at most.
const brief = (text, max = 400, mark = " …") => {
  let s = String(text ?? "").trim().replace(/\n{2,}/g, "\n");
  const lines = s.split("\n");
  if (lines.length > 8) { s = lines.slice(0, 8).join("\n"); if (s.length <= max) return s + mark; }
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"), max - 40)).trimEnd() + mark;
};
// The facts in the task panel that are not settings: in a window too short for all of it, these go first.
const NOT_SETTINGS = ["Latest", "Change", "Branch", "Note", "Context", "Tokens", "herdr"];
const ASKS = { question: "Asks you", permission: "Asks for your OK", auth: "Needs a login" };
// The keys worth remembering. Everything else is a line in the menu.
const KEYS = [
  ["↑ ↓", "move between tasks"], ["enter", "send, or open the agent"], ["space", "talk to this task's agent"], ["tab", "put an agent on it"],
  ["ctrl+a", "yes: approve, retry, continue"], ["ctrl+r", "send it back to fix"], ["ctrl+x", "stop the agent"], ["ctrl+f", "find"], ["ctrl+p", "side panel, on or off"], ["ctrl+e", "the whole task, full screen"], ["?", "this menu"], ["esc", "back"],
];
const short = S.tilde;
const clean = (s) => String(s ?? "").replace(/[\x00-\x1f\x7f]+/g, " ");
const age = (ms) => { const x = Math.max(0, Math.round(ms / 1000)); return x < 60 ? `${x}s` : x < 3600 ? `${Math.floor(x / 60)}m` : x < 86400 ? `${Math.floor(x / 3600)}h` : `${Math.floor(x / 86400)}d`; };
const prNumber = (r) => (r.pr ? `PR#${String(r.pr).split("/").pop()}` : "");
// A pull request's checks, as a mark beside its number: colour alone does not say it.
const prCheck = (r) => ({ passing: "✓", failing: "✗" }[r.prState] || "");
const prColor = (r) => ({ merged: "overlay0", passing: "green", failing: "red" }[r.prState] || "subtext0");
const repoLabel = (name) => (S.knownRepos()[name] === os.homedir() ? "~" : name);
const idLabel = (id) => { const [repo, ...rest] = String(id).split("/"); return [repoLabel(repo), ...rest].join("/"); };
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n || 0));
const bar = (pct, n = 8) => "█".repeat(Math.round((pct / 100) * n)).padEnd(n, "░");
// A task as the screen reads it: `msg` is the line to show, `app` who is on it, `at` since when.
export const asRow = (t) => ({ ...t, msg: t.note || "", raw: t.msg, app: t.shownApp || "", at: t.state === "working" ? t.since || t.at : t.at });

// The fewest cells a cut "doing now" sentence is still worth showing in.
const SENTENCE_MIN = 20;

export class View {
  items = []; rows = []; selectionRows = []; selectionLayout = "";
  sel = ""; top = 0;
  allDone = false; archiveView = false; archiveBack = null; archiveUndo = null;
  // The task panel: beside the list when you have it open (`side`, ctrl+p) and the window is wide, full screen
  // (`full`) when asked for. Most of the time it is closed, so each row has the width for what it says.
  // `reply` says who the chat at the bottom talks to: the selected task's agent after space, the Coordinator otherwise.
  reply = false; replyId = ""; side = false; full = false; panelTop = 0; panelHeight = 1; panelLength = 0; width = 120;
  mode = "new"; menu = null; ask = null; byRepo = false; draftAway = null;
  scope = ""; // whose board you see: "" this machine, "*" every machine, or one other machine by name
  remotes = {}; machinesAt = 0;
  filter = ""; msg = ""; msgKind = "overlay0";
  stick = ""; back = ""; jobs = []; jobTop = 0; tick = 0; disposed = false;
  screens = new Map(); // what an agent's pane shows, read through herdr, cached
  // The chat at the bottom: one place for the Coordinator and for every task's agent. `chatOpen`: whether its latest
  // message shows above the text box. `going`: when you asked to open the Coordinator's chat while it was not running
  // yet (it is being started; its chat opens as soon as it is there).
  chatOpen = true; coord = { state: "none", queue: 0, said: "" }; going = 0;
  sent = new Map(); setup = null;

  constructor(tui, theme, done, ctx) {
    this.tui = tui; this.theme = theme; this.done = done; this.ctx = ctx;
    this.input = new DraftEditor(tui, theme);
    this.prefs = path.join(S.dataDir(), "view.json");
    const prefs = S.readJson(this.prefs) || {};
    // Opened from the Coordinator's own pane (you went into it and came back): its folder is nobody's repo. The board
    // is where it was when you left it, so the draft that comes back is still sent from the repo it was typed in.
    try { if (C.inHome(ctx.cwd)) ctx.cwd = prefs.cwd && fs.existsSync(prefs.cwd) ? prefs.cwd : os.homedir(); } catch {}
    this.byRepo = !!prefs.byRepo; this.side = !!prefs.side; this.scope = String(prefs.scope || ""); this.told = Number(prefs.told) || 0;
    // The board closes each time you open an agent: selection, filter and draft come back when it reopens.
    this.sel = String(prefs.sel || ""); this.filter = String(prefs.filter || ""); if (prefs.draft) this.input.setText(String(prefs.draft));
    // So do words that were put away: ctrl+z still brings them back after the board closed or reloaded itself.
    if (prefs.away && prefs.away.text) this.draftAway = { text: String(prefs.away.text), to: String(prefs.away.to || "") };
    this.chatOpen = prefs.chat !== "closed";
    if (this.all) this.pollRemotes();
    this.repo = S.repoOf(ctx.cwd);
    try { this.canDispatch = C.ready(); } catch { this.canDispatch = false; }
    this.load();
    try { this.syncCoord(); } catch {}
    try { this.takeApprove(); } catch {}
    try { this.stamp = codeStamp(); } catch {}
    try { this.startSetup(); } catch {}
    this.lookHeld();
    this.timer = setInterval(() => this.beat(), 1000);
  }
  // A remote view of this pane (a `herdr terminal attach`, as herdr's web UI starts) can hold its terminal at its own
  // size: the board is then drawn for that size and herdr's window shows a cut-out of it. Said only after two looks
  // in a row agree on the size, so a window that is being resized is never taken for one.
  lookHeld() {
    let now = null;
    try { now = lookHeld(herdr(currentSocket()), this.tui.terminal); } catch {}
    this.held = now && this.heldSeen === `${now.columns}x${now.rows}` ? now : null;
    this.heldSeen = now ? `${now.columns}x${now.rows}` : "";
  }
  // The first run: one screen asks what the plugin may add to herdr's settings. Only inside herdr, only what is missing.
  startSetup() {
    if ((!inHerdr() && !process.env.HERDR_PLUGIN_ID) || process.env.HERDR_SUPERWORK_INLINE === "1") return;
    const o = this.ctx.offers ? this.ctx.offers() : X.offers();
    if (o.asked) return;
    if (!o.key && !o.sidebar) { X.answer({}); return; }
    this.setup = { file: o.file, typing: false, key: o.key ? { on: !!o.key.suggest, value: o.key.suggest || "" } : null, sidebar: o.sidebar ? { on: true } : null };
  }
  // Single keys: 1 and 2 switch a choice on or off, k types another key, enter saves both, esc asks again next time.
  setupKey(data) {
    const st = this.setup;
    const enter = matchesKey(data, "return") || matchesKey(data, "enter");
    const esc = matchesKey(data, "escape") || matchesKey(data, "ctrl+c");
    if (st.typing) {
      if (esc) { st.typing = false; return this.setValue(""); }
      if (!enter) return this.input.handleInput(data);
      const v = this.value().trim().toLowerCase();
      st.typing = false; this.setValue("");
      if (v) { st.key.value = v; st.key.on = true; }
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
    if (st.key) L.push("", ...wrap(`${t.fg("accent", "1")}  ${box(st.key.on)} ${st.key.value ? `Open this board with ${t.bold(st.key.value)}, from anywhere in herdr` : "Open this board with a key of your own (1 or k: type it)"}`), ...(st.key.value ? wrap(t.fg("overlay0", "k: use another key"), "         ") : []));
    if (st.sidebar) L.push("", ...wrap(`${t.fg("accent", "2")}  ${box(st.sidebar.on)} Show each task's stage, and what it is doing, in herdr's sidebar`));
    L.push("", ...wrap(t.fg("overlay0", `Saved in ${short(st.file)} between two marker lines. The file is backed up first, and herdr-superwork remove-extras takes it all out again.`)), "");
    if (st.typing) L.push(`  ${t.fg("accent", "the key ❯")} ${this.value() || t.fg("overlay0", "for example prefix+a")}`, "", ...wrap(t.fg("overlay0", "enter keeps it · esc back")));
    else L.push(...wrap(`${t.fg("text", "1 2")}${t.fg("overlay0", " on or off · ")}${t.fg("text", "enter")}${t.fg("overlay0", " save · ")}${t.fg("text", "esc")}${t.fg("overlay0", " ask me next time")}`));
    if (this.msg) L.push("", ...wrap(t.fg(this.msgKind, this.msg)));
    return this.pad(L, rowsN);
  }
  get all() { return this.scope !== ""; }
  // Nothing of yours is open or half typed: the board can be swapped for its new version without losing anything.
  get atRest() { return !this.value() && !this.ask && !this.menu && !this.setup && !this.pasteText && !this.going && this.mode === "new"; }
  beat() {
    this.tick++;
    if (this.all && this.tick % 5 === 0) this.pollRemotes();
    // With a keeper alive the board only looks: the keeper polls, watches and alerts. Without one the board does all
    // of it itself, as it always did, so a missing keeper never makes the board worse.
    if (!keeperAlive()) { try { tickOnce(currentSocket(), { watch: (rows) => H.watchTick(rows.map(asRow)) }); } catch {} }
    // An open board keeps running the code it started with. When the plugin changed underneath it, it loads the new
    // version by itself: once the files have stopped changing, and only while nothing of yours is half typed.
    if (this.tick % 5 === 0 && this.stamp) {
      try {
        const now = codeStamp();
        if (now !== this.stamp) { const settled = this.stale === now; this.stale = now; if (settled && this.atRest && this.ctx.canReload !== false) return this.done({ reload: true }); }
        else this.stale = "";
      } catch {}
    }
    // The Coordinator can be turned on or off (a setting, herdr starting) while the board is open.
    if (this.tick % 5 === 0) { try { this.canDispatch = C.ready(); } catch {} }
    if (this.tick % 5 === 0) this.lookHeld();
    try { this.load(); } catch {}
    try { this.takeApprove(); } catch {}
    try { this.syncCoord(); } catch {}
    try { this.announce(); } catch {}
    this.tui.requestRender();
  }
  dispose() { this.disposed = true; clearInterval(this.timer); this.savePrefs(); if (this.sent.size) { try { process.stdout.write([...this.sent.keys()].map(oscClear).join("")); } catch {} } }
  invalidate() { this.input.invalidate(); }
  get focused() { return this.input.focused; }
  set focused(value) { this.input.focused = value; }
  savePrefs() { try { S.writeJson(this.prefs, { byRepo: this.byRepo, side: this.side, scope: this.scope, sel: this.sel, filter: this.filter, told: this.told, draft: this.mode === "new" && !this.reply ? this.value() : "", chat: this.chatOpen ? "open" : "closed", cwd: this.ctx.cwd, away: this.reply && this.value().trim() ? { text: this.value(), to: this.replyId } : this.draftAway }); } catch {} }
  // A message stays until the next key press; an error stays until esc dismisses it.
  flash(text, kind = "overlay0") { this.msg = clean(text); this.msgKind = kind; }
  value() { return this.input.getText(); }
  setValue(v) { this.input.setText(v); }
  current() { return this.items.find((r) => r.id === this.sel); }
  job() { return this.jobs.find((j) => j.id === this.sel); }
  try(fn) { let ok = true; try { fn(); } catch (e) { ok = false; this.flash(e.message, "red"); } this.load(); return ok; }
  // herdr's "approve the task in the focused pane" action lands here: the board opens on that task and asks first.
  takeApprove() {
    const id = A.takeApprove();
    const r = id && this.items.find((x) => x.id === id && !x.archivedAt);
    if (!r) return;
    this.menu = null; this.sel = r.id; this.load();
    this.yes(r);
  }
  // One pattern for every question the board asks: a small box, enter = yes, esc = no.
  // `valid`: is what the question names still what "yes" would act on? Checked on every look at the tasks and again
  // on enter, so a yes is never given to something other than what was asked.
  confirm(q, yes, quit = false, valid = null) { this.ask = { q, yes, quit, valid }; }
  // What a merge question is about: this pull request, at this reviewed commit, in this state.
  mergeMark(id) { const x = this.items.find((i) => i.id === id); return x ? JSON.stringify([x.stage, x.pr ?? null, x.reviewedHead ?? null, x.review?.score ?? null, x.review?.recommend ?? null, !!x.review?.stale, !!x.mergeFailed, !!x.syncBlocked, !!x.prFailure, x.prState === "failing", !!x.archivedAt]) : ""; }
  // For a board run as a plain command: its tasks as OSC 7501 records on its own terminal. Output only: nothing
  // reads OSC 7501. No bell, sound or message says that a task newly needs you.
  announce() {
    const local = this.items.filter((r) => !r.host && !r.archivedAt);
    if (process.env.HERDR_PLUGIN_ID || process.env.HERDR_SUPERWORK_PROGRAM_STATUS === "0") return;
    const next = new Map();
    for (const r of local) if (r.state !== "idle" && r.state !== "done") next.set(r.id, osc(r));
    let out = "";
    for (const [id, seq] of next) if (this.sent.get(id) !== seq) out += seq;
    for (const id of this.sent.keys()) if (!next.has(id)) out += oscClear(id);
    this.sent = next;
    if (out) process.stdout.write(out);
  }

  load() {
    try { this.coord = C.look(); } catch {}
    const mine = F.board({ includeArchived: true }).map(asRow);
    this.items = this.scope === "" ? mine : this.scope === "*" ? [...mine, ...Object.values(this.remotes).flatMap((m) => m.items)] : (this.remotes[this.scope] ? this.remotes[this.scope].items : []);
    const jobs = this.archiveView ? [] : S.dispatches();
    // A finished instruction is forgotten without a word: its row goes and what it did is on the board.
    for (const j of jobs) if (j.state === "done") S.clearDispatch(j.id);
    this.jobs = jobs.filter((j) => j.state !== "done").reverse();
    const f = (this.mode === "find" ? this.value() : this.filter).trim().toLowerCase();
    const eligible = this.items.filter((r) => (this.archiveView ? !!r.archivedAt : !!f || !r.archivedAt));
    const shown = f ? eligible.filter((r) => `${r.id} ${r.title} ${r.msg} ${r.state} ${r.app} ${r.archivedAt ? "archived" : ""} ${r.description || ""} ${r.failure?.title || ""} ${r.failure?.detail || ""}`.toLowerCase().includes(f)) : eligible;
    const layout = JSON.stringify([this.scope, this.byRepo, this.allDone, this.archiveView, f]);
    const rows = [];
    const repoOf = (r) => r.id.split("/")[0];
    const groups = this.byRepo
      ? [...new Set(shown.map(repoOf))].sort((a, b) => (a === this.repo.name ? -1 : b === this.repo.name ? 1 : a.localeCompare(b))).map((g) => [g, shown.filter((r) => repoOf(r) === g)])
      : [["archived", shown.filter((r) => r.archivedAt)], ["pinned", shown.filter((r) => r.pinned && !r.archivedAt)], ...GROUPS.map((g) => [g, shown.filter((r) => groupOf(r) === g && !r.pinned && !r.archivedAt)])];
    const isDone = (r) => r.state === "done" && !r.pinned && !r.archivedAt;
    const rank = (r) => (r.archivedAt ? -2 : r.pinned ? -1 : GROUPS.indexOf(groupOf(r)));
    for (const [name, recs] of groups) {
      if (!recs.length) continue;
      rows.push({ header: name });
      // Inside a project: pinned first, then the order of the status groups, so what needs you is on top.
      // A long done list folds to the latest few, newest first.
      const list = [...recs].sort((a, b) => (this.byRepo ? rank(a) - rank(b) : 0) || (a.archivedAt && b.archivedAt ? b.archivedAt - a.archivedAt : 0) || (isDone(a) && isDone(b) ? b.at - a.at : 0));
      const done = list.filter(isDone);
      const folded = !this.allDone && !f ? done.slice(5).filter((r) => r.id !== this.sel) : [];
      for (const r of list) {
        if (!folded.includes(r)) rows.push({ rec: r });
        if (folded.length && r === done[done.length - 1]) rows.push({ note: `… ${folded.length} more (? shows all done)` });
      }
    }
    this.rows = rows;
    const selectable = [...rows.filter((r) => r.rec).map((r) => r.rec), ...this.jobs];
    // Only the selected task's ordering data matters. New rows, progress updates and other tasks moving must not
    // steal selection.
    const base = new Map(this.items.map((r, n) => [r.id, n]));
    const nextRows = selectable.map((r) => ({ id: r.id, order: JSON.stringify([r.title !== undefined ? groupOf(r) : r.state, !!r.pinned, r.created, !!r.archivedAt]), at: r.title !== undefined && isDone(r) ? r.at : 0, done: r.title !== undefined && isDone(r), base: base.get(r.id) ?? -1 }));
    const ids = nextRows.map((r) => r.id);
    const before = this.selectionRows.findIndex((r) => r.id === this.sel);
    const afterIndex = ids.indexOf(this.sel);
    const after = nextRows[afterIndex];
    const selected = this.sel;
    const old = this.selectionRows[before];
    const crossed = !!old && !!after && old.done && after.done && old.at !== after.at &&this.selectionRows.some((r, n) => {
      const to = ids.indexOf(r.id);
      if (to < 0 || r.id === selected || !r.done || (this.byRepo && r.id.split("/")[0] !== selected.split("/")[0])) return false;
      const wouldPrecede = r.at > after.at || (r.at === after.at && r.base < old.base);
      return (n < before) !== wouldPrecede && (n < before) !== (to < afterIndex);
    });
    // The selection stays where it is while you read or answer a task, and on the row whose agent you just stopped.
    const reading = this.full || this.reply || (this.stick === selected && !!after);
    if (layout === this.selectionLayout && old && !reading && (!after || after.order !== old.order || crossed)) {
      // Prefer the old successor, then the next surviving row below it, then the nearest survivor above. Never
      // chase the moved task if a neighbour remains.
      const neighbors = [...this.selectionRows.slice(before + 1), ...this.selectionRows.slice(0, before).reverse()];
      this.sel = neighbors.find((r) => ids.includes(r.id))?.id || (after ? selected : ids[0] || "");
    }
    if (!ids.includes(this.sel)) this.sel = ids[0] || "";
    this.selectionRows = nextRows;
    this.selectionLayout = layout;
    // A question is about what it names. When that changed underneath it (another pull request, a new commit, a new
    // review), the question goes: the next yes has to be to what is there now.
    if (this.ask?.valid && !this.ask.valid()) { this.ask = null; this.flash("It changed while you were asked, so nothing was merged. Look at it again, then ctrl+a.", "yellow"); }
    // A reply belongs to the task it was started for. When that task is gone the words are never left pointing at
    // whichever task is selected next: they are put away, and nothing is sent.
    if (this.reply && this.value() && this.replyId && this.sel !== this.replyId) {
      if (this.value().trim()) this.draftAway = { text: this.value(), to: this.replyId };
      this.setValue(""); this.reply = false; this.full = false;
      this.flash("The task you were replying to is gone. Nothing was sent; your words are put away.", "yellow");
    }
    this.syncReply();
    if (this.sel !== selected) this.load(); // rebuild the done fold for the new selection
  }
  // You talk to a task's agent only while the task you pressed space on is the selected one. Moving to another task
  // (or that task going away) is back to the Coordinator: the chat never follows the selection to an agent unasked.
  syncReply() { if (this.reply && this.sel !== this.replyId) { this.reply = false; this.full = false; this.panelTop = 0; } }
  move(d) {
    const ids = [...this.rows.filter((r) => r.rec).map((r) => r.rec.id), ...this.jobs.map((j) => j.id)]; // the dispatcher's rows sit below the list
    if (ids.length) this.sel = ids[Math.max(0, Math.min(ids.length - 1, ids.indexOf(this.sel) + d))];
  }
  jump(d) {
    const heads = this.rows.map((r, n) => (r.header ? n : -1)).filter((n) => n >= 0);
    const at = this.rows.findIndex((r) => r.rec && r.rec.id === this.sel);
    const cur = heads.filter((h) => h < at).pop() ?? 0;
    if (this.job()) { if (d < 0 && heads.length) this.sel = this.rows[heads[heads.length - 1] + 1].rec.id; return; }
    const next = d > 0 ? heads.find((h) => h > cur) : heads.filter((h) => h < cur).pop();
    if (next !== undefined && this.rows[next + 1]?.rec) this.sel = this.rows[next + 1].rec.id;
    else if (d > 0 && this.jobs.length) this.sel = this.jobs[0].id;
  }
  // What you typed, for the Coordinator: this machine's one long-lived agent. For another machine's, the words are a
  // row of their own until that machine has taken them, so you can select it and stop it.
  dispatch(text, delegate, about) {
    // Another machine's Coordinator: for a task of theirs you have open, or when you start with its name ("@vm-a fix the build").
    const named = text.match(/^@?([A-Za-z0-9_.-]+)[:\s]\s*([\s\S]+)$/);
    const there = about && about.host ? this.remotes[about.host] : (named && this.all && (text.startsWith("@") || text.slice(named[1].length, named[1].length + 1) === ":") ? this.remotes[named[1]] : null) || (about ? null : this.remotes[this.scope]) || null;
    if (there) {
      const words = (about && about.host) || !(named && this.remotes[named[1]] === there) ? text : named[2];
      const job = S.newDispatch(`@${there.label} ${words}`, { remote: there.label });
      this.ssh(there, "dispatch", { text: words, delegate, about: about && about.host ? about.rid : undefined }, (j) => {
        try {
          if (!S.getDispatch(job.id)) return;
          if (j && j.ok) S.clearDispatch(job.id);
          else S.setDispatch(job.id, { state: "error", msg: j ? j.msg : `${there.label} did not answer` });
          this.pollRemotes(true); this.load(); this.tui.requestRender();
        } catch {}
      }, 150000);
      return this.load();
    }
    if (!this.canDispatch) { try { this.canDispatch = C.ready(); } catch {} } // it may have been turned on a moment ago
    if (!this.canDispatch) {
      // No Coordinator (it is off, its program is not installed, or herdr is not running): what you type is filed as
      // a task, word for word.
      const about0 = about && !about.host ? about : null;
      if (about0) { A.describe(about0.id, `${about0.description ? `${about0.description}\n\n` : ""}${text}`); this.flash(`${about0.id}: added to its description`, "green"); return this.load(); }
      const [title, ...restLines] = text.split("\n");
      const t = A.add(this.ctx.cwd, title, { description: restLines.join("\n") });
      if (delegate) A.delegate(t.id);
      this.flash(`${t.id}: filed${delegate ? ", an agent is on it" : ""}`, "green");
      this.sel = t.id;
      return this.load();
    }
    C.send(this.ctx.cwd, text, { delegate, about: about ? about.id : null });
    this.load();
  }
  // ---- the chat ---------------------------------------------------------------------------------------------------------
  // One chat at the bottom of the board, the same for everyone you can talk to. Who that is follows one rule: the
  // task you pressed space on, its agent; otherwise the Coordinator. Only its latest message is drawn here: the whole
  // conversation is the agent's own pane, which `openChat` goes into.
  toggleChat() { this.chatOpen = !this.chatOpen; this.savePrefs(); this.syncCoord(); }
  openChat() { const r = this.current(); return this.reply && r ? this.chat(r) : this.enterCoord(); }
  // Called on every beat and after every change: a reply you can see counts as seen, and you go into the
  // Coordinator's chat once the Coordinator you asked to go into is there.
  syncCoord() {
    const v = this.coord;
    if (v.unseen && !this.reply && this.chatOpen && !this.setup) { C.seen(v.unseen); this.coord = { ...v, unseen: "" }; }
    // While you talk to a task's agent the chat shows that agent: the Coordinator's reply is said once, in a line.
    else if (v.unseen && this.reply && this.toldReply !== v.unseen && !this.msg) { this.toldReply = v.unseen; this.flash("The Coordinator replied. esc goes back to it.", "green"); }
    if (!this.going) return;
    if (v.status && v.pane) return this.enterCoord();
    if (v.error) { this.going = 0; return this.flash(`The Coordinator could not be started: ${v.error}`, "red"); }
    if (Date.now() - this.going > 90000) { this.going = 0; return this.flash("The Coordinator did not start. alt+c tries again.", "yellow"); }
    this.flash("Starting the Coordinator: its chat opens as soon as it is ready. esc stays on the board.", "yellow");
  }
  // Into the Coordinator: its real herdr pane, exactly as into a task's agent (`chat`). Inside herdr the board exits
  // and herdr shows its pane; outside a herdr client the same terminal attaches to it and the board returns when the
  // attach ends. Not running yet: it is started with nothing said, and you go in as soon as it is there.
  enterCoord() {
    if (!this.canDispatch) { try { this.canDispatch = C.ready(); } catch {} }
    try { this.coord = C.look(); } catch {}
    const v = this.coord;
    if (!(v.status && v.pane)) {
      if (!this.canDispatch && v.state === "none") return this.flash("No Coordinator here: it is off, its program is not installed, or herdr is not running.", "yellow");
      if (!this.going) { try { C.open(); } catch (e) { return this.flash(e.message, "red"); } this.going = Date.now(); this.load(); }
      return this.flash("Starting the Coordinator: its chat opens as soon as it is ready. esc stays on the board.", "yellow");
    }
    this.going = 0;
    if (!inHerdr()) {
      this.tui.stop();
      process.stdout.write("\x1b[2J\x1b[H");
      spawnSync(process.env.HERDR_BIN_PATH || "herdr", ["agent", "attach", v.pane], { stdio: "inherit", env: { ...process.env, HERDR_SOCKET_PATH: currentSocket() } });
      C.typedThere();
      this.tui.start(); this.tui.requestRender(true);
      return this.load();
    }
    C.focus(v);
    this.leave({ entered: "coordinator" });
  }
  // alt+r and alt+n ask first: either one ends what the Coordinator is doing right now.
  coordAct(what) {
    this.confirm(what === "new" ? `Start a new Coordinator on ${C.describe(C.choice())}? This conversation ends.` : "Restart the Coordinator? It keeps this conversation; what it is doing right now stops.", () => {
      if (what === "new") { C.fresh(null); this.flash("A new Coordinator is starting.", "green"); }
      else { C.restart(); this.flash("The Coordinator is restarting, in the same conversation.", "green"); }
      this.load();
    });
  }
  // A reply to this task goes to an agent of its own (not, with its task named, to the Coordinator).
  hasAgent(r) { return isAgent(r) && (!!r.host || F.isAgentTask(r) || F.cleanedUp(r)); }
  // The task panel leaves "The agent said" to the chat while the chat shows that same message.
  chatShows(r) { return !!r && this.reply && this.chatOpen && this.mode !== "find" && r.id === this.sel && !r.archivedAt && this.hasAgent(r); }
  // Who the chat talks to, as the chat draws it: a mark and a name, where they stand, and the latest thing they said.
  // The same shape for the Coordinator and for a task's agent. `enter`: there is a chat of theirs to go into.
  chatOf(r) {
    const t = this.theme;
    if (this.mode === "find") return null;
    if (this.reply && r) {
      const color = statusColor(r), toAgent = this.hasAgent(r);
      const word = r.archivedAt ? "archived" : reviewing(r) && r.state === "working" ? "reviewer is working" : groupOf(r);
      const starts = !r.host && !isAgent(r) && ["todo", "progress"].includes(r.stage);
      const meta = r.archivedAt ? "read-only" : toAgent ? `its agent · ${clean(r.app || r.agent || "agent")}` : starts ? "no agent yet: your message starts one" : this.canDispatch || r.host ? "no agent on it: your message goes to the Coordinator, about this task" : "no agent on it: your message is added to its description";
      const pv = this.chatShows(r) ? this.previewOf(r) : null;
      return { mark: this.mark(r), color, name: clean(r.title || r.id), word, meta, label: pv?.text ? pv.label : "", text: pv?.text || "", raw: pv?.label === "on its screen now", notes: [], enter: toAgent && !r.archivedAt && (!!r.host || F.isAgentTask(r)), said: toAgent && !r.archivedAt };
    }
    const far = this.scope && this.scope !== "*" && this.remotes[this.scope] ? this.scope : "";
    if (far) return { mark: t.fg("overlay0", t.mark("unknown")), color: "overlay0", name: `Coordinator on ${far}`, word: "", meta: `what you type goes to ${far}`, label: "", text: "", notes: [] };
    // No Coordinator (it is off, its program is not installed, or herdr is not running): the same box files tasks.
    if (!this.canDispatch) return { mark: t.fg("overlay0", "+"), color: "overlay0", name: "New task", word: "", meta: "what you type is filed as a task, word for word", label: "", text: "", notes: [] };
    const v = this.coord;
    const fresh = !!v.unseen && !this.chatOpen;
    const color = fresh ? "green" : { working: "yellow", starting: "yellow", blocked: "red", idle: "green" }[v.state] || "overlay0";
    const word = v.error ? "could not be started" : fresh ? "new reply" : { none: "not started", starting: "starting", working: "working", blocked: "needs you", idle: "idle", exited: "stopped" }[v.state] || v.state;
    const mark = t.fg(v.error ? "red" : color, t.mark(v.error ? "error" : ["working", "starting"].includes(v.state) ? "working" : v.state === "blocked" ? "blocked" : v.state === "idle" ? "idle" : "unknown"));
    let label = "", text = "", tone = "";
    if (v.error) { text = `It could not be started: ${v.error}`; tone = "red"; }
    else if (v.state === "blocked") { label = "on its screen now"; text = C.screen(v) || "Something on its screen waits for you. alt+c opens its chat."; }
    else if (v.said) { label = v.state === "working" ? "so far" : "last message"; text = v.said; }
    else {
      const on = v.status && (v.state === "working" || !v.readable) ? C.screen(v) : ""; // a program whose conversation cannot be read: its screen
      if (on) { label = "on its screen now"; text = on; }
      else { tone = "overlay0"; text = { none: "Ask or tell it anything: it starts with your first message, and stays.", starting: "Starting…", idle: "Ready. Ask or tell it anything.", exited: "Your next message starts it again, in the same conversation." }[v.state] || "Nothing said yet."; }
    }
    const notes = [];
    if (v.stale) notes.push(`your default is now ${C.describe(v.def)}: alt+n starts a new one on it`);
    for (const m of v.waiting || []) notes.push(`› ${clean(m)}  (waiting to be sent)`);
    if (!v.queue && v.last && v.state !== "none") notes.push(`› ${clean(v.last)}`);
    return { mark, color: v.error ? "red" : color, name: "Coordinator", word, meta: `${v.run ? C.describe(v.run) : "off"}${v.oneOff ? " (this one only)" : ""}`, label, text, tone, raw: label === "on its screen now", notes, enter: true, said: true, always: !!v.error };
  }
  // The chat's first line names who you talk to, on the whole width: the name is never cut to make room for the rest.
  // What stands beside it goes first when the window is narrow: the keys, then the label, the program, the state.
  chatHead(c, width, tight = false) {
    const t = this.theme;
    const lead = " " + c.mark + " ", room = Math.max(1, width - visibleWidth(lead));
    const name = t.bold(c.name);
    const bits = [c.word && "  " + t.fg(c.color, c.word), c.meta && t.fg("overlay0", "  " + c.meta), c.label && this.chatOpen && t.fg("overlay0", "  · " + c.label)].filter(Boolean);
    // The chat's two keys, in full or in short. Where neither fits beside the name, the hint line below says alt+v.
    const forms = [[c.enter && "alt+c open its chat", c.said && `alt+v ${this.chatOpen ? "hide" : "show"} its message`], [c.enter && "alt+c chat", c.said && `alt+v ${this.chatOpen ? "hide" : "show"}`]].map((f) => f.filter(Boolean).join(" · "));
    let keys = forms[0];
    const fits = (n, withKeys) => visibleWidth(name + bits.slice(0, n).join("")) + (withKeys && keys ? 3 + visibleWidth(keys) : 0) <= room;
    // The keys outlast the label and the program; the state outlasts the keys.
    let n = bits.length, showKeys = !!keys;
    while (n > 1 && !fits(n, true)) n--;
    if (!fits(n, true)) { keys = forms[1]; n = bits.length; while (n > 1 && !fits(n, true)) n--; }
    if (!fits(n, true)) { showKeys = false; n = bits.length; while (n && !fits(n, false)) n--; }
    this.chatKeyHint = c.said && !showKeys ? ["alt+v", `${this.chatOpen ? "hide" : "show"} its message`] : null;
    // A name longer than the window takes a second line before it is cut (in a short window that line is the draft's).
    if (!fits(0, false) && tight) return [lead + truncateToWidth(name, room, "…")];
    if (!fits(0, false)) { const [a, b, more] = wrapTextWithAnsi(name, room); return [lead + a, ...(b ? ["   " + (more ? truncateToWidth(b, room - 1, "") + "…" : b)] : [])]; }
    const left = name + bits.slice(0, n).join("");
    return [lead + left + (showKeys ? " ".repeat(room - visibleWidth(left) - visibleWidth(keys) - 1) + t.fg("overlay0", keys) : "")];
  }
  // The chat above the text box: a rule, who you talk to, and (unless you hid it) the latest thing they said.
  chatLines(width, maxH, r, tight = false) {
    const t = this.theme, c = this.chatOf(r);
    this.chatKeyHint = null;
    if (!c) return [];
    const out = [t.fg("surface_dim", "─".repeat(width)), ...this.chatHead(c, width, tight)];
    this.chatHeadRows = out.length;
    if (!this.chatOpen && !c.always) return out; // a start that failed says why, hidden or not
    const wrapAll = (text) => String(text).split("\n").flatMap((l) => { const w = wrapTextWithAnsi(clean(l), Math.max(10, width - 2)); return w.length ? w : [""]; });
    const lines = c.text ? wrapAll(c.raw ? c.text : c.text.replace(/\*\*([^*\n]+)\*\*/g, "$1")) : [];
    return [...out, ...c.notes.map((n) => " " + t.fg("overlay0", n)), ...(lines.length > maxH ? [" " + t.fg("overlay0", "…")] : []), ...lines.slice(-maxH).map((l) => " " + (c.tone ? t.fg(c.tone, l) : l))];
  }
  // ---- other machines: ask each for its board, and send each action to the machine that owns the task ----
  ssh(m, what, arg, cb, ms = 20000) { R.ask(m, what, arg, cb, ms); }
  pollRemotes(now = false) {
    if (Date.now() - this.machinesAt > 60000) {
      this.machinesAt = Date.now();
      R.machines((list) => {
        for (const m of list) if (!this.remotes[m.label]) this.remotes[m.label] = { ...m, items: [], ok: false, busy: false, failAt: 0 };
        for (const k of Object.keys(this.remotes)) if (!list.some((m) => m.label === k)) delete this.remotes[k];
        this.pollRemotes(true);
      });
    }
    for (const m of Object.values(this.remotes)) {
      if (m.busy || (!now && !m.ok && Date.now() - m.failAt < 30000)) continue; // one that does not answer is asked again later
      m.busy = true;
      this.ssh(m, "list", null, (j) => {
        m.busy = false;
        if (j && Array.isArray(j.tasks)) { m.ok = true; m.version = j.version || ""; m.items = j.tasks.map((x) => ({ ...asRow(x), id: `${m.label}:${x.id}`, rid: x.id, host: m.label, machine: m })); }
        else { m.ok = false; m.failAt = Date.now(); m.items = []; }
        try { this.load(); } catch {} this.tui.requestRender();
      });
    }
  }
  // One of the few exact actions, on a task that lives on another machine.
  act(r, action, extra = {}, quiet = false, after) {
    if (!quiet) this.flash(`${r.host}: …`);
    this.ssh(r.machine, "do", { action, id: r.rid, ...extra }, (j) => {
      if (!quiet || !(j && j.ok)) this.flash(j ? j.msg : `${r.host} did not answer`, j && j.ok ? "green" : "red");
      if (j && j.ok && (action === "archive" || action === "restore")) {
        r.archivedAt = action === "archive" ? Date.now() : null;
        if (action === "archive") this.archiveUndo = r;
        this.closePanel();
      }
      after?.(!!j?.ok);
      this.pollRemotes(true); this.tui.requestRender();
    });
  }
  closePanel() { this.reply = false; this.full = false; this.panelTop = 0; this.load(); }
  // The side panel, on demand. Your choice is remembered.
  toggleSide() {
    this.side = !this.side; this.savePrefs();
    if (this.side && this.width < WIDE) return this.flash("The side panel needs a wider window. ctrl+e shows the task full screen.", "yellow");
    this.flash(this.side ? "Side panel on. ctrl+p hides it." : "Side panel off. ctrl+p shows it.");
  }
  // Only the whole panel goes: who the chat talks to is space's to change, never the panel's.
  foldPanel() { this.full = false; this.panelTop = 0; this.load(); }
  openPanel() { const r = this.current(); if (!r && !this.job()) return this.flash("Select a task first."); this.full = true; this.panelTop = 0; }
  // What the agent's pane shows, read through herdr. A deep read is done once per completed turn and cached; while
  // the agent is busy only its visible screen is read, at most every two seconds.
  screen(r) {
    if (r.host) return String(r.snap?.screen || "");
    if (!F.isAgentTask(r) || !r.live || r.live.away || r.live.down || r.live.gone) return "";
    const status = r.live.status;
    const settled = status === "idle" || status === "done";
    const key = settled ? `deep:${r.live.agent?.completion_seq ?? r.live.agent?.state_change_seq ?? 0}` : "live";
    const hit = this.screens.get(r.id);
    if (hit && hit.key === key && (settled || Date.now() - hit.at < 2000)) return hit.text;
    let text = "";
    try { text = readScreen(herdr(r.link.socket), r.reviewer_pane || (reviewing(r) && r.link.reviewer?.pane) || r.link.pane, reviewing(r) && r.link.reviewer?.pane ? "working" : status); } catch {}
    text = text.split("\n").map((l) => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    this.screens.set(r.id, { key, at: Date.now(), text });
    return text;
  }
  lastSaid(r) { return String(r.said || ""); } // the agent's last message, read from its saved conversation (its closing note as the fallback)
  // What the Space preview shows: the agent's last message. Its raw screen instead, under "on its screen now", when
  // the agent kind has no reader, when herdr reports it blocked while its turn has not ended (a permission prompt or a
  // menu exists only on its screen), and whenever there is no message yet. Never empty.
  previewOf(r) {
    const said = this.lastSaid(r);
    const kind = r.agent || r.app;
    const dialog = r.stage === "working" && (r.host ? r.state === "blocked" : r.live?.status === "blocked");
    if (said && adapter(kind).readTurn && !dialog && !reviewing(r)) return { label: "last message", text: said };
    const screen = this.screen(r) || r.screen || "";
    return screen ? { label: "on its screen now", text: screen } : { label: said ? "last message" : "", text: said };
  }
  desc(r) { return String(r.description || ""); }
  // Into the agent: its real herdr pane. Inside herdr the board exits (the popup closes); outside a herdr client
  // (plain SSH) the same terminal attaches to that one agent and the board returns when the attach ends.
  chat(r) {
    if (r.archivedAt) return this.openPanel();
    if (r.host) return this.remoteChat(r);
    if (!F.isAgentTask(r)) return this.flash("No agent has been on this yet. tab puts one on it.", "yellow");
    F.assertLive(r);
    const api = herdr(r.link.socket);
    // Its space may have been closed (archive closes it): reopen it from the worktree first.
    let pane;
    try { pane = D.reopen(r.id).pane; } catch (e) { return this.flash(e.message, "yellow"); }
    const hasAgent = !!api.agentGet(pane.pane_id);
    if (!inHerdr()) {
      if (!hasAgent) return this.flash("Its agent has exited. space and a reply starts it again.", "yellow");
      this.tui.stop();
      process.stdout.write("\x1b[2J\x1b[H");
      spawnSync(process.env.HERDR_BIN_PATH || "herdr", ["agent", "attach", pane.pane_id], { stdio: "inherit", env: { ...process.env, HERDR_SOCKET_PATH: r.link.socket } });
      this.tui.start(); this.tui.requestRender(true);
      return this.load();
    }
    // herdr cannot focus a bare pane by id: with no agent in it, focus its workspace and tab.
    if (hasAgent) api.agentFocus(pane.pane_id); else { api.workspaceFocus(pane.workspace_id); try { api.tabFocus(pane.tab_id); } catch {} }
    this.leave({ entered: r.id });
  }
  // The board closes when you open an agent. The first few times it says, for a moment, how to get back.
  leave(result) {
    const ms = Number(this.ctx.leaveMs) || 0;
    if (!ms || this.told >= 3) return this.done(result);
    this.told++; this.leaving = true; // nothing more is taken from the keyboard
    this.flash(`Opening the agent. ${this.ctx.boardKey || "herdr-superwork"} brings the board back.`, "green");
    this.tui.requestRender();
    setTimeout(() => this.done(result), ms);
  }
  remoteChat(r) {
    if (!r.link?.pane) return this.flash("No agent has been on this yet. tab puts one on it.", "yellow");
    const attach = (pane) => {
      const { command, args } = R.attachCommand(r.machine, pane);
      this.tui.stop();
      process.stdout.write("\x1b[2J\x1b[H");
      spawnSync(command, args, { stdio: "inherit" });
      this.tui.start(); this.tui.requestRender(true);
      this.pollRemotes(true);
    };
    // A machine on an older plugin sends no version and would not know "reopen": attach to what is there.
    if (!r.machine.version) { this.flash(`Update herdr-superwork on ${r.host}: it cannot reopen a closed space yet.`, "yellow"); return attach(r.link.pane); }
    // The owning machine reopens the task's space and restarts its exited agent in the same conversation, then we attach.
    this.flash(`${r.host}: opening…`);
    this.ssh(r.machine, "do", { action: "reopen", id: r.rid }, (j) => {
      if (!j || !j.ok) { this.flash(j ? j.msg : `${r.host} did not answer`, "red"); return this.tui.requestRender(); }
      if (!j.hasAgent) { this.flash(`${r.host}: its agent has exited and could not be restarted. space and a reply starts it again.`, "yellow"); return this.tui.requestRender(); }
      attach(j.pane || r.link.pane);
    }, 60000);
  }
  toggleArchive() {
    if (!this.archiveView) {
      this.archiveBack = { sel: this.sel, top: this.top, filter: this.filter, mode: this.mode, value: this.value() };
      this.archiveView = true;
      this.filter = ""; this.mode = "new"; this.setValue(""); this.reply = false; this.full = false; this.top = 0;
    } else {
      this.archiveView = false;
      const back = this.archiveBack;
      if (back) { this.sel = back.sel; this.top = back.top; this.filter = back.filter; this.mode = back.mode; this.setValue(back.value); }
      this.reply = false; this.full = false;
      this.archiveBack = null;
    }
    this.load();
  }
  archiveSelected(r) {
    const action = r.archivedAt ? "restore" : "archive";
    if (r.host) return this.act(r, action);
    this.try(() => {
      if (action === "archive") { A.archive(r.id); this.archiveUndo = r; } else A.restore(r.id);
      this.reply = false; this.full = false;
      this.flash(action === "archive" ? `${r.id}: archived. ? has undo, and the archive.` : `${r.id}: restored.`, "green");
    });
  }

  handleInput(data) {
    try { this.handle(data); } catch (e) { this.flash(e.message, "red"); }
    this.syncReply();
    this.tui.requestRender();
  }
  // ---- what the keys do -------------------------------------------------------------------------------------------------
  // "Yes": whatever the selected task waits for. A merge cannot be undone, so that one asks first.
  yes(r) {
    if (r.archivedAt) return this.flash("Archived tasks are read-only. ? has restore.", "yellow");
    if (r.stage === "approval" && r.state === "blocked") {
      if (r.syncBlocked) return this.flash(`Behind main, so it cannot be approved yet: ${r.syncBlocked.why}. The board keeps trying to bring it up to date.`, "yellow");
      const mark = this.mergeMark(r.id), seen = { pr: r.pr ?? null, head: r.reviewedHead ?? null };
      return this.confirm(`Merge ${prNumber(r) || `"${truncateToWidth(clean(r.title || r.id), 32, "…")}"`}?`, () => (r.host ? this.act(r, "approve", { seen }) : this.try(() => { const out = A.approve(r.id, seen); this.flash(out.msg, "green"); })), false, () => this.mergeMark(r.id) === mark);
    }
    if (isAgent(r) && r.state === "blocked" && r.kind === "permission") return r.host ? this.act(r, "approve") : this.try(() => { const out = A.approve(r.id); this.flash(out.msg, "green"); });
    // Stopped without a summary: yes takes the work as it is, through the check and the review.
    if (r.stage === "nosummary") return r.host ? this.act(r, "finish") : this.try(() => { const out = A.finishAnyway(r.id); this.flash(out.msg, "green"); });
    // Something went wrong: yes tries the same step again, as it stands (ctrl+r is the one that asks the agent to fix it).
    if (r.stage === "failed" || (r.stage === "asks" && r.kind === "auth")) return r.host ? this.act(r, "again") : this.try(() => { const out = A.retry(r.id); this.flash(out.msg, "green"); });
    this.flash("Nothing here waits for a yes.");
  }
  // "Send it back": whatever went wrong (a failed step, a conflict, the review) goes to the task's agent to fix.
  sendBack(r) {
    if (r.archivedAt) return this.flash("Archived tasks are read-only. ? has restore.", "yellow");
    const failure = failureFor(r);
    if (failure && !failure.agentCanFix && !(r.stage === "failed" && r.failure?.auth)) return this.flash(`This needs you first. ${failure.next || ""}`, "yellow");
    if (r.host) return this.act(r, failure && failure.agentCanFix ? "fix" : r.state === "error" ? "retry" : "review");
    return this.try(() => { const out = failure && failure.agentCanFix ? A.sendFailure(r.id) : r.state === "error" ? A.sendError(r.id) : A.sendReview(r.id); this.flash(out.msg, "green"); });
  }
  stop(r) {
    const running = r.state === "working" && (isAgent(r) || r.stage === "progress") || r.stage === "queued" || (isAgent(r) && r.stage === "working");
    if (!running) return this.flash("No agent is working on this. ? has delete and archive.");
    this.stick = r.id; // the selection stays on this row: a second tap never lands on another task
    if (r.host) return this.act(r, "stop");
    return this.try(() => { A.stop(r.id); this.flash(`${r.id}: stopped.`, "yellow"); });
  }
  remove(r) {
    this.confirm(`Delete "${truncateToWidth(clean(r.title || r.id), 32, "…")}"? Its worktree goes too.`, () => {
      if (r.host) return this.act(r, "clear");
      A.clear(r.id).then((out) => { this.flash(out.kept.length ? `${r.id} deleted. Kept, so no work is lost: ${out.kept.join(", ")}` : `${r.id} deleted`, out.kept.length ? "yellow" : "overlay0"); this.load(); this.tui.requestRender(); }, (e) => { this.flash(e.message, "red"); this.tui.requestRender(); });
      this.flash(`${r.id}: deleting…`);
    });
  }
  undo() {
    // A draft comes back to whoever it was for: a reply stays a reply to that task, never a new task.
    if (this.draftAway) {
      const d = this.draftAway;
      // Its task is gone: the words are not lost, and not turned into something else unasked. A second ctrl+z says so.
      if (d.to && !this.items.some((r) => r.id === d.to && !r.archivedAt)) {
        if (!d.warned) { d.warned = true; return this.flash("The task that reply was for is gone. ctrl+z again brings the words back as a draft of their own.", "yellow"); }
        d.to = "";
      }
      this.draftAway = null;
      if (d.to) { this.sel = d.to; this.replyId = d.to; this.reply = true; if (this.width < WIDE) { this.full = true; this.panelTop = 0; } }
      else if (this.reply || this.full) this.closePanel();
      this.setValue(d.text); this.load();
      return;
    }
    const r = this.archiveUndo; this.archiveUndo = null;
    if (!r) return this.flash("Nothing to undo.");
    if (r.host) return this.act(r, "restore");
    return this.try(() => { A.restore(r.id); this.flash(`${r.id}: restored`, "green"); });
  }
  // Whose board: this machine, every machine you can reach, or one of them.
  setScope(to) {
    this.scope = to; this.savePrefs();
    if (this.all) { this.machinesAt = 0; this.pollRemotes(true); }
    // Machines are found through herdr only: with none saved, say how to add one.
    if (this.all && !Object.keys(this.remotes).length) { let none = false; R.machines((list) => { none = !list.length; }); if (none) { this.scope = ""; this.savePrefs(); this.flash(S.config().machines === "off" ? "Other machines are off (config machines auto turns them on)." : "No other machines. Add one with: herdr machine add <name> <ssh target>  (or name them in the machines setting).", "yellow"); return this.load(); } }
    this.flash(this.scope === "" ? "This machine only." : this.scope === "*" ? "Every machine you can reach." : `Only ${this.scope}. What you type goes to ${this.scope}.`);
    return this.load();
  }
  nextScope() { let ring = [""]; try { ring = ["", "*", ...Object.keys(this.remotes).filter((k) => this.remotes[k].ok).sort()]; } catch {} return this.setScope(ring[(ring.indexOf(this.scope) + 1) % ring.length] ?? ""); }
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
  scrollPanel(data) {
    const last = Math.max(0, this.panelLength - this.panelHeight), step = Math.max(1, this.panelHeight - 1);
    const to = matchesKey(data, "home") ? 0 : matchesKey(data, "end") ? last : this.panelTop + (matchesKey(data, "up") ? -1 : matchesKey(data, "down") ? 1 : matchesKey(data, "pageUp") ? -step : step);
    this.panelTop = Math.max(0, Math.min(last, to));
  }
  handle(data) {
    if (this.leaving) return;
    if (data === "\x1b\x1b") data = "\x1b"; // esc tapped twice arrives as one read: it is still esc
    if (this.pasteText) { this.pasteText = ""; return; }
    const esc = matchesKey(data, "escape");
    // An error stays until esc dismisses it; anything else is gone with the next key.
    if (this.msg && this.msgKind === "red") { if (esc) { this.msg = ""; return; } } else this.msg = "";
    if (this.setup) return this.setupKey(data);
    const enter = data !== "\n" && (matchesKey(data, "return") || matchesKey(data, "enter"));
    if (this.ask) {
      const { yes, quit } = this.ask;
      if (enter || (quit && matchesKey(data, "ctrl+c"))) {
        if (this.ask.valid) { try { this.load(); } catch {} if (!this.ask) return; } // the newest state decides, not the one drawn a second ago
        this.ask = null; return yes();
      }
      if (esc || matchesKey(data, "ctrl+c")) this.ask = null;
      return; // a question takes enter or esc, nothing else
    }
    if (this.menu) return this.menuKey(data);
    this.stick = "";
    // A draft owns the chat's keys too, wherever it is going: alt+c, alt+v, alt+r and alt+n act only on an empty text box.
    if (!!this.value() && ["alt+c", "alt+v", "alt+r", "alt+n"].some((k) => matchesKey(data, k))) return this.input.handleInput(data);
    // alt+c: into the whole chat of whoever the chat talks to (the board closes). alt+v: its latest message, shown or not.
    if (matchesKey(data, "alt+c")) return this.openChat();
    if (matchesKey(data, "alt+v")) return this.toggleChat();
    if (this.going && (esc || matchesKey(data, "ctrl+c"))) { this.going = 0; return this.flash("Stayed on the board. The Coordinator keeps starting."); }
    if (!this.reply && this.canDispatch && (matchesKey(data, "alt+r") || matchesKey(data, "alt+n"))) return this.coordAct(matchesKey(data, "alt+n") ? "new" : "restart");
    if (this.input.isPasting || data.includes("\x1b[200~")) { this.input.handleInput(data); if (this.mode === "find") this.load(); return; }
    const text = this.value().trim();
    const r = this.current();
    if (esc) {
      // One step back at a time. A draft is put away, not thrown away; the last step asks before the board closes.
      if (this.mode !== "new") { this.mode = "new"; this.setValue(""); }
      else if (this.value()) { if (text) { this.draftAway = { text: this.value(), to: this.reply && r ? r.id : "" }; this.flash("Put away. ctrl+z brings it back."); } this.setValue(""); }
      else if (this.full || this.reply) return this.closePanel();
      else if (this.filter) this.filter = "";
      else if (this.archiveView) return this.toggleArchive();
      else return this.confirm("Close the board?", () => this.done(undefined), true);
      return this.load();
    }
    if (this.mode === "find" && enter) { this.filter = text; this.mode = "new"; this.setValue(""); return this.load(); }
    // While the text box holds text it owns the keyboard: only enter, tab and esc act on the board, so no shortcut
    // fires in the middle of a draft (ctrl+a is "start of line" there, not "merge").
    if (this.value() && !enter && !matchesKey(data, "tab")) { this.input.handleInput(data); if (this.mode === "find") this.load(); return; }
    if (matchesKey(data, "ctrl+c")) return this.confirm("Close the board?", () => this.done(undefined), true);
    if (this.mode === "find") { if (!matchesKey(data, "tab")) { this.input.handleInput(data); this.load(); } return; }

    const j = this.job();
    if (j && !text) {
      // Words on their way to another machine: stop them, or take them back to change and send again.
      if (matchesKey(data, "ctrl+x")) return this.try(() => { H.stopDispatch(j); this.flash("Stopped.", "yellow"); });
      if (enter || matchesKey(data, "right")) { this.try(() => H.stopDispatch(j)); return this.setValue(j.text || ""); }
      if (matchesKey(data, "tab")) return;
    }
    if (enter) {
      if (!text) { if (r) this.chat(r); return; } // with nothing typed, enter opens the selected task's agent
      // Who gets it is who the chat names: the selected task's agent after space, the Coordinator otherwise.
      if (this.reply && r?.archivedAt) return this.flash("Archived tasks are read-only. ? has restore.", "yellow");
      if (this.reply && (!r || r.id !== this.replyId)) return this.flash("The task you were replying to is gone. Nothing was sent.", "yellow");
      // A reply to one of this machine's tasks that never had an agent starts one with that message.
      const fresh = this.reply && r && !r.host && !r.archivedAt && !F.isAgentTask(r) && ["todo", "progress"].includes(r.stage);
      if (fresh) { if (!this.try(() => { const out = A.tell(r.id, text); this.flash(out.msg, "green"); })) return; }
      // (Work that ended and was cleaned up has no terminal left: the reply starts a new round.)
      else if (this.reply && r && isAgent(r) && (r.host || F.isAgentTask(r) || F.cleanedUp(r))) {
        // Busy/refused replies keep the draft; only a successful send clears it.
        if (r.host) { this.act(r, "tell", { text }, false, (ok) => { if (ok && this.sel === r.id && this.value().trim() === text) this.setValue(""); }); return; }
        if (!this.try(() => { const out = A.tell(r.id, text); this.flash(out.msg, out.msg.startsWith("queued") ? "yellow" : "green"); })) return;
      } else this.dispatch(text, false, this.reply ? r : undefined);
      return this.setValue("");
    }
    if (matchesKey(data, "tab")) {
      if (text) { if (this.reply || this.mode !== "new") return; this.dispatch(text, true); return this.setValue(""); }
      if (r?.archivedAt) return this.flash("Archived tasks are read-only. ? has restore.", "yellow");
      if (r && r.host) this.act(r, "delegate"); else if (r) this.try(() => { const t = A.delegate(r.id); this.flash(t.stage === "queued" ? `${r.id}: waiting for a free slot` : `${r.id}: an agent is on it`, "green"); });
      return;
    }
    // From here on the text box is empty.
    const scroll = ["up", "down", "pageUp", "pageDown", "home", "end"].find((k) => matchesKey(data, k));
    if (this.full && scroll) return this.scrollPanel(data);
    if (matchesKey(data, "ctrl+down") || matchesKey(data, "ctrl+up")) {
      const d = matchesKey(data, "ctrl+down") ? 1 : -1;
      const at = this.jobs.findIndex((x) => x.id === this.sel);
      if (at < 0) { if (d > 0 && this.jobs.length) { this.back = this.sel; this.sel = this.jobs[0].id; } else if (d > 0) this.flash("Nothing is on its way to another machine."); return; }
      const to = at + d;
      if (to < 0) { this.sel = this.back || ""; this.load(); return; }
      this.sel = this.jobs[Math.min(this.jobs.length - 1, to)].id;
      return;
    }
    if (matchesKey(data, "alt+up")) return this.jump(-1);
    if (matchesKey(data, "alt+down")) return this.jump(1);
    if (matchesKey(data, "up") || matchesKey(data, "shift+up")) return this.move(-1);
    if (matchesKey(data, "down") || matchesKey(data, "shift+down")) return this.move(1);
    if (matchesKey(data, "pageUp")) return this.move(-10);
    if (matchesKey(data, "pageDown")) return this.move(10);
    if (data === "?") { this.menu = { at: 0 }; return; }
    if (matchesKey(data, "ctrl+f")) { this.mode = "find"; this.reply = false; this.full = false; this.setValue(this.filter); return; }
    if (data === " ") {
      if (!r) return;
      if (this.reply) return this.closePanel(); // back to the Coordinator, at every width
      if (r.archivedAt) return this.flash("Archived tasks are read-only. ? has restore.", "yellow");
      this.reply = true; this.replyId = r.id; if (this.width < WIDE) { this.full = true; this.panelTop = 0; }
      return;
    }
    if (matchesKey(data, "right") && r) return this.chat(r);
    if (matchesKey(data, "ctrl+a")) return r ? this.yes(r) : undefined;
    if (matchesKey(data, "ctrl+r") || matchesKey(data, "ctrl+g")) return r ? this.sendBack(r) : undefined;
    if (matchesKey(data, "ctrl+x")) return r ? this.stop(r) : undefined;
    // The quiet extras: every one of them is also a line in the ? menu.
    if (matchesKey(data, "ctrl+y") && r) { if (r.host) return this.act(r, "finish"); return this.try(() => { const out = A.finishAnyway(r.id); this.flash(out.msg, "green"); }); }
    if (matchesKey(data, "ctrl+e")) return this.full ? this.foldPanel() : this.openPanel();
    if (matchesKey(data, "ctrl+p")) return this.full ? undefined : this.toggleSide();
    if (matchesKey(data, "alt+h")) return this.toggleArchive();
    if (matchesKey(data, "alt+a")) return r ? this.archiveSelected(r) : this.flash("Select a task to archive or restore.");
    if (matchesKey(data, "ctrl+z")) return this.undo();
    if (matchesKey(data, "delete")) return r ? this.remove(r) : undefined;
    if (matchesKey(data, "ctrl+t") && r) { if (r.archivedAt) return this.flash("Archived tasks are read-only. ? has restore.", "yellow"); return r.host ? this.act(r, "pin") : this.try(() => A.pin(r.id)); }
    if (matchesKey(data, "ctrl+o")) return this.nextScope();
    if (matchesKey(data, "ctrl+d")) { this.allDone = !this.allDone; return this.load(); }
    if (matchesKey(data, "ctrl+s")) { this.byRepo = !this.byRepo; this.savePrefs(); return this.load(); }
    this.input.handleInput(data);
    if (this.mode === "find") this.load();
  }
  render(width) { return this.draw(width).map((l) => this.theme.line(l)); }
  draw(width) {
    this.width = width;
    const rowsN = Math.max(8, this.tui.terminal.rows);
    const fit = (s) => truncateToWidth(s, width, "…", true);
    try {
      const t = this.theme;
      const r = this.current();
      if (this.pasteText) return this.pad(["", ...String(this.pasteText).split("\n").flatMap((l) => wrapTextWithAnsi(l, Math.max(10, width - 4))).map((l) => "  " + l), "", "  " + t.fg("overlay0", "any key continues")], rowsN).map(fit);
      if (this.setup) return this.setupLines(width, rowsN).map(fit);
      const selectedJob = this.jobs.findIndex((j) => j.id === this.sel);
      const jobLine = (j) => {
        const line = " " + (j.state === "error" ? t.fg("red", t.mark("error")) : t.fg("yellow", t.mark("working"))) + " " + clean(j.text) + (j.state === "error" ? t.fg("subtext0", `  ${clean(j.msg)}`) : "");
        return j.id === this.sel ? this.hl(line, width) : line;
      };
      // The chat, above the text box: who you talk to and their latest message. It never pushes the box or its hints
      // off-screen: the message gives up lines first, and the line that says who you talk to goes last.
      const chat = this.chatLines(width, Math.max(3, Math.min(10, Math.floor(rowsN / 3) - 2)), r, rowsN < 16);
      const headN = chat.length ? this.chatHeadRows : 0;
      // The text box grows with a draft that wraps, up to half the window (and never past what the line that says who
      // you talk to leaves): a longer draft scrolls inside it, never off-screen.
      const inputLines = this.ask ? this.askLines(width) : this.boxLines(width, Math.min(rowsN - 4 - headN - (selectedJob >= 0 ? 1 : 0), Math.max(5, Math.floor(rowsN / 2))), r);
      const trimChat = (limit) => { if (chat.length > limit) chat.splice(limit > headN ? limit - 1 : limit, chat.length, ...(limit > headN ? [" " + t.fg("overlay0", "… alt+c: open its chat")] : [])); };
      // What just happened, on a line of its own: the hints below it stay readable.
      const stale = !this.stale ? "" : this.ctx.canReload === false ? "herdr-superwork was updated: close the board and open it again for the new version." : "herdr-superwork was updated: the new version loads when nothing is half typed.";
      const said = this.msg ? wrapTextWithAnsi(t.fg(this.msgKind, this.msg) + (this.msgKind === "red" ? t.fg("overlay0", "  (esc)") : ""), Math.max(10, width - 4)).slice(0, 3).map((l) => "  " + l) : stale ? ["  " + t.fg("overlay0", stale)] : [];
      const extraRows = Math.max(0, rowsN - inputLines.length - 2 - said.length - headN);
      const lastJobTop = Math.max(0, this.jobs.length - extraRows);
      if (selectedJob < 0) this.jobTop = lastJobTop;
      else if (selectedJob < this.jobTop) this.jobTop = selectedJob;
      else if (selectedJob >= this.jobTop + extraRows) this.jobTop = selectedJob - extraRows + 1;
      this.jobTop = Math.max(0, Math.min(this.jobTop, lastJobTop));
      const jobs = extraRows ? this.jobs.slice(this.jobTop, this.jobTop + extraRows).map(jobLine) : [];
      trimChat(headN + Math.max(0, extraRows - jobs.length));
      // The hint line never runs off the screen: the main thing and the last one stay, what is between them goes first.
      const hintList = this.hints(r).filter(Boolean).slice(0, 4);
      const hintText = () => hintList.map(([k, d]) => [k && t.fg("text", k), d && t.fg("overlay0", d)].filter(Boolean).join(" ")).join(t.fg("overlay0", " · "));
      while (hintList.length > 2 && visibleWidth(hintText()) > width - 2) hintList.splice(hintList.length - 2, 1);
      const hints = hintText();
      // Whatever the window, the text box and its hints are whole: the chat, then the rows above it, give way.
      while (jobs.length + chat.length + inputLines.length + said.length + 1 > rowsN && (chat.length || jobs.length || said.length)) (chat.length ? chat : jobs.length ? jobs : said).pop();
      const bottom = [...jobs, ...chat, ...inputLines, ...said, "  " + hints];
      // Top left, where a cut-out of the board still shows it.
      const held = rowsN - bottom.length > 3 ? this.heldLines(width) : [];
      const h = Math.max(1, rowsN - bottom.length - held.length);
      const shown = r || this.job();
      let top;
      if (this.menu) top = this.menuLines(width, h);
      else if (this.full && shown) top = this.fullPanel(shown, width, h);
      else if (width >= WIDE && this.side) {
        // The task panel on the right, while you have it open, on herdr's sidebar colour when the theme gives it one.
        const paneW = Math.max(38, Math.min(70, Math.floor(width * 0.38)));
        const listW = width - paneW - 3;
        const left = [...this.headLines(listW), ...this.listLines(listW, Math.max(1, h - 1))];
        const right = shown ? this.panel(shown, paneW, false, h) : ["", " " + t.fg("overlay0", "nothing selected.")];
        top = Array.from({ length: h }, (_, i) => truncateToWidth(left[i] ?? "", listW, "…", true) + " " + t.fg("surface_dim", "│") + t.under("sidebar_bg", truncateToWidth(" " + (right[i] ?? ""), paneW + 1, "…", true)));
      } else top = [...this.headLines(width), ...this.listLines(width, Math.max(1, h - 1))];
      return this.pad([...held, ...this.pad(top, h), ...bottom].slice(0, rowsN), rowsN).map(fit);
    } catch (e) {
      const out = [fit(" herdr-superwork view error: " + clean(e?.message)), fit(" press esc to close")];
      while (out.length < rowsN) out.push(fit(""));
      return out;
    }
  }
  pad(lines, n) { const out = lines.slice(0, n); while (out.length < n) out.push(""); return out; }
  // The size warning: one line, and what frees the size comes first, because the right end is what a narrow window
  // or a cut-out loses.
  heldLines(width) {
    const d = this.held;
    if (!d) return [];
    const t = this.theme, who = d.by[0];
    const text = `Held at ${d.columns}×${d.rows}: ${who ? `kill ${who.pid}` : "closing its remote view"} frees it. `
      + `Drawn for a remote view of this pane, so herdr's own window (${d.room.columns}×${d.room.rows}) shows it cut off or half empty`
      + (who ? ` · herdr terminal attach, open ${age(who.seconds * 1000)}${d.by.length > 1 ? `, and ${d.by.length - 1} more` : ""}` : "");
    return [truncateToWidth(" " + t.fg("yellow", "! " + text), width, "…")];
  }
  // The header: one line. Which project, and anything unusual about what the list shows.
  headLines(w) {
    const t = this.theme;
    const session = sessionName(currentSocket());
    const parts = [this.archiveView ? "archive" : this.repo.root === os.homedir() ? "~" : `${this.repo.name} · ${short(this.repo.root)}`];
    if (session !== "default") parts.push(`session ${session}`);
    if (this.scope === "*") parts.push(`all machines: ${Object.keys(this.remotes).length ? Object.values(this.remotes).map((m) => (m.ok ? m.label : `${m.label} (no answer)`)).join(", ") : "no others found"}`);
    else if (this.all) parts.push(`only ${this.scope}${this.remotes[this.scope] && this.remotes[this.scope].ok ? "" : " (no answer)"}`);
    if (this.filter && this.mode !== "find") parts.push(`find: ${this.filter}`);
    return [truncateToWidth(" " + t.bold("herdr-superwork") + t.fg("overlay0", "  " + parts.join(" · ")), w, "…")];
  }
  // The text box. Who gets your words is said by the chat's first line, right above it, never by the prompt.
  boxLines(width, maxRows, r) {
    const t = this.theme;
    const replying = this.mode !== "find" && this.reply && !!r;
    const label = (this.mode === "find" ? t.fg("subtext0", "find") + " " : "") + t.fg("accent", "❯");
    const lines = this.input.renderWithin(width, maxRows, label);
    if (this.value()) return lines;
    const place = this.mode === "find" ? "type to filter, archived tasks too"
      : replying ? (r.archivedAt ? "archived: read-only" : isAgent(r) ? (r.state === "blocked" && r.kind === "question" ? "your answer" : "your reply") : !r.host && ["todo", "progress"].includes(r.stage) ? "your message starts an agent on it" : "what should change?")
      : this.talksToCoord ? "ask or tell it anything" : "what's next?";
    lines[1] = `${label} ${this.focused ? CURSOR_MARKER : ""}${t.inverse(place[0])}${t.fg("overlay0", place.slice(1))}`;
    return lines;
  }
  // With nothing of a task's open, your words go to a Coordinator: this machine's, or the one machine you look at.
  get talksToCoord() { return this.canDispatch || (!!this.scope && this.scope !== "*" && !!this.remotes[this.scope]); }
  // The one question box: it takes the text box's place until it is answered.
  askLines(width) {
    const t = this.theme, rule = t.fg("surface_dim", "─".repeat(width));
    const keys = `${t.fg("text", "enter")}${t.fg("overlay0", " = yes · ")}${t.fg("text", "esc")}${t.fg("overlay0", " = no")}`;
    // The two keys are always in view: a question too long for one line wraps, and the keys take a line of their own.
    const q = wrapTextWithAnsi(t.bold(this.ask.q), Math.max(10, width - 4));
    const oneLine = q.length === 1 && 3 + visibleWidth(q[0]) + 2 + visibleWidth(keys) <= width;
    return [rule, ...q.map((l, n) => (n ? "   " : ` ${t.fg("yellow", "?")} `) + l + (oneLine ? "  " + keys : "")), ...(oneLine ? [] : ["   " + keys]), rule];
  }
  // The hint line: what matters right now, the main thing first, at most four.
  hints(r) {
    const more = ["?", "more"];
    if (this.ask) return [];
    if (this.menu) return [["↑↓", "pick"], ["enter", "do it"], ["esc", "close"]];
    if (this.mode === "find") return [["enter", "keep the filter"], ["esc", "cancel"]];
    const agentOn = !!r && isAgent(r);
    if (this.value()) {
      if (this.reply && r) return [["enter", agentOn ? "send to its agent" : !r.host && ["todo", "progress"].includes(r.stage) ? "start an agent with it" : "send"], ["esc", "put away"], ["shift+enter", "new line"]];
      if (this.talksToCoord) return [["enter", "send"], ["tab", "send, and put an agent on it"], ["esc", "put away"], ["shift+enter", "new line"]];
      return [["enter", "add a task"], ["tab", "add it and start an agent"], ["esc", "put away"], ["shift+enter", "new line"]];
    }
    if (this.job()) return [["ctrl+x", "stop it"], ["enter", "take it back to change"], ["ctrl+↑", "back to the list"]];
    if (!r) return [["", this.archiveView ? "esc back to the board" : "type what needs doing"], ...(this.chatKeyHint ? [this.chatKeyHint] : []), more];
    const tail = this.full ? [["↑↓", "scroll"], ["esc", "back"]] : this.reply ? [["esc", "back"]] : [more];
    const failure = failureFor(r), rv = currentReview(r), reply = ["space", "reply"], open = ["enter", "open the agent"];
    let main;
    if (r.archivedAt) main = [["?", "restore or delete"], ...(this.archiveView && !this.full ? [["esc", "back to the board"]] : [])];
    else if (inReview(r)) main = [["ctrl+a", "approve and merge"], rv && rv.score < 5 && ["ctrl+r", "send back"], reply];
    else if (r.stage === "approval" && r.syncBlocked) main = [reply, open];
    else if (r.stage === "approval" && r.state === "blocked") main = [failure?.agentCanFix && !failure.sentAt && ["ctrl+r", "send it to the agent to fix"], ["ctrl+a", "retry the merge"], reply];
    else if (r.stage === "nosummary") main = [["ctrl+r", "tell it to continue"], ["ctrl+a", "use it as it is"], open];
    else if (failure?.agentCanFix) main = failure.sentAt && r.state === "working" ? [open, reply, ["ctrl+x", "stop"]] : [["ctrl+r", "send it to the agent to fix"], r.stage === "failed" && ["ctrl+a", "retry"], reply];
    else if (failure) main = [(r.stage === "failed" || r.kind === "auth") && ["ctrl+a", "retry"], reply, open];
    else if (r.state === "error" && canSendError(r)) main = [["ctrl+r", "send it to the agent to fix"], r.stage === "failed" && ["ctrl+a", "retry"], reply];
    else if (agentOn && r.state === "blocked" && r.kind === "permission") main = [["ctrl+a", "say yes"], reply, open];
    else if (agentOn && r.state === "blocked") main = [["space", r.kind === "question" ? "answer" : "reply"], open];
    else if (agentOn && r.state === "working") main = [open, reply, ["ctrl+x", "stop"]];
    else if (agentOn) main = [open, reply];
    else if (r.state === "working") main = [["tab", "put an agent on it"], ["ctrl+x", "stop"]];
    else main = [["tab", "put an agent on it"], reply];
    main = main.filter(Boolean);
    if (this.reply && !r.archivedAt) main = [["", agentOn && r.state === "blocked" && r.kind === "question" ? "type your answer" : "type your reply"], ...main.filter(([k]) => k !== "space")];
    const key = this.chatKeyHint ? [this.chatKeyHint] : [];
    return [...main.slice(0, 4 - tail.length - key.length), ...key, ...tail];
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
  mark(r) {
    const t = this.theme;
    // herdr's own marks, a different one for each state, in the colour of the task's group.
    const c = statusColor(r);
    if (r.archivedAt) return t.fg(c, t.mark("unknown"));
    if (inReview(r)) return t.fg(c, t.bold(t.mark("done")));
    if (r.state === "blocked") return t.fg(c, t.bold(t.mark("blocked")));
    if (r.state === "done") return t.dim(t.fg(c, t.mark("done"))); // finished: the same mark, only quieter
    return t.fg(c, t.mark(MARK_STATES.includes(r.state) ? r.state : "idle"));
  }
  // The task panel, full screen: the same panel as beside the list, whole, with every setting at its end.
  fullPanel(r, width, h) {
    const t = this.theme;
    const lines = this.panel(r, width, true);
    this.panelHeight = Math.max(1, h - 2);
    this.panelLength = lines.length;
    this.panelTop = Math.max(0, Math.min(this.panelTop, Math.max(0, lines.length - this.panelHeight)));
    const end = Math.min(lines.length, this.panelTop + this.panelHeight);
    return [" " + t.bold("task panel") + t.fg("overlay0", ` · ${idLabel(r.id)}${lines.length > this.panelHeight ? `  ·  lines ${this.panelTop + 1}–${end} of ${lines.length}` : ""}`), t.fg("surface_dim", "─".repeat(width)), ...lines.slice(this.panelTop, end)];
  }
  // The task panel. One shape, beside the list and full screen: where it stands and what it needs from you, the
  // description, then every other fact in one tight table (the reviews, the change, each setting), then what the
  // agent said. Headings and labels are greyed out; what they name is in the text colour. Full screen it ends with
  // every review the task had. `fit` is the height beside the list: there the description is short, and the long
  // parts are cut to the height so nothing below drops out of view.
  panel(r, width, full = false, fit = 0) {
    const t = this.theme;
    const w = Math.max(10, width - 2);
    const dim = (s) => t.muted(s);
    const plain = (text) => String(text ?? "").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 $2").replace(/\*\*([^*]+)\*\*/g, "$1");
    const wrap = (text, room = w) => plain(text).split("\n").flatMap((line) => { const x = wrapTextWithAnsi(clean(line), Math.max(1, room)); return x.length ? x : [""]; });
    const block = (text) => wrap(text).map((l) => " " + l);
    // A heading is grey. Only one that says something is wrong, or what is going on right now, takes that state's colour.
    const head = (label, color = "") => ["", ...wrapTextWithAnsi(color ? t.fg(color, label) : dim(label), w).map((line) => " " + line)];
    // Facts on one line, broken only between them: "12m ago" is never split.
    const flow = (parts) => {
      const out = []; let line = "";
      for (const p of parts.filter(Boolean)) { const next = line ? line + dim(" · ") + p : p; if (line && visibleWidth(next) > w) { out.push(line); line = p; } else line = next; }
      if (line) out.push(line);
      return out.map((l) => " " + truncateToWidth(l, w, "…"));
    };
    if (r.title === undefined) { // words on their way to another machine
      return ["", ...block(r.text || ""), ...flow([r.state === "error" ? t.fg("red", `${t.mark("error")} could not be sent`) : t.fg("yellow", `${t.mark("working")} on its way`), dim(r.remote ? `to ${r.remote}` : "on this machine"), dim(`${age(Date.now() - (r.created || Date.now()))} ago`)]), ...(r.msg ? [...head(r.state === "error" ? "Went wrong" : "Now", r.state === "error" ? "red" : "yellow"), ...block(r.msg)] : [])];
    }
    const agent = isAgent(r), failure = failureFor(r), c = statusColor(r);
    const underReview = reviewing(r) && r.state === "working";
    const approval = r.state === "blocked" && r.stage === "approval";
    const sections = [];
    const sec = (lines, cut = "") => { const s = { lines, cut }; if (lines.length) sections.push(s); return s; };

    // Where it stands: the mark, the group, who is on it, since when, and its id.
    const who = underReview ? "" : r.app ? (!agent && r.app === S.me() ? "you" : r.app) : "";
    const when = `${r.state === "working" ? "for " : ""}${age(Date.now() - (r.at || Date.now()))}${r.state === "working" ? "" : " ago"}`;
    const stand = flow([this.mark(r) + " " + t.fg(c, t.bold(r.archivedAt ? "archived" : underReview ? "reviewer is working" : groupOf(r))), (reviewing(r) || r.stage === "approval") && roundWords(r) ? t.fg(c, roundWords(r)) : "", who, dim(when), dim(idLabel(r.id))]);
    if (r.progress !== undefined && r.state !== "done") stand.push(" " + t.fg(c, bar(r.progress, Math.min(24, w - 6))) + t.fg(c, ` ${r.progress}%${r.eta !== undefined ? ` ${r.eta}m` : ""}`));
    else if (r.eta !== undefined && r.state !== "done") stand.push(" " + t.fg(c, `${r.eta}m`) + dim(" left"));
    const titleLines = wrapTextWithAnsi(t.bold(clean(r.title || "(no title)")), w).map((l) => " " + l);
    const top = sec(["", ...titleLines, ...stand]);
    if (r.archivedAt) sec([...head("Archived"), ...block("Read-only. ? has restore. Its state and all its data are kept.")]);

    // What it needs from you.
    const said = agent ? this.lastSaid(r) : "";
    const note = reviewNote(r);
    let told = ""; // what this part already printed, so "the agent said" does not repeat it
    if (failure) {
      told = failure.detail;
      sec([...head(failure.title, "red"), ...block(failure.sentAt ? "Sent to the agent. Kept here until it works." : failure.agentCanFix ? "The agent can fix this: ctrl+r sends it." : "This needs you first."), ...head("Next step"), ...block(failure.next || "Find the cause and fix it."), ...head("What went wrong"), ...block(failure.detail)], "end");
    } else if (approval && r.syncBlocked) sec([...head("Behind main, cannot be approved yet", "peach"), ...block(`${r.syncBlocked.why}. The board keeps trying to bring it up to date.`)]);
    else if (approval) { /* the first line says it: ready to approve */ }
    else if (r.state === "blocked") { told = note || said || ""; sec([...head(ASKS[r.kind] || "Needs you", "red"), ...block(told)], "end"); }
    else if (r.state === "error") { told = (r.stage === "nosummary" ? r.screen : "") || note || said || "It failed."; sec([...head(r.stage === "nosummary" ? "Stopped without a summary" : "Went wrong", "red"), ...block(told)], "end"); }
    else if (r.state === "working" && note) sec([...head(underReview ? "The reviewer, now" : "Now", c), ...block(note)]);

    // The description: whole on the full screen, its first few hundred characters beside the list.
    const desc = this.desc(r).trim();
    const start = full ? desc : brief(desc, 400, "");
    if (desc) sec([...head("Description"), ...block(start), ...(start === desc ? [] : [" " + dim("… ctrl+e shows all of it")])], "end");
    else if (!agent && !r.archivedAt && r.state === "idle") sec(["", ...block("No agent is on this yet. tab puts one on it.").map((l) => dim(l))]);

    // Every other fact, in one table: [label, value, is it this task's own choice, lines it keeps when room is short].
    const rows = [];
    // The reviews: how many, how each one went, and the latest in a few words.
    const hist = S.reviewHistory(r), last = hist[hist.length - 1];
    const stale = !!r.review?.stale;
    if (hist.length) {
      rows.push(["Reviews", [`${hist.length}`, "trail"], false]);
      rows.push(["Latest", `${verdict(t, last, true)}${dim(` · ${ordinal(last.round)} review${last.at ? ` · ${age(Date.now() - last.at)} ago` : ""}`)}${stale && !last.error ? dim(" · the work changed since") : ""}\n${full ? clean(last.error || last.text || "No comment.") : brief(clean(last.error || last.text || "No comment."), 280)}`, false, 2]);
    } else rows.push(["Reviews", stale ? dim("the work changed since its review") : dim(underReview ? "the first is under way" : "none yet"), false]);
    // The change: how big, and its pull request with a mark for its checks.
    const st = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(String(r.stat || ""));
    const size = st ? `${st[1]} file${st[1] === "1" ? "" : "s"}, +${st[2] || 0} −${st[3] || 0}` : String(r.stat || "").trim();
    const pr = r.pr ? t.fg(prColor(r), prNumber(r) + (prCheck(r) ? ` ${prCheck(r)}` : "")) + (r.prMerged || r.prState === "merged" ? dim(" merged") : "") : "";
    if (size || pr) rows.push(["Change", [size, pr].filter(Boolean).join(dim(" · ")) + (r.pr && /^https?:/.test(String(r.pr)) ? `\n${dim(clean(r.pr))}` : ""), false]);
    // Every setting, always: one that is only your default is still what this task runs on. What is not a setting
    // (the tokens, where it runs in herdr) comes after them, so a short window cuts those first.
    const RX = r.host ? r.snap || {} : null;
    const folder = RX ? RX.folder : S.folderOf(r.id);
    const tree = RX ? RX.tree : r.worktree && fs.existsSync(r.worktree) ? r.worktree : "";
    const ch = RX ? RX.choices || {} : S.choices(r);
    rows.push(["Project", short(folder || ""), !r.host && !!this.repo && path.resolve(String(folder || "")) !== path.resolve(this.repo.root)]);
    if (r.host) rows.push(["Machine", r.host, true]);
    const wtMode = r.worktreeMode || (RX ? RX.worktree : S.config().worktree);
    rows.push(["Worktree", tree ? `on · ${short(tree)}` : !r.startedOnce && wtMode !== "none" && (RX ? RX.canWorktree : S.canWorktree(folder)) ? "on" : "off", !!r.worktreeMode]);
    const branch = RX ? RX.branch : S.branchOf(tree || folder);
    if (branch) rows.push(["Branch", branch + (tree && r.from ? `  (from ${r.from === "HEAD" ? "your checkout" : r.from})` : ""), false]);
    const own = r.own || {};
    const mine = (...keys) => keys.some((k) => own[k] !== undefined && own[k] !== null);
    const kind = r.agent || ch.agent;
    // Each role reads the same way: program and version, model, effort. The version is the one saved at launch.
    rows.push(["Agent", `${kind}${r.agentVersion ? ` ${r.agentVersion}` : ""} · ${ch.model || "default model"} · ${ch.effort || "default effort"}`, mine("agent", "model", "effort")]);
    // No reviewer, or no review at all for this task, reads as "off".
    const noReview = !ch.reviewer || ch.reviewer === "off" || ch.review === "none";
    rows.push(["Reviewer", noReview ? "off" : `${ch.reviewer} · ${ch.reviewerModel || "default model"} · ${ch.reviewerEffort || "default effort"}`, mine("reviewer", "reviewerModel", "reviewerEffort", "review")]);
    // How this task is reviewed: what gets a review, who sends a review back, and the evidence the reviewer brings.
    rows.push(["Reviewed", noReview ? "nothing" : ch.review === "all" ? "all work" : "work in a repo", mine("review", "reviewer")]);
    rows.push(["Send back", `${ch.reviewAuto ? "automatic below 5/5" : "by hand"} · ${ch.rounds ?? "?"} round${ch.rounds === 1 ? "" : "s"} at most`, mine("reviewAuto", "rounds")]);
    rows.push(["Evidence", ch.artifacts === false ? "off" : `on · ${ch.serve === "local" ? "local links" : `${ch.serve || "tailscale"} links`}`, mine("artifacts", "serve")]);
    const conf = RX ? RX.config || {} : S.config();
    rows.push(["Watcher", ch.watcher === "off" ? "off" : `${conf.watcherAgent || conf.helper || "claude"} · ${conf.watcherModel || conf.helperModel || "default model"}`, mine("watcher")]);
    rows.push(["Conflicts", ch.conflictAuto ? "repaired automatically" : "repaired by hand", mine("conflictAuto")]);
    rows.push(["Permissions", (RX ? RX.fullAccess : fullAccess(kind)) ? "full access" : "asks before acting", false]);
    // Context fullness and token use come from the agent's saved conversation; blank when it cannot be read, and the
    // fullness only for a model whose window is known.
    const usage = agent ? r.usage : null;
    if (usage && usage.context && usage.window) rows.push(["Context", `${Math.min(100, Math.round((usage.context / usage.window) * 100))}% full of ${tokens(usage.window)}`, false]);
    if (usage) rows.push(["Tokens", `${tokens(usage.in)} in · ${tokens(usage.out)} out`, false]);
    const fell = Object.values(r.fallbacks || {}).filter(Boolean);
    if (fell.length) rows.push(["Note", fell.join("\n"), true]);
    if (r.link?.pane) rows.push(["herdr", `${r.link.socket && !r.host ? `session ${sessionName(r.link.socket)} · ` : ""}space ${r.link.workspace || "?"} · pane ${r.link.pane}${r.link.agent ? ` · ${r.link.agent}` : ""}`, false]);
    const kw = Math.max(...rows.map(([k]) => k.length)) + 2;
    const stacked = w - kw < 16; // stack labels at narrow widths instead of clipping the values beside them
    const indent = stacked ? 2 : kw;
    const room = Math.max(1, w - indent);
    // How each review went, oldest first: "2/5 no → 3/5 no → 4/5 yes". Short of room, the oldest ones go.
    const trail = (count, oneLine) => {
      const steps = hist.map((e) => verdict(t, e)), arrow = dim(" → "), lead = `${count}${dim(" · ")}`;
      const all = lead + steps.join(arrow);
      if (!oneLine) return wrapTextWithAnsi(all, room);
      let from = 0;
      const line = () => lead + (from ? dim("… ") : "") + steps.slice(from).join(arrow);
      while (from < steps.length - 1 && visibleWidth(line()) > room) from++;
      return [truncateToWidth(line(), room, "…")];
    };
    // `limits`: how many lines each fact keeps when room is short, so none of them drops out of view.
    const table = (limits = null) => rows.flatMap(([k, v, differs], n) => {
      const tight = !!limits, keep = tight ? limits[n] : 0;
      let parts = Array.isArray(v) ? trail(v[0], tight) : String(v).split("\n").flatMap((line) => { const x = wrapTextWithAnsi(line, room); return x.length ? x : [""]; });
      if (tight && parts.length > keep) parts = [...parts.slice(0, keep - 1), truncateToWidth(parts[keep - 1] + " …", room, "…")];
      if (full && differs) parts[parts.length - 1] += t.fg("accent", " *");
      return [...(stacked ? [" " + dim(k)] : []), " " + (stacked ? " ".repeat(indent) : dim(k.padEnd(kw))) + (parts[0] ?? ""), ...parts.slice(1).map((x) => " " + " ".repeat(indent) + x)];
    });
    const facts = sec(["", ...table(), ...(full && rows.some(([, , differs]) => differs) ? [" " + t.fg("accent", "*") + dim(" this task's own, not your default")] : [])]);
    const evidence = reviewArtifacts(r.review?.artifacts);
    if (evidence.length && !full) sec([artifactLine(t, evidence[0], width), ...(evidence.length > 1 ? [" " + dim(`… ${evidence.length - 1} more: ctrl+e`)] : [])]);

    // What the agent said: its last message, or its screen while a dialog or a review is on it.
    if (agent && !(r.state === "error" && r.stage !== "nosummary") && !this.chatShows(r)) {
      const pv = this.previewOf(r);
      const text = pv.text || (approval ? r.summary : "") || "";
      if (text && text !== told) sec([...head(pv.label === "on its screen now" ? "On its screen now" : "The agent said"), ...block(text)], "start");
    }

    if (full) {
      if (evidence.length) sec(artifactLines(t, evidence, width, "Evidence").slice(0, -1));
      // Every review, the newest first: which one, its score and advice, its summary, and what it found.
      const list = (label, xs) => ((xs || []).length ? [" " + dim(label), ...xs.flatMap((x) => wrap(`- ${x}`, w - 2).map((l, n) => "   " + (n ? "  " + l : l)))] : []);
      for (const [n, e] of [...hist].reverse().entries()) {
        sec([...(n ? [""] : head(`Reviews · ${hist.length}, the newest first`)), ...flow([t.bold(`${ordinal(e.round)} review`), verdict(t, e, true), e.at ? dim(`${age(Date.now() - e.at)} ago`) : "", e.head ? dim(`commit ${String(e.head).slice(0, 7)}`) : ""]),
          ...block(e.error || e.text || "No comment."), ...list("Problems", e.problems), ...list("Checked", e.checks), ...list("Could not verify", e.limitations)]);
      }
    }

    const total = () => sections.reduce((n, s) => n + s.lines.length, 0);
    if (full || !fit || total() <= fit) return sections.flatMap((s) => s.lines);
    // Too tall for its place beside the list. Every fact stays: the table keeps to two lines a fact (the latest
    // review to four), then the long parts give up lines, then the facts keep to one line, one at a time from the
    // last, and only then do the long parts go altogether (what the agent said first, what it needs from you last).
    // The last line says where the rest is.
    const limits = rows.map(([, , , more = 0]) => 2 + more);
    facts.lines = ["", ...table(limits)];
    const space = Math.max(1, fit - 1);
    const over = () => total() - space;
    const shrink = (s, least) => {
      if (over() <= 0 || s.lines.length <= least + 1) return;
      const keep = Math.max(least, s.lines.length - over() - 1);
      s.lines = s.cut === "start" ? [...s.lines.slice(0, 2), " " + dim("…"), ...s.lines.slice(s.lines.length - (keep - 2))] : [...s.lines.slice(0, keep), " " + dim("…")];
    };
    const long = [...sections.filter((s) => s.cut === "start"), ...sections.filter((s) => s.cut === "end").reverse()];
    for (const s of long) shrink(s, s.cut === "start" ? 6 : 5);
    for (const s of long) shrink(s, 3);
    for (let n = rows.length - 1; n >= 0 && over() > 0; n--) if (limits[n] > 1) { limits[n] = 1; facts.lines = ["", ...table(limits)]; }
    // What is not a setting and sits below them (the tokens, where it runs in herdr) goes before any long part does.
    while (over() > 0 && NOT_SETTINGS.includes(rows[rows.length - 1][0])) { rows.pop(); limits.pop(); facts.lines = ["", ...table(limits)]; }
    for (const s of long) if (over() > 0) s.lines = [];
    // A very short window. Before any setting goes: whatever else is still there (what it is doing now, the
    // evidence), the empty lines, all but the first line of the title and of the status, and last the facts that are not settings, which
    // move below the settings so the cut takes them first.
    for (const s of [...sections].reverse()) if (over() > 0 && s !== top && s !== facts) s.lines = [];
    let gap = [""];
    if (over() > 0) { gap = []; facts.lines.shift(); }
    if (over() > 0) top.lines.shift();
    if (over() > 0 && titleLines.length > 1) top.lines.splice(0, titleLines.length, " " + truncateToWidth(t.bold(clean(r.title || "(no title)")), w, "…"));
    if (over() > 0) top.lines.splice(Math.max(2, top.lines.length - over())); // then the status keeps to its first line
    if (over() > 0) {
      const rank = ([k]) => (k === "Reviews" ? 0 : NOT_SETTINGS.includes(k) ? 2 : 1);
      const sorted = rows.map((row, n) => [row, limits[n]]).sort((a, b) => rank(a[0]) - rank(b[0]));
      rows.splice(0, rows.length, ...sorted.map((x) => x[0])); limits.splice(0, limits.length, ...sorted.map((x) => x[1]));
      facts.lines = [...gap, ...table(limits)];
    }
    return [...sections.flatMap((s) => s.lines).slice(0, space), " " + dim("more: ctrl+e shows the whole panel")];
  }
  listLines(width, h) {
    const t = this.theme;
    if (!this.rows.length) {
      const out = ["", " " + t.fg("overlay0", this.filter || this.mode === "find" ? "nothing matches." : this.archiveView ? "No archived tasks." : "Nothing here yet. Type what needs doing.")];
      while (out.length < h) out.push("");
      return out;
    }
    const lines = [];
    // One layout for the displayed list, across groups and outside the scroll viewport.
    const layout = this.rowLayout(this.rows.filter((row) => row.rec).map((row) => row.rec), width);
    this.rows.forEach((row) => {
      if (row.header) lines.push({ text: "", sel: false }, { text: " " + (this.byRepo ? t.bold(t.fg("subtext0", repoLabel(row.header))) : t.fg(GROUP_COLOR[row.header] || "subtext0", row.header)), sel: false });
      else if (row.note) lines.push({ text: "   " + t.fg("overlay0", row.note), sel: false });
      else lines.push({ text: this.row(row.rec, width, layout), sel: row.rec.id === this.sel });
    });
    const at = lines.findIndex((l) => l.sel);
    if (at < this.top + 2) this.top = Math.max(0, at - 2);
    if (at >= this.top + h) this.top = at - h + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, lines.length - h)));
    const out = lines.slice(this.top, this.top + h).map((l) => (l.sel ? this.hl(l.text, width) : l.text));
    while (out.length < h) out.push("");
    return out;
  }
  // Highlight a whole line: resets inside it (from truncation) would end the background early.
  hl(line, width) {
    const t = this.theme;
    return t.selected(truncateToWidth(line, width, "…", true));
  }
  // A row's columns, in the order they are drawn: the bar, the percent and the minutes left, the pull request, the
  // time. A cell the row does not have is the empty string, with no colour codes around nothing: an empty cell must
  // not count as a column. The minutes left ("12m") take the percent's colour and `etaW` cells, so the percents line up.
  rowFields(r, bars, now, etaW = 0) {
    const t = this.theme;
    const paint = (color, s) => (s ? t.fg(color, s) : "");
    const percent = r.state !== "done" && r.progress !== undefined ? paint(statusColor(r), `${String(r.progress).padStart(3)}%`) : "";
    const eta = r.state !== "done" && r.eta !== undefined ? `${r.eta}m` : ""; // shown with no percent too
    const left = etaW && (percent || eta) ? (percent ? " " : "") + (eta ? t.fg(statusColor(r), eta.padStart(etaW)) : " ".repeat(etaW)) : "";
    // The time is "working for" on a working row and "ago" on every other: the word says which.
    return { pr: paint(prColor(r), prNumber(r)), check: paint(prColor(r), prCheck(r)), eta, progress: (percent && bars ? t.fg(statusColor(r), bar(r.progress)) + " " + percent : percent) + left, elapsed: age(now - (r.at || now)), ago: r.state !== "working" };
  }
  // What a row says after its name. Never what its heading already says ("to do", "approve?").
  sentence(r) {
    const t = this.theme;
    const words = (s) => clean(s || "").replace(/\*\*|`/g, "");
    // What a row says is greyed out, never the title's colour: the two are told apart at a glance.
    const quiet = (s) => (s ? t.muted(s) : "");
    const failure = failureFor(r);
    if (failure && !failure.sentAt && (r.failure || r.prFailure)) return { text: quiet(words(failure.msg || failure.title)) };
    if (inReview(r)) {
      // The score, and the reviewer's advice in words. Which review it was only from the second on.
      const rv = currentReview(r);
      if (!rv || !Number.isInteger(rv.score)) return { text: r.review?.stale ? quiet("the work changed since its review") : "" };
      const score = t.fg(scoreColor(r, rv), `${rv.score}/5`);
      const advice = score + quiet(rv.recommend === true ? " reviewer says yes" : rv.recommend === false ? " reviewer says no" : "");
      const all = advice + (roundWords(r) ? quiet(` · ${roundWords(r)}`) : "");
      return { text: all, forms: [all, advice, score] }; // never cut: it shows whole, or shorter, or as the score alone
    }
    // Checks that fail with nothing saved about them yet: the row still says why it is not ready.
    if (r.stage === "approval" && r.prState === "failing" && !r.mergeFailed && !r.syncBlocked) return { text: quiet("the pull request's checks fail") };
    const raw = words((r.review?.stale ? reviewNote(r) : r.msg) || "");
    const msg = ["working", "needs you", "under review", "idle"].includes(raw) ? "" : raw;
    // While the reviewer works the row starts with the word: the colour alone does not say it, and its bar starts again from zero.
    // It always starts with "review"; which one it is follows, from the second on: "review (2nd) · Running the tests".
    if (reviewing(r) && r.state === "working") { const word = t.fg("review", "review"), nth = S.reviewRound(r) >= 2 ? t.fg("review", ` (${ordinal(S.reviewRound(r))})`) : ""; return { text: word + nth + (msg ? quiet(` · ${msg}`) : ""), short: word }; }
    if (r.state === "done") return { text: "" };
    if (needsYou(r)) return { text: quiet(msg || { question: "has a question", permission: "asks for your OK", auth: "needs a login" }[r.kind] || (r.state === "error" ? "failed" : "")) };
    return { text: quiet(msg) };
  }
  rowLayout(records, width) {
    const layout = { pr: 0, check: 0, progress: 0, percent: 0, eta: 0, elapsed: 3, ago: false, bars: width >= 64, now: Date.now() };
    const fields = records.map((r) => this.rowFields(r, layout.bars, layout.now));
    const max = (key) => Math.max(0, ...fields.map((f) => visibleWidth(f[key])));
    layout.elapsed = Math.max(3, max("elapsed"));
    layout.ago = fields.some((f) => f.ago); // at every width: a row that is short of room gives it up by itself
    // Extremely long PR identifiers may shorten, but must never push time off-screen.
    layout.pr = Math.min(max("pr"), Math.max(0, width - 3 - layout.elapsed - 3));
    layout.check = max("check");
    layout.progress = max("progress");
    layout.eta = max("eta");
    layout.percent = layout.bars ? Math.max(0, ...records.map((r) => visibleWidth(this.rowFields(r, false, layout.now).progress))) : layout.progress;
    return layout;
  }
  row(r, width, layout = this.rowLayout([r], width)) {
    const t = this.theme;
    const bright = r.state === "working" || r.state === "blocked";
    const title = clean(r.title || r.id) + (r.archivedAt ? " [archived]" : "");
    // The title is plain text whatever the task's state: the mark and the group's heading carry the state's colour.
    const name = bright ? t.bold(title) : title;
    const prefix = ` ${this.mark(r)} `;
    const room = Math.max(0, width - visibleWidth(prefix));
    // In the all-machines view the machine's name sits before the task's, in what the task's name leaves: it is cut first.
    const host = r.host && this.scope === "*" ? clean(r.host) : "";
    const labelName = (w) => {
      const shown = truncateToWidth(name, w, "…");
      const hostRoom = w - visibleWidth(shown) - 1;
      return (host && hostRoom >= Math.min(3, visibleWidth(host)) ? t.fg("overlay0", truncateToWidth(host, hostRoom, "…")) + " " : "") + shown;
    };
    // The name wins over the columns, and the columns win over the sentence. A row whose name does not fit gives up
    // its own columns, one at a time: the bar, the word "ago", the minutes left, the percent, the PR number and, last of
    // all, the time.
    const nameNeed = Math.min(room, visibleWidth(name));
    const fill = (s, n, left) => { const gap = " ".repeat(Math.max(0, n - visibleWidth(s))); return left ? s + gap : gap + s; }; // by terminal cells, not string length
    const build = (drop, noAgo = false) => {
      const bars = layout.bars && drop < 1;
      const etaW = drop < 3 ? layout.eta : 0;
      const fields = this.rowFields(r, bars, layout.now, etaW);
      // PR#16 is left-aligned, so the "PR#" parts line up; the mark for its checks sits in a column of its own.
      const prW = drop < 5 && layout.pr ? layout.pr + (layout.check ? 2 : 0) : 0;
      const prCell = fields.pr ? fill(truncateToWidth(fields.pr, layout.pr, "…"), layout.pr, true) + (layout.check ? " " + (fields.check || " ") : "") : "";
      const cells = [[drop >= 4 ? 0 : ((n) => n + (etaW && etaW + (n ? 1 : 0)))(bars ? layout.progress : layout.percent), fields.progress, false], [prW, prCell, true]].filter(([n]) => n);
      // Blank cells left of a row's first own column are not columns to that row: its words run into them.
      const own = cells.findIndex(([, s]) => visibleWidth(s) > 0);
      const time = drop < 6 ? t.fg("overlay0", fields.elapsed.padStart(layout.elapsed) + (layout.ago && drop < 2 && !noAgo ? (fields.ago ? " ago" : "    ") : "")) : "";
      const metadata = [...(own < 0 ? [] : cells.slice(own)).map(([n, s, left]) => fill(s, n, left)), time].filter(Boolean).join(" ");
      return { metadata, labelRoom: Math.max(0, room - visibleWidth(metadata) - (metadata ? 2 : 0)) };
    };
    let drop = 0, built = build(0);
    while (built.labelRoom < nameNeed && drop < 6) built = build(++drop);
    const said = this.sentence(r);
    // What a row needs from you outranks its bar: the bar goes when the words would be cut beside it.
    const need = needsYou(r) && said.text ? nameNeed + 2 + visibleWidth(said.text) : 0;
    if (need && built.labelRoom < need && drop < 1) built = build(1);
    // One allocation policy for every row: the name first, the columns second, the sentence in what is left.
    const sayW = visibleWidth(said.text || "");
    const lay = (b) => {
      const renderedTitle = labelName(b.labelRoom);
      const sayRoom = b.labelRoom - visibleWidth(renderedTitle) - 2;
      // A sentence cut to a few letters says nothing: it shows whole, or with at least SENTENCE_MIN cells, or not at all.
      const tail = !sayW ? "" : said.forms ? said.forms.find((f) => visibleWidth(f) <= sayRoom) || "" : sayRoom >= Math.min(sayW, SENTENCE_MIN) ? truncateToWidth(said.text, sayRoom, "…") : said.short && sayRoom >= visibleWidth(said.short) ? said.short : "";
      return { metadata: b.metadata, tail, label: renderedTitle + (tail ? "  " + tail : "") };
    };
    // The word "ago" goes when that is what lets the sentence show: at all, whole, or as a fuller verdict. A sentence
    // that would be cut either way keeps it.
    let out = lay(built);
    if (sayW && visibleWidth(out.tail) < sayW && layout.ago && drop < 2) { const lean = lay(build(drop, true)), w = visibleWidth(lean.tail); if (w > visibleWidth(out.tail) && (!out.tail || w === sayW || said.forms)) out = lean; }
    const { metadata, label } = out;
    return prefix + label + " ".repeat(Math.max(0, room - visibleWidth(label) - visibleWidth(metadata))) + metadata;
  }
}

// ---- the same tasks, told to the terminal (OSC 7501) ----------------------------------------------------------------
const b64 = (s) => Buffer.from(String(s), "utf8").toString("base64");
export function osc(r) {
  const pairs = [`state=${r.state}`, `id=${r.id}`];
  if (r.kind) pairs.push(`kind=${r.kind}`);
  if (r.progress !== undefined) pairs.push(`progress=${r.progress}`);
  if (r.eta !== undefined) pairs.push(`eta=${r.eta}`);
  if (r.app && /^[A-Za-z0-9_.+-]{1,32}$/.test(r.app)) pairs.push(`app=${r.app}`);
  if (r.title) pairs.push(`title=${b64(S.oneLine(r.title, 192))}`);
  if (r.msg) pairs.push(`msg=${b64(S.oneLine(r.msg, 600))}`);
  return `\x1b]7501;${pairs.join(":")}\x1b\\`;
}
export const oscClear = (id) => `\x1b]7501;state=clear:id=${id}\x1b\\`;

