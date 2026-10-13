// Another machine's automations: what this machine sends of its own when a board elsewhere asks for its list, and
// what it does when that board turns one on or off, fires it, removes it or changes one of its settings. An automation never moves: it is changed
// on the machine that has it, as a task is (remote.js).
import * as S from "../store.js";
import * as L from "../automations/list.js";
import { fire } from "../automations/fire.js";
import { firings, turnedWords, firedWords } from "../automations/show.js";

// The firings sent with each: what the asking board's panel lists (view/automation-panel.js).
const FIRINGS_SENT = 20;

// Each automation as it is saved, with what the asking side cannot read from here: its latest firings, newest first,
// the settings that are its own, and every work setting as its next task will have it here, each with the place it
// comes from: the asking board's settings page for it (view/panel-edit.js).
const sent = (x) => ({ name: x.name, value: x.value, from: x.from, own: !!x.own, note: x.note || "" });
export const automationsSent = () => S.automations().map((a) => { const rows = L.settingRows(a).map(sent); return { ...a, shown: { firings: firings(a).slice(0, FIRINGS_SENT), own: rows.filter((x) => x.own).map((x) => ({ name: x.name, value: x.value, own: true })), settings: rows } }; });
export const isAutomationAction = (action) => ["auto-turn", "auto-run", "auto-remove", "auto-set"].includes(String(action));
// One of the things a board does to an automation, answered as every action is: { ok, msg }.
export function automationDo(req) {
  const a = L.find(req.id);
  if (req.action === "auto-turn") return { ok: true, msg: turnedWords(L.turn(a.id, req.on === true))[0] };
  // One of its own settings, from the asking board's settings page: a value, or none to put the row back.
  if (req.action === "auto-set") { const r = req.value === undefined || req.value === null ? L.unsetSetting(a.id, String(req.name)) : L.setSetting(a.id, String(req.name), req.value); return { ok: true, msg: `${S.entryOf(r.name)?.label || r.name}: ${S.say(r.value).split("\n")[0]}  (${r.from})` }; }
  if (req.action === "auto-remove") { L.remove(a.id); return { ok: true, msg: `Removed the automation "${a.name}".` }; }
  if (!a.on) return { ok: false, msg: `"${a.name}" is off, and off it never fires.` };
  const f = fire(a, { kind: "run" });
  return { ok: !!f.task, msg: firedWords(a, f)[0] };
}
