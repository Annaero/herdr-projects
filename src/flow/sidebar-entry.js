// What herdr's sidebar says about a task: its board row again, in plain words. The number and title, who is on it and where it stands, and the row's second line with its percent and time left.
//
// Nothing here has words of its own. The second line, the percent, the minutes left, the review round and the pull
// request are the board row's own code (board/view/row-says.js) drawn with no colours; who and where it stands are the
// one list's (status-words.js, board/view/states.js: whoStands); the number is the tag its row has (store/keys.js).
import * as S from "../store.js";
import { RowSays, BARE } from "../board/view/row-says.js";
import { asRow, whoStands } from "../board/view/states.js";
import { isResearch } from "../research.js";
import { WHO, COORDINATOR, coordinatorStatus } from "../status-words.js";

// herdr keeps 80 characters of a name or a token (checked on 0.9.3, its CLI reference): what is longer is cut here,
// with "…", so that it shows it was cut.
export const CAP = 80;
const SEP = " · ";
const words = (s) => String(s ?? "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim();
const cut = (s, max = CAP) => { const all = Array.from(s); return all.length <= max ? s : all.slice(0, max - 1).join("").trimEnd() + "…"; };
// The board's row, with a theme that paints nothing.
const plain = Object.assign(Object.create(RowSays.prototype), { theme: { fg: (c, s) => s, soft: (s) => s, muted: (s) => s, bold: (s) => s, dim: (s) => s } });

// A task's number and title as its row has them: `#152 Show automations…`, `HSW-152 …` where its repo has a key.
// The number comes first and whole, so a sidebar that is too narrow cuts the title, never the number.
export function taskName(t) {
  const tag = S.tagOf(t.id) || String(t.id || ""), title = words(t.title);
  return cut([tag, title].filter(Boolean).join(" "));
}
// `t`: a task as the board shows it (flow/live.js: shown). `who`: whose entry it is, where that is not the task's
// agent: the reviewer's names the reviewer whatever the task waits for. Each entry names the agent it stands for:
// while a review runs the reviewer's reads `reviewer · under review` and the task's own agent's `agent · under
// review`, so the two live agents of one task are told apart.
// Returns { name, where, stands, age, line, progress }: row 1, row 2 (`where` is its start, without the review
// round, the pull request and the tags; `age` its end, the row's time: "6m" at work, "2m ago" otherwise), and the
// two halves of row 3. `line` is empty when the
// task has nothing to say: never where it stands again.
export function entryOf(t, { who = "", now = Date.now() } = {}) {
  const r = asRow(t), at = whoStands(r), f = plain.rowFields(r, now);
  const tags = [isResearch(r) && "[research]", r.automation?.id && "[auto]"].filter(Boolean).join(" ");
  const where = [who || (at.who === WHO.reviewer ? WHO.agent : at.who), at.stand].filter(Boolean).join(SEP);
  const stands = [where, [f.review, f.pr].filter(Boolean).join(" "), tags].filter(Boolean).join(SEP);
  // A task with no words of its own has a row that says what it waits for once more ("Needs a login"): that is
  // row 2 here, so row 3 stays empty.
  const said = words(plain.sentence(r).text), line = Object.values(BARE).includes(said) || said.toLowerCase() === at.stand.toLowerCase() ? "" : said;
  // The row's time, by the minute: herdr shows what it was last told, so seconds would be a write a second.
  const age = r.at ? `${/s$/.test(f.elapsed) ? "<1m" : f.elapsed}${f.ago ? " ago" : ""}` : "";
  return { name: taskName(t), where, stands: cut(words(stands)), age, line: cut(line), progress: [f.percent, f.eta].filter(Boolean).join(" ") };
}
export const reviewerEntry = (t, opts) => entryOf(t, { ...opts, who: WHO.reviewer });
// The Coordinator's: its name and where it stands as the line above the board's box says it, and its last message.
export function coordinatorEntry(v) {
  const where = `${COORDINATOR}${SEP}${coordinatorStatus(v)}`;
  return { name: COORDINATOR, where, stands: cut(where), age: "", line: cut(words(v.error || v.said)), progress: "" };
}
