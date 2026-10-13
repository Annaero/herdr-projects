// A task's number on its row (`#134`), a repo's short key (`repo.key`: `HSW-134`), and naming a task by it: the tag's
// one column, what it gives way to, the three tags side by side, several repos in one list, find, and the commands.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { world } from "./helpers.js";
import { open } from "./board-helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { main } from "../src/cli.js";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { GROUPS, groupOf } from "../src/board/view/states.js";
import { GAP, NAME_LEFT, tagCells, tagColumn } from "../src/board/view/row-number.js";
import { remoteList } from "../src/remote.js";
import { rules } from "../src/delegate.js";

const at = Date.now() - 2 * 3600000;
const work = { state: "working", stage: "working", agent: "claude", at }, done = { state: "done", stage: "done", at }, todo = { state: "idle", stage: "todo", at };
const ready = { state: "blocked", kind: "permission", stage: "approval", agent: "claude", at };
const pass = { meets: true, gate: "major", pass: true, text: "Works.", findings: [] };
// A board with these tasks under their headings, as load() leaves it.
const board = (list, more = {}) => {
  const v = Object.assign(Object.create(View.prototype), { theme, scope: "", byRepo: false, top: 0, sel: "", jobs: [], repo: { name: "p", root: "/nowhere" }, ...more });
  v.grouped = { groups: more.byRepo ? [...new Set(list.map((r) => r.id.split("/")[0]))].map((g) => [g, list.filter((r) => r.id.split("/")[0] === g)]) : GROUPS.map((g) => [g, list.filter((r) => groupOf(r) === g)]), whole: false };
  v.rows = v.foldRows();
  return v;
};
const plain = (lines) => lines.map((l) => stripVTControlCharacters(l).trimEnd());
const LIST = [
  { ...ready, id: "p/134", title: "Add an undo", review: pass, reviewRound: 1, pr: 98 },
  { ...work, id: "p/34", title: "Tidy the questions", msg: "Running the tests", progress: 40, eta: 12 },
  { ...todo, id: "p/9", title: "Rename the hint line" },
  { ...done, id: "p/7", title: "Blue while the reviewer works", pr: 76 },
];
const run = async (...args) => { let out = ""; const write = process.stdout.write; process.stdout.write = (x, ...r) => (typeof x === "string" ? ((out += x), true) : write.call(process.stdout, x, ...r)); try { await main(args); } finally { process.stdout.write = write; } return out; };

