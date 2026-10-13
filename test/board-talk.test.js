// What a chat shows of a conversation: only its words, whoever said them. The readers for each agent program, the
// reviewer's conversation while a task is under review, and the words that say whose they are.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { world, settle, until } from "./helpers.js";
import * as S from "../src/store.js";
import * as A from "../src/actions.js";
import * as F from "../src/flow.js";
import { remoteList } from "../src/remote.js";
import { talkOf, screenText } from "../src/agents.js";
import { proseLines } from "../src/board/view/chat-text.js";
import { sideOf } from "../src/webui/side-model.js";
import { name as keyName } from "../src/board/keys.js";
import { open, keyed } from "./board-helpers.js";

const jsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); return file; };
const ts = (n) => new Date(Date.UTC(2026, 9, 13, 12, 0, n)).toISOString();
// A Claude Code conversation as the program saves it: a prompt, words, a tool call with its result, more words.
const claudeRows = (prompt, ...said) => [
  { type: "user", timestamp: ts(1), message: { role: "user", content: prompt } },
  ...said.flatMap((text, n) => [
    { type: "assistant", timestamp: ts(2 + n * 3), message: { id: `m${n}`, role: "assistant", content: [{ type: "text", text }] } },
    { type: "assistant", timestamp: ts(3 + n * 3), message: { id: `m${n}`, role: "assistant", content: [{ type: "tool_use", id: `t${n}`, name: "Bash", input: { command: "npm run check -- --all" } }] } },
    { type: "user", timestamp: ts(4 + n * 3), message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${n}`, content: "76 test files passed" }] } },
  ]),
];
// The chat's box as the screen shows it: its top edge and what is inside it (without its frame).
function chat(s, width = 120) {
  const lines = s.screen(width), top = lines.findLastIndex((l) => /^╭─.*╮$/.test(l)), end = lines.findLastIndex((l) => /^╰─+╯$/.test(l));
  return { edge: lines[top], who: lines[top - 1].trimEnd(), box: lines.slice(top + 1, end).map((l) => l.slice(2, -2).trimEnd()) };
}

test("a saved conversation is read as its words alone: what was sent and what was said, for Claude Code, Codex and pi", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-talk-"));
  try {
    const words = (kind, file) => talkOf(kind, { file }).map((m) => `${m.who}: ${m.text}`);
    // Claude Code: no tool call, no tool's result, nothing the program wrote itself; an answer in pieces is one.
    const claude = jsonl(path.join(dir, "claude.jsonl"), [
      ...claudeRows("Fix the greeting", "I will read the file first."),
      { type: "user", isMeta: true, timestamp: ts(20), message: { role: "user", content: "[Image: original 2560x1600]" } },
      // What the program filed itself: it names another origin than the human, or lacks the mark every submitted prompt of its version has.
      { type: "user", timestamp: ts(21), version: "2.2.0", promptId: "p1", message: { role: "user", content: "<local-command-stdout>ok</local-command-stdout>" } },
      { type: "user", timestamp: ts(21), version: "2.2.0", promptId: "p2", promptSource: "queue", origin: { kind: "task-notification" }, message: { role: "user", content: "<task-notification>a helper finished</task-notification>" } },
      // The human's own, kept whatever else is missing: all in a tag, filed as the human's with no prompt id, marked as submitted with no origin.
      { type: "user", timestamp: ts(21), version: "2.2.0", promptId: "p3", promptSource: "typed", origin: { kind: "human" }, message: { role: "user", content: "<question>Is it done?</question>" } },
      { type: "user", timestamp: ts(21), version: "2.2.0", origin: { kind: "human" }, message: { role: "user", content: "and the tests?" } },
      { type: "user", timestamp: ts(21), version: "2.2.0", promptSource: "typed", message: { role: "user", content: "<note>no origin named</note>" } },
      { type: "assistant", isSidechain: true, timestamp: ts(22), message: { id: "side", role: "assistant", content: [{ type: "text", text: "a helper's words" }] } },
      { type: "assistant", timestamp: ts(23), message: { id: "m9", role: "assistant", content: [{ type: "thinking", thinking: "hm" }] } },
      { type: "assistant", timestamp: ts(24), message: { id: "m9", role: "assistant", content: [{ type: "text", text: "Fixed." }] } },
      { type: "assistant", timestamp: ts(25), message: { id: "m9", role: "assistant", content: [{ type: "text", text: "It says hello now." }] } },
    ]);
    assert.deepEqual(words("claude", claude), ["you: Fix the greeting", "them: I will read the file first.", "you: <question>Is it done?</question>", "you: and the tests?", "you: <note>no origin named</note>", "them: Fixed.\n\nIt says hello now."]); // the first prompt is from a version that marks none: kept
    // A file in which nothing is marked as submitted, prompt ids or not: every entry with words of its own is a prompt, a tagged one too.
    const plain = jsonl(path.join(dir, "plain.jsonl"), [...claudeRows("<question>Ready?</question>", "Ready to review."), { type: "user", timestamp: ts(30), promptId: "p9", message: { role: "user", content: "ordinary words" } }]);
    assert.deepEqual(words("claude", plain), ["you: <question>Ready?</question>", "them: Ready to review.", "you: ordinary words"]);
    // Codex: what was typed is its own event; the repo's instructions among the model's input are no one's words.
    const item = (type, text, extra = {}) => ({ timestamp: ts(30), type: "event_msg", payload: { type: "item_completed", item: { type, content: [{ type: "text", text }], ...extra } } });
    const codex = jsonl(path.join(dir, "codex.jsonl"), [
      { timestamp: ts(30), type: "event_msg", payload: { type: "task_started" } },
      { timestamp: ts(30), type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "<skills_instructions>" }] } },
      { timestamp: ts(30), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for /repo" }] } },
      { timestamp: ts(30), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Review the change" }] } },
      item("UserMessage", "Review the change"),
      { timestamp: ts(31), type: "response_item", payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "I will run the full check.\n" }] } },
      item("AgentMessage", "I will run the full check.\n"),
      { timestamp: ts(32), type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "npm run check" } },
      { timestamp: ts(33), type: "response_item", payload: { type: "custom_tool_call_output", output: [{ type: "input_text", text: "Script completed" }] } },
      { timestamp: ts(34), type: "response_item", payload: { type: "reasoning", summary: [] } },
      { timestamp: ts(35), type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "All 76 test files pass." }] } },
    ]);
    assert.deepEqual(words("codex", codex), ["you: Review the change", "them: I will run the full check.", "them: All 76 test files pass."]);
    // An older Codex file has no such event: the prompt among the model's input is what there is.
    const older = jsonl(path.join(dir, "older.jsonl"), [{ timestamp: ts(40), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Do it" }] } },
      { timestamp: ts(41), type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] } }]);
    assert.deepEqual(words("codex", older), ["you: Do it", "them: Done."]);
    // pi: a tool's result is a message of its own kind, and a tool call is no text.
    const pi = jsonl(path.join(dir, "pi.jsonl"), [
      { type: "session", id: "s" }, { type: "message", timestamp: ts(50), message: { role: "system", content: "You are pi" } },
      { type: "message", timestamp: ts(51), message: { role: "user", content: [{ type: "text", text: "Say hello" }] } },
      { type: "message", timestamp: ts(52), message: { role: "assistant", content: [{ type: "toolCall", name: "bash" }, { type: "text", text: "hello" }] } },
      { type: "message", timestamp: ts(53), message: { role: "toolResult", content: [{ type: "text", text: "exit 0" }] } },
    ]);
    assert.deepEqual(words("pi", pi), ["you: Say hello", "them: hello"]);
    // A program with no reader, and a file that is not there: nothing, said as nothing.
    assert.equal(talkOf("other", { file: pi }), null); assert.equal(talkOf("claude", { file: path.join(dir, "none.jsonl") }), null);
    // The file is read again when it changed, and only the last few things said are kept.
    fs.appendFileSync(pi, JSON.stringify({ type: "message", timestamp: ts(54), message: { role: "assistant", content: [{ type: "text", text: "anything else?" }] } }) + "\n");
    assert.deepEqual(talkOf("pi", { file: pi, keep: 1 }).map((m) => m.text), ["anything else?"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a screen's words, for a program that cannot be read: what is drawn is left out by its shape, and markdown reads as text in the box", () => {
  const splash = [">_ OpenAI Codex (v0.162.1)", "    ~/work", "", "        ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿", "      ⣿⣿⣿⣿⣿  ⣿⣿⣿⣿⣿", "", "╭──────────────────╮", "│ Which colour?    │", "│ ❯ 1. Blue        │", "╰──────────────────╯", "────────────────────", "▁▂▃▄▅▆▇█ 80%"].join("\n");
  assert.equal(screenText(splash), ">_ OpenAI Codex (v0.162.1)\n    ~/work\n\nWhich colour?\n❯ 1. Blue");
  assert.equal(screenText(""), ""); assert.equal(screenText("⣿⣿⣿⣿\n────"), "");
  // Markdown: bold and headline marks go, a list item's next line stands under its words, code keeps its lines.
  assert.deepEqual(proseLines("## Result\n**Pass.** All of it.\n- a point that is long enough to wrap\n```js\nconst a = 1;\n```\n1. first", 22),
    ["Result", "Pass. All of it.", "- a point that is long", "  enough to wrap", "  const a = 1;", "1. first"]);
});

test("a review under way: the chat, the panel, the web board and another machine show what the reviewer says, never its screen; when it ends, the agent again; a working agent's words, never its tool calls", async () => {
  const w = await world({ settings: { "reviewer.agent": "claude" } });
  process.env.CLAUDE_CONFIG_DIR = path.join(w.base, "claude");
  try {
    const splash = ">_ OpenAI Codex (v0.162.1)\n\n   ⣿⣿⣿⣿⣿⣿⣿⣿\n\n› Ask Codex to do anything\n  ? for shortcuts\n";
    w.script({ worker: [{ files: { "f.txt": "1\n" }, commit: "1", note: "Made f." }], reviewer: [{ status: "working", screen: splash }] });
    const id = A.add(w.root, "Make f").id;
    A.delegate(id);
    const run = settle(id);
    await until(() => { const p = S.get(id).link?.reviewer?.pane; return p && w.state().panes.find((x) => x.pane_id === p)?.agent?.prompts?.length; });
    const t = S.get(id);
    assert.equal(t.stage, "reviewing"); assert.ok(t.reviewSession);
    const s = open(w, { side: false });
    s.v.sel = id; s.v.load(); s.press("space");
    // Nothing said yet: words say so. The program's start screen is never shown, and nothing of the agent's either.
    let c = chat(s);
    assert.deepEqual(c.box, ["The reviewer has just started: nothing to show yet.", "", "❯ Send message to Agent: it stops the review"]);
    assert.doesNotMatch(s.text(), /OpenAI Codex|Ask Codex|for shortcuts|⣿|Made f\./);
    // The reviewer reads, runs and says things: only what it says is in the box, under a line that names it.
    const file = jsonl(path.join(process.env.CLAUDE_CONFIG_DIR, "projects", "x", `${t.reviewSession}.jsonl`), claudeRows("Work board task proj/1, role: reviewer, round 1.\n\nYou are an adversarial reviewer.", "I will check the earlier faults first.", "The full check passes. Now the browser."));
    s.v.load(); c = chat(s);
    assert.deepEqual(c.box, ["Reviewer:", "The full check passes. Now the browser.", "", "❯ Send message to Agent: it stops the review"]);
    assert.match(c.edge, keyed(/{chatScrollUp} more ↑/)); assert.doesNotMatch(s.text(), /Bash|npm run check|76 test files|OpenAI Codex/);
    // alt+u goes back through the conversation's words: what it said before, and what it was sent.
    s.press("alt+u"); c = chat(s);
    assert.deepEqual(c.box.slice(0, -2), ["To the reviewer:", "Work board task proj/1, role: reviewer, round 1.", "You are an adversarial reviewer.", "", "Reviewer:", "I will check the earlier faults first.", "", "Reviewer:", "The full check passes. Now the browser."]);
    s.press("alt+j"); assert.deepEqual(chat(s).box.slice(0, -2), ["Reviewer:", "The full check passes. Now the browser."]); // down again from its end: the newest alone
    // It is kept fresh: the next thing it says is there at the next look.
    fs.appendFileSync(file, JSON.stringify({ type: "assistant", timestamp: ts(40), message: { id: "m7", role: "assistant", content: [{ type: "text", text: "One fault left: the header is cut." }] } }) + "\n");
    s.v.load(); assert.deepEqual(chat(s).box.slice(0, 2), ["Reviewer:", "One fault left: the header is cut."]);
    // The task panel says whose words they are in its headline; the web board and another machine get the same parts.
    s.press("space"); s.v.side = true;
    assert.match(s.text(160), /The reviewer says ─+ *\n[^\n]*One fault left: the header is cut\./); assert.doesNotMatch(s.text(160), /The agent said|On its screen/);
    s.press("space"); s.v.side = false;
    const web = sideOf(s.v).chat;
    assert.deepEqual(web.parts.at(-1), { by: "Reviewer", text: "One fault left: the header is cut.", mine: false, tone: "", raw: false }); assert.equal(web.raw, false);
    assert.equal(sideOf(s.v).send.place, "Send message to Agent: it stops the review");
    const sent = remoteList().tasks.find((x) => x.id === id).snap.talk;
    assert.equal(sent.who, "reviewer"); assert.equal(sent.list.at(-1).text, "One fault left: the header is cut.");
    const far = s.v.talk({ ...s.v.current(), host: "vm-a", link: { pane: "w1:p1" }, snap: { talk: sent } });
    assert.equal(far.who, "reviewer"); assert.deepEqual(far.parts.at(-1), { by: "Reviewer", text: "One fault left: the header is cut." });
    // A machine on an older version sends no conversation: that is said, with what to do.
    assert.match(s.v.talk({ ...s.v.current(), host: "vm-a", snap: {} }).parts.at(-1).text, /vm-a runs an older herdr-superwork/);
    // The reviewer's screen, where it is read at all (a program with no reader), is never an old frame: it is not tied to the agent's turn, which stands still during a review.
    const r = s.v.current();
    assert.match(s.v.screen(r), /OpenAI Codex/);
    w.patchState((st) => { st.panes.find((p) => p.pane_id === t.link.reviewer.pane).agent.screen = "Reading the diff\n"; });
    s.v.screens.get(id).at = 0; assert.equal(s.v.screen(r), "Reading the diff");
    // A dialog on the reviewer's screen is said in words, with the way to it.
    const asks = s.v.talk({ ...r, stage: "reviewneeds", state: "blocked" });
    assert.equal(asks.dialog, true); assert.match(asks.parts.at(-1).text, new RegExp(`The reviewer shows a dialog on its screen that waits for your answer\\. ${keyName("enter")} opens the task's space: the reviewer is in its tab "Reviewer #1"\\.`));
    // The review ends: the chat is the agent's again, and the box says only who gets a message.
    A.stop(id); await run; s.v.load();
    assert.deepEqual(chat(s).box, ["Agent:", "Made f.", "", "❯ Send message to Agent"]);
    // A working agent's chat: its last words, never its tool calls; what it was sent is above them; a dialog is said in words.
    {
      w.script({ worker: [{ status: "working", screen: "● Bash(npm test)\n  ⎿ 3 passed\n✻ Transmuting… (7s · ↓ 625 tokens)\n❯ \n  ⏵⏵ bypass permissions on\n" }] });
      const id = A.add(w.root, "Make f").id;
      A.delegate(id); await settle(id);
      const t = S.get(id);
      assert.equal(t.stage, "working");
      const s = open(w, { side: false });
      s.v.sel = id; s.v.load(); s.press("space");
      assert.deepEqual(chat(s).box.slice(0, -2), ["The agent has just started: nothing to show yet."]);
      jsonl(path.join(process.env.CLAUDE_CONFIG_DIR, "projects", "x", `${t.session}.jsonl`), claudeRows("Work board task proj/2, role: agent.\n\nMake f", "I am writing **f** now:\n- the file\n- its test"));
      s.v.load();
      assert.deepEqual(chat(s).box.slice(0, -2), ["Agent:", "I am writing f now:", "- the file", "- its test"]);
      assert.doesNotMatch(s.text(), /Bash\(|3 passed|Transmuting|bypass permissions|tokens\)/);
      s.press("alt+u"); assert.deepEqual(chat(s).box.slice(0, 2), ["To the agent:", "Work board task proj/2, role: agent."]);
      // A dialog only its screen has: said plainly, with the key that goes there. Not the screen.
      const asks = s.v.talk({ ...s.v.current(), live: { ...s.v.current().live, status: "blocked" } });
      assert.equal(asks.dialog, true); assert.equal(asks.parts.at(-1).text, `The agent shows a dialog on its screen that waits for your answer: ${keyName("enter")} opens it.`);
      assert.equal(asks.parts.at(-2).by, "Agent");
      // A program whose conversation cannot be read: the words on its screen, named as that.
      const other = s.v.talk({ ...s.v.current(), host: "vm-a", snap: { talk: { who: "agent", kind: "other", readable: false, list: [] }, screen: "────────\nReading the code\n⣿⣿⣿⣿" } });
      assert.deepEqual(other.parts, [{ by: "Agent, on its screen now", text: "Reading the code", raw: true }]); assert.equal(other.raw, true);
    }
  } finally { delete process.env.CLAUDE_CONFIG_DIR; w.cleanup(); }
});
