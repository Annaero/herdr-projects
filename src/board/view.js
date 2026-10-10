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
import { artifactLine, artifactLines, reviewArtifacts } from "./artifact-lines.js";

// The five states, in the order they need you.
const ORDER = ["blocked", "error", "working", "done", "idle"];
// herdr's own colour for each state (its status_color); a failure, which herdr has no state for, is red like blocked.
const COLOR = { blocked: "red", error: "red", working: "yellow", done: "teal", idle: "green" };
// "review" is not a kind a task carries: it is how the board shows blocked, kind permission, when the approval it
// waits for is the merge of finished work. A merge that failed is shown as plain permission again.
const isAgent = (r) => !!r.agent && !["todo", "progress"].includes(r.stage);
const failureFor = (r) => (r.stage === "nosummary" ? null : A.failureOf(r));
const canSendError = (r) => !!r && !r.host ? A.canSendError(r) : !!r && (r.stage === "nosummary" || (r.stage === "failed" && !r.failure?.auth));
const inReview = (r) => r.state === "blocked" && r.kind === "permission" && r.stage === "approval" && !r.mergeFailed;
const kindOf = (r) => (inReview(r) ? "review" : r.kind || "");
const kindColor = (r) => (inReview(r) ? "teal" : "red");
const ROLE_COLOR = { agent: "accent", reviewer: "mauve" };
const reviewing = (r) => r.state !== "done" && (r.stage === "reviewing" || r.stage === "reviewneeds");
const statusColor = (r) => (reviewing(r) && r.state === "working" ? ROLE_COLOR.reviewer : COLOR[r.state]);
const statusLabel = (r) => (reviewing(r) && r.state === "working" ? "reviewing" : r.state);
const currentReview = (r) => S.currentReview(r);
// Strip only board-generated review metadata; task descriptions and agent wording stay intact.
const reviewNote = (r) => (isAgent(r) ? String(r.msg || "").replace(/^(Approve to merge\?\s*)?Reviewed [1-5]\/5(?:, says (?:don't )?(?:merge|accept))?\.\s*/, "$1") : r.msg);
const KIND = { // what it needs, what to type
  question: ["the user must type an answer", "type your answer"],
  permission: ["approval to do something", "say what should change, or ctrl+a to approve"],
  auth: ["a login, token, or credential", "fix the login, then tell the agent to continue"],
};
const HELP = [
  ["enter", "send what you typed to the Coordinator; with nothing typed, go into the selected task's agent in herdr"],
  ["→", "go into the selected task's agent: its real herdr pane. The board closes; your key or `herdr-superwork` brings it back"],
  ["space", "preview its agent's last message (its screen when a dialog is showing), and reply without going in"],
  ["ctrl+e", "open full details; ↑/↓, PgUp/PgDn, Home/End scroll; esc returns to the board"],
  ["ctrl+b", "hide or show the sidebar; remembers your choice"],
  ["tab", "put an agent on the selected task (with text: the Coordinator files it and delegates it)"],
  ["alt+a", "archive the selected task; on an archived task, restore it (keeps its state and all data)"],
  ["alt+h", "open all archived tasks; press again or esc to return"],
  ["ctrl+z", "undo the last archive (with an empty prompt)"],
  ["ctrl+x", "stop the selected agent (selection advances); twice on the same non-working task to clear"], ["ctrl+t", "pin to the top, or unpin"], ["ctrl+s", "group by state or by repo"], ["ctrl+f", "find"], ["ctrl+d", "show all done, or only the latest"],
  ["ctrl+a", "approve what the selected task is waiting for: finished work is merged"],
  ["ctrl+o", "whose board: this machine, every machine you can reach, then each one in turn; @name sends an instruction to that machine"],
  ["ctrl+r", "send an error to its agent to fix (or tell a stopped agent to continue); otherwise send review findings (below 5/5)"],
  ["ctrl+y", "finish anyway: when the agent stopped without a summary, run the check and review on what it left"],
  ["ctrl+g", "send the selected task's failure details to its agent to fix; never approves a merge"],
  ["↑ ↓", "edit the draft; with an empty box, move between tasks"], ["shift+enter / ctrl+j", "new line"], ["PgUp/PgDn", "scroll a long draft; with an empty box, move between tasks"], ["shift+↑/↓", "move between tasks, even with a draft"], ["alt+↑/↓", "jump groups"], ["ctrl+↓ / ctrl+↑", "go to what the Coordinator is doing, and back"], ["esc", "back, clear, or quit"], ["?", "close"],
];
const short = S.tilde;
const clean = (s) => String(s ?? "").replace(/[\x00-\x1f\x7f]+/g, " ");
const age = (ms) => { const x = Math.max(0, Math.round(ms / 1000)); return x < 60 ? `${x}s` : x < 3600 ? `${Math.floor(x / 60)}m` : x < 86400 ? `${Math.floor(x / 3600)}h` : `${Math.floor(x / 86400)}d`; };
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
  peek = false; detailsId = ""; detailsTop = 0; detailsHeight = 1; detailsLength = 0;
  mode = "new"; help = false; byRepo = false; sidebarHidden = false;
  scope = ""; // whose board you see: "" this machine, "*" every machine, or one other machine by name
  remotes = {}; machinesAt = 0;
  filter = ""; msg = ""; msgKind = "overlay0"; msgAt = 0;
  armed = { id: "", at: 0 }; back = ""; jobs = []; jobTop = 0; lastCtrlC = 0; tick = 0; disposed = false;
  screens = new Map(); // what an agent's pane shows, read through herdr, cached
  sent = new Map(); setup = null;

  constructor(tui, theme, done, ctx) {
    this.tui = tui; this.theme = theme; this.done = done; this.ctx = ctx;
    this.input = new DraftEditor(tui, theme);
    this.prefs = path.join(S.dataDir(), "view.json");
    const prefs = S.readJson(this.prefs) || {};
    this.byRepo = !!prefs.byRepo; this.sidebarHidden = !!prefs.sidebarHidden; this.scope = String(prefs.scope || "");
    // The board closes each time you go into an agent: selection, filter and draft come back when it reopens.
    this.sel = String(prefs.sel || ""); this.filter = String(prefs.filter || ""); if (prefs.draft) this.input.setText(String(prefs.draft)); this.peek = !!prefs.peek;
    if (this.all) this.pollRemotes();
    this.repo = S.repoOf(ctx.cwd);
    this.canDispatch = H.dispatcherReady();
    this.load();
    try { this.stamp = codeStamp(); } catch {}
    try { this.startSetup(); } catch {}
    this.timer = setInterval(() => this.beat(), 1000);
  }
  // The first run: ask once what the plugin may add to herdr's settings. Only inside herdr, only what is missing.
  startSetup() {
    if ((!inHerdr() && !process.env.HERDR_PLUGIN_ID) || process.env.HERDR_SUPERWORK_INLINE === "1") return;
    const o = X.offers();
    if (o.asked) return;
    const steps = [
      o.key && { what: "key", q: "Bind a key that opens this board from anywhere in herdr?", how: `Type the key and press enter${o.key.suggest ? ` (enter alone takes ${o.key.suggest}; herdr's own keys and yours are refused)` : " (for example prefix+a)"}, or n for no.`, suggest: o.key.suggest },
      o.sidebar && { what: "sidebar", q: "Show each task's stage and its \"doing now\" line in herdr's sidebar?", how: "herdr's sidebar only shows them when its settings list them. y adds the rows; n keeps a short status in the agent's name instead." },
    ].filter(Boolean);
    if (!steps.length) { X.answer({}); return; }
    this.setup = { steps, at: 0, file: o.file, said: "" };
  }
  setupKey(data) {
    const st = this.setup, step = st.steps[st.at];
    const next = (patch) => { X.answer(patch); st.at++; this.setValue(""); if (st.at >= st.steps.length) { this.setup = null; this.flash(st.said || "Done. `herdr-superwork remove-extras` undoes it.", "green"); } };
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { this.setup = null; this.setValue(""); return this.flash("Asked again next time. Nothing was changed."); }
    const enter = matchesKey(data, "return") || matchesKey(data, "enter");
    if (!enter) return this.input.handleInput(data);
    const v = this.value().trim().toLowerCase();
    const no = ["n", "no"].includes(v), yes = ["y", "yes", ""].includes(v);
    if (no) return next(step.what === "key" ? { key: "no" } : { sidebarAnswer: "no" });
    const arg = step.what === "key" ? (yes ? step.suggest : v) : undefined;
    if (step.what === "key" && !arg) { this.setValue(""); return this.flash("Type a key such as prefix+a, or n.", "peach"); }
    if (step.what !== "key" && !yes) { this.setValue(""); return this.flash("y or n.", "peach"); }
    const r = X.addBlock(step.what, arg);
    if (!r.ok && !r.paste) { this.setValue(""); return this.flash(r.msg, "red"); } // refused: ask again
    st.said = r.ok ? `Added to ${short(st.file)}. \`herdr-superwork remove-extras\` undoes it.` : r.msg;
    if (r.paste) st.paste = r.msg;
    next(step.what === "key" ? { key: r.ok ? arg : "paste" } : { sidebarAnswer: r.ok ? "yes" : "paste" });
    if (r.paste) { this.detailsId = ""; this.pasteText = r.msg; }
  }
  setupLines(width, rowsN) {
    const t = this.theme, st = this.setup, step = st.steps[st.at];
    const wrap = (text) => wrapTextWithAnsi(text, Math.max(10, width - 4)).map((l) => "  " + l);
    const L = ["", "  " + t.bold("herdr-superwork · first run") + t.fg("overlay0", `  ·  question ${st.at + 1} of ${st.steps.length}`), "", ...wrap(t.bold(step.q)), "", ...wrap(t.fg("subtext0", step.how)), "",
      ...wrap(t.fg("overlay0", `It is added to ${short(st.file)} between two marker lines; the file is backed up first, and herdr-superwork remove-extras takes it out again. esc: ask me next time.`)), "",
      `  ${t.fg("accent", "❯")} ${this.value() || t.fg("overlay0", step.what === "key" ? step.suggest || "prefix+…" : "y / n")}`];
    if (this.msg && Date.now() - this.msgAt < 8000) L.push("", ...wrap(t.fg(this.msgKind, this.msg)));
    return this.pad(L, rowsN);
  }
  get all() { return this.scope !== ""; }
  beat() {
    this.tick++;
    if (this.all && this.tick % 5 === 0) this.pollRemotes();
    // With a keeper alive the board only looks: the keeper polls, watches and alerts. Without one the board does all
    // of it itself, as it always did, so a missing keeper never makes the board worse.
    if (!keeperAlive()) { try { tickOnce(currentSocket(), { watch: (rows) => H.watchTick(rows.map(asRow)) }); } catch {} }
    // An open board keeps running the code it started with: say so when the plugin changed underneath it.
    if (this.tick % 5 === 0) { try { if (this.stamp && codeStamp() !== this.stamp) { this.stale = true; this.flash("herdr-superwork was updated. Close the board (esc) and open it again to get the new version.", "peach"); } } catch {} }
    try { this.load(); } catch {}
    try { this.announce(); } catch {}
    this.tui.requestRender();
  }
  dispose() { this.disposed = true; clearInterval(this.timer); this.savePrefs(); if (this.sent.size) { try { process.stdout.write([...this.sent.keys()].map(oscClear).join("")); } catch {} } }
  invalidate() { this.input.invalidate(); }
  get focused() { return this.input.focused; }
  set focused(value) { this.input.focused = value; }
  savePrefs() { try { S.writeJson(this.prefs, { byRepo: this.byRepo, scope: this.scope, sidebarHidden: this.sidebarHidden, sel: this.sel, filter: this.filter, draft: this.mode === "new" ? this.value() : "", peek: this.peek }); } catch {} }
  flash(text, kind = "overlay0") { this.msg = clean(text); this.msgKind = kind; this.msgAt = Date.now(); }
  value() { return this.input.getText(); }
  setValue(v) { this.input.setText(v); }
  current() { return this.items.find((r) => r.id === this.sel); }
  job() { return this.jobs.find((j) => j.id === this.sel); }
  try(fn, sentReply = false) { const repliedTo = sentReply ? this.sel : ""; let ok = true; try { fn(); } catch (e) { ok = false; this.flash(e.message, "red"); } this.load(repliedTo); return ok; }

  // For a board run as a plain command: its tasks as OSC 7501 records on its own terminal. Output only: nothing
  // reads OSC 7501. No bell, sound or message says that a task newly needs you.
  announce() {
    const local = this.items.filter((r) => !r.host && !r.archivedAt);
    if (process.env.HERDR_PLUGIN_ID || process.env.HERDR_SUPERWORK_PROGRAM_STATUS === "0") return;
    const next = new Map();
    for (const r of local) if (r.state !== "idle" && !(r.state === "done" && r.seen)) next.set(r.id, osc(r));
    let out = "";
    for (const [id, seq] of next) if (this.sent.get(id) !== seq) out += seq;
    for (const id of this.sent.keys()) if (!next.has(id)) out += oscClear(id);
    this.sent = next;
    if (out) process.stdout.write(out);
  }

  load(repliedTo = "") {
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
      : [["archived", shown.filter((r) => r.archivedAt)], ["pinned", shown.filter((r) => r.pinned && !r.archivedAt)], ...ORDER.map((st) => [st, shown.filter((r) => r.state === st && !r.pinned && !r.archivedAt)])];
    const isDone = (r) => r.state === "done" && !r.pinned && !r.archivedAt;
    const rank = (r) => (r.archivedAt ? -2 : r.pinned ? -1 : ORDER.indexOf(r.state));
    for (const [name, recs] of groups) {
      if (!recs.length) continue;
      rows.push({ header: name });
      // Inside a project: pinned first, then the order of the status groups, so what needs you is on top.
      // A long done list folds to the latest few, unseen results first.
      const list = [...recs].sort((a, b) => (this.byRepo ? rank(a) - rank(b) : 0) || (a.archivedAt && b.archivedAt ? b.archivedAt - a.archivedAt : 0) || (isDone(a) && isDone(b) ? Number(!!a.seen) - Number(!!b.seen) || b.at - a.at : 0));
      const done = list.filter(isDone);
      const folded = !this.allDone && !f ? done.slice(5).filter((r) => r.id !== this.sel) : [];
      for (const r of list) {
        if (!folded.includes(r)) rows.push({ rec: r });
        if (folded.length && r === done[done.length - 1]) rows.push({ note: `… ${folded.length} more (ctrl+d shows them)` });
      }
    }
    this.rows = rows;
    const selectable = [...rows.filter((r) => r.rec).map((r) => r.rec), ...this.jobs];
    // Only the selected task's ordering data matters. New rows, progress updates and other tasks moving must not
    // steal selection. Reading a done result (seen) is excluded: it stays selected until you move away.
    const base = new Map(this.items.map((r, n) => [r.id, n]));
    const nextRows = selectable.map((r) => ({ id: r.id, order: JSON.stringify([r.state, !!r.pinned, r.created, !!r.archivedAt]), at: r.title !== undefined && isDone(r) ? r.at : 0, done: r.title !== undefined && isDone(r), seen: !!r.seen, base: base.get(r.id) ?? -1 }));
    const ids = nextRows.map((r) => r.id);
    const before = this.selectionRows.findIndex((r) => r.id === this.sel);
    const afterIndex = ids.indexOf(this.sel);
    const after = nextRows[afterIndex];
    const selected = this.sel;
    const old = this.selectionRows[before];
    const fresh = !!old && !!after && old.seen && !after.seen;
    const crossed = !!old && !!after && old.done && after.done && (fresh || (old.seen === after.seen && old.at !== after.at)) && this.selectionRows.some((r, n) => {
      const to = ids.indexOf(r.id);
      if (to < 0 || r.id === selected || !r.done || (this.byRepo && r.id.split("/")[0] !== selected.split("/")[0])) return false;
      const wouldPrecede = r.seen !== after.seen ? !r.seen : r.at > after.at || (r.at === after.at && r.base < old.base);
      return (n < before) !== wouldPrecede && (n < before) !== (to < afterIndex);
    });
    const reading = !!this.detailsId || (this.peek && !!this.value() && repliedTo !== selected);
    if (layout === this.selectionLayout && old && !reading && (!after || after.order !== old.order || crossed)) {
      // Prefer the old successor, then the next surviving row below it, then the nearest survivor above. Never
      // chase the moved task if a neighbour remains.
      const neighbors = [...this.selectionRows.slice(before + 1), ...this.selectionRows.slice(0, before).reverse()];
      this.sel = neighbors.find((r) => ids.includes(r.id))?.id || (after ? selected : ids[0] || "");
    }
    if (!ids.includes(this.sel)) this.sel = ids[0] || "";
    this.selectionRows = nextRows;
    this.selectionLayout = layout;
    if (this.sel !== selected) this.load(); // rebuild the done fold for the new selection
  }
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
  // One instruction for the dispatcher. While it runs it is a row of its own, so you can select it and stop it.
  dispatch(text, delegate, about) {
    // Another machine's dispatcher: for a task of theirs you have open, or when you start with its name ("@vm-a fix the build").
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
    if (!this.canDispatch) {
      // Helpers are off (no adapter for the helper kind, or it cannot be restricted to the board's commands):
      // what you type is filed as a task, word for word.
      const about0 = about && !about.host ? about : null;
      if (about0) { A.describe(about0.id, `${about0.description ? `${about0.description}\n\n` : ""}${text}`); this.flash(`${about0.id}: added to its description`, "green"); return this.load(); }
      const [title, ...restLines] = text.split("\n");
      const t = A.add(this.ctx.cwd, title, { description: restLines.join("\n") });
      if (delegate) A.delegate(t.id);
      this.flash(`${t.id}: filed${delegate ? ", an agent is on it" : ""}`, "green");
      this.sel = t.id;
      return this.load();
    }
    H.startDispatch(this.ctx.cwd, text, delegate, about ? about.id : undefined);
    this.load();
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
        this.peek = false; this.armed = { id: "", at: 0 };
        this.load();
      }
      after?.(!!j?.ok);
      this.pollRemotes(true); this.tui.requestRender();
    });
  }
  // done means the result is ready and not yet seen. Once you have looked, it dims.
  seen(r) { if (r && r.state === "done" && !r.seen) { if (r.host) { r.seen = true; return this.act(r, "seen", {}, true); } try { A.seen(r.id); } catch {} } }
  closePeek() { this.seen(this.current()); this.peek = false; this.load(); }
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
    if (r.archivedAt) { this.detailsId = r.id; this.detailsTop = 0; return; }
    if (r.host) return this.remoteChat(r);
    if (!F.isAgentTask(r)) return this.flash("No agent has been on this yet. Tab puts one on it.", "peach");
    F.assertLive(r);
    const api = herdr(r.link.socket);
    // Its space may have been closed (archive closes it): reopen it from the worktree first.
    let pane;
    try { pane = D.reopen(r.id).pane; } catch (e) { return this.flash(e.message, "peach"); }
    this.seen(r);
    const hasAgent = !!api.agentGet(pane.pane_id);
    if (!inHerdr()) {
      if (!hasAgent) return this.flash("Its agent has exited. Reply here, or ctrl+r, to start it again.", "peach");
      this.tui.stop();
      process.stdout.write("\x1b[2J\x1b[H");
      spawnSync(process.env.HERDR_BIN_PATH || "herdr", ["agent", "attach", pane.pane_id], { stdio: "inherit", env: { ...process.env, HERDR_SOCKET_PATH: r.link.socket } });
      this.tui.start(); this.tui.requestRender(true);
      return this.load();
    }
    // herdr cannot focus a bare pane by id: with no agent in it, focus its workspace and tab.
    if (hasAgent) api.agentFocus(pane.pane_id); else { api.workspaceFocus(pane.workspace_id); try { api.tabFocus(pane.tab_id); } catch {} }
    this.done({ entered: r.id });
  }
  remoteChat(r) {
    if (!r.link?.pane) return this.flash("No agent has been on this yet. Tab puts one on it.", "peach");
    const attach = (pane) => {
      const { command, args } = R.attachCommand(r.machine, pane);
      this.tui.stop();
      process.stdout.write("\x1b[2J\x1b[H");
      spawnSync(command, args, { stdio: "inherit" });
      this.tui.start(); this.tui.requestRender(true);
      this.pollRemotes(true);
      this.seen(r);
    };
    // A machine on an older plugin sends no version and would not know "reopen": attach to what is there.
    if (!r.machine.version) { this.flash(`Update herdr-superwork on ${r.host}: it cannot reopen a closed space yet.`, "peach"); return attach(r.link.pane); }
    // The owning machine reopens the task's space and restarts its exited agent in the same conversation, then we attach.
    this.flash(`${r.host}: opening…`);
    this.ssh(r.machine, "do", { action: "reopen", id: r.rid }, (j) => {
      if (!j || !j.ok) { this.flash(j ? j.msg : `${r.host} did not answer`, "red"); return this.tui.requestRender(); }
      if (!j.hasAgent) { this.flash(`${r.host}: its agent has exited and could not be restarted. Reply here to start it again.`, "peach"); return this.tui.requestRender(); }
      attach(j.pane || r.link.pane);
    }, 60000);
  }
  toggleArchive() {
    if (!this.archiveView) {
      this.archiveBack = { sel: this.sel, top: this.top, filter: this.filter, mode: this.mode, value: this.value(), peek: this.peek };
      this.archiveView = true;
      this.filter = ""; this.mode = "new"; this.setValue(""); this.peek = false; this.top = 0;
    } else {
      this.archiveView = false;
      const back = this.archiveBack;
      if (back) { this.sel = back.sel; this.top = back.top; this.filter = back.filter; this.mode = back.mode; this.setValue(back.value); this.peek = back.peek; }
      this.archiveBack = null;
    }
    this.armed = { id: "", at: 0 };
    this.load();
  }
  archiveSelected(r) {
    const action = r.archivedAt ? "restore" : "archive";
    if (r.host) return this.act(r, action);
    this.try(() => {
      if (action === "archive") { A.archive(r.id); this.archiveUndo = r; } else A.restore(r.id);
      this.peek = false; this.armed = { id: "", at: 0 };
      this.flash(action === "archive" ? `${r.id}: archived. ctrl+z undoes; alt+h opens the archive.` : `${r.id}: restored. alt+h returns to the board.`, "green");
    });
  }

  handleInput(data) {
    try { this.handle(data); } catch (e) { this.flash(e.message, "red"); }
    this.tui.requestRender();
  }
  handle(data) {
    if (this.pasteText) { this.pasteText = ""; return; }
    if (this.setup) return this.setupKey(data);
    if (this.detailsId) {
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+e") || matchesKey(data, "ctrl+c")) { this.seen(this.items.find((r) => r.id === this.detailsId)); this.detailsId = ""; return this.load(); }
      if (matchesKey(data, "home")) this.detailsTop = 0;
      else if (matchesKey(data, "end")) this.detailsTop = Math.max(0, this.detailsLength - this.detailsHeight);
      else {
        const step = Math.max(1, this.detailsHeight - 1);
        const d = matchesKey(data, "up") ? -1 : matchesKey(data, "down") ? 1 : matchesKey(data, "pageUp") ? -step : matchesKey(data, "pageDown") ? step : 0;
        this.detailsTop = Math.max(0, Math.min(Math.max(0, this.detailsLength - this.detailsHeight), this.detailsTop + d));
      }
      return; // reading never types, delegates, approves, or changes the board selection
    }
    if (this.help) { this.help = false; return; }
    if (this.input.isPasting || data.includes("\x1b[200~")) { this.input.handleInput(data); if (this.mode === "find") this.load(); return; }
    if (matchesKey(data, "alt+h")) return this.toggleArchive();
    if (matchesKey(data, "alt+a")) { const r = this.current(); return r ? this.archiveSelected(r) : this.flash("Select a task to archive or restore."); }
    if (matchesKey(data, "ctrl+z") && !this.value() && this.mode === "new" && this.archiveUndo) {
      const r = this.archiveUndo; this.archiveUndo = null;
      if (r.host) return this.act(r, "restore");
      return this.try(() => { A.restore(r.id); this.flash(`${r.id}: restored`, "green"); });
    }
    if (matchesKey(data, "ctrl+b")) { this.sidebarHidden = !this.sidebarHidden; this.savePrefs(); return this.flash(this.sidebarHidden ? "Sidebar hidden. ctrl+b shows it." : "Sidebar shown. ctrl+b hides it."); }
    if (matchesKey(data, "ctrl+e")) { const shown = this.current() || this.job(); if (shown) { this.detailsId = shown.id; this.detailsTop = 0; } else this.flash("Select a task to read its details."); return; }
    const text = this.value().trim();
    const r = this.current();
    const enter = data !== "\n" && (matchesKey(data, "return") || matchesKey(data, "enter"));
    if (matchesKey(data, "escape")) {
      if (this.mode !== "new") { this.mode = "new"; this.setValue(""); }
      else if (text) this.setValue("");
      else if (this.peek) return this.closePeek();
      else if (this.filter) this.filter = "";
      else if (this.archiveView) return this.toggleArchive();
      else this.done(undefined);
      return this.load();
    }
    if (matchesKey(data, "ctrl+c")) {
      if (text) return this.setValue("");
      if (Date.now() - this.lastCtrlC < 1500) return this.done(undefined);
      this.lastCtrlC = Date.now(); return this.flash("ctrl+c again to quit");
    }
    if (this.mode === "find" && enter) { this.filter = text; this.mode = "new"; this.setValue(""); return this.load(); }

    const j = this.job();
    if (j && !text) {
      // A dispatcher row: stop it, or take its words back into the box to change and send again.
      if (matchesKey(data, "ctrl+x")) return this.try(() => { H.stopDispatch(j); this.flash("Stopped.", "peach"); });
      if (enter || matchesKey(data, "right")) { this.try(() => H.stopDispatch(j)); return this.setValue(j.text || ""); }
      if (matchesKey(data, "tab")) return;
    }
    if (matchesKey(data, "ctrl+down") || matchesKey(data, "ctrl+up")) {
      const d = matchesKey(data, "ctrl+down") ? 1 : -1;
      const at = this.jobs.findIndex((x) => x.id === this.sel);
      if (at < 0) { if (d > 0 && this.jobs.length) { this.back = this.sel; this.sel = this.jobs[0].id; } else if (d > 0) this.flash("The Coordinator has nothing running."); return; }
      const to = at + d;
      if (to < 0) { this.sel = this.back || ""; this.load(); return; }
      this.sel = this.jobs[Math.min(this.jobs.length - 1, to)].id;
      return;
    }
    if (matchesKey(data, "alt+up")) return this.jump(-1);
    if (matchesKey(data, "alt+down")) return this.jump(1);
    if (matchesKey(data, "shift+up")) return this.move(-1);
    if (matchesKey(data, "shift+down")) return this.move(1);
    // A draft owns vertical movement, including whitespace-only drafts.
    if (matchesKey(data, "up") || matchesKey(data, "down") || matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
      if (this.value()) return this.input.handleInput(data);
      return this.move(matchesKey(data, "up") ? -1 : matchesKey(data, "down") ? 1 : matchesKey(data, "pageUp") ? -10 : 10);
    }
    if (enter) {
      if (!text) { if (r) this.chat(r); return; } // with nothing typed, enter goes straight into the selected task's agent
      // With the preview open, your words go to that task's agent. Otherwise to the dispatcher.
      if (this.peek && r?.archivedAt) return this.flash("Archived tasks are read-only. alt+a restores this task.", "peach");
      // A reply to one of this machine's tasks that never had an agent starts one with that message.
      const fresh = this.peek && r && !r.host && !r.archivedAt && !F.isAgentTask(r) && ["todo", "progress"].includes(r.stage);
      if (fresh) { if (!this.try(() => { const out = A.tell(r.id, text); this.flash(out.msg, "green"); }, true)) return; }
      else if (this.peek && r && isAgent(r) && (r.host || F.isAgentTask(r))) {
        // Busy/refused replies keep the draft; only a successful send clears it.
        if (r.host) { this.act(r, "tell", { text }, false, (ok) => { if (ok && this.sel === r.id && this.value().trim() === text) this.setValue(""); }); return; }
        if (!this.try(() => { const out = A.tell(r.id, text); this.flash(out.msg, out.msg.startsWith("queued") ? "peach" : "green"); }, true)) return;
      } else this.dispatch(text, false, this.peek ? r : undefined);
      return this.setValue("");
    }
    if (r?.archivedAt && ["tab", "ctrl+a", "ctrl+g", "ctrl+r", "ctrl+t", "ctrl+y"].some((k) => matchesKey(data, k)) && !(matchesKey(data, "tab") && text)) return this.flash("Archived tasks are read-only. alt+a restores this task.", "peach");
    if (matchesKey(data, "tab")) { if (text) { this.dispatch(text, true); return this.setValue(""); } if (r && r.host) this.act(r, "delegate"); else if (r) this.try(() => { const t = A.delegate(r.id); this.flash(t.stage === "queued" ? `${r.id}: waiting for a free slot` : `${r.id}: an agent is on it`, "green"); }); return; }
    if (!text && matchesKey(data, "right") && r) return this.chat(r);
    if (!text && data === " " && r) { if (this.peek) this.closePeek(); else this.peek = true; return; }
    // Something waits for your yes: ctrl+a approves. Finished work is merged; an agent's own request gets a yes.
    if (r && matchesKey(data, "ctrl+a") && isAgent(r) && r.state === "blocked" && r.kind === "permission") {
      if (r.host) return this.act(r, "approve");
      return this.try(() => { const out = A.approve(r.id); this.flash(out.msg, "green"); });
    }
    if (r && matchesKey(data, "ctrl+g")) { if (r.host) return this.act(r, "fix"); return this.try(() => { const out = A.sendFailure(r.id); this.flash(out.msg, "green"); }); }
    if (r && matchesKey(data, "ctrl+y")) { if (r.host) return this.act(r, "finish"); return this.try(() => { const out = A.finishAnyway(r.id); this.flash(out.msg, "green"); }); }
    // Errors take priority over old review findings.
    if (r && matchesKey(data, "ctrl+r")) {
      if (r.host) return this.act(r, r.state === "error" ? "retry" : "review");
      return this.try(() => { const out = r.state === "error" ? A.sendError(r.id) : A.sendReview(r.id); this.flash(out.msg, "green"); });
    }
    if (r && r.host && matchesKey(data, "ctrl+t")) return this.act(r, "pin");
    if (matchesKey(data, "ctrl+o")) {
      try { const ring = ["", "*", ...Object.keys(this.remotes).filter((k) => this.remotes[k].ok).sort()]; this.scope = ring[(ring.indexOf(this.scope) + 1) % ring.length] ?? ""; this.savePrefs(); } catch {}
      if (this.all) { this.machinesAt = 0; this.pollRemotes(true); }
      // Machines are found through herdr only: with none saved, say how to add one.
      if (this.all && !Object.keys(this.remotes).length) { let none = false; R.machines((list) => { none = !list.length; }); if (none) { this.scope = ""; this.savePrefs(); this.flash(S.config().machines === "off" ? "Other machines are off (config machines auto turns them on)." : "No other machines. Add one with: herdr machine add <name> <ssh target>  (or name them in the machines setting).", "peach"); return this.load(); } }
      this.flash(this.scope === "" ? "This machine only." : this.scope === "*" ? "Every machine you can reach. ctrl+o again for one at a time." : `Only ${this.scope}. What you type goes to ${this.scope}.`);
      return this.load();
    }
    if (r && matchesKey(data, "ctrl+t")) return this.try(() => A.pin(r.id));
    if (matchesKey(data, "ctrl+d")) { this.allDone = !this.allDone; return this.load(); }
    if (!text && data === "?") { this.help = true; return; }
    if (matchesKey(data, "ctrl+s")) { this.byRepo = !this.byRepo; this.savePrefs(); return this.load(); }
    if (matchesKey(data, "ctrl+f")) { this.mode = "find"; this.setValue(this.filter); return; }
    if (r && matchesKey(data, "ctrl+x")) {
      const running = r.state === "working" && (isAgent(r) || r.stage === "progress") || r.stage === "queued" || (isAgent(r) && r.stage === "working");
      if (running) { this.armed = { id: r.id, at: Date.now() }; if (r.host) return this.act(r, "stop"); return this.try(() => { A.stop(r.id); this.flash(`${r.id}: stopped, idle.`, "peach"); }); }
      if (this.armed.id === r.id && Date.now() - this.armed.at < 3000) {
        if (r.host) return this.act(r, "clear");
        A.clear(r.id).then((out) => { this.flash(out.kept.length ? `${r.id} cleared. Kept, so no work is lost: ${out.kept.join(", ")}` : `${r.id} cleared`, out.kept.length ? "peach" : "overlay0"); this.load(); this.tui.requestRender(); }, (e) => { this.flash(e.message, "red"); this.tui.requestRender(); });
        return this.flash(`${r.id}: clearing…`);
      }
      this.armed = { id: r.id, at: Date.now() };
      return this.flash(`ctrl+x again to clear ${r.id}`, "peach");
    }
    this.input.handleInput(data);
    if (this.mode === "find") this.load();
  }

  render(width) { return this.draw(width).map((l) => this.theme.line(l)); }
  draw(width) {
    const rowsN = Math.max(8, this.tui.terminal.rows);
    const fit = (s) => truncateToWidth(s, width, "…", true);
    try {
      const t = this.theme;
      const r = this.current();
      if (this.pasteText) return this.pad(["", ...String(this.pasteText).split("\n").flatMap((l) => wrapTextWithAnsi(l, Math.max(10, width - 4))).map((l) => "  " + l), "", "  " + t.fg("overlay0", "any key continues")], rowsN).map(fit);
      if (this.setup) return this.setupLines(width, rowsN).map(fit);
      if (this.detailsId) return this.pad(this.detailLines(width, rowsN), rowsN).map(fit);
      const n = (s) => this.items.filter((i) => i.state === s && (this.archiveView ? i.archivedAt : !i.archivedAt)).length;
      const rule = t.fg("surface1", "─".repeat(width));
      const agentOn = r && isAgent(r);
      const failure = r && failureFor(r);
      const failureAction = failure ? (failure.agentCanFix ? (failure.sentAt && r.state === "working" ? "Details sent · agent is working" : "ctrl+g send details to agent") : "Needs you · " + failure.next) : "";
      const place = this.mode === "find" ? "find (includes archived tasks)"
        : this.peek && r?.archivedAt ? "archived · alt+a restores this task"
        : this.peek && r ? (agentOn && failure ? (failure.agentCanFix ? "say what should change, or ctrl+g to send details" : "fix the blocker, then reply here") : agentOn && r.state === "blocked" && r.kind ? KIND[r.kind][1] : agentOn ? `reply to ${clean(r.title || r.id)}` : r.host || !["todo", "progress"].includes(r.stage) ? "what should change about this one?" : "reply to put an agent on it with your message")
        : this.canDispatch ? "what's next?" : "what's next? (no Coordinator: what you type is filed as a task, word for word)";
      const v = this.value();
      const selectedJob = this.jobs.findIndex((j) => j.id === this.sel);
      const inputLines = this.input.renderWithin(width, rowsN - 4 - (selectedJob >= 0 ? 1 : 0), (s) => t.fg("accent", s));
      if (!v) inputLines[1] = `${t.fg("accent", "❯")} ${this.focused ? CURSOR_MARKER : ""}${t.inverse(place[0])}${t.fg("overlay0", place.slice(1))}`;
      const jobLine = (j) => {
        const line = " " + (j.state === "error" ? t.fg("red", t.mark("error")) : t.fg("yellow", t.mark("working"))) + " " + t.fg(j.state === "error" ? "text" : "subtext0", clean(j.text)) + (j.state === "error" ? t.fg("red", `  ${clean(j.msg)}`) : "");
        return j.id === this.sel ? this.hl(line, width) : line;
      };
      // The preview: what is on the selected task's agent's screen, without going in.
      const preview = [];
      const evidence = reviewArtifacts(r?.review?.artifacts);
      const hasEvidence = this.peek && !!r && evidence.length > 0;
      if ((this.peek || failure) && r) {
        if (hasEvidence) preview.push(artifactLine(t, evidence[0], width), "");
        const wrapAll = (text) => String(text).split("\n").flatMap((l) => { const w = wrapTextWithAnsi(clean(l), Math.max(10, width - 2)); return w.length ? w : [""]; });
        const title = " " + this.mark(r) + " " + t.bold(clean(r.title || r.id)) + "  " + t.fg(statusColor(r), statusLabel(r)) + (kindOf(r) ? t.fg(kindColor(r), ` · ${kindOf(r)}`) : "") + (r.progress !== undefined ? t.fg(statusColor(r), ` · ${r.progress}%`) : "") + t.fg("overlay0", `  ${idLabel(r.id)}${r.app ? ` · ${r.app}` : ""}`);
        if (failure) {
          preview.push(" " + t.fg("red", t.bold(clean(failure.title))), " " + t.fg("accent", clean(failureAction)), ...wrapAll(failure.detail).map((l) => " " + l));
        } else if (agentOn && r.state !== "error" && r.stage === "approval") {
          // A small second opinion, not a second sidebar: recommendation, score and comment.
          const fact = (label, value, color = "subtext0") => { const w = wrapTextWithAnsi(clean(value), Math.max(10, width - 19)); return w.map((l, n) => " " + (n ? " ".repeat(16) : t.fg(color, label.padEnd(16))) + l); };
          const rv = currentReview(r);
          if (rv) {
            if (typeof rv.recommend === "boolean") preview.push(...fact("Recommends", rv.recommend ? "merge" : "don't merge", rv.recommend ? "green" : "red"));
            preview.push(...fact("Score", `${rv.score}/5`, rv.score >= 5 ? "green" : rv.score >= 4 ? "subtext0" : "peach"));
            preview.push(...fact("Comment", rv.text || "No comment."));
          } else preview.push(" " + t.fg("overlay0", `${r.review?.stale ? "Awaiting a fresh review." : "No review yet."} ctrl+e full details`));
        } else {
          const note = r.review?.stale ? reviewNote(r) : r.msg;
          const pv = agentOn && !(r.state === "error" && r.stage !== "nosummary") ? this.previewOf(r) : null;
          const said = agentOn ? (pv ? pv.text : note) || note || "Nothing yet." : this.desc(r) || "No agent is on this yet. Tab puts one on it.";
          const lines = wrapAll(said);
          const maxH = Math.max(3, Math.floor(rowsN / 2) - 4);
          preview.push(rule, title + (pv?.label ? t.fg("overlay0", `  · ${pv.label}`) : ""), ...(lines.length > maxH ? [" " + t.fg("overlay0", "…")] : []), ...lines.slice(-maxH).map((l) => " " + l));
        }
      }
      // A preview is only a preview: never let it push the prompt or its controls off-screen.
      const previewH = Math.max(failure ? 3 : 2, Math.floor(rowsN / 2) - 2);
      const trimPreview = (limit) => {
        if (preview.length <= limit) return;
        if (hasEvidence && limit === 1) preview.splice(1);
        else preview.splice(Math.max(0, limit - 1), preview.length, ...(limit ? [" " + t.fg("accent", hasEvidence ? "… ctrl+e: evidence & full details" : "… ctrl+e: full details")] : []));
      };
      trimPreview(previewH);
      const extraRows = Math.max(0, rowsN - inputLines.length - 2);
      const lastJobTop = Math.max(0, this.jobs.length - extraRows);
      if (selectedJob < 0) this.jobTop = lastJobTop;
      else if (selectedJob < this.jobTop) this.jobTop = selectedJob;
      else if (selectedJob >= this.jobTop + extraRows) this.jobTop = selectedJob - extraRows + 1;
      this.jobTop = Math.max(0, Math.min(this.jobTop, lastJobTop));
      const jobs = extraRows ? this.jobs.slice(this.jobTop, this.jobTop + extraRows).map(jobLine) : [];
      trimPreview(Math.max(0, extraRows - jobs.length));
      const bottom = [...jobs, ...preview, ...inputLines];
      if (this.help) for (const [k, d] of HELP.slice(0, Math.max(1, rowsN - bottom.length - 1))) bottom.push("  " + truncateToWidth(`${t.fg("text", k)} ${t.fg("overlay0", d)}`, width - 2, "…"));
      else if (this.msg && Date.now() - this.msgAt < 6000) bottom.push("  " + t.fg(this.msgKind, this.msg));
      else bottom.push("  " + t.fg("overlay0", this.mode === "find" ? "search includes archived · enter to keep the filter · esc to clear"
        : r?.archivedAt ? "alt+a restore · ctrl+e full details · alt+h back to board · ctrl+x delete"
        : this.archiveView ? "alt+h or esc back to board · ctrl+f find archived tasks"
        : failure ? `${failureAction} · ctrl+e full details · space to preview and reply${r.stage === "approval" && r.kind === "permission" ? " · ctrl+a retry merge" : ""}`
        : r?.stage === "nosummary" ? "ctrl+r tell it to continue · ctrl+y finish anyway · enter to go in · space to preview"
        : canSendError(r) ? "ctrl+r send error to agent · ctrl+e full details · enter to go in · space to preview"
        : this.peek && r ? `${hasEvidence ? "ctrl+e evidence & details" : "ctrl+e full details"} · ctrl+b sidebar · ${agentOn && r.stage === "approval" ? `ctrl+a to approve and merge${r.review && r.review.score < 5 ? " · ctrl+r to send the review to the agent" : ""} · or type what should change` : agentOn && r.state === "blocked" && r.kind === "permission" ? "ctrl+a to say yes · or type your answer" : agentOn ? "type and enter to reply" : "type and enter to change it"} · enter to go in · space or esc to close`
        : v ? "enter to send to the Coordinator · tab to delegate · shift+enter/ctrl+j newline · ↑↓/PgUp/PgDn edit · esc clear" : this.job() ? "ctrl+x to stop it · enter to take it back and change it · ctrl+↑ back to the list" : `${this.filter ? `filter: ${this.filter} (esc clears) · ` : ""}enter go in · tab delegate · ctrl+e details · ctrl+b sidebar · alt+a archive · alt+h archives · ctrl+x stop/delete · ? shortcuts`));
      let top;
      const session = sessionName(currentSocket());
      const head = (w) => ["", " " + t.bold(this.archiveView ? "herdr-superwork · Archived tasks" : "herdr-superwork") + t.fg("overlay0", this.archiveView ? "  · alt+h back" : `  work board for herdr${session !== "default" ? ` · session ${session}` : ""}`) + (this.all ? t.fg("overlay0", this.scope === "*" ? "  ·  all machines: " : "  ·  only ") + (this.scope !== "*" ? t.fg("accent", this.scope) + (this.remotes[this.scope] && this.remotes[this.scope].ok ? "" : t.fg("overlay0", " (no answer)")) : Object.keys(this.remotes).length ? Object.values(this.remotes).map((m) => t.fg(m.ok ? "subtext0" : "overlay0", m.ok ? m.label : `${m.label} (no answer)`)).join(t.fg("overlay0", ", ")) : t.fg("overlay0", "no others found")) : ""),
        " " + t.fg("subtext0", truncateToWidth(this.repo.root === os.homedir() ? "~" : `${this.repo.name} · ${short(this.repo.root)}`, Math.max(8, w - 2), "…")),
        " " + ORDER.map((w2) => (n(w2) ? t.fg(COLOR[w2], `${n(w2)} ${w2}`) : t.fg("overlay0", `0 ${w2}`))).join(t.fg("overlay0", " · ")), ""];
      const h = Math.max(1, rowsN - bottom.length);
      if (width >= 90 && !this.sidebarHidden) {
        // Wide: a compact preview on the right. Full details get their own scrollable page.
        const paneW = Math.max(38, Math.min(70, Math.floor(width * 0.38)));
        const listW = width - paneW - 3;
        const hd = head(listW).slice(0, Math.max(0, h - 1));
        const left = [...hd, ...this.listLines(listW, Math.max(1, h - hd.length))];
        const shown = r || this.job();
        const page = shown ? this.pageLines(shown, paneW, false, h - 1) : ["", " " + t.fg("overlay0", "nothing selected.")];
        const right = shown ? [" " + t.fg("accent", page.length > h - 1 ? "More below · ctrl+e full details" : "ctrl+e full details"), ...page.slice(0, h - 1)] : page;
        // The side panel sits on herdr's sidebar colour, when the theme gives it one.
        top = Array.from({ length: h }, (_, i) => truncateToWidth(left[i] ?? "", listW, "…", true) + " " + t.fg("surface1", "│") + t.under("sidebar_bg", truncateToWidth(" " + (right[i] ?? ""), paneW + 1, "…", true)));
      } else {
        const hd = head(width).slice(0, Math.max(0, h - 1));
        top = [...hd, ...this.listLines(width, Math.max(1, h - hd.length))];
      }
      return this.pad([...top, ...bottom].slice(0, rowsN), rowsN).map(fit);
    } catch (e) {
      const out = [fit(" herdr-superwork view error: " + clean(e?.message)), fit(" press esc to close")];
      while (out.length < rowsN) out.push(fit(""));
      return out;
    }
  }
  pad(lines, n) { const out = lines.slice(0, n); while (out.length < n) out.push(""); return out; }
  // One viewport for all details, at every terminal width.
  detailLines(width, rowsN) {
    const t = this.theme;
    const r = this.items.find((r) => r.id === this.detailsId) || this.jobs.find((j) => j.id === this.detailsId);
    const lines = r ? this.pageLines(r, width, true) : [" This task is no longer on the board."];
    this.detailsHeight = Math.max(1, rowsN - 4);
    this.detailsLength = lines.length;
    this.detailsTop = Math.max(0, Math.min(this.detailsTop, Math.max(0, lines.length - this.detailsHeight)));
    const body = lines.slice(this.detailsTop, this.detailsTop + this.detailsHeight);
    while (body.length < this.detailsHeight) body.push("");
    const end = Math.min(lines.length, this.detailsTop + this.detailsHeight);
    return [" " + t.bold(`Details · ${idLabel(this.detailsId)}`) + t.fg("overlay0", " · esc back"), t.fg("surface1", "─".repeat(width)), ...body,
      " " + t.fg("overlay0", "esc back · ↑↓ scroll · PgUp/PgDn page"), " " + t.fg("overlay0", `Home/End · lines ${this.detailsTop + 1}–${end}/${lines.length}`)];
  }
  mark(r) {
    const t = this.theme;
    // herdr's own marks and colours. Finished work waiting for approval is marked as herdr marks a finished agent.
    if (r.archivedAt) return t.fg("overlay0", t.mark("unknown"));
    if (r.state === "working") return t.fg(statusColor(r), t.mark("working"));
    if (inReview(r)) return t.fg("teal", t.bold(t.mark("done")));
    if (r.state === "blocked") return t.fg("red", t.bold(t.mark("blocked")));
    if (r.state === "error") return t.fg("red", t.mark("error"));
    if (r.state === "done") return t.fg(r.seen ? "overlay0" : "teal", t.mark("done"));
    return t.fg("green", t.mark("idle"));
  }
  // The side panel. One shape, top to bottom: what is it, where does it stand, what was said, where does it live.
  // `fit` is the sidebar's height: a description too long for it is cut short so the rest stays in view.
  pageLines(r, width, full = false, fit = 0) {
    const t = this.theme;
    const w = Math.max(10, width - 2);
    const plain = (text) => String(text ?? "").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 $2").replace(/\*\*([^*]+)\*\*/g, "$1");
    const block = (text) => plain(text).split("\n").flatMap((line) => { const x = wrapTextWithAnsi(clean(line), w); return (x.length ? x : [""]).map((l) => " " + l); });
    const head = (label, color = "subtext0") => ["", ...wrapTextWithAnsi(t.fg(color, label), w).map((line) => " " + line)];
    if (r.title === undefined) { // a dispatcher row
      return ["", ...block(r.text || ""), ...head("Status"), " " + (r.state === "error" ? t.fg("red", `${t.mark("error")} failed`) : t.fg("yellow", "working")) + t.fg("overlay0", ` · Coordinator · ${age(Date.now() - (r.created || Date.now()))}`), ...head("Coordinator"), ...block(r.remote ? `on ${r.remote}` : H.coordinatorLine()), ...(r.msg ? [...head(r.state === "error" ? "Went wrong" : "Now", r.state === "error" ? "red" : "yellow"), ...block(r.msg)] : [])];
    }
    const agent = isAgent(r);
    const live = r.state === "working" || r.state === "blocked";
    const L = ["", ...wrapTextWithAnsi(t.bold(clean(r.title || "(no title)")), w).map((l) => " " + l)];
    if (full) L.push(...artifactLines(t, r.review?.artifacts || [], width, "Evidence"));

    // Where it stands: the mark, the state, what it waits for, how far, who, and its id.
    const who = r.app ? (live ? (agent ? (reviewing(r) ? "reviewer is on it" : `${r.app} is on it`) : r.app === S.me() ? "you are on it" : `${r.app} is on it`) : `last worked by ${agent ? r.app : r.app === S.me() ? "you" : r.app}`) : `nobody is on it · owner ${r.owner === S.me() ? "you" : r.owner}`;
    if (r.archivedAt) L.push(...head("Archived", "overlay0"), ...block("Read-only · alt+a on the board to restore. Original state and all data are retained."));
    L.push(...head("Status"));
    const status = this.mark(r) + " " + t.fg(statusColor(r), t.bold(statusLabel(r))) + (kindOf(r) ? t.fg(kindColor(r), ` · ${kindOf(r)}`) : "") + t.fg("overlay0", ` · ${who} · ${idLabel(r.id)} · ${r.state === "working" ? "for " : ""}${age(Date.now() - (r.at || Date.now()))}${r.state === "working" ? "" : " ago"}`);
    L.push(...wrapTextWithAnsi(status, w).map((l) => " " + l));
    if (r.progress !== undefined) L.push(" " + t.fg(statusColor(r), bar(r.progress, Math.min(24, w - 6))) + t.fg(statusColor(r), ` ${r.progress}%`));

    const failure = failureFor(r);
    if (failure) {
      L.push(...head(failure.title, "red"), ...block(failure.sentAt ? "Details sent to the agent. Kept here until the workflow succeeds." : failure.agentCanFix ? "ctrl+g on board: send details to the agent" : "Needs you first"),
        ...head("Next step"), ...block(failure.next || "Investigate and fix it."), ...head("Failure details"), ...block(failure.detail));
    }
    const desc = this.desc(r);
    L.push(...head("Description"));
    const descAt = L.length;
    L.push(...(desc ? block(desc) : [" " + t.fg("overlay0", "None.")]));
    const descLen = L.length - descAt;

    const said = agent ? this.lastSaid(r) : "";
    const note = reviewNote(r);
    const merging = r.state === "blocked" && r.stage === "approval";
    if (r.state === "working") { if (note) L.push(...head("Now", statusColor(r)), ...block(note)); }
    else if (merging || (failure && failure.detail === r.msg)) {} // shown in failure details, or below with the summary
    else if (r.state === "blocked") L.push(...head(r.kind ? { question: "Asks you", permission: "Needs your approval", auth: "Needs a login, token or credential" }[r.kind] || "Needs you" : "Needs you", "peach"), ...block(note || said || ""));
    else if (r.state === "error") {
      L.push(...head(r.stage === "nosummary" ? "Stopped without a summary" : "Went wrong", "red"), ...block((r.stage === "nosummary" ? r.screen : "") || note || said || "It failed."));
      if (r.stage === "nosummary") L.push(...block("ctrl+r on board: tell it to continue · ctrl+y: finish anyway").map((line) => t.fg("accent", line)));
      else if (canSendError(r)) L.push(...block("ctrl+r on board: send error to agent").map((line) => t.fg("accent", line)));
    }
    else if (said) L.push(...head("Last message"), ...block(said)); // the agent's closing note, word for word
    else if (note) L.push(...head("Note"), ...block(note));
    const statusHidesSaid = (r.state === "blocked" || r.state === "error") && note && note !== said;
    if (full && said && failure?.detail !== said && (r.state === "working" || merging || statusHidesSaid)) L.push(...head("Last message"), ...block(said));

    // Where it lives and what it runs on: one table of labelled facts.
    const RX = r.host ? r.snap || {} : null;
    const folder = RX ? RX.folder : S.folderOf(r.id);
    const tree = RX ? RX.tree : r.worktree && fs.existsSync(r.worktree) ? r.worktree : "";
    const ch = RX ? RX.choices || {} : S.choices(r);
    const rows = [["Project", short(folder || "")]];
    if (r.host) rows.push(["Machine", r.host]);
    const result = []; // task changes and pull request, not review content
    const wtMode = r.worktreeMode || (RX ? RX.worktree : S.config().worktree);
    const wtOwn = r.worktreeMode ? t.fg("accent", " *") : "";
    rows.push(["Worktree", (tree ? `on · ${short(tree)}` : !r.startedOnce && wtMode !== "none" && (RX ? RX.canWorktree : S.canWorktree(folder)) ? "on" : "off") + wtOwn]);
    const branch = RX ? RX.branch : S.branchOf(tree || folder);
    if (branch) rows.push(["Branch", branch + (tree && r.from ? `  (from ${r.from === "HEAD" ? "your checkout" : r.from})` : "")]);
    if (r.stage === "approval" && r.stat) result.push(["Change", String(r.stat).trim()]);
    if (r.pr) result.push(["Pull request", String(r.pr) + (r.prMerged ? "  (merged)" : "")]);
    // The agent and watcher: "*" marks a choice made for this task alone. A setting you have not chosen says "default".
    const own = r.own || {};
    const star = (...keys) => (keys.some((k) => own[k] !== undefined && own[k] !== null) ? t.fg("accent", " *") : "");
    const kind = r.agent || ch.agent;
    // Each role reads the same way: program and version, model, effort. The version is the one saved at launch.
    rows.push(["Agent", `${kind}${r.agentVersion ? ` ${r.agentVersion}` : ""} · ${ch.model || "default model"} · ${ch.effort || "default effort"}` + star("agent", "model", "effort")]);
    const conf = RX ? RX.config || {} : S.config();
    rows.push(["Watcher", (ch.watcher === "off" ? "off" : `${conf.watcherAgent || conf.helper || "claude"} · ${conf.watcherModel || conf.helperModel || "default model"}`) + star("watcher")]);
    // Context fullness and token use come from the agent's saved conversation; blank when it cannot be read, and the
    // fullness only for a model whose window is known.
    const usage = agent ? r.usage : null;
    if (usage && usage.context && usage.window) rows.push(["Context", `${Math.min(100, Math.round((usage.context / usage.window) * 100))}% full of ${tokens(usage.window)}`]);
    if (usage) rows.push(["Tokens", `${tokens(usage.in)} in · ${tokens(usage.out)} out`]);
    const fell = Object.values(r.fallbacks || {}).filter(Boolean);
    if (fell.length) rows.push(["Note", fell.join("\n")]);
    rows.push(["Conflict repair", (ch.conflictAuto ? "automatic for this task" : "manual for this task") + star("conflictAuto")]);
    rows.push(["Permissions", (RX ? RX.fullAccess : fullAccess(kind)) ? "full access" : "asks before acting"]);
    if (r.link?.pane) rows.push(["herdr", `${r.link.socket && !r.host ? `session ${sessionName(r.link.socket)} · ` : ""}space ${r.link.workspace || "?"} · pane ${r.link.pane}${r.link.agent ? ` · ${r.link.agent}` : ""}`]);
    const ORDER2 = ["Machine", "Project", "Permissions", "Conflict repair", "Worktree", "Branch", "herdr", "Agent", "Watcher", "Context", "Tokens", "Note"];
    rows.sort((x, y) => ORDER2.indexOf(x[0]) - ORDER2.indexOf(y[0]));
    const kw = Math.max(...rows.concat(result).map(([k]) => k.length)) + 2;
    const table = (list) => {
      for (const [k, v] of list) {
        const stacked = w - kw < 16; // stack labels at narrow widths instead of clipping the values beside them
        const indent = stacked ? 2 : kw;
        const parts = String(v).split("\n").flatMap((line) => { const wrapped = wrapTextWithAnsi(line, Math.max(1, w - indent)); return wrapped.length ? wrapped : [""]; });
        const roleColor = k === "Agent" ? ROLE_COLOR.agent : "subtext0";
        if (stacked && k) L.push(" " + t.fg(roleColor, k));
        L.push(" " + (stacked ? " ".repeat(indent) : t.fg(roleColor, k.padEnd(kw))) + (parts[0] ?? ""), ...parts.slice(1).map((x) => " " + " ".repeat(indent) + x));
      }
    };
    L.push("");
    table(rows);
    // The sidebar never scrolls, so a long description gives up its lines first; ctrl+e still shows all of it.
    const over = !full && fit > 0 ? L.length - fit : 0;
    // When even one line is too many, the heading carries the pointer and its blank line above goes too.
    const keep = Math.max(0, descLen - over - 1);
    if (over > 0 && descLen > 1) {
      L.splice(descAt + keep, descLen - keep, " " + t.fg("overlay0", keep ? "… ctrl+e shows the rest" : "… ctrl+e shows it"));
      const still = L.length - fit;
      if (!keep && still > 0) L.splice(descAt - (still > 1 ? 2 : 1), still > 1 ? 3 : 2, " " + t.fg("subtext0", "Description") + t.fg("overlay0", " · ctrl+e shows it"));
    }
    // The footer belongs only in full details; the sidebar ends at the task facts.
    if (full && (result.length || merging)) {
      L.push("", " " + t.fg("overlay0", "─".repeat(Math.max(1, w))));
      if (merging && !failure) L.push(...head("Ready to merge (approve on board)", inReview(r) ? "teal" : "peach"), ...block(r.summary || note || ""));
      if (result.length) { L.push(""); table(result); }
    }
    return L;
  }
  listLines(width, h) {
    const t = this.theme;
    if (!this.rows.length) {
      const out = [" " + t.fg("overlay0", this.filter || this.mode === "find" ? "nothing matches." : this.archiveView ? "No archived tasks. alt+h returns to the board." : "nothing here yet. say what needs doing.")];
      while (out.length < h) out.push("");
      return out;
    }
    const lines = [];
    // One layout for the displayed list, across groups and outside the scroll viewport.
    const layout = this.rowLayout(this.rows.filter((row) => row.rec).map((row) => row.rec), width);
    this.rows.forEach((row, n) => {
      if (row.header) { if (n) lines.push({ text: "", sel: false }); lines.push({ text: " " + (this.byRepo ? t.bold(t.fg("subtext0", repoLabel(row.header))) : t.fg(COLOR[row.header] || "subtext0", row.header)), sel: false }); }
      else if (row.note) lines.push({ text: "   " + t.fg("overlay0", row.note), sel: false });
      else lines.push({ text: this.row(row.rec, width, layout), sel: row.rec.id === this.sel });
    });
    const at = lines.findIndex((l) => l.sel);
    if (at < this.top + 1) this.top = Math.max(0, at - 1);
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
  rowFields(r, bars, now) {
    const t = this.theme;
    const done = r.state === "done";
    const pr = r.pr ? `#${String(r.pr).split("/").pop()}` : "";
    const prColor = { merged: "accent", passing: "green", failing: "red", waiting: "peach" }[r.prState] || "peach";
    const review = !done && pr ? currentReview(r) : undefined;
    const score = Number.isInteger(review?.score) && review.score >= 1 && review.score <= 5 ? t.fg("subtext0", `${review.score}/5`) : "";
    const recommendation = typeof review?.recommend === "boolean" ? t.fg(review.recommend ? "green" : "red", review.recommend ? "merge" : "don't merge") : "";
    const percent = !done && r.progress !== undefined ? t.fg(statusColor(r), `${String(r.progress).padStart(3)}%`) : "";
    return { recommendation, score, pr: pr ? t.fg(prColor, pr) : "", progress: percent && bars ? t.fg(statusColor(r), bar(r.progress)) + " " + percent : percent, elapsed: age(now - (r.at || now)).padStart(3) };
  }
  activity(r) {
    const failure = failureFor(r);
    return clean(failure && !failure.sentAt && (r.failure || r.prFailure) ? failure.msg || failure.title : (r.review?.stale ? reviewNote(r) : r.msg) || "");
  }
  rowLayout(records, width) {
    const layout = { decision: 0, recommendation: 0, score: 0, pr: 0, progress: 0, elapsed: 3, bars: width >= 64, now: Date.now() };
    const fields = records.map((r) => this.rowFields(r, layout.bars, layout.now));
    const max = (key) => Math.max(0, ...fields.map((f) => visibleWidth(f[key])));
    layout.elapsed = Math.max(3, max("elapsed"));
    // Extremely long PR identifiers may shorten, but must never push time off-screen.
    layout.pr = Math.min(max("pr"), Math.max(0, width - 3 - layout.elapsed - 3));
    layout.recommendation = max("recommendation");
    layout.score = max("score");
    layout.progress = max("progress");
    layout.percent = layout.bars ? Math.max(0, ...records.map((r) => visibleWidth(this.rowFields(r, false, layout.now).progress))) : layout.progress;
    return layout;
  }
  row(r, width, layout = this.rowLayout([r], width)) {
    const t = this.theme;
    const unseen = r.state === "done" && !r.seen;
    const bright = r.state === "working" || r.state === "blocked" || unseen;
    const faded = r.state === "done" && !unseen;
    const title = clean(r.title || r.id) + (r.archivedAt ? " [archived]" : "");
    const name = bright ? t.bold(title) : faded ? t.fg("subtext0", title) : title;
    const prefix = ` ${this.mark(r)} `;
    const room = Math.max(0, width - visibleWidth(prefix));
    // In the all-machines view the machine's name sits before the task's, in what the task's name leaves: it is cut first.
    const host = r.host && this.scope === "*" ? clean(r.host) : "";
    const labelName = (w) => {
      const shown = truncateToWidth(name, w, "…");
      const hostRoom = w - visibleWidth(shown) - 1;
      return (host && hostRoom >= Math.min(3, visibleWidth(host)) ? t.fg("overlay0", truncateToWidth(host, hostRoom, "…")) + " " : "") + shown;
    };
    // The name wins over the columns, and the columns win over the "doing now" sentence. A row whose name does not fit gives up
    // its own columns, one at a time: the verdict, the score, the bar, the percent, the PR number and, last of all, the time.
    const nameNeed = Math.min(room, visibleWidth(name));
    const pad = (s, n) => " ".repeat(Math.max(0, n - visibleWidth(s))) + s; // by terminal cells, not string length
    let metadata, labelRoom;
    for (let drop = 0; drop <= 6; drop++) {
      const bars = layout.bars && drop < 3;
      const cols = { recommendation: drop < 1 ? layout.recommendation : 0, score: drop < 2 ? layout.score : 0, pr: drop < 5 ? layout.pr : 0, progress: drop >= 4 ? 0 : bars ? layout.progress : layout.percent };
      const fields = this.rowFields(r, bars, layout.now);
      metadata = [...["recommendation", "score"].map((k) => (cols[k] ? pad(fields[k], cols[k]) : "")), cols.pr ? pad(truncateToWidth(fields.pr, cols.pr, "…"), cols.pr) : "", cols.progress ? pad(fields.progress, cols.progress) : "", drop < 6 ? t.fg("overlay0", fields.elapsed.padStart(layout.elapsed)) : ""]
        .filter(Boolean).join(" ");
      labelRoom = Math.max(0, room - visibleWidth(metadata) - (metadata ? 2 : 0));
      if (labelRoom >= nameNeed) break;
    }
    if (r.state === "done") {
      // Completed rows keep only the title, optional PR number and far-right time.
      const label = labelName(labelRoom);
      return prefix + label + " ".repeat(Math.max(0, room - visibleWidth(label) - visibleWidth(metadata))) + metadata;
    }
    // One allocation policy for every unfinished row: the name first, the columns second, the sentence in what is left.
    const activity = this.activity(r);
    const activityColor = reviewing(r) && r.state === "working" ? ROLE_COLOR.reviewer : r.state === "error" ? "red" : r.state === "blocked" ? "text" : "subtext0";
    const summary = activity ? t.fg(activityColor, activity) : t.fg(kindOf(r) ? kindColor(r) : statusColor(r), kindOf(r) || statusLabel(r));
    const renderedTitle = labelName(labelRoom);
    const summaryRoom = labelRoom - visibleWidth(renderedTitle) - 2;
    // A sentence cut to a few letters says nothing: it shows whole, or with at least SENTENCE_MIN cells, or not at all.
    const label = renderedTitle + (summaryRoom >= Math.min(visibleWidth(summary), SENTENCE_MIN) ? "  " + truncateToWidth(summary, summaryRoom, "…") : "");
    return prefix + label + " ".repeat(Math.max(0, room - visibleWidth(label) - visibleWidth(metadata))) + metadata;
  }
}

// ---- the same tasks, told to the terminal (OSC 7501) ----------------------------------------------------------------
const b64 = (s) => Buffer.from(String(s), "utf8").toString("base64");
export function osc(r) {
  const pairs = [`state=${r.state}`, `id=${r.id}`];
  if (r.kind) pairs.push(`kind=${r.kind}`);
  if (r.progress !== undefined) pairs.push(`progress=${r.progress}`);
  if (r.app && /^[A-Za-z0-9_.+-]{1,32}$/.test(r.app)) pairs.push(`app=${r.app}`);
  if (r.title) pairs.push(`title=${b64(S.oneLine(r.title, 192))}`);
  if (r.msg) pairs.push(`msg=${b64(S.oneLine(r.msg, 600))}`);
  return `\x1b]7501;${pairs.join(":")}\x1b\\`;
}
export const oscClear = (id) => `\x1b]7501;state=clear:id=${id}\x1b\\`;

