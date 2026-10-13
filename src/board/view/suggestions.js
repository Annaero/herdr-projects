// Suggested tasks: work a reviewer or an agent came across outside its own task. In the task panel, in the header's
// count, and the one key that asks about them. Nothing here ever opens by itself.
import { truncateToWidth } from "@earendil-works/pi-tui";
import * as S from "../../store.js";
import * as A from "../../actions.js";
import { clean, age } from "./words.js";
import { name as keyName } from "../keys.js";

const open = (r) => (r && r.title !== undefined ? S.openSuggestions(r) : []);

export class Suggestions {
  // How many wait for an answer, on the tasks the board shows (the archive's are left alone).
  suggestionCount() { return this.items.filter((r) => !r.archivedAt).reduce((n, r) => n + open(r).length, 0); }
  // The panel's part: the open ones, each with who raised it and what it says: all of it full screen, its first
  // lines beside the list. Full screen, the answered ones too, quietly. Returns whether something is shorter here
  // than on the full screen.
  panelSuggestions(p) {
    const { r, full, w, dim, quiet, wrap, head, first, part } = p;
    const all = S.suggestionsOf(r), waiting = open(r), done = full ? all.filter((s) => s.state !== "open") : [];
    if (!waiting.length && !done.length) return false;
    let cut = false;
    const item = (s, note) => [...wrap(s.title, w - 2).map((l, n) => (n ? "  " : dim("•") + " ") + l), "  " + dim(truncateToWidth(note, w - 2, "…"))];
    const said = (s) => { const d = S.detailOf(s); if (!d) return []; const x = wrap(d, w - 2); if (!full && x.length > 3) cut = true; return (full ? x : first(x, 3, w - 2)).map((l) => "  " + quiet(l)); };
    const lines = [head(waiting.length ? `Suggested tasks · ${waiting.length}` : "Suggested tasks"),
      ...waiting.flatMap((s) => [...item(s, `from ${S.suggestedBy(s)}${s.at ? ` · ${age(Date.now() - s.at)} ago` : ""}`), ...said(s)]),
      ...(waiting.length ? wrap(`${keyName("suggested")} makes ${waiting.length === 1 ? "it" : "one"} a task, or dismisses it`).map((l) => dim(l)) : []),
      ...done.flatMap((s) => item(s, s.state === "accepted" ? `made a task${s.task ? `: ${S.sayId(s.task)}` : ""}` : "dismissed")).map((l) => dim(l))];
    part(lines, { pri: 2, min: 3, at: (n) => first(lines, n) });
    return cut;
  }
  // The key: asks about the selected task's first open suggestion. On a task with none it goes to the first task
  // that has one. y makes it a task, n dismisses it, esc leaves it for later; then the task's next one is asked.
  suggestKey() {
    let r = this.current();
    if (!open(r).length) {
      const next = [...this.rows.filter((x) => x.rec).map((x) => x.rec), ...this.items.filter((x) => !x.archivedAt)].find((x) => open(x).length);
      if (!next) return this.flash("No suggested tasks.");
      this.sel = next.id; this.load(); r = this.current();
      if (!r || r.id !== next.id) return this.flash(`${this.idSay(next)} has a suggested task.`);
    }
    this.askSuggestion(r);
  }
  askSuggestion(r) {
    const waiting = open(r), s = waiting[0];
    if (!s) return;
    const then = (action, words) => {
      if (r.host) return this.act(r, action, { sid: s.id });
      if (!this.try(() => { const out = (action === "accept" ? A.acceptSuggestion : A.dismissSuggestion)(r.id, s.id); this.flash(words(out), action === "accept" ? "green" : "overlay0"); })) return;
      this.load();
      const again = this.items.find((x) => x.id === r.id);
      if (again && this.sel === r.id) this.askSuggestion(again);
    };
    this.confirm(`Suggested by ${S.suggestedBy(s)}${waiting.length > 1 ? ` (1 of ${waiting.length})` : ""}: "${truncateToWidth(clean(s.title), 90, "…")}". Make it a task?`,
      () => then("accept", (out) => (out.existing ? out.msg : `${out.msg}. ${keyName("delegate")} puts an agent on it.`)), null,
      { detail: S.detailOf(s), no: () => then("dismiss", () => "Dismissed. It will not be suggested again."), keys: [["sayYes", "make it a task"], ["sayNo", "dismiss"], ["back", "later"]] });
  }
}
