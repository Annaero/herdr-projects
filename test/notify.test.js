// The board.notify setting: a task that needs you, is ready to approve or failed rings the bell on an open board or
// runs your command, once per event; `none`, the built-in value, does neither.
import test from "node:test";
import assert from "node:assert/strict";
import { world, toApproval } from "./helpers.js";
import { open } from "./board-helpers.js";
import * as S from "../src/store.js";
import { housekeeping } from "../src/housekeeping.js";
import { eventOf } from "../src/notify.js";

const pass = () => housekeeping(undefined, { force: true });

test("board.notify: what counts as an event, and `none`, `bell` or a command as its value", async () => {
  const w = await world();
  try {
    assert.equal(S.setting("board.notify"), "none");
    for (const [stage, event] of [["asks", "needs you"], ["reviewneeds", "needs you"], ["failed", "failed"], ["nosummary", "failed"], ["approval", "ready to approve"], ["working", ""], ["todo", ""], ["done", ""], ["merging", ""]]) assert.equal(eventOf({ id: "p/1", stage }), event, stage);
    assert.equal(eventOf({ id: "p/1", stage: "approval", prFailure: { title: "x" } }), "needs you"); assert.equal(eventOf({ id: "p/1", stage: "failed", archivedAt: 1 }), "");
    assert.equal(S.setValue("board.notify", "Bell").value, "bell"); assert.equal(S.setValue("board.notify", "notify-send \"$HERDR_SUPERWORK_TITLE\"").value, "notify-send \"$HERDR_SUPERWORK_TITLE\"");
    assert.equal(S.unsetValue("board.notify").value, "none");
    assert.throws(() => S.setValue("board.notify", "bell", { task: { id: "proj/1" } }), /board\.notify is a board setting: it is yours only/);
  } finally { w.cleanup(); }
});

test("board.notify: a command runs once per event with the task's id, title and what happened; the bell rings once on an open board", async () => {
  const w = await world({ settings: { "review.when": "never", "board.notify": "tell-me" } });
  const ran = [];
  globalThis.__swNotify = (cmd, env) => ran.push([cmd, env]);
  try {
    const id = await toApproval(w, "Ready soon");
    pass(); pass();
    assert.deepEqual(ran, [["tell-me", { HERDR_SUPERWORK_ID: id, HERDR_SUPERWORK_TITLE: "Ready soon", HERDR_SUPERWORK_EVENT: "ready to approve" }]]); // once, however often the board looks
    S.update(id, (t) => { t.stage = "failed"; t.msg = "Check failed"; });
    pass(); pass();
    assert.deepEqual(ran.map(([, e]) => e.HERDR_SUPERWORK_EVENT), ["ready to approve", "failed"]);
    S.update(id, (t) => { t.stage = "working"; }); pass(); assert.equal(S.get(id).notice, null); // nothing to tell: and the next event is new again
    // the bell: an open board rings for what happens while it is open, once, and not for what was already so
    S.setValue("board.notify", "bell");
    S.update(id, (t) => { t.stage = "approval"; }); pass();
    assert.equal(ran.length, 2); // no command while it is `bell`
    let rings = 0;
    const s = open(w, { ctx: { bell: () => { rings += 1; } } });
    s.v.load(); s.v.ring(); s.v.ring(); assert.equal(rings, 0);
    S.update(id, (t) => { t.stage = "asks"; t.kind = "question"; }); pass();
    s.v.load(); s.v.ring(); s.v.ring(); assert.equal(rings, 1);
    S.setValue("board.notify", "none");
    S.update(id, (t) => { t.stage = "failed"; }); pass(); s.v.load(); s.v.ring(); assert.equal(rings, 1); assert.equal(ran.length, 2);
  } finally { delete globalThis.__swNotify; w.cleanup(); }
});
