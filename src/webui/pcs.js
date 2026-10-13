// The web UI's own machines (its "PCs": this one and the ones added in its Settings → Remote PCs) and the board's
// (herdr's saved machines, remote.js): which is which. The board needs it twice: to open another machine's agent in
// the web UI's own view of that pane (`?machine=<its PC>`), and to show the board of the machine the web UI is on.
// Nothing is written and nothing is kept: the front door asks the web UI, with the caller's own headers, what PCs
// it has (`GET /api/machines`, checked on herdr-web-ui 0.4.8), and only what is needed of each is passed on.
import { ask } from "./proxy.js";
import { callerHeaders } from "./access.js";

export const PCS = "/api/machines";
const LOCAL = "local";

// What the web UI answered, as the few things the board needs of each PC; null when it is no such answer (an older
// web UI, a bridge that manages no PCs, a caller it does not let in).
export function readPcs(text) {
  let list;
  try { list = JSON.parse(text).machines; } catch { return null; }
  if (!Array.isArray(list)) return null;
  return list.filter((m) => m && typeof m.id === "string" && m.id).map((m) => ({
    id: m.id, name: String(m.name || m.id), local: m.kind === "local" || m.id === LOCAL, profile: String(m.herdr_profile_id || ""),
    to: String(m.target?.destination || ""), port: Number(m.target?.port) || 0, session: String(m.target?.session || ""),
    connected: m.enabled !== false && m.state === "connected", state: m.enabled === false ? "turned off" : String(m.state || ""),
  }));
}
// Asks the web UI. The answer carries every PC's whole list of panes, so it may be long.
export async function askPcs(req, to) {
  const answer = await ask(to, { path: PCS, headers: callerHeaders(req), max: 16 << 20 });
  return answer && answer.status === 200 ? readPcs(answer.body) : null;
}

// An SSH address as its parts: `user@host`, `host`, or herdr's `ssh://user@host:port`. An SSH alias is a host.
export function address(target, port = 0) {
  const uri = /^ssh:\/\/(?:([^@/]+)@)?(\[[^\]]+\]|[^:/]+)(?::(\d+))?$/.exec(String(target || ""));
  const plain = uri ? null : /^(?:([^@]+)@)?(.+)$/.exec(String(target || ""));
  const [user, host, p] = uri ? [uri[1], uri[2], uri[3]] : plain ? [plain[1], plain[2], ""] : ["", "", ""];
  return { user: user || "", host: String(host || "").toLowerCase(), port: Number(p) || Number(port) || 0 };
}
const session = (s) => (!s || s === "default" ? "" : String(s));
// Is this PC of the web UI that machine of the board? By herdr's own id for the saved machine when the web UI names
// it (it does for a PC it took from `herdr machine list`); else by where it connects: the same host, port and herdr
// session, and the same user where both say one. A port left out is not taken for 22: SSH's own config decides it.
export function same(machine, pc) {
  if (!machine || !pc || pc.local) return false;
  if (pc.profile && machine.id) return pc.profile === machine.id;
  const a = address(machine.target), b = address(pc.to, pc.port);
  return !!a.host && a.host === b.host && a.port === b.port && (!a.user || !b.user || a.user === b.user) && session(machine.session) === session(pc.session);
}
export const pcOf = (machine, pcs) => (pcs || []).find((pc) => same(machine, pc)) || null;
export const machineOf = (pc, machines) => (machines || []).find((m) => same(m, pc)) || null;
