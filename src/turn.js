// The agent's own turn-end report. `turn-ended` is run by the hook the plugin passes at launch (agents.js), inside the
// agent's own turn: it only records the event and starts the finish runner, exits 0, prints nothing, and never waits
// more than two seconds. Every judgement is made by the finish runner (finish.js).
import fs from "node:fs";
import path from "node:path";
import * as S from "./store.js";
import { spawnRunner } from "./runner.js";
import { adapter, readTurnOf, versionOf } from "./agents.js";

const log = (msg) => { try { fs.appendFileSync(path.join(S.dataDir(), "hook.log"), `${new Date().toISOString()} turn-ended: ${msg}\n`); } catch {} };
// The hook's input: Claude and pi send JSON on stdin, Codex appends it as the last argument.
function input(extra) {
  for (const a of extra) { if (a && a[0] === "{") { try { return JSON.parse(a); } catch {} } }
  if (process.stdin.isTTY) return {};
  try { return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch { return {}; }
}
export function turnEnded({ id, role = "agent", token, round = 0 }, extra = []) {
  try {
    const t = id && S.get(id);
    if (!t) return void log(`no task ${id}`);
    round = Number(round) || 0;
    if (!["agent", "reviewer"].includes(role) || !S.tokenOk(t.id, role, token, round)) return void log(`refused for ${id} (${role}): wrong token`);
    const j = input(extra);
    // Codex also reports turns of side conversations (it names its chats with one): `hint` says whether this
    // report's prompt named this task, for the runner to judge.
    const said = JSON.stringify(j["input-messages"] || "");
    const ev = { at: Date.now(), role, round, session: String(j.session_id || j["thread-id"] || ""), file: String(j.transcript_path || ""), error: String(j.error || ""), side: !!j["thread-id"] && !said.includes(`task ${t.id}`) };
    let start = false;
    S.update(t.id, (t) => {
      t.eventSeq = (t.eventSeq || 0) + 1;
      t.events = [...S.pendingEvents(t), { ...ev, n: t.eventSeq }];
      start = !S.markerAlive(t.runner);
    }, { waitMs: 2000 });
    if (start) spawnRunner("finish", t.id);
  } catch (e) { log(e.code === "BUSY" ? `gave up on ${id}: the task was busy` : String(e.stack || e)); }
}

// ---- why did this pane stop ------------------------------------------------------------------------------------------
// The one seam for "when and why": fed today by the hook's event and the saved conversation. When herdr exposes program
// status (OSC 7501), prefer herdr's value for `when` and `why` here and keep the file for the message and token use.
export function whyStopped(t, role = "agent", event = null) {
  const kind = role === "reviewer" ? t.link?.reviewer?.kind : t.agent;
  const session = role === "reviewer" ? t.reviewSession : event?.session || t.session;
  const turn = readTurnOf(kind, { file: event?.file || (role === "agent" ? t.transcript : null), session, cwd: S.cwdOf(t) });
  return { when: event?.at || turn?.pos || null, why: turn?.error ? "error" : turn?.interrupted ? "interrupted" : turn?.finished ? turn.stop || "stop" : event ? "stop" : "", turn, hooked: !!event, kind, version: versionOf(kind), canRead: !!adapter(kind).readTurn };
}
