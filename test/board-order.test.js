// The order of the list: what waits for you, then what is being worked on, then to do, and done last.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import { GROUPS } from "../src/board/view/states.js";
import { open } from "./board-helpers.js";

test("done comes last: below to do under each heading of the status view and inside each repo, with its fold line at the bottom", async () => {
  const w = await world({ settings: { helper: "off" } });
  try {
    assert.deepEqual(GROUPS, ["needs you", "ready to approve", "working", "to do", "done"]);
    const now = Date.now(), add = (title) => A.add(w.root, title).id;
    const older = add("older to do");
    const done = Array.from({ length: 7 }, (_, n) => add(`done ${n}`));
    done.forEach((id, n) => { S.update(id, { stage: "done" }); S.update(id, { at: now - (n + 1) * 60000 }); });
    const working = add("at work"); A.report(working, { state: "working", msg: "half way" });
    const asks = add("asks you"); A.report(asks, { state: "blocked", msg: "which one?" });
    const newer = add("newer to do");
    const s = open(w);
    const shape = () => s.v.rows.map((r) => r.header ?? r.note ?? r.rec.id);
    const more = "… 2 more (? shows all done)";
    // By status: the sections in the order they need you, done under to do, and the fold line the last line of all.
    const byStatus = ["needs you", asks, "working", working, "to do", newer, older, "done", ...done.slice(0, 5), more];
    assert.deepEqual(shape(), byStatus);
    const lines = s.screen(120).map((l) => l.split("│")[0]), at = (re) => lines.findIndex((l) => re.test(l));
    assert.ok(at(/^ to do/) > at(/^ working/) && at(/^ done/) > at(/older to do/) && at(/2 more \(\? shows all done\)/) > at(/done 4/), lines.join("\n"));
    // The arrow keys follow the order shown: from the last to-do down into done, and no further than the last done row.
    s.v.sel = older; s.v.load();
    s.press("down"); assert.equal(s.v.sel, done[0]);
    s.press("up", "up", "up"); assert.equal(s.v.sel, working);
    for (let n = 0; n < 12; n++) s.press("down");
    assert.equal(s.v.sel, done[4]);
    // By repo: the same order inside the repo, and the selected task stays selected when the grouping changes.
    s.press("alt+s"); assert.equal(s.v.byRepo, true); assert.equal(s.v.sel, done[4]);
    assert.deepEqual(shape(), ["proj", asks, working, newer, older, ...done.slice(0, 5), more]);
    s.press("up", "up", "up", "up", "up"); assert.equal(s.v.sel, older);
    s.press("alt+s"); assert.equal(s.v.sel, older); assert.deepEqual(shape(), byStatus);
    // A pinned task keeps its place on top, and showing all done takes the fold line away without moving anything up.
    A.pin(done[6]); s.press("alt+d"); s.v.load();
    assert.deepEqual(shape(), ["pinned", done[6], "needs you", asks, "working", working, "to do", newer, older, "done", ...done.slice(0, 6)]);
    // A task that finishes leaves to do for the top of done, below every to-do; the selection does not follow it down.
    s.v.sel = newer; s.v.load(); S.update(newer, { stage: "done" }); S.update(newer, { at: now }); s.v.load();
    assert.deepEqual(shape().slice(6), ["to do", older, "done", newer, ...done.slice(0, 6)]); assert.equal(s.v.sel, older);
  } finally { w.cleanup(); }
});
