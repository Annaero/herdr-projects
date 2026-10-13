// The settings page for the web board: every work setting of the open task (or automation) as a row the page can
// change. The rows are the terminal board's settings page (view/panel-edit.js): the same settings, in the same order,
// each with its plain label, what it means, its value, the place the value comes from and what it may be. Nothing is
// decided here: a change goes back through the board's own save (web-view.js: setSetting).
import * as S from "../store.js";
import { valueSay, wordsOf } from "../board/view/panel-edit.js";

// `auto`: `r` is an automation. null for a row that has no settings (a message that waits for the Coordinator).
export function settingsOf(v, r, auto = false) {
  if (!r || (!auto && r.title === undefined)) return null;
  const whose = auto ? "this automation" : "this task";
  const rows = (auto ? v.autoSettingRows(r) : v.editRows(r)).map((x) => {
    const e = S.entryOf(x.name) || {}, words = wordsOf(e);
    return {
      name: x.name, label: e.label || x.name, means: e.means || "", own: !!x.own,
      value: valueSay(x.value).replace(/\s*\n\s*/g, " / "),
      // Where it comes from, and what a reader must know of it: why it does nothing here, or that it counts later.
      from: [x.note || (x.own ? whose : x.from), x.later].filter(Boolean).join(" · "),
      // One of a few words: the page offers them. Anything else is typed, and `hint` says what it may be.
      words: words ? words.map((w) => ({ value: String(w), say: valueSay(w), now: w === x.value })) : null,
      hint: words ? "" : v.valueWords(x),
    };
  });
  // Read-only: an archived task, and another machine's automation whose machine did not send its settings.
  const canSet = !r.archivedAt && (!auto || v.autoCanSet(r));
  // `show`: counts up each time the board is asked for this part by its key, so the page opens it and goes there.
  return { id: String(auto ? r.row : r.id), whose, canSet, show: v.showSettings || 0, rows };
}
