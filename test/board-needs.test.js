// A task that waits for you says what it needs: its mark (? an answer, ! a yes or no, @ a sign-in) and the words
// beside it, on a row, in the task panel, in the chat and on the web board; never the look of one that went wrong.
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { View } from "../src/board/view.js";
import { theme } from "../src/board/theme.js";
import { pieces, webTheme } from "../src/webui/ink.js";
import { show } from "../src/state.js";
import { standing } from "../src/board/view/states.js";
import { osc } from "../src/board/view/osc.js";

const view = (t = theme) => Object.assign(Object.create(View.prototype), { theme: t, scope: "", screens: new Map(), repo: { root: "/nowhere", name: "proj" } });
const base = { id: "proj/1", title: "Plan v1", agent: "claude", app: "claude", at: Date.now() };
const asks = (kind, more = {}) => ({ ...base, state: "blocked", stage: "asks", kind, msg: "What one job must v1 nail?", ...more });
const login = { ...base, state: "blocked", kind: "auth", stage: "failed", msg: "", failure: { auth: true, title: "Needs a login", detail: "Not logged in", next: "Sign in to the agent." } };
const broke = { ...base, state: "error", stage: "nosummary", msg: "Stopped without a summary" };

test("a blocked task's mark says what it needs, on a row, narrow and wide, and is never the mark of one that went wrong", (tc) => {
  tc.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const v = view(), row = (r, width) => stripVTControlCharacters(v.rowLines(r, width, v.rowLayout([r], width, undefined, 200)).join("\n"));
  for (const width of [40, 80, 160]) {
    assert.match(row(asks("question"), width), /^[ ▌]\? #\d+ Plan v1 /, `a question at ${width}`);
    assert.match(row(asks("permission"), width), /^[ ▌]! #\d+ Plan v1 /, `a yes or no at ${width}`);
    assert.match(row(asks("auth"), width), /^[ ▌]@ #\d+ Plan v1 /, `a sign-in at ${width}`);
    assert.match(row(login, width), /^[ ▌]@ #\d+ Plan v1 /, `a login that failed at ${width}`);
    assert.match(row(asks(undefined), width), /^[ ▌]! #\d+ Plan v1 /, `no kind known at ${width}`);
    assert.match(row(broke, width), /^[ ▌]✗ #\d+ Plan v1 /, `gone wrong at ${width}`);
  }
  // Finished work that waits for the one yes that merges it has a mark of its own, in the green of its group: never
  // the "!" of something that asks for your OK, which reads as "something is wrong".
  const ready = { ...base, state: "blocked", kind: "permission", stage: "approval", msg: "Approve to merge?" };
  for (const width of [40, 160]) assert.match(row(ready, width), /^[ ▌]◆ #\d+ Plan v1 /, `a merge to approve at ${width}`);
  if (!process.env.NO_COLOR) { assert.ok(v.mark(ready).startsWith(theme.fg("green", "\0").split("\0")[0])); assert.ok(v.mark(asks("permission")).startsWith(theme.fg("red", "\0").split("\0")[0])); }
  // Every one is a single column, so the names start under each other.
  const marks = [asks("question"), asks("permission"), asks("auth"), asks(undefined)].map((r) => stripVTControlCharacters(v.mark(r)));
  assert.deepEqual(marks, ["?", "!", "@", "!"]); assert.ok(marks.every((m) => !/[×✗✗]/.test(m)));
  // Both wait for you, so both have the needs-you colour: with colour off the mark alone tells them apart.
  const before = process.env.NO_COLOR; process.env.NO_COLOR = "1";
  try { assert.deepEqual([asks("question"), asks("permission"), asks("auth"), broke].map((r) => v.mark(r)), ["?", "!", "@", "✗"]); }
  finally { if (before === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before; }
});

test("the words beside the mark agree with the kind: the State line, the headline under it and the chat", (tc) => {
  tc.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const v = view(), page = (r) => stripVTControlCharacters(v.panel({ owner: "me", ...r }, 80, false).join("\n"));
  assert.match(page(asks("question")), /\n State {8}\? asks you · 0s ago\n/); assert.match(page(asks("question")), /\n Asks you ─+\n What one job must v1 nail\?/);
  assert.match(page(asks("permission")), /\n State {8}! asks for your OK · 0s ago\n/); assert.match(page(asks("permission")), /\n Asks for your OK ─+\n/);
  assert.match(page(asks("auth")), /\n State {8}@ needs a login · 0s ago\n/); assert.match(page(asks("auth")), /\n Needs a login ─+\n/);
  assert.match(page(asks(undefined)), /\n State {8}! needs you · 0s ago\n/); assert.match(page(asks(undefined)), /\n Needs you ─+\n/);
  // A login that failed is something to sign in to, not something that went wrong.
  assert.match(page(login), /\n State {8}@ needs a login · 0s ago\n/); assert.match(page(login), /\n Needs a login ─+\n/); assert.doesNotMatch(page(login), /Went wrong/);
  assert.match(page(broke), /\n State {8}✗ needs you · 0s ago\n/);
  // What went wrong outranks the kind, and work that waits for the one yes is "ready to approve".
  assert.equal(standing(asks("question", { failure: { title: "Merge conflict with main" } })), "needs you");
  assert.equal(standing({ ...base, state: "blocked", kind: "permission", stage: "approval" }), "ready to approve");
  assert.equal(standing({ ...base, state: "working", stage: "working" }), "working");
});

test("the kind comes from where the task stands, and the web board and the terminal's records carry it too", () => {
  const kind = (t, live) => { const s = show({ id: "proj/1", app: "claude", owner: "me", ...t }, live); return [s.state, s.kind]; };
  assert.deepEqual(kind({ stage: "asks" }), ["blocked", "question"]); assert.deepEqual(kind({ stage: "asks", kind: "auth" }), ["blocked", "auth"]);
  assert.deepEqual(kind({ stage: "approval" }), ["blocked", "permission"]); assert.deepEqual(kind({ stage: "failed", failure: { auth: true } }), ["blocked", "auth"]);
  assert.deepEqual(kind({ stage: "failed", failure: {} }), ["error", undefined]); assert.deepEqual(kind({ stage: "working" }, { status: "blocked" }), ["blocked", undefined]);
  // The web board draws the same marks, in the same colour name.
  const wv = view(webTheme), at = (r) => pieces(wv.mark(r))[0];
  assert.deepEqual([asks("question"), asks("permission"), asks("auth"), asks(undefined), broke].map((r) => at(r).t), ["?", "!", "@", "!", "✗"]);
  assert.ok([asks("question"), asks("auth"), broke].every((r) => at(r).c === "red"));
  // A record for the terminal (OSC 7501) has no mark: it names the state and the kind, and the terminal draws its own.
  assert.match(osc(asks("question")), /^\x1b\]7501;state=blocked:id=proj\/1:kind=question:/); assert.doesNotMatch(osc(broke), /kind=/);
});

// A task a limit stopped (limits/reached.js) waits for you: its row says the plain line, its panel what it used and
// the ways on, the hint line the two keys. While it runs, the panel says what is used and the row says it from near
// the limit on. (What stops it, and what carries on: test/limits.test.js.)
test("a task a limit stopped, and one near its limit: the row, the panel and the hints say so", () => {
  const v = view(), page = (r, full = true) => stripVTControlCharacters(v.panel({ owner: "me", ...r }, 110, full).join("\n")), flat = (r) => page(r).replace(/\s+/g, " ");
  const stopped = (limitStop, msg) => ({ ...base, ...show({ ...base, stage: "stopped", msg, limitStop }), stage: "stopped", raw: msg, limitStop, link: { pane: "p1" } });
  const time = stopped({ what: "time", limit: "2h", role: "agent", used: 8400000, at: 1 }, "stopped at its 2h limit");
  assert.deepEqual([time.state, time.msg, standing(time)], ["blocked", "stopped at its 2h limit", "needs you"]);
  assert.match(page(time), /\n Stopped at a limit ─+\n It stopped at its 2h limit, after 2h20m\. Its work is kept as it is and nothing was merged\.\n/); assert.match(page(time), /herdr-superwork set limit\.time <value> --task proj\/1/);
  assert.match(page(time).replace(/\s+/g, " "), /carries on, and so does a reply to the agent\. \S+ takes the work as it is, through the check and the review\./);
  assert.match(stripVTControlCharacters(v.sentence({ ...time, msg: time.msg }).text), /^stopped at its 2h limit$/);
  // a stopped review, findings that were kept, and work that was ready: each says what carrying on does
  assert.match(flat(stopped({ what: "time", limit: "30m", role: "reviewer", used: 1860000, at: 1 }, "stopped at its 30m limit")), /The reviewer stopped at its 30m limit, after 31m\.[\s\S]*carries on: it is reviewed again/);
  assert.match(flat(stopped({ what: "tokens", limit: "350k", role: "reviewer", review: true, used: 360000, at: 1 }, "stopped at 350k tokens")), /It stopped at 350k tokens, with 360k tokens used\.[\s\S]*carries on: the review goes to the agent/);
  assert.match(flat(stopped({ what: "tokens", limit: "5m", role: "reviewer", ready: true, used: 5200000, at: 1 }, "stopped at 5m tokens")), /It stopped at 5m tokens, with 5\.2m tokens used\.[\s\S]*carries on: its work was finished and reviewed, and is put up for approval/);
  // while it runs: what is used against each limit, and the row's words from near it on
  const near = { ...base, state: "working", stage: "working", msg: "Running the tests", limits: { time: { limit: "2h", used: 6000000 }, tokens: { limit: "500k", used: 410000, kind: "claude" }, near: "1h40m of its 2h · 410k of 500k tokens" } };
  assert.match(page(near), /\n Time {9}1h40m of 2h, this run\n Tokens {7}410k of 500k\n/);
  assert.match(stripVTControlCharacters(v.sentence(near).text), /^1h40m of its 2h · 410k of 500k tokens · Running the tests$/);
  assert.match(page({ ...near, limits: { tokens: { limit: "500k", used: 0, kind: "a-program-with-no-counter" } } }), /\n Tokens {7}not counted for this program · limit 500k\n/);
});
