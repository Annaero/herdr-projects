// Who the Coordinator is: the agent kind, model and effort chosen for it, and whether it can run here.
import * as S from "../store.js";
import { currentSocket, socketExists } from "../herdr.js";
import { installed, roleOf, effortFor } from "../agents.js";
import { get } from "./state.js";

// ---- who it is ---------------------------------------------------------------------------------------------------------
// The default: the five `coordinator.` settings, yours only; out of the box it is Claude Code on its own model and
// effort, whatever the working agent is set to. `coordinator.agent: none`: no Coordinator.
export function choice() {
  const who = roleOf("coordinator", (n) => S.setting(n));
  return who.kind ? { kind: who.kind, model: who.model, effort: effortFor(who.kind, who.effort), ...extra(who) } : null;
}
// Fast mode and asking first are part of who it is only where they are not the usual.
const extra = (who) => ({ ...(who.fast === true ? { fast: true } : {}), ...(who.access && who.access !== "full" ? { access: who.access } : {}) });
export const OFF_WORDS = "The Coordinator is off. `herdr-superwork unset coordinator.agent` turns it on.";
// A choice for one Coordinator only ("new, on codex"): what is named wins, and a model or effort set for another
// program is not passed on to it.
export function pickOf({ agent, effort } = {}) {
  const base = choice() || { kind: S.agentOf(S.entryOf("coordinator.agent").builtin).kind, model: "", effort: "" };
  if (!agent && !effort) return null;
  const named = agent ? S.agentOf(S.check("coordinator.agent", agent)) : null;
  if (named && !named.kind) throw new Error("A Coordinator for one use needs a program: claude, codex or pi.");
  const kind = named ? named.kind : base.kind, same = kind === base.kind;
  const level = effort ? S.check("coordinator.effort", effort, { agent: kind }) : same ? base.effort : "";
  return { kind, model: named?.model || (same && !named ? base.model : ""), effort: effortFor(kind, level), ...extra(base) };
}
export const describe = (k) => (k ? `${k.kind} · ${k.model || "default model"} · ${k.effort || "default effort"}` : "off");
export const sameChoice = (a, b) => !!a && !!b && a.kind === b.kind && (a.model || "") === (b.model || "") && (a.effort || "") === (b.effort || "") && !!a.fast === !!b.fast && (a.access || "full") === (b.access || "full");
// Can the box talk to a Coordinator here? It needs a running herdr to live in, and its program installed.
export function ready(socket = currentSocket()) {
  const k = choice();
  if (!k || !socketExists(socket)) return false;
  return !!get(socket)?.run || installed(k.kind); // one that is already there (a one-off, say) answers whatever the default is
}