test("every row has its task's number after the mark, greyed, in one column: every title starts in the same place", () => {
  const v = board(LIST), lines = plain(v.listLines(100, 30, 200));
  const row = (title) => lines.find((l) => l.includes(title));
  // `#9`, `#34` and `#134` share a column as wide as the widest, so the titles line up; live, to do and done alike.
  assert.match(row("Add an undo"), /^[ ▌]◆ #134 Add an undo +R#1 PR#98 +2h ago$/); // the three tags side by side: the task's at the left, the review and the pull request at the right
  assert.match(row("Tidy the questions"), /^[ ▌]◐ #34 {2}Tidy the questions +█+░+ +40% 12m left +2h$/);
  assert.match(row("Rename the hint line"), /^[ ▌]○ #9 {3}Rename the hint line +2h ago$/);
  assert.match(row("Blue while"), /^[ ▌]✓ #7 {3}Blue while the reviewer works +PR#76 +2h ago$/);
  assert.equal(new Set(LIST.map((r) => row(r.title).indexOf(r.title))).size, 1);
  // What a live task says starts under its title, not under its number.
  assert.equal(lines[lines.indexOf(row("Tidy the questions")) + 1], " ".repeat(8) + "Running the tests");
  if (!process.env.NO_COLOR) { // quiet: the grey of greyed-out words, never bold, whatever the task's state
    const raw = v.listLines(100, 30, 200);
    for (const r of LIST) assert.ok(raw.some((l) => l.includes(theme.muted(`#${r.id.split("/")[1]}`))), r.id);
    assert.ok(raw.some((l) => l.includes(theme.bold("Tidy the questions")) && !l.includes(theme.bold("#34"))), "the title is bold, its number is not");
  }
  // One task alone has a column as wide as its own number.
  assert.match(plain(v.rowLines(LIST[2], 60, v.rowLayout([LIST[2]], 60)))[0], /^[ ▌]○ #9 {3}Rename/); // on a list, the list's column
  const alone = board([LIST[2]]); assert.match(plain(alone.listLines(60, 5, 200)).find((l) => l.includes("Rename")), /^[ ▌]○ #9 Rename the hint line +2h ago$/);
});

test("the number gives way last before the rest of the name, for the whole list at once, and is not counted in a name's room", () => {
  const v = board(LIST), lines = (width) => plain(v.listLines(width, 30, 200)), row = (width, title) => lines(width).find((l) => l.includes(title.slice(0, 6)));
  // Wide: every column. Narrower: the columns go in their order (test/board-rows.test.js) and the number stays.
  assert.match(row(44, "Add an undo"), /^[ ▌]◆ #134 Add an undo +R#1 PR#98 +2h$/);
  assert.match(row(30, "Add an undo"), /^[ ▌]◆ #134 Add an undo +2h ago$/); // the review tag and the pull request went, together
  assert.match(row(26, "Blue while"), /^[ ▌]✓ #7 {3}Blue while the re…$/); // the time went, and the name is cut: the number is still there
  // It goes where it would leave a name fewer than NAME_LEFT cells with nothing beside it: mark (3), `#134` (4), a cell.
  const least = 3 + 4 + 1 + NAME_LEFT;
  assert.match(row(least, "Add an undo"), /^[ ▌]◆ #134 Add an undo/); assert.match(row(least - 1, "Add an undo"), /^[ ▌]◆ Add an undo/);
  for (const r of LIST) assert.doesNotMatch(row(least - 1, r.title), /#\d/, "on every row at once: the titles stay in one column");
  for (const width of [200, 100, 60, 44, 30, least, least - 1, 16, 10]) assert.ok(lines(width).filter((l) => /^ [!◐○✓] /.test(l)).every((l) => l.length <= width), `every row fits ${width}`);
  // Narrow screen (rows of three lines): the name wraps under itself, right of the number; the bar starts at the mark.
  const tall = plain(v.listLines(40, 30)), first = tall.findIndex((l) => l.includes("Tidy the questions"));
  assert.deepEqual(tall.slice(first, first + 2), [" ◐ #34  Tidy the questions", "        Running the tests"]); assert.match(tall[first + 2], /^ +[█░]+ 40% 12m left +2h$/);
  const wordy = board([{ ...work, id: "p/34", title: "A name that is long enough to need a second line on a narrow screen", msg: "Busy." }, LIST[0]]);
  assert.deepEqual(plain(wordy.listLines(40, 30)).filter((l) => /name that|second line/.test(l)), [" ◐ #34  A name that is long enough to", "        need a second line on a narrow …"]);
});

test("several repos in one list: the tag is the number or the key, never a repo's name; grouped by repo the heading names the repo", () => {
  const mix = [...LIST.slice(1, 3), { ...todo, id: "pi-work/9", title: "Same number, other repo" }, { ...todo, id: "a-repo-with-a-very-long-name/3", title: "Far away" }];
  const together = plain(board(mix).listLines(100, 30, 200)), row = (lines, title) => lines.find((l) => l.includes(title));
  assert.match(row(together, "Rename the hint line"), /^[ ▌]○ #9 {2}Rename the hint line/);
  assert.match(row(together, "Same number"), /^[ ▌]○ #9 {2}Same number, other repo/); // two `#9` in one list: accepted
  assert.match(row(together, "Far away"), /^[ ▌]○ #3 {2}Far away/); // no long name pushes the titles away
  assert.ok(together.every((l) => !/pi-work|a-repo/.test(l)));
  assert.equal(new Set(mix.map((r) => row(together, r.title).indexOf(r.title))).size, 1); // still one column
  const grouped = plain(board(mix, { byRepo: true }).listLines(100, 30, 200)); // its heading names the repo
  assert.match(row(grouped, "Same number"), /^[ ▌]○ #9 {2}Same number, other repo/); assert.match(row(grouped, "Far away"), /^[ ▌]○ #3 {2}Far away/);
  assert.ok(grouped.includes(" pi-work") && grouped.includes(" a-repo-with-a-very-long-name"));
  // Another machine's task: its machine's name before its title as before, and the tag its own machine gave it.
  const far = [{ ...todo, id: "box:p/9", rid: "p/9", host: "box", title: "Over there" }, { ...todo, id: "box:q/12", rid: "q/12", host: "box", key: "QQ", title: "Keyed there" }, LIST[2]];
  const all = plain(board(far, { scope: "*" }).listLines(100, 30, 200));
  assert.match(row(all, "Over there"), /^[ ▌]○ box#9 Over there/); assert.match(row(all, "Keyed there"), /^[ ▌]○ box:QQ-12 Keyed there/);
});

test("never more than GAP empty cells between a tag and its title: titles share a column where that costs no more, a long tag runs on", () => {
  const t = (id, title, more = {}) => ({ ...todo, id, title, ...more });
  // `#1`, `#2` and `#140` side by side with keys of different lengths (another machine's tasks carry their keys).
  const mix = [t("p/1", "One"), t("q/1", "Other one"), t("p/2", "Two"), t("p/140", "Hundred forty"), t("b:g/1", "Short key", { rid: "g/1", host: "b", key: "GT" }), t("b:h/140", "Long key", { rid: "h/140", host: "b", key: "HSWXY" })];
  const v = board(mix, { scope: "*" }), lines = plain(v.listLines(100, 30, 200)), row = (title, from = lines) => from.find((l) => l.includes(title));
  assert.equal(GAP, 3);
  assert.match(row("One"), /^[ ▌]○ #1 {3}One/); assert.match(row("Other one"), /^[ ▌]○ #1 {3}Other one/); assert.match(row("Two"), /^[ ▌]○ #2 {3}Two/); assert.match(row("Hundred forty"), /^[ ▌]○ #140 Hundred forty/);
  assert.match(row("Short key"), /^[ ▌]○ b:GT-1 Short key/); // as wide as the column
  assert.match(row("Long key"), /^[ ▌]○ b:HSWXY-140 Long key/); // wider: it runs on, and only its own title starts later
  for (const l of lines.filter((x) => /^ ○ /.test(x))) assert.ok(/^[ ▌]○ \S+ {1,3}\S/.test(l), l);
  // The column is the one that lines up the most titles; a tag too short for it stands right before its title.
  assert.equal(tagColumn([2, 2, 4, 4, 9]), 4); assert.equal(tagColumn([2, 7, 7, 7]), 7); assert.equal(tagColumn([2, 5]), 2); assert.equal(tagColumn([]), 0);
  assert.deepEqual([2, 4, 5, 7, 9].map((w) => tagCells(w, 7)), [2, 4, 7, 7, 9]); assert.equal(tagCells(4, 0), 0);
  const keyed = board([t("p/2", "Two"), ...[7, 8, 140].map((n) => t(`b:h/${n}`, `Keyed ${n}`, { rid: `h/${n}`, host: "b", key: "HSW" }))], { scope: "*" }), kl = plain(keyed.listLines(100, 30, 200));
  assert.match(row("Two", kl), /^[ ▌]○ #2 Two/); assert.match(row("Keyed 7", kl), /^[ ▌]○ b:HSW-7 {3}Keyed 7/); assert.match(row("Keyed 140", kl), /^[ ▌]○ b:HSW-140 Keyed 140/);
  // A live task's second line starts under its own title, wherever that starts; so do a wrapped name's lines.
  const live = board([{ ...work, id: "p/2", title: "Short tag", msg: "Busy here" }, { ...work, id: "b:h/1400", rid: "h/1400", host: "b", key: "HSWXY", title: "Long tag", msg: "Busy there" }, t("p/3", "Three")], { scope: "*" }), ll = plain(live.listLines(100, 30, 200));
  assert.deepEqual(ll.slice(ll.indexOf(row("Short tag", ll)), ll.indexOf(row("Short tag", ll)) + 2).map((l) => l.slice(0, 20).trimEnd()), [" ◐ #2 Short tag", "      Busy here"]);
  assert.equal(ll[ll.indexOf(row("Long tag", ll)) + 1], " ".repeat(16) + "Busy there"); assert.match(row("Long tag", ll), /^[ ▌]◐ b:HSWXY-1400 Long tag/);
  const tall = plain(live.listLines(40, 30)), at = tall.findIndex((l) => l.includes("Long tag"));
  assert.deepEqual(tall.slice(at, at + 2), [" ◐ b:HSWXY-1400 Long tag", "                Busy there            2h"]);
  for (const width of [200, 100, 60, 44, 30, 16, 10]) assert.ok(plain(live.listLines(width, 30, 200)).filter((l) => /^ [◐○] /.test(l)).every((l) => l.length <= width), `every row fits ${width}`);
  // The tags give way together, by the widest of them: mark (3), `b:HSWXY-1400` (12, with its machine), a cell.
  const least = 3 + 12 + 1 + NAME_LEFT; assert.match(plain(live.listLines(least, 30, 200)).join("\n"), /#3/); assert.doesNotMatch(plain(live.listLines(least - 1, 30, 200)).join("\n"), /#\d|HSWXY-/);
});

// One board for the three tests below, in this order: each leaves no key behind for the next.
let w;
test.before(async () => { w = await world(); });
test.after(() => w.cleanup());

test("the key names the task wherever an id does, in any letter case; the id stays its real name, and a changed key breaks nothing", async () => {
  A.add(w.root, "First"); A.add(w.root, "Second");
  assert.throws(() => S.find("hsw-2"), /No task hsw-2/); // no key yet
  S.setValue("repo.key", "HSW", { repo: "proj" });
  for (const ref of ["HSW-2", "hsw-2", "Hsw-2", " hsw-2 ", "proj/2", "2", "#2"]) assert.equal(S.find(ref).id, "proj/2", ref);
  assert.throws(() => S.find("hsw-9"), /No task hsw-9/); assert.throws(() => S.find("zzz-2"), /No task zzz-2/);
  assert.equal(S.idOfKey("hsw-002"), "proj/2"); assert.equal(S.tagOf("proj/2"), "HSW-2"); assert.equal(S.sayId("proj/2"), "HSW-2"); assert.equal(S.tagOf("other/7"), "#7"); assert.equal(S.sayId("other/7"), "other/7");
  // The commands: each takes the key where it takes an id, and its answer names the task by it; --json keeps the id.
  assert.equal(await run("describe", "hsw-2", "New words."), "HSW-2: updated (description)\n"); assert.equal(S.get("proj/2").description, "New words.");
  assert.equal(await run("set", "review.rounds", "5", "--task", "HSW-2"), "review.rounds for HSW-2: 5  (this task)\n");
  assert.match(await run("show", "hsw-2"), /^HSW-2: every setting/); assert.equal(JSON.parse(await run("describe", "hsw-2", "New words.", "--json")).id, "proj/2"); assert.match(await run("show", "hsw-2"), /\n[ ▌] {1}repo\.key +HSW +your entry for proj\n/);
  assert.equal(await run("report", "Hsw-1", "--state", "working", "--msg", "On it"), "HSW-1: updated (working)\n");
  assert.equal(await run("archive", "hsw-1"), "HSW-1: archived\n"); assert.equal(await run("restore", "HSW-1"), "HSW-1: restored\n");
  assert.equal(A.pin("hsw-2").pinned, true); assert.equal(A.rename("HSW-2", "Second, renamed").title, "Second, renamed");
  // `list --query` finds a task by its number and its tag.
  for (const q of ["hsw-2", "HSW-2", "#2"]) assert.match(await run("list", "--query", q), /^HSW-2 [^\n]*Second, renamed\n$/, q);
  // What a task's agent is told names both, a message says the short name, and a path is left alone.
  assert.match(rules(S.get("proj/1")), /^Rules for this task \(its id on the work board is proj\/1; the human also calls it HSW-1, and every command takes that name too\):/);
  assert.equal(A.add(w.root, "Third").id, "proj/3"); assert.equal(S.sayIds("proj/3: added"), "HSW-3: added");
  assert.equal(S.sayIds("Kept: /data/tasks/proj/3/note.md, proj/3x and other/3. See proj/3."), "Kept: /data/tasks/proj/3/note.md, proj/3x and other/3. See HSW-3."); assert.equal(S.taskRef("proj/3"), "HSW-3 (proj/3)"); assert.equal(S.taskRef("other/3"), "other/3");
  // Nothing is stored under the key: changed, the new one works, the old one is no longer understood, the id always is.
  S.setValue("repo.key", "NEW", { repo: "proj" });
  assert.equal(S.find("new-2").id, "proj/2"); assert.throws(() => S.find("hsw-2"), /No task hsw-2/); assert.equal(S.find("proj/2").title, "Second, renamed");
  S.unsetValue("repo.key", { repo: "proj" }); assert.throws(() => S.find("new-2"), /No task/); assert.equal(S.find("proj/2").id, "proj/2"); assert.equal(S.get("proj/2").settings["repo.key"], undefined);
});

test("on the board: a keyed repo's rows read HSW-134, the panel, the chat and the messages say so, and find goes to a task by its number or its tag", async () => {
  S.writeJson(path.join(S.tasksDir(), "proj", "seq"), 8); const nine = A.add(w.root, "Number nine").id;
  S.writeJson(path.join(S.tasksDir(), "proj", "seq"), 133); const big = A.add(w.root, "Number one three four").id; const next = A.add(w.root, "Its neighbour").id;
  assert.deepEqual([nine, big, next], ["proj/9", "proj/134", "proj/135"]);
  const s = open(w, { side: false }), row = (title, width = 100) => s.screen(width).find((l) => l.includes(title) && /^[ ▌]\S /.test(l));
  assert.match(row("Number nine"), /^[ ▌]○ #9 {3}Number nine +\ds ago$/); assert.match(row("Number one three four"), /^[ ▌]○ #134 Number one three four +\ds ago$/);
  // Find: the number, `#` and the number, or the tag; exactly one task's, the selection goes to it.
  for (const typed of ["134", "#134"]) {
    s.v.sel = nine; s.press("ctrl+f"); s.type(typed);
    assert.equal(s.v.sel, big, typed); assert.ok(row("Number one three four"), typed); assert.equal(row("Number nine"), undefined, typed);
    s.press("enter"); assert.equal(s.v.sel, big, typed); s.press("esc"); assert.equal(s.v.filter, "", typed);
  }
  s.v.sel = big; s.press("ctrl+f"); s.type("13"); assert.ok(row("Number one three four") && row("Its neighbour")); s.type("5"); assert.equal(s.v.sel, next); s.press("esc", "esc");
  // With a key: the tag on the rows, the panel's title, the heading of the details page. The id itself stands once,
  // on the whole task, with the session: where a command needs it.
  S.setValue("repo.key", "hsw", { repo: "proj" }); s.v.sel = big; s.v.load();
  assert.match(row("Number nine"), /^[ ▌]○ HSW-9 {3}Number nine +\ds ago$/); assert.match(row("Number one three four"), /^[ ▌]○ HSW-134 Number one three four +\ds ago$/);
  s.v.side = true; let text = s.text(140);
  assert.match(text, /│ {2}HSW-134 Number one three four/); assert.doesNotMatch(text, /proj\/134/);
  s.v.side = false; s.press("alt+t"); assert.match(s.text(100), /^ Task details {2}HSW-134 "Number one three four"/); s.v.panelTop = 1e9; assert.match(s.text(100), /\n Task id {6}proj\/134 *\n/); s.v.panelTop = 0; assert.match(s.text(100), /\n HSW-134 Number one three four *\n/); s.press("esc");
  // The chat's line names the task with its tag.
  s.press("space"); assert.match(s.text(100), /\n[ ▌]○ HSW-134 Number one three four {2}no agent yet: your message starts one/); s.press("space");
  // Find by the tag, in any letter case; and the board's own messages say the short name.
  s.v.sel = nine; s.press("ctrl+f"); s.type("hsw-134"); assert.equal(s.v.sel, big); assert.equal(row("Number nine"), undefined); s.press("esc", "esc");
  s.v.sel = nine; s.press("ctrl+f"); s.type("HSW-9"); assert.equal(s.v.sel, nine); assert.ok(row("Number nine")); s.press("esc", "esc");
  s.v.sel = big; s.v.load(); s.press("ctrl+a"); assert.match(s.v.msg, /^Archived HSW-134 "Number one three four"\./); s.press("ctrl+z");
  // What another machine is sent: each task with its repo's key, so its rows there read the same.
  assert.equal(remoteList().tasks.find((t) => t.id === big).key, "HSW");
  // Without the key again: the number, and the id in the board's messages.
  S.unsetValue("repo.key", { repo: "proj" }); s.v.sel = big; s.v.load();
  assert.match(row("Number one three four"), /^[ ▌]○ #134 Number one three four/); s.press("ctrl+a"); assert.match(s.v.msg, /^Archived #134 "Number one three four"\./);
  assert.equal(remoteList().tasks.find((t) => t.id === nine).key, undefined);
});

test("a repo's short key: set for the repo or in its own file, kept in capitals, checked, and never one key for two repos", async () => {
  A.add(w.root, "First");
  const other = path.join(w.base, "other"); fs.mkdirSync(other); A.add(other, "Elsewhere");
  assert.deepEqual(S.repoKeys(), {}); assert.equal(S.lookup("repo.key", { repo: "proj" }).value, "none");
  assert.equal(S.setValue("repo.key", "hsw", { repo: "proj" }).value, "HSW"); assert.deepEqual(S.repoKeys(), { proj: "HSW" });
  assert.equal(await run("set", "repo.key", "Ab1", "--repo", "proj"), "repo.key for proj: AB1  (your entry for proj)\n");
  // Checked when set: a bad one is refused with the reason, and changes nothing.
  for (const [bad, why] of [["x", /2 to 5 letters or digits/], ["toolong", /2 to 5 letters or digits/], ["1ab", /the first a letter/], ["a-b", /2 to 5/], ["pr", /already means a pull request/]]) assert.throws(() => S.setValue("repo.key", bad, { repo: "proj" }), why, bad);
  assert.throws(() => S.setValue("repo.key", "HSW"), /one repo's own: it cannot be set for every repo at once\. Set it for the repo: herdr-superwork set repo\.key <value> --repo <name>/);
  assert.throws(() => S.setValue("repo.key", "HSW", { task: S.get("proj/1") }), /one repo's own: it cannot be set on a task/);
  assert.throws(() => S.setValue("repo.key", "HSW", { repo: "nope" }), /No repo "nope" on the board/);
  assert.deepEqual(S.repoKeys(), { proj: "AB1" });
  // Two repos, one key: the second is refused, and told who has it.
  assert.throws(() => S.setValue("repo.key", "ab1", { repo: "other" }), /other|proj already has the key AB1\. Choose another for other\./);
  assert.throws(() => S.setValue("repo.key", "ab1", { repo: "other" }), /proj already has the key AB1/);
  assert.equal(S.setValue("repo.key", "AB1", { repo: "proj" }).value, "AB1"); // its own key again is no clash
  assert.equal(S.setValue("repo.key", "oth", { repo: "other" }).value, "OTH"); assert.deepEqual(S.repoKeys(), { proj: "AB1", other: "OTH" });
  // `show`: with the repo's settings, never among yours.
  assert.match(await run("show", "--repo", "proj"), /\n\* repo\.key +AB1 +your entry for proj\n/); assert.doesNotMatch(await run("show"), /repo\.key/);
  // The repo's own file can carry it: your entry wins, and without one the file's counts.
  fs.writeFileSync(path.join(w.root, ".herdr-superwork.json"), JSON.stringify({ repo: { key: "fil" }, check: { command: "true" } }));
  assert.equal(S.lookup("repo.key", { repo: "proj" }).value, "AB1");
  assert.equal(S.unsetValue("repo.key", { repo: "proj" }).value, "FIL"); assert.equal(S.lookup("repo.key", { repo: "proj" }).from, "the repo's file"); assert.deepEqual(S.repoKeys(), { proj: "FIL", other: "OTH" });
  assert.deepEqual(S.repoFile(w.root).refused, []);
  // A file can still bring a key another repo has. Your entry wins over a file; said twice in files, it counts for neither.
  fs.writeFileSync(path.join(other, ".herdr-superwork.json"), JSON.stringify({ repo: { key: "FIL" } })); S.unsetValue("repo.key", { repo: "other" });
  assert.deepEqual(S.repoKeys(), {}); assert.match(await run("show", "--repo", "proj"), /\n[ ▌] {1}repo\.key +FIL +not used: another repo says the same key\n/);
  assert.throws(() => S.find("fil-1"), /No task fil-1/); // so a key never names tasks of two repos
  assert.throws(() => S.setValue("repo.key", "FIL", { repo: "proj" }), /other already has the key FIL/); // `set` still refuses it
  const config = path.join(process.env.HERDR_SUPERWORK_CONFIG_DIR, "config.json");
  fs.writeFileSync(config, JSON.stringify({ "watcher.agent": "none", "coordinator.agent": "none", repos: { proj: { repo: { key: "FIL" } } } })); // written by hand
  assert.deepEqual(S.repoKeys(), { proj: "FIL" }); assert.equal(S.find("fil-1").id, "proj/1");
  // A mistake made by hand is reported with the setting's name, and that key is not counted.
  fs.writeFileSync(config, JSON.stringify({ "watcher.agent": "none", "coordinator.agent": "none", repo: { key: "TOP" }, repos: { proj: { repo: { key: "way too long" } } } }));
  assert.ok(S.settingProblems().some((p) => /your settings: repo\.key is one repo's own/.test(p))); assert.ok(S.settingProblems().some((p) => /your entry for proj: repo\.key is a short key/.test(p)));
  assert.equal(S.lookup("repo.key", { repo: "proj" }).value, "FIL"); // the next place down: the repo's file
});
