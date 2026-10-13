// The web Board knows everything the terminal board shows: every work setting, every status mark and every colour
// name. Reviewers kept finding these by hand, one at a time (a setting with no row on the page, a colour the page
// gives no colour, a state with no mark); this walks the board's own lists, so a new entry in one of them is checked
// the day it is added.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world } from "./helpers.js";
import * as A from "../src/actions.js";
import * as S from "../src/store.js";
import { rows as allRows } from "../src/store/settings/show.js";
import { SETTINGS } from "../src/store/settings-list.js";
import { theme, MARK_STATES, NEED_KINDS } from "../src/board/theme.js";
import { GROUP_COLOR } from "../src/board/view/states.js";
import { WebView } from "../src/webui/web-view.js";
import { settingsOf } from "../src/webui/settings-model.js";
import { webTheme, pieces } from "../src/webui/ink.js";
import { snapshot } from "../src/webui/worker.js";

const root = path.resolve(import.meta.dirname, "..");
const css = fs.readFileSync(path.join(root, "src/webui/page/board.css"), "utf8");
const filesUnder = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));

test("every colour name the board paints with has a colour on the web page", () => {
  // The names the drawing code asks the theme for, wherever it does: fg("name", …), and the colours of the groups
  // and of a row's status. The page gives a name its colour by the class `sw-c-<name>`.
  const named = new Set([...Object.values(GROUP_COLOR), "review", "check", "overlay0", "subtext0"]);
  for (const f of [...filesUnder("src/board"), ...filesUnder("src/webui").filter((f) => !f.includes("/page/"))]) for (const [, name] of fs.readFileSync(path.join(root, f), "utf8").matchAll(/\.fg\("([a-z0-9_]+)"/g)) named.add(name);
  assert.ok(named.size >= 12, [...named].join(" "));
  for (const name of named) {
    assert.match(css, new RegExp(`\\.sw-c-${name}(?![a-z0-9_-])[^{}]*\\{[^}]*color:`), `the web page has no colour for "${name}" (src/webui/page/board.css: .sw-c-${name})`);
    assert.deepEqual(pieces(webTheme.fg(name, "x")), [{ t: "x", c: name }]); // and the name reaches the page as it is
    assert.notEqual(theme.fg(name, "x"), "", name);
  }
});

test("every state and every need has a mark on the web board, the terminal board's own", () => {
  for (const state of MARK_STATES) {
    const mark = webTheme.mark(state);
    assert.equal(typeof mark, "string"); assert.equal([...mark].length, 1, state);
    if (state !== "unknown") assert.notEqual(mark, webTheme.mark("unknown"), `the web board has no mark for "${state}"`);
    assert.ok(theme.mark(state), state);
  }
  for (const kind of NEED_KINDS) { assert.equal(webTheme.mark("blocked", kind), theme.mark("blocked", kind), kind); assert.notEqual(webTheme.mark("blocked", kind), webTheme.mark("unknown")); }
  assert.equal(new Set(MARK_STATES.map((s) => webTheme.mark(s))).size, MARK_STATES.length, "one mark each"); // the page tells every state apart without colour
});

test("every work setting has a row on the web board's settings page, with words a person can read and a way to change it", async () => {
  const w = await world();
  try {
    const id = A.add(w.root, "A task").id;
    const v = new WebView({ cwd: w.root });
    const row = v.items.find((r) => r.id === id);
    const page = settingsOf(v, row), byName = new Map(page.rows.map((r) => [r.name, r]));
    const work = SETTINGS.filter((s) => s.kind === "work");
    const why = new Map(allRows({ task: S.get(id) }).map((r) => [r.name, r.note])); let left = 0;
    assert.ok(work.length >= 20);
    for (const s of work) {
      const r = byName.get(s.name);
      // Left out only where the terminal board leaves it out too: it cannot apply to this task, and the row says why.
      if (!r) { assert.ok(s.name.endsWith(".fast") || /^does (nothing|not apply)/.test(why.get(s.name) || ""), `the web board's settings page has no row for "${s.name}"`); left += 1; continue; }
      assert.ok(r.label && r.label !== s.name, `${s.name}: no plain label (\`label\` in src/store/settings-list.js)`);
      assert.ok(typeof r.value === "string" && r.value.length, `${s.name}: no value shown`); assert.ok(r.from, `${s.name}: no place it comes from`);
      assert.ok(r.words ? r.words.length >= 2 && r.words.some((x) => x.now) : r.hint.length > 0, `${s.name}: neither words to pick from nor a hint of what to type`);
    }
    assert.equal(page.canSet, true); assert.ok(left <= 3, `${left} settings have no row`);
    // and the list the page draws has the terminal board's headings, each with a colour the page knows
    const groups = snapshot(v).list.groups;
    for (const g of groups) { assert.ok(Object.keys(GROUP_COLOR).includes(g.name), g.name); assert.match(css, new RegExp(`\\.sw-c-${g.color}(?![a-z0-9_-])`)); }
  } finally { w.cleanup(); }
});
