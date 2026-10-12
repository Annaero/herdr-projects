// Who the Coordinator is: the agent kind, model and effort chosen for it, and whether it can run here.
import * as S from "../store.js";
import { currentSocket, socketExists } from "../herdr.js";
import { installed } from "../agents.js";
import { get } from "./state.js";

// ---- who it is ---------------------------------------------------------------------------------------------------------
// The default: `coordinator`, `coordinatorModel`, `coordinatorEffort`, set as the agent's own are; out of the box it
// is Claude Code on its default model and effort, whatever the working agent is set to. Any `herdr agent start --kind`
// value works. "off": no Coordinator.
export function choice() {
  const c = S.config();
  if (c.coordinator === "off") return null;
  return { kind: c.coordinator || S.DEFAULTS.coordinator, model: c.coordinatorModel, effort: c.coordinatorEffort };
}
// A choice for one Coordinator only ("new, on codex"): what is named wins, and a model or effort set for another
// program is not passed on to it.
export function pickOf({ agent, model, effort } = {}) {
  const base = choice() || { kind: S.DEFAULTS.coordinator, model: "", effort: "" };
  const kind = String(agent || "").trim().toLowerCase() || base.kind;
  if (!/^[a-z][a-z0-9_-]*$/.test(kind)) throw new Error("The Coordinator's agent must be an agent kind such as claude or codex.");
  if (!agent && !model && !effort) return null;
  const same = kind === base.kind;
  return { kind, model: String(model || "").trim() || (same ? base.model : ""), effort: String(effort || "").trim() || (same ? base.effort : "") };
}
export const describe = (k) => (k ? `${k.kind} · ${k.model || "default model"} · ${k.effort || "default effort"}` : "off");
export const sameChoice = (a, b) => !!a && !!b && a.kind === b.kind && (a.model || "") === (b.model || "") && (a.effort || "") === (b.effort || "");
// Can the box talk to a Coordinator here? It needs a running herdr to live in, and its program installed.
export function ready(socket = currentSocket()) {
  const k = choice();
  if (!k || !socketExists(socket)) return false;
  return !!get(socket)?.run || installed(k.kind); // one that is already there (a one-off, say) answers whatever the default is
}
