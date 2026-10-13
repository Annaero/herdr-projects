// Every fixture row and its panel, drawn at the widths from 20 to 200: nothing runs over the width it was given, and
// what says which task it is never vanishes. Reviewers kept finding an overflow or a vanished column by hand at one
// odd width; this draws them all (test/board-fixtures.js holds the rows: a new state is one new row there).
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { world } from "./helpers.js";
import { open } from "./board-helpers.js";
import { fixtureRows } from "./board-fixtures.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";

const WIDTHS = Array.from({ length: 181 }, (_, n) => 20 + n);
const text = (l) => stripVTControlCharacters(l).replace(/\x1b_pi:c\x07/g, "");

test("every fixture row at every width from 20 to 200: no line runs over, and its mark and the start of its name are always there", async () => {
  const w = await world();
  try {
    const s = open(w), rows = fixtureRows(S.get(A.add(w.root, "Max length for task titles").id));
    const all = Object.values(rows);
    for (const width of WIDTHS) {
      const layout = s.v.rowLayout(all, width, undefined, width);
      for (const [name, r] of Object.entries(rows)) {
        const at = `${name}, ${width} columns`, lines = s.v.rowLines(r, width, layout).map(text);
        assert.ok(lines.length >= 1 && lines.length <= 12, `${at}: ${lines.length} lines`);
        for (const l of lines) assert.ok(visibleWidth(l) <= width, `${at}: a line is ${visibleWidth(l)} wide: ${JSON.stringify(l)}`);
        // What says which task this is: its mark, and its name from the first letter on (cut, never dropped).
        assert.match(lines[0], /^[ ▌]\S/, `${at}: the mark`);
        assert.ok(lines[0].includes([...r.title].slice(0, 3).join("")), `${at}: the start of its name is gone: ${JSON.stringify(lines[0])}`);
      }
    }
  } finally { w.cleanup(); }
});

// The panel costs twenty times a row to draw, so not every width twice: beside the list it is never wider than half
// a wide screen (every width from 20 to 60, every second to 100), and full screen every width to 100, then every
// fifth to 200. The narrow widths are where a layout breaks; past 100 only the rules grow.
const BESIDE = WIDTHS.filter((n) => n <= 60 || (n <= 100 && n % 2 === 0)), FULL = WIDTHS.filter((n) => n <= 100 || n % 5 === 0);
test("every fixture row's panel at widths from 20 to 200, beside the list and full screen: no line runs over, and its state is always said", async () => {
  const w = await world();
  try {
    const s = open(w), rows = fixtureRows(S.get(A.add(w.root, "Max length for task titles").id));
    for (const [name, r] of Object.entries(rows)) for (const full of [false, true]) for (const width of full ? FULL : BESIDE) {
      const at = `${name}, ${width} columns${full ? ", full screen" : ""}`, lines = s.v.panel(r, width, full).map(text);
      for (const l of lines) assert.ok(visibleWidth(l) <= width, `${at}: a line is ${visibleWidth(l)} wide: ${JSON.stringify(l)}`);
      assert.ok(lines.some((l) => /^ State\b/.test(l)), `${at}: the State line is gone`);
      assert.ok(lines.length >= 3, `${at}: the panel is empty`);
    }
  } finally { w.cleanup(); }
});
